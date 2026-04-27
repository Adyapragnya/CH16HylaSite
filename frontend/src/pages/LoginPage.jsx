import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ship, Lock, User, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate  = useNavigate()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd,  setShowPwd]  = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [visible,  setVisible]  = useState(false)

  useEffect(() => { const t = setTimeout(() => setVisible(true), 30); return () => clearTimeout(t) }, [])

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid username or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-background"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.6s ease' }}
    >

      {/* ── Left panel (lg+) ── */}
      <div
        className="hidden lg:flex flex-1 flex-col items-center justify-center relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #0B7C6E 0%, #0FA390 50%, #0d8f7f 100%)' }}
      >
        {/* Grid pattern */}
        <div className="absolute inset-0" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }} />

        <div className="relative z-10 text-center px-12 max-w-md">
          <div className="w-20 h-20 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center mx-auto mb-6 backdrop-blur-sm">
            <Ship size={40} className="text-white" />
          </div>
          <h1 className="font-heading font-bold text-4xl text-white leading-tight mb-3">
            Marine Services<br />Intelligence
          </h1>
          <p className="text-white/70 text-base mb-8">
            LSA/FFA Service Intelligence for AS Moloobhoy
          </p>

          <div className="flex flex-wrap gap-2 justify-center">
            {['AIS Tracking', 'Cert Monitoring', 'Fleet Overview', 'Compliance Alerts'].map(f => (
              <span key={f} className="text-xs px-3 py-1.5 rounded-full bg-white/15 text-white border border-white/25 backdrop-blur-sm font-medium">
                {f}
              </span>
            ))}
          </div>

          <p className="mt-10 text-white/40 text-xs">
            Powered by Ch16.ai · Hyla Analytics Platform
          </p>
        </div>
      </div>

      {/* ── Right panel (form) ── */}
      <div className="w-full max-w-md flex flex-col justify-center px-8 lg:px-12 bg-card border-l border-border">

        {/* Mobile logo */}
        <div className="lg:hidden flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-xl bg-[#0B7C6E] flex items-center justify-center">
            <Ship size={16} className="text-white" />
          </div>
          <div>
            <div className="font-heading font-bold text-sm leading-none">Ch16.ai</div>
            <div className="text-[10px] text-muted-foreground leading-none mt-0.5">AS Moloobhoy</div>
          </div>
        </div>

        <div className="max-w-sm w-full mx-auto">
          <h2 className="font-heading font-bold text-2xl text-foreground mb-1">Welcome back</h2>
          <p className="text-sm text-muted-foreground mb-7">
            Sign in to AS Moloobhoy Marine Services Intelligence
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Username or Email</label>
              <div className="relative">
                <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  className="w-full pl-9 pr-3 py-2.5 border border-border rounded-lg text-sm bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-[#0B7C6E] focus:ring-2 focus:ring-[#0B7C6E]/20 transition-all"
                  placeholder="Enter your username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required autoFocus
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type={showPwd ? 'text' : 'password'}
                  className="w-full pl-9 pr-9 py-2.5 border border-border rounded-lg text-sm bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-[#0B7C6E] focus:ring-2 focus:ring-[#0B7C6E]/20 transition-all"
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
                <button type="button" onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-all mt-2 flex items-center justify-center gap-2"
              style={{ background: loading ? '#0d8f7f' : '#0B7C6E' }}
            >
              {loading ? (
                <><span className="spinner w-4 h-4" />Signing in…</>
              ) : 'Sign In'}
            </button>
          </form>

          <p className="mt-8 text-center text-[11px] text-muted-foreground">
            Ch16.ai · AS Moloobhoy · Marine Services Intelligence
          </p>
        </div>
      </div>
    </div>
  )
}
