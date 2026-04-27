import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Ship, Anchor, Activity, ShieldCheck, AlertTriangle,
  TrendingUp, Globe, RefreshCw, ArrowRight
} from 'lucide-react'
import { fleetAPI, vesselAPI } from '../lib/api'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'

const TEAL_COLORS = ['#0d9488','#14b8a6','#2dd4bf','#5eead4','#99f6e4','#ccfbf1']

function StatCard({ icon: Icon, label, value, iconBg, iconColor, sub }) {
  return (
    <div className="stat-card">
      <div className="flex items-center gap-3">
        <div className="stat-icon" style={{ background: iconBg }}>
          <Icon size={18} color={iconColor} />
        </div>
        <div className="flex-1 min-w-0">
          <div style={{ fontSize:'0.75rem', color:'#9ca3af', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>{label}</div>
          <div style={{ fontSize:'1.625rem', fontWeight:700, color:'#111827', lineHeight:1.2, fontFamily:"'Syne',sans-serif" }}>{value ?? '—'}</div>
          {sub && <div style={{ fontSize:'0.75rem', color:'#6b7280', marginTop:'0.125rem' }}>{sub}</div>}
        </div>
      </div>
    </div>
  )
}

function VesselRow({ vessel, onClick }) {
  return (
    <tr onClick={onClick} style={{ cursor: 'pointer' }}>
      <td>
        <div className="flex items-center gap-2">
          <Ship size={14} color="#0d9488" />
          <div>
            <div style={{ fontWeight:600, color:'#111827', fontSize:'0.875rem' }}>{vessel.name || '—'}</div>
            <div className="font-mono" style={{ fontSize:'0.7rem', color:'#9ca3af' }}>IMO {vessel.imo}</div>
          </div>
        </div>
      </td>
      <td><span style={{ fontSize:'0.8rem', color:'#6b7280' }}>{vessel.flag || '—'}</span></td>
      <td><span style={{ fontSize:'0.8rem', color:'#6b7280' }}>{vessel.vessel_type || '—'}</span></td>
      <td>
        <span style={{
          fontSize:'0.8rem', fontWeight:600,
          color: vessel.speed > 0.5 ? '#059669' : vessel.speed === 0 ? '#9ca3af' : '#d97706'
        }}>
          {vessel.speed != null ? `${vessel.speed} kn` : '—'}
        </span>
      </td>
      <td><span style={{ fontSize:'0.8rem', color:'#374151' }}>{vessel.destination || vessel.port || '—'}</span></td>
    </tr>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const [stats,     setStats]     = useState(null)
  const [breakdown, setBreakdown] = useState(null)
  const [vessels,   setVessels]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [lastSync,  setLastSync]  = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const [s, b, v] = await Promise.all([
        fleetAPI.stats(),
        fleetAPI.breakdown(),
        vesselAPI.list({ limit: 8 }),
      ])
      setStats(s.data)
      setBreakdown(b.data)
      setVessels(v.data.data || [])
      setLastSync(new Date().toLocaleTimeString())
    } catch (e) {
      console.error('Dashboard load error:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="page-header flex items-center justify-between">
        <div>
          <h1 className="page-title">Fleet Dashboard</h1>
          <p className="page-subtitle">
            Ch16.ai | AS Moloobhoy — LSA/FFA Service Intelligence
            {lastSync && <span style={{ marginLeft:'0.75rem', color:'#9ca3af' }}>· Updated {lastSync}</span>}
          </p>
        </div>
        <button onClick={load} className="btn btn-secondary btn-sm" disabled={loading}>
          <RefreshCw size={14} style={{ animation: loading ? 'spin 0.7s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="stats-grid mb-6">
        <StatCard icon={Ship}          label="Total Vessels"   value={stats?.total_vessels}       iconBg="#f0fdfa" iconColor="#0d9488" sub="in fleet" />
        <StatCard icon={Activity}      label="With AIS"        value={stats?.with_ais_position}    iconBg="#eff6ff" iconColor="#2563eb" sub="live position" />
        <StatCard icon={TrendingUp}    label="Underway"        value={stats?.underway}             iconBg="#ecfdf5" iconColor="#059669" sub="speed > 0.5 kn" />
        <StatCard icon={Anchor}        label="At Anchor"       value={stats?.at_anchor}            iconBg="#fffbeb" iconColor="#d97706" sub="speed ≤ 0.5 kn" />
        <StatCard icon={ShieldCheck}   label="Certificates"    value={stats?.total_certificates}   iconBg="#eef2ff" iconColor="#4f46e5" sub="total tracked" />
      </div>

      {/* Charts row */}
      <div className="grid gap-6 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px,1fr))' }}>
        {/* Vessel type pie */}
        <div className="card">
          <h2 style={{ fontSize:'1rem', fontWeight:700, color:'#111827', marginBottom:'1rem', fontFamily:"'Syne',sans-serif" }}>
            Fleet by Type
          </h2>
          {breakdown?.by_type?.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={breakdown.by_type} dataKey="count" nameKey="label" cx="50%" cy="50%"
                  innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {breakdown.by_type.map((_, i) => <Cell key={i} fill={TEAL_COLORS[i % TEAL_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v, n) => [v, n]} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: '0.75rem' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="empty-state"><span style={{fontSize:'0.875rem'}}>No data yet</span></div>}
        </div>

        {/* Flag bar */}
        <div className="card">
          <h2 style={{ fontSize:'1rem', fontWeight:700, color:'#111827', marginBottom:'1rem', fontFamily:"'Syne',sans-serif" }}>
            Top Flags
          </h2>
          {breakdown?.by_flag?.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={breakdown.by_flag} margin={{ top:0, right:0, bottom:20, left:0 }}>
                <XAxis dataKey="label" tick={{ fontSize:11 }} angle={-30} textAnchor="end" />
                <YAxis tick={{ fontSize:11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#0d9488" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="empty-state"><span style={{fontSize:'0.875rem'}}>No data yet</span></div>}
        </div>
      </div>

      {/* Recent vessels */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 style={{ fontSize:'1rem', fontWeight:700, color:'#111827', fontFamily:"'Syne',sans-serif" }}>
            Fleet Vessels
          </h2>
          <button onClick={() => navigate('/vessels')} className="btn btn-ghost btn-sm">
            View all <ArrowRight size={14} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center" style={{ padding:'2rem' }}>
            <div className="spinner" />
          </div>
        ) : vessels.length ? (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vessel</th>
                  <th>Flag</th>
                  <th>Type</th>
                  <th>Speed</th>
                  <th>Destination</th>
                </tr>
              </thead>
              <tbody>
                {vessels.map(v => (
                  <VesselRow key={v.imo} vessel={v} onClick={() => navigate(`/vessels/${v.imo}`)} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <Ship size={32} className="empty-state-icon" />
            <span>No vessels synced yet. Click Sync Data to load.</span>
          </div>
        )}
      </div>
    </div>
  )
}
