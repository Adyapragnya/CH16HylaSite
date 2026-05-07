import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ClipboardList,
  Filter,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Ship,
  X,
} from 'lucide-react'
import { vesselAPI } from '../lib/api'
import { certDays, deriveSurveys, fmtDate, fmtDateShort, generateCertNo } from '../lib/utils'

const STATUS_OPTIONS = [
  { key: 'all',      label: 'All Certificates',    icon: ShieldCheck, tone: 'teal' },
  { key: 'expired',  label: 'Expired',             icon: ShieldX,     tone: 'red' },
  { key: 'critical', label: 'Critical (<20 days)', icon: ShieldAlert, tone: 'amber' },
  { key: 'warning',  label: 'Warning (<60 days)',  icon: AlertTriangle, tone: 'yellow' },
]

const STATUS_STYLES = {
  all:      'bg-[#e7f5f2] text-[#0B7C6E] border-[#9bd4cc]',
  expired:  'text-red-600 hover:bg-red-50',
  critical: 'text-amber-600 hover:bg-amber-50',
  warning:  'text-yellow-600 hover:bg-yellow-50',
}

function getStatus(vessel) {
  const s = vessel.cert_status || vessel.status
  return ['expired', 'critical', 'warning', 'valid'].includes(s) ? s : 'valid'
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)))
}

function SelectFilter({ label, value, options, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-600">{label}</span>
      <span className="relative block">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="h-10 w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-9 text-sm font-medium text-slate-900 outline-none transition focus:border-[#0B7C6E] focus:ring-2 focus:ring-[#0B7C6E]/15"
        >
          <option value="">{placeholder}</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
      </span>
    </label>
  )
}

function DaysLeftBadge({ days }) {
  if (days === null) return <span className="text-slate-400">-</span>
  if (days < 0)  return <span className="rounded bg-red-100 px-2 py-0.5 font-mono text-[10px] font-bold text-red-700">EXPIRED</span>
  if (days < 20) return <span className="font-mono text-[11px] font-bold text-amber-700">{days}d</span>
  if (days < 60) return <span className="font-mono text-[11px] font-semibold text-yellow-700">{days}d</span>
  return <span className="font-mono text-[11px] text-emerald-700">{days}d</span>
}

function SurveyStatusBadge({ status }) {
  if (status === 'overdue')  return <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">Overdue</span>
  if (status === 'due_soon') return <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Due Soon</span>
  return <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">OK</span>
}

export default function ComplianceView() {
  const [vessels,           setVessels]           = useState([])
  const [selected,          setSelected]          = useState(null)
  const [loadingList,       setLoadingList]       = useState(true)
  const [loadingDetail,     setLoadingDetail]     = useState(false)
  const [port,              setPort]              = useState('')
  const [status,            setStatus]            = useState('all')
  const [manager,           setManager]           = useState('')
  const [owner,             setOwner]             = useState('')
  const [classSociety,      setClassSociety]      = useState('')
  const [shipType,          setShipType]          = useState('')
  const [search,            setSearch]            = useState('')
  const [tab,               setTab]               = useState('certificates')
  const [sidebarCollapsed,  setSidebarCollapsed]  = useState(false)
  const [certsOnly,         setCertsOnly]         = useState(false)
  // mobile: 'list' shows the sidebar/vessel list, 'detail' shows the cert detail
  const [mobilePanel,       setMobilePanel]       = useState('list')
  // mobile: filter drawer (subset of sidebar)
  const [filterDrawer,      setFilterDrawer]      = useState(false)

  const selectVessel = useCallback(async (vessel) => {
    setSelected(vessel)
    setMobilePanel('detail')
    setLoadingDetail(true)
    try {
      const res = await vesselAPI.certificates(vessel.imo)
      const certs = res.data.certificates || []
      setSelected(prev => prev?.imo === vessel.imo ? { ...prev, certificates: certs } : prev)
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  const loadVessels = useCallback((flag) => {
    setLoadingList(true)
    setVessels([])
    setSelected(null)
    setMobilePanel('list')
    const params = { limit: 10000, sort_by: 'cert_urgency' }
    if (flag) params.has_certs = true
    vesselAPI.list(params)
      .then(r => {
        const data = r.data.data || []
        setVessels(data)
        if (data.length) selectVessel(data[0])
      })
      .finally(() => setLoadingList(false))
  }, [selectVessel])

  useEffect(() => { loadVessels(certsOnly) }, [certsOnly, loadVessels])

  const filters = useMemo(() => ({
    ports:         uniq(vessels.map(v => v.port)),
    managers:      uniq(vessels.map(v => v.ship_manager || v.manager)),
    owners:        uniq(vessels.map(v => v.ship_owner || v.owner)),
    classSocieties:uniq(vessels.map(v => v.class_society)),
    shipTypes:     uniq(vessels.map(v => v.vessel_type || v.spire_type)),
  }), [vessels])

  const statusCounts = useMemo(() => {
    const c = { all: vessels.length, expired: 0, critical: 0, warning: 0, valid: 0 }
    vessels.forEach(v => { c[getStatus(v)] += 1 })
    return c
  }, [vessels])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return vessels.filter(v => {
      if (port && v.port !== port) return false
      if (status !== 'all' && getStatus(v) !== status) return false
      if (manager && (v.ship_manager || v.manager) !== manager) return false
      if (owner && (v.ship_owner || v.owner) !== owner) return false
      if (classSociety && v.class_society !== classSociety) return false
      if (shipType && (v.vessel_type || v.spire_type) !== shipType) return false
      if (!q) return true
      return String(v.name || '').toLowerCase().includes(q) || String(v.imo || '').includes(q)
    })
  }, [vessels, port, status, manager, owner, classSociety, shipType, search])

  const certs   = selected?.certificates || []
  const surveys = useMemo(() => deriveSurveys(certs), [certs])

  const certSummary = useMemo(() => {
    let expired = 0, atRisk = 0, valid = 0
    certs.forEach(c => {
      const d = certDays(c)
      if (d === null) return
      if (d < 0) expired++; else if (d < 20) atRisk++; else valid++
    })
    return { expired, atRisk, valid }
  }, [certs])

  const urgentCert = useMemo(() => certs.find(c => { const d = certDays(c); return d !== null && d < 20 }), [certs])

  const selectFirstInCurrentPort = (value) => {
    setPort(value)
    const first = vessels.find(v => !value || v.port === value)
    if (first) selectVessel(first)
  }

  const statusDot = (v) => ({
    expired: 'bg-red-500', critical: 'bg-amber-500', warning: 'bg-yellow-400', valid: 'bg-emerald-500',
  }[getStatus(v)] || 'bg-slate-300')

  // Shared sidebar filter content (used in both desktop aside and mobile drawer)
  const SidebarContent = () => (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="space-y-5 border-b border-slate-200 p-4">
        {/* Port filter */}
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">Ports</div>
          <button
            type="button"
            onClick={() => { selectFirstInCurrentPort(''); setFilterDrawer(false) }}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold ${port ? 'text-slate-700 hover:bg-slate-50' : 'bg-[#e7f5f2] text-[#0B7C6E] ring-1 ring-[#9bd4cc]'}`}
          >
            <span>All Ports</span>
            <span className="font-mono text-xs">{vessels.length}</span>
          </button>
          {filters.ports.slice(0, 6).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => { selectFirstInCurrentPort(p); setFilterDrawer(false) }}
              className={`mt-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm ${port === p ? 'bg-[#e7f5f2] font-semibold text-[#0B7C6E] ring-1 ring-[#9bd4cc]' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              <span className="truncate">{p}</span>
              <span className="font-mono text-xs">{vessels.filter(v => v.port === p).length}</span>
            </button>
          ))}
        </div>

        {/* Cert status filter */}
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">Cert Status</div>
          <div className="space-y-1">
            {STATUS_OPTIONS.map(opt => {
              const Icon = opt.icon
              const active = status === opt.key
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => { setStatus(opt.key); setFilterDrawer(false) }}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${active ? STATUS_STYLES.all : `border-transparent ${STATUS_STYLES[opt.key] || 'text-slate-700 hover:bg-slate-50'}`}`}
                >
                  <span className="flex min-w-0 items-center gap-2"><Icon size={14} /><span className="truncate">{opt.label}</span></span>
                  <span className="font-mono text-xs font-bold text-slate-600">{statusCounts[opt.key] || 0}</span>
                </button>
              )
            })}
          </div>
        </div>

        <SelectFilter label="Manager"      value={manager}      options={filters.managers}       onChange={setManager}      placeholder="All Managers" />
        <SelectFilter label="Owner"        value={owner}        options={filters.owners}         onChange={setOwner}        placeholder="All Owners" />
        <SelectFilter label="Class Society" value={classSociety} options={filters.classSocieties} onChange={setClassSociety} placeholder="All Societies" />
        <SelectFilter label="Ship Type"    value={shipType}     options={filters.shipTypes}      onChange={setShipType}     placeholder="All Types" />
      </div>

      {/* Overview */}
      <div className="border-b border-slate-200 p-4">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">Overview</div>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-slate-700"><Ship size={14} className="text-[#0B7C6E]" />Vessels</span>
            <span className="font-mono font-bold text-slate-950">{filtered.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-slate-700"><AlertTriangle size={14} className="text-amber-500" />Certs Expiring</span>
            <span className="font-mono font-bold text-slate-950">{statusCounts.critical + statusCounts.warning}</span>
          </div>
        </div>
      </div>

      {/* Vessel list */}
      <div className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Vessels ({filtered.length})</div>
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
            <input
              type="checkbox"
              checked={certsOnly}
              onChange={() => setCertsOnly(v => !v)}
              className="h-3.5 w-3.5 rounded border-slate-300 accent-[#0B7C6E]"
            />
            Certs only
          </label>
        </div>
        <div className="relative mb-3">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search vessel..."
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#0B7C6E] focus:ring-2 focus:ring-[#0B7C6E]/15"
          />
        </div>
        <div className="space-y-1">
          {loadingList ? (
            <div className="flex justify-center py-10"><div className="spinner h-5 w-5" /></div>
          ) : filtered.length ? filtered.map(v => (
            <button
              key={v.imo}
              type="button"
              onClick={() => selectVessel(v)}
              className={`w-full rounded-lg border px-3 py-3 text-left transition ${selected?.imo === v.imo ? 'border-[#0B7C6E] bg-[#e7f5f2]' : 'border-transparent hover:border-slate-200 hover:bg-slate-50'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-slate-950">{v.name || `IMO ${v.imo}`}</div>
                  <div className="mt-0.5 truncate text-[10px] text-slate-500">IMO: {v.imo} · {v.vessel_type || v.spire_type || '—'}</div>
                  {v.class_society && <div className="mt-0.5 truncate text-[10px] font-medium text-[#0B7C6E]">{v.class_society}</div>}
                </div>
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${statusDot(v)}`} />
              </div>
            </button>
          )) : (
            <div className="py-10 text-center text-xs text-slate-500">No vessels found</div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-slate-50 text-slate-950">

      {/* ── Top header ── */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 md:items-end md:gap-4 md:px-8 md:py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e7f5f2] text-[#0B7C6E] md:h-11 md:w-11">
            <ShieldCheck size={20} className="md:hidden" />
            <ShieldCheck size={23} className="hidden md:block" />
          </div>
          <div>
            <h1 className="font-heading text-xl font-bold leading-none text-slate-950 md:text-3xl">Compliance</h1>
            <p className="mt-0.5 hidden text-sm text-slate-600 md:block">Certificate &amp; Survey status for LSA/FFA specialists</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Mobile filter button */}
          <button
            type="button"
            onClick={() => setFilterDrawer(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 md:hidden"
            title="Filters"
          >
            <Filter size={16} />
          </button>

          {/* Port selector — desktop only */}
          <div className="relative hidden min-w-[180px] md:block">
            <select
              value={port}
              onChange={e => selectFirstInCurrentPort(e.target.value)}
              className="h-11 w-full appearance-none rounded-lg border border-slate-200 bg-white px-4 pr-10 text-sm font-semibold text-slate-950 outline-none focus:border-[#0B7C6E] focus:ring-2 focus:ring-[#0B7C6E]/15"
            >
              <option value="">All Ports</option>
              {filters.ports.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
          </div>
        </div>
      </div>

      {/* ── Mobile filter drawer ── */}
      {filterDrawer && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setFilterDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-600">
                <Filter size={14} className="text-[#0B7C6E]" />Filters
              </div>
              <button type="button" onClick={() => setFilterDrawer(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
                <X size={16} />
              </button>
            </div>
            <SidebarContent />
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ── Desktop sidebar ── */}
        <aside className={`hidden md:flex ${sidebarCollapsed ? 'md:w-16' : 'md:w-80'} shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200`}>
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
            {!sidebarCollapsed && (
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-600">
                <Filter size={15} className="text-[#0B7C6E]" />Filters
              </div>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed(v => !v)}
              className={`flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 ${sidebarCollapsed ? 'mx-auto' : ''}`}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
          </div>
          {sidebarCollapsed ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <ShieldCheck size={18} className="text-[#0B7C6E]" />
              <Ship size={18} className="text-slate-500" />
              <AlertTriangle size={18} className="text-amber-500" />
            </div>
          ) : (
            <SidebarContent />
          )}
        </aside>

        {/* ── Mobile: vessel list panel (full screen when mobilePanel='list') ── */}
        <div className={`${mobilePanel === 'list' ? 'flex' : 'hidden'} md:hidden w-full flex-col overflow-y-auto bg-white`}>
          <SidebarContent />
        </div>

        {/* ── Detail section ── */}
        <section className={`${mobilePanel === 'detail' ? 'flex' : 'hidden'} md:flex min-w-0 flex-1 flex-col overflow-hidden`}>

          {/* Mobile back button */}
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 py-3 md:hidden">
            <button
              type="button"
              onClick={() => setMobilePanel('list')}
              className="flex items-center gap-1.5 text-sm font-semibold text-[#0B7C6E]"
            >
              <ArrowLeft size={16} /> Vessels
            </button>
          </div>

          {selected ? (
            <div className="flex h-full flex-col">

              {/* Vessel header */}
              <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-4 md:px-8 md:py-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e7f5f2] text-[#0B7C6E] md:h-12 md:w-12">
                      <ShieldCheck size={20} />
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate font-heading text-lg font-bold text-slate-950 md:text-2xl">{selected.name || `IMO ${selected.imo}`}</h2>
                      <p className="mt-0.5 text-xs text-slate-600">
                        IMO: {selected.imo}
                        {selected.vessel_type && ` · ${selected.vessel_type}`}
                        {selected.class_society && ` · ${selected.class_society}`}
                        {selected.flag && ` · ${selected.flag}`}
                      </p>
                      {(selected.ship_owner || selected.ship_manager) && (
                        <p className="mt-0.5 text-xs text-slate-600">
                          {selected.ship_owner}{selected.ship_owner && selected.ship_manager ? ' | ' : ''}{selected.ship_manager}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Summary badges */}
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-center md:px-4 md:py-2">
                      <div className="font-mono text-base font-bold text-red-600 md:text-xl">{certSummary.expired}</div>
                      <div className="text-[9px] font-bold uppercase tracking-wide text-red-600">Expired</div>
                    </div>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-center md:px-4 md:py-2">
                      <div className="font-mono text-base font-bold text-amber-600 md:text-xl">{certSummary.atRisk}</div>
                      <div className="text-[9px] font-bold uppercase tracking-wide text-amber-600">At Risk</div>
                    </div>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-center md:px-4 md:py-2">
                      <div className="font-mono text-base font-bold text-emerald-600 md:text-xl">{certSummary.valid}</div>
                      <div className="text-[9px] font-bold uppercase tracking-wide text-emerald-600">Valid</div>
                    </div>
                  </div>
                </div>

                {urgentCert && (
                  <div className="mt-3 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                    <div>
                      <div className="text-xs font-semibold text-amber-800">
                        {urgentCert.name || urgentCert.cert_type || urgentCert.type} — {certDays(urgentCert) < 0 ? 'OVERDUE' : `due ${fmtDate(urgentCert.expiry_date)}`}
                      </div>
                      {certDays(urgentCert) < 0 && (
                        <div className="mt-0.5 text-[11px] text-amber-700">Immediate action required</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Tabs */}
              <div className="flex shrink-0 border-b border-slate-200 bg-white px-4 md:px-8">
                {[
                  { key: 'certificates', label: `Certs (${certs.length})`,   icon: ShieldCheck },
                  { key: 'surveys',      label: `Surveys (${surveys.length})`, icon: ClipboardList },
                ].map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setTab(item.key)}
                    className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-3 text-xs font-semibold transition md:gap-2 md:px-4 md:text-sm ${tab === item.key ? 'border-[#0B7C6E] text-[#0B7C6E]' : 'border-transparent text-slate-500 hover:text-slate-900'}`}
                  >
                    <item.icon size={13} />{item.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="relative flex-1 overflow-auto bg-slate-50 px-4 py-4 md:px-8 md:py-6">
                {loadingDetail && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70">
                    <div className="spinner h-6 w-6" />
                  </div>
                )}

                {tab === 'certificates' && (
                  certs.length ? (
                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                      <table className="w-full min-w-[520px] text-xs">
                        <thead className="bg-slate-50">
                          <tr className="border-b border-slate-200">
                            {['Certificate', 'Type', 'Issued', 'Expires', 'Days Left'].map(h => (
                              <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {certs.map((cert, i) => {
                            const days = certDays(cert)
                            const expired = days !== null && days < 0
                            const expCls = expired ? 'text-red-600' : days !== null && days < 20 ? 'text-amber-700' : days !== null && days < 60 ? 'text-yellow-700' : 'text-emerald-700'
                            const cat = cert.cert_category || cert.category || ((cert.type || '').toLowerCase().includes('class') ? 'Class' : 'Statutory')
                            return (
                              <tr key={i} className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 ${expired ? 'bg-red-50/70' : ''}`}>
                                <td className="px-4 py-3">
                                  <div className="font-semibold text-slate-950">{cert.name || cert.cert_type || cert.type || `Certificate ${i + 1}`}</div>
                                  <div className="mt-0.5 font-mono text-[10px] text-slate-500">{generateCertNo(selected.imo, i, cert)}</div>
                                </td>
                                <td className="px-4 py-3"><span className="rounded border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600">{cat}</span></td>
                                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{fmtDateShort(cert.issue_date)}</td>
                                <td className={`whitespace-nowrap px-4 py-3 font-semibold ${expCls}`}>{fmtDateShort(cert.expiry_date)}</td>
                                <td className="px-4 py-3"><DaysLeftBadge days={days} /></td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                      <ShieldCheck size={32} className="mb-2 opacity-30" />
                      <p className="text-sm">No certificate data</p>
                    </div>
                  )
                )}

                {tab === 'surveys' && (
                  surveys.length ? (
                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                      <table className="w-full min-w-[560px] text-xs">
                        <thead className="bg-slate-50">
                          <tr className="border-b border-slate-200">
                            {['Survey', 'Category', 'Due Date', 'Assigned', 'Range', 'Status'].map(h => (
                              <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {surveys.map((sv, i) => {
                            const dueCls = sv.status === 'overdue' ? 'text-red-600' : sv.status === 'due_soon' ? 'text-amber-700' : 'text-emerald-700'
                            return (
                              <tr key={i} className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 ${sv.status === 'overdue' ? 'bg-red-50/70' : ''}`}>
                                <td className="px-4 py-3 font-semibold text-slate-950">{sv.name}</td>
                                <td className="px-4 py-3"><span className="rounded border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600">{sv.category}</span></td>
                                <td className={`whitespace-nowrap px-4 py-3 font-semibold ${dueCls}`}>{fmtDateShort(sv.due_date)}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{fmtDateShort(sv.assigned)}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-[10px] text-slate-500">
                                  {sv.range_from && sv.due_date ? `${fmtDateShort(sv.range_from)} – ${fmtDateShort(sv.due_date)}` : '—'}
                                </td>
                                <td className="px-4 py-3"><SurveyStatusBadge status={sv.status} /></td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                      <ClipboardList size={32} className="mb-2 opacity-30" />
                      <p className="text-sm">No survey data</p>
                    </div>
                  )
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-slate-500">
              <div className="text-center">
                <ShieldCheck size={36} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">Select a vessel to view compliance details</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
