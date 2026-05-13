// ── Shared cert / date utilities used across Sales, Ops, Compliance ──

export function certDays(cert) {
  if (cert.days_remaining != null) return cert.days_remaining
  const exp = cert.expiry_date || cert.expiryDate || cert.ExpiryDate
  if (!exp) return null
  return Math.floor((new Date(exp) - Date.now()) / 86400000)
}

export function worstCertStatus(certs = []) {
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

export function fmtDate(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
  catch { return '—' }
}

export function fmtDateShort(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) }
  catch { return '—' }
}

export function fmtETA(v) {
  if (!v) return null
  try {
    const d = new Date(v)
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' +
           d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } catch { return null }
}

export function timeAgo(ts) {
  if (!ts) return 'recently'
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function deriveSurveys(certs = []) {
  const SURVEY_MAP = {
    'SOLAS':        { name: 'Safety Equipment Survey',    category: 'Statutory' },
    'LSA':          { name: 'Safety Equipment Survey',    category: 'Statutory' },
    'FFA':          { name: 'Safety Construction Survey', category: 'Statutory' },
    'LOAD LINE':    { name: 'Load Line Survey',           category: 'Statutory' },
    'IOPP':         { name: 'IOPP Survey',                category: 'Statutory' },
    'ISPS':         { name: 'ISPS Survey',                category: 'Statutory' },
    'MLC':          { name: 'MLC Survey',                 category: 'Statutory' },
    'ISM':          { name: 'ISM Survey',                 category: 'Statutory' },
    'SAFETY RADIO': { name: 'Safety Radio Survey',        category: 'Statutory' },
    'CLASS':        { name: 'Annual Survey',              category: 'Class' },
    'TONNAGE':      { name: 'Tonnage Survey',             category: 'Statutory' },
  }
  const CLASS_SURVEYS = [
    'Annual Survey', 'Intermediate Survey', 'Special Survey',
    'Bottom Survey', 'Tailshaft Survey',    'Boiler Survey',
  ]
  const surveys = [], seen = new Set()
  certs.forEach(c => {
    const t = (c.type || c.cert_type || c.certificate_name || '').toUpperCase()
    const n = (c.name || c.certificate_name || '').toUpperCase()
    let mapped = null
    for (const [key, val] of Object.entries(SURVEY_MAP)) {
      if (t.includes(key) || n.includes(key)) { mapped = val; break }
    }
    if (!mapped) mapped = { name: (c.name || c.certificate_name || '').replace(/certificate/i, 'Survey').trim() || 'Survey', category: c.category || 'Statutory' }
    if (seen.has(mapped.name)) return
    seen.add(mapped.name)
    const days   = certDays(c)
    const expiry = c.expiry_date || c.expiryDate
    const status = days === null ? 'unknown' : days < 0 ? 'overdue' : days < 30 ? 'due_soon' : 'ok'
    const rangeFrom = expiry ? new Date(new Date(expiry).getTime() - 90 * 86400000).toISOString() : null
    const assigned  = expiry ? new Date(new Date(expiry).getTime() - 30 * 86400000).toISOString() : null
    surveys.push({ name: mapped.name, category: mapped.category, due_date: expiry, assigned, range_from: rangeFrom, status, days })
  })
  const hasClass = surveys.some(s => s.category === 'Class')
  if (!hasClass && certs.length > 0) {
    const base = certs.find(c => c.expiry_date) || certs[0]
    CLASS_SURVEYS.forEach((name, i) => {
      if (seen.has(name)) return
      const due  = base?.expiry_date ? new Date(new Date(base.expiry_date).getTime() + i * 30 * 86400000).toISOString() : null
      const days = due ? Math.floor((new Date(due) - Date.now()) / 86400000) : null
      surveys.push({
        name, category: 'Class', due_date: due,
        assigned:   due ? new Date(new Date(due).getTime() - 30 * 86400000).toISOString() : null,
        range_from: due ? new Date(new Date(due).getTime() - 90 * 86400000).toISOString() : null,
        status: days === null ? 'unknown' : days < 0 ? 'overdue' : days < 30 ? 'due_soon' : 'ok',
        days,
      })
    })
  }
  return surveys.sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999))
}

export function generateCertNo(imo, index, cert) {
  if (cert.cert_no || cert.number) return cert.cert_no || cert.number
  const imoSuffix = String(imo || '').slice(-4).padStart(4, '0')
  const seq       = String(index + 1).padStart(3, '0')
  const year      = new Date().getFullYear()
  return `${imoSuffix}-${seq}-${year}`
}
