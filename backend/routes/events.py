from fastapi import APIRouter, Query, Depends
from typing import Optional
from db.connection import get_events_col
from routes.auth import get_current_user

router = APIRouter(prefix='/api/events', tags=['Events'])


def _clean(doc):
    doc['_id'] = str(doc.get('_id', ''))
    return doc


@router.get('')
async def list_events(
    event_type: Optional[str] = Query(None, description='Filter by event type e.g. geofence.entry'),
    imo: Optional[str] = Query(None),
    locode: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    _=Depends(get_current_user),
):
    col = get_events_col()
    flt = {}
    if event_type:
        flt['event'] = event_type
    if imo:
        flt['imo'] = imo
    if locode:
        flt['locode'] = locode

    total = await col.count_documents(flt)
    cursor = col.find(flt).sort('synced_at', -1).skip((page - 1) * limit).limit(limit)
    events = [_clean(doc) async for doc in cursor]
    return {'total': total, 'page': page, 'limit': limit, 'data': events}


@router.get('/types')
async def event_types(_=Depends(get_current_user)):
    col = get_events_col()
    types = await col.distinct('event')
    return sorted([t for t in types if t])
