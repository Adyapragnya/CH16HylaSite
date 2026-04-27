# CH16Hyla — Ch16.ai | AS Moloobhoy
### LSA/FFA Service Intelligence Portal

---

## Stack
- **Frontend**: React 18 + Vite (design matches ch16-asmoloobhoy exactly)
- **Backend API**: FastAPI (Python) — port 8000
- **Scheduler**: Flask + APScheduler (Python) — port 5001
- **Database**: MongoDB CH16db (your cluster at 31.187.76.110)

---

## Setup

### 1. Configure `.env`
Edit `.env` in the root and set your GreenHyla API key:
```
GREENHYLA_API_KEY=your_actual_api_key_here
```
The MongoDB URI and other settings are already configured.

### 2. Backend (FastAPI)
```bash
cd backend
pip install -r requirements.txt
python main.py
# Runs on http://localhost:8000
# API docs: http://localhost:8000/docs
```

### 3. Scheduler (Flask + APScheduler)
```bash
cd scheduler
pip install -r requirements.txt
python app.py
# Runs on http://localhost:5001
# Syncs data every 5 minutes automatically
```

### 4. Frontend (React)
```bash
cd frontend
npm install
npm run dev
# Runs on http://localhost:3000
```

---

## Data Flow

```
HylaTrial.ScrapperData   ─┐
HylaTrial.vessel_master   ├──► FastAPI startup sync ──► CH16db.vessels
HylaAnalytics2.vessels   ─┘
HylaAnalytics2.users     ────► CH16db.users

GreenHyla API (every 5 min) ─► AIS positions ──► CH16db.vessels
GreenHyla API (every 5 min) ─► Events ──────────► CH16db.events

Frontend ──► FastAPI ──► CH16db (read/write)
```

---

## Pages

| Page | Route | Description |
|------|-------|-------------|
| Login | `/login` | Auth with HylaAnalytics2 users |
| Dashboard | `/` | Fleet stats, charts, vessel list |
| Vessels | `/vessels` | Search/filter all vessels |
| Vessel Detail | `/vessels/:imo` | Certificates, AIS, particulars |
| Events | `/events` | Geofence entry/exit events |
| Subscriptions | `/subscriptions` | Manage GreenHyla subscriptions |

---

## API Endpoints

```
POST /api/auth/login          Login
GET  /api/auth/me             Current user

GET  /api/vessels             List vessels (search, flag, type, page)
GET  /api/vessels/:imo        Vessel detail
GET  /api/vessels/:imo/certificates  Certificates
GET  /api/vessels/:imo/position      AIS position

GET  /api/fleet/stats         Fleet statistics
GET  /api/fleet/breakdown     Type/flag/society breakdown
GET  /api/fleet/positions     All vessel lat/lon for map

GET  /api/subscriptions       Current subscription (from GreenHyla)
POST /api/subscriptions/vessels   Subscribe vessel IMOs
POST /api/subscriptions/ports     Subscribe port UNLOCODEs
PATCH /api/subscriptions/intervals  Update polling intervals
PATCH /api/subscriptions/status     Pause/resume
PATCH /api/subscriptions/remove-vessels
PATCH /api/subscriptions/remove-ports

GET  /api/events              List geofence/alert events
POST /api/sync/trigger        Manual data sync
GET  /api/sync/logs           Sync history
```

---

## Scheduler Endpoints

```
GET  /health          Status check
POST /sync/trigger    Manual trigger (same as backend)
GET  /sync/jobs       APScheduler job list
GET  /sync/logs       Sync log from CH16db
```

---

## Login Credentials
Uses existing users from **HylaAnalytics2.users**:
- Username: `hyla` / Password: (bcrypt hash stored in DB)
- Or use email: `admin@hylapps.com`
