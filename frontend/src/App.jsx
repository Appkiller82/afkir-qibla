
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
  // Maliki = Shafi for Asr (skygge 1x)
  p.madhab = Madhab.Shafi
  return p
}

// ---- Geolocation hook with robust error handling ----
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
    setLoading(true)
    setError(null)

    const opts = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    let done = false

    const onSuccess = (pos) => {
      if (done) return; done = true
      const { latitude, longitude } = pos.coords
      setCoords({ latitude, longitude })
      setError(null)
      setLoading(false)
    }

    const onError = (err) => {
      if (done) return; done = true
      const code = err?.code
      let msg = err?.message || 'Kunne ikke hente posisjon.'
      if (code === 1) msg = 'Tilgang til posisjon ble nektet. aA → Nettstedsinnstillinger → Sted = Tillat.'
      if (code === 2) msg = 'Posisjon utilgjengelig. Prøv nær et vindu, slå på GPS/mobilnett, eller skriv inn manuelt.'
      if (code === 3) msg = 'Tidsavbrudd. Prøv igjen, eller skriv inn manuelt.'
      setError(msg)
      setLoading(false)
    }

    try {
      navigator.geolocation.getCurrentPosition(onSuccess, onError, opts)
    } catch (e) {
      setError('Uventet feil med stedstjenester.')
      setLoading(false)
    }
  }

  return { coords, error, loading, request, setCoords, permission }
}
// -----------------------------------------------------

// Reverse geocode to get a city/town name (best-effort via Nominatim)
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=nb&zoom=10&addressdetails=1`
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
    const data = await res.json()
    const a = data.address || {}
    const name = a.city || a.town || a.village || a.municipality || a.suburb || a.state || a.county || a.country
    return name || ''
  } catch (e) {
    return ''
  }
}

// ---- Compass with explicit permission flow, degrees label and Kaaba marker ----
function KaabaIcon({ size=26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Kaaba">
      <rect x="3" y="7" width="18" height="12" rx="2" fill="#111827" stroke="#374151" />
      <rect x="3" y="7" width="18" height="4" fill="#22c55e"/>
      <path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z" fill="#111827"/>
    </svg>
  )
}

function Compass({ bearing }) {
  const [heading, setHeading] = useState(null)
  const [perm, setPerm] = useState('prompt')
  const [showHelp, setShowHelp] = useState(false)
  const [hasEvent, setHasEvent] = useState(false)
  const cleanupRef = useRef(() => {})

  const addListeners = () => {
    const onOrientation = (e) => {
      let hdg = null
      if (typeof e.webkitCompassHeading === 'number') {
        hdg = e.webkitCompassHeading // iOS provides degrees from North
      } else if (typeof e.alpha === 'number') {
        // Convert alpha (0-360, clockwise from device top) to compass heading
        hdg = 360 - e.alpha
      }
      if (hdg != null && !Number.isNaN(hdg)) {
        setHeading((hdg + 360) % 360)
        setHasEvent(true)
      }
    }
    window.addEventListener('deviceorientationabsolute', onOrientation, true)
    window.addEventListener('deviceorientation', onOrientation, true)
    cleanupRef.current = () => {
      window.removeEventListener('deviceorientationabsolute', onOrientation, true)
      window.removeEventListener('deviceorientation', onOrientation, true)
    }
  }

  useEffect(() => {
    // If iOS permission API exists, wait for user gesture; else attach directly
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      setPerm('prompt')
      setShowHelp(true)
    } else {
      setPerm('granted')
      addListeners()
    }
    const timer = setTimeout(() => {
      if (!hasEvent && perm === 'granted') setShowHelp(true)
    }, 4000)
    return () => { cleanupRef.current(); clearTimeout(timer) }
  }, [perm])

  const requestCompass = async () => {
    try {
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const p = await DeviceOrientationEvent.requestPermission() // must be in a click
        setPerm(p)
        if (p === 'granted') { addListeners(); setShowHelp(false) }
        else { setShowHelp(true) }
      } else {
        setPerm('granted')
        addListeners()
        setShowHelp(false)
      }
    } catch {
      setPerm('denied')
      setShowHelp(true)
    }
  }

  const arrowRotation = useMemo(() => {
    if (heading == null || bearing == null) return 0
    return (bearing - heading + 360) % 360
  }, [heading, bearing])

  return (
    <div className="compass-wrap">
      <div className="dial">
        <div className="mark n">N</div>
        <div className="mark s">S</div>
        <div className="mark w">V</div>
        <div className="mark e">Ø</div>
        {/* Qibla arrow */}
        <div className="arrow" style={{ transform: `translateY(10px) rotate(${arrowRotation}deg)` }} aria-label="Qibla-pil"></div>
        {/* Kaaba marker at the tip */}
        <div style={{ position:'absolute', top: 20, transform:`rotate(${arrowRotation}deg)` }}>
          <div style={{ transform:'translate(-50%, -10px) rotate(-'+arrowRotation+'deg)' }}>
            <KaabaIcon />
          </div>
        </div>
      </div>

      {showHelp && (
        <div style={{marginTop:12, border:'1px solid #334155', borderRadius:12, padding:12, background:'#0b1220'}}>
          <div style={{fontWeight:600, marginBottom:8}}>Få kompasset i gang</div>
          <ol style={{margin:'0 0 8px 16px'}}>
            <li>Trykk <b>Aktiver kompass</b> og velg <b>Tillat</b>.</li>
            <li>Hvis du ikke får spørsmål: i Safari, trykk <b>aA</b> → <b>Nettstedsinnstillinger</b> → slå på <b>Bevegelse & orientering</b>.</li>
            <li>Kalibrer ved å bevege telefonen i en <b>figur-8</b>.</li>
          </ol>
          <button className="btn" onClick={requestCompass}>Aktiver kompass</button>
        </div>
      )}

      <div className="hint" style={{textAlign:'center', marginTop:8}}>
        {perm !== 'granted'
          ? 'Kompass-tillatelse er ikke aktivert ennå.'
          : (heading == null ? 'Venter på kompass…' : <>Enhetsretning: {heading.toFixed(0)}° • Qibla: {bearing?.toFixed?.(1)}°</>)
        }
      </div>
    </div>
  )
}
// -----------------------------------------------------------------------------

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
  const [pushStatus, setPushStatus] = useState('idle') // idle | ready | subscribed | error

  // Reverse geocode when coords change
  useEffect(() => {
    if (!coords?.latitude || !coords?.longitude) return
    reverseGeocode(coords.latitude, coords.longitude).then(name => {
      if (name) setCityLabel(name)
    })
  }, [coords?.latitude, coords?.longitude])

  const activeCoords = useMemo(() => {
    if (coords) return coords
    const lat = parseFloat(manualLat)
    const lng = parseFloat(manualLng)
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) return { latitude: lat, longitude: lng }
    return null
  }, [coords, manualLat, manualLng])

  const params = useMemo(() => {
    try {
      const p = buildParams(method)
      p.highLatitudeRule = HighLatitudeRule[hlr] ?? HighLatitudeRule.MiddleOfTheNight
      setAdhanError('')
      return p
    } catch (e) {
      setAdhanError('Feil med beregningsparametere for bønnetider.')
      return buildParams('MWL')
    }
  }, [method, hlr])

  const compute = () => {
    try {
      if (!activeCoords) return { times: null, qiblaDeg: null, dateLabel: NB_DAY.format(new Date()) }
      const d = new Date()
      const c = new Coordinates(activeCoords.latitude, activeCoords.longitude)
      const pt = new PrayerTimes(c, d, params)
      const bearing = Qibla(c)
      return {
        times: {
          Fajr: pt.fajr,
          Soloppgang: pt.sunrise,
          Dhuhr: pt.dhuhr,
          Asr: pt.asr,
          Maghrib: pt.maghrib,
          Isha: pt.isha,
        },
        qiblaDeg: bearing,
        dateLabel: NB_DAY.format(d),
      }
    } catch (e) {
      console.error('Adhan error:', e)
      setAdhanError('Klarte ikke beregne bønnetider her. Prøv en annen metode eller sett posisjon manuelt.')
      return { times: null, qiblaDeg: null, dateLabel: NB_DAY.format(new Date()) }
    }
  }
  const { times, qiblaDeg, dateLabel } = compute()

  const formatTime = (date) => {
    if (!(date instanceof Date)) return '–'
    const str = NB_TIME.format(date)
    if (use24h) return str
    const h = date.getHours(); const m = String(date.getMinutes()).padStart(2, '0')
    const ampm = h < 12 ? 'AM' : 'PM'
    const h12 = ((h + 11) % 12) + 1
    return `${h12}:${m} ${ampm}`
  }

  const setManual = () => {
    const lat = parseFloat(manualLat)
    const lng = parseFloat(manualLng)
    if (Number.isNaN(lat) || Number.isNaN(lng)) return
    setCoords({ latitude: lat, longitude: lng })
  }

  // PUSH SUBSCRIPTION
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
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
          })
        }
        const resp = await fetch(import.meta.env.VITE_PUSH_SERVER_URL + '/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: sub,
            settings: {
              minutesBefore,
              method,
              hlr,
              lat: activeCoords?.latitude,
              lng: activeCoords?.longitude,
              tz: Intl.DateTimeFormat().resolvedOptions().timeZone
            }
          })
        })
        if (!resp.ok) throw new Error('Server avviste abonnement.')
        setPushStatus('subscribed')
      } catch (e) {
        alert(e.message || 'Klarte ikke aktivere push.')
        setPushEnabled(false)
        setPushStatus('error')
      }
    })()
  }, [pushEnabled, minutesBefore, method, hlr, activeCoords?.latitude, activeCoords?.longitude])

  async function disablePush() {
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch(import.meta.env.VITE_PUSH_SERVER_URL + '/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint })
        })
        await sub.unsubscribe()
      }
      setPushEnabled(false)
      setPushStatus('idle')
    } catch (e) {
      alert('Klarte ikke avmelde: ' + (e.message || 'ukjent feil'))
    }
  }

  async function sendTest() {
    try {
      if (pushStatus !== 'subscribed') throw new Error('Aktiver push-varsler først (bryteren over).')
      const res = await fetch(import.meta.env.VITE_PUSH_SERVER_URL + '/send-test', { method:'POST' })
      const data = await res.json().catch(()=>({}))
      if (!res.ok || data.ok === false) throw new Error(data.message || 'Ingen abonnenter på serveren enda.')
      alert('Testvarsel sendt ✅')
    } catch (e) {
      alert('Feil ved test: ' + (e.message || 'ukjent feil'))
    }
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
          {geoError && <div className="hint" style={{color:'#fca5a5', marginTop:6}}>{geoError}</div>}
          <div className="row" style={{marginTop:8}}>
            <input placeholder="By/sted (valgfritt)" value={cityLabel} onChange={e=>setCityLabel(e.target.value)} />
            <input placeholder="Breddegrad (lat)" value={manualLat} onChange={e=>setManualLat(e.target.value)} />
            <input placeholder="Lengdegrad (lng)" value={manualLng} onChange={e=>setManualLng(e.target.value)} />
          </div>
          <div className="row" style={{marginTop:8}}>
            <button className="btn" onClick={setManual}>Bruk manuell posisjon</button>
            {coords && !cityLabel && <span className="hint">Henter stedsnavn…</span>}
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
          </div>
        </section>
      </div>

      <footer>© {new Date().getFullYear()} Afkir Qibla • Norsk • Maliki Asr (Shafi) – adhan.js • Installer via «Legg til på hjemskjerm»</footer>
    </div>
  )
}
