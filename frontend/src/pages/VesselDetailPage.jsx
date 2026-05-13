import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Ship, ArrowLeft, MapPin, Anchor, Activity, ShieldCheck,
  Calendar, Flag, Globe, Ruler, Weight, Clock
} from 'lucide-react'
import { vesselAPI } from '../lib/api'

function DetailRow({ label, value, mono }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className={`detail-value ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
    </div>
  )
}

function CertRow({ cert, index }) {
  const expDate = cert.expiry_date || cert.expiryDate || cert.ExpiryDate
  const now = Date.now()
  let status = 'unknown', label = 'Unknown'
  if (expDate) {
    const diff = new Date(expDate).getTime() - now
    if (diff < 0) { status='expired'; label='Expired' }
    else if (diff < 30*24*3600*1000) { status='expiring'; label='Expiring Soon' }
    else { status='valid'; label='Valid' }
  }

  return (
    <tr>
      <td style={{ fontWeight:500, color:'#111827', fontSize:'0.875rem' }}>
        {cert.cert_type || cert.certType || cert.CertType || cert.type || cert.name || cert.certificate_name || `Certificate ${index+1}`}
      </td>
      <td><span style={{ fontSize:'0.8rem', color:'#6b7280' }}>{cert.cert_no || cert.certNo || '—'}</span></td>
      <td><span style={{ fontSize:'0.8rem', color:'#6b7280' }}>{expDate ? new Date(expDate).toLocaleDateString() : '—'}</span></td>
      <td>
        <span className={`badge badge-${status}`}>
          <span className={`status-dot ${status}`} />
          {label}
        </span>
      </td>
      <td><span style={{ fontSize:'0.8rem', color:'#6b7280' }}>{cert.issuing_authority || cert.issuingAuthority || cert.IssuingAuthority || cert.issuing_office || '—'}</span></td>
    </tr>
  )
}

export default function VesselDetailPage() {
  const { imo }    = useParams()
  const navigate   = useNavigate()
  const [vessel,   setVessel]   = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [tab,      setTab]      = useState('overview')

  useEffect(() => {
    vesselAPI.get(imo)
      .then(r => setVessel(r.data))
      .catch(e => console.error(e))
      .finally(() => setLoading(false))
  }, [imo])

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ padding:'4rem' }}>
        <div className="spinner spinner-lg" />
      </div>
    )
  }

  if (!vessel) {
    return (
      <div className="empty-state" style={{ padding:'4rem' }}>
        <Ship size={40} className="empty-state-icon" />
        <p style={{ fontWeight:500 }}>Vessel not found</p>
        <button className="btn btn-secondary btn-sm mt-4" onClick={() => navigate('/vessels')}>
          <ArrowLeft size={14} /> Back to Vessels
        </button>
      </div>
    )
  }

  const certs = vessel.certificates || []

  return (
    <div className="fade-in">
      {/* Back + header */}
      <button className="btn btn-ghost btn-sm mb-4" onClick={() => navigate('/vessels')}>
        <ArrowLeft size={14} /> Back to Vessels
      </button>

      <div className="flex items-start gap-4 mb-6">
        <div style={{
          width:'3.5rem', height:'3.5rem', background:'#f0fdfa',
          borderRadius:'0.875rem', display:'flex', alignItems:'center', justifyContent:'center',
          border:'1px solid #99f6e4', flexShrink:0,
        }}>
          <Ship size={22} color="#0d9488" />
        </div>
        <div>
          <h1 className="page-title">{vessel.name || `IMO ${vessel.imo}`}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="font-mono" style={{ fontSize:'0.8rem', color:'#9ca3af' }}>IMO {vessel.imo}</span>
            {vessel.mmsi  && <span className="font-mono" style={{ fontSize:'0.8rem', color:'#9ca3af' }}>MMSI {vessel.mmsi}</span>}
            {vessel.flag  && <span className="badge badge-gray"><Flag size={10}/>{vessel.flag}</span>}
            {vessel.vessel_type && <span className="badge badge-teal">{vessel.vessel_type}</span>}
            {vessel.class_society && <span className="badge badge-blue">{vessel.class_society}</span>}
          </div>
        </div>

        {/* Live position badge */}
        {vessel.lat && (
          <div style={{ marginLeft:'auto' }}>
            <div style={{
              background:'#ecfdf5', border:'1px solid #a7f3d0',
              borderRadius:'0.625rem', padding:'0.5rem 0.875rem',
              display:'flex', alignItems:'center', gap:'0.5rem',
            }}>
              <span className="status-dot valid" />
              <div>
                <div style={{ fontSize:'0.75rem', color:'#059669', fontWeight:600 }}>LIVE AIS</div>
                <div className="font-mono" style={{ fontSize:'0.7rem', color:'#374151' }}>
                  {vessel.lat?.toFixed(4)}°N {vessel.lon?.toFixed(4)}°E
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="tab-nav">
        {[
          { id:'overview', label:'Overview' },
          { id:'certificates', label:`Certificates (${certs.length})` },
          { id:'ais', label:'AIS / Position' },
        ].map(t => (
          <div key={t.id} className={`tab-item${tab===t.id?' active':''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </div>
        ))}
      </div>

      {/* Overview tab */}
      {tab === 'overview' && (
        <div className="grid gap-4" style={{ gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))' }}>
          <div className="card">
            <h3 style={{ fontSize:'0.875rem', fontWeight:700, color:'#111827', marginBottom:'0.75rem' }}>Vessel Particulars</h3>
            <DetailRow label="Name"          value={vessel.name} />
            <DetailRow label="IMO Number"    value={vessel.imo} mono />
            <DetailRow label="MMSI"          value={vessel.mmsi} mono />
            <DetailRow label="Callsign"      value={vessel.callsign} mono />
            <DetailRow label="Flag"          value={vessel.flag} />
            <DetailRow label="Type"          value={vessel.vessel_type || vessel.spire_type} />
            <DetailRow label="Year Built"    value={vessel.year_built} />
            <DetailRow label="Class Society" value={vessel.class_society} />
          </div>

          <div className="card">
            <h3 style={{ fontSize:'0.875rem', fontWeight:700, color:'#111827', marginBottom:'0.75rem' }}>Dimensions</h3>
            <DetailRow label="Gross Tonnage" value={vessel.gross_tonnage ? `${vessel.gross_tonnage?.toLocaleString()} GT` : null} />
            <DetailRow label="DWT"           value={vessel.dwt ? `${vessel.dwt?.toLocaleString()} MT` : null} />
            <DetailRow label="LOA"           value={vessel.loa ? `${vessel.loa} m` : null} />
            <DetailRow label="Beam"          value={vessel.beam ? `${vessel.beam} m` : null} />
            <DetailRow label="Max Draft"     value={vessel.max_draft ? `${vessel.max_draft} m` : null} />
          </div>

          <div className="card">
            <h3 style={{ fontSize:'0.875rem', fontWeight:700, color:'#111827', marginBottom:'0.75rem' }}>Ownership</h3>
            <DetailRow label="Ship Owner"    value={vessel.ship_owner} />
            <DetailRow label="Ship Manager"  value={vessel.ship_manager} />
            <DetailRow label="Port"              value={vessel.port} />
            <DetailRow label="Port of Registry" value={vessel.port_of_registry} />
            <DetailRow label="Berth"             value={vessel.berth} />
            <DetailRow label="Service Types" value={(vessel.service_types || []).join(', ') || null} />
          </div>

          {vessel.eta && (
            <div className="card">
              <h3 style={{ fontSize:'0.875rem', fontWeight:700, color:'#111827', marginBottom:'0.75rem' }}>Voyage</h3>
              <DetailRow label="Destination" value={vessel.destination} />
              <DetailRow label="ETA"         value={vessel.eta ? new Date(vessel.eta).toLocaleString() : null} />
              <DetailRow label="ETD"         value={vessel.etd ? new Date(vessel.etd).toLocaleString() : null} />
            </div>
          )}
        </div>
      )}

      {/* Certificates tab */}
      {tab === 'certificates' && (
        <div className="card" style={{ padding:0 }}>
          {certs.length ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Certificate</th>
                    <th>Number</th>
                    <th>Expiry Date</th>
                    <th>Status</th>
                    <th>Issuing Authority</th>
                  </tr>
                </thead>
                <tbody>
                  {certs.map((c, i) => <CertRow key={i} cert={c} index={i} />)}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <ShieldCheck size={36} className="empty-state-icon" />
              <p>No certificate data available</p>
            </div>
          )}
        </div>
      )}

      {/* AIS tab */}
      {tab === 'ais' && (
        <div className="grid gap-4" style={{ gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))' }}>
          <div className="card">
            <h3 style={{ fontSize:'0.875rem', fontWeight:700, color:'#111827', marginBottom:'0.75rem' }}>Current Position</h3>
            <DetailRow label="Latitude"    value={vessel.lat != null ? `${vessel.lat?.toFixed(5)}°` : null} mono />
            <DetailRow label="Longitude"   value={vessel.lon != null ? `${vessel.lon?.toFixed(5)}°` : null} mono />
            <DetailRow label="Speed"       value={vessel.speed != null ? `${vessel.speed} kn` : null} />
            <DetailRow label="Course"      value={vessel.course != null ? `${vessel.course}°` : null} />
            <DetailRow label="Nav Status"  value={vessel.nav_status} />
            <DetailRow label="Destination" value={vessel.destination} />
            <DetailRow label="Last Update" value={vessel.last_ais_update ? new Date(vessel.last_ais_update).toLocaleString() : null} />
          </div>

          {!vessel.lat && (
            <div className="card flex items-center justify-center" style={{ minHeight:'10rem' }}>
              <div className="text-center" style={{ color:'#9ca3af' }}>
                <MapPin size={28} style={{ marginBottom:'0.5rem', opacity:0.4 }} />
                <p style={{ fontSize:'0.875rem' }}>No AIS position available</p>
                <p style={{ fontSize:'0.8rem', color:'#d1d5db' }}>Subscribe this vessel to start receiving live data</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
