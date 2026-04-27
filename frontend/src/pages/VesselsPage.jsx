import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ship, Search, Filter, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { vesselAPI } from '../lib/api'

function CertBadge({ count, type }) {
  if (!count) return null
  const cls = { valid:'badge-valid', expiring:'badge-expiring', expired:'badge-expired' }[type] || 'badge-gray'
  return <span className={`badge ${cls}`}>{count}</span>
}

export default function VesselsPage() {
  const navigate = useNavigate()
  const [vessels,  setVessels]  = useState([])
  const [total,    setTotal]    = useState(0)
  const [page,     setPage]     = useState(1)
  const [loading,  setLoading]  = useState(false)
  const [search,   setSearch]   = useState('')
  const [flag,     setFlag]     = useState('')
  const [type,     setType]     = useState('')
  const [flags,    setFlags]    = useState([])
  const [types,    setTypes]    = useState([])
  const LIMIT = 50

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, limit: LIMIT }
      if (search) params.search = search
      if (flag)   params.flag   = flag
      if (type)   params.vessel_type = type
      const r = await vesselAPI.list(params)
      setVessels(r.data.data || [])
      setTotal(r.data.total || 0)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [page, search, flag, type])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    vesselAPI.flags().then(r => setFlags(r.data || [])).catch(() => {})
    vesselAPI.types().then(r => setTypes(r.data || [])).catch(() => {})
  }, [])

  const clearFilters = () => { setSearch(''); setFlag(''); setType(''); setPage(1) }
  const totalPages   = Math.ceil(total / LIMIT)
  const hasFilters   = search || flag || type

  const certCounts = v => {
    const certs = v.certificates || []
    const now = Date.now()
    let valid=0, expiring=0, expired=0
    for (const c of certs) {
      const exp = c.expiry_date || c.expiryDate || c.ExpiryDate
      if (!exp) { valid++; continue }
      const ms = new Date(exp).getTime()
      const diff = ms - now
      if (diff < 0) expired++
      else if (diff < 30*24*3600*1000) expiring++
      else valid++
    }
    return { valid, expiring, expired }
  }

  return (
    <div className="fade-in">
      <div className="page-header flex items-center justify-between">
        <div>
          <h1 className="page-title">Vessel Explorer</h1>
          <p className="page-subtitle">{total.toLocaleString()} vessels in fleet</p>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <div className="input-icon-wrapper" style={{ flex: '1 1 200px', minWidth: 0 }}>
          <Search size={15} className="icon" />
          <input
            className="input input-with-icon"
            placeholder="Search by name or IMO…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>

        <select className="select" style={{ flex:'0 0 160px' }} value={flag} onChange={e => { setFlag(e.target.value); setPage(1) }}>
          <option value="">All Flags</option>
          {flags.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        <select className="select" style={{ flex:'0 0 180px' }} value={type} onChange={e => { setType(e.target.value); setPage(1) }}>
          <option value="">All Types</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        {hasFilters && (
          <button onClick={clearFilters} className="btn btn-ghost btn-sm">
            <X size={14} /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center" style={{ padding: '3rem' }}>
              <div className="spinner spinner-lg" />
            </div>
          ) : vessels.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vessel</th>
                  <th>IMO</th>
                  <th>Flag</th>
                  <th>Type</th>
                  <th>Port / Destination</th>
                  <th>Speed</th>
                  <th>Class Society</th>
                  <th>Certificates</th>
                </tr>
              </thead>
              <tbody>
                {vessels.map(v => {
                  const cc = certCounts(v)
                  return (
                    <tr key={v.imo} onClick={() => navigate(`/vessels/${v.imo}`)} style={{ cursor:'pointer' }}>
                      <td>
                        <div className="flex items-center gap-2">
                          <Ship size={14} color="#0d9488" style={{ flexShrink:0 }} />
                          <span style={{ fontWeight:600, color:'#111827' }}>{v.name || '—'}</span>
                        </div>
                      </td>
                      <td><span className="font-mono" style={{ fontSize:'0.8rem', color:'#6b7280' }}>{v.imo}</span></td>
                      <td><span style={{ fontSize:'0.875rem' }}>{v.flag || '—'}</span></td>
                      <td>
                        {v.vessel_type
                          ? <span className="badge badge-teal">{v.vessel_type}</span>
                          : <span style={{ color:'#9ca3af', fontSize:'0.8rem' }}>—</span>
                        }
                      </td>
                      <td><span style={{ fontSize:'0.875rem', color:'#374151' }}>{v.destination || v.port || '—'}</span></td>
                      <td>
                        <span style={{ fontSize:'0.875rem', fontWeight:500, color: v.speed > 0.5 ? '#059669' : '#9ca3af' }}>
                          {v.speed != null ? `${v.speed} kn` : '—'}
                        </span>
                      </td>
                      <td>
                        {v.class_society
                          ? <span className="badge badge-blue">{v.class_society}</span>
                          : <span style={{ color:'#9ca3af', fontSize:'0.8rem' }}>—</span>
                        }
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <CertBadge count={cc.valid}    type="valid" />
                          <CertBadge count={cc.expiring} type="expiring" />
                          <CertBadge count={cc.expired}  type="expired" />
                          {!cc.valid && !cc.expiring && !cc.expired && <span style={{ color:'#9ca3af', fontSize:'0.8rem' }}>—</span>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">
              <Ship size={40} className="empty-state-icon" />
              <p style={{ fontWeight:500 }}>No vessels found</p>
              <p style={{ fontSize:'0.875rem' }}>Try adjusting filters or syncing data</p>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="pagination" style={{ padding:'0.75rem 1rem', borderTop:'1px solid #f3f4f6' }}>
            <span className="page-info">Page {page} of {totalPages} · {total.toLocaleString()} vessels</span>
            <button className="page-btn" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}>
              <ChevronLeft size={14} />
            </button>
            <button className="page-btn" onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages}>
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
