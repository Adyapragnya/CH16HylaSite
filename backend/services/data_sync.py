"""
Data sync service: pulls from source DBs and GreenHyla API and writes to CH16db.
Called at startup and by the scheduler every CRON_INTERVAL_MINUTES minutes.

GreenHyla API facts (confirmed via live probing):
  - /vessels endpoint does NOT exist (404)
  - /events requires ?imo=<csv> — bare calls return 400 (IMO_OR_LOCODE_REQUIRED)
  - /subscriptions returns the list of subscribed IMOs
  All position + geofence data flows through /events.
"""
import asyncio
import logging
from datetime import datetime, timezone

from db.connection import (
    get_scrapper_data_src,
    get_vessel_master_src,
    get_users_src,
    get_vessels_src,
    get_vessels_col,
    get_users_col,
    get_scrapper_col,
    get_sync_log_col,
    get_tracked_vessels_src,
)
from services import greenhyla_api

log = logging.getLogger(__name__)


def _now():
    return datetime.now(timezone.utc)


def _normalize_imo(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = str(value).strip()
    if not text or text.lower() == "none":
        return None
    if text.endswith(".0") and text[:-2].isdigit():
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
        int(bool(preferred_source) and doc.get("source") == preferred_source),
        int(isinstance(doc.get("imo"), str) and doc.get("imo", "").strip() == _normalize_imo(doc.get("imo"))),
        int(bool(doc.get("certificates"))),
    )


_LSA_KW = {'LSA', 'LSAF', 'LIFE SAVING', 'LIFESAVING', 'LIFE-SAVING'}
_FFA_KW = {'FFA', 'FFAF', 'FIRE FIGHT', 'FIREFIGHT', 'FIRE FIGHTING', 'FIREFIGHTING', 'FIRE-FIGHT'}


def _min_cert_days(certificates: list) -> int | None:
    """Return the smallest days-to-expiry across all certs; None if no dates."""
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


def _cert_extras(certificates: list) -> dict:
    """
    Pre-compute cert_status / lsa_days / ffa_days so list endpoints can exclude
    the full certificates array and stay fast even at millions of vessels.
    """
    min_days = _min_cert_days(certificates)

    if min_days is None:
        status = 'none'
    elif min_days < 0:
        status = 'expired'
    elif min_days < 20:
        status = 'critical'
    elif min_days < 60:
        status = 'warning'
    else:
        status = 'valid'

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


async def _load_scraped_imo_set() -> set[str]:
    imos: set[str] = set()
    async for doc in get_scrapper_data_src().find({}, {"imo": 1}):
        imo = _pick_imo(doc, "imo", "_id")
        if imo:
            imos.add(imo)
    return imos


async def _delete_many_by_ids(col, ids: list) -> int:
    deleted = 0
    for start in range(0, len(ids), 500):
        chunk = ids[start:start + 500]
        if not chunk:
            continue
        result = await col.delete_many({"_id": {"$in": chunk}})
        deleted += result.deleted_count
    return deleted


async def _reconcile_collection(col, *, authoritative_imos: set[str], preferred_source: str | None = None) -> dict:
    keepers: dict[str, dict] = {}
    delete_ids: list = []

    async for doc in col.find({}, {"_id": 1, "imo": 1, "source": 1, "certificates": 1}):
        normalized_imo = _pick_imo(doc, "imo", "_id")
        if not normalized_imo or normalized_imo not in authoritative_imos:
            delete_ids.append(doc["_id"])
            continue

        keeper = keepers.get(normalized_imo)
        if keeper is None:
            keepers[normalized_imo] = doc
            continue

        if _doc_rank(doc, preferred_source) > _doc_rank(keeper, preferred_source):
            delete_ids.append(keeper["_id"])
            keepers[normalized_imo] = doc
        else:
            delete_ids.append(doc["_id"])

    normalized = 0
    for normalized_imo, doc in keepers.items():
        if doc.get("imo") != normalized_imo:
            result = await col.update_one({"_id": doc["_id"]}, {"$set": {"imo": normalized_imo}})
            normalized += result.modified_count

    deleted = await _delete_many_by_ids(col, delete_ids)
    return {"kept": len(keepers), "normalized": normalized, "deleted": deleted}


async def reconcile_portal_collections(scraped_imos: set[str] | None = None) -> dict:
    if scraped_imos is None:
        scraped_imos = await _load_scraped_imo_set()
    if not scraped_imos:
        log.warning("Skipped portal reconciliation because source ScrapperData returned no IMOs")
        return {"scraped_imos": 0, "vessels": {"kept": 0, "normalized": 0, "deleted": 0}, "scrapper_data": {"kept": 0, "normalized": 0, "deleted": 0}}

    scrapper_result = await _reconcile_collection(get_scrapper_col(), authoritative_imos=scraped_imos)
    vessel_result = await _reconcile_collection(
        get_vessels_col(),
        authoritative_imos=scraped_imos,
        preferred_source="scrapper_data",
    )
    log.info(
        "Reconciled portal collections for %d scraped IMOs: vessels(deleted=%d normalized=%d) scrapper_data(deleted=%d normalized=%d)",
        len(scraped_imos),
        vessel_result["deleted"],
        vessel_result["normalized"],
        scrapper_result["deleted"],
        scrapper_result["normalized"],
    )
    return {"scraped_imos": len(scraped_imos), "vessels": vessel_result, "scrapper_data": scrapper_result}


# ── Users ─────────────────────────────────────────────────────────────────────
async def sync_users():
    """Copy users from HylaAnalytics2.users to CH16db.users (upsert by username)."""
    src = get_users_src()
    dst = get_users_col()
    count = 0
    async for doc in src.find({}):
        doc.pop("_id", None)
        username = doc.get("username") or doc.get("id")
        if not username:
            continue
        doc["username"] = username
        await dst.update_one({"username": username}, {"$set": doc}, upsert=True)
        count += 1
    log.info("Synced %d users from HylaAnalytics2", count)
    return count


# ── ScrapperData ──────────────────────────────────────────────────────────────
async def sync_scrapper_data():
    """Copy ScrapperData from HylaTrial to CH16db.scrapper_data (upsert by imo)."""
    src = get_scrapper_data_src()
    dst = get_scrapper_col()
    count = 0
    async for doc in src.find({}):
        imo = _pick_imo(doc, "imo", "_id")
        if not imo:
            continue
        doc.pop("_id", None)
        doc["imo"] = imo
        doc["synced_at"] = _now()
        await dst.update_one({"imo": imo}, {"$set": doc}, upsert=True)
        count += 1
    log.info("Synced %d scrapper_data docs from HylaTrial", count)
    return count


# ── vessel_master ─────────────────────────────────────────────────────────────
async def sync_vessel_master(scraped_imos: set[str] | None = None):
    """Enrich scraped portal vessels with vessel_master metadata only."""
    from pymongo import UpdateOne

    if scraped_imos is None:
        scraped_imos = await _load_scraped_imo_set()

    src = get_vessel_master_src()
    dst = get_vessels_col()
    ops, count = [], 0
    batch_size = 500

    async for doc in src.find({}):
        doc.pop("_id", None)
        imo = _pick_imo(doc, "imoNumber")
        if not imo or imo not in scraped_imos:
            continue
        vessel = {
            "imo":           imo,
            "name":          doc.get("transportName"),
            "flag":          doc.get("FLAG"),
            "vessel_type":   doc.get("transportCategory"),
            "spire_type":    doc.get("SpireTransportType"),
            "gross_tonnage": doc.get("GrossTonnage"),
            "dwt":           doc.get("deadWeight"),
            "loa":           doc.get("LOA"),
            "beam":          doc.get("Beam"),
            "max_draft":     doc.get("MaxDraft"),
            "year_built":    doc.get("buildYear"),
            "synced_at":     _now(),
        }
        vessel = _compact(vessel)
        ops.append(UpdateOne({"imo": imo}, {"$set": vessel}))
        count += 1
        if len(ops) >= batch_size:
            try:
                await dst.bulk_write(ops, ordered=False)
            except asyncio.CancelledError:
                raise
            ops = []

    if ops:
        await dst.bulk_write(ops, ordered=False)
    log.info("Enriched %d scraped vessels from HylaTrial.vessel_master", count)
    return count


# ── HylaAnalytics2 vessels ────────────────────────────────────────────────────
async def sync_hyla_vessels(scraped_imos: set[str] | None = None):
    """Enrich scraped vessels with HylaAnalytics2 metadata without creating new portal docs."""
    from pymongo import UpdateOne

    if scraped_imos is None:
        scraped_imos = await _load_scraped_imo_set()

    src = get_vessels_src()
    dst = get_vessels_col()
    ops, count = [], 0
    batch_size = 500

    async for doc in src.find({}):
        doc.pop("_id", None)
        imo = _pick_imo(doc, "imo_number")
        if not imo or imo not in scraped_imos:
            continue
        vessel = {
            "imo":          imo,
            "name":         doc.get("name"),
            "mmsi":         doc.get("mmsi"),
            "callsign":     doc.get("callsign"),
            "flag":         doc.get("flag"),
            "ship_manager": doc.get("ship_manager"),
            "ship_owner":   doc.get("ship_owner"),
            "class_society": doc.get("class_society"),
            "port":         doc.get("port") or None,
            "locode":       doc.get("locode"),
            "destination":  doc.get("destination"),
            "berth":        doc.get("berth"),
            "terminal":     doc.get("terminal"),
            "eta":          doc.get("eta"),
            "etd":          doc.get("etd"),
            "last_port":    doc.get("last_port"),
            "service_types": doc.get("service_types", []),
            "relationship": doc.get("relationship"),
            "vessel_type":  doc.get("vessel_type"),
            "synced_at":    _now(),
        }
        # Only overwrite certificate data if this source actually has it.
        # HylaAnalytics2 is primarily for metadata/AIS — ScrapperData is the
        # authoritative source for certificates. Blindly setting certificates:[]
        # here would erase certs written by sync_scrapper_to_vessels().
        certs = doc.get("certificates") or []
        if certs:
            vessel["certificates"]  = certs
            vessel["min_cert_days"] = _min_cert_days(certs)
            vessel.update(_cert_extras(certs))   # cert_status, lsa_days, ffa_days

        vessel = _compact(vessel)
        ops.append(UpdateOne({"imo": imo}, {"$set": vessel}))
        count += 1
        if len(ops) >= batch_size:
            try:
                await dst.bulk_write(ops, ordered=False)
            except asyncio.CancelledError:
                raise
            ops = []

    if ops:
        await dst.bulk_write(ops, ordered=False)
    log.info("Enriched %d scraped vessels from HylaAnalytics2", count)
    return count


# ── ScrapperData → vessels (certificates + metadata) ─────────────────────────
async def sync_scrapper_to_vessels():
    """
    Merge HylaTrial.ScrapperData into CH16db.vessels.
    This is the main source of certificate data for the 3071+ scraped vessels.
    Computes min_cert_days for fast urgency-sorted queries.
    Uses bulk_write in batches of 500 for performance at scale.
    """
    from pymongo import UpdateOne

    src = get_scrapper_data_src()
    dst = get_vessels_col()
    ops, count = [], 0
    batch_size  = 500

    async for doc in src.find({}):
        imo = _pick_imo(doc, "imo", "_id")
        if not imo:
            continue
        doc.pop("_id", None)

        certs  = doc.get("certificates", [])
        vessel = {
            "imo":              imo,
            "name":             doc.get("name"),
            "callsign":         doc.get("callsign"),
            "mmsi":             doc.get("mmsi"),
            "flag":             doc.get("flag"),
            "vessel_type":      doc.get("vessel_type") or doc.get("spire_type"),
            "spire_type":       doc.get("spire_type"),
            "gross_tonnage":    doc.get("gross_tonnage"),
            "dwt":              doc.get("dwt"),
            "loa":              doc.get("loa"),
            "beam":             doc.get("beam"),
            "max_draft":        doc.get("max_draft"),
            "year_built":       doc.get("year_built"),
            "ship_manager":     doc.get("ship_manager"),
            "ship_owner":       doc.get("ship_owner"),
            "class_society":    doc.get("class_society"),
            "class_status":     doc.get("class_status"),
            "class_notation":   doc.get("class_notation"),
            "certificates":     certs,
            "min_cert_days":    _min_cert_days(certs),
            **_cert_extras(certs),          # cert_status, lsa_days, ffa_days
            "source":           "scrapper_data",
            "scraped_at":       doc.get("scraped_at"),
            "synced_at":        _now(),
        }
        vessel = _compact(vessel)
        ops.append(UpdateOne({"imo": imo}, {"$set": vessel}, upsert=True))
        count += 1
        if len(ops) >= batch_size:
            try:
                await dst.bulk_write(ops, ordered=False)
            except asyncio.CancelledError:
                raise
            ops = []

    if ops:
        await dst.bulk_write(ops, ordered=False)
    log.info("Synced %d scrapper vessels (with certs) into CH16db.vessels", count)
    return count


# ── TrackedVessel (AIS from HylaTrial) ───────────────────────────────────────
async def sync_tracked_vessels():
    """Pull AIS positions and geofence status from HylaTrial.TrackedVessel."""
    src = get_tracked_vessels_src()
    dst = get_vessels_col()
    count = 0
    fields = {
        "IMO": 1, "AIS": 1, "SpireTransportType": 1, "FLAG": 1,
        "GrossTonnage": 1, "deadWeight": 1,
        "GeofenceStatus": 1, "geofenceFlag": 1, "GeofenceInsideTime": 1,
        "regionName": 1, "source_UpdatedFrom": 1,
    }
    async for doc in src.find({}, fields):
        imo = _pick_imo(doc, "IMO")
        if not imo or imo == "0":
            continue
        ais = doc.get("AIS") or {}
        geofence_status = doc.get("GeofenceStatus") or ""
        geofence_flag   = doc.get("geofenceFlag") or ""
        in_port   = geofence_flag == "Inside" or (geofence_status and geofence_flag != "Outside")
        port_name = geofence_status if in_port else None

        update = {
            "lat":            ais.get("LATITUDE"),
            "lon":            ais.get("LONGITUDE"),
            "speed":          ais.get("SPEED"),
            "course":         ais.get("COURSE"),
            "heading":        ais.get("HEADING"),
            "nav_status":     ais.get("NAVSTAT"),
            "draught":        ais.get("DRAUGHT"),
            "destination":    ais.get("DESTINATION"),
            "locode":         ais.get("LOCODE"),
            "eta":            ais.get("ETA") or ais.get("ETA_AIS"),
            "mmsi":           ais.get("MMSI"),
            "callsign":       ais.get("CALLSIGN"),
            "spire_type":     doc.get("SpireTransportType"),
            "flag":           doc.get("FLAG"),
            "gross_tonnage":  doc.get("GrossTonnage"),
            "dwt":            doc.get("deadWeight"),
            "geofence_name":  geofence_status or None,
            "geofence_flag":  geofence_flag or None,
            "geofence_entry": doc.get("GeofenceInsideTime"),
            "last_ais_update": ais.get("TIMESTAMP") or _now(),
        }
        if port_name:
            update["port"] = port_name
        update = {k: v for k, v in update.items() if v is not None}
        if update:
            await dst.update_one({"imo": imo}, {"$set": update}, upsert=False)
            count += 1

    log.info("Updated AIS+port from HylaTrial.TrackedVessel for %d vessels", count)
    return count


# ── GreenHyla events → vessel positions + event log ──────────────────────────
async def sync_greenhyla_events():
    """
    1. GET /subscriptions  → all subscribed IMOs.
    2. Batch-call GET /events?imo=<csv>&limit=200 (50 IMOs per request).
    3. Newest event per IMO → update vessel lat/lon/port/geofence in CH16db.vessels.
    4. Upsert all events into CH16db.events.

    GreenHyla position uses 'lng'; MongoDB stores it as 'lon'.
    """
    try:
        from db.connection import get_events_col

        EVENT_BATCH = 50

        # Step 1 — subscribed IMOs, intersected with vessels in local DB
        sub_data = await greenhyla_api.get_subscriptions()
        subscribed = {str(i) for i in sub_data.get("imos", [])}
        if not subscribed:
            log.warning("GreenHyla: no subscribed IMOs — skipping events sync")
            return 0

        dst_vessels = get_vessels_col()
        dst_events  = get_events_col()

        # Only query events for vessels we actually track; avoids 403s from
        # IMOs returned by /subscriptions that this API key can't access.
        our_imos_cursor = dst_vessels.find({}, {"imo": 1, "_id": 0})
        our_imos = {doc["imo"] async for doc in our_imos_cursor}
        all_imos = [imo for imo in subscribed if imo in our_imos]
        if not all_imos:
            # Fallback: if none overlap, query all our vessel IMOs directly
            all_imos = list(our_imos)
        log.info("GreenHyla: querying events for %d vessels (subscribed=%d, local=%d)",
                 len(all_imos), len(subscribed), len(our_imos))

        total_events  = 0
        latest_by_imo = {}   # newest event per IMO (items arrive newest-first)

        # Step 2 — batch-fetch events
        for start in range(0, len(all_imos), EVENT_BATCH):
            batch = all_imos[start: start + EVENT_BATCH]
            try:
                data  = await greenhyla_api.get_events(batch, limit=200)
                items = data.get("items", [])

                for ev in items:
                    imo = str(ev.get("imo", ""))
                    if not imo:
                        continue

                    # Upsert event (unique by imo + timestamp + event-type)
                    ev_key = f"{imo}-{ev.get('timestamp', '')}-{ev.get('event', '')}"
                    ev["synced_at"] = _now()
                    await dst_events.update_one(
                        {"event_id": ev_key},
                        {"$set": {**ev, "event_id": ev_key}},
                        upsert=True,
                    )
                    total_events += 1

                    # Keep only the first-seen (= newest) event per IMO
                    if imo not in latest_by_imo:
                        latest_by_imo[imo] = ev

            except asyncio.CancelledError:
                raise
            except Exception as batch_err:
                log.warning("GreenHyla events batch %d failed: %s",
                            start // EVENT_BATCH + 1, batch_err)

        # Step 3 — update vessel positions from latest events
        pos_updated = 0
        for imo, ev in latest_by_imo.items():
            pos        = ev.get("position") or {}
            geo        = ev.get("geofence") or {}
            event_type = ev.get("event", "")

            update = {}
            if pos.get("lat")    is not None: update["lat"]    = pos["lat"]
            if pos.get("lng")    is not None: update["lon"]    = pos["lng"]  # GH uses lng
            if pos.get("speed")  is not None: update["speed"]  = pos["speed"]
            if pos.get("course") is not None: update["course"] = pos["course"]

            if geo.get("name"):               update["geofence_name"] = geo["name"]
            if geo.get("geofenceType"):       update["geofence_type"] = geo["geofenceType"]

            if event_type == "geofence.entry":
                update["geofence_flag"]  = "Inside"
                update["geofence_entry"] = ev.get("timestamp")
                port = geo.get("port") or geo.get("name")
                if port: update["port"] = port
            else:
                update["geofence_flag"] = "Outside"
                update["port"] = None  # vessel has left; clear stale port

            # Use actual event timestamp so staleness is visible in the UI
            update["last_ais_update"] = ev.get("timestamp") or _now()

            if update:
                await dst_vessels.update_one({"imo": imo}, {"$set": update})
                pos_updated += 1

        log.info("GreenHyla: %d events synced, %d vessel positions updated",
                 total_events, pos_updated)
        return total_events

    except asyncio.CancelledError:
        raise
    except Exception as exc:
        log.warning("GreenHyla events sync failed: %s", exc)
        return 0


# ── Master sync ───────────────────────────────────────────────────────────────
async def run_full_sync():
    """
    Run all sync tasks in the correct order so live data wins:
      1. Source metadata (scrapper_data, scraped vessels, master enrichment, users)
      2. HylaTrial AIS (TrackedVessel)
      3. GreenHyla events — live positions + geofence overwrite stale source data

    Catches CancelledError so Ctrl+C / uvicorn reload exits cleanly.
    Returns a summary dict.
    """
    log.info("Starting full data sync...")
    results = {}

    async def _run(name: str, coro):
        """Run one sync step; log + continue on error, re-raise CancelledError."""
        try:
            results[name] = await coro
        except asyncio.CancelledError:
            raise   # propagate — server is shutting down
        except Exception as exc:
            log.error("Sync step '%s' failed (continuing): %s", name, exc)
            results[name] = f"error: {exc}"

    try:
        scraped_imos = await _load_scraped_imo_set()
        await _run("users",               sync_users())
        await _run("scrapper_data",       sync_scrapper_data())
        await _run("scrapper_to_vessels", sync_scrapper_to_vessels())
        await _run("portal_reconcile",    reconcile_portal_collections(scraped_imos))
        await _run("vessel_master",       sync_vessel_master(scraped_imos))
        await _run("hyla_vessels",        sync_hyla_vessels(scraped_imos))
        await _run("tracked_vessels",     sync_tracked_vessels())
        await _run("gh_events",           sync_greenhyla_events())
        results["status"]    = "ok"
        results["synced_at"] = _now().isoformat()

    except asyncio.CancelledError:
        log.info("Full sync cancelled (server shutdown or reload) — exiting cleanly")
        results["status"] = "cancelled"
        return results

    try:
        await get_sync_log_col().insert_one({**results, "ts": _now()})
    except Exception:
        pass

    log.info("Full sync complete: %s", results)
    return results
