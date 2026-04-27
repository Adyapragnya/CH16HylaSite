"""
Background cron scheduler — runs inside the FastAPI process via APScheduler.

Sync strategy (every CRON_INTERVAL_MINUTES):
  1. _sync_gh_events()  — fetches GreenHyla events in IMO batches:
       GET /subscriptions  → list of subscribed IMOs
       GET /events?imo=<batch>&limit=200  → geofence entry/exit events
     Extracts the latest position + geofence state per vessel and writes to CH16db.vessels.
     Also upserts events into CH16db.events.

  2. _sync_source_vessels()  — merges vessel metadata from HylaTrial + HylaAnalytics2.

NOTE: GreenHyla has NO /vessels endpoint.  All position data comes through /events.
      The /events endpoint REQUIRES ?imo= (or ?locode=); bare requests return 400.
"""
import asyncio
import os
import logging
from datetime import datetime, timezone

import httpx
from pymongo import MongoClient

log = logging.getLogger(__name__)

MONGO_URI       = os.getenv('MONGO_URI')
CH16_DB         = os.getenv('CH16_DB_NAME', 'CH16db')
HYLATRIAL_DB    = os.getenv('HYLATRIAL_DB', 'HylaTrial')
HYLA_ANALYTICS2 = os.getenv('HYLA_ANALYTICS2_DB', 'HylaAnalytics2')
GH_API_URL      = os.getenv('GREENHYLA_API_URL', 'https://app.greenhyla.com/auth/api/v1/external')
GH_API_KEY      = os.getenv('GREENHYLA_API_KEY', '')
INTERVAL_MIN    = int(os.getenv('CRON_INTERVAL_MINUTES', '5'))

# Batch size for /events calls (comma-separated IMOs per request)
EVENT_BATCH = 50

_sync_client = None


def _mongo():
    global _sync_client
    if _sync_client is None:
        _sync_client = MongoClient(MONGO_URI)
    return _sync_client


def _now():
    return datetime.now(timezone.utc)


def _gh_headers():
    return {'x-api-key': GH_API_KEY, 'Content-Type': 'application/json'}


def _normalize_imo(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = str(value).strip()
    if not text or text.lower() == 'none':
        return None
    if text.endswith('.0') and text[:-2].isdigit():
        text = text[:-2]
    return text


def _pick_imo(doc: dict, *keys: str) -> str | None:
    for key in keys:
        imo = _normalize_imo(doc.get(key))
        if imo:
            return imo
    return None


def _compact(doc: dict) -> dict:
    return {key: value for key, value in doc.items() if value is not None}


def _doc_rank(doc: dict, preferred_source: str | None = None) -> tuple[int, int, int]:
    return (
        int(bool(preferred_source) and doc.get('source') == preferred_source),
        int(isinstance(doc.get('imo'), str) and doc.get('imo', '').strip() == _normalize_imo(doc.get('imo'))),
        int(bool(doc.get('certificates'))),
    )


def _sync_gh_events():
    """
    1. GET /subscriptions  — fetch all subscribed IMOs.
    2. Batch-call GET /events?imo=<csv>  — fetch geofence entry/exit events.
    3. For each IMO take the newest event → update vessel lat/lon/port/geofence.
    4. Upsert every event into CH16db.events.
    """
    try:
        # --- Step 1: get subscribed IMOs ---
        sub_resp = httpx.get(f'{GH_API_URL}/subscriptions', headers=_gh_headers(), timeout=15)
        sub_resp.raise_for_status()
        subscribed = {str(i) for i in sub_resp.json().get('imos', [])}
        if not subscribed:
            log.warning('[CRON] GreenHyla: no subscribed IMOs found')
            return

        db            = _mongo()[CH16_DB]
        vessels_col   = db['vessels']
        events_col    = db['events']

        # Intersect with vessels in local DB to avoid 403s from unowned IMOs
        our_imos = {doc['imo'] for doc in vessels_col.find({}, {'imo': 1, '_id': 0})}
        all_imos = [imo for imo in subscribed if imo in our_imos] or list(our_imos)
        log.info('[CRON] GreenHyla: querying events for %d vessels (subscribed=%d, local=%d)',
                 len(all_imos), len(subscribed), len(our_imos))

        total_events  = 0
        latest_by_imo = {}   # imo_str -> latest event dict (events arrive newest-first)

        # --- Step 2: fetch events in batches ---
        for start in range(0, len(all_imos), EVENT_BATCH):
            batch = all_imos[start: start + EVENT_BATCH]
            try:
                resp = httpx.get(
                    f'{GH_API_URL}/events',
                    headers=_gh_headers(),
                    params={'imo': ','.join(batch), 'limit': 200},
                    timeout=30,
                )
                resp.raise_for_status()
                items = resp.json().get('items', [])

                for ev in items:
                    imo = str(ev.get('imo', ''))
                    if not imo:
                        continue

                    # Upsert event — unique key: imo + timestamp + event-type
                    ev_key = f"{imo}-{ev.get('timestamp', '')}-{ev.get('event', '')}"
                    ev['synced_at'] = _now()
                    events_col.update_one(
                        {'event_id': ev_key},
                        {'$set': {**ev, 'event_id': ev_key}},
                        upsert=True,
                    )
                    total_events += 1

                    # Keep only the newest event per IMO (list is newest-first)
                    if imo not in latest_by_imo:
                        latest_by_imo[imo] = ev

            except Exception as batch_err:
                log.warning('[CRON] GreenHyla events batch %d failed: %s',
                            start // EVENT_BATCH, batch_err)

        # --- Step 3: update vessel positions from latest events ---
        pos_updated = 0
        for imo, ev in latest_by_imo.items():
            pos        = ev.get('position') or {}
            geo        = ev.get('geofence') or {}
            event_type = ev.get('event', '')

            # GreenHyla uses 'lng', MongoDB stores as 'lon'
            update = {}
            if pos.get('lat') is not None:
                update['lat'] = pos['lat']
            if pos.get('lng') is not None:
                update['lon'] = pos['lng']
            if pos.get('speed') is not None:
                update['speed'] = pos['speed']
            if pos.get('course') is not None:
                update['course'] = pos['course']

            # Geofence / port fields
            if geo.get('name'):
                update['geofence_name'] = geo['name']
            if geo.get('geofenceType'):
                update['geofence_type'] = geo['geofenceType']

            if event_type == 'geofence.entry':
                update['geofence_flag']  = 'Inside'
                update['geofence_entry'] = ev.get('timestamp')
                port = geo.get('port') or geo.get('name')
                if port:
                    update['port'] = port
            else:
                update['geofence_flag'] = 'Outside'
                update['port'] = None  # vessel has left; clear stale port

            # Use actual event timestamp so UI shows real data age
            update['last_ais_update'] = ev.get('timestamp') or _now()

            if update:
                vessels_col.update_one({'imo': imo}, {'$set': update})
                pos_updated += 1

        log.info('[CRON] GreenHyla: synced %d events, updated positions for %d vessels',
                 total_events, pos_updated)

    except Exception as e:
        log.warning('[CRON] GreenHyla events sync failed: %s', e)


_LSA_KW = {'LSA', 'LSAF', 'LIFE SAVING', 'LIFESAVING', 'LIFE-SAVING'}
_FFA_KW = {'FFA', 'FFAF', 'FIRE FIGHT', 'FIREFIGHT', 'FIRE FIGHTING', 'FIREFIGHTING', 'FIRE-FIGHT'}


def _min_cert_days(certificates):
    """Return the smallest days-to-expiry across all certificates; None if no data."""
    best = None
    now  = _now()
    for c in certificates or []:
        d = c.get('days_remaining')
        if d is None:
            exp = c.get('expiry_date') or c.get('expiryDate')
            if exp:
                try:
                    d = (datetime.fromisoformat(str(exp).replace('Z', '+00:00')) - now).days
                except Exception:
                    pass
        if d is not None:
            best = d if best is None else min(best, d)
    return best


def _cert_extras(certificates) -> dict:
    """Pre-compute cert_status / lsa_days / ffa_days alongside min_cert_days."""
    min_days = _min_cert_days(certificates)
    if min_days is None:    status = 'none'
    elif min_days < 0:      status = 'expired'
    elif min_days < 20:     status = 'critical'
    elif min_days < 60:     status = 'warning'
    else:                   status = 'valid'

    lsa_days = ffa_days = None
    for c in certificates or []:
        t = (c.get('type') or c.get('cert_type') or c.get('name') or '').upper()
        is_lsa = any(k in t for k in _LSA_KW)
        is_ffa = any(k in t for k in _FFA_KW)
        if is_lsa or is_ffa:
            d = _min_cert_days([c])
            if is_lsa and d is not None:
                lsa_days = d if lsa_days is None else min(lsa_days, d)
            if is_ffa and d is not None:
                ffa_days = d if ffa_days is None else min(ffa_days, d)

    return {'cert_status': status, 'lsa_days': lsa_days, 'ffa_days': ffa_days}


def _load_scraped_imo_set(client) -> set[str]:
    imos: set[str] = set()
    for doc in client[HYLATRIAL_DB]['ScrapperData'].find({}, {'imo': 1}):
        imo = _pick_imo(doc, 'imo', '_id')
        if imo:
            imos.add(imo)
    return imos


def _reconcile_collection(col, *, authoritative_imos: set[str], preferred_source: str | None = None) -> dict:
    keepers: dict[str, dict] = {}
    delete_ids: list = []

    for doc in col.find({}, {'_id': 1, 'imo': 1, 'source': 1, 'certificates': 1}):
        normalized_imo = _pick_imo(doc, 'imo', '_id')
        if not normalized_imo or normalized_imo not in authoritative_imos:
            delete_ids.append(doc['_id'])
            continue

        keeper = keepers.get(normalized_imo)
        if keeper is None:
            keepers[normalized_imo] = doc
            continue

        if _doc_rank(doc, preferred_source) > _doc_rank(keeper, preferred_source):
            delete_ids.append(keeper['_id'])
            keepers[normalized_imo] = doc
        else:
            delete_ids.append(doc['_id'])

    normalized = 0
    for normalized_imo, doc in keepers.items():
        if doc.get('imo') != normalized_imo:
            result = col.update_one({'_id': doc['_id']}, {'$set': {'imo': normalized_imo}})
            normalized += result.modified_count

    deleted = 0
    for start in range(0, len(delete_ids), 500):
        chunk = delete_ids[start:start + 500]
        if not chunk:
            continue
        result = col.delete_many({'_id': {'$in': chunk}})
        deleted += result.deleted_count

    return {'kept': len(keepers), 'normalized': normalized, 'deleted': deleted}


def _reconcile_portal_collections(client, scraped_imos: set[str]) -> None:
    if not scraped_imos:
        log.warning('[CRON] Skipping portal reconciliation because source ScrapperData returned no IMOs')
        return

    ch16 = client[CH16_DB]
    scrapper_result = _reconcile_collection(ch16['scrapper_data'], authoritative_imos=scraped_imos)
    vessel_result = _reconcile_collection(
        ch16['vessels'],
        authoritative_imos=scraped_imos,
        preferred_source='scrapper_data',
    )
    log.info(
        '[CRON] Reconciled portal collections for %d scraped IMOs: vessels(deleted=%d normalized=%d) scrapper_data(deleted=%d normalized=%d)',
        len(scraped_imos),
        vessel_result['deleted'],
        vessel_result['normalized'],
        scrapper_result['deleted'],
        scrapper_result['normalized'],
    )


def _sync_source_vessels():
    """Sync scraper-backed portal data and enrich only the already scraped vessels."""
    try:
        client = _mongo()
        ch16 = client[CH16_DB]
        dst_vessels = ch16['vessels']
        dst_scrapper = ch16['scrapper_data']
        scraped_imos = _load_scraped_imo_set(client)
        if not scraped_imos:
            log.warning('[CRON] No scraped IMOs found in HylaTrial.ScrapperData')
            return

        _reconcile_portal_collections(client, scraped_imos)

        scrapper_count = 0
        vessel_count = 0
        master_count = 0
        analytics_count = 0

        # HylaTrial.ScrapperData → CH16db.scrapper_data and CH16db.vessels
        for doc in client[HYLATRIAL_DB]['ScrapperData'].find({}):
            imo = _pick_imo(doc, 'imo', '_id')
            if not imo:
                continue

            source_doc = dict(doc)
            source_doc.pop('_id', None)
            source_doc['imo'] = imo
            source_doc['synced_at'] = _now()
            dst_scrapper.update_one({'imo': imo}, {'$set': source_doc}, upsert=True)
            scrapper_count += 1

            certs = source_doc.get('certificates', [])
            vessel_doc = _compact({
                'imo':            imo,
                'name':           source_doc.get('name'),
                'callsign':       source_doc.get('callsign'),
                'mmsi':           source_doc.get('mmsi'),
                'flag':           source_doc.get('flag'),
                'vessel_type':    source_doc.get('vessel_type') or source_doc.get('spire_type'),
                'spire_type':     source_doc.get('spire_type'),
                'gross_tonnage':  source_doc.get('gross_tonnage'),
                'dwt':            source_doc.get('dwt'),
                'loa':            source_doc.get('loa'),
                'beam':           source_doc.get('beam'),
                'max_draft':      source_doc.get('max_draft'),
                'year_built':     source_doc.get('year_built'),
                'ship_manager':   source_doc.get('ship_manager'),
                'ship_owner':     source_doc.get('ship_owner'),
                'class_society':  source_doc.get('class_society'),
                'class_status':   source_doc.get('class_status'),
                'class_notation': source_doc.get('class_notation'),
                'certificates':   certs,
                'min_cert_days':  _min_cert_days(certs),
                **_cert_extras(certs),
                'scraped_at':     source_doc.get('scraped_at'),
                'source':         'scrapper_data',
                'synced_at':      _now(),
            })
            dst_vessels.update_one({'imo': imo}, {'$set': vessel_doc}, upsert=True)
            vessel_count += 1

        # HylaTrial.vessel_master — enrich already scraped vessels only
        for doc in client[HYLATRIAL_DB]['vessel_master'].find({}):
            imo = _pick_imo(doc, 'imoNumber')
            if not imo or imo not in scraped_imos:
                continue

            update = _compact({
                'imo':           imo,
                'name':          doc.get('transportName'),
                'flag':          doc.get('FLAG'),
                'vessel_type':   doc.get('transportCategory'),
                'spire_type':    doc.get('SpireTransportType'),
                'gross_tonnage': doc.get('GrossTonnage'),
                'dwt':           doc.get('deadWeight'),
                'loa':           doc.get('LOA'),
                'beam':          doc.get('Beam'),
                'max_draft':     doc.get('MaxDraft'),
                'year_built':    doc.get('buildYear'),
                'synced_at':     _now(),
            })
            result = dst_vessels.update_one({'imo': imo}, {'$set': update}, upsert=False)
            master_count += result.matched_count

        # HylaAnalytics2.vessels — enrich scraped vessels only
        for doc in client[HYLA_ANALYTICS2]['vessels'].find({}):
            imo = _pick_imo(doc, 'imo_number')
            if not imo or imo not in scraped_imos:
                continue
            certs = doc.get('certificates', [])
            update = {
                'imo':           imo,
                'name':          doc.get('name'),
                'mmsi':          doc.get('mmsi'),
                'callsign':      doc.get('callsign'),
                'flag':          doc.get('flag'),
                'ship_manager':  doc.get('ship_manager'),
                'ship_owner':    doc.get('ship_owner'),
                'class_society': doc.get('class_society'),
                'port':          doc.get('port'),
                'locode':        doc.get('locode'),
                'destination':   doc.get('destination'),
                'berth':         doc.get('berth'),
                'eta':           str(doc.get('eta', '')) if doc.get('eta') is not None else None,
                'etd':           str(doc.get('etd', '')) if doc.get('etd') is not None else None,
                'service_types': doc.get('service_types', []),
                'synced_at':     _now(),
            }
            if certs:
                update['certificates'] = certs
                update['min_cert_days'] = _min_cert_days(certs)
                update.update(_cert_extras(certs))

            result = dst_vessels.update_one({'imo': imo}, {'$set': _compact(update)}, upsert=False)
            analytics_count += result.matched_count

        log.info(
            '[CRON] Source sync complete: scrapper_data=%d vessels=%d master_enriched=%d hyla_enriched=%d',
            scrapper_count,
            vessel_count,
            master_count,
            analytics_count,
        )
    except Exception as e:
        log.error('[CRON] Source vessel sync failed: %s', e)


def run_cron():
    log.info('[CRON] ---- Sync starting ----')
    _sync_source_vessels()  # metadata first (HylaTrial + HylaAnalytics2)
    _sync_gh_events()       # live data last — positions + geofence overwrite stale port
    try:
        _mongo()[CH16_DB]['sync_log'].insert_one({'type': 'cron', 'ts': _now()})
    except Exception:
        pass
    log.info('[CRON] ---- Sync complete ----')


class _AsyncCronScheduler:
    """
    Lightweight asyncio-based interval scheduler.
    Replaces APScheduler inside the FastAPI process so that Ctrl+C / hot-reload
    produces a clean shutdown with no ERROR log spam.

    run_cron() is a sync function (uses pymongo), so it executes in the default
    ThreadPoolExecutor to avoid blocking the event loop.
    """

    def __init__(self, func, interval_min: int):
        self._func         = func
        self._interval_min = interval_min
        self._task         = None

    # ── Public API (matches APScheduler's interface used in main.py) ──────────

    def start(self):
        self._task = asyncio.create_task(self._loop(), name='cron_main_sync')

    def shutdown(self, wait: bool = True):
        if self._task and not self._task.done():
            self._task.cancel()

    # ── Internal loop ─────────────────────────────────────────────────────────

    async def _loop(self):
        """
        Wait 60s before the first run so the background data_sync (which fires
        5s after startup) finishes first.  Then repeat every interval_min minutes.
        """
        log.info('[CRON] Scheduler started — interval: %d min (first run in 60s)',
                 self._interval_min)
        try:
            await asyncio.sleep(60)   # let startup sync finish before cron fires
        except asyncio.CancelledError:
            log.info('[CRON] Scheduler stopped before first run (server shutdown)')
            return
        await self._run_once()
        while True:
            try:
                await asyncio.sleep(self._interval_min * 60)
            except asyncio.CancelledError:
                log.info('[CRON] Scheduler stopped (server shutdown)')
                return                                   # clean exit, no ERROR
            await self._run_once()

    async def _run_once(self):
        loop = asyncio.get_event_loop()
        try:
            # run_cron is synchronous — execute in thread pool so we don't block
            await loop.run_in_executor(None, self._func)
        except asyncio.CancelledError:
            log.info('[CRON] Job cancelled during shutdown')
            # do NOT re-raise — the loop will pick up the cancel on next sleep
        except Exception as exc:
            log.error('[CRON] Job failed: %s', exc)


def create_scheduler() -> _AsyncCronScheduler:
    """Return a configured cron scheduler (not yet started)."""
    return _AsyncCronScheduler(run_cron, INTERVAL_MIN)
