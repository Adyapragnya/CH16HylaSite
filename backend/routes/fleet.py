from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from db.connection import get_vessels_col, get_events_col
from routes.auth import get_current_user

router = APIRouter(prefix='/api/fleet', tags=['Fleet'])


@router.get('/stats')
async def fleet_stats(_=Depends(get_current_user)):
    col = get_vessels_col()
    total = await col.count_documents({})
    with_position = await col.count_documents({'lat': {'$ne': None}, 'lon': {'$ne': None}})
    underway = await col.count_documents({'speed': {'$gt': 0.5}})
    at_anchor = await col.count_documents({'speed': {'$lte': 0.5}, 'lat': {'$ne': None}})

    # Certificate counts
    now = datetime.now(timezone.utc)
    in_30 = now + timedelta(days=30)
    in_90 = now + timedelta(days=90)

    # Count vessels with expiring/expired certs via aggregation
    pipeline = [
        {'$unwind': {'path': '$certificates', 'preserveNullAndEmptyArrays': False}},
        {'$group': {
            '_id': None,
            'total_certs': {'$sum': 1},
        }},
    ]
    agg = await col.aggregate(pipeline).to_list(1)
    total_certs = agg[0]['total_certs'] if agg else 0

    return {
        'total_vessels': total,
        'with_ais_position': with_position,
        'underway': underway,
        'at_anchor': at_anchor,
        'total_certificates': total_certs,
    }


@router.get('/breakdown')
async def fleet_breakdown(_=Depends(get_current_user)):
    col = get_vessels_col()

    # By vessel type
    type_pipeline = [
        {'$group': {'_id': '$vessel_type', 'count': {'$sum': 1}}},
        {'$sort': {'count': -1}},
        {'$limit': 10},
    ]
    type_agg = await col.aggregate(type_pipeline).to_list(10)

    # By flag
    flag_pipeline = [
        {'$group': {'_id': '$flag', 'count': {'$sum': 1}}},
        {'$sort': {'count': -1}},
        {'$limit': 10},
    ]
    flag_agg = await col.aggregate(flag_pipeline).to_list(10)

    # By class society
    society_pipeline = [
        {'$group': {'_id': '$class_society', 'count': {'$sum': 1}}},
        {'$sort': {'count': -1}},
    ]
    society_agg = await col.aggregate(society_pipeline).to_list(20)

    return {
        'by_type': [{'label': d['_id'] or 'Unknown', 'count': d['count']} for d in type_agg],
        'by_flag': [{'label': d['_id'] or 'Unknown', 'count': d['count']} for d in flag_agg],
        'by_society': [{'label': d['_id'] or 'Unknown', 'count': d['count']} for d in society_agg],
    }


@router.get('/positions')
async def fleet_positions(_=Depends(get_current_user)):
    """Return lat/lon for all vessels with AIS positions for map display."""
    col = get_vessels_col()
    cursor = col.find(
        {'lat': {'$ne': None}, 'lon': {'$ne': None}},
        {'imo': 1, 'name': 1, 'lat': 1, 'lon': 1, 'speed': 1, 'flag': 1,
         'vessel_type': 1, 'destination': 1, 'nav_status': 1},
    )
    items = []
    async for doc in cursor:
        doc['_id'] = str(doc.get('_id', ''))
        items.append(doc)
    return {'data': items, 'count': len(items)}
