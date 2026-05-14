"""
One-shot import: ch16_dev.moloobhoy_fleet.json → CH16db.vessels

What it does:
  - Reads the client JSON export (1 683 ships, 30 596 certs)
  - Transforms each doc to the CH16db.vessels schema
  - Converts enrichment.certificates → certificates[] (cert_type, cert_no,
    issue_date, expiry_date, issuing_authority, status)
  - Re-computes min_cert_days / cert_status / lsa_days / ffa_days
  - Bulk-upserts by IMO (upsert=True so existing docs are enriched, new ones
    are created)

Run from the backend/ directory:
  python scripts/import_moloobhoy_fleet.py [path/to/file.json]

Default JSON path: C:/Users/adyap/Downloads/ch16_dev.moloobhoy_fleet.json
"""

import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
# Walk up from script location to find the nearest .env
for _env_candidate in Path(__file__).resolve().parents:
    _env_file = _env_candidate / ".env"
    if _env_file.exists():
        load_dotenv(_env_file)
        break

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import UpdateOne

MONGO_URI   = os.getenv("MONGO_URI")
CH16_DB     = os.getenv("CH16_DB_NAME", "CH16db")
JSON_PATH   = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\adyap\Downloads\ch16_dev.moloobhoy_fleet.json"
BATCH_SIZE  = 500

_LSA_KW = {"LSA", "LSAF", "LIFE SAVING", "LIFESAVING", "LIFE-SAVING"}
_FFA_KW = {"FFA", "FFAF", "FIRE FIGHT", "FIREFIGHT", "FIRE FIGHTING", "FIREFIGHTING", "FIRE-FIGHT"}


def _now():
    return datetime.now(timezone.utc)


def _min_cert_days(certificates: list) -> int | None:
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
    if min_days is None:
        status = "none"
    elif min_days < 0:
        status = "expired"
    elif min_days < 20:
        status = "critical"
    elif min_days < 60:
        status = "warning"
    else:
        status = "valid"

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
    """Map enrichment.certificates[] → DB certificates[] schema."""
    out = []
    for c in enr_certs or []:
        raw = c.get("raw") or {}
        cert = {
            "cert_type":        c.get("certificate_name") or c.get("certificate_type"),
            "cert_no":          raw.get("certificate_number"),
            "issue_date":       c.get("issue_date"),
            "expiry_date":      c.get("expiry_date"),
            "issuing_authority": c.get("issuing_office") or raw.get("issued_by") or raw.get("flag_name"),
            "status":           raw.get("certificate_state") or c.get("status"),
            # extra context kept for display
            "service_type":     raw.get("service_type"),
            "source":           c.get("source", "abs"),
        }
        # Drop None values but keep empty strings only where meaningful
        cert = {k: v for k, v in cert.items() if v is not None}
        out.append(cert)
    return out


def _transform_doc(doc: dict) -> dict:
    """Build a CH16db.vessels update dict from a moloobhoy_fleet doc."""
    imo = str(doc.get("imo", "")).strip()
    if not imo:
        return {}

    enrichment = doc.get("enrichment") or {}
    raw        = enrichment.get("raw") or {}
    abs_id     = raw.get("abs_identification") or {}

    company_name = doc.get("company_name")
    company_role = (doc.get("company_role") or "").lower()

    # Certificates
    certs = _transform_certificates(enrichment.get("certificates", []))

    vessel = {
        "imo":              imo,
        "name":             doc.get("vessel_name"),
        "flag":             doc.get("current_flag"),
        "vessel_type":      doc.get("ship_type"),
        "gross_tonnage":    doc.get("gross_tonnage"),
        "year_built":       doc.get("year_of_build"),
        "class_society":    doc.get("current_class") or enrichment.get("society"),
        "callsign":         abs_id.get("call_sign"),
        "loa":              enrichment.get("loa"),
        "dwt":              enrichment.get("dwt"),
        "port_of_registry": abs_id.get("port_registry"),
        "class_status":     abs_id.get("lifecycle_status"),
        "source_file":      doc.get("source_file"),
        "certificates":     certs,
        "min_cert_days":    _min_cert_days(certs),
        **_cert_extras(certs),
        "source":           "moloobhoy_fleet",
        "synced_at":        _now(),
    }

    # Assign company to the right role field
    if company_name:
        if "manager" in company_role:
            vessel["ship_manager"] = company_name
        elif "owner" in company_role:
            vessel["ship_owner"] = company_name
        else:
            vessel["ship_manager"] = company_name   # default fallback

    return {k: v for k, v in vessel.items() if v is not None}


async def run_import():
    if not MONGO_URI:
        print("ERROR: MONGO_URI not set in .env")
        sys.exit(1)

    print(f"Reading {JSON_PATH} …")
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    print(f"  Loaded {len(data)} documents")

    client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=10_000)
    col    = client[CH16_DB]["vessels"]

    ops          = []
    skipped      = 0
    total_certs  = 0
    processed    = 0

    for doc in data:
        vessel = _transform_doc(doc)
        if not vessel.get("imo"):
            skipped += 1
            continue

        total_certs += len(vessel.get("certificates", []))
        ops.append(UpdateOne({"imo": vessel["imo"]}, {"$set": vessel}, upsert=True))
        processed += 1

        if len(ops) >= BATCH_SIZE:
            result = await col.bulk_write(ops, ordered=False)
            print(f"  Batch upserted — matched:{result.matched_count}  "
                  f"modified:{result.modified_count}  inserted:{result.upserted_count}")
            ops = []

    if ops:
        result = await col.bulk_write(ops, ordered=False)
        print(f"  Final batch — matched:{result.matched_count}  "
              f"modified:{result.modified_count}  inserted:{result.upserted_count}")

    client.close()
    print(f"\nDone.  processed={processed}  skipped={skipped}  "
          f"total_certs_imported={total_certs}")


if __name__ == "__main__":
    asyncio.run(run_import())
