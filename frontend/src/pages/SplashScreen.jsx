import { useEffect, useState } from 'react'
import { Anchor, Radio } from 'lucide-react'

export default function SplashScreen({ onDone }) {
  const [phase, setPhase] = useState(0)
  // phase 0 = mounting  1 = logo in  2 = text in  3 = cta in  4 = fading out

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 100)   // logo scale-in
    const t2 = setTimeout(() => setPhase(2), 900)   // text cascade
    const t3 = setTimeout(() => setPhase(3), 1800)  // enter button
    const t4 = setTimeout(() => setPhase(4), 3400)  // fade out
    const t5 = setTimeout(() => onDone(), 3900)      // unmount
    return () => [t1, t2, t3, t4, t5].forEach(clearTimeout)
  }, [onDone])

  return (
    <>
      <style>{`
        @keyframes sonar {
          0%   { transform: scale(0.6); opacity: 0.7; }
          100% { transform: scale(2.8); opacity: 0; }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes spin-rev {
          from { transform: rotate(0deg); }
          to   { transform: rotate(-360deg); }
        }
        @keyframes blink-dot {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.2; }
        }
        @keyframes scan-line {
          0%   { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes ticker {
          0%   { width: 0%; }
          100% { width: 100%; }
        }
        @keyframes shimmer {
          0%   { background-position: 0% center; }
          100% { background-position: 200% center; }
        }
        .sonar-ring   { animation: sonar 2.4s ease-out infinite; }
        .sonar-ring-2 { animation: sonar 2.4s ease-out infinite 0.8s; }
        .sonar-ring-3 { animation: sonar 2.4s ease-out infinite 1.6s; }
        .orbit        { animation: spin-slow 8s linear infinite; }
        .orbit-rev    { animation: spin-rev 12s linear infinite; }
        .scan         { animation: scan-line 3s linear infinite; }
        .ticker-bar   { animation: ticker 3s linear forwards; }
      `}</style>

      {/* Full-screen wrapper */}
      <div
        className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden select-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 40%, #0d1f3a 0%, #060b18 60%, #020509 100%)',
          transition: 'opacity 0.5s ease',
          opacity: phase === 4 ? 0 : 1,
        }}
      >
        {/* ── Star field (absolute, behind everything) ── */}
        <Stars />

        {/* ── Main content column — logo + text + button all in-flow ── */}
        <div className="relative flex flex-col items-center" style={{ gap: '2.5rem' }}>

          {/* ── Logo + sonar area: fixed 256×256 box, animations inside ── */}
          <div className="relative w-64 h-64 flex items-center justify-center">

            {/* Pulsing sonar rings — absolute within the box, overflow outward */}
            <div className="sonar-ring absolute w-40 h-40 rounded-full border border-[#0FA390]/40" />
            <div className="sonar-ring-2 absolute w-40 h-40 rounded-full border border-[#0FA390]/40" />
            <div className="sonar-ring-3 absolute w-40 h-40 rounded-full border border-[#0FA390]/40" />

            {/* Outer orbit ring */}
            <div className="absolute w-56 h-56 rounded-full border border-[#0FA390]/10" />
            <div className="orbit absolute w-56 h-56 rounded-full"
              style={{ border: '1px dashed rgba(15,163,144,0.25)' }} />

            {/* Scan sweep */}
            <div className="absolute w-40 h-40 rounded-full overflow-hidden" style={{ opacity: 0.18 }}>
              <div className="scan absolute inset-0 origin-center"
                style={{ background: 'conic-gradient(from 0deg, transparent 270deg, #0FA390 360deg)' }} />
            </div>

            {/* ── Logo circle (z-10 so it sits above the rings) ── */}
            <div
              className="relative z-10 w-24 h-24 rounded-2xl flex items-center justify-center"
              style={{
                background:  'linear-gradient(135deg, #0B7C6E 0%, #0FA390 100%)',
                boxShadow:   '0 0 60px rgba(15,163,144,0.5), 0 0 120px rgba(15,163,144,0.2)',
                transition:  'transform 0.7s cubic-bezier(0.34,1.56,0.64,1), opacity 0.7s ease',
                transform:   phase >= 1 ? 'scale(1)' : 'scale(0.2)',
                opacity:     phase >= 1 ? 1 : 0,
              }}
            >
              <Anchor size={44} className="text-white drop-shadow" />

              {/* Corner nav-light dots */}
              {[0, 90, 180, 270].map((deg, i) => (
                <div key={deg} className="absolute w-1.5 h-1.5 rounded-full bg-[#0FA390]"
                  style={{
                    animation: `blink-dot 1.4s ease-in-out ${i * 0.35}s infinite`,
                    top: '50%', left: '50%',
                    transform: `rotate(${deg}deg) translateX(54px) translateY(-50%)`,
                  }} />
              ))}
            </div>

            {/* Orbit satellite dots */}
            <div className="orbit absolute w-56 h-56">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[#0FA390]"
                style={{ boxShadow: '0 0 8px #0FA390' }} />
            </div>
            <div className="orbit-rev absolute w-40 h-40">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-white/50" />
            </div>
          </div>

          {/* ── Text block — sits below the logo box in normal flow ── */}
          <div
            className="text-center px-8"
            style={{
              transition: 'opacity 0.8s ease, transform 0.8s ease',
              opacity:    phase >= 2 ? 1 : 0,
              transform:  phase >= 2 ? 'translateY(0)' : 'translateY(16px)',
            }}
          >
            {/* Brand label */}
            <div className="flex items-center justify-center gap-3 mb-2">
              <Radio size={14} className="text-[#0FA390]" />
              <span className="text-[10px] font-mono tracking-[0.3em] text-[#0FA390] uppercase font-semibold">
                Ch16.ai
              </span>
              <Radio size={14} className="text-[#0FA390]" />
            </div>

            <h1 className="font-heading font-bold text-white leading-tight mb-2"
              style={{ fontSize: 'clamp(1.6rem, 5vw, 2.8rem)', letterSpacing: '-0.02em' }}
            >
              Marine Services
              <br />
              <span style={{
                background: 'linear-gradient(90deg, #0FA390, #5eead4, #0FA390)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundSize: '200% auto',
                animation: 'shimmer 3s linear infinite',
              }}>
                Intelligence
              </span>
            </h1>

            <p className="text-white/50 text-sm font-medium tracking-wide">
              AS Moloobhoy &middot; LSA / FFA Specialists
            </p>

            {/* Feature chips */}
            <div className="flex flex-wrap gap-2 justify-center mt-5">
              {['AIS Tracking', 'Cert Monitoring', 'Fleet Overview', 'Compliance Alerts', 'Port Intelligence'].map((f, i) => (
                <span key={f} className="text-[10px] px-3 py-1 rounded-full font-semibold border"
                  style={{
                    background:   'rgba(15,163,144,0.08)',
                    borderColor:  'rgba(15,163,144,0.25)',
                    color:        'rgba(255,255,255,0.6)',
                    transition:   `opacity 0.4s ease ${0.5 + i * 0.1}s, transform 0.4s ease ${0.5 + i * 0.1}s`,
                    opacity:      phase >= 2 ? 1 : 0,
                    transform:    phase >= 2 ? 'translateY(0)' : 'translateY(8px)',
                  }}>
                  {f}
                </span>
              ))}
            </div>
          </div>

          {/* ── Enter button ── */}
          <div
            style={{
              transition: 'opacity 0.6s ease, transform 0.6s ease',
              opacity:    phase >= 3 ? 1 : 0,
              transform:  phase >= 3 ? 'translateY(0)' : 'translateY(12px)',
            }}
          >
            <button
              onClick={() => { setPhase(4); setTimeout(onDone, 500) }}
              className="group relative px-8 py-3 rounded-full font-semibold text-sm text-white overflow-hidden"
              style={{
                background:  'linear-gradient(135deg, #0B7C6E, #0FA390)',
                boxShadow:   '0 0 24px rgba(15,163,144,0.4)',
              }}
            >
              <span className="relative z-10 flex items-center gap-2">
                <Anchor size={14} />
                Enter Portal
              </span>
              {/* Shimmer on hover */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'linear-gradient(135deg, #0FA390, #5eead4)' }} />
            </button>
          </div>

        </div>{/* end main content column */}

        {/* ── Bottom progress ticker ── */}
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/5">
          <div className="ticker-bar h-full"
            style={{ background: 'linear-gradient(90deg, #0B7C6E, #0FA390, #5eead4)' }} />
        </div>

        {/* ── Powered by ── */}
        <div className="absolute bottom-4 text-[9px] text-white/20 tracking-widest font-mono uppercase">
          Powered by Ch16.ai &middot; Hyla Analytics Platform
        </div>

      </div>
    </>
  )
}

/* ── Tiny star field ─────────────────────────────────────────────── */
function Stars() {
  const stars = Array.from({ length: 60 }, (_, i) => ({
    id:      i,
    x:       Math.random() * 100,
    y:       Math.random() * 100,
    size:    Math.random() * 1.8 + 0.4,
    opacity: Math.random() * 0.5 + 0.1,
    delay:   Math.random() * 3,
  }))
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {stars.map(s => (
        <div key={s.id}
          className="absolute rounded-full bg-white"
          style={{
            left:    `${s.x}%`,
            top:     `${s.y}%`,
            width:   `${s.size}px`,
            height:  `${s.size}px`,
            opacity: s.opacity,
            animation: `blink-dot ${2 + Math.random() * 2}s ease-in-out ${s.delay}s infinite`,
          }} />
      ))}
    </div>
  )
}
