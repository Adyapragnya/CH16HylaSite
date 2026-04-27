from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime


class Certificate(BaseModel):
    cert_type: Optional[str] = None
    cert_no: Optional[str] = None
    issue_date: Optional[str] = None
    expiry_date: Optional[str] = None
    issuing_authority: Optional[str] = None
    status: Optional[str] = None


class Vessel(BaseModel):
    imo: str
    name: Optional[str] = None
    mmsi: Optional[str] = None
    callsign: Optional[str] = None
    flag: Optional[str] = None
    vessel_type: Optional[str] = None
    spire_type: Optional[str] = None
    gross_tonnage: Optional[float] = None
    dwt: Optional[float] = None
    loa: Optional[float] = None
    beam: Optional[float] = None
    max_draft: Optional[float] = None
    year_built: Optional[int] = None
    ship_owner: Optional[str] = None
    ship_manager: Optional[str] = None
    class_society: Optional[str] = None
    class_status: Optional[str] = None
    certificates: List[Any] = []
    # AIS live data
    lat: Optional[float] = None
    lon: Optional[float] = None
    speed: Optional[float] = None
    course: Optional[float] = None
    destination: Optional[str] = None
    eta: Optional[str] = None
    nav_status: Optional[str] = None
    last_ais_update: Optional[datetime] = None
    # port
    port: Optional[str] = None
    locode: Optional[str] = None
    berth: Optional[str] = None
    # service types
    service_types: List[str] = []
    source: Optional[str] = None
    scraped_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class VesselListItem(BaseModel):
    imo: str
    name: Optional[str] = None
    flag: Optional[str] = None
    vessel_type: Optional[str] = None
    speed: Optional[float] = None
    destination: Optional[str] = None
    port: Optional[str] = None
    class_society: Optional[str] = None
    cert_count: int = 0
    expiring_certs: int = 0
    expired_certs: int = 0
    last_ais_update: Optional[datetime] = None
