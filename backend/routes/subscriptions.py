from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
from services import greenhyla_api
from db.connection import get_subscriptions_col
from routes.auth import get_current_user

router = APIRouter(prefix='/api/subscriptions', tags=['Subscriptions'])


class VesselSubRequest(BaseModel):
    imos: List[str]


class PortSubRequest(BaseModel):
    unlocodes: List[str]


class BulkSubRequest(BaseModel):
    imos: Optional[List[str]] = None
    unlocodes: Optional[List[str]] = None


class IntervalsRequest(BaseModel):
    inportMinutes: int
    terrestrialMinutes: int
    satelliteMinutes: int


class StatusRequest(BaseModel):
    status: str  # 'active' | 'paused'


@router.get('')
async def get_subscriptions(_=Depends(get_current_user)):
    try:
        data = await greenhyla_api.get_subscriptions()
        # cache locally
        col = get_subscriptions_col()
        await col.update_one({'_key': 'current'}, {'$set': {'data': data, '_key': 'current'}}, upsert=True)
        return data
    except Exception as e:
        # return cached if API fails
        col = get_subscriptions_col()
        cached = await col.find_one({'_key': 'current'})
        if cached:
            return cached.get('data', {})
        raise HTTPException(status_code=502, detail=f'GreenHyla API error: {e}')


@router.post('/vessels')
async def subscribe_vessels(body: VesselSubRequest, _=Depends(get_current_user)):
    try:
        return await greenhyla_api.subscribe_vessels(body.imos)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post('/ports')
async def subscribe_ports(body: PortSubRequest, _=Depends(get_current_user)):
    try:
        return await greenhyla_api.subscribe_ports(body.unlocodes)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post('/bulk')
async def bulk_subscribe(body: BulkSubRequest, _=Depends(get_current_user)):
    try:
        payload = {}
        if body.imos:
            payload['imos'] = body.imos
        if body.unlocodes:
            payload['unlocodes'] = body.unlocodes
        return await greenhyla_api.bulk_subscribe(payload)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.patch('/intervals')
async def update_intervals(body: IntervalsRequest, _=Depends(get_current_user)):
    try:
        return await greenhyla_api.update_intervals(body.model_dump())
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.patch('/status')
async def update_status(body: StatusRequest, _=Depends(get_current_user)):
    try:
        return await greenhyla_api.update_subscription_status({'status': body.status})
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.patch('/remove-vessels')
async def remove_vessels(body: VesselSubRequest, _=Depends(get_current_user)):
    try:
        return await greenhyla_api.remove_vessels(body.imos)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.patch('/remove-ports')
async def remove_ports(body: PortSubRequest, _=Depends(get_current_user)):
    try:
        return await greenhyla_api.remove_ports(body.unlocodes)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
