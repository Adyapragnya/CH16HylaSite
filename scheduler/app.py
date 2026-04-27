"""
CH16Hyla — Flask Scheduler Service
Runs background cron jobs to sync data from GreenHyla API every N minutes.

GreenHyla API notes (confirmed via live probing):
  - GET /vessels   → 404  (endpoint does NOT exist)
  - GET /events    → 400  without ?imo= (error: IMO_OR_LOCODE_REQUIRED)
  - GET /events?imo=<csv>&limit=200  → 200, returns geofence entry/exit events
  - GET /subscriptions  → 200, returns {status, imos:[...]}

All vessel position + geofence data comes through /events.
"""
import os
import logging
from datetime import datetime, timezone
from flask import Flask, jsonify
from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '../.env'))

import httpx
from pymongo import MongoClient

MONGO_URI       = os.getenv('MONGO_URI')
CH16_DB         = os.getenv('CH16_DB_NAME', 'CH16db')
HYLATRIAL_DB    = os.getenv('HYLATRIAL_DB', 'HylaTrial')
HYLA_ANALYTICS2 = os.getenv('HYLA_ANALYTICS2_DB', 'HylaAnalytics2')
GH_API_URL      = os.getenv('GREENHYLA_API_URL', 'https://app.greenhyla.com/auth/api/v1/external')
GH_API_KEY      = os.getenv('GREENHYLA_API_KEY', '')
INTERVAL_MIN    = int(os.getenv('CRON_INTERVAL_MINUTES', '5'))
SCHEDULER_PORT  = int(os.getenv('SCHEDULER_PORT', 5001))

# Batch size: how many IMOs to pack into one /events call
EVENT_BATCH = 50


def _min_cert_days(certificates):
    """Return smallest days-to-expiry across certs; None if no data."""
    from datetime import timezone as _tz
    best, now = None, _now()
    for c in certificates or []:
        d = c.get('days_remaining')
        if d is None:
            exp = c.get('expiry_date') or c.get('expiryDate')
            if exp:
                try:
                    from datetime import datetime as _dt
                    d = (_dt.fromisoformat(str(exp).replace('Z', '+00:00')) - now).days
                except Exception:
                    pass
        if d is not None:
            best = d if best is None else min(best, d)
    return best

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

app = Flask(__name__)

_client = None


def get_mongo():
    global _client
    if _client is None:
        _client = MongoClient(MONGO_URI)
    return _client


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
        is_lsa = any(k in t for k in ('LSA', 'LSAF', 'LIFE SAVING', 'LIFESAVING', 'LIFE-SAVING'))
        is_ffa = any(k in t for k in ('FFA', 'FFAF', 'FIRE FIGHT', 'FIREFIGHT', 'FIRE FIGHTING', 'FIREFIGHTING', 'FIRE-FIGHT'))
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


# ── Job: Sync GreenHyla events → vessel positions + event log ────────────────
def sync_gh_events():
    """
    1. Fetch subscribed IMO list from GET /subscriptions.
    2. Batch-call GET /events?imo=<csv>&limit=200  (up to EVENT_BATCH IMOs per call).
    3. For each IMO, take the newest event and write lat/lon/port/geofence to CH16db.vessels.
    4. Upsert every event into CH16db.events.
    """
    log.info('[CRON] Syncing GreenHyla events (positions + geofence)...')
    try:
        # Step 1 — get subscribed IMOs
        sub = httpx.get(f'{GH_API_URL}/subscriptions', headers=_gh_headers(), timeout=15)
        sub.raise_for_status()
        all_imos = [str(i) for i in sub.json().get('imos', [])]
        if not all_imos:
            log.warning('[CRON] No subscribed IMOs — skipping events sync')
            return

        db          = get_mongo()[CH16_DB]
        vessels_col = db['vessels']
        events_col  = db['events']

        total_events  = 0
        latest_by_imo = {}   # imo_str -> newest event (list comes newest-first)

        # Step 2 — batch fetch events
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

                    # Upsert event (unique by imo + timestamp + type)
                    ev_key = f"{imo}-{ev.get('timestamp', '')}-{ev.get('event', '')}"
                    ev['synced_at'] = _now()
                    events_col.update_one(
                        {'event_id': ev_key},
                        {'$set': {**ev, 'event_id': ev_key}},
                        upsert=True,
                    )
                    total_events += 1

                    # Keep only the first-seen (= newest) event per IMO
                    if imo not in latest_by_imo:
                        latest_by_imo[imo] = ev

            except Exception as batch_err:
                log.warning('[CRON] Events batch %d/%d failed: %s',
                            start // EVENT_BATCH + 1,
                            -(-len(all_imos) // EVENT_BATCH),
                            batch_err)

        # Step 3 — update vessel positions from latest events
        pos_updated = 0
        for imo, ev in latest_by_imo.items():
            pos        = ev.get('position') or {}
            geo        = ev.get('geofence') or {}
            event_type = ev.get('event', '')

            update = {}
            # GreenHyla position uses 'lng' — store as 'lon' in MongoDB
            if pos.get('lat') is not None:
                update['lat']    = pos['lat']
            if pos.get('lng') is not None:
                update['lon']    = pos['lng']
            if pos.get('speed') is not None:
                update['speed']  = pos['speed']
            if pos.get('course') is not None:
                update['course'] = pos['course']

            port = geo.get('port') or geo.get('name')
            if port:
                update['port'] = port
            if geo.get('name'):
                update['geofence_name'] = geo['name']
            if geo.get('geofenceType'):
                update['geofence_type'] = geo['geofenceType']

            update['geofence_flag']   = 'Inside' if event_type == 'geofence.entry' else 'Outside'
            update['last_ais_update'] = _now()
            if event_type == 'geofence.entry':
                update['geofence_entry'] = ev.get('timestamp')

            vessels_col.update_one({'imo': imo}, {'$set': update})
            pos_updated += 1

        log.info('[CRON] GreenHyla: %d events synced, %d vessel positions updated',
                 total_events, pos_updated)

    except Exception as e:
        log.warning('[CRON] GreenHyla events sync failed: %s', e)


# ── Job: Sync source DB vessels → CH16db ─────────────────────────────────────
def sync_source_vessels():
    log.info('[CRON] Syncing source vessels from HylaTrial + HylaAnalytics2...')
    try:
        client = get_mongo()
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

        # HylaTrial.ScrapperData -> CH16db.scrapper_data and CH16db.vessels
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
            dst_vessels.update_one({'imo': imo}, {'$set': _compact({
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
            })}, upsert=True)
            vessel_count += 1

        # HylaTrial.vessel_master -> enrich already scraped vessels only
        for doc in client[HYLATRIAL_DB]['vessel_master'].find({}):
            imo = _pick_imo(doc, 'imoNumber')
            if not imo or imo not in scraped_imos:
                continue

            result = dst_vessels.update_one({'imo': imo}, {'$set': _compact({
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
            })}, upsert=False)
            master_count += result.matched_count

        # HylaAnalytics2.vessels -> enrich already scraped vessels only
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


def run_all_jobs():
    """Master cron — runs every CRON_INTERVAL_MINUTES.
    Order matters: source metadata runs first so that GreenHyla live data (positions,
    port, geofence) always overwrites any stale values from the source DBs.
    """
    log.info('[CRON] ---- Sync starting ----')
    sync_source_vessels()   # metadata first (HylaTrial + HylaAnalytics2)
    sync_gh_events()        # live data last — positions + geofence overwrite stale port
    try:
        get_mongo()[CH16_DB]['sync_log'].insert_one({'type': 'cron', 'ts': _now()})
    except Exception:
        pass
    log.info('[CRON] ---- Sync complete ----')


# ── APScheduler ───────────────────────────────────────────────────────────────
scheduler = BackgroundScheduler(timezone='UTC')
scheduler.add_job(run_all_jobs, 'interval', minutes=INTERVAL_MIN, id='main_sync',
                  next_run_time=_now())   # run immediately on start


# ── Flask routes ──────────────────────────────────────────────────────────────
@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'interval_minutes': INTERVAL_MIN})


@app.route('/sync/trigger', methods=['POST'])
def manual_trigger():
    run_all_jobs()
    return jsonify({'status': 'triggered', 'ts': _now().isoformat()})


@app.route('/sync/jobs')
def list_jobs():
    jobs = [{'id': j.id, 'name': j.name,
             'next_run': str(j.next_run_time),
             'trigger': str(j.trigger)}
            for j in scheduler.get_jobs()]
    return jsonify({'jobs': jobs})


@app.route('/sync/logs')
def sync_logs():
    try:
        col  = get_mongo()[CH16_DB]['sync_log']
        logs = list(col.find({}).sort('ts', -1).limit(20))
        for l in logs:
            l['_id'] = str(l['_id'])
            if 'ts' in l:
                l['ts'] = str(l['ts'])
        return jsonify({'data': logs})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    scheduler.start()
    log.info('Scheduler started — interval: %d minutes, batch size: %d IMOs/request',
             INTERVAL_MIN, EVENT_BATCH)
    try:
        app.run(host='0.0.0.0', port=SCHEDULER_PORT, debug=False)
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()
