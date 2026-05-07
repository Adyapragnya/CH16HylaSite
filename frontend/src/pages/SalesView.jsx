import { useState, useEffect, useMemo, useCallback } from 'react'
import { Phone, FileText, UserPlus, StickyNote, MapPin, Clock, ChevronDown, ChevronRight, AlertTriangle, Activity, X, Ship, ShieldCheck, ShieldX, ShieldAlert, XCircle, PanelLeftClose, PanelLeftOpen, Filter } from 'lucide-react'
import { vesselAPI, eventAPI } from '../lib/api'
import { toast } from 'sonner'
import { certDays, worstCertStatus, fmtDate, fmtETA, deriveSurveys, generateCertNo } from '../lib/utils'

// ── Region → ports mapping (case-insensitive keys) ───────────────
const PORT_REGION_MAP = {
  'INDIA':       ['MUMBAI','KANDLA','MUNDRA','TUTICORIN','CHENNAI','KOCHI','VIZHINJAM','VIZAG','HALDIA','PARADIP','GOA','NHAVA SHEVA','NHAVA','ENNORE'],
  'MIDDLE EAST': ['FUJAIRAH','JEBEL ALI','JEBEL','MESSAIEED','SALALAH','DAMMAM','ABU DHABI','RAS LAFFAN','MUSCAT','RUWAIS','JUBAIL','KHORFAKKAN'],
  'ASIA':        ['SINGAPORE','COLOMBO','PORT KLANG','KLANG','BUSAN','HONG KONG','SHANGHAI','YANGON','BANGKOK','LAEM CHABANG','NHAVA SHEVA'],
}

function portToRegion(port) {
  if (!port) return null
  const up = String(port).toUpperCase()
  for (const [region, ports] of Object.entries(PORT_REGION_MAP)) {
    if (ports.some(p => up.includes(p) || p.includes(up))) return region
  }
  return null
}

// ── Vessel journey stages ─────────────────────────────────────────
const VESSEL_STAGES = ['>7d','3d','24h','12h','Pilot','Breakwater','Berth','Cargo Ops','Unberth','Pilot Away']
const SERVICE_STAGES = ['Identified','Contacted','Quoted','Confirmed','Prepared','Dispatched','Delivered']
const STAGE_TOOLTIPS = {
  '>7d':        'Expected in port in more than 7 days — begin early outreach',
  '3d':         'Vessel arriving within 3 days — contact now for service booking',
  '24h':        'Arriving within 24 hours — confirm service readiness',
  '12h':        'Arriving within 12 hours — final pre-arrival checks',
  'Pilot':      'Pilot boarded — vessel entering port approach',
  'Breakwater': 'Vessel at breakwater — entering harbour',
  'Berth':      'Vessel alongside at berth — service delivery window open',
  'Cargo Ops':  'Cargo operations underway — optimal service window',
  'Unberth':    'Vessel departing berth — final service opportunity',
  'Pilot Away': 'Pilot disembarked — vessel leaving port',
}

// ── Helpers ───────────────────────────────────────────────────────
function findServiceCert(certs = [], svcType) {
  const key = svcType.toUpperCase()
  return certs.find(c => {
    const t = (c.type || c.cert_type || c.name || '').toUpperCase()
    if (key === 'LSA') return t.includes('LSA') || t.includes('LSAF') || t.includes('LIFE SAVING') || t.includes('LIFESAVING')
    if (key === 'FFA') return t.includes('FFA') || t.includes('FFAF') || t.includes('FIRE FIGHT') || t.includes('FIRE FIGHTING')
    return t.includes(key)
  }) || null
}

// ── Cert progress bar — uses pre-computed lsa_days / ffa_days ────
function CertBar({ svcType, vessel }) {
  const days = svcType === 'LSA' ? (vessel.lsa_days ?? null) : (vessel.ffa_days ?? null)

  const barColor = days === null ? 'bg-gray-200' : days < 0 ? 'bg-red-500' : days < 20 ? 'bg-amber-500' : days < 60 ? 'bg-yellow-400' : 'bg-emerald-500'
  const barW     = days === null ? 20 : days < 0 ? 100 : Math.min(100, Math.max(3, (days / 60) * 100))
  const label    = days === null ? '—' : days < 0 ? 'EXPIRED' : `${days}d`
  const lblCls   = days === null ? 'text-muted-foreground' : days < 0 ? 'text-red-600 font-bold' : days < 20 ? 'text-amber-600 font-semibold' : days < 60 ? 'text-yellow-600' : 'text-emerald-600'

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono font-semibold w-6 text-muted-foreground shrink-0">{svcType}</span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barW}%` }} />
      </div>
      <span className={`text-[10px] font-mono w-14 text-right shrink-0 ${lblCls}`}>{label}</span>
    </div>
  )
}

function SurveyStatusBadge({ status }) {
  if (status === 'overdue')  return <span className="text-[10px] font-bold bg-red-500/10 text-red-600 px-2 py-0.5 rounded border border-red-200">Overdue</span>
  if (status === 'due_soon') return <span className="text-[10px] font-bold bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded border border-amber-200">Due Soon</span>
  if (status === 'ok')       return <span className="text-[10px] font-bold bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded border border-emerald-200">OK</span>
  return <span className="text-[10px] text-muted-foreground">—</span>
}

// ── Vessel detail modal ───────────────────────────────────────────
function VesselModal({ vessel, onClose, loadingCerts }) {
  const [tab,          setTab]          = useState('certificates')
  const [hoveredStage, setHoveredStage] = useState(null)
  if (!vessel) return null

  const certs    = vessel.certificates || []
  const surveys  = deriveSurveys(certs)
  const svcTypes = vessel.service_types?.length ? vessel.service_types : inferServiceTypes(certs)
  const vStage   = vessel.berth ? 6 : vessel.port ? 5 : vessel.eta ? 2 : 0
  const sStage   = 1

  const hasSpecs = vessel.loa || vessel.dwt || vessel.gross_tonnage || vessel.year_built
  const etaHours = vessel.eta ? Math.round((new Date(vessel.eta) - Date.now()) / 3600000) : null

  const NAV_LABELS = {
    0: 'Under Way (Engine)', 1: 'At Anchor', 2: 'Not Under Command',
    3: 'Restricted Manoeuvrability', 4: 'Constrained by Draught',
    5: 'Moored', 6: 'Aground', 7: 'Engaged in Fishing',
    8: 'Under Way (Sailing)', 15: 'Undefined',
  }

  // Service window spans Pilot(4) through Unberth(8)
  const SVC_WIN_START = 4, SVC_WIN_END = 8

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-xl h-full bg-white border-l border-border shadow-2xl overflow-y-auto flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-border flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0B7C6E]/10 flex items-center justify-center shrink-0">
            <Ship size={20} className="text-[#0B7C6E]" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-heading font-bold text-lg text-foreground leading-tight">{vessel.name || `IMO ${vessel.imo}`}</h2>
            <p className="text-xs text-muted-foreground">
              IMO: {vessel.imo}{vessel.mmsi ? ` · MMSI: ${vessel.mmsi}` : ''}{vessel.callsign ? ` · ${vessel.callsign}` : ''} · {vessel.vessel_type || vessel.spire_type || 'Vessel'}
            </p>
            {(vessel.ship_owner || vessel.ship_manager) && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {vessel.ship_owner}{vessel.ship_owner && vessel.ship_manager ? ' | ' : ''}{vessel.ship_manager}
              </p>
            )}
            {vessel.class_society && (
              <p className="text-xs text-[#0B7C6E] font-medium mt-0.5">{vessel.class_society}</p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>

        {/* Geofence + Live Position strip */}
        {(vessel.geofence_name || vessel.lat) && (
          <div className={`px-5 py-3 border-b border-border ${vessel.geofence_flag === 'Inside' ? 'bg-[#0B7C6E]/8' : 'bg-blue-50/40'}`}>
            {/* Geofence badge row */}
            {vessel.geofence_name && (
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-1 rounded-full border ${
                  vessel.geofence_flag === 'Inside'
                    ? 'bg-[#0B7C6E] text-white border-[#0B7C6E]'
                    : 'bg-gray-100 text-muted-foreground border-border'
                }`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
                  {vessel.geofence_flag === 'Inside' ? 'INSIDE' : 'OUTSIDE'} — {vessel.geofence_name}
                </span>
                {vessel.geofence_entry && (
                  <span className="text-[10px] text-muted-foreground">
                    Since {fmtDate(vessel.geofence_entry)}
                  </span>
                )}
                {vessel.last_ais_update && (
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    AIS: {new Date(vessel.last_ais_update).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}
                  </span>
                )}
              </div>
            )}
            {/* Position row */}
            {vessel.lat && vessel.lon && (
              <div className="grid grid-cols-5 gap-2 text-[11px]">
                <div>
                  <div className="text-muted-foreground text-[9px] uppercase">Lat</div>
                  <div className="font-mono font-semibold">{Number(vessel.lat).toFixed(4)}°</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[9px] uppercase">Lon</div>
                  <div className="font-mono font-semibold">{Number(vessel.lon).toFixed(4)}°</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[9px] uppercase">Speed</div>
                  <div className="font-mono font-semibold">{vessel.speed != null ? `${vessel.speed} kn` : '—'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[9px] uppercase">Course</div>
                  <div className="font-mono font-semibold">{vessel.course != null ? `${vessel.course}°` : '—'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[9px] uppercase">Draught</div>
                  <div className="font-mono font-semibold">{vessel.draught != null ? `${vessel.draught}m` : '—'}</div>
                </div>
              </div>
            )}
            {vessel.nav_status != null && (
              <div className="mt-1.5 text-[10px] text-[#0B7C6E] font-medium">
                ● {NAV_LABELS[vessel.nav_status] || `Nav ${vessel.nav_status}`}
              </div>
            )}
          </div>
        )}

        {/* Vessel specs strip */}
        {hasSpecs && (
          <div className="px-5 py-3 border-b border-border bg-secondary/30">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Vessel Specifications</div>
            <div className="grid grid-cols-4 gap-3 text-[11px]">
              {vessel.loa && <div><div className="text-muted-foreground text-[9px]">LOA</div><div className="font-semibold">{vessel.loa}m</div></div>}
              {vessel.beam && <div><div className="text-muted-foreground text-[9px]">Beam</div><div className="font-semibold">{vessel.beam}m</div></div>}
              {vessel.max_draft && <div><div className="text-muted-foreground text-[9px]">Max Draft</div><div className="font-semibold">{vessel.max_draft}m</div></div>}
              {vessel.gross_tonnage && <div><div className="text-muted-foreground text-[9px]">GRT</div><div className="font-semibold">{Number(vessel.gross_tonnage).toLocaleString()}</div></div>}
              {vessel.dwt && <div><div className="text-muted-foreground text-[9px]">DWT</div><div className="font-semibold">{Number(vessel.dwt).toLocaleString()}</div></div>}
              {vessel.year_built && <div><div className="text-muted-foreground text-[9px]">Built</div><div className="font-semibold">{vessel.year_built}</div></div>}
              {vessel.flag && <div><div className="text-muted-foreground text-[9px]">Flag</div><div className="font-semibold">{vessel.flag}</div></div>}
              {vessel.locode && <div><div className="text-muted-foreground text-[9px]">LOCODE</div><div className="font-mono font-semibold">{vessel.locode}</div></div>}
            </div>
          </div>
        )}

        {/* Journey steppers */}
        <div className="px-5 pt-4 pb-3 border-b border-border">
          {/* Vessel Journey */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Vessel Journey</span>
            <span className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide">Service Window</span>
          </div>
          <div className="flex items-center gap-0 overflow-x-auto pb-1 select-none">
            {/* Pre-service stages 0–3 */}
            <div className="flex items-center shrink-0">
              {VESSEL_STAGES.slice(0, SVC_WIN_START).map((s, i) => {
                const isActive = i === vStage, isPast = i < vStage
                return (
                  <div key={s} className="flex items-center shrink-0">
                    <div className="flex flex-col items-center cursor-default"
                      onMouseEnter={() => setHoveredStage(s)} onMouseLeave={() => setHoveredStage(null)}>
                      <div className={`w-3 h-3 rounded-full border-2 transition-colors ${isActive?'bg-amber-500 border-amber-500':isPast?'bg-[#0B7C6E] border-[#0B7C6E]':'bg-background border-border'}`} />
                      <span className={`text-[9px] mt-0.5 whitespace-nowrap ${isActive?'text-amber-600 font-bold':isPast?'text-[#0B7C6E]':'text-muted-foreground'}`}>{s}</span>
                      {isActive && etaHours != null && <span className="text-[8px] text-amber-500">ETA ~{etaHours}h</span>}
                    </div>
                    <div className={`h-px w-5 ${i < vStage ? 'bg-[#0B7C6E]' : 'bg-border'}`} />
                  </div>
                )
              })}
            </div>
            {/* Service window stages 4–8 */}
            <div className="flex items-center border border-amber-300 bg-amber-50/70 rounded-lg px-2 pt-3 pb-1 shrink-0 relative">
              <span className="absolute top-0.5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-amber-500 whitespace-nowrap">SERVICE WINDOW</span>
              {VESSEL_STAGES.slice(SVC_WIN_START, SVC_WIN_END + 1).map((s, j) => {
                const i = j + SVC_WIN_START
                const isActive = i === vStage, isPast = i < vStage
                return (
                  <div key={s} className="flex items-center shrink-0">
                    <div className="flex flex-col items-center cursor-default"
                      onMouseEnter={() => setHoveredStage(s)} onMouseLeave={() => setHoveredStage(null)}>
                      <div className={`w-3 h-3 rounded-full border-2 transition-colors ${isActive?'bg-amber-500 border-amber-500':isPast?'bg-[#0B7C6E] border-[#0B7C6E]':'bg-background border-border'}`} />
                      <span className={`text-[9px] mt-0.5 whitespace-nowrap font-semibold ${isActive?'text-amber-600 font-bold':isPast?'text-[#0B7C6E]':'text-muted-foreground'}`}>{s}</span>
                      {isActive && <span className="text-[8px] text-amber-500">← you are here</span>}
                    </div>
                    {j < SVC_WIN_END - SVC_WIN_START && <div className={`h-px w-5 ${i < vStage ? 'bg-[#0B7C6E]' : 'bg-amber-300'}`} />}
                  </div>
                )
              })}
            </div>
            {/* Post-service stages 9+ */}
            <div className="flex items-center shrink-0">
              {VESSEL_STAGES.slice(SVC_WIN_END + 1).map((s, j) => {
                const i = j + SVC_WIN_END + 1
                const isActive = i === vStage, isPast = i < vStage
                return (
                  <div key={s} className="flex items-center shrink-0">
                    <div className={`h-px w-5 ${i <= vStage ? 'bg-[#0B7C6E]' : 'bg-border'}`} />
                    <div className="flex flex-col items-center cursor-default"
                      onMouseEnter={() => setHoveredStage(s)} onMouseLeave={() => setHoveredStage(null)}>
                      <div className={`w-3 h-3 rounded-full border-2 ${isActive?'bg-amber-500 border-amber-500':isPast?'bg-[#0B7C6E] border-[#0B7C6E]':'bg-background border-border'}`} />
                      <span className={`text-[9px] mt-0.5 whitespace-nowrap ${isActive?'text-amber-600 font-bold':isPast?'text-[#0B7C6E]':'text-muted-foreground'}`}>{s}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          {/* Tooltip description bar — shows on hover, never clipped */}
          <div className={`mt-2 min-h-[18px] text-[10px] text-center transition-opacity ${hoveredStage ? 'opacity-100' : 'opacity-0'}`}>
            <span className="bg-foreground text-background px-2 py-0.5 rounded text-[10px]">
              {hoveredStage ? STAGE_TOOLTIPS[hoveredStage] : ''}
            </span>
          </div>

          {/* LSA/FFA Service Journey */}
          <div className="mt-3">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">LSA/FFA Service Journey</span>
            <div className="flex items-center gap-0 overflow-x-auto mt-2 pb-1 select-none">
              {SERVICE_STAGES.map((s, i) => {
                const isActive = i === sStage, isPast = i < sStage
                return (
                  <div key={s} className="flex items-center shrink-0">
                    <div className="flex flex-col items-center">
                      <div className={`w-3 h-3 rounded-full border-2 ${isActive?'bg-emerald-500 border-emerald-500':isPast?'bg-[#0B7C6E] border-[#0B7C6E]':'bg-background border-border'}`} />
                      <span className={`text-[9px] mt-0.5 whitespace-nowrap ${isActive?'text-emerald-600 font-bold':isPast?'text-[#0B7C6E]':'text-muted-foreground'}`}>{s}</span>
                      {isActive && <span className="text-[8px] text-emerald-500">you are here</span>}
                    </div>
                    {i < SERVICE_STAGES.length - 1 && <div className={`h-px w-6 ${i < sStage ? 'bg-[#0B7C6E]' : 'bg-border'}`} />}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-5">
          {['certificates','surveys'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-xs font-semibold capitalize border-b-2 -mb-px transition-colors ${tab === t ? 'border-[#0B7C6E] text-[#0B7C6E]' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              {t === 'certificates' ? `Certificates (${certs.length})` : 'Surveys'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 p-5 relative">
          {loadingCerts && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-10">
              <div className="spinner w-5 h-5" />
            </div>
          )}
          {tab === 'certificates' && (
            certs.length ? (
              <div className="space-y-3">
                {certs.map((c, i) => {
                  const days     = certDays(c)
                  const status   = days === null ? null : days < 0 ? 'expired' : days < 20 ? 'critical' : days < 60 ? 'warning' : 'valid'
                  const dotCls   = { expired:'bg-red-500', critical:'bg-amber-500', warning:'bg-yellow-400', valid:'bg-emerald-500' }[status] || 'bg-gray-300'
                  const expCls   = { expired:'text-red-600 font-bold', critical:'text-amber-600 font-semibold', warning:'text-yellow-600', valid:'text-emerald-600' }[status] || 'text-muted-foreground'
                  const certType = c.cert_category || c.category || ((c.name || c.cert_type || '').toLowerCase().includes('class') ? 'Class' : 'Statutory')
                  const certNo   = generateCertNo(vessel.imo, i, c)
                  const term     = c.term || (status === 'expired' ? 'Short Term' : 'Full Term')
                  return (
                    <div key={i} className={`p-3 rounded-lg border border-border/60 ${status === 'expired' ? 'bg-red-500/5' : status === 'critical' ? 'bg-amber-500/5' : 'bg-muted/20'}`}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${dotCls}`} />
                          <div>
                            <div className="text-xs font-semibold text-foreground">{c.name || c.cert_type || c.type || `Certificate ${i+1}`}</div>
                            <div className="text-[10px] text-muted-foreground font-mono"># {certNo}</div>
                          </div>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground shrink-0">{certType}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-[10px]">
                        <div>
                          <div className="text-muted-foreground">Term</div>
                          <div className="text-foreground font-medium">{term}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Issue Date</div>
                          <div className="text-foreground">{fmtDate(c.issue_date || c.issued_date)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Expiry Date</div>
                          <div className={expCls}>{fmtDate(c.expiry_date || c.expiryDate)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Extended Until</div>
                          <div className="text-foreground">{fmtDate(c.extended_until || c.extendedUntil)}</div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <ShieldCheck size={32} className="mb-2 opacity-20" />
                <p className="text-sm">No certificate data</p>
              </div>
            )
          )}
          {tab === 'surveys' && (
            surveys.length ? (
              <div className="space-y-2">
                {surveys.map((sv, i) => (
                  <div key={i} className={`p-3 rounded-lg border border-border/60 ${sv.status === 'overdue' ? 'bg-red-500/5' : sv.status === 'due_soon' ? 'bg-amber-500/5' : 'bg-muted/20'}`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="text-xs font-semibold text-foreground">{sv.name}</div>
                        <span className="text-[10px] px-1.5 py-0 rounded bg-secondary border border-border text-muted-foreground">{sv.category}</span>
                      </div>
                      <SurveyStatusBadge status={sv.status} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                      <div>
                        <div className="text-muted-foreground">Due Date</div>
                        <div className={`font-medium ${sv.status === 'overdue' ? 'text-red-600' : sv.status === 'due_soon' ? 'text-amber-600' : 'text-foreground'}`}>{fmtDate(sv.due_date)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Assigned</div>
                        <div className="text-foreground">{fmtDate(sv.assigned)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Range From</div>
                        <div className="text-foreground">{fmtDate(sv.range_from)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <ShieldCheck size={32} className="mb-2 opacity-20" />
                <p className="text-sm">No certificate data to derive surveys</p>
              </div>
            )
          )}
        </div>
        <div className="px-5 py-2 border-t border-border text-[9px] text-muted-foreground text-center">⚡ Powered by HYLA</div>
      </div>
    </div>
  )
}

// Infer service types from cert names when service_types array is empty
function inferServiceTypes(certs = []) {
  const types = new Set()
  certs.forEach(c => {
    const t = (c.type || c.cert_type || c.name || '').toUpperCase()
    if (t.includes('LSA') || t.includes('LSAF') || t.includes('LIFE SAVING') || t.includes('LIFESAVING')) types.add('LSA')
    if (t.includes('FFA') || t.includes('FFAF') || t.includes('FIRE FIGHT') || t.includes('FIRE FIGHTING')) types.add('FFA')
  })
  return [...types]
}

// ── Vessel card ───────────────────────────────────────────────────
function VesselCard({ vessel, onClick }) {
  const [showOwner, setShowOwner] = useState(false)
  // Use pre-computed fields — no need to iterate certificates in the list view
  const status    = vessel.cert_status || 'none'
  const svcTypes  = vessel.service_types?.length
    ? vessel.service_types
    : [vessel.lsa_days != null ? 'LSA' : null, vessel.ffa_days != null ? 'FFA' : null].filter(Boolean)
  const borderCls = status === 'expired' ? 'border-l-red-500' : status === 'critical' ? 'border-l-amber-500' : status === 'warning' ? 'border-l-yellow-400' : 'border-l-transparent'
  const eta       = fmtETA(vessel.eta)
  const rel       = vessel.relationship || ''

  return (
    <div
      onClick={onClick}
      className={`bg-card border border-border border-l-4 ${borderCls} rounded-lg p-4 cursor-pointer hover:shadow-md transition-all hover:border-[#0B7C6E]/30 mb-3`}
    >
      {/* Row 1: Name + relationship */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="font-heading font-bold text-sm text-foreground">{vessel.name || `IMO ${vessel.imo}`}</div>
          <div className="text-[10px] text-muted-foreground">IMO: {vessel.imo} · {vessel.flag || '—'}</div>
        </div>
        {rel && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 border border-emerald-200 font-medium capitalize shrink-0">
            {rel}
          </span>
        )}
      </div>

      {/* Row 2: Type/class/location badges */}
      <div className="flex flex-wrap gap-1 mb-2">
        {(vessel.vessel_type || vessel.spire_type) && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-secondary border border-border text-foreground">{vessel.vessel_type || vessel.spire_type}</span>
        )}
        {vessel.class_society && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-[#0B7C6E]/10 border border-[#0B7C6E]/20 text-[#0B7C6E] font-semibold">{vessel.class_society}</span>
        )}
        {vessel.gross_tonnage && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-secondary border border-border text-muted-foreground">GT {Number(vessel.gross_tonnage).toLocaleString()}</span>
        )}
        {vessel.dwt && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-secondary border border-border text-muted-foreground">DWT {Number(vessel.dwt).toLocaleString()}</span>
        )}
      </div>

      {/* Row 3: Live location block */}
      {(vessel.port || vessel.eta || vessel.lat || vessel.geofence_name) && (
        <div className="mb-2 space-y-1.5">
          {/* AT PORT highlight — only when geofence confirmed Inside */}
          {vessel.geofence_flag === 'Inside' && vessel.port && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0B7C6E]/10 border border-[#0B7C6E]/30 text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#0B7C6E] shrink-0" />
              <span className="font-bold text-[#0B7C6E] uppercase tracking-wide text-[9px]">AT PORT</span>
              <span className="font-bold text-[#0B7C6E]">{vessel.port}</span>
              {vessel.berth && <span className="text-muted-foreground">· Berth {vessel.berth}</span>}
              {vessel.terminal && <span className="text-muted-foreground">· {vessel.terminal}</span>}
              {vessel.geofence_entry && (
                <span className="text-muted-foreground ml-auto text-[9px]">
                  since {new Date(vessel.geofence_entry).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}
                </span>
              )}
            </div>
          )}
          {/* Badge row */}
          <div className="flex flex-wrap gap-1.5 items-center">
            {eta && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock size={9} />ETA: {eta}
              </span>
            )}
            {vessel.berth && (
              <span className="text-[10px] text-muted-foreground">Berth: {vessel.berth}</span>
            )}
            {vessel.locode && (
              <span className="font-mono text-[9px] font-semibold bg-secondary border border-border px-1.5 py-0.5 rounded text-muted-foreground">{vessel.locode}</span>
            )}
            {vessel.last_ais_update && (
              <span className="text-[9px] text-muted-foreground ml-auto">
                AIS: {new Date(vessel.last_ais_update).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'})}
              </span>
            )}
            {vessel.lat && vessel.lon && (
              <span className="font-mono text-[9px] bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded">
                {Number(vessel.lat).toFixed(4)}°, {Number(vessel.lon).toFixed(4)}°
                {vessel.speed != null && <span className="ml-1 not-italic font-sans text-blue-400">{vessel.speed}kn</span>}
              </span>
            )}
          </div>
        </div>
      )}


      {/* Row 4: Service type badges */}
      {svcTypes.length > 0 && (
        <div className="flex gap-1 mb-2">
          {svcTypes.map(s => (
            <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-[#0B7C6E]/10 text-[#0B7C6E] border border-[#0B7C6E]/30 font-semibold">{s}</span>
          ))}
        </div>
      )}

      {/* Row 6: FROM / AT / NEXT */}
      <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
        <div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-wide font-semibold">FROM</div>
          <div className="font-medium text-foreground truncate">{vessel.last_port || '—'}</div>
        </div>
        <div className="text-center">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wide font-semibold">
            {vessel.geofence_flag === 'Inside' ? 'AT' : 'DEST'}
          </div>
          <div className={`font-semibold truncate ${vessel.geofence_flag === 'Inside' ? 'text-[#0B7C6E]' : 'text-muted-foreground'}`}>
            {vessel.port || vessel.destination || '—'}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wide font-semibold">NEXT</div>
          <div className="font-medium text-foreground truncate">{vessel.destination || '—'}</div>
        </div>
      </div>

      {/* Row 7: Owner/manager + powered by */}
      <div className="mt-2 pt-2 border-t border-border/50" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          {(vessel.ship_owner || vessel.ship_manager) ? (
            <button
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-[#0B7C6E] transition-colors"
              onClick={() => setShowOwner(s => !s)}
            >
              <FileText size={10} />Owner / Manager Details
              {showOwner ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          ) : <span />}
          <span className="text-[9px] text-muted-foreground/50">⚡ Powered by HYLA</span>
        </div>
        {showOwner && (vessel.ship_owner || vessel.ship_manager) && (
          <div className="mt-2 pl-3 border-l-2 border-[#0B7C6E]/30 space-y-1.5">
            {vessel.ship_owner && (
              <div>
                <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Owner</div>
                <div className="text-[11px] font-medium text-foreground">{vessel.ship_owner}</div>
              </div>
            )}
            {vessel.ship_manager && (
              <div>
                <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Manager</div>
                <div className="text-[11px] font-medium text-foreground">{vessel.ship_manager}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Row 8: Action buttons */}
      {/* <div className="flex items-center gap-3 mt-3 pt-2 border-t border-border/50" onClick={e => e.stopPropagation()}>
        {[
          { icon: Phone,      label: 'Call',   action: () => toast.info(`Calling agent for ${vessel.name || vessel.imo}`) },
          { icon: FileText,   label: 'Quote',  action: () => toast.info(`Creating quote for ${vessel.name || vessel.imo}`) },
          { icon: UserPlus,   label: 'Assign', action: () => toast.info(`Assign ${vessel.name || vessel.imo} to agent`) },
          { icon: StickyNote, label: 'Note',   action: () => toast.info(`Add note for ${vessel.name || vessel.imo}`) },
        ].map(({ icon: Icon, label, action }) => (
          <button key={label} onClick={action}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-[#0B7C6E] transition-colors font-medium">
            <Icon size={11} />{label}
          </button>
        ))}
      </div> */}
    </div>
  )
}

// ── Left sidebar ──────────────────────────────────────────────────
function FilterSelect({ label, value, onChange, options, placeholder }) {
  return (
    <div className="mb-3">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{label}</div>
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full appearance-none bg-background border border-border rounded-lg px-3 py-2 text-[11px] text-foreground pr-7 cursor-pointer focus:outline-none focus:border-[#0B7C6E]/50 transition-colors"
        >
          <option value="">{placeholder}</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      </div>
    </div>
  )
}

function PortSidebar({ vessels, selectedPorts, togglePort, certFilter, setCertFilter,
  managerFilter, setManagerFilter, ownerFilter, setOwnerFilter,
  classSocietyFilter, setClassSocietyFilter, shipTypeFilter, setShipTypeFilter, counts,
  collapsed, onToggle, mobileDrawer, onMobileClose }) {
  const [openRegions, setOpenRegions] = useState({ 'INDIA': true, 'MIDDLE EAST': true, 'ASIA': false, 'OTHER': false })

  const portCounts = useMemo(() => {
    const c = {}
    vessels.filter(v => v.geofence_flag === 'Inside').forEach(v => { if (v.port) c[v.port] = (c[v.port] || 0) + 1 })
    return c
  }, [vessels])

  const regionGroups = useMemo(() => {
    const groups = { 'INDIA': [], 'MIDDLE EAST': [], 'ASIA': [], 'OTHER': [] }
    Object.keys(portCounts).forEach(port => {
      const region = portToRegion(port) || 'OTHER'
      groups[region].push(port)
    })
    Object.keys(groups).forEach(r => {
      groups[r].sort((a, b) => (portCounts[b] || 0) - (portCounts[a] || 0))
    })
    return groups
  }, [portCounts])

  const certCounts = useMemo(() => {
    let expired = 0, critical = 0, warning = 0
    vessels.forEach(v => {
      if (v.cert_status === 'expired')  expired++
      if (v.cert_status === 'critical') critical++
      if (v.cert_status === 'warning')  warning++
    })
    return { expired, critical, warning }
  }, [vessels])

  // Derive unique dropdown options from vessel data
  const managers = useMemo(() => [...new Set(vessels.map(v => v.ship_manager).filter(Boolean))].sort(), [vessels])
  const owners   = useMemo(() => [...new Set(vessels.map(v => v.ship_owner).filter(Boolean))].sort(), [vessels])
  const societies = useMemo(() => [...new Set(vessels.map(v => v.class_society).filter(Boolean))].sort(), [vessels])
  const shipTypes = useMemo(() => [...new Set(vessels.map(v => v.vessel_type || v.spire_type).filter(Boolean))].sort(), [vessels])

  const toggleRegion = r => setOpenRegions(prev => ({ ...prev, [r]: !prev[r] }))

  const CERT_FILTERS = [
    { key: 'all',      label: 'All Certificates',    icon: ShieldCheck,  iconCls: 'text-[#0B7C6E]',   activeCls: 'bg-[#0B7C6E]/10 text-[#0B7C6E] border-[#0B7C6E]/30' },
    { key: 'expired',  label: 'Expired',             icon: ShieldX,      iconCls: 'text-red-500',      activeCls: 'bg-red-500/10 text-red-600 border-red-200',    count: certCounts.expired },
    { key: 'critical', label: 'Critical (<20 days)', icon: ShieldAlert,  iconCls: 'text-amber-500',    activeCls: 'bg-amber-500/10 text-amber-600 border-amber-200', count: certCounts.critical },
    { key: 'warning',  label: 'Warning (<60 days)',  icon: AlertTriangle,iconCls: 'text-yellow-500',   activeCls: 'bg-yellow-400/10 text-yellow-700 border-yellow-200', count: certCounts.warning },
  ]

  const OVERVIEW_ITEMS = [
    { label: 'Arriving',       value: counts?.arriving    ?? 0, icon: Ship,          iconCls: 'text-[#0B7C6E]' },
    { label: 'Certs Expiring', value: certCounts.warning + certCounts.critical, icon: AlertTriangle, iconCls: 'text-amber-500' },
    { label: 'Overdue',        value: certCounts.expired,        icon: XCircle,       iconCls: 'text-red-500' },
    { label: 'Open Quotes',    value: counts?.openQuotes  ?? 0, icon: FileText,      iconCls: 'text-blue-500' },
    { label: 'New Leads',      value: counts?.newLeads    ?? 0, icon: UserPlus,      iconCls: 'text-purple-500' },
  ]

  const isExpanded = mobileDrawer || !collapsed
  return (
    <div className={
      mobileDrawer
        ? 'flex h-full flex-col overflow-hidden bg-card'
        : `${collapsed ? 'w-12' : 'w-56'} hidden md:flex shrink-0 border-r border-border bg-card flex-col overflow-hidden transition-[width] duration-200`
    }>
      {/* Toggle header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        {isExpanded && (
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Ship size={13} className="text-[#0B7C6E]" />Filters
          </div>
        )}
        {mobileDrawer ? (
          <button type="button" onClick={onMobileClose} className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary">
            <X size={15} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            className={`flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground ${collapsed ? 'mx-auto' : 'ml-auto'}`}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        )}
      </div>
      {!isExpanded ? (
        <div className="flex flex-col items-center gap-3 py-4">
          <ShieldCheck size={16} className="text-[#0B7C6E]" />
          <AlertTriangle size={16} className="text-amber-500" />
          <FileText size={16} className="text-muted-foreground" />
        </div>
      ) : (
      <div className="flex flex-col flex-1 overflow-y-auto">
      {/* Port tree */}
      <div className="p-3 border-b border-border">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Ports</div>
        {Object.entries(regionGroups).map(([region, ports]) => {
          if (!ports.length) return null
          const regionTotal = ports.reduce((a, p) => a + (portCounts[p] || 0), 0)
          return (
            <div key={region} className="mb-1">
              <button onClick={() => toggleRegion(region)} className="flex items-center justify-between w-full text-left py-1 group">
                <span className="text-[11px] font-semibold text-foreground group-hover:text-[#0B7C6E] flex items-center gap-1">
                  {openRegions[region] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  {region}
                </span>
                <span className="text-[10px] text-muted-foreground">{regionTotal}</span>
              </button>
              {openRegions[region] && ports.map(port => (
                <label key={port} className="flex items-center gap-2 py-0.5 pl-4 cursor-pointer hover:text-[#0B7C6E] group">
                  <input type="checkbox" className="w-3 h-3 accent-[#0B7C6E]" checked={selectedPorts.has(port)} onChange={() => togglePort(port)} />
                  <span className="text-[11px] text-foreground group-hover:text-[#0B7C6E] flex-1 truncate">{port}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">({portCounts[port]})</span>
                </label>
              ))}
            </div>
          )
        })}
      </div>

      {/* Cert status filter */}
      <div className="p-3 border-b border-border">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Cert Status</div>
        {CERT_FILTERS.map(({ key, label, icon: Icon, iconCls, activeCls, count }) => (
          <button key={key} onClick={() => setCertFilter(key)}
            className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg text-[11px] mb-1 border transition-all ${
              certFilter === key ? activeCls + ' border' : 'text-muted-foreground hover:bg-secondary border-transparent'
            }`}>
            <Icon size={12} className={certFilter === key ? '' : iconCls} />
            <span className="flex-1">{label}</span>
            {count !== undefined && <span className="font-bold">{count}</span>}
          </button>
        ))}
      </div>

      {/* Dropdown filters */}
      <div className="p-3 border-b border-border">
        <FilterSelect label="Manager"      value={managerFilter}      onChange={setManagerFilter}      options={managers}  placeholder="All Managers" />
        <FilterSelect label="Owner"        value={ownerFilter}        onChange={setOwnerFilter}        options={owners}    placeholder="All Owners" />
        <FilterSelect label="Class Society" value={classSocietyFilter} onChange={setClassSocietyFilter} options={societies} placeholder="All Societies" />
        <FilterSelect label="Ship Type"    value={shipTypeFilter}     onChange={setShipTypeFilter}     options={shipTypes} placeholder="All Types" />
      </div>

      {/* Overview stats */}
      <div className="p-3">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Overview</div>
        {OVERVIEW_ITEMS.map(({ label, value, icon: Icon, iconCls }) => (
          <div key={label} className="flex items-center justify-between py-1.5">
            <div className="flex items-center gap-2 text-[11px] text-foreground">
              <Icon size={13} className={iconCls} />
              {label}
            </div>
            <span className="text-sm font-bold text-foreground">{value}</span>
          </div>
        ))}
      </div>
      </div>
      )}
    </div>
  )
}

// ── Right sidebar ─────────────────────────────────────────────────
function PriorityPanel({ vessels, events }) {
  const priority = vessels.filter(v => v.cert_status && v.cert_status !== 'valid' && v.cert_status !== 'none').slice(0, 6)

  return (
    <div className="hidden w-72 shrink-0 border-l border-border bg-card md:flex flex-col overflow-y-auto">
      {/* Priority calls */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={14} className="text-amber-500" />
          <span className="font-heading font-semibold text-sm text-foreground">Priority Calls</span>
        </div>
        {priority.length ? priority.map(v => {
          const status = v.cert_status || 'none'
          const badge  = { expired:'text-red-600', critical:'text-amber-600', warning:'text-yellow-600' }[status]
          const label  = { expired:'LSA EXPIRED', critical:'LSA CRITICAL', warning:'Due Soon' }[status]
          return (
            <div key={v.imo} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
              <div>
                <div className="text-xs font-semibold text-foreground">{v.name || `IMO ${v.imo}`}</div>
                <div className={`text-[10px] font-medium ${badge}`}>{label}</div>
              </div>
              <button className="flex items-center gap-1 text-[10px] text-[#0B7C6E] hover:text-[#0FA390] border border-[#0B7C6E]/30 rounded px-2 py-1 hover:bg-[#0B7C6E]/10 transition-all font-semibold">
                <Phone size={10} />Call
              </button>
            </div>
          )
        }) : (
          <p className="text-xs text-muted-foreground">No priority calls</p>
        )}
      </div>

      {/* Recent activity */}
      <div className="p-3">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={14} className="text-blue-500" />
          <span className="font-heading font-semibold text-sm text-foreground">Recent Activity</span>
        </div>
        {events.length ? events.slice(0, 6).map((ev, i) => (
          <div key={i} className="flex items-start gap-2 py-1.5 border-b border-border/40 last:border-0">
            <div className="w-1.5 h-1.5 rounded-full bg-[#0B7C6E] mt-1.5 shrink-0" />
            <div>
              <div className="text-[11px] text-foreground leading-tight">
                {ev.eventType || ev.type || 'Event'}
                {ev.imo && <span className="text-muted-foreground"> · IMO {ev.imo}</span>}
              </div>
              <div className="text-[10px] text-muted-foreground">{ev.synced_at ? new Date(ev.synced_at).toLocaleTimeString() : ''}</div>
            </div>
          </div>
        )) : (
          // Synthetic cert-based activity from vessels
          priority.slice(0, 5).map(v => {
            const status = v.cert_status || 'none'
            return (
              <div key={v.imo} className="flex items-start gap-2 py-1.5 border-b border-border/40 last:border-0">
                <div className="w-1.5 h-1.5 rounded-full bg-[#0B7C6E] mt-1.5 shrink-0" />
                <div>
                  <div className="text-[11px] text-foreground leading-tight">
                    {v.name || `IMO ${v.imo}`}: {status === 'expired' ? 'LSA cert EXPIRED' : status === 'critical' ? 'cert critical' : 'cert expiring soon'}
                  </div>
                  <div className="text-[10px] text-muted-foreground">just now</div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Main SALES view ───────────────────────────────────────────────
export default function SalesView() {
  const [vessels,             setVessels]             = useState([])
  const [events,              setEvents]              = useState([])
  const [loading,             setLoading]             = useState(true)
  const [selectedPorts,       setSelectedPorts]       = useState(new Set())
  const [leftCollapsed,       setLeftCollapsed]       = useState(false)
  const [filterDrawerOpen,    setFilterDrawerOpen]    = useState(false)
  const [certFilter,          setCertFilter]          = useState('all')
  const [activeFilter,        setActiveFilter]        = useState('arriving')
  const [timeFilter,          setTimeFilter]          = useState('7d')
  const [selectedVessel,      setSelectedVessel]      = useState(null)
  const [loadingModal,        setLoadingModal]        = useState(false)
  const [managerFilter,       setManagerFilter]       = useState('')
  const [ownerFilter,         setOwnerFilter]         = useState('')
  const [classSocietyFilter,  setClassSocietyFilter]  = useState('')
  const [shipTypeFilter,      setShipTypeFilter]      = useState('')

  // Open modal immediately with list data, then fetch full certificates
  const openVesselModal = useCallback(async (v) => {
    setSelectedVessel(v)
    setLoadingModal(true)
    try {
      const res = await vesselAPI.certificates(v.imo)
      setSelectedVessel(prev => prev?.imo === v.imo
        ? { ...prev, certificates: res.data.certificates || [] }
        : prev
      )
    } catch (_) {}
    finally { setLoadingModal(false) }
  }, [])

  useEffect(() => {
    Promise.all([
      vesselAPI.list({ limit: 10000 }),
      eventAPI.list({ limit: 20 }).catch(() => ({ data: { data: [] } })),
    ]).then(([v, e]) => {
      setVessels(v.data.data || [])
      setEvents(e.data.data || [])
    }).finally(() => setLoading(false))
  }, [])

  const togglePort = port =>
    setSelectedPorts(prev => { const n = new Set(prev); n.has(port) ? n.delete(port) : n.add(port); return n })

  // Port + dropdown filtered base list
  const portFiltered = useMemo(() => {
    let list = vessels
    if (selectedPorts.size)    list = list.filter(v => v.geofence_flag === 'Inside' && selectedPorts.has(v.port))
    if (managerFilter)         list = list.filter(v => v.ship_manager === managerFilter)
    if (ownerFilter)           list = list.filter(v => v.ship_owner === ownerFilter)
    if (classSocietyFilter)    list = list.filter(v => v.class_society === classSocietyFilter)
    if (shipTypeFilter)        list = list.filter(v => (v.vessel_type || v.spire_type) === shipTypeFilter)
    return list
  }, [vessels, selectedPorts, managerFilter, ownerFilter, classSocietyFilter, shipTypeFilter])

  // Tab + cert filter
  const filtered = useMemo(() => {
    const now = Date.now()
    const inWin = (eta) => {
      if (!eta) return false
      const ms = new Date(eta) - now
      if (timeFilter === '3d')  return ms >= 0 && ms <= 3 * 86400000
      if (timeFilter === '>7d') return ms > 7 * 86400000
      return ms >= 0 && ms <= 7 * 86400000  // default 7d
    }
    let list = portFiltered
    if (certFilter !== 'all') list = list.filter(v => v.cert_status === certFilter)
    // 'arriving' needs no extra filter — portFiltered already handles selectedPorts
    if (activeFilter === 'callOverdue') list = list.filter(v => v.cert_status === 'expired' || v.cert_status === 'critical')
    if (activeFilter === 'newLeads')    list = list.filter(v => (v.relationship || '').toLowerCase() === 'prospect')
    return list
  }, [portFiltered, certFilter, activeFilter, timeFilter, selectedPorts])

  // Tab counts
  const counts = useMemo(() => {
    const now = Date.now()
    const inWin = (eta) => {
      if (!eta) return false
      const ms = new Date(eta) - now
      if (timeFilter === '3d')  return ms >= 0 && ms <= 3 * 86400000
      if (timeFilter === '>7d') return ms > 7 * 86400000
      return ms >= 0 && ms <= 7 * 86400000
    }
    return {
      arriving:    portFiltered.length,
      callOverdue: portFiltered.filter(v => v.cert_status === 'expired' || v.cert_status === 'critical').length,
      openQuotes:  0,
      newLeads:    portFiltered.filter(v => (v.relationship || '').toLowerCase() === 'prospect').length,
    }
  }, [portFiltered, timeFilter, selectedPorts])

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-background">

      {/* Mobile filter drawer */}
      {filterDrawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setFilterDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">
            <PortSidebar
              vessels={vessels}
              selectedPorts={selectedPorts}
              togglePort={togglePort}
              certFilter={certFilter}
              setCertFilter={setCertFilter}
              managerFilter={managerFilter}       setManagerFilter={setManagerFilter}
              ownerFilter={ownerFilter}           setOwnerFilter={setOwnerFilter}
              classSocietyFilter={classSocietyFilter} setClassSocietyFilter={setClassSocietyFilter}
              shipTypeFilter={shipTypeFilter}     setShipTypeFilter={setShipTypeFilter}
              counts={counts}
              collapsed={false}
              onToggle={() => {}}
              mobileDrawer={true}
              onMobileClose={() => setFilterDrawerOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Left sidebar */}
      <PortSidebar
        vessels={vessels}
        selectedPorts={selectedPorts}
        togglePort={togglePort}
        certFilter={certFilter}
        setCertFilter={setCertFilter}
        managerFilter={managerFilter}       setManagerFilter={setManagerFilter}
        ownerFilter={ownerFilter}           setOwnerFilter={setOwnerFilter}
        classSocietyFilter={classSocietyFilter} setClassSocietyFilter={setClassSocietyFilter}
        shipTypeFilter={shipTypeFilter}     setShipTypeFilter={setShipTypeFilter}
        counts={counts}
        collapsed={leftCollapsed}
        onToggle={() => setLeftCollapsed(v => !v)}
      />

      {/* Center: feed */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Filter bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card shrink-0 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Mobile filter button */}
            <button
              type="button"
              onClick={() => setFilterDrawerOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary md:hidden"
            >
              <Filter size={12} />Filters
            </button>
            {[
              { key:'arriving',    label:'Arriving',    count: counts.arriving,    icon: Ship },
              { key:'callOverdue', label:'Call Overdue', count: counts.callOverdue, icon: AlertTriangle },
              // { key:'openQuotes',  label:'Open Quotes',  count: counts.openQuotes,  icon: FileText },
              // { key:'newLeads',    label:'New Leads',    count: counts.newLeads,    icon: Activity },
            ].map(({ key, label, count, icon: Icon }) => (
              <button key={key} onClick={() => setActiveFilter(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  activeFilter === key
                    ? 'bg-[#0B7C6E]/10 text-[#0B7C6E] border-[#0B7C6E]/30'
                    : 'bg-background text-muted-foreground border-border hover:border-[#0B7C6E]/30'
                }`}>
                <Icon size={11} />{label}
                <span className={`px-1.5 py-0 rounded-full text-[10px] font-bold ${activeFilter === key ? 'bg-[#0B7C6E] text-white' : 'bg-secondary text-muted-foreground'}`}>{count}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-0 border border-border rounded-lg overflow-hidden text-xs">
            {[['3d','3 Days'],['7d','7 Days'],['>7d','>7 Days']].map(([k,l]) => (
              <button key={k} onClick={() => setTimeFilter(k)}
                className={`px-3 py-1.5 font-semibold transition-colors ${timeFilter === k ? 'bg-[#0B7C6E] text-white' : 'text-muted-foreground hover:bg-secondary'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* Vessel list */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-20"><div className="spinner w-6 h-6" /></div>
          ) : filtered.length ? (
            filtered.map(v => (
              <VesselCard key={v.imo} vessel={v} onClick={() => openVesselModal(v)} />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Ship size={32} className="mb-2 opacity-20" />
              <p className="text-sm">No vessels found</p>
            </div>
          )}
        </div>
      </div>

      {/* Right sidebar */}
      <PriorityPanel vessels={vessels} events={events} />

      {/* Vessel detail modal */}
      {selectedVessel && (
        <VesselModal
          vessel={selectedVessel}
          onClose={() => { setSelectedVessel(null); setLoadingModal(false) }}
          loadingCerts={loadingModal}
        />
      )}
    </div>
  )
}
