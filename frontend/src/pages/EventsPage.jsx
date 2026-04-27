import { useState, useEffect, useCallback } from 'react'
import { Activity, Search, Filter, ChevronLeft, ChevronRight, Ship, MapPin, X } from 'lucide-react'
import { eventAPI } from '../lib/api'

const EVENT_TYPE_COLORS = {
  'geofence.entry':  'badge-teal',
  'geofence.exit':   'badge-orange',
  'geofence.switch': 'badge-blue',
  'vessel.alert':    'badge-expiring',
}

function EventTypeBadge({ type }) {
  const cls = EVENT_TYPE_COLORS[type] || 'badge-gray'
  return <span className={`badge ${cls}`}>{type || 'unknown'}</span>
}

export default function EventsPage() {
  const [events,     setEvents]     = useState([])
  const [total,      setTotal]      = useState(0)
  const [page,       setPage]       = useState(1)
  const [loading,    setLoading]    = useState(false)
  const [eventTypes, setEventTypes] = useState([])
  const [filterType, setFilterType] = useState('')
  const [filterImo,  setFilterImo]  = useState('')
  const LIMIT = 50

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, limit: LIMIT }
      if (filterType) params.event_type = filterType
      if (filterImo)  params.imo        = filterImo
      const r = await eventAPI.list(params)
      setEvents(r.data.data || [])
      setTotal(r.data.total || 0)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [page, filterType, filterImo])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    eventAPI.types().then(r => setEventTypes(r.data || [])).catch(() => {})
  }, [])

  const totalPages  = Math.ceil(total / LIMIT)
  const clearFilters = () => { setFilterType(''); setFilterImo(''); setPage(1) }

  return (
    <div className="fade-in">
      <div className="page-header flex items-center justify-between">
        <div>
          <h1 className="page-title">Events</h1>
          <p className="page-subtitle">Geofence entries, exits, and vessel alerts from GreenHyla API</p>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <div className="input-icon-wrapper" style={{ flex:'1 1 180px' }}>
          <Ship size={15} className="icon" />
          <input className="input input-with-icon" placeholder="Filter by IMO…"
            value={filterImo} onChange={e => { setFilterImo(e.target.value); setPage(1) }} />
        </div>
        <select className="select" style={{ flex:'0 0 200px' }} value={filterType}
          onChange={e => { setFilterType(e.target.value); setPage(1) }}>
          <option value="">All Event Types</option>
          {eventTypes.map(t => <option key={t} value={t}>{t}</option>)}
          {!eventTypes.length && [
            'geofence.entry','geofence.exit','geofence.switch','vessel.alert'
          ].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {(filterType || filterImo) && (
          <button onClick={clearFilters} className="btn btn-ghost btn-sm">
            <X size={14}/> Clear
          </button>
        )}
      </div>

      <div className="card" style={{ padding:0 }}>
        {loading ? (
          <div className="flex items-center justify-center" style={{ padding:'3rem' }}>
            <div className="spinner spinner-lg" />
          </div>
        ) : events.length ? (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Event Type</th>
                  <th>Vessel IMO</th>
                  <th>Port / Geofence</th>
                  <th>Geofence Type</th>
                  <th>Time</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev, i) => (
                  <tr key={ev._id || i}>
                    <td><EventTypeBadge type={ev.event || ev.eventType || ev.type} /></td>
                    <td>
                      <span className="font-mono" style={{ fontSize:'0.8rem', color:'#374151' }}>
                        {ev.imo || ev.IMO || '—'}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <MapPin size={12} color="#0d9488" />
                        <span style={{ fontSize:'0.875rem' }}>{ev.geofence?.port || ev.geofence?.name || ev.port || ev.locode || '—'}</span>
                      </div>
                    </td>
                    <td>
                      {(ev.geofence?.geofenceType || ev.geofenceType)
                        ? <span className="badge badge-gray">{ev.geofence?.geofenceType || ev.geofenceType}</span>
                        : <span style={{ color:'#9ca3af', fontSize:'0.8rem' }}>—</span>
                      }
                    </td>
                    <td>
                      <span style={{ fontSize:'0.8rem', color:'#6b7280' }}>
                        {ev.timestamp || ev.ts || ev.synced_at
                          ? new Date(ev.timestamp || ev.ts || ev.synced_at).toLocaleString()
                          : '—'
                        }
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize:'0.78rem', color:'#9ca3af', maxWidth:'200px', display:'block' }}
                        className="truncate">
                        {ev.message || ev.detail || ev.description || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <Activity size={40} className="empty-state-icon" />
            <p style={{ fontWeight:500 }}>No events found</p>
            <p style={{ fontSize:'0.875rem' }}>Events appear when subscribed vessels enter/exit port geofences</p>
          </div>
        )}

        {totalPages > 1 && (
          <div className="pagination" style={{ padding:'0.75rem 1rem', borderTop:'1px solid #f3f4f6' }}>
            <span className="page-info">Page {page} of {totalPages} · {total.toLocaleString()} events</span>
            <button className="page-btn" onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1}>
              <ChevronLeft size={14}/>
            </button>
            <button className="page-btn" onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages}>
              <ChevronRight size={14}/>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
