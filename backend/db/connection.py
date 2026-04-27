import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))

MONGO_URI        = os.getenv('MONGO_URI')
CH16_DB_NAME     = os.getenv('CH16_DB_NAME', 'CH16db')
HYLATRIAL_DB     = os.getenv('HYLATRIAL_DB', 'HylaTrial')
HYLA_ANALYTICS2  = os.getenv('HYLA_ANALYTICS2_DB', 'HylaAnalytics2')

if not MONGO_URI:
    raise RuntimeError('MONGO_URI is not set in .env')

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(
            MONGO_URI,
            # Connection pool — enough headroom for parallel dashboard calls + cron
            maxPoolSize=50,
            minPoolSize=5,
            maxIdleTimeMS=60_000,          # recycle idle connections after 60s
            # Timeouts — fail fast, never hang forever
            serverSelectionTimeoutMS=10_000,  # give up finding a server after 10s
            connectTimeoutMS=10_000,           # TCP connect timeout
            socketTimeoutMS=30_000,            # per-operation timeout (30s)
            # Retry on transient errors (network blip, primary failover)
            retryWrites=True,
            retryReads=True,
        )
    return _client


# ── CH16db (read/write) ───────────────────────────────────────────────────────
def get_ch16_db():
    return get_client()[CH16_DB_NAME]

def get_vessels_col():
    return get_ch16_db()['vessels']

def get_users_col():
    return get_ch16_db()['users']

def get_events_col():
    return get_ch16_db()['events']

def get_subscriptions_col():
    return get_ch16_db()['subscriptions']

def get_scrapper_col():
    return get_ch16_db()['scrapper_data']

def get_sync_log_col():
    return get_ch16_db()['sync_log']


# ── HylaTrial (READ-ONLY) ─────────────────────────────────────────────────────
def get_hylatrial_db():
    return get_client()[HYLATRIAL_DB]

def get_scrapper_data_src():
    return get_hylatrial_db()['ScrapperData']

def get_vessel_master_src():
    return get_hylatrial_db()['vessel_master']

def get_tracked_vessels_src():
    return get_hylatrial_db()['vesselstrackeds']


# ── HylaAnalytics2 (READ-ONLY) ────────────────────────────────────────────────
def get_hyla_analytics2_db():
    return get_client()[HYLA_ANALYTICS2]

def get_users_src():
    return get_hyla_analytics2_db()['users']

def get_vessels_src():
    return get_hyla_analytics2_db()['vessels']


async def close_client():
    global _client
    if _client:
        _client.close()
        _client = None
