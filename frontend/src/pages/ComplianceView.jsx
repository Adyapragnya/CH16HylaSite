import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  AlertTriangle,
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
} from 'lucide-react'
import { vesselAPI } from '../lib/api'
import { certDays, deriveSurveys, fmtDate, fmtDateShort, generateCertNo } from '../lib/utils'

const STATUS_OPTIONS = [
  { key: 'all', label: 'All Certificates', icon: ShieldCheck, tone: 'teal' },
  { key: 'expired', label: 'Expired', icon: ShieldX, tone: 'red' },
  { key: 'critical', label: 'Critical (<20 days)', icon: ShieldAlert, tone: 'amber' },
  { key: 'warning', label: 'Warning (<60 days)', icon: AlertTriangle, tone: 'yellow' },
]

const STATUS_STYLES = {
  all: 'bg-[#e7f5f2] text-[#0B7C6E] border-[#9bd4cc]',
  expired: 'text-red-600 hover:bg-red-50',
  critical: 'text-amber-600 hover:bg-amber-50',
  warning: 'text-yellow-600 hover:bg-yellow-50',
}

function getStatus(vessel) {
  const status = vessel.cert_status || vessel.status
  return ['expired', 'critical', 'warning', 'valid'].includes(status) ? status : 'valid'
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
          onChange={event => onChange(event.target.value)}
          className="h-10 w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-9 text-sm font-medium text-slate-900 outline-none transition focus:border-[#0B7C6E] focus:ring-2 focus:ring-[#0B7C6E]/15"
        >
          <option value="">{placeholder}</option>
          {options.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
      </span>
    </label>
  )
}

function DaysLeftBadge({ days }) {
  if (days === null) return <span className="text-slate-400">-</span>
  if (days < 0) return <span className="rounded bg-red-100 px-2 py-0.5 font-mono text-[10px] font-bold text-red-700">EXPIRED</span>
  if (days < 20) return <span className="font-mono text-[11px] font-bold text-amber-700">{days}d</span>
  if (days < 60) return <span className="font-mono text-[11px] font-semibold text-yellow-700">{days}d</span>
  return <span className="font-mono text-[11px] text-emerald-700">{days}d</span>
}

function SurveyStatusBadge({ status }) {
  if (status === 'overdue') return <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">Overdue</span>
  if (status === 'due_soon') return <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Due Soon</span>
  return <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">OK</span>
}

export default function ComplianceView() {
  const [vessels, setVessels] = useState([])
  const [selected, setSelected] = useState(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [port, setPort] = useState('')
  const [status, setStatus] = useState('all')
  const [manager, setManager] = useState('')
  const [owner, setOwner] = useState('')
  const [classSociety, setClassSociety] = useState('')
  const [shipType, setShipType] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('certificates')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [certsOnly, setCertsOnly] = useState(true)

  const selectVessel = useCallback(async (vessel) => {
    setSelected(vessel)
    setLoadingDetail(true)
    try {
      const response = await vesselAPI.certificates(vessel.imo)
      const certificates = response.data.certificates || []
      setSelected(previous => previous?.imo === vessel.imo ? { ...previous, certificates } : previous)
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  const loadVessels = useCallback((certsOnlyFlag) => {
    setLoadingList(true)
    setVessels([])
    setSelected(null)

    const params = { limit: 10000, sort_by: 'cert_urgency' }
    if (certsOnlyFlag) params.has_certs = true

    vesselAPI.list(params)
      .then(response => {
        const data = response.data.data || []
        setVessels(data)
        if (data.length) selectVessel(data[0])
      })
      .finally(() => setLoadingList(false))
  }, [selectVessel])

  useEffect(() => { loadVessels(certsOnly) }, [certsOnly, loadVessels])

  const filters = useMemo(() => ({
    ports: uniq(vessels.map(v => v.port)),
    managers: uniq(vessels.map(v => v.ship_manager || v.manager)),
    owners: uniq(vessels.map(v => v.ship_owner || v.owner)),
    classSocieties: uniq(vessels.map(v => v.class_society)),
    shipTypes: uniq(vessels.map(v => v.vessel_type || v.spire_type)),
  }), [vessels])

  const statusCounts = useMemo(() => {
    const counts = { all: vessels.length, expired: 0, critical: 0, warning: 0, valid: 0 }
    vessels.forEach(v => { counts[getStatus(v)] += 1 })
    return counts
  }, [vessels])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return vessels.filter(v => {
      if (port && v.port !== port) return false
      if (status !== 'all' && getStatus(v) !== status) return false
      if (manager && (v.ship_manager || v.manager) !== manager) return false
      if (owner && (v.ship_owner || v.owner) !== owner) return false
      if (classSociety && v.class_society !== classSociety) return false
      if (shipType && (v.vessel_type || v.spire_type) !== shipType) return false
      if (!query) return true
      return String(v.name || '').toLowerCase().includes(query) || String(v.imo || '').includes(query)
    })
  }, [vessels, port, status, manager, owner, classSociety, shipType, search])

  const certs = selected?.certificates || []
  const surveys = useMemo(() => deriveSurveys(certs), [certs])

  const certSummary = useMemo(() => {
    let expired = 0
    let atRisk = 0
    let valid = 0
    certs.forEach(cert => {
      const days = certDays(cert)
      if (days === null) return
      if (days < 0) expired += 1
      else if (days < 20) atRisk += 1
      else valid += 1
    })
    return { expired, atRisk, valid }
  }, [certs])

  const urgentCert = useMemo(() => (
    certs.find(cert => {
      const days = certDays(cert)
      return days !== null && days < 20
    })
  ), [certs])

  const selectFirstInCurrentPort = (value) => {
    setPort(value)
    const first = vessels.find(v => !value || v.port === value)
    if (first) selectVessel(first)
  }

  const statusDot = (vessel) => ({
    expired: 'bg-red-500',
    critical: 'bg-amber-500',
    warning: 'bg-yellow-400',
    valid: 'bg-emerald-500',
  }[getStatus(vessel)] || 'bg-slate-300')

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-slate-50 text-slate-950">
      <div className="flex shrink-0 items-end justify-between gap-4 border-b border-slate-200 bg-white px-8 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e7f5f2] text-[#0B7C6E]">
            <ShieldCheck size={23} />
          </div>
          <div>
            <h1 className="font-heading text-3xl font-bold leading-none text-slate-950">Compliance</h1>
            <p className="mt-1 text-sm text-slate-600">Certificate & Survey status for LSA/FFA specialists</p>
          </div>
        </div>

        <div className="relative min-w-[200px]">
          <select
            value={port}
            onChange={event => selectFirstInCurrentPort(event.target.value)}
            className="h-11 w-full appearance-none rounded-lg border border-slate-200 bg-white px-4 pr-10 text-sm font-semibold text-slate-950 outline-none focus:border-[#0B7C6E] focus:ring-2 focus:ring-[#0B7C6E]/15"
          >
            <option value="">All Ports</option>
            {filters.ports.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className={`${sidebarCollapsed ? 'w-16' : 'w-80'} shrink-0 border-r border-slate-200 bg-white transition-[width] duration-200`}>
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              {!sidebarCollapsed && (
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-600">
                  <Filter size={15} className="text-[#0B7C6E]" />
                  Filters
                </div>
              )}
              <button
                type="button"
                onClick={() => setSidebarCollapsed(value => !value)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
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
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-5 border-b border-slate-200 p-4">
                  <div>
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">Ports</div>
                    <button
                      type="button"
                      onClick={() => selectFirstInCurrentPort('')}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold ${port ? 'text-slate-700 hover:bg-slate-50' : 'bg-[#e7f5f2] text-[#0B7C6E] ring-1 ring-[#9bd4cc]'}`}
                    >
                      <span>All Ports</span>
                      <span className="font-mono text-xs">{vessels.length}</span>
                    </button>
                    {filters.ports.slice(0, 5).map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => selectFirstInCurrentPort(p)}
                        className={`mt-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm ${port === p ? 'bg-[#e7f5f2] font-semibold text-[#0B7C6E] ring-1 ring-[#9bd4cc]' : 'text-slate-700 hover:bg-slate-50'}`}
                      >
                        <span className="truncate">{p}</span>
                        <span className="font-mono text-xs">{vessels.filter(v => v.port === p).length}</span>
                      </button>
                    ))}
                  </div>

                  <div>
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">Cert Status</div>
                    <div className="space-y-1">
                      {STATUS_OPTIONS.map(option => {
                        const Icon = option.icon
                        const active = status === option.key
                        return (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => setStatus(option.key)}
                            className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${active ? STATUS_STYLES.all : `border-transparent ${STATUS_STYLES[option.key] || 'text-slate-700 hover:bg-slate-50'}`}`}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <Icon size={14} />
                              <span className="truncate">{option.label}</span>
                            </span>
                            <span className="font-mono text-xs font-bold text-slate-600">{statusCounts[option.key] || 0}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <SelectFilter label="Manager" value={manager} options={filters.managers} onChange={setManager} placeholder="All Managers" />
                  <SelectFilter label="Owner" value={owner} options={filters.owners} onChange={setOwner} placeholder="All Owners" />
                  <SelectFilter label="Class Society" value={classSociety} options={filters.classSocieties} onChange={setClassSociety} placeholder="All Societies" />
                  <SelectFilter label="Ship Type" value={shipType} options={filters.shipTypes} onChange={setShipType} placeholder="All Types" />
                </div>

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

                <div className="p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Vessels ({filtered.length})</div>
                    <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
                      <input
                        type="checkbox"
                        checked={certsOnly}
                        onChange={() => setCertsOnly(value => !value)}
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-[#0B7C6E]"
                      />
                      Certs only
                    </label>
                  </div>
                  <div className="relative mb-3">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={search}
                      onChange={event => setSearch(event.target.value)}
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
                            <div className="mt-0.5 truncate text-[10px] text-slate-500">IMO: {v.imo} - {v.vessel_type || v.spire_type || '-'}</div>
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
            )}
          </div>
        </aside>

        <section className="min-w-0 flex-1 overflow-hidden">
          {selected ? (
            <div className="flex h-full flex-col">
              <div className="shrink-0 border-b border-slate-200 bg-white px-8 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#e7f5f2] text-[#0B7C6E]">
                      <ShieldCheck size={24} />
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate font-heading text-2xl font-bold text-slate-950">{selected.name || `IMO ${selected.imo}`}</h2>
                      <p className="mt-0.5 text-xs text-slate-600">
                        IMO: {selected.imo}
                        {selected.vessel_type && ` - ${selected.vessel_type}`}
                        {selected.class_society && ` - ${selected.class_society}`}
                        {selected.flag && ` - ${selected.flag}`}
                      </p>
                      {(selected.ship_owner || selected.ship_manager) && (
                        <p className="mt-0.5 text-xs text-slate-600">
                          {selected.ship_owner}{selected.ship_owner && selected.ship_manager ? ' | ' : ''}{selected.ship_manager}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-center">
                      <div className="font-mono text-xl font-bold text-red-600">{certSummary.expired}</div>
                      <div className="text-[9px] font-bold uppercase tracking-wide text-red-600">Expired</div>
                    </div>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-center">
                      <div className="font-mono text-xl font-bold text-amber-600">{certSummary.atRisk}</div>
                      <div className="text-[9px] font-bold uppercase tracking-wide text-amber-600">At Risk</div>
                    </div>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-center">
                      <div className="font-mono text-xl font-bold text-emerald-600">{certSummary.valid}</div>
                      <div className="text-[9px] font-bold uppercase tracking-wide text-emerald-600">Valid</div>
                    </div>
                  </div>
                </div>

                {urgentCert && (
                  <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
                    <div>
                      <div className="text-xs font-semibold text-amber-800">
                        {urgentCert.name || urgentCert.cert_type || urgentCert.type} - {certDays(urgentCert) < 0 ? 'OVERDUE - immediate action required' : `due ${fmtDate(urgentCert.expiry_date)}`}
                      </div>
                      {certDays(urgentCert) < 0 && (
                        <div className="mt-0.5 text-[11px] text-amber-700">OVERDUE - immediate action required</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex shrink-0 border-b border-slate-200 bg-white px-8">
                {[
                  { key: 'certificates', label: `Certificates (${certs.length})`, icon: ShieldCheck },
                  { key: 'surveys', label: `Surveys (${surveys.length})`, icon: ClipboardList },
                ].map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setTab(item.key)}
                    className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${tab === item.key ? 'border-[#0B7C6E] text-[#0B7C6E]' : 'border-transparent text-slate-500 hover:text-slate-900'}`}
                  >
                    <item.icon size={14} />
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="relative flex-1 overflow-auto bg-slate-50 px-8 py-6">
                {loadingDetail && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70">
                    <div className="spinner h-6 w-6" />
                  </div>
                )}

                {tab === 'certificates' && (
                  certs.length ? (
                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50">
                          <tr className="border-b border-slate-200">
                            {['Certificate', 'Type', 'Issued', 'Expires', 'Days Left'].map(header => (
                              <th key={header} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{header}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {certs.map((cert, index) => {
                            const days = certDays(cert)
                            const expired = days !== null && days < 0
                            const expiryClass = expired ? 'text-red-600' : days !== null && days < 20 ? 'text-amber-700' : days !== null && days < 60 ? 'text-yellow-700' : 'text-emerald-700'
                            const category = cert.cert_category || cert.category || ((cert.type || '').toLowerCase().includes('class') ? 'Class' : 'Statutory')
                            return (
                              <tr key={index} className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 ${expired ? 'bg-red-50/70' : ''}`}>
                                <td className="px-4 py-3">
                                  <div className="font-semibold text-slate-950">{cert.name || cert.cert_type || cert.type || `Certificate ${index + 1}`}</div>
                                  <div className="mt-0.5 font-mono text-[10px] text-slate-500">{generateCertNo(selected.imo, index, cert)}</div>
                                </td>
                                <td className="px-4 py-3">
                                  <span className="rounded border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600">{category}</span>
                                </td>
                                <td className="px-4 py-3 text-slate-600">{fmtDateShort(cert.issue_date)}</td>
                                <td className={`px-4 py-3 font-semibold ${expiryClass}`}>{fmtDateShort(cert.expiry_date)}</td>
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
                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50">
                          <tr className="border-b border-slate-200">
                            {['Survey', 'Category', 'Due Date', 'Assigned', 'Range', 'Status'].map(header => (
                              <th key={header} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{header}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {surveys.map((survey, index) => {
                            const dueClass = survey.status === 'overdue' ? 'text-red-600' : survey.status === 'due_soon' ? 'text-amber-700' : 'text-emerald-700'
                            return (
                              <tr key={index} className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 ${survey.status === 'overdue' ? 'bg-red-50/70' : ''}`}>
                                <td className="px-4 py-3 font-semibold text-slate-950">{survey.name}</td>
                                <td className="px-4 py-3">
                                  <span className="rounded border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600">{survey.category}</span>
                                </td>
                                <td className={`px-4 py-3 font-semibold ${dueClass}`}>{fmtDateShort(survey.due_date)}</td>
                                <td className="px-4 py-3 text-slate-600">{fmtDateShort(survey.assigned)}</td>
                                <td className="px-4 py-3 text-[10px] text-slate-500">
                                  {survey.range_from && survey.due_date ? `${fmtDateShort(survey.range_from)} - ${fmtDateShort(survey.due_date)}` : '-'}
                                </td>
                                <td className="px-4 py-3"><SurveyStatusBadge status={survey.status} /></td>
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
