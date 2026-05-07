import { useState, useEffect, useMemo } from 'react'
import { Ship, Bell, RefreshCw, ChevronDown, LogOut, X, AlertTriangle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { syncAPI, vesselAPI } from '../lib/api'
import { toast } from 'sonner'
import { timeAgo } from '../lib/utils'

import SalesView      from '../pages/SalesView'
import OpsView        from '../pages/OpsView'
import ComplianceView from '../pages/ComplianceView'

export default function Shell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [tab,        setTab]        = useState('sales')
  const [syncing,    setSyncing]    = useState(false)
  const [notifOpen,  setNotifOpen]  = useState(false)
  const [vessels,    setVessels]    = useState([])

  useEffect(() => {
    // Fetch top 200 most urgent vessels — no cert arrays needed (uses pre-computed lsa_days/ffa_days)
    vesselAPI.list({ limit: 200, has_certs: true, sort_by: 'cert_urgency' })
      .then(r => setVessels(r.data.data || []))
      .catch(() => {})
  }, [])

  const notifItems = useMemo(() => {
    const items = []
    vessels.forEach(v => {
      // Use pre-computed days — no need to iterate certificates array
      const checks = [
        { label: 'LSA', days: v.lsa_days },
        { label: 'FFA', days: v.ffa_days },
      ]
      checks.forEach(({ label, days }) => {
        if (days == null || days > 90) return
        items.push({
          vessel:  v,
          label,
          days,
          urgent:  days < 30,
          message: days < 0
            ? `${v.name || 'IMO ' + v.imo}: ${label} cert EXPIRED`
            : `${v.name || 'IMO ' + v.imo}: ${label} expiring in ${days}d`,
          port:    v.port || '—',
          time:    timeAgo(v.last_ais_update),
        })
      })
    })
    return items.sort((a, b) => a.days - b.days)
  }, [vessels])

  const urgentItems = notifItems.filter(n => n.urgent)
  const infoItems   = notifItems.filter(n => !n.urgent)

  const isDark = tab === 'ops'

  const handleLogout = () => { logout(); navigate('/login') }

  const handleSync = async () => {
    setSyncing(true)
    try { await syncAPI.trigger(); toast.success('Data sync triggered') }
    catch { toast.error('Sync failed') }
    finally { setSyncing(false) }
  }

  // Dark-mode token shortcuts
  const hdr  = isDark ? 'bg-[#0a0e1b] border-[#1a2438]' : 'bg-card/95 border-border backdrop-blur'
  const logo2 = isDark ? 'text-gray-400' : 'text-muted-foreground'
  const logoT = isDark ? 'text-white' : 'text-foreground'
  const pillBg = isDark ? 'bg-[#0f1829]' : 'bg-secondary'
  const iconBtn = isDark
    ? 'text-gray-400 hover:text-white hover:bg-[#1a2438]'
    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
  const userBg = isDark ? 'bg-[#0f1829] text-gray-200' : 'bg-secondary text-foreground'

  return (
    <div className={`min-h-screen flex flex-col ${isDark ? 'bg-[#0a0e1b]' : 'bg-background'}`}>
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header className={`sticky top-0 z-40 w-full border-b ${hdr}`}>
        <div className="flex h-14 items-center gap-3 px-4">

          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-[#0B7C6E] flex items-center justify-center">
              <Ship size={14} className="text-white" />
            </div>
            <div>
              <div className={`font-heading font-bold text-sm leading-none tracking-tight ${logoT}`}>Ch16.ai</div>
              <div className={`text-[10px] leading-none mt-0.5 ${logo2}`}>AS Moloobhoy</div>
            </div>
            <div className={`hidden sm:block text-xs leading-none mt-0.5 font-heading ${logo2}`}>
              Marine Services Intelligence
            </div>
          </div>

          {/* Tab switcher — center */}
          <div className="flex-1 flex justify-center">
            <div className={`flex items-center ${pillBg} rounded-full p-1 gap-0.5`} data-testid="dashboard-toggle">
              {[
                { id: 'sales',      label: 'SALES',      active: 'bg-[#0B7C6E] text-white shadow-md' },
                { id: 'ops',        label: 'OPS',        active: 'bg-[#0FA390] text-black shadow-md' },
                { id: 'compliance', label: 'COMPLIANCE', active: 'bg-[#0B7C6E] text-white shadow-md' },
              ].map(t => (
                <button
                  key={t.id}
                  data-testid={`nav-toggle-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={
                    'px-5 py-1.5 rounded-full text-sm font-heading font-semibold tracking-wide transition-all duration-200 ' +
                    (tab === t.id ? t.active : (isDark ? 'text-gray-400 hover:text-white' : 'text-muted-foreground hover:text-foreground'))
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2 shrink-0">
            {tab === 'sales' && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary border border-border text-xs font-mono cursor-pointer text-foreground">
                <span>$ USD</span>
                <ChevronDown size={12} className="text-muted-foreground" />
              </div>
            )}
            <button onClick={handleSync} disabled={syncing}
              className={`p-1.5 rounded-lg transition-colors ${iconBtn}`} title="Sync data">
              <RefreshCw size={15} style={{ animation: syncing ? 'spin 0.7s linear infinite' : 'none' }} />
            </button>
            <button data-testid="nav-notifications-btn"
              onClick={() => setNotifOpen(o => !o)}
              className={`p-1.5 rounded-lg transition-colors relative ${iconBtn}`}>
              <Bell size={15} />
              {notifItems.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 rounded-full text-[8px] text-white flex items-center justify-center font-bold">
                  {Math.min(notifItems.length, 99)}
                </span>
              )}
            </button>
            <button onClick={handleLogout}
              className={`p-1.5 rounded-lg transition-colors ${iconBtn}`} title="Sign out">
              <LogOut size={15} />
            </button>
            <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs ${userBg}`}>
              <div className="w-5 h-5 rounded-full bg-[#0B7C6E] flex items-center justify-center text-white font-bold text-[10px]">
                {(user?.full_name || user?.username || 'U')[0].toUpperCase()}
              </div>
              <span className="font-medium">{user?.full_name || user?.username}</span>
            </div>
          </div>
        </div>
      </header>

      {/* ── Notification panel ──────────────────────────────────── */}
      {notifOpen && (
        <div className="fixed inset-0 z-50" onClick={() => setNotifOpen(false)}>
          <div
            className="absolute top-14 right-4 w-80 bg-white rounded-xl shadow-2xl border border-border overflow-hidden max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="font-heading font-bold text-sm text-foreground">
                Notifications ({notifItems.length} unread)
              </span>
              <button onClick={() => setNotifOpen(false)} className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground">
                <X size={14} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {/* Urgent section */}
              {urgentItems.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border-b border-red-100">
                    <AlertTriangle size={12} className="text-red-500" />
                    <span className="text-[11px] font-bold text-red-600 uppercase tracking-wide">Urgent ({urgentItems.length})</span>
                  </div>
                  {urgentItems.map((n, i) => (
                    <div key={i} className="px-4 py-3 border-b border-red-50 bg-red-50/60 hover:bg-red-50 transition-colors">
                      <div className="font-heading font-bold text-xs text-foreground">{n.vessel.name || `IMO ${n.vessel.imo}`}</div>
                      <div className="text-[11px] text-red-600 mt-0.5">{n.message}</div>
                      <div className="flex items-center gap-2 flex-wrap mt-0.5">
                        <span className="text-[10px] text-muted-foreground">{n.port}</span>
                        {n.vessel.geofence_name && (
                          <span className={`text-[9px] px-1.5 py-0 rounded-full font-semibold ${n.vessel.geofence_flag === 'Inside' ? 'bg-[#0B7C6E]/10 text-[#0B7C6E]' : 'bg-secondary text-muted-foreground'}`}>
                            {n.vessel.geofence_flag === 'Inside' ? '●' : '○'} {n.vessel.geofence_name}
                          </span>
                        )}
                        {n.vessel.lat && n.vessel.lon && (
                          <span className="text-[9px] text-muted-foreground font-mono">{Number(n.vessel.lat).toFixed(2)}°, {Number(n.vessel.lon).toFixed(2)}°</span>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto">{n.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Info section */}
              {infoItems.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-100">
                    <AlertTriangle size={12} className="text-amber-500" />
                    <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wide">Expiring Soon ({infoItems.length})</span>
                  </div>
                  {infoItems.map((n, i) => (
                    <div key={i} className="px-4 py-3 border-b border-border/50 hover:bg-secondary/40 transition-colors">
                      <div className="font-heading font-bold text-xs text-foreground">{n.vessel.name || `IMO ${n.vessel.imo}`}</div>
                      <div className="text-[11px] text-amber-600 mt-0.5">{n.message}</div>
                      <div className="flex items-center gap-2 flex-wrap mt-0.5">
                        <span className="text-[10px] text-muted-foreground">{n.port}</span>
                        {n.vessel.geofence_name && (
                          <span className={`text-[9px] px-1.5 py-0 rounded-full font-semibold ${n.vessel.geofence_flag === 'Inside' ? 'bg-[#0B7C6E]/10 text-[#0B7C6E]' : 'bg-secondary text-muted-foreground'}`}>
                            {n.vessel.geofence_flag === 'Inside' ? '●' : '○'} {n.vessel.geofence_name}
                          </span>
                        )}
                        {n.vessel.lat && n.vessel.lon && (
                          <span className="text-[9px] text-muted-foreground font-mono">{Number(n.vessel.lat).toFixed(2)}°, {Number(n.vessel.lon).toFixed(2)}°</span>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto">{n.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {notifItems.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Bell size={28} className="mb-2 opacity-20" />
                  <p className="text-sm">No notifications</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Main content ────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden">
        {tab === 'sales'      && <SalesView />}
        {tab === 'ops'        && <OpsView />}
        {tab === 'compliance' && <ComplianceView />}
      </main>
    </div>
  )
}
