import React, { useEffect, useMemo, useState } from 'react'
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

const calcMethodOptions = [
  { value: 'MWL', label: 'Muslim World League (anbefalt)' },
  { value: 'UmmAlQura', label: 'Umm al-Qura (Mekka)' },
  { value: 'Egyptian', label: 'Egyptian General Authority' },
  { value: 'Karachi', label: 'Karachi' },
  { value: 'Dubai', label: 'Dubai' },
  { value: 'Moonsighting', label: 'Moonsighting Committee' },
]

const highLatOptions = [
  { value: 'MiddleOfTheNight', label: 'Midt-på-natten (anbefalt)' },
  { value: 'SeventhOfTheNight', label: '1/7 av natten' },
  { value: 'TwilightAngle', label: 'Skumringsvinkel' },
]

function buildParams(methodKey) {
  const m = CalculationMethod
  switch (methodKey) {
    case 'MWL': return m.MuslimWorldLeague()
    case 'UmmAlQura': return m.UmmAlQura()
    case 'Egyptian': return m.Egyptian()
    case 'Karachi': return m.Karachi()
    case 'Dubai': return m.Dubai()
    case 'Moonsighting': return m.Moonsighting()
    default: return m.MuslimWorldLeague()
  }
}

function useGeolocation() {
  const [coords, setCoords] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const request = () => {
    if (!('geolocation' in navigator)) {
      setError('Stedstjenester er ikke tilgjengelig i denne nettleseren.')
      return
    }
    setLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        setCoords({ latitude, longitude })
        setError(null)
        setLoading(false)
      },
      (err) => {
        setError(err.message || 'Kunne ikke hente posisjon.')
        setLoading(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    )
  }
  return { coords, error, loading, request, setCoords }
}

function Compass({ bearing }) {
  const [heading, setHeading] = useState(null)
  const [perm, setPerm] = useState('prompt')

  useEffect(() => {
    const onOrientation = (e) => {
      let hdg = null
      if (typeof e.webkitCompassHeading === 'number') {
        hdg = e.webkitCompassHeading
      } else if (typeof e.alpha === 'number') {
        hdg = 360 - e.alpha
      }
      if (hdg != null) setHeading((hdg + 360) % 360)
    }

    const enable = async () => {
      try {
        if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
          const p = await DeviceOrientationEvent.requestPermission()
          setPerm(p)
          if (p === 'granted') {
            window.addEventListener('deviceorientation', onOrientation, true)
          }
        } else {
          window.addEventListener('deviceorientationabsolute', onOrientation, true)
          window.addEventListener('deviceorientation', onOrientation, true)
          setPerm('granted')
        }
      } catch (e) { setPerm('denied') }
    }
    enable()
    return () => {
      window.removeEventListener('deviceorientationabsolute', onOrientation, true)
      window.removeEventListener('deviceorientation', onOrientation, true)
    }
  }, [])

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
        <div className="arrow" style={{ transform: `translateY(10px) rotate(${arrowRotation}deg)` }} aria-label="Qibla-pil"></div>
      </div>
      <div className="hint">
        {heading == null ? (perm === 'denied' ? 'Kompass-tillatelse avslått' : 'Venter på kompass…')
          : <>Enhetsretning: {heading.toFixed(0)}° • Qibla: {bearing?.toFixed(1)}°</>}
      </div>
    </div>
  )
}

async function getVapidKey() {
  const res = await fetch(import.meta.env.VITE_PUSH_SERVER_URL + '/vapidPublicKey')
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
  const { coords, error: geoError, loading, request, setCoords } = useGeolocation()
  const [method, setMethod] = useLocalStorage('aq_method', 'MWL')
  const [hlr, setHlr] = useLocalStorage('aq_hlr', 'MiddleOfTheNight')
  const [use24h, setUse24h] = useLocalStorage('aq_24h', true)
  const [manualLat, setManualLat] = useLocalStorage('aq_lat', '')
  const [manualLng, setManualLng] = useLocalStorage('aq_lng', '')
  const [cityLabel, setCityLabel] = useLocalStorage('aq_city', '')
  const [pushEnabled, setPushEnabled] = useLocalStorage('aq_push', false)
  const [minutesBefore, setMinutesBefore] = useLocalStorage('aq_push_lead', 10)

  const activeCoords = useMemo(() => {
    if (coords) return coords
    const lat = parseFloat(manualLat)
    const lng = parseFloat(manualLng)
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) return { latitude: lat, longitude: lng }
    return null
  }, [coords, manualLat, manualLng])

  const params = useMemo(() => {
    const p = buildParams(method)
    p.madhab = Madhab.Shafi // Maliki Asr = 1x skygge
    p.highLatitudeRule = HighLatitudeRule[hlr] ?? HighLatitudeRule.MiddleOfTheNight
    return p
  }, [method, hlr])

  const compute = () => {
    if (!activeCoords) return { times: null, qiblaDeg: null, dateLabel: NB_DAY.format(new Date()) }
    const d = new Date()
    const c = new Coordinates(activeCoords.latitude, activeCoords.longitude)
    const pt = new PrayerTimes(c, d, params)
    const bearing = Qibla.degrees(c)
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
    async function ensurePush() {
      if (!pushEnabled) return
      if (!('Notification' in window)) { alert('Push støttes ikke i denne nettleseren.'); setPushEnabled(false); return }
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { alert('Tillat varsler for å aktivere push.'); setPushEnabled(false); return }
      const reg = await navigator.serviceWorker.ready
      const publicKey = await getVapidKey().catch(()=>null)
      if (!publicKey) { alert('Fikk ikke hentet VAPID-nøkkel.'); setPushEnabled(false); return }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      })
      await fetch(import.meta.env.VITE_PUSH_SERVER_URL + '/subscribe', {
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
    }
    ensurePush()
  }, [pushEnabled, minutesBefore, method, hlr, activeCoords?.latitude, activeCoords?.longitude])

  async function disablePush() {
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
              {coords ? `Fant posisjon: ${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}` : geoError ? `Feil: ${geoError}` : 'Gi tilgang for automatisk lokasjon'}
            </span>
          </div>
          <div className="row" style={{marginTop:8}}>
            <input placeholder="By/sted (valgfritt)" value={cityLabel} onChange={e=>setCityLabel(e.target.value)} />
            <input placeholder="Breddegrad (lat)" value={manualLat} onChange={e=>setManualLat(e.target.value)} />
            <input placeholder="Lengdegrad (lng)" value={manualLng} onChange={e=>setManualLng(e.target.value)} />
          </div>
          <div className="row" style={{marginTop:8}}>
            <button className="btn" onClick={setManual}>Bruk manuell posisjon</button>
            {activeCoords && <span className="hint">Aktiv: {(cityLabel||'').trim() || 'Egendefinert'} • {activeCoords.latitude.toFixed(4)}, {activeCoords.longitude.toFixed(4)}</span>}
          </div>
        </section>

        <div className="two">
          <section className="card">
            <h3>Qibla-retning</h3>
            {activeCoords ? (
              <>
                <Compass bearing={qiblaDeg} />
                <div className="hint" style={{textAlign:'center'}}>Pek enheten slik at pilen peker opp – da vender du mot Qibla.</div>
              </>
            ) : (<div className="hint">Velg/bekreft posisjon for å vise Qibla.</div>)}
          </section>

          <section className="card">
            <h3>Bønnetider i dag</h3>
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
              <div className="hint">Sender varsel før bønnetid (krever bakendtjeneste).</div>
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
            <button className="btn" onClick={async ()=>{
              await fetch(import.meta.env.VITE_PUSH_SERVER_URL + '/send-test', {method:'POST'})
              alert('Testvarsel sendt (hvis abonnement finnes).')
            }}>Send testvarsel</button>
            <button className="btn" onClick={disablePush}>Deaktiver/avmeld</button>
          </div>
        </section>
      </div>

      <footer>© {new Date().getFullYear()} Afkir Qibla • Norsk • Maliki Asr (Shafi) – adhan.js • Installer via «Legg til på hjemskjerm»</footer>
    </div>
  )
}
