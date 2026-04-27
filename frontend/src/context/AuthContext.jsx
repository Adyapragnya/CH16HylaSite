import { createContext, useContext, useState, useEffect } from 'react'
import { authAPI } from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(() => {
    try { return JSON.parse(localStorage.getItem('ch16_user') || 'null') } catch { return null }
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('ch16_token')
    if (!token) { setLoading(false); return }
    authAPI.me()
      .then(r => setUser(r.data))
      .catch(() => { localStorage.removeItem('ch16_token'); localStorage.removeItem('ch16_user'); setUser(null) })
      .finally(() => setLoading(false))
  }, [])

  const login = async (username, password) => {
    const r = await authAPI.login(username, password)
    localStorage.setItem('ch16_token', r.data.access_token)
    localStorage.setItem('ch16_user', JSON.stringify(r.data.user))
    setUser(r.data.user)
    return r.data.user
  }

  const logout = () => {
    localStorage.removeItem('ch16_token')
    localStorage.removeItem('ch16_user')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
