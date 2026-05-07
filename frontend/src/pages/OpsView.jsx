import { useState, useEffect, useMemo } from 'react'
import { Briefcase, Clock, CheckCircle, Flag, Activity, ShieldAlert, ChevronDown, Ship, AlertTriangle } from 'lucide-react'
import { vesselAPI } from '../lib/api'

// Dark theme tokens
const D = {
  bg:     'bg-[#0a0e1b]',
  card:   'bg-[#0f1622]',
  border: 'border-[#1a2438]',
  input:  'bg-[#0f1622] border-[#1a2438] text-white placeholder:text-gray-500',
}

function Select({ value, onChange, options, placeholder }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`appearance-none ${D.input} border rounded-lg pl-3 pr-7 py-1.5 text-xs font-medium outline-none focus:border-[#0FA390] cursor-pointer`}
      >
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
    </div>
  )
}

export default function OpsView() {
  const [vessels,  setVessels]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [port,     setPort]     = useState('')
  const [manager,  setManager]  = useState('')
  const [owner,    setOwner]    = useState('')
  const [society,  setSociety]  = useState('')
  const [vType,    setVType]    = useState('')

  useEffect(() => {
    vesselAPI.list({ limit: 10000, has_port: true, sort_by: 'port' })
      .then(r => setVessels(r.data.data || []))
      .finally(() => setLoading(false))
  }, [])

  // Distinct filter values
  const ports     = useMemo(() => [...new Set(vessels.map(v => v.port).filter(Boolean))].sort(), [vessels])
  const managers  = useMemo(() => [...new Set(vessels.map(v => v.ship_manager).filter(Boolean))].sort(), [vessels])
  const owners    = useMemo(() => [...new Set(vessels.map(v => v.ship_owner).filter(Boolean))].sort(), [vessels])
  const societies = useMemo(() => [...new Set(vessels.map(v => v.class_society).filter(Boolean))].sort(), [vessels])
  const types     = useMemo(() => [...new Set(vessels.map(v => v.vessel_type || v.spire_type).filter(Boolean))].sort(), [vessels])

  // Vessel feed: vessels at selected port
  const vesselFeed = useMemo(() => {
    let list = vessels
    if (port)    list = list.filter(v => v.port === port)
    if (manager) list = list.filter(v => v.ship_manager === manager)
    if (owner)   list = list.filter(v => v.ship_owner === owner)
    if (society) list = list.filter(v => v.class_society === society)
    if (vType)   list = list.filter(v => (v.vessel_type || v.spire_type) === vType)
    return list
  }, [vessels, port, manager, owner, society, vType])

  // Certs expiring soon — uses pre-computed lsa_days / ffa_days (no cert array needed)
  const expiringCerts = useMemo(() => {
    const list = []
    vesselFeed.forEach(v => {
      if (v.lsa_days != null && v.lsa_days < 60)
        list.push({ name: 'LSA Certificate', days: v.lsa_days, vessel: v })
      if (v.ffa_days != null && v.ffa_days < 60)
        list.push({ name: 'FFA Certificate', days: v.ffa_days, vessel: v })
    })
    return list.sort((a, b) => a.days - b.days).slice(0, 8)
  }, [vesselFeed])

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  // Derive stat counts from vessel data
  const stats = useMemo(() => {
    const total   = vesselFeed.length
    const flagged = vesselFeed.filter(v => v.cert_status === 'expired').length
    const active  = vesselFeed.filter(v => v.berth || v.terminal).length
    const pending = vesselFeed.filter(v => v.eta && !v.berth).length
    const done    = Math.max(0, total - flagged - active - pending)
    return [
      { icon: Briefcase,   label: 'TOTAL',   value: total,   color: 'text-[#0FA390]'  },
      { icon: Clock,       label: 'PENDING', value: pending, color: 'text-amber-400'  },
      { icon: Activity,    label: 'ACTIVE',  value: active,  color: 'text-blue-400'   },
      { icon: CheckCircle, label: 'DONE',    value: done,    color: 'text-emerald-400' },
      { icon: Flag,        label: 'FLAGGED', value: flagged, color: 'text-red-400'    },
    ]
  }, [vesselFeed])

  return (
    <div className={`flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden ${D.bg} text-white`}>
      {/* Header + filters */}
      <div className={`px-6 pt-6 pb-4 border-b ${D.border} shrink-0`}>
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div>
            <h1 className="font-heading font-bold text-2xl text-white">My Day</h1>
            <p className="text-sm text-gray-400 mt-0.5">{today}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={port}    onChange={setPort}    options={ports}     placeholder="All Ports" />
            <Select value={manager} onChange={setManager} options={managers}  placeholder="All Managers" />
            <Select value={owner}   onChange={setOwner}   options={owners}    placeholder="All Owners" />
            <Select value={society} onChange={setSociety} options={societies} placeholder="All Societies" />
            <Select value={vType}   onChange={setVType}   options={types}     placeholder="All Types" />
          </div>
        </div>

        {/* Stat row */}
        <div className="grid grid-cols-5 gap-3">
          {stats.map(({ icon: Icon, label, value, color }) => (
            <div key={label} className={`${D.card} border ${D.border} rounded-xl p-3 flex items-center gap-3`}>
              <Icon size={18} className={color} />
              <div>
                <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
                <div className="text-[10px] text-gray-500 font-semibold tracking-wide">{label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Jobs section */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex items-center gap-2 mb-4">
            <Briefcase size={16} className="text-[#0FA390]" />
            <h2 className="font-heading font-semibold text-base text-white">Vessels at Port ({vesselFeed.length})</h2>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-20"><div className="spinner w-5 h-5" /></div>
          ) : vesselFeed.length ? (
            <div className="space-y-3">
              {vesselFeed.map(v => {
                const status = v.cert_status || 'none'
                const borderCls = status === 'expired' ? 'border-l-red-500' : status === 'critical' ? 'border-l-amber-500' : 'border-l-[#0FA390]'
                const etaFmt = v.eta ? new Date(v.eta).toLocaleDateString('en-GB',{day:'numeric',month:'short'}) + ' ' + new Date(v.eta).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : null
                const NAV = { 0:'Underway (Engine)', 1:'At Anchor', 5:'Moored', 6:'Aground', 8:'Underway (Sail)' }
                return (
                  <div key={v.imo} className={`${D.card} border ${D.border} border-l-4 ${borderCls} rounded-xl p-4`}>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <div className="font-heading font-bold text-sm text-white">{v.name || `IMO ${v.imo}`}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          IMO {v.imo}{v.flag ? ` · ${v.flag}` : ''}{v.vessel_type ? ` · ${v.vessel_type}` : ''}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {v.port && <div className="text-[11px] font-semibold text-[#0FA390]">{v.port}</div>}
                        {v.berth && <div className="text-[10px] text-gray-400">Berth: {v.berth}</div>}
                        {v.terminal && <div className="text-[10px] text-gray-400">Term: {v.terminal}</div>}
                      </div>
                    </div>
                    {/* AIS data row */}
                    {(v.lat || v.speed != null) && (
                      <div className="flex flex-wrap gap-3 text-[10px] text-blue-400/80 mb-2 font-mono">
                        {v.lat && v.lon && <span>{Number(v.lat).toFixed(4)}°, {Number(v.lon).toFixed(4)}°</span>}
                        {v.speed != null && <span>{v.speed} kn</span>}
                        {v.course != null && <span>{v.course}°</span>}
                        {v.nav_status != null && <span className="text-gray-500 font-sans">{NAV[v.nav_status] || `Nav ${v.nav_status}`}</span>}
                        {v.draught && <span className="text-gray-500 font-sans">Draft {v.draught}m</span>}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 text-[10px] text-gray-400">
                      {etaFmt && <span className="flex items-center gap-1"><Clock size={9} />ETA {etaFmt}</span>}
                      {v.destination && <span>→ {v.destination}</span>}
                      {v.last_port && <span>From: {v.last_port}</span>}
                      {v.class_society && <span className="text-[#0FA390]/80">{v.class_society}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20">
              <Ship size={32} className="text-gray-600 mb-3 opacity-40" />
              <p className="text-gray-500 text-sm">No vessels match the selected filters</p>
              {port && <p className="text-[10px] text-gray-600 mt-1">Port: {port}</p>}
            </div>
          )}
        </div>

        {/* Right panels */}
        <div className={`w-80 shrink-0 border-l ${D.border} flex flex-col overflow-y-auto`}>
          {/* Vessel feed */}
          <div className={`p-4 border-b ${D.border}`}>
            <div className="flex items-center gap-2 mb-3">
              <Ship size={14} className="text-[#0FA390]" />
              <span className="font-heading font-semibold text-sm text-white">Vessel Feed ({vesselFeed.length})</span>
            </div>
            {loading ? (
              <div className="py-4 flex justify-center"><div className="spinner w-4 h-4" /></div>
            ) : vesselFeed.length ? (
              <div className="space-y-0">
                {vesselFeed.slice(0, 10).map(v => {
                  const etaTime = v.eta ? new Date(v.eta).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null
                  const status  = v.cert_status || 'none'
                  const dot     = { expired:'bg-red-500', critical:'bg-amber-500', warning:'bg-yellow-400', valid:'bg-emerald-500' }[status]
                  const NAV = { 0:'Underway', 1:'At Anchor', 5:'Moored', 6:'Aground', 8:'Sailing', 15:'—' }
                  const navLabel = NAV[v.nav_status] ?? (v.nav_status != null ? `Nav ${v.nav_status}` : null)
                  return (
                    <div key={v.imo} className={`py-3 border-b ${D.border} last:border-0`}>
                      {/* Row 1: name + badge */}
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${dot}`} />
                          <div className="text-xs font-semibold text-white truncate">{v.name || `IMO ${v.imo}`}</div>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded border shrink-0 ${
                          status === 'expired' ? 'border-red-800 text-red-400' :
                          status === 'critical' ? 'border-amber-800 text-amber-400' :
                          'border-[#1a2438] text-gray-400'
                        }`}>
                          {status === 'expired' ? 'Expired' : status === 'critical' ? 'Critical' : 'Open'}
                        </span>
                      </div>
                      {/* Row 2: port + berth + ETA */}
                      <div className="flex flex-wrap gap-2 text-[10px] text-gray-400 pl-4 mb-1">
                        {v.port && <span className="text-[#0FA390] font-medium">{v.port}</span>}
                        {v.berth && <span>Berth: {v.berth}</span>}
                        {v.terminal && <span>Term: {v.terminal}</span>}
                        {etaTime && <span>ETA {etaTime}</span>}
                        {v.locode && <span className="font-mono">{v.locode}</span>}
                      </div>
                      {/* Row 3: AIS live data */}
                      {(v.lat || v.speed != null) && (
                        <div className="flex flex-wrap gap-2 text-[10px] text-blue-400/70 pl-4">
                          {v.lat && v.lon && <span className="font-mono">{Number(v.lat).toFixed(3)}°, {Number(v.lon).toFixed(3)}°</span>}
                          {v.speed != null && <span>{v.speed} kn</span>}
                          {v.course != null && <span>{v.course}°</span>}
                          {navLabel && <span className="text-gray-500">{navLabel}</span>}
                          {v.draught && <span className="text-gray-500">Draft {v.draught}m</span>}
                        </div>
                      )}
                    </div>
                  )
                })}
                <div className="text-[9px] text-gray-600 text-right mt-2 pt-1">⚡ Powered by HYLA</div>
              </div>
            ) : (
              <p className="text-xs text-gray-500">No vessels match filters</p>
            )}
          </div>

          {/* Certificates expiring */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={14} className="text-amber-400" />
              <span className="font-heading font-semibold text-sm text-white">Certificates Expiring ({expiringCerts.length})</span>
            </div>
            {expiringCerts.length ? (
              <div className="space-y-2">
                {expiringCerts.map((c, i) => (
                  <div key={i} className={`flex items-center justify-between py-1.5 border-b ${D.border} last:border-0`}>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-white truncate">{c.vessel?.name || `IMO ${c.vessel?.imo}`}</div>
                      <div className="text-[10px] text-gray-400 truncate">{c.name || '—'}</div>
                    </div>
                    <span className={`text-[10px] font-mono font-bold shrink-0 ml-2 ${c.days < 20 ? 'text-red-400' : 'text-amber-400'}`}>
                      {c.days}d
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500">No expiring certificates</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
