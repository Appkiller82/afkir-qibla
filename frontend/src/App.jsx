
import React, { useEffect, useMemo, useRef, useState } from "react"

/**
 * Afkir Qibla – App.jsx (needle points to Kaaba) – fixed layout + countdown
 * - Prayer times from Aladhan API (method=3 MWL, school=0 Maliki 1x)
 * - Auto refresh at midnight
 * - Kaaba icon fixed at top (true Qibla direction)
 * - Needle rotates toward Kaaba: angle = (bearing - heading)
 * - Hours+minutes countdown to next prayer
 * - Safe‑area layout for iPhone notch (title + theme button easy to tap)
 * - City label via Nominatim, adhan test, light/dark theme
 * - Rotating local backgrounds in /public/backgrounds
 */

// ------- Utilities -------
const NB_TIME = new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" })
const NB_DAY = new Intl.DateTimeFormat("nb-NO", { weekday: "long", day: "2-digit", month: "long" })

function useLocalStorage(key, init) {
  const [v, setV] = useState(() => {
    try { const j = localStorage.getItem(key); return j ? JSON.parse(j) : init } catch { return init }
  })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }, [key, v])
  return [v, setV]
}

// ------- Geolocation -------
function useGeolocation() {
  const [coords, setCoords] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [permission, setPermission] = useState("prompt")

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        if (navigator.permissions?.query) {
          const p = await navigator.permissions.query({ name: "geolocation" })
          if (mounted) setPermission(p.state)
          p.onchange = () => mounted && setPermission(p.state)
        }
      } catch {}
    })()
    return () => { mounted = false }
  }, [])

  const request = () => {
    if (!("geolocation" in navigator)) { setError("Stedstjenester er ikke tilgjengelig i denne nettleseren."); return }
    setLoading(true); setError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }); setLoading(false) },
      (err) => {
        let msg = err?.message || "Kunne ikke hente posisjon."
        if (err?.code === 1) msg = "Tilgang til posisjon ble nektet. aA → Nettstedsinnstillinger → Sted = Tillat."
        if (err?.code === 2) msg = "Posisjon utilgjengelig. Prøv nær et vindu, slå på GPS/mobilnett, eller skriv inn manuelt."
        if (err?.code === 3) msg = "Tidsavbrudd. Prøv igjen, eller skriv inn manuelt."
        setError(msg); setLoading(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }
  return { coords, error, loading, permission, request, setCoords }
}

// ------- Reverse geocode label -------
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=nb&zoom=10&addressdetails=1`
    const res = await fetch(url, { headers: { "Accept": "application/json" } })
    const data = await res.json()
    const a = data.address || {}
    const name = a.city || a.town || a.village || a.municipality || a.suburb || a.state || a.county || a.country
    return name || ""
  } catch { return "" }
}

// ------- Qibla bearing (from lat/lng) -------
function qiblaBearing(lat, lng) {
  const kaabaLat = 21.4225 * Math.PI / 180
  const kaabaLon = 39.8262 * Math.PI / 180
  const alat = (lat||0) * Math.PI / 180
  const alon = (lng||0) * Math.PI / 180
  const dlon = kaabaLon - alon
  const y = Math.sin(dlon) * Math.cos(kaabaLat)
  const x = Math.cos(alat) * Math.sin(kaabaLat) - Math.sin(alat) * Math.cos(kaabaLat) * Math.cos(dlon)
  const brng = Math.atan2(y, x)
  const deg = (brng * 180 / Math.PI + 360) % 360
  return deg
}

// ------- Aladhan API -------
async function fetchAladhan(lat, lng, date = "today") {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    method: "3",  // MWL
    school: "0",  // Shafi/Maliki (1x)
    timezonestring: tz,
    iso8601: "true"
  })
  const url = `https://api.aladhan.com/v1/timings/${date}?${params.toString()}`
  const res = await fetch(url)
  if (!res.ok) throw new Error("API feilet")
  const json = await res.json()
  if (json.code !== 200 || !json.data?.timings) throw new Error("Ugyldig API-respons")
  const t = json.data.timings
  const now = new Date()
  const mk = (hm) => {
    const [h,m] = String(hm).split(":").map(x=>parseInt(x,10))
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h||0, m||0, 0, 0)
    return d
  }
  const times = {
    Fajr: mk(t.Fajr),
    Soloppgang: mk(t.Sunrise || t.Sunrise),
    Dhuhr: mk(t.Dhuhr),
    Asr: mk(t.Asr),
    Maghrib: mk(t.Maghrib),
    Isha: mk(t.Isha)
  }
  return { times, meta: json.data.meta }
}

// ------- Modern Compass (needle points toward Kaaba) -------
function ModernCompass({ bearing }) {
  const [heading, setHeading] = useState(null)
  const [showHelp, setShowHelp] = useState(false)
  const [manualHeading, setManualHeading] = useState(0)
  const [sensorStatus, setSensorStatus] = useState("idle")
  const cleanupRef = useRef(() => {})

  const onOrientation = (e) => {
    let hdg = null
    if (typeof e.webkitCompassHeading === "number") hdg = e.webkitCompassHeading
    else if (typeof e.alpha === "number") hdg = 360 - e.alpha
    if (hdg != null && !Number.isNaN(hdg)) {
      setHeading((hdg + 360) % 360)
      setSensorStatus("granted")
    }
  }

  const requestSensors = async () => {
    try { if (window.DeviceMotionEvent?.requestPermission) await window.DeviceMotionEvent.requestPermission() } catch {}
    if (window.DeviceOrientationEvent?.requestPermission) {
      try {
        const p = await window.DeviceOrientationEvent.requestPermission()
        if (p !== "granted") { setSensorStatus("denied"); return false }
      } catch { setSensorStatus("denied"); return false }
    }
    setSensorStatus("granted")
    return true
  }

  const activateCompass = async () => {
    let ok = true
    if (window.DeviceOrientationEvent?.requestPermission) ok = await requestSensors()
    if (!ok) { setShowHelp(true); return }
    window.addEventListener("deviceorientationabsolute", onOrientation, true)
    window.addEventListener("deviceorientation", onOrientation, true)
    cleanupRef.current = () => {
      window.removeEventListener("deviceorientationabsolute", onOrientation, true)
      window.removeEventListener("deviceorientation", onOrientation, true)
    }
    setTimeout(() => { if (heading == null) { setShowHelp(true); setSensorStatus("noevents") } }, 3000)
  }

  useEffect(() => () => cleanupRef.current(), [])

  const usedHeading = heading == null ? manualHeading : heading
  // Needle angle = bearing - heading (0° = up)
  const needleAngle = useMemo(() => {
    if (bearing == null || usedHeading == null) return 0
    return (bearing - usedHeading + 360) % 360
  }, [bearing, usedHeading])

  const a = ((bearing - (usedHeading||0) + 540) % 360) - 180
  const turnText = (Math.abs(a) < 2 ? "Rett mot Qibla" : `Drei ${Math.abs(a).toFixed(0)}° ${a > 0 ? "høyre" : "venstre"}`)

  return (
    <div>
      <div style={{position:"relative", width:280, height:300, margin:"12px auto 0", WebkitTransform:"translateZ(0)", transform:"translateZ(0)"}}>
        {/* Static dial */}
        <div style={{
          position:"absolute", inset:"20px 0 0 0", borderRadius:"50%",
          background:"radial-gradient(140px 140px at 50% 45%, rgba(255,255,255,.10), rgba(15,23,42,.65))",
          boxShadow:"inset 0 10px 30px rgba(0,0,0,.5), 0 6px 24px rgba(0,0,0,.35)",
          border:"1px solid rgba(148,163,184,.35)"
        }}/>

        <div style={{position:"absolute", inset:"30px 10px 10px 10px", borderRadius:"50%"}}>
          <div style={{position:"absolute", inset:0, borderRadius:"50%", border:"2px solid #3b475e", boxShadow:"inset 0 0 0 8px #0f172a"}}/>
          {[...Array(60)].map((_,i)=>(
            <div key={i} style={{position:"absolute", inset:0, transform:`rotate(${i*6}deg)`}}>
              <div style={{
                position:"absolute", top:8, left:"50%", transform:"translateX(-50%)",
                width: i%5===0 ? 3 : 2, height: i%5===0 ? 16 : 10, background:"#445169", opacity: i%5===0 ? 1 : .7, borderRadius:2
              }}/>
            </div>
          ))}
          <div style={{position:"absolute", inset:0, color:"#a5b4fc", fontWeight:700}}>
            <div style={{position:"absolute", top:14, left:"50%", transform:"translateX(-50%)"}}>N</div>
            <div style={{position:"absolute", bottom:14, left:"50%", transform:"translateX(-50%)"}}>S</div>
            <div style={{position:"absolute", top:"50%", left:14, transform:"translateY(-50%)"}}>V</div>
            <div style={{position:"absolute", top:"50%", right:14, transform:"translateY(-50%)"}}>Ø</div>
          </div>
        </div>

        {/* Fixed 3D Kaaba at top */}
        <div style={{position:"absolute", top:30, left:"50%", transform:"translateX(-50%)", zIndex:3}}>
          <img src="/icons/kaaba_3d.svg" alt="Kaaba" width={40} height={40} draggable="false" />
        </div>

        {/* Needle points toward Kaaba */}
        <svg width="280" height="280" style={{position:"absolute", top:20, left:0, right:0, margin:"0 auto", pointerEvents:"none", zIndex:4}} aria-hidden="true">
          <defs>
            <linearGradient id="needle" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444"/><stop offset="100%" stopColor="#991b1b"/>
            </linearGradient>
            <linearGradient id="tail" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#94a3b8"/><stop offset="100%" stopColor="#475569"/>
            </linearGradient>
          </defs>
          <g transform={`rotate(${needleAngle} 140 140)`}>
            <polygon points="140,40 132,140 148,140" fill="url(#needle)" opacity="0.96"/>
            <polygon points="132,140 148,140 140,208" fill="url(#tail)" opacity="0.86"/>
            <circle cx="140" cy="140" r="8.5" fill="#e5e7eb" stroke="#334155" strokeWidth="2"/>
            <circle cx="140" cy="140" r="2.8" fill="#1f2937"/>
          </g>
        </svg>
      </div>

      <div style={{textAlign:"center", marginTop:10}}>
        <div style={{fontSize:14}}>
          Enhetsretning: <b>{(usedHeading ?? 0).toFixed(0)}°</b> • Qibla: <b>{(bearing ?? 0).toFixed(1)}°</b> — {turnText}
        </div>
        <div style={{fontSize:12, opacity:.8, marginTop:4}}><b>Kompass viser Qibla-retning i grader. Kaaba-markøren er alltid fast mot Mekka.</b></div>
      </div>

      <div style={{textAlign:"center", marginTop:10}}>
        <button className="btn" onClick={activateCompass} style={{marginRight:8}}>Aktiver kompass</button>
        <button className="btn" onClick={()=>setShowHelp(true)}>Få i gang kompasset</button>
      </div>

      <div style={{marginTop:12, textAlign:"center"}}>
        <div className="hint">Manuelt kompass (hvis sensoren ikke virker):</div>
        <input type="range" min="0" max="359" value={manualHeading} onChange={e=>setManualHeading(parseInt(e.target.value||"0"))} style={{width:"100%"}}/>
        <div className="hint">Manuell retning: <b>{manualHeading}°</b></div>
      </div>

      {showHelp && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,.6)", display:"grid", placeItems:"center", zIndex:50}} onClick={()=>setShowHelp(false)}>
          <div style={{background:"rgba(11,18,32,.96)", backdropFilter:"blur(8px)", border:"1px solid #334155", borderRadius:12, padding:16, width:"90%", maxWidth:420}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
              <h3 style={{margin:0}}>Få i gang kompasset</h3>
              <button className="btn" onClick={()=>setShowHelp(false)}>Lukk</button>
            </div>
            <ol style={{margin:"12px 0 0 18px"}}>
              <li>Trykk <b>Aktiver kompass</b> og tillat bevegelsesdata.</li>
              <li>Safari: <b>aA</b> → <b>Nettstedsinnstillinger</b> → slå på <b>Bevegelse & orientering</b>.</li>
              <li>Kalibrer ved å bevege telefonen i en <b>figur-8</b>.</li>
            </ol>
            <div style={{marginTop:12, textAlign:"right"}}>
              <button className="btn" onClick={activateCompass}>Aktiver kompass</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ------- Next prayer helper -------
const ORDER = ["Fajr","Sunrise","Dhuhr","Asr","Maghrib","Isha"]
function nextPrayerInfo(times) {
  if (!times) return { name: null, diffMin: null, at: null }
  const now = new Date()
  for (const key of ORDER) {
    const label = (key === "Sunrise") ? "Soloppgang" : key
    const t = times[label]
    if (t && t.getTime() > now.getTime()) {
      const diffMs = t.getTime() - now.getTime()
      const totalMin = Math.floor(diffMs / 60000)
      const h = Math.floor(totalMin / 60)
      const m = totalMin % 60
      return { name: label, diffText: `${h} t ${m} min`, at: t }
    }
  }
  return { name: null, diffText: null, at: null }
}

// ------- Theme + rotating backgrounds -------
function useTheme() {
  const [theme, setTheme] = useLocalStorage("aq_theme", "dark")
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  return [theme, setTheme]
}
const BACKGROUNDS = [
  "/backgrounds/mecca_panorama.jpg",
  "/backgrounds/kaaba_2024.jpg",
  "/backgrounds/mecca_aerial.jpg",
  "/backgrounds/mecca_city_panorama.jpg",
  "/backgrounds/mecca_exterior.jpg"
]

// ------- Main App -------
export default function App(){
  const { coords, error: geoError, loading, permission, request } = useGeolocation()
  const [city, setCity] = useLocalStorage("aq_city", "")
  const [times, setTimes] = useState(null)
  const [apiError, setApiError] = useState("")
  const [bgIdx, setBgIdx] = useState(0)
  const [theme, setTheme] = useTheme()
  const [countdown, setCountdown] = useState({ name: null, diffText: null, at: null })
  const audioRef = useRef(null)

  // rotate background every 25s
  useEffect(() => {
    const id = setInterval(()=> setBgIdx(i => (i+1)%BACKGROUNDS.length), 25000)
    return () => clearInterval(id)
  }, [])

  // auto refresh at midnight + update countdown every minute
  useEffect(() => {
    let last = new Date().toDateString()
    const id = setInterval(()=>{
      const now = new Date().toDateString()
      if (now !== last) {
        last = now
        if (coords) refreshTimes(coords.latitude, coords.longitude)
      } else {
        setCountdown(nextPrayerInfo(times))
      }
    }, 60000)
    return () => clearInterval(id)
  }, [coords, times?.Fajr?.getTime?.()])

  // reverse geocode on coords change
  useEffect(() => {
    if (!coords) return
    reverseGeocode(coords.latitude, coords.longitude).then(n => n && setCity(n))
  }, [coords?.latitude, coords?.longitude])

  const qiblaDeg = useMemo(() => coords ? qiblaBearing(coords.latitude, coords.longitude) : null, [coords?.latitude, coords?.longitude])

  async function refreshTimes(lat, lng) {
    try {
      setApiError("")
      const data = await fetchAladhan(lat, lng, "today")
      setTimes({
        Fajr: data.times.Fajr,
        Soloppgang: data.times.Soloppgang,
        Dhuhr: data.times.Dhuhr,
        Asr: data.times.Asr,
        Maghrib: data.times.Maghrib,
        Isha: data.times.Isha
      })
      setCountdown(nextPrayerInfo({
        Fajr: data.times.Fajr,
        Soloppgang: data.times.Soloppgang,
        Dhuhr: data.times.Dhuhr,
        Asr: data.times.Asr,
        Maghrib: data.times.Maghrib,
        Isha: data.times.Isha
      }))
    } catch (e) {
      setApiError("Klarte ikke hente bønnetider (API). Prøv igjen.")
      setTimes(null)
    }
  }

  const onUseLocation = () => { request() }

  useEffect(() => {
    if (!coords) return
    refreshTimes(coords.latitude, coords.longitude)
  }, [coords?.latitude, coords?.longitude])

  const formatTime = (d) => d instanceof Date ? NB_TIME.format(d) : "–"

  const bg = BACKGROUNDS[bgIdx]

  return (
    <div style={{minHeight:"100dvh", color:"var(--fg)", backgroundSize:"cover", backgroundPosition:"center", backgroundImage:`linear-gradient(rgba(4,6,12,.65), rgba(4,6,12,.65)), url(${bg})`, transition:"background-image .8s ease"}}>
      <style>{`
        :root { --fg:#e5e7eb; --muted:#cbd5e1; --card:rgba(15,23,42,.72); --border:#334155; --btn:#0b1220; }
        :root[data-theme="light"] { --fg:#0f172a; --muted:#475569; --card:rgba(255,255,255,.9); --border:#d1d5db; --btn:#f8fafc; }
        .container { padding: calc(env(safe-area-inset-top) + 8px) 16px 16px; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
        .card { border:1px solid var(--border); border-radius: 16px; padding: 14px; background: var(--card); backdrop-filter: blur(10px); }
        .btn { padding:10px 14px; border-radius:12px; border:1px solid var(--border); background: var(--btn); color: var(--fg); cursor:pointer; }
        .btn:hover { opacity:.95 }
        .hint { color: var(--muted); font-size: 13px; }
        .row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        h1 { margin:0 0 8px 0; font-size: 28px; line-height:1.15 }
        h2,h3 { margin:0 0 6px 0 }
        ul.times { list-style:none; padding:0; margin:0 }
        .time-item { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border); font-size:16px }
        .error { color:#fecaca; background:rgba(239,68,68,.12); border:1px solid rgba(239,68,68,.35); padding:10px; border-radius:12px; }
        .theme { position: fixed; top: calc(env(safe-area-inset-top) + 12px); right: 12px; z-index: 60; }
      `}</style>

      <div className="container">
        {/* Theme switch – now below the notch */}
        <div className="theme">
          <button className="btn" onClick={()=>setTheme(theme==="dark"?"light":"dark")}>
            Tema: {theme==="dark"?"Mørk":"Lys"}
          </button>
        </div>

        <header style={{marginBottom:12}}>
          <h1>Afkir Qibla</h1>
          <div className="hint">{NB_DAY.format(new Date())}</div>
        </header>

        {/* Location */}
        <section className="card">
          <h3>Plassering</h3>
          <div className="row" style={{marginTop:8}}>
            <button className="btn" onClick={onUseLocation} disabled={loading}>{loading ? "Henter…" : "Bruk stedstjenester"}</button>
            <span className="hint">
              {coords
                ? ((city ? city + " • " : "") + coords.latitude.toFixed(4) + ", " + coords.longitude.toFixed(4))
                : (permission === "denied" ? "Posisjon er blokkert i nettleseren." : "Gi tilgang for automatisk lokasjon")}
            </span>
          </div>
          {error && <div className="error" style={{marginTop:8}}>{error}</div>}
        </section>

        {/* Compass + Times */}
        <div style={{display:"grid", gap:12, marginTop:12}}>
          <section className="card">
            <h3>Qibla-retning</h3>
            {coords ? (
              <ModernCompass bearing={qiblaDeg ?? 0} />
            ) : <div className="hint">Velg/bekreft posisjon for å vise Qibla.</div>}
          </section>

          <section className="card">
            <h3>Bønnetider i dag</h3>
            {apiError && <div className="error" style={{margin:"8px 0"}}>{apiError}</div>}
            {times ? (
              <>
                <ul className="times">
                  <li className="time-item"><span>Fajr</span><span>{NB_TIME.format(times.Fajr)}</span></li>
                  <li className="time-item"><span>Soloppgang</span><span>{NB_TIME.format(times.Soloppgang)}</span></li>
                  <li className="time-item"><span>Dhuhr</span><span>{NB_TIME.format(times.Dhuhr)}</span></li>
                  <li className="time-item"><span>Asr</span><span>{NB_TIME.format(times.Asr)}</span></li>
                  <li className="time-item"><span>Maghrib</span><span>{NB_TIME.format(times.Maghrib)}</span></li>
                  <li className="time-item"><span>Isha</span><span>{NB_TIME.format(times.Isha)}</span></li>
                </ul>
                <div className="hint" style={{marginTop:8}}>
                  {countdown?.name
                    ? `Neste: ${countdown.name} om ${countdown.diffText} (${NB_TIME.format(countdown.at)})`
                    : "Alle dagens bønner er passert – oppdateres ved midnatt."}
                </div>
                <div style={{marginTop:8}}>
                  <button className="btn" onClick={()=>{ const a = audioRef.current; if (a) { a.currentTime=0; a.play().catch(()=>{}) } }}>Test Adhan</button>
                  <audio ref={audioRef} preload="auto" src="/audio/adhan.mp3"></audio>
                </div>
              </>
            ) : <div className="hint">Henter bønnetider… (krever internett)</div>}
          </section>
        </div>
      </div>
    </div>
  )
}
