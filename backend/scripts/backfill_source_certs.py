"""
Backfill certificates from ch16_dev.moloobhoy_fleet.json into source collections.

Writes the transformed cert array (plus computed cert fields) into:
  - HylaTrial.ScrapperData   (matched by imo)
  - HylaAnalytics2.vessels   (matched by imo_number OR imo)

Uses $set only on cert fields — never touches other fields in these collections.
After this runs, the regular sync will propagate certs into CH16db.vessels
automatically on every cycle, so no further one-shot imports are needed.

Run from backend/ directory:
  python scripts/backfill_source_certs.py [path/to/file.json]
"""

import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
for _env_candidate in Path(__file__).resolve().parents:
    _env_file = _env_candidate / ".env"
    if _env_file.exists():
        load_dotenv(_env_file)
        break

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import UpdateOne

MONGO_URI       = os.getenv("MONGO_URI")
HYLATRIAL_DB    = os.getenv("HYLATRIAL_DB", "HylaTrial")
HYLA_ANALYTICS2 = os.getenv("HYLA_ANALYTICS2_DB", "HylaAnalytics2")
JSON_PATH       = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\adyap\Downloads\ch16_dev.moloobhoy_fleet.json"
BATCH_SIZE      = 500

_LSA_KW = {"LSA", "LSAF", "LIFE SAVING", "LIFESAVING", "LIFE-SAVING"}
_FFA_KW = {"FFA", "FFAF", "FIRE FIGHT", "FIREFIGHT", "FIRE FIGHTING", "FIREFIGHTING", "FIRE-FIGHT"}


def _now():
    return datetime.now(timezone.utc)


def _min_cert_days(certificates: list):
    best = None
    now = _now()
    for c in certificates or []:
        d = c.get("days_remaining")
        if d is None:
            exp = c.get("expiry_date") or c.get("expiryDate")
            if exp:
                try:
                    d = (datetime.fromisoformat(str(exp).replace("Z", "+00:00")) - now).days
                except Exception:
                    pass
        if d is not None:
            best = d if best is None else min(best, d)
    return best


def _cert_extras(certificates: list) -> dict:
    min_days = _min_cert_days(certificates)
    if min_days is None:        status = "none"
    elif min_days < 0:          status = "expired"
    elif min_days < 20:         status = "critical"
    elif min_days < 60:         status = "warning"
    else:                       status = "valid"

    lsa_days = ffa_days = None
    for c in certificates or []:
        t = (c.get("cert_type") or c.get("type") or c.get("name") or "").upper()
        is_lsa = any(k in t for k in _LSA_KW)
        is_ffa = any(k in t for k in _FFA_KW)
        if is_lsa or is_ffa:
            d = _min_cert_days([c])
            if is_lsa and d is not None:
                lsa_days = d if lsa_days is None else min(lsa_days, d)
            if is_ffa and d is not None:
                ffa_days = d if ffa_days is None else min(ffa_days, d)

    return {"cert_status": status, "lsa_days": lsa_days, "ffa_days": ffa_days}


def _transform_certificates(enr_certs: list) -> list:
    out = []
    for c in enr_certs or []:
        raw = c.get("raw") or {}
        cert = {
            "cert_type":         c.get("certificate_name") or c.get("certificate_type"),
            "cert_no":           raw.get("certificate_number"),
            "issue_date":        c.get("issue_date"),
            "expiry_date":       c.get("expiry_date"),
            "issuing_authority": c.get("issuing_office") or raw.get("issued_by") or raw.get("flag_name"),
            "status":            raw.get("certificate_state") or c.get("status"),
            "service_type":      raw.get("service_type"),
            "source":            c.get("source", "abs"),
        }
        cert = {k: v for k, v in cert.items() if v is not None}
        out.append(cert)
    return out


def _build_cert_payload(certs: list) -> dict:
    """Build the $set payload for cert fields only."""
    payload = {
        "certificates":  certs,
        "min_cert_days": _min_cert_days(certs),
        "cert_status":   _cert_extras(certs)["cert_status"],
        "lsa_days":      _cert_extras(certs).get("lsa_days"),
        "ffa_days":      _cert_extras(certs).get("ffa_days"),
    }
    return {k: v for k, v in payload.items() if v is not None}


async def _flush(col, ops, label):
    if not ops:
        return
    result = await col.bulk_write(ops, ordered=False)
    print(f"  [{label}] matched:{result.matched_count}  modified:{result.modified_count}")


async def run_backfill():
    if not MONGO_URI:
        print("ERROR: MONGO_URI not set in .env")
        sys.exit(1)

    print(f"Reading {JSON_PATH} …")
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    print(f"  Loaded {len(data)} documents")

    client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=10_000)
    scrapper_col   = client[HYLATRIAL_DB]["ScrapperData"]
    analytics_col  = client[HYLA_ANALYTICS2]["vessels"]

    scrapper_ops  = []
    analytics_ops = []
    skipped = 0
    vessels_with_certs = 0

    for doc in data:
        imo = str(doc.get("imo", "")).strip()
        if not imo:
            skipped += 1
            continue

        enrichment = doc.get("enrichment") or {}
        raw_certs  = enrichment.get("certificates", [])
        if not raw_certs:
            continue

        certs = _transform_certificates(raw_certs)
        if not certs:
            continue

        vessels_with_certs += 1
        payload = _build_cert_payload(certs)

        # HylaTrial.ScrapperData — keyed by imo
        scrapper_ops.append(
            UpdateOne({"imo": imo}, {"$set": payload})
        )

        # HylaAnalytics2.vessels — may use imo_number or imo as the key
        analytics_ops.append(
            UpdateOne(
                {"$or": [{"imo_number": imo}, {"imo": imo}]},
                {"$set": payload}
            )
        )

        if len(scrapper_ops) >= BATCH_SIZE:
            await _flush(scrapper_col,  scrapper_ops,  "HylaTrial.ScrapperData")
            await _flush(analytics_col, analytics_ops, "HylaAnalytics2.vessels")
            scrapper_ops  = []
            analytics_ops = []

    # Final batch
    await _flush(scrapper_col,  scrapper_ops,  "HylaTrial.ScrapperData")
    await _flush(analytics_col, analytics_ops, "HylaAnalytics2.vessels")

    client.close()
    print(f"\nDone.  vessels_with_certs={vessels_with_certs}  skipped={skipped}")
    print("The sync will now propagate these certs to CH16db.vessels automatically.")


if __name__ == "__main__":
    asyncio.run(run_backfill())
