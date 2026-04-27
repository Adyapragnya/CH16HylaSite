import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Ship, BarChart2, ShieldCheck, Bell, Settings,
  Menu, X, LogOut, User, Anchor, Activity, RefreshCw
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { syncAPI } from '../lib/api'
import { toast } from 'sonner'

function SideItem({ to, icon: Icon, label, onClick }) {
  if (onClick) {
    return (
      <button onClick={onClick} className="sidebar-item" style={{ width: '100%', textAlign: 'left' }}>
        <Icon size={16} /> {label}
      </button>
    )
  }
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`}
    >
      <Icon size={16} /> {label}
    </NavLink>
  )
}

export default function Layout({ children }) {
  const { user, logout } = useAuth()
  const navigate         = useNavigate()
  const [open, setOpen]  = useState(false)
  const [syncing, setSyncing] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      await syncAPI.trigger()
      toast.success('Data sync triggered successfully')
    } catch {
      toast.error('Sync failed — check backend connection')
    } finally {
      setSyncing(false)
    }
  }

  const SidebarContent = () => (
    <>
      <div className="sidebar-section">Navigation</div>
      <SideItem to="/"              icon={BarChart2}   label="Fleet Dashboard" />
      <SideItem to="/vessels"       icon={Ship}        label="Vessels" />
      <SideItem to="/events"        icon={Activity}    label="Events" />
      <SideItem to="/subscriptions" icon={Anchor}      label="Subscriptions" />

      <div className="sidebar-section" style={{ marginTop: 'auto' }}>Account</div>
      <SideItem icon={RefreshCw} label={syncing ? 'Syncing...' : 'Sync Data'} onClick={handleSync} />
      <SideItem icon={LogOut} label="Sign Out" onClick={handleLogout} />
    </>
  )

  return (
    <div className="app-shell">
      {/* Top bar */}
      <header className="topbar">
        <button
          className="mobile-menu-btn btn-ghost"
          style={{ display: 'flex', padding: '0.375rem' }}
          onClick={() => setOpen(v => !v)}
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>

        <div className="topbar-logo">
          <Ship size={14} color="#fff" />
        </div>
        <span className="topbar-title">Ch16.ai</span>
        <span className="topbar-subtitle lg:block" style={{ display: 'none' }}>AS Moloobhoy</span>

        <nav className="lg:flex" style={{ display: 'none', alignItems: 'center', gap: '0.25rem', marginLeft: '1.5rem' }}>
          <NavLink to="/"              className={({isActive})=>`sidebar-item${isActive?' active':''}`}><BarChart2 size={15}/>Fleet Dashboard</NavLink>
          <NavLink to="/vessels"       className={({isActive})=>`sidebar-item${isActive?' active':''}`}><Ship size={15}/>Vessels</NavLink>
          <NavLink to="/events"        className={({isActive})=>`sidebar-item${isActive?' active':''}`}><Activity size={15}/>Events</NavLink>
          <NavLink to="/subscriptions" className={({isActive})=>`sidebar-item${isActive?' active':''}`}><Anchor size={15}/>Subscriptions</NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={handleSync} className="btn btn-ghost btn-sm" disabled={syncing} title="Sync data">
            <RefreshCw size={15} style={{ animation: syncing ? 'spin 0.7s linear infinite' : 'none' }} />
            <span className="sm:block" style={{ display: 'none' }}>Sync</span>
          </button>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.25rem 0.75rem', background: '#f9fafb',
            borderRadius: '0.5rem', border: '1px solid #e5e7eb',
          }}>
            <User size={14} color="#6b7280" />
            <span style={{ fontSize: '0.8rem', color: '#374151', fontWeight: 500 }}>
              {user?.full_name || user?.username || 'User'}
            </span>
          </div>
          <button onClick={handleLogout} className="btn btn-ghost btn-sm" title="Sign out">
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {/* Desktop sidebar */}
      <nav className="sidebar">
        <SidebarContent />
      </nav>

      {/* Mobile sidebar overlay */}
      {open && (
        <div className="sidebar-overlay" onClick={() => setOpen(false)}>
          <nav className="sidebar-mobile" onClick={e => e.stopPropagation()}>
            <SidebarContent />
          </nav>
        </div>
      )}

      {/* Page content */}
      <main className="main-content fade-in">
        {children}
      </main>
    </div>
  )
}
