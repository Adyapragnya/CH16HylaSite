import { useState, useEffect } from 'react'
import {
  Anchor, Ship, MapPin, Plus, Trash2, RefreshCw, Pause, Play,
  Settings, Clock, AlertCircle, CheckCircle
} from 'lucide-react'
import { subscriptionAPI } from '../lib/api'
import { toast } from 'sonner'

export default function SubscriptionsPage() {
  const [sub,     setSub]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState('overview')

  // Add vessel modal state
  const [addVesselInput, setAddVesselInput] = useState('')
  const [addingVessel,   setAddingVessel]   = useState(false)

  // Add port modal state
  const [addPortInput, setAddPortInput] = useState('')
  const [addingPort,   setAddingPort]   = useState(false)

  // Intervals form
  const [intervals, setIntervals] = useState({ inportMinutes:60, terrestrialMinutes:90, satelliteMinutes:120 })
  const [savingIntervals, setSavingIntervals] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const r = await subscriptionAPI.get()
      setSub(r.data)
      if (r.data?.intervals) {
        setIntervals({
          inportMinutes:      r.data.intervals.inportMinutes      ?? 60,
          terrestrialMinutes: r.data.intervals.terrestrialMinutes ?? 90,
          satelliteMinutes:   r.data.intervals.satelliteMinutes   ?? 120,
        })
      }
    } catch (e) {
      const msg = e.response?.data?.detail || 'Failed to load subscription'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleAddVessel = async () => {
    const imos = addVesselInput.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
    if (!imos.length) return
    setAddingVessel(true)
    try {
      await subscriptionAPI.addVessels(imos)
      toast.success(`Subscribed to ${imos.length} vessel(s)`)
      setAddVesselInput('')
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to subscribe vessels')
    } finally {
      setAddingVessel(false)
    }
  }

  const handleAddPort = async () => {
    const codes = addPortInput.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
    if (!codes.length) return
    setAddingPort(true)
    try {
      await subscriptionAPI.addPorts(codes)
      toast.success(`Subscribed to ${codes.length} port(s)`)
      setAddPortInput('')
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to subscribe ports')
    } finally {
      setAddingPort(false)
    }
  }

  const handleToggleStatus = async () => {
    const next = sub?.status === 'active' ? 'paused' : 'active'
    try {
      await subscriptionAPI.updateStatus(next)
      toast.success(`Subscription ${next}`)
      load()
    } catch (e) {
      toast.error('Failed to update status')
    }
  }

  const handleSaveIntervals = async () => {
    setSavingIntervals(true)
    try {
      await subscriptionAPI.updateIntervals(intervals)
      toast.success('Polling intervals saved')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save intervals')
    } finally {
      setSavingIntervals(false)
    }
  }

  const handleRemoveVessel = async imo => {
    try {
      await subscriptionAPI.removeVessels([imo])
      toast.success(`Unsubscribed IMO ${imo}`)
      load()
    } catch (e) {
      toast.error('Failed to remove vessel')
    }
  }

  const handleRemovePort = async code => {
    try {
      await subscriptionAPI.removePorts([code])
      toast.success(`Unsubscribed port ${code}`)
      load()
    } catch (e) {
      toast.error('Failed to remove port')
    }
  }

  return (
    <div className="fade-in">
      <div className="page-header flex items-center justify-between">
        <div>
          <h1 className="page-title">Subscriptions</h1>
          <p className="page-subtitle">Manage vessel and port AIS subscriptions via GreenHyla API</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn btn-secondary btn-sm" disabled={loading}>
            <RefreshCw size={14} style={{ animation: loading ? 'spin 0.7s linear infinite' : 'none' }} />
            Refresh
          </button>
          {sub && (
            <button onClick={handleToggleStatus} className={`btn btn-sm ${sub.status==='active'?'btn-secondary':'btn-primary'}`}>
              {sub.status==='active' ? <><Pause size={14}/> Pause</> : <><Play size={14}/> Resume</>}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center" style={{ padding:'4rem' }}>
          <div className="spinner spinner-lg" />
        </div>
      ) : (
        <>
          {/* Status banner */}
          {sub && (
            <div className={`alert-banner mb-4 ${sub.status==='active'?'alert-success':'alert-warning'}`}>
              {sub.status==='active' ? <CheckCircle size={16}/> : <AlertCircle size={16}/>}
              Subscription is <strong>{sub.status}</strong>
              {sub.imos?.length > 0 && ` · ${sub.imos.length} vessels`}
              {sub.locodes?.length > 0 && ` · ${sub.locodes.length} ports`}
            </div>
          )}

          {/* Tabs */}
          <div className="tab-nav">
            {[
              { id:'overview',  label:'Overview' },
              { id:'vessels',   label:`Vessels (${sub?.imos?.length ?? 0})` },
              { id:'ports',     label:`Ports (${sub?.locodes?.length ?? 0})` },
              { id:'intervals', label:'Polling Intervals' },
            ].map(t => (
              <div key={t.id} className={`tab-item${tab===t.id?' active':''}`} onClick={() => setTab(t.id)}>
                {t.label}
              </div>
            ))}
          </div>

          {/* Overview tab */}
          {tab === 'overview' && (
            <div className="grid gap-4" style={{ gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))' }}>
              <div className="stat-card">
                <div className="flex items-center gap-3">
                  <div className="stat-icon" style={{ background:'#f0fdfa' }}><Ship size={18} color="#0d9488"/></div>
                  <div>
                    <div style={{ fontSize:'0.75rem', color:'#9ca3af', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>Subscribed Vessels</div>
                    <div style={{ fontSize:'2rem', fontWeight:700, color:'#111827', fontFamily:"'Syne',sans-serif" }}>{sub?.imos?.length ?? 0}</div>
                  </div>
                </div>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-3">
                  <div className="stat-icon" style={{ background:'#eff6ff' }}><MapPin size={18} color="#2563eb"/></div>
                  <div>
                    <div style={{ fontSize:'0.75rem', color:'#9ca3af', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>Subscribed Ports</div>
                    <div style={{ fontSize:'2rem', fontWeight:700, color:'#111827', fontFamily:"'Syne',sans-serif" }}>{sub?.locodes?.length ?? 0}</div>
                  </div>
                </div>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-3">
                  <div className="stat-icon" style={{ background:'#ecfdf5' }}><Clock size={18} color="#059669"/></div>
                  <div>
                    <div style={{ fontSize:'0.75rem', color:'#9ca3af', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>Inport Interval</div>
                    <div style={{ fontSize:'2rem', fontWeight:700, color:'#111827', fontFamily:"'Syne',sans-serif" }}>{sub?.intervals?.inportMinutes ?? '—'}<span style={{ fontSize:'0.875rem', color:'#6b7280' }}> min</span></div>
                  </div>
                </div>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-3">
                  <div className="stat-icon" style={{ background:'#fffbeb' }}><Settings size={18} color="#d97706"/></div>
                  <div>
                    <div style={{ fontSize:'0.75rem', color:'#9ca3af', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>Satellite Interval</div>
                    <div style={{ fontSize:'2rem', fontWeight:700, color:'#111827', fontFamily:"'Syne',sans-serif" }}>{sub?.intervals?.satelliteMinutes ?? '—'}<span style={{ fontSize:'0.875rem', color:'#6b7280' }}> min</span></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Vessels tab */}
          {tab === 'vessels' && (
            <div className="card" style={{ padding:0 }}>
              <div className="sub-header">
                <h2 style={{ fontSize:'0.9rem', fontWeight:700, color:'#111827' }}>Subscribed Vessels</h2>
                <div className="flex items-center gap-2">
                  <input className="input" style={{ width:'16rem' }} placeholder="IMO numbers (comma separated)"
                    value={addVesselInput} onChange={e => setAddVesselInput(e.target.value)} />
                  <button className="btn btn-primary btn-sm" onClick={handleAddVessel} disabled={addingVessel || !addVesselInput}>
                    <Plus size={14}/> Subscribe
                  </button>
                </div>
              </div>
              {sub?.imos?.length ? (
                <table className="data-table">
                  <thead><tr><th>IMO Number</th><th style={{ textAlign:'right' }}>Action</th></tr></thead>
                  <tbody>
                    {sub.imos.map(imo => (
                      <tr key={imo}>
                        <td><span className="font-mono" style={{ fontWeight:500 }}>{imo}</span></td>
                        <td style={{ textAlign:'right' }}>
                          <button className="btn btn-ghost btn-sm" style={{ color:'#dc2626' }} onClick={() => handleRemoveVessel(String(imo))}>
                            <Trash2 size={13}/> Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty-state"><Ship size={32} className="empty-state-icon"/><p>No vessels subscribed</p></div>
              )}
            </div>
          )}

          {/* Ports tab */}
          {tab === 'ports' && (
            <div className="card" style={{ padding:0 }}>
              <div className="sub-header">
                <h2 style={{ fontSize:'0.9rem', fontWeight:700, color:'#111827' }}>Subscribed Ports</h2>
                <div className="flex items-center gap-2">
                  <input className="input" style={{ width:'16rem' }} placeholder="UNLOCODE (e.g. INMUM, SGSIN)"
                    value={addPortInput} onChange={e => setAddPortInput(e.target.value)} />
                  <button className="btn btn-primary btn-sm" onClick={handleAddPort} disabled={addingPort || !addPortInput}>
                    <Plus size={14}/> Subscribe
                  </button>
                </div>
              </div>
              {sub?.locodes?.length ? (
                <table className="data-table">
                  <thead><tr><th>UNLOCODE</th><th style={{ textAlign:'right' }}>Action</th></tr></thead>
                  <tbody>
                    {sub.locodes.map(code => (
                      <tr key={code}>
                        <td><span className="badge badge-blue font-mono">{code}</span></td>
                        <td style={{ textAlign:'right' }}>
                          <button className="btn btn-ghost btn-sm" style={{ color:'#dc2626' }} onClick={() => handleRemovePort(code)}>
                            <Trash2 size={13}/> Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty-state"><MapPin size={32} className="empty-state-icon"/><p>No ports subscribed</p></div>
              )}
            </div>
          )}

          {/* Intervals tab */}
          {tab === 'intervals' && (
            <div className="card" style={{ maxWidth:'28rem' }}>
              <h2 style={{ fontSize:'0.9rem', fontWeight:700, color:'#111827', marginBottom:'1rem' }}>Polling Intervals</h2>
              <p style={{ fontSize:'0.8rem', color:'#9ca3af', marginBottom:'1.5rem' }}>
                Configure how often AIS data is fetched for each zone type. Minimum 30 minutes.
              </p>
              {[
                { key:'inportMinutes',      label:'In-Port',      desc:'Vessels inside port geofence' },
                { key:'terrestrialMinutes', label:'Terrestrial',  desc:'Vessels in coastal/boundary zones' },
                { key:'satelliteMinutes',   label:'Satellite',    desc:'Vessels in open ocean' },
              ].map(f => (
                <div key={f.key} style={{ marginBottom:'1rem' }}>
                  <label className="form-label">{f.label} <span style={{ color:'#9ca3af', fontWeight:400 }}>({f.desc})</span></label>
                  <div className="flex items-center gap-2">
                    <input type="number" min="30" className="input" style={{ width:'7rem' }}
                      value={intervals[f.key]}
                      onChange={e => setIntervals(v => ({ ...v, [f.key]: Number(e.target.value) }))}
                    />
                    <span style={{ fontSize:'0.875rem', color:'#6b7280' }}>minutes</span>
                  </div>
                </div>
              ))}
              <button className="btn btn-primary" onClick={handleSaveIntervals} disabled={savingIntervals}>
                {savingIntervals ? 'Saving...' : 'Save Intervals'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
