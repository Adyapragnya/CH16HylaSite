import { useState, useEffect, useMemo, useCallback } from 'react'
import { ShieldCheck, ChevronDown, AlertTriangle, ClipboardList } from 'lucide-react'
import { vesselAPI } from '../lib/api'
import { generateCertNo } from '../lib/utils'

const D = {
  bg:     'bg-[#0a0e1b]',
  card:   'bg-[#0f1622]',
  border: 'border-[#1a2438]',
  input:  'bg-[#0f1622] border-[#1a2438] text-white',
  row:    'border-b border-[#1a2438]',
}

function certDays(cert) {
  if (cert.days_remaining != null) return cert.days_remaining
  const exp = cert.expiry_date || cert.expiryDate || cert.ExpiryDate
  if (!exp) return null
  return Math.floor((new Date(exp) - Date.now()) / 86400000)
}

function worstStatus(certs = []) {
  let worst = 'valid'
  for (const c of certs) {
    const d = certDays(c)
    if (d === null) continue
    if (d < 0) return 'expired'
    if (d < 20 && worst !== 'expired') worst = 'critical'
    else if (d < 60 && worst === 'valid') worst = 'warning'
  }
  return worst
}

function fmtDate(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
  catch { return '—' }
}

function fmtDateShort(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return '—' }
}

function DaysLeftBadge({ days }) {
  if (days === null) return <span className="text-gray-500">—</span>
  if (days < 0)  return <span className="text-[10px] font-bold bg-red-500/30 text-red-400 px-2 py-0.5 rounded font-mono">EXPIRED</span>
  if (days < 20) return <span className="text-[11px] font-bold text-amber-400 font-mono">{days}d</span>
  if (days < 60) return <span className="text-[11px] font-semibold text-yellow-400 font-mono">{days}d</span>
  return <span className="text-[11px] text-emerald-400 font-mono">{days}d</span>
}

// Derive surveys from certificates
function deriveSurveys(certs = []) {
  const SURVEY_MAP = {
    'SOLAS': { name: 'Safety Equipment Survey', category: 'Statutory' },
    'LSA':   { name: 'Safety Equipment Survey', category: 'Statutory' },
    'FFA':   { name: 'Safety Construction Survey', category: 'Statutory' },
    'Load Line': { name: 'Load Line Survey', category: 'Statutory' },
    'IOPP':  { name: 'IOPP Survey', category: 'Statutory' },
    'ISPS':  { name: 'ISPS Survey', category: 'Statutory' },
    'MLC':   { name: 'MLC Survey', category: 'Statutory' },
    'ISM':   { name: 'ISM Survey', category: 'Statutory' },
    'Safety Radio': { name: 'Safety Radio Survey', category: 'Statutory' },
    'Class': { name: 'Annual Survey', category: 'Class' },
    'Tonnage': { name: 'Tonnage Survey', category: 'Statutory' },
  }

  const CLASS_SURVEYS = [
    'Annual Survey', 'Intermediate Survey', 'Special Survey',
    'Bottom Survey', 'Tailshaft Survey', 'Boiler Survey',
  ]

  const surveys = []
  const seen = new Set()

  // Map certs to surveys
  certs.forEach((c, i) => {
    const t = (c.type || '').toUpperCase()
    const n = c.name || ''
    let mapped = null

    for (const [key, val] of Object.entries(SURVEY_MAP)) {
      if (t.includes(key.toUpperCase()) || n.toUpperCase().includes(key.toUpperCase())) {
        mapped = val
        break
      }
    }
    if (!mapped) mapped = { name: n.replace('Certificate', 'Survey').replace('  ', ' '), category: c.category || 'Statutory' }

    if (seen.has(mapped.name)) return
    seen.add(mapped.name)

    const days = certDays(c)
    const expiry = c.expiry_date || c.expiryDate
    const status = days === null ? 'unknown' : days < 0 ? 'overdue' : days < 30 ? 'due_soon' : 'ok'

    // Range: 90 days before to due date
    const rangeFrom = expiry ? new Date(new Date(expiry).getTime() - 90 * 86400000).toISOString() : null
    // Assigned: 30 days before due
    const assigned = expiry ? new Date(new Date(expiry).getTime() - 30 * 86400000).toISOString() : null

    surveys.push({ name: mapped.name, category: mapped.category, due_date: expiry, assigned, range_from: rangeFrom, status, days })
  })

  // Add standard class surveys if none present
  const hasClass = surveys.some(s => s.category === 'Class')
  if (!hasClass && certs.length > 0) {
    const baseCert = certs.find(c => c.expiry_date) || certs[0]
    const baseExpiry = baseCert?.expiry_date
    CLASS_SURVEYS.forEach((name, i) => {
      if (seen.has(name)) return
      const offset = i * 30 * 86400000
      const due = baseExpiry ? new Date(new Date(baseExpiry).getTime() + offset).toISOString() : null
      const days = due ? Math.floor((new Date(due) - Date.now()) / 86400000) : null
      surveys.push({
        name, category: 'Class', due_date: due,
        assigned: due ? new Date(new Date(due).getTime() - 30 * 86400000).toISOString() : null,
        range_from: due ? new Date(new Date(due).getTime() - 90 * 86400000).toISOString() : null,
        status: days === null ? 'unknown' : days < 0 ? 'overdue' : days < 30 ? 'due_soon' : 'ok',
        days,
      })
    })
  }

  return surveys.sort((a, b) => {
    const da = a.days ?? 9999, db = b.days ?? 9999
    return da - db
  })
}

function SurveyStatusBadge({ status, days }) {
  if (status === 'overdue') return <span className="text-[10px] font-bold bg-red-500/20 text-red-400 px-2 py-0.5 rounded">Overdue</span>
  if (status === 'due_soon') return <span className="text-[10px] font-bold bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">Due Soon</span>
  return <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">OK</span>
}

export default function ComplianceView() {
  const [vessels,       setVessels]       = useState([])
  const [selected,      setSelected]      = useState(null)
  const [loadingList,   setLoadingList]   = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [certError,     setCertError]     = useState(null)
  const [port,          setPort]          = useState('')
  const [search,        setSearch]        = useState('')
  const [tab,           setTab]           = useState('certificates')
  const [certsOnly,     setCertsOnly]     = useState(true)   // default: only vessels with cert data

  const loadVessels = useCallback((certsOnlyFlag) => {
    setLoadingList(true)
    setVessels([])
    setSelected(null)
    const params = { limit: 10000, sort_by: 'cert_urgency' }
    if (certsOnlyFlag) params.has_certs = true
    vesselAPI.list(params)
      .then(r => {
        const data = r.data.data || []
        setVessels(data)
        if (data.length) selectVessel(data[0])
      })
      .finally(() => setLoadingList(false))
  }, []) // eslint-disable-line

  useEffect(() => { loadVessels(certsOnly) }, []) // eslint-disable-line

  const toggleCertsOnly = () => {
    const next = !certsOnly
    setCertsOnly(next)
    loadVessels(next)
  }

  // Fetch certificates on demand via the dedicated lightweight endpoint
  const selectVessel = useCallback(async (v) => {
    setSelected(v)           // show vessel metadata immediately
    setLoadingDetail(true)
    setCertError(null)
    try {
      const res = await vesselAPI.certificates(v.imo)
      const certs = res.data.certificates || []
      setSelected(prev => prev?.imo === v.imo
        ? { ...prev, certificates: certs }
        : prev
      )
      if (certs.length === 0) setCertError('no_data')
    } catch (e) {
      setCertError('fetch_failed')
    }
    finally { setLoadingDetail(false) }
  }, [])

  const ports = useMemo(() => [...new Set(vessels.map(v => v.port).filter(Boolean))].sort(), [vessels])

  const filtered = useMemo(() => {
    let list = vessels
    if (port)   list = list.filter(v => v.port === port)
    if (search) list = list.filter(v => String(v.name || '').toLowerCase().includes(search.toLowerCase()) || String(v.imo || '').includes(search))
    return list
  }, [vessels, port, search])

  const certs   = selected?.certificates || []
  const surveys = useMemo(() => deriveSurveys(certs), [certs])

  const certSummary = useMemo(() => {
    let expired = 0, atRisk = 0, valid = 0
    certs.forEach(c => {
      const d = certDays(c)
      if (d === null) return
      if (d < 0) expired++
      else if (d < 20) atRisk++
      else valid++
    })
    return { expired, atRisk, valid }
  }, [certs])

  const urgentCert = useMemo(() =>
    certs.find(c => { const d = certDays(c); return d !== null && d < 20 })
  , [certs])

  const statusDot = (v) => {
    const s = v.cert_status || 'none'
    return { expired: 'bg-red-500', critical: 'bg-amber-500', warning: 'bg-yellow-400', valid: 'bg-emerald-500' }[s] || 'bg-gray-500'
  }

  return (
    <div className={`flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden ${D.bg} text-white`}>

      {/* ── Top header bar ───────────────────────────────────────────── */}
      <div className={`px-8 pt-6 pb-4 border-b ${D.border} shrink-0 flex items-end justify-between`}>
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-[#0FA390]/15 flex items-center justify-center">
              <ShieldCheck size={22} className="text-[#0FA390]" />
            </div>
            <div>
              <h1 className="font-heading font-bold text-3xl text-white leading-none">Compliance</h1>
              <p className="text-xs text-gray-400 mt-0.5">Certificate & Survey status for LSA/FFA specialists</p>
            </div>
          </div>
        </div>
        {/* Port selector top-right */}
        <div className="relative">
          <select
            value={port}
            onChange={e => {
              setPort(e.target.value)
              const first = vessels.find(v => v.port === e.target.value)
              if (first) selectVessel(first)
            }}
            className={`appearance-none ${D.input} border rounded-lg pl-4 pr-8 py-2 text-sm font-medium outline-none focus:border-[#0FA390] cursor-pointer min-w-[160px]`}
          >
            <option value="">All Ports</option>
            {ports.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {/* ── Main area (two columns) ───────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left: Vessel list ──────────────────────────────────────── */}
        <div className={`w-72 shrink-0 border-r ${D.border} flex flex-col overflow-hidden`}>
          {/* Label + search */}
          <div className={`px-4 pt-4 pb-3 border-b ${D.border} shrink-0`}>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
              Vessels {port ? `at ${port}` : ''} ({filtered.length})
            </div>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search vessel…"
              className={`w-full ${D.input} border rounded-lg px-3 py-1.5 text-xs outline-none focus:border-[#0FA390] placeholder:text-gray-600`}
            />
          </div>

          {/* Vessel items */}
          <div className="flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="flex items-center justify-center py-12"><div className="spinner w-5 h-5" /></div>
            ) : filtered.length ? filtered.map(v => (
              <div
                key={v.imo}
                onClick={() => selectVessel(v)}
                className={`px-4 py-3.5 cursor-pointer border-b ${D.border} transition-colors hover:bg-[#0FA390]/8 ${
                  selected?.imo === v.imo
                    ? 'bg-[#0FA390]/10 border-l-2 border-l-[#0FA390]'
                    : 'border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">{v.name || `IMO ${v.imo}`}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">IMO: {v.imo} · {v.vessel_type || v.spire_type || '—'}</div>
                    {v.class_society && <div className="text-[10px] text-[#0FA390]/80 mt-0.5">{v.class_society}</div>}
                  </div>
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${statusDot(v)}`} />
                </div>
              </div>
            )) : (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                <ShieldCheck size={24} className="mb-2 opacity-30" />
                <p className="text-xs">No vessels found</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Detail ──────────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {selected ? (
            <>
              {/* Vessel header */}
              <div className={`px-8 py-5 border-b ${D.border} shrink-0`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-[#0FA390]/10 flex items-center justify-center shrink-0">
                      <ShieldCheck size={24} className="text-[#0FA390]" />
                    </div>
                    <div>
                      <h2 className="font-heading font-bold text-2xl text-white">{selected.name || `IMO ${selected.imo}`}</h2>
                      <p className="text-xs text-gray-400 mt-0.5">
                        IMO: {selected.imo}
                        {selected.vessel_type && ` · ${selected.vessel_type}`}
                        {selected.class_society && ` · ${selected.class_society}`}
                        {selected.flag && ` · ${selected.flag}`}
                      </p>
                      {(selected.ship_owner || selected.ship_manager) && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {selected.ship_owner}{selected.ship_owner && selected.ship_manager ? ' | ' : ''}{selected.ship_manager}
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Summary badges */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-center px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
                      <div className="text-xl font-bold text-red-400 font-mono">{certSummary.expired}</div>
                      <div className="text-[9px] text-red-400 uppercase tracking-wide font-bold">Expired</div>
                    </div>
                    <div className="text-center px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                      <div className="text-xl font-bold text-amber-400 font-mono">{certSummary.atRisk}</div>
                      <div className="text-[9px] text-amber-400 uppercase tracking-wide font-bold">At Risk</div>
                    </div>
                    <div className="text-center px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                      <div className="text-xl font-bold text-emerald-400 font-mono">{certSummary.valid}</div>
                      <div className="text-[9px] text-emerald-400 uppercase tracking-wide font-bold">Valid</div>
                    </div>
                  </div>
                </div>

                {/* Urgent alert */}
                {urgentCert && (
                  <div className="mt-4 flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-semibold text-amber-400">
                        {urgentCert.name || urgentCert.cert_type || urgentCert.type} — {certDays(urgentCert) < 0 ? 'OVERDUE — immediate action required' : `due ${fmtDate(urgentCert.expiry_date)}`}
                      </div>
                      {certDays(urgentCert) < 0 && (
                        <div className="text-[11px] text-amber-500/70 mt-0.5">OVERDUE — immediate action required</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Tabs */}
              <div className={`flex border-b ${D.border} px-8 shrink-0`}>
                {[
                  { key: 'certificates', label: `Certificates (${certs.length})`, icon: ShieldCheck },
                  { key: 'surveys',      label: `Surveys (${surveys.length})`,     icon: ClipboardList },
                ].map(t => (
                  <button key={t.key} onClick={() => setTab(t.key)}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                      tab === t.key ? 'border-[#0FA390] text-[#0FA390]' : 'border-transparent text-gray-500 hover:text-gray-300'
                    }`}>
                    <t.icon size={14} />
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-auto px-8 py-6 relative">

                {/* Detail loading overlay */}
                {loadingDetail && (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#0a0e1b]/60 z-10">
                    <div className="spinner w-6 h-6" />
                  </div>
                )}

                {/* ── Certificates Tab ── */}
                {tab === 'certificates' && (
                  certs.length ? (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className={`border-b ${D.border}`}>
                          {['Certificate', 'Type', 'Issued', 'Expires', 'Days Left'].map(h => (
                            <th key={h} className="text-left py-3 px-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {certs.map((c, i) => {
                          const days    = certDays(c)
                          const expired = days !== null && days < 0
                          const expCls  = expired ? 'text-red-400' : days !== null && days < 20 ? 'text-amber-400' : days !== null && days < 60 ? 'text-yellow-400' : 'text-emerald-400'
                          const certCat = c.cert_category || c.category || ((c.type || '').toLowerCase().includes('class') ? 'Class' : 'Statutory')
                          const certNo  = generateCertNo(selected.imo, i, c)
                          return (
                            <tr key={i} className={`border-b ${D.border} hover:bg-white/3 ${expired ? 'bg-red-500/5' : ''}`}>
                              <td className="py-3 px-3">
                                <div className="font-semibold text-white">{c.name || c.cert_type || c.type || `Certificate ${i+1}`}</div>
                                <div className="text-[10px] text-gray-500 font-mono mt-0.5">{certNo}</div>
                              </td>
                              <td className="py-3 px-3">
                                <span className={`text-[10px] px-2 py-0.5 rounded border ${D.border} text-gray-400`}>{certCat}</span>
                              </td>
                              <td className="py-3 px-3 text-gray-400">{fmtDateShort(c.issue_date)}</td>
                              <td className={`py-3 px-3 font-semibold ${expCls}`}>{fmtDateShort(c.expiry_date)}</td>
                              <td className="py-3 px-3"><DaysLeftBadge days={days} /></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                      <ShieldCheck size={32} className="mb-2 opacity-20" />
                      <p className="text-sm">No certificate data</p>
                    </div>
                  )
                )}

                {/* ── Surveys Tab ── */}
                {tab === 'surveys' && (
                  surveys.length ? (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className={`border-b ${D.border}`}>
                          {['Survey', 'Category', 'Due Date', 'Assigned', 'Range', 'Status'].map(h => (
                            <th key={h} className="text-left py-3 px-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {surveys.map((s, i) => {
                          const dueCls = s.status === 'overdue' ? 'text-red-400' : s.status === 'due_soon' ? 'text-amber-400' : 'text-emerald-400'
                          return (
                            <tr key={i} className={`border-b ${D.border} hover:bg-white/3 ${s.status === 'overdue' ? 'bg-red-500/5' : ''}`}>
                              <td className="py-3 px-3 font-semibold text-white">{s.name}</td>
                              <td className="py-3 px-3">
                                <span className={`text-[10px] px-2 py-0.5 rounded border ${D.border} text-gray-400`}>{s.category}</span>
                              </td>
                              <td className={`py-3 px-3 font-semibold ${dueCls}`}>{fmtDateShort(s.due_date)}</td>
                              <td className="py-3 px-3 text-gray-400">{fmtDateShort(s.assigned)}</td>
                              <td className="py-3 px-3 text-gray-500 text-[10px]">
                                {s.range_from && s.due_date ? `${fmtDateShort(s.range_from)} – ${fmtDateShort(s.due_date)}` : '—'}
                              </td>
                              <td className="py-3 px-3"><SurveyStatusBadge status={s.status} /></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                      <ClipboardList size={32} className="mb-2 opacity-20" />
                      <p className="text-sm">No survey data</p>
                    </div>
                  )
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <ShieldCheck size={36} className="mx-auto mb-3 opacity-20" />
                <p className="text-sm">Select a vessel to view compliance details</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
