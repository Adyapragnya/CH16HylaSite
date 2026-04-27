from fastapi import APIRouter, Query, Depends, HTTPException
from typing import Optional
from datetime import datetime, timezone
import logging

from db.connection import get_vessels_col, get_scrapper_col
from routes.auth import get_current_user

log = logging.getLogger(__name__)
router = APIRouter(prefix='/api/vessels', tags=['Vessels'])


async def _enrich_position_from_gh(imo: str, col, doc: dict) -> dict:
    """
    If the vessel doc has no lat/lon, do a live GreenHyla /events lookup,
    update MongoDB with whatever we find, and merge it into `doc` in-place.
    Returns the (possibly enriched) doc.
    """
    if doc.get('lat') is not None:
        return doc   # already have position — skip live call

    try:
        from services.greenhyla_api import get_events
        ev_data = await get_events([imo], limit=1)
        items   = ev_data.get('items', [])
        if not items:
            return doc

        ev  = items[0]
        pos = ev.get('position') or {}
        geo = ev.get('geofence') or {}
        event_type = ev.get('event', '')

        update: dict = {}
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
        update['last_ais_update'] = datetime.now(timezone.utc)
        if event_type == 'geofence.entry':
            update['geofence_entry'] = ev.get('timestamp')

        if update:
            await col.update_one({'imo': imo}, {'$set': update})
            doc.update(update)
            log.info('[VESSELS] Live GreenHyla enrichment for IMO %s: %s', imo, list(update.keys()))

    except Exception as e:
        log.debug('[VESSELS] GreenHyla live lookup failed for IMO %s: %s', imo, e)

    return doc


def _clean(doc: dict) -> dict:
    doc['_id'] = str(doc.get('_id', ''))
    # Ensure text fields are always strings — some source DBs store them as numbers
    for _f in ('name', 'imo', 'flag', 'vessel_type', 'spire_type',
                'port', 'ship_manager', 'ship_owner', 'class_society'):
        if _f in doc and doc[_f] is not None:
            doc[_f] = str(doc[_f])
    return doc


@router.get('')
async def list_vessels(
    search:        Optional[str]  = Query(None,  description='Name or IMO search'),
    flag:          Optional[str]  = Query(None),
    vessel_type:   Optional[str]  = Query(None),
    class_society: Optional[str]  = Query(None),
    port:          Optional[str]  = Query(None,  description='Filter by exact port name'),
    has_port:      Optional[bool] = Query(None,  description='True = only vessels currently at a port'),
    has_certs:     Optional[bool] = Query(None,  description='True = only vessels with certificate data'),
    ship_manager:  Optional[str]  = Query(None),
    ship_owner:    Optional[str]  = Query(None),
    sort_by:       Optional[str]  = Query('cert_urgency', description='cert_urgency | name | port'),
    include_certs: bool           = Query(False, description='Include full certificates array (expensive — omit for list views)'),
    page:          int            = Query(1,    ge=1),
    limit:         int            = Query(50,   ge=1),   # no hard cap — caller decides
    _=Depends(get_current_user),
):
    """
    List vessels with optional filters and server-side urgency sorting.

    By default the heavy `certificates` array is excluded from each document —
    use the pre-computed cert_status / lsa_days / ffa_days / min_cert_days fields
    for all list-view rendering.  Pass ?include_certs=true only when you need
    the full cert objects (e.g. compliance detail panel after selecting a vessel).

    Recommended calls:
      • Sales / Ops  : ?has_port=true&limit=1000&sort_by=cert_urgency
      • Compliance   : ?has_certs=true&limit=1000&sort_by=cert_urgency
      • Notifications: ?limit=200  (top 200 most urgent, cert_status + lsa_days sufficient)
    """
    col = get_vessels_col()
    flt: dict = {}

    if search:
        flt['$or'] = [
            {'name': {'$regex': search, '$options': 'i'}},
            {'imo':  {'$regex': search, '$options': 'i'}},
        ]
    if flag:
        flt['flag']         = {'$regex': flag,         '$options': 'i'}
    if vessel_type:
        flt['vessel_type']  = {'$regex': vessel_type,  '$options': 'i'}
    if class_society:
        flt['class_society']= {'$regex': class_society,'$options': 'i'}
    if ship_manager:
        flt['ship_manager'] = {'$regex': ship_manager, '$options': 'i'}
    if ship_owner:
        flt['ship_owner']   = {'$regex': ship_owner,   '$options': 'i'}
    if port:
        flt['port']         = {'$regex': port,          '$options': 'i'}
    if has_port is True:
        flt['port']         = {'$type': 2, '$ne': ''}   # non-empty string
    if has_certs is True:
        flt['certificates'] = {'$exists': True, '$ne': []}

    skip = (page - 1) * limit

    # ── Sort strategy ──────────────────────────────────────────────────────
    if sort_by == 'cert_urgency':
        sort_key = [('min_cert_days', 1)]
    elif sort_by == 'port':
        sort_key = [('port', 1), ('min_cert_days', 1)]
    else:  # name
        sort_key = [('name', 1)]

    # ── Projection: strip certificates by default (major payload reduction) ──
    projection = None if include_certs else {'certificates': 0}

    # batch_size=500 streams results in chunks — avoids huge driver-side buffers for 10k+ queries
    cursor  = col.find(flt, projection).sort(sort_key).skip(skip).limit(limit).batch_size(500)
    vessels = [_clean(doc) async for doc in cursor]
    return {'page': page, 'limit': limit, 'count': len(vessels), 'data': vessels}


@router.get('/flags')
async def get_flags(_=Depends(get_current_user)):
    col   = get_vessels_col()
    flags = await col.distinct('flag')
    return sorted([f for f in flags if f])


@router.get('/types')
async def get_types(_=Depends(get_current_user)):
    col   = get_vessels_col()
    types = await col.distinct('vessel_type')
    return sorted([t for t in types if t])


@router.get('/{imo}')
async def get_vessel(imo: str, _=Depends(get_current_user)):
    col = get_vessels_col()
    doc = await col.find_one({'imo': imo})
    if not doc:
        # fallback to scrapper_data
        doc = await get_scrapper_col().find_one({'imo': imo})
    if not doc:
        raise HTTPException(status_code=404, detail='Vessel not found')

    # If no position cached, try a live GreenHyla lookup (transparent enrichment)
    doc = await _enrich_position_from_gh(imo, col, doc)
    return _clean(doc)


@router.get('/{imo}/position')
async def get_vessel_position(imo: str, _=Depends(get_current_user)):
    col = get_vessels_col()
    doc = await col.find_one(
        {'imo': imo},
        {'lat': 1, 'lon': 1, 'speed': 1, 'course': 1, 'nav_status': 1,
         'port': 1, 'geofence_name': 1, 'geofence_flag': 1,
         'destination': 1, 'last_ais_update': 1, 'name': 1, 'imo': 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail='Vessel not found')

    # Auto-enrich from GreenHyla if no position cached
    doc = await _enrich_position_from_gh(imo, col, doc)
    doc['_id'] = str(doc.get('_id', ''))
    return doc


def _sanitize(obj):
    """Recursively replace bytes values with a latin-1 decoded string so the
    JSON encoder never hits a UnicodeDecodeError on non-UTF-8 binary fields."""
    if isinstance(obj, bytes):
        try:
            return obj.decode('utf-8')
        except UnicodeDecodeError:
            return obj.decode('latin-1')
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    return obj


@router.get('/{imo}/certificates')
async def get_vessel_certificates(imo: str, _=Depends(get_current_user)):
    col = get_vessels_col()
    doc = await col.find_one({'imo': imo}, {'certificates': 1, 'imo': 1, 'name': 1})
    if not doc:
        raise HTTPException(status_code=404, detail='Vessel not found')
    return {'imo': imo, 'certificates': _sanitize(doc.get('certificates', []))}
