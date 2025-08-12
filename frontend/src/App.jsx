
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { PrayerTimes, CalculationMethod, Coordinates, Qibla, HighLatitudeRule, Madhab } from 'adhan'

// ---------- Helpers & formatters ----------
const NB_TIME = new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit' })
const NB_DAY = new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: '2-digit', month: 'long' })

function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try { const json = localStorage.getItem(key); return json ? JSON.parse(json) : initialValue } catch { return initialValue }
  })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} }, [key, value])
  return [value, setValue]
}

// ---------- Build adhan params ----------
function buildParams(methodKey) {
  const m = CalculationMethod
  let p
  switch (methodKey) {
    case 'MWL': p = m.MuslimWorldLeague(); break
    case 'UmmAlQura': p = m.UmmAlQura(); break
    case 'Egyptian': p = m.Egyptian(); break
    case 'Karachi': p = m.Karachi(); break
    case 'Dubai': p = m.Dubai(); break
    case 'Moonsighting': p = m.Moonsighting(); break
    default: p = m.Moonsighting()
  }
  // Maliki ≈ Shafi (Asr = skygge 1x)
  p.madhab = Madhab.Shafi
  return p
}

// ---------- Geolocation ----------
function useGeolocation() {
  const [coords, setCoords] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [permission, setPermission] = useState('prompt')

  useEffect(() => {
    let mounted = true
    async function checkPerm() {
      try {
        if (navigator.permissions && navigator.permissions.query) {
          const p = await navigator.permissions.query({ name: 'geolocation' })
          if (mounted) setPermission(p.state)
          p.onchange = () => mounted && setPermission(p.state)
        }
      } catch {}
    }
    checkPerm()
    return () => { mounted = false }
  }, [])

  const request = () => {
    if (!('geolocation' in navigator)) { setError('Stedstjenester er ikke tilgjengelig i denne nettleseren.'); return }
    setLoading(true); setError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }); setLoading(false) },
      (err) => {
        const code = err?.code
        let msg = err?.message || 'Kunne ikke hente posisjon.'
        if (code === 1) msg = 'Tilgang til posisjon ble nektet. aA → Nettstedsinnstillinger → Sted = Tillat.'
        if (code === 2) msg = 'Posisjon utilgjengelig. Prøv nær et vindu, slå på GPS/mobilnett, eller skriv inn manuelt.'
        if (code === 3) msg = 'Tidsavbrudd. Prøv igjen, eller skriv inn manuelt.'
        setError(msg); setLoading(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }
  return { coords, error, loading, request, setCoords, permission }
}

// ---------- Reverse geocode (city) ----------
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=nb&zoom=10&addressdetails=1`
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
    const data = await res.json()
    const a = data.address || {}
    const name = a.city || a.town || a.village || a.municipality || a.suburb || a.state || a.county || a.country
    return name || ''
  } catch { return '' }
}

// ---------- Modern Compass (Kaaba fixed top; rotating dial; central needle) ----------
function ModernCompass({ bearing }) {
  const [heading, setHeading] = useState(null)
  const [showHelp, setShowHelp] = useState(false)
  const [manualHeading, setManualHeading] = useState(0)
  const cleanupRef = useRef(() => {})

  const onOrientation = (e) => {
    let hdg = null
    if (typeof e.webkitCompassHeading === 'number') hdg = e.webkitCompassHeading
    else if (typeof e.alpha === 'number') hdg = 360 - e.alpha
    if (hdg != null && !Number.isNaN(hdg)) setHeading((hdg + 360) % 360)
  }

  const requestSensors = async () => {
    try { if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') await DeviceMotionEvent.requestPermission() } catch {}
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { const p = await DeviceOrientationEvent.requestPermission(); if (p !== 'granted') return false } catch { return false }
    }
    return true
  }

  const activateCompass = async () => {
    let ok = true
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') ok = await requestSensors()
    if (!ok) { setShowHelp(true); return }
    window.addEventListener('deviceorientationabsolute', onOrientation, true)
    window.addEventListener('deviceorientation', onOrientation, true)
    cleanupRef.current = () => {
      window.removeEventListener('deviceorientationabsolute', onOrientation, true)
      window.removeEventListener('deviceorientation', onOrientation, true)
    }
    setTimeout(() => { if (heading == null) setShowHelp(true) }, 3000)
  }

  useEffect(() => () => cleanupRef.current(), [])

  const usedHeading = heading == null ? manualHeading : heading
  const delta = useMemo(() => {
    if (bearing == null || usedHeading == null) return 0
    return (bearing - usedHeading + 360) % 360
  }, [bearing, usedHeading])

  const turnText = (() => {
    if (bearing == null || usedHeading == null) return '—'
    const a = ((bearing - usedHeading + 540) % 360) - 180
    const dir = a > 0 ? 'høyre' : 'venstre'
    return Math.abs(a) < 2 ? 'Rett mot Qibla' : `Drei ${Math.abs(a).toFixed(0)}° ${dir}`
  })()

  return (
    <div>
      <div style={{position:'relative', width:260, height:260, margin:'12px auto'}}>
        {/* Glassy background */}
        <div style={{
          position:'absolute', inset:0, borderRadius:'50%',
          background:'radial-gradient(120px 120px at 50% 45%, rgba(255,255,255,0.08), rgba(15,23,42,0.7))',
          boxShadow:'inset 0 10px 25px rgba(0,0,0,0.5), 0 2px 12px rgba(0,0,0,0.3)',
          border:'1px solid #334155'
        }}/>

        {/* Rotating dial ring */}
        <div style={{position:'absolute', inset:8, borderRadius:'50%', transform:`rotate(${delta}deg)`, transition:'transform 0.08s linear'}}>
          <div style={{position:'absolute', inset:0, borderRadius:'50%', border:'2px solid #3b475e', boxShadow:'inset 0 0 0 6px #0f172a'}}/>
          {/* Ticks */}
          {[...Array(60)].map((_,i)=>(
            <div key={i} style={{position:'absolute', inset:0, transform:`rotate(${i*6}deg)`}}>
              <div style={{
                position:'absolute', top:6, left:'50%', transform:'translateX(-50%)',
                width: i%5===0 ? 3 : 2, height: i%5===0 ? 14 : 9, background:'#445169', opacity: i%5===0 ? 1 : .7, borderRadius:2
              }}/>
            </div>
          ))}
          {/* Cardinal letters */}
          <div style={{position:'absolute', inset:0, color:'#a5b4fc', fontWeight:600}}>
            <div style={{position:'absolute', top:12, left:'50%', transform:'translateX(-50%)'}}>N</div>
            <div style={{position:'absolute', bottom:12, left:'50%', transform:'translateX(-50%)'}}>S</div>
            <div style={{position:'absolute', top:'50%', left:12, transform:'translateY(-50%)'}}>V</div>
            <div style={{position:'absolute', top:'50%', right:12, transform:'translateY(-50%)'}}>Ø</div>
          </div>
        </div>

        {/* Fixed Kaaba at top */}
        <div style={{position:'absolute', top:20, left:'50%', transform:'translateX(-50%)'}}>
          <img src="/icons/kaaba.svg" alt="Kaaba" width={36} height={36} draggable="false" />
        </div>

        {/* Needle (viser) */}
        <svg width="260" height="260" style={{position:'absolute', inset:0, pointerEvents:'none'}} aria-hidden="true">
          <defs>
            <linearGradient id="needle" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444"/><stop offset="100%" stopColor="#991b1b"/>
            </linearGradient>
            <linearGradient id="tail" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#94a3b8"/><stop offset="100%" stopColor="#475569"/>
            </linearGradient>
          </defs>
          {/* main needle pointing up */}
          <g filter="url(#shadow-none)">
            <polygon points="130,36 122,130 138,130" fill="url(#needle)" opacity="0.95"/>
            {/* tail */}
            <polygon points="122,130 138,130 130,200" fill="url(#tail)" opacity="0.85"/>
            {/* hub */}
            <circle cx="130" cy="130" r="8" fill="#e5e7eb" stroke="#334155" strokeWidth="2"/>
            <circle cx="130" cy="130" r="2.5" fill="#1f2937"/>
          </g>
        </svg>

        {/* Gloss highlight */}
        <div style={{position:'absolute', inset:0, borderRadius:'50%', background:'radial-gradient(140px 80px at 50% 20%, rgba(255,255,255,0.12), rgba(255,255,255,0.0))'}}/>
      </div>

      <div className="hint" style={{textAlign:'center', marginTop:6}}>
        {usedHeading == null
          ? 'Ingen sensordata — bruk Aktiver kompass eller manuell slider.'
          : <>Enhetsretning: <b>{usedHeading.toFixed?.(0)}°</b> • Qibla: <b>{bearing?.toFixed?.(1)}°</b> — {turnText}</>}
      </div>

      <div style={{textAlign:'center', marginTop:10}}>
        <button className="btn" onClick={activateCompass} style={{marginRight:8}}>Aktiver kompass</button>
        <button className="btn" onClick={()=>setShowHelp(true)}>Få i gang kompasset</button>
      </div>

      {/* Manual heading fallback */}
      <div style={{marginTop:12, textAlign:'center'}}>
        <div className="hint">Manuelt kompass (hvis sensoren ikke virker):</div>
        <input type="range" min="0" max="359" value={manualHeading} onChange={e=>setManualHeading(parseInt(e.target.value||'0'))} style={{width:'100%'}}/>
        <div className="hint">Manuell retning: <b>{manualHeading}°</b></div>
      </div>

      {/* Modal help */}
      {showHelp && (
        <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'grid', placeItems:'center', zIndex:50}} onClick={()=>setShowHelp(false)}>
          <div style={{background:'#0b1220', border:'1px solid #334155', borderRadius:12, padding:16, width:'90%', maxWidth:420}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <h3 style={{margin:0}}>Få i gang kompasset</h3>
              <button className="btn" onClick={()=>setShowHelp(false)}>Lukk</button>
            </div>
            <ol style={{margin:'12px 0 0 18px'}}>
              <li>Trykk <b>Aktiver kompass</b> og velg <b>Tillat</b>.</li>
              <li>Safari: <b>aA</b> → <b>Nettstedsinnstillinger</b> → slå på <b>Bevegelse & orientering</b>.</li>
              <li>Kalibrer ved å bevege telefonen i en <b>figur-8</b>.</li>
            </ol>
            <div style={{marginTop:12, textAlign:'right'}}>
              <button className="btn" onClick={activateCompass}>Aktiver kompass</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- Push helpers ----------
async function getVapidKey() {
  const base = import.meta.env.VITE_PUSH_SERVER_URL
  if (!base) throw new Error('VITE_PUSH_SERVER_URL mangler i Netlify Environment')
  const res = await fetch(base + '/vapidPublicKey')
  if (!res.ok) throw new Error('Kunne ikke hente VAPID nøkkel')
  const data = await res.json()
  return data.publicKey
}
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

// ---------- Main App ----------
export default function App() {
  const { coords, error: geoError, loading, request, setCoords, permission } = useGeolocation()
  const [method, setMethod] = useLocalStorage('aq_method', 'Moonsighting')
  const [hlr, setHlr] = useLocalStorage('aq_hlr', 'TwilightAngle')
  const [use24h, setUse24h] = useLocalStorage('aq_24h', true)
  const [manualLat, setManualLat] = useLocalStorage('aq_lat', '')
  const [manualLng, setManualLng] = useLocalStorage('aq_lng', '')
  const [cityLabel, setCityLabel] = useLocalStorage('aq_city', '')
  const [pushEnabled, setPushEnabled] = useLocalStorage('aq_push', false)
  const [minutesBefore, setMinutesBefore] = useLocalStorage('aq_push_lead', 10)
  const [adhanError, setAdhanError] = useState('')
  const [pushStatus, setPushStatus] = useState('idle')
  const audioRef = useRef(null)

  // City label
  useEffect(() => {
    if (!coords?.latitude || !coords?.longitude) return
    reverseGeocode(coords.latitude, coords.longitude).then(name => { if (name) setCityLabel(name) })
  }, [coords?.latitude, coords?.longitude])

  const activeCoords = useMemo(() => {
    const lat = coords?.latitude ?? parseFloat(manualLat)
    const lng = coords?.longitude ?? parseFloat(manualLng)
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { latitude: lat, longitude: lng }
    return null
  }, [coords, manualLat, manualLng])

  const params = useMemo(() => {
    try {
      const p = buildParams(method)
      p.highLatitudeRule = HighLatitudeRule[hlr] ?? HighLatitudeRule.TwilightAngle
      setAdhanError('')
      return p
    } catch { setAdhanError('Feil med beregningsparametere for bønnetider.'); return buildParams('Moonsighting') }
  }, [method, hlr])

  // Compute prayer times & Qibla
  const computed = useMemo(() => {
    try {
      if (!activeCoords) return { times: null, qiblaDeg: null, dateLabel: NB_DAY.format(new Date()) }
      const d = new Date()
      const c = new Coordinates(activeCoords.latitude, activeCoords.longitude)
      const pt = new PrayerTimes(c, d, params)
      const bearing = Qibla(c)
      return {
        times: { Fajr: pt.fajr, Soloppgang: pt.sunrise, Dhuhr: pt.dhuhr, Asr: pt.asr, Maghrib: pt.maghrib, Isha: pt.isha },
        qiblaDeg: bearing,
        dateLabel: NB_DAY.format(d),
      }
    } catch (e) {
      setAdhanError('Klarte ikke beregne bønnetider her.')
      return { times: null, qiblaDeg: null, dateLabel: NB_DAY.format(new Date()) }
    }
  }, [activeCoords?.latitude, activeCoords?.longitude, params])
  const { times, qiblaDeg, dateLabel } = computed

  const formatTime = (date) => {
    if (!(date instanceof Date)) return '–'
    const str = NB_TIME.format(date)
    if (use24h) return str
    const h = date.getHours(), m = String(date.getMinutes()).padStart(2, '0')
    const ampm = h < 12 ? 'AM' : 'PM', h12 = ((h + 11) % 12) + 1
    return `${h12}:${m} ${ampm}`
  }

  // Push subscribe
  useEffect(() => {
    (async () => {
      if (!pushEnabled) return
      setPushStatus('idle')
      try {
        if (!('Notification' in window)) throw new Error('Varsler støttes ikke i denne nettleseren.')
        const perm = await Notification.requestPermission()
        if (perm !== 'granted') throw new Error('Du må tillate varsler.')
        const reg = await navigator.serviceWorker.ready
        const publicKey = await getVapidKey()
        const existing = await reg.pushManager.getSubscription()
        let sub = existing
        if (!existing) {
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
        }
        const resp = await fetch(import.meta.env.VITE_PUSH_SERVER_URL + '/subscribe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub, settings: { minutesBefore, method, hlr, lat: activeCoords?.latitude, lng: activeCoords?.longitude, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } })
        })
        if (!resp.ok) throw new Error('Server avviste abonnement.')
        setPushStatus('subscribed')
      } catch (e) { alert(e.message || 'Klarte ikke aktivere push.'); setPushEnabled(false); setPushStatus('error') }
    })()
  }, [pushEnabled, minutesBefore, method, hlr, activeCoords?.latitude, activeCoords?.longitude])

  async function disablePush() {
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch(import.meta.env.VITE_PUSH_SERVER_URL + '/unsubscribe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint })
        })
        await sub.unsubscribe()
      }
      setPushEnabled(false); setPushStatus('idle')
    } catch (e) { alert('Klarte ikke avmelde: ' + (e.message || 'ukjent feil')) }
  }

  async function sendTest() {
    try {
      if (pushStatus !== 'subscribed') throw new Error('Aktiver push-varsler først (bryteren over).')
      const res = await fetch(import.meta.env.VITE_PUSH_SERVER_URL + '/send-test', { method:'POST' })
      const data = await res.json().catch(()=>({}))
      if (!res.ok || data.ok === false) throw new Error(data.message || 'Ingen abonnenter på serveren enda.')
      alert('Testvarsel sendt ✅')
    } catch (e) { alert('Feil ved test: ' + (e.message || 'ukjent feil')) }
  }

  const audioOkTip = 'Hvis du ikke hører lyd: 1) sjekk at /audio/adhan.mp3 finnes, 2) slå av stillebryteren (ringer på), 3) øk volumet, 4) trykk knappen igjen.'
  const playAdhan = () => {
    const el = audioRef.current; if (!el) return
    el.currentTime = 0
    el.play().then(()=>{}).catch(()=> alert('Kunne ikke spille av lyd. ' + audioOkTip))
  }

  return (
    <div className="container" style={{padding:16, fontFamily:'system-ui, sans-serif'}}>
      <header>
        <div>
          <h1 style={{margin:'0 0 4px 0'}}>Afkir Qibla</h1>
          <div className="hint">Maliki (Asr = skygge 1x) • {dateLabel}</div>
        </div>
      </header>

      <div className="grid" style={{display:'grid', gap:12}}>
        <section className="card" style={{border:'1px solid #334155', borderRadius:12, padding:12}}>
          <h3>Plassering</h3>
          <div className="row" style={{marginTop:8, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
            <button className="btn" onClick={request} disabled={loading} style={{padding:'8px 12px', borderRadius:8, border:'1px solid #334155', background:'#0b1220', color:'#fff'}}>
              {loading ? 'Henter…' : 'Bruk stedstjenester'}
            </button>
            <span className="hint">
              {coords ? `${cityLabel ? cityLabel + ' • ' : ''}${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`
                : permission === 'denied' ? 'Posisjon er blokkert i nettleseren.'
                : (geoError ? `Feil: ${geoError}` : 'Gi tilgang for automatisk lokasjon')}
            </span>
          </div>
        </section>

        <div className="two" style={{display:'grid', gap:12}}>
          <section className="card" style={{border:'1px solid #334155', borderRadius:12, padding:12}}>
            <h3>Qibla-retning</h3>
            {activeCoords ? (
              <>
                <ModernCompass bearing={qiblaDeg} />
                <div className="hint" style={{textAlign:'center'}}>Drei mobilen slik at Kaaba ligger i topp — da vender du mot Qibla.</div>
              </>
            ) : (<div className="hint">Velg/bekreft posisjon for å vise Qibla.</div>)}
          </section>

          <section className="card" style={{border:'1px solid #334155', borderRadius:12, padding:12}}>
            <h3>Bønnetider i dag</h3>
            {adhanError && <div className="hint" style={{color:'#fca5a5', marginBottom:8}}>{adhanError}</div>}
            {times ? (
              <ul className="times" style={{listStyle:'none', padding:0, margin:0}}>
                {Object.entries(times).map(([name, t]) => (
                  <li key={name} className="time-item" style={{display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px dashed #1f2937'}}>
                    <span style={{fontWeight:600}}>{name}</span>
                    <span>{formatTime(t)}</span>
                  </li>
                ))}
              </ul>
            ) : (<div className="hint">Angi posisjon for å beregne tider.</div>)}
          </section>
        </div>

        <section className="card" style={{border:'1px solid #334155', borderRadius:12, padding:12}}>
          <h3>Varsler</h3>
          <div className="row" style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap'}}>
            <div>
              <div style={{fontSize:14, fontWeight:600}}>Aktiver push-varsler</div>
              <div className="hint">
                {pushStatus === 'subscribed' ? 'Abonnert – test kan sendes.' :
                 pushStatus === 'error' ? 'Feil – sjekk nett og server.' :
                 (!import.meta.env.VITE_PUSH_SERVER_URL ? 'Mangler VITE_PUSH_SERVER_URL i Netlify (kreves for push).' : 'Sender varsel før bønnetid (krever bakendtjeneste).')
                }
              </div>
            </div>
            <div
              className={"switch " + (pushEnabled ? "on": "")}
              onClick={()=> setPushEnabled(!pushEnabled)}
              style={{
                width:54, height:30, borderRadius:20, padding:2, cursor:'pointer',
                background: pushEnabled ? '#16a34a' : '#1f2937', border:'1px solid #334155', display:'flex', alignItems:'center'
              }}
            >
              <div className="knob" style={{
                width:24, height:24, borderRadius:'50%', background:'#fff', transform: pushEnabled ? 'translateX(24px)' : 'translateX(0)',
                transition:'transform .15s ease'
              }}/>
            </div>
          </div>
          <div className="row" style={{marginTop:8, display:'flex', alignItems:'center', gap:8}}>
            <label>Minutter før bønnetid</label>
            <input type="number" min="0" max="60" value={minutesBefore} onChange={e=>setMinutesBefore(parseInt(e.target.value||'0'))} />
          </div>
          <div className="row" style={{marginTop:8, display:'flex', gap:8, flexWrap:'wrap'}}>
            <button className="btn" onClick={sendTest} style={{padding:'8px 12px', borderRadius:8, border:'1px solid #334155', background:'#0b1220', color:'#fff'}}>Send testvarsel</button>
            <button className="btn" onClick={disablePush} style={{padding:'8px 12px', borderRadius:8, border:'1px solid #334155', background:'#0b1220', color:'#fff'}}>Deaktiver/avmeld</button>
            <button className="btn" onClick={()=>{ const el = audioRef.current; if (el) { el.currentTime = 0; el.play().catch(()=>alert('Kunne ikke spille av lyd. ' + audioOkTip)) }}} style={{padding:'8px 12px', borderRadius:8, border:'1px solid #334155', background:'#0b1220', color:'#fff'}}>Test Adhan-lyd</button>
          </div>
          <div className="hint" style={{marginTop:6}}>Hvis du ikke hører lyd: sjekk at <code>/audio/adhan.mp3</code> finnes, at stillebryteren er AV, og at volumet er opp.</div>
        </section>
      </div>

      <audio ref={audioRef} preload="auto" src="/audio/adhan.mp3"></audio>

      <footer style={{marginTop:16, color:'#94a3b8'}}>© {new Date().getFullYear()} Afkir Qibla • Norsk • Maliki Asr (Shafi) – adhan.js • Installer via «Legg til på hjemskjerm»</footer>
    </div>
  )
}
