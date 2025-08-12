
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { PrayerTimes, CalculationMethod, Coordinates, Qibla, HighLatitudeRule, Madhab } from 'adhan'

const NB_TIME = new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit' })
const NB_DAY = new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: '2-digit', month: 'long' })

function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try { const json = localStorage.getItem(key); return json ? JSON.parse(json) : initialValue } catch { return initialValue }
  })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} }, [key, value])
  return [value, setValue]
}

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
    default: p = m.MuslimWorldLeague()
  }
  p.madhab = Madhab.Shafi // Maliki ~ Shafi (Asr 1x skygge)
  return p
}

// ---- Geolocation hook ----
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
    if (!('geolocation' in navigator)) {
      setError('Stedstjenester er ikke tilgjengelig i denne nettleseren.')
      return
    }
    setLoading(true); setError(null)
    const opts = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    navigator.geolocation.getCurrentPosition(
      (pos) => { const { latitude, longitude } = pos.coords; setCoords({ latitude, longitude }); setLoading(false) },
      (err) => {
        const code = err?.code
        let msg = err?.message || 'Kunne ikke hente posisjon.'
        if (code === 1) msg = 'Tilgang til posisjon ble nektet. aA → Nettstedsinnstillinger → Sted = Tillat.'
        if (code === 2) msg = 'Posisjon utilgjengelig. Prøv nær et vindu, slå på GPS/mobilnett, eller skriv inn manuelt.'
        if (code === 3) msg = 'Tidsavbrudd. Prøv igjen, eller skriv inn manuelt.'
        setError(msg); setLoading(false)
      },
      opts
    )
  }
  return { coords, error, loading, request, setCoords, permission }
}

// ---- Reverse geocode (city) ----
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

// ---- Compass ----
function KaabaIcon({ size=28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Kaaba">
      <rect x="8" y="20" width="48" height="34" rx="4" fill="#111827" stroke="#374151" strokeWidth="2"/>
      <rect x="8" y="20" width="48" height="10" fill="#16a34a"/>
      <rect x="12" y="23" width="8" height="6" fill="#111827"/>
      <rect x="28" y="23" width="8" height="6" fill="#111827"/>
      <rect x="44" y="23" width="8" height="6" fill="#111827"/>
    </svg>
  )
}

function Compass({ bearing }) {
  const [heading, setHeading] = useState(null)
  const [activated, setActivated] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [manualHeading, setManualHeading] = useState(0)
  const cleanupRef = useRef(() => {})

  const addListeners = () => {
    const onOrientation = (e) => {
      let hdg = null
      if (typeof e.webkitCompassHeading === 'number') {
        hdg = e.webkitCompassHeading
      } else if (typeof e.alpha === 'number') {
        hdg = 360 - e.alpha
      }
      if (hdg != null && !Number.isNaN(hdg)) {
        setHeading((hdg + 360) % 360)
      }
    }
    window.addEventListener('deviceorientationabsolute', onOrientation, true)
    window.addEventListener('deviceorientation', onOrientation, true)
    cleanupRef.current = () => {
      window.removeEventListener('deviceorientationabsolute', onOrientation, true)
      window.removeEventListener('deviceorientation', onOrientation, true)
    }
  }

  const requestSensors = async () => {
    // On iOS 13+, both may require permission
    try {
      if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') {
        await DeviceMotionEvent.requestPermission().catch(()=>{})
      }
    } catch {}
    try {
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const p = await DeviceOrientationEvent.requestPermission()
        if (p !== 'granted') return false
      }
    } catch {}
    return true
  }

  const activateCompass = async () => {
    let ok = true
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      ok = await requestSensors()
    }
    if (!ok) { setShowHelp(true); return }
    addListeners()
    setActivated(true)
    setTimeout(() => { if (heading == null) setShowHelp(true) }, 3000)
  }

  useEffect(() => () => cleanupRef.current(), [])

  const usedHeading = heading == null ? manualHeading : heading
  const arrowRotation = useMemo(() => {
    if (usedHeading == null || bearing == null) return 0
    return (bearing - usedHeading + 360) % 360
  }, [usedHeading, bearing])

  return (
    <div>
      <div style={{position:'relative', width:220, height:220, margin:'12px auto'}}>
        <div style={{position:'absolute', inset:0, borderRadius:'50%', border:'2px solid #334155', boxShadow:'inset 0 0 0 6px #0f172a'}}/>
        {[...Array(12)].map((_,i)=>(
          <div key={i} style={{
            position:'absolute', top:6, left:'50%', width:2, height:10, background:'#334155',
            transform:`translateX(-50%) rotate(${i*30}deg) translateY(-90px)`,
            transformOrigin:'center 100px', borderRadius:1, opacity: i%3===0 ? 1 : 0.6
          }}/>
        ))}
        <div style={{position:'absolute', top:10, left:'50%', transform:'translateX(-50%)', fontSize:12, color:'#94a3b8'}}>N</div>
        <div style={{position:'absolute', bottom:10, left:'50%', transform:'translateX(-50%)', fontSize:12, color:'#94a3b8'}}>S</div>
        <div style={{position:'absolute', top:'50%', left:10, transform:'translateY(-50%)', fontSize:12, color:'#94a3b8'}}>V</div>
        <div style={{position:'absolute', top:'50%', right:10, transform:'translateY(-50%)', fontSize:12, color:'#94a3b8'}}>Ø</div>

        {/* Qibla arrow + Kaaba */}
        <div className="arrow" style={{ position:'absolute', left:'50%', top:'50%', width:2, height:80, background:'#22c55e', transform:`translate(-50%, -60%) rotate(${arrowRotation}deg)`, transformOrigin:'bottom center', borderRadius:1}}/>
        <div style={{position:'absolute', left:'50%', top:'50%', transform:`translate(-50%, -110%) rotate(${arrowRotation}deg)`}}>
          <div style={{ transform:`translate(-50%, -14px) rotate(${-arrowRotation}deg)` }}>
            <KaabaIcon />
          </div>
        </div>
      </div>

      <div className="hint" style={{textAlign:'center', marginTop:4}}>
        {heading == null
          ? <>Ingen sensordata – bruk <b>Aktiver kompass</b> eller <b>Manuelt kompass</b> under.</>
          : <>Enhetsretning: <b>{heading.toFixed(0)}°</b> • Qibla: <b>{bearing?.toFixed?.(1)}°</b></>}
      </div>

      <div style={{textAlign:'center', marginTop:8}}>
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
              <li>Unngå magnetdeksler/metallbord.</li>
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

// ---- Push helpers ----
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

export default function App() {
  const { coords, error: geoError, loading, request, setCoords, permission } = useGeolocation()
  const [method, setMethod] = useLocalStorage('aq_method', 'MWL')
  const [hlr, setHlr] = useLocalStorage('aq_hlr', 'MiddleOfTheNight')
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
    if (coords) return coords
    const lat = parseFloat(manualLat), lng = parseFloat(manualLng)
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) return { latitude: lat, longitude: lng }
    return null
  }, [coords, manualLat, manualLng])

  const params = useMemo(() => {
    try {
      const p = buildParams(method)
      p.highLatitudeRule = HighLatitudeRule[hlr] ?? HighLatitudeRule.MiddleOfTheNight
      setAdhanError('')
      return p
    } catch { setAdhanError('Feil med beregningsparametere for bønnetider.'); return buildParams('MWL') }
  }, [method, hlr])

  const compute = () => {
    try {
      if (!activeCoords) return { times: null, qiblaDeg: null, dateLabel: NB_DAY.format(new Date()) }
      const d = new Date()
      const c = new Coordinates(activeCoords.latitude, activeCoords.longitude)
      const pt = new PrayerTimes(c, d, params)
      const bearing = Qibla(c)
      return { times: { Fajr: pt.fajr, Soloppgang: pt.sunrise, Dhuhr: pt.dhuhr, Asr: pt.asr, Maghrib: pt.maghrib, Isha: pt.isha }, qiblaDeg: bearing, dateLabel: NB_DAY.format(d) }
    } catch (e) {
      setAdhanError('Klarte ikke beregne bønnetider her.')
      return { times: null, qiblaDeg: null, dateLabel: NB_DAY.format(new Date()) }
    }
  }
  const { times, qiblaDeg, dateLabel } = compute()

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
    <div className="container">
      <header>
        <div>
          <h1 style={{margin:'0 0 4px 0'}}>Afkir Qibla</h1>
          <div className="hint">Maliki (Asr = skygge 1x) • {dateLabel}</div>
        </div>
      </header>

      <div className="grid">
        <section className="card">
          <h3>Plassering</h3>
          <div className="row" style={{marginTop:8}}>
            <button className="btn" onClick={request} disabled={loading}>{loading ? 'Henter…' : 'Bruk stedstjenester'}</button>
            <span className="hint">
              {coords ? `${cityLabel ? cityLabel + ' • ' : ''}${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`
                : permission === 'denied' ? 'Posisjon er blokkert i nettleseren.'
                : (geoError ? `Feil: ${geoError}` : 'Gi tilgang for automatisk lokasjon')}
            </span>
          </div>
        </section>

        <div className="two">
          <section className="card">
            <h3>Qibla-retning</h3>
            {activeCoords ? (
              <>
                <Compass bearing={qiblaDeg} />
                <div className="hint" style={{textAlign:'center'}}>Pek enheten slik at <b>Kaaba-ikonet</b> peker opp — da vender du mot Qibla.</div>
              </>
            ) : (<div className="hint">Velg/bekreft posisjon for å vise Qibla.</div>)}
          </section>

          <section className="card">
            <h3>Bønnetider i dag</h3>
            {adhanError && <div className="hint" style={{color:'#fca5a5', marginBottom:8}}>{adhanError}</div>}
            {times ? (
              <ul className="times">
                {Object.entries(times).map(([name, t]) => (
                  <li key={name} className="time-item">
                    <span style={{fontWeight:600}}>{name}</span>
                    <span>{formatTime(t)}</span>
                  </li>
                ))}
              </ul>
            ) : (<div className="hint">Angi posisjon for å beregne tider.</div>)}
          </section>
        </div>

        <section className="card">
          <h3>Varsler</h3>
          <div className="row" style={{justifyContent:'space-between'}}>
            <div>
              <div style={{fontSize:14, fontWeight:600}}>Aktiver push-varsler</div>
              <div className="hint">
                {pushStatus === 'subscribed' ? 'Abonnert – test kan sendes.' :
                 pushStatus === 'error' ? 'Feil – sjekk nett og server.' :
                 'Sender varsel før bønnetid (krever bakendtjeneste).'
                }
              </div>
            </div>
            <div className={"switch " + (pushEnabled ? "on": "")} onClick={()=> setPushEnabled(!pushEnabled)}>
              <div className="knob" />
            </div>
          </div>
          <div className="row" style={{marginTop:8}}>
            <label>Minutter før bønnetid</label>
            <input type="number" min="0" max="60" value={minutesBefore} onChange={e=>setMinutesBefore(parseInt(e.target.value||'0'))} />
          </div>
          <div className="row" style={{marginTop:8}}>
            <button className="btn" onClick={sendTest}>Send testvarsel</button>
            <button className="btn" onClick={disablePush}>Deaktiver/avmeld</button>
            <button className="btn" onClick={playAdhan}>Test Adhan-lyd</button>
          </div>
          <div className="hint" style={{marginTop:6}}>{audioOkTip}</div>
        </section>
      </div>

      <audio ref={audioRef} preload="auto" src="/audio/adhan.mp3"></audio>

      <footer>© {new Date().getFullYear()} Afkir Qibla • Norsk • Maliki Asr (Shafi) – adhan.js • Installer via «Legg til på hjemskjerm»</footer>
    </div>
  )
}
