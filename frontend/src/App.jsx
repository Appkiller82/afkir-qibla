
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { PrayerTimes, CalculationMethod, Coordinates, Qibla, HighLatitudeRule, Madhab } from 'adhan'

// ---------- Helpers ----------
const NB_TIME = new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit' })
const NB_DAY = new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: '2-digit', month: 'long' })
const ISO_DATE = (d) => d.toISOString().slice(0,10)

function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try { const json = localStorage.getItem(key); return json ? JSON.parse(json) : initialValue } catch { return initialValue }
  })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} }, [key, value])
  return [value, setValue]
}

// ---------- Build adhan params ----------
function buildParams(methodKey, hlrKey, useIshaInterval) {
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
  p.madhab = Madhab.Shafi // Maliki ~ Shafi (Asr 1x)
  p.highLatitudeRule = HighLatitudeRule[hlrKey] ?? HighLatitudeRule.TwilightAngle
  if (useIshaInterval) p.ishaInterval = 90 // Isha = Maghrib + 90 min
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

// ---------- Modern Compass (Dial rotates by -heading; Kaaba at absolute bearing) ----------
function ModernCompass({ bearing }) {
  const [heading, setHeading] = useState(null)
  const [showHelp, setShowHelp] = useState(false)
  const [manualHeading, setManualHeading] = useState(0)
  const [sensorStatus, setSensorStatus] = useState('idle')
  const cleanupRef = useRef(() => {})

  const onOrientation = (e) => {
    let hdg = null
    if (typeof e.webkitCompassHeading === 'number') hdg = e.webkitCompassHeading
    else if (typeof e.alpha === 'number') hdg = 360 - e.alpha
    if (hdg != null && !Number.isNaN(hdg)) {
      setHeading((hdg + 360) % 360)
      setSensorStatus('granted')
    }
  }

  const requestSensors = async () => {
    try { if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') await DeviceMotionEvent.requestPermission() } catch {}
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { const p = await DeviceOrientationEvent.requestPermission(); if (p !== 'granted') { setSensorStatus('denied'); return false } } catch { setSensorStatus('denied'); return false }
    }
    setSensorStatus('granted')
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
    setTimeout(() => { if (heading == null) { setShowHelp(true); setSensorStatus('noevents') } }, 3000)
  }

  useEffect(() => () => cleanupRef.current(), [])

  const usedHeading = heading == null ? manualHeading : heading
  const dialRotate = useMemo(() => {
    if (usedHeading == null) return 0
    return (-usedHeading + 360) % 360
  }, [usedHeading])

  const kaabaAngle = bearing ?? 0 // absolute from North
  const turnText = (() => {
    if (bearing == null || usedHeading == null) return '—'
    const a = ((bearing - usedHeading + 540) % 360) - 180
    const dir = a > 0 ? 'høyre' : 'venstre'
    return Math.abs(a) < 2 ? 'Rett mot Qibla' : `Drei ${Math.abs(a).toFixed(0)}° ${dir}`
  })()

  return (
    <div>
      <div style={{position:'relative', width:260, height:260, margin:'12px auto', WebkitTransform:'translateZ(0)', transform:'translateZ(0)'}}>
        {/* Base disc */}
        <div style={{
          position:'absolute', inset:0, borderRadius:'50%',
          background:'radial-gradient(120px 120px at 50% 45%, rgba(255,255,255,0.08), rgba(15,23,42,0.7))',
          boxShadow:'inset 0 10px 25px rgba(0,0,0,0.5), 0 2px 12px rgba(0,0,0,0.3)',
          border:'1px solid #334155'
        }}/>

        {/* Rotating dial */}
        <div style={{position:'absolute', inset:8, borderRadius:'50%', transform:`rotate(${dialRotate}deg) translateZ(0)`, transition:'transform 0.08s linear'}}>
          <div style={{position:'absolute', inset:0, borderRadius:'50%', border:'2px solid #3b475e', boxShadow:'inset 0 0 0 6px #0f172a'}}/>
          {[...Array(60)].map((_,i)=>(
            <div key={i} style={{position:'absolute', inset:0, transform:`rotate(${i*6}deg)`}}>
              <div style={{
                position:'absolute', top:6, left:'50%', transform:'translateX(-50%)',
                width: i%5===0 ? 3 : 2, height: i%5===0 ? 14 : 9, background:'#445169', opacity: i%5===0 ? 1 : .7, borderRadius:2
              }}/>
            </div>
          ))}
          <div style={{position:'absolute', inset:0, color:'#a5b4fc', fontWeight:600}}>
            <div style={{position:'absolute', top:12, left:'50%', transform:'translateX(-50%)'}}>N</div>
            <div style={{position:'absolute', bottom:12, left:'50%', transform:'translateX(-50%)'}}>S</div>
            <div style={{position:'absolute', top:'50%', left:12, transform:'translateY(-50%)'}}>V</div>
            <div style={{position:'absolute', top:'50%', right:12, transform:'translateY(-50%)'}}>Ø</div>
          </div>

          {/* Kaaba marker at absolute bearing on the dial */}
          <div style={{position:'absolute', inset:0, transform:`rotate(${kaabaAngle}deg)`}}>
            <div style={{position:'absolute', top:16, left:'50%', transform:'translateX(-50%)'}}>
              <img src="/icons/kaaba.svg" alt="Kaaba" width={34} height={34} draggable="false" />
            </div>
          </div>
        </div>

        {/* Needle (device heading up) */}
        <svg width="260" height="260" style={{position:'absolute', inset:0, pointerEvents:'none', zIndex:4}} aria-hidden="true">
          <defs>
            <linearGradient id="needle" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444"/><stop offset="100%" stopColor="#991b1b"/>
            </linearGradient>
            <linearGradient id="tail" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#94a3b8"/><stop offset="100%" stopColor="#475569"/>
            </linearGradient>
          </defs>
          <g>
            <polygon points="130,36 122,130 138,130" fill="url(#needle)" opacity="0.95"/>
            <polygon points="122,130 138,130 130,200" fill="url(#tail)" opacity="0.85"/>
            <circle cx="130" cy="130" r="8" fill="#e5e7eb" stroke="#334155" strokeWidth="2"/>
            <circle cx="130" cy="130" r="2.5" fill="#1f2937"/>
          </g>
        </svg>

      </div>

      <div className="hint" style={{textAlign:'center', marginTop:6}}>
        {usedHeading == null
          ? 'Ingen sensordata — trykk Aktiver eller bruk manuell slider.'
          : <>Enhetsretning: <b>{usedHeading.toFixed?.(0)}°</b> • Qibla: <b>{bearing?.toFixed?.(1)}°</b> — {turnText}</>}
      </div>
      <div className="hint" style={{textAlign:'center', marginTop:4}}>Debug sensor: <b>{sensorStatus}</b></div>

      <div style={{textAlign:'center', marginTop:10}}>
        <button className="btn" onClick={activateCompass} style={{marginRight:8}}>Aktiver kompass</button>
        <button className="btn" onClick={()=>setShowHelp(true)}>Få i gang kompasset</button>
      </div>

      <div style={{marginTop:12, textAlign:'center'}}>
        <div className="hint">Manuelt kompass (hvis sensoren ikke virker):</div>
        <input type="range" min="0" max="359" value={manualHeading} onChange={e=>setManualHeading(parseInt(e.target.value||'0'))} style={{width:'100%'}}/>
        <div className="hint">Manuell retning: <b>{manualHeading}°</b></div>
      </div>

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

// ---------- Server fetch for prayer times (optional) ----------
async function fetchServerTimes(baseUrl, lat, lng, dateISO, method, hlr, isha90) {
  const url = `${baseUrl}/prayertimes?lat=${lat}&lng=${lng}&date=${dateISO}&method=${encodeURIComponent(method)}&hlr=${encodeURIComponent(hlr)}&isha90=${isha90?1:0}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Server svarte ikke 200')
  const data = await res.json()
  // expected format: { fajr, sunrise, dhuhr, asr, maghrib, isha } as 'HH:mm' local
  return data
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
  const [useIshaInterval, setUseIshaInterval] = useLocalStorage('aq_isha90', true)
  const [useServerDB, setUseServerDB] = useLocalStorage('aq_use_server_db', true)
  const [serverStatus, setServerStatus] = useState('off') // off | ok | fail
  const [adhanError, setAdhanError] = useState('')
  const [pushStatus, setPushStatus] = useState('idle')
  const [tick, setTick] = useState(Date.now())
  const audioRef = useRef(null)

  // Minute tick + midnight refresh
  useEffect(() => {
    let lastDate = ISO_DATE(new Date())
    const iv = setInterval(() => {
      const now = new Date()
      const iso = ISO_DATE(now)
      if (iso !== lastDate) {
        lastDate = iso
        setTick(Date.now()) // triggers recompute
      }
    }, 60 * 1000)
    return () => clearInterval(iv)
  }, [])

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
    try { return buildParams(method, hlr, useIshaInterval) }
    catch { setAdhanError('Feil i beregning.'); return buildParams('Moonsighting', 'TwilightAngle', useIshaInterval) }
  }, [method, hlr, useIshaInterval])

  // Local compute (fallback)
  const localComputed = useMemo(() => {
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
  }, [activeCoords?.latitude, activeCoords?.longitude, params, tick])
  const { qiblaDeg } = localComputed

  // Server DB fetch (optional)
  const [serverTimes, setServerTimes] = useState(null)
  const dateISO = ISO_DATE(new Date())
  useEffect(() => {
    let canceled = false
    ;(async () => {
      if (!useServerDB || !activeCoords) { setServerStatus('off'); setServerTimes(null); return }
      const base = import.meta.env.VITE_API_URL
      if (!base) { setServerStatus('off'); setServerTimes(null); return }
      try {
        setServerStatus('loading')
        const data = await fetchServerTimes(base, activeCoords.latitude, activeCoords.longitude, dateISO, method, hlr, useIshaInterval)
        if (canceled) return
        // Convert 'HH:mm' to Date today
        const now = new Date()
        const mk = (hm) => {
          const [h,m] = String(hm).split(':').map(x=>parseInt(x,10))
          const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h||0, m||0, 0, 0)
          return d
        }
        setServerTimes({
          Fajr: mk(data.fajr), Soloppgang: mk(data.sunrise), Dhuhr: mk(data.dhuhr),
          Asr: mk(data.asr), Maghrib: mk(data.maghrib), Isha: mk(data.isha)
        })
        setServerStatus('ok')
      } catch (e) {
        if (canceled) return
        setServerTimes(null)
        setServerStatus('fail')
      }
    })()
    return () => { canceled = true }
  }, [useServerDB, activeCoords?.latitude, activeCoords?.longitude, method, hlr, useIshaInterval, dateISO, tick])

  const showTimes = serverTimes || localComputed.times
  const dateLabel = localComputed.dateLabel

  const formatTime = (date) => {
    if (!(date instanceof Date)) return '–'
    const str = NB_TIME.format(date)
    return str
  }

  // Push subscribe
  useEffect(() => {
    (async () => {
      if (!pushEnabled) return
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
        await fetch(import.meta.env.VITE_PUSH_SERVER_URL + '/subscribe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub, settings: { minutesBefore, method, hlr, lat: activeCoords?.latitude, lng: activeCoords?.longitude, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } })
        })
      } catch (e) { alert(e.message || 'Klarte ikke aktivere push.'); setPushEnabled(false); }
    })()
  }, [pushEnabled, minutesBefore, method, hlr, activeCoords?.latitude, activeCoords?.longitude])

  async function sendTest() {
    try {
      const base = import.meta.env.VITE_PUSH_SERVER_URL
      if (!base) throw new Error('Mangler VITE_PUSH_SERVER_URL')
      const res = await fetch(base + '/send-test', { method:'POST' })
      if (!res.ok) throw new Error('Server feilet ved test.')
      alert('Testvarsel sendt ✅')
    } catch (e) { alert('Feil ved test: ' + (e.message || 'ukjent feil')) }
  }

  const audioRef = useRef(null)
  const playAdhan = () => { const el = audioRef.current; if (el) { el.currentTime = 0; el.play().catch(()=>{}) } }

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
                : 'Gi tilgang for automatisk lokasjon'}
            </span>
          </div>
        </section>

        <div className="two" style={{display:'grid', gap:12}}>
          <section className="card" style={{border:'1px solid #334155', borderRadius:12, padding:12}}>
            <h3>Qibla-retning</h3>
            {activeCoords ? (
              <>
                <ModernCompass bearing={qiblaDeg} />
                <div className="hint" style={{textAlign:'center'}}>Roter telefonen; når Kaaba-ikonet står i topp, peker du mot Qibla.</div>
              </>
            ) : (<div className="hint">Velg/bekreft posisjon for å vise Qibla.</div>)}
          </section>

          <section className="card" style={{border:'1px solid #334155', borderRadius:12, padding:12}}>
            <h3>Bønnetider i dag</h3>
            <div className="row" style={{marginBottom:8, display:'flex', alignItems:'center', gap:8}}>
              <label><input type="checkbox" checked={useIshaInterval} onChange={e=>setUseIshaInterval(e.target.checked)} /> Isha = Maghrib + 90 min</label>
              <label><input type="checkbox" checked={useServerDB} onChange={e=>setUseServerDB(e.target.checked)} /> Hent fra server/DB</label>
              <span className="hint">Server: {serverStatus}</span>
            </div>
            {showTimes ? (
              <ul className="times" style={{listStyle:'none', padding:0, margin:0}}>
                {Object.entries(showTimes).map(([name, t]) => (
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
              <div className="hint">{import.meta.env.VITE_PUSH_SERVER_URL ? 'Når aktivert: server sender varsel X min før bønn.' : 'Mangler VITE_PUSH_SERVER_URL i Netlify.'}</div>
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
            <button className="btn" onClick={()=>{ const el = audioRef.current; if (el) { el.currentTime = 0; el.play().catch(()=>{}) }}} style={{padding:'8px 12px', borderRadius:8, border:'1px solid #334155', background:'#0b1220', color:'#fff'}}>Test Adhan-lyd</button>
          </div>
        </section>
      </div>

      <audio ref={audioRef} preload="auto" src="/audio/adhan.mp3"></audio>
    </div>
  )
}
