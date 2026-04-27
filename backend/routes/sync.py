import asyncio
import logging

from fastapi import APIRouter, Depends
from db.connection import get_sync_log_col
from routes.auth import get_current_user
from services.data_sync import run_full_sync

router = APIRouter(prefix='/api/sync', tags=['Sync'])
log = logging.getLogger(__name__)


@router.post('/trigger')
async def trigger_sync(_=Depends(get_current_user)):
    """
    Kick off a full sync as a real asyncio task (not a Starlette BackgroundTask).
    This decouples the sync from the HTTP request lifecycle so that server
    reload / Ctrl+C cannot propagate CancelledError through the response layer.
    """
    async def _safe_sync():
        try:
            await run_full_sync()
        except asyncio.CancelledError:
            log.info('Manual sync trigger cancelled (server shutdown)')
        except Exception as exc:
            log.error('Manual sync trigger failed: %s', exc)

    asyncio.create_task(_safe_sync())
    return {'status': 'sync_started', 'message': 'Full sync triggered in background'}


@router.get('/logs')
async def sync_logs(limit: int = 10, _=Depends(get_current_user)):
    col = get_sync_log_col()
    cursor = col.find({}).sort('ts', -1).limit(limit)
    logs = []
    async for doc in cursor:
        doc['_id'] = str(doc.get('_id', ''))
        if 'ts' in doc:
            doc['ts'] = str(doc['ts'])
        logs.append(doc)
    return {'data': logs}
