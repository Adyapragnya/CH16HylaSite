import axios from 'axios'

const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api'

const client = axios.create({
  baseURL: BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT token on every request
client.interceptors.request.use(cfg => {
  const token = localStorage.getItem('ch16_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

// Redirect to login on 401
client.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('ch16_token')
      localStorage.removeItem('ch16_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

// ── Auth ──────────────────────────────────────────────────────
export const authAPI = {
  login: (username, password) => client.post('/auth/login', { username, password }),
  me:    ()                   => client.get('/auth/me'),
}

// ── Vessels ───────────────────────────────────────────────────
export const vesselAPI = {
  list:         (params) => client.get('/vessels', { params }),
  get:          (imo)    => client.get(`/vessels/${imo}`),
  position:     (imo)    => client.get(`/vessels/${imo}/position`),
  certificates: (imo)    => client.get(`/vessels/${imo}/certificates`),
  flags:        ()       => client.get('/vessels/flags'),
  types:        ()       => client.get('/vessels/types'),
}

// ── Fleet ─────────────────────────────────────────────────────
export const fleetAPI = {
  stats:     ()  => client.get('/fleet/stats'),
  breakdown: ()  => client.get('/fleet/breakdown'),
  positions: ()  => client.get('/fleet/positions'),
}

// ── Subscriptions ─────────────────────────────────────────────
export const subscriptionAPI = {
  get:           ()       => client.get('/subscriptions'),
  addVessels:    (imos)   => client.post('/subscriptions/vessels', { imos }),
  addPorts:      (locodes)=> client.post('/subscriptions/ports', { unlocodes: locodes }),
  bulk:          (payload)=> client.post('/subscriptions/bulk', payload),
  updateIntervals:(body)  => client.patch('/subscriptions/intervals', body),
  updateStatus:  (status) => client.patch('/subscriptions/status', { status }),
  removeVessels: (imos)   => client.patch('/subscriptions/remove-vessels', { imos }),
  removePorts:   (locodes)=> client.patch('/subscriptions/remove-ports', { unlocodes: locodes }),
}

// ── Events ────────────────────────────────────────────────────
export const eventAPI = {
  list:  (params) => client.get('/events', { params }),
  types: ()       => client.get('/events/types'),
}

// ── Sync ──────────────────────────────────────────────────────
export const syncAPI = {
  trigger: () => client.post('/sync/trigger'),
  logs:    () => client.get('/sync/logs'),
}
