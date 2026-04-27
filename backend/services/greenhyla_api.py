"""
GreenHyla external API client.

Confirmed working endpoints (base = GREENHYLA_API_URL):
  GET  /subscriptions                  -> {status, imos:[...]}
  GET  /events?imo=<csv>&limit=<n>     -> {items:[...], limit, nextAfter}
  POST /subscriptions/vessels          -> subscribe IMOs
  POST /subscriptions/ports            -> subscribe UNLOCODEs
  POST /subscriptions/bulk             -> bulk subscribe
  PATCH /subscriptions/remove-vessels  -> unsubscribe IMOs
  PATCH /subscriptions/remove-ports    -> unsubscribe UNLOCODEs
  PATCH /subscriptions/intervals       -> update sync intervals
  PATCH /subscriptions/status          -> activate / pause

NOTE: GET /vessels does NOT exist — position data comes through /events.
      /events requires ?imo= or ?locode= (otherwise 400 IMO_OR_LOCODE_REQUIRED).
      Multiple IMOs can be passed as comma-separated values: ?imo=1234,5678,9012
"""
import os
import httpx
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))

BASE_URL = os.getenv('GREENHYLA_API_URL', 'https://app.greenhyla.com/auth/api/v1/external')
API_KEY  = os.getenv('GREENHYLA_API_KEY', '')


def _headers():
    return {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
    }


async def get_subscriptions() -> dict:
    """Returns {status: str, imos: [int, ...]}"""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f'{BASE_URL}/subscriptions', headers=_headers())
        r.raise_for_status()
        return r.json()


async def get_events(imo_list: list[str], limit: int = 200, after: str = None) -> dict:
    """
    Fetch events for a list of IMOs.
    Returns {items: [...], limit: int, nextAfter: str}

    Each item:
      {imo, vesselName, timestamp, event ('geofence.entry'|'geofence.exit'),
       position: {lat, lng, course, speed},
       geofence: {name, geofenceType, port}}

    Pass after= (ISO timestamp) to page forward; use nextAfter from previous response.
    """
    if not imo_list:
        return {'items': [], 'limit': limit, 'nextAfter': None}

    params = {
        'imo':   ','.join(str(i) for i in imo_list),
        'limit': limit,
    }
    if after:
        params['after'] = after

    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.get(f'{BASE_URL}/events', headers=_headers(), params=params)
        r.raise_for_status()
        return r.json()


async def subscribe_vessels(imo_list: list[str]) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f'{BASE_URL}/subscriptions/vessels',
            headers=_headers(),
            json={'imos': imo_list},
        )
        r.raise_for_status()
        return r.json()


async def subscribe_ports(unlocodes: list[str]) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f'{BASE_URL}/subscriptions/ports',
            headers=_headers(),
            json={'unlocodes': unlocodes},
        )
        r.raise_for_status()
        return r.json()


async def bulk_subscribe(payload: dict) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f'{BASE_URL}/subscriptions/bulk',
            headers=_headers(),
            json=payload,
        )
        r.raise_for_status()
        return r.json()


async def remove_vessels(imo_list: list[str]) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.patch(
            f'{BASE_URL}/subscriptions/remove-vessels',
            headers=_headers(),
            json={'imos': imo_list},
        )
        r.raise_for_status()
        return r.json()


async def remove_ports(unlocodes: list[str]) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.patch(
            f'{BASE_URL}/subscriptions/remove-ports',
            headers=_headers(),
            json={'unlocodes': unlocodes},
        )
        r.raise_for_status()
        return r.json()


async def update_intervals(payload: dict) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.patch(
            f'{BASE_URL}/subscriptions/intervals',
            headers=_headers(),
            json=payload,
        )
        r.raise_for_status()
        return r.json()


async def update_subscription_status(payload: dict) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.patch(
            f'{BASE_URL}/subscriptions/status',
            headers=_headers(),
            json=payload,
        )
        r.raise_for_status()
        return r.json()
