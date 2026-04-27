"""
CH16Hyla — FastAPI Backend
Maritime Intelligence Portal for AS Moloobhoy
"""
import os
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '../.env'))

from db.connection import get_client, close_client
from routes.auth          import router as auth_router
from routes.vessels       import router as vessels_router
from routes.fleet         import router as fleet_router
from routes.subscriptions import router as subs_router
from routes.events        import router as events_router
from routes.sync          import router as sync_router
from services.scheduler   import create_scheduler

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

from services.rate_limit import limiter  # shared rate limiter instance


# ── Security headers middleware ───────────────────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers.update({
            'X-Content-Type-Options':  'nosniff',
            'X-Frame-Options':         'DENY',
            'X-XSS-Protection':        '1; mode=block',
            'Referrer-Policy':         'strict-origin-when-cross-origin',
            'Permissions-Policy':      'geolocation=(), microphone=(), camera=()',
            'X-Permitted-Cross-Domain-Policies': 'none',
        })
        return response


async def _ensure_indexes():
    """
    Create MongoDB indexes for the vessels collection.
    Runs at startup in the background — safe to call repeatedly (idempotent).
    Critical for sub-second query performance at millions of vessels.
    """
    try:
        from db.connection import get_vessels_col, get_events_col, get_scrapper_col
        from pymongo import ASCENDING, DESCENDING, TEXT

        vcol = get_vessels_col()
        # Single-field indexes
        await vcol.create_index([("imo",           ASCENDING)], unique=True,  background=True)
        await vcol.create_index([("port",          ASCENDING)],               background=True)
        await vcol.create_index([("min_cert_days", ASCENDING)],               background=True)
        await vcol.create_index([("ship_manager",  ASCENDING)],               background=True)
        await vcol.create_index([("ship_owner",    ASCENDING)],               background=True)
        await vcol.create_index([("class_society", ASCENDING)],               background=True)
        await vcol.create_index([("vessel_type",   ASCENDING)],               background=True)
        await vcol.create_index([("flag",          ASCENDING)],               background=True)
        await vcol.create_index([("geofence_flag", ASCENDING)],               background=True)
        # Compound indexes for the most common dashboard query patterns
        await vcol.create_index([("port", ASCENDING), ("min_cert_days", ASCENDING)], background=True)
        await vcol.create_index([("min_cert_days", ASCENDING), ("port", ASCENDING)], background=True)
        # Text index for name/imo search
        await vcol.create_index([("name", TEXT), ("imo", TEXT)],              background=True)

        # Scrapper data collection
        scol = get_scrapper_col()
        await scol.create_index([("imo", ASCENDING)], unique=True, background=True)
        await scol.create_index([("scraped_at", DESCENDING)], background=True)

        # Events collection
        ecol = get_events_col()
        await ecol.create_index([("event_id",  ASCENDING)], unique=True, background=True)
        await ecol.create_index([("imo",       ASCENDING)],              background=True)
        await ecol.create_index([("timestamp", DESCENDING)],             background=True)

        log.info('MongoDB indexes ensured for vessels + scrapper_data + events collections')
    except Exception as e:
        log.warning('Index creation warning (non-fatal): %s', e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────────
    try:
        client = get_client()
        await client.admin.command('ping')
        log.info('MongoDB connected → CH16db')
    except Exception as e:
        log.error('MongoDB connection FAILED: %s', e)
        raise

    # Reconcile legacy duplicates before creating unique IMO indexes.
    try:
        from services.data_sync import reconcile_portal_collections
        await reconcile_portal_collections()
    except Exception as e:
        log.warning('Portal reconciliation warning (non-fatal): %s', e)

    # Ensure indexes after reconciliation (fast, idempotent)
    await _ensure_indexes()

    # Start the cron scheduler (first run is delayed 30s to let startup finish)
    sched = create_scheduler()
    sched.start()
    log.info('Cron scheduler started — interval: %s min', os.getenv('CRON_INTERVAL_MINUTES', '5'))

    # Initial full sync in background — delayed 5s so the server is fully ready first
    async def _bg_sync():
        await asyncio.sleep(5)   # let uvicorn finish startup before hammering DB
        try:
            from services.data_sync import run_full_sync
            log.info('Running initial data sync (background)...')
            await run_full_sync()
        except asyncio.CancelledError:
            log.info('Initial sync cancelled (server reloading/shutting down)')
        except Exception as e:
            log.warning('Initial sync failed (non-fatal): %s', e)

    asyncio.create_task(_bg_sync())

    # ── Security checks at startup ─────────────────────────────────────────────
    jwt_secret = os.getenv('JWT_SECRET', '')
    if not jwt_secret or len(jwt_secret) < 32 or jwt_secret in (
        'ch16hyla-super-secret', 'ch16hyla-super-secret-key-change-in-production',
        'secret', 'changeme', 'password',
    ):
        log.critical('⚠️  SECURITY WARNING: JWT_SECRET is weak or default! '
                     'Set a strong random secret (32+ chars) in .env.')

    try:
        yield
    except asyncio.CancelledError:
        # Hot-reload / CTRL+C cancels the lifespan receive() — this is expected.
        # Swallow it here so Starlette doesn't log a spurious ERROR traceback.
        pass
    finally:
        # Always runs — whether clean shutdown, reload, or Ctrl+C
        sched.shutdown(wait=False)
        await close_client()
        log.info('Shutdown complete')


_debug = os.getenv('DEBUG', '').lower() in ('1', 'true', 'yes')

app = FastAPI(
    title='CH16Hyla API',
    description='Maritime Intelligence Portal — Ch16.ai | AS Moloobhoy',
    version='1.0.0',
    lifespan=lifespan,
    # Hide interactive docs in production — expose only in DEBUG mode
    docs_url  ='/docs'  if _debug else None,
    redoc_url ='/redoc' if _debug else None,
    openapi_url='/openapi.json' if _debug else None,
)

# Register rate limiter state + error handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Security headers — applied to every response
app.add_middleware(SecurityHeadersMiddleware)
# GZip — compress any response ≥ 500 bytes (cuts JSON payload 60-80%)
app.add_middleware(GZipMiddleware, minimum_size=500)

# CORS
_cors_env = os.getenv('CORS_ORIGINS', 'http://localhost:3000')
CORS_ORIGINS = _cors_env.split(',') if _cors_env.strip() != '*' else ['*']
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

# Routes
app.include_router(auth_router)
app.include_router(vessels_router)
app.include_router(fleet_router)
app.include_router(subs_router)
app.include_router(events_router)
app.include_router(sync_router)


@app.get('/')
async def root():
    return {
        'name':    'CH16Hyla API',
        'version': '1.0.0',
        'portal':  'Ch16.ai | AS Moloobhoy',
        'status':  'ok',
    }


@app.get('/health')
async def health():
    try:
        client = get_client()
        await client.admin.command('ping')
        return {'status': 'ok', 'db': 'connected'}
    except Exception as e:
        return {'status': 'error', 'detail': str(e)}


if __name__ == '__main__':
    import uvicorn
    port = int(os.getenv('BACKEND_PORT', 8000))
    uvicorn.run(
        'main:app',
        host='0.0.0.0',
        port=port,
        reload=True,
        # Only restart for actual Python source changes
        reload_includes=['*.py'],
        reload_excludes=[
            '*__pycache__*',
            '*.pyc',
            '*.pyo',
            'venv/*',
            '.env',
            '*.log',
            '*.txt',
            '*.json',
            '*.md',
        ],
        reload_dirs=['.'],      # only watch the backend/ directory
        reload_delay=1.5,       # debounce: wait 1.5s after last change before restarting
                                # (prevents chain-restarts when multiple files change at once)
    )
