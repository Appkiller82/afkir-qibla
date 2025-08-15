import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Afkir Qibla — IRN-in-Oslo provider + Aladhan fallback worldwide
 * - Uses IRN/Bønnetid provider ONLY when user is in Oslo (city = "Oslo" or within ~60 km of Oslo center)
 * - Else falls back to Aladhan (method=5, school=0 Maliki)
 * - Robust parsing: build Date objects from API's own day (no HH="09" bug)
 * - Countdown hh:mm:ss (smooth 500ms)
 * - Compass shows degrees; turns green within ±3° of Qibla
 * - Auto-refresh: >5 km movement, midnight
 *
 * To enable IRN:
 *  - Add .env: VITE_IRN_API_BASE, VITE_IRN_API_KEY (format depends on your IRN/Bønnetid access)
 *  - This component will try IRN only when in Oslo; if it fails/missing -> Aladhan
 */

// ---------- Intl ----------
const NB_TIME = new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" });
const NB_DAY  = new Intl.DateTimeFormat("nb-NO", { weekday: "long", day: "2-digit", month: "long" });

// ---------- ENV (Vite-style) ----------
const IRN_API_BASE = import.meta?.env?.VITE_IRN_API_BASE || "";
const IRN_API_KEY  = import.meta?.env?.VITE_IRN_API_KEY  || "";
// STEP 1 (forenkling): tvang Aladhan overalt. Sett til true senere når vi vil aktivere IRN i Oslo igjen.
const IRN_ENABLED = false; // !!(IRN_API_BASE && IRN_API_KEY);

// ---------- Helpers ----------
function useLocalStorage(key, init) {
  const [v, setV] = useState(() => {
    try { const j = localStorage.getItem(key); return j ? JSON.parse(j) : init } catch { return init }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }, [key, v]);
  return [v, setV];
}

function toRad(d){ return d*Math.PI/180 }
function toDeg(r){ return r*180/Math.PI }
function normalize(deg){ return ((deg%360)+360)%360 }

// Haversine distance (km)
function haversineKm(a, b) {
  if (!a || !b) return 0;
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const t = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(t), Math.sqrt(1-t));
}

// Oslo center + geofence ~60 km
const OSLO_CENTER = { latitude: 59.9139, longitude: 10.7522 };
function isInOslo(coords, cityName) {
  if (!coords) return false;
  if ((cityName||"").toLowerCase().includes("oslo")) return true;
  return haversineKm(coords, OSLO_CENTER) <= 60;
}

// Reverse geocode (Nominatim)
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=nb&zoom=10&addressdetails=1`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    const data = await res.json();
    const a = data.address || {};
    const name = a.city || a.town || a.village || a.municipality || a.suburb || a.state || a.county || a.country;
    return name || "";
  } catch { return "" }
}

// Qibla bearing
function qiblaBearing(lat, lon) {
  const kaabaLat = toRad(21.4225);
  const kaabaLon = toRad(39.8262);
  const φ1 = toRad(lat||0);
  const λ1 = toRad(lon||0);
  const Δλ = kaabaLon - λ1;
  const y = Math.sin(Δλ) * Math.cos(kaabaLat);
  const x = Math.cos(φ1)*Math.sin(kaabaLat) - Math.sin(φ1)*Math.cos(kaabaLat)*Math.cos(Δλ);
  return normalize(toDeg(Math.atan2(y, x)));
}

// ---------- Geolocation watch (>5km refresh) ----------
function useGeolocationWatch(minKm = 5) {
  const [coords, setCoords] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [permission, setPermission] = useState("prompt");
  const lastCoords = useRef(null);
  const watchId = useRef(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (navigator.permissions?.query) {
          const p = await navigator.permissions.query({ name: "geolocation" });
          if (mounted) setPermission(p.state);
          p.onchange = () => mounted && setPermission(p.state);
        }
      } catch {}
    })();
    return () => { mounted = false };
  }, []);

  const requestOnce = () => {
    if (!("geolocation" in navigator)) { setError("Stedstjenester er ikke tilgjengelig i denne nettleseren."); return }
    setLoading(true); setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => { const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }; lastCoords.current = c; setCoords(c); setLoading(false) },
      (err) => {
        let msg = err?.message || "Kunne ikke hente posisjon.";
        if (err?.code === 1) msg = "Tilgang til posisjon ble nektet. aA → Nettstedsinnstillinger → Sted = Tillat.";
        if (err?.code === 2) msg = "Posisjon utilgjengelig. Prøv nær et vindu.";
        if (err?.code === 3) msg = "Tidsavbrudd. Prøv igjen.";
        setError(msg); setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const startWatch = () => {
    if (!("geolocation" in navigator)) return;
    if (watchId.current != null) return;
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        if (!lastCoords.current) { lastCoords.current = c; setCoords(c); return; }
        const km = haversineKm(lastCoords.current, c);
        if (km >= minKm) { lastCoords.current = c; setCoords(c); } // trigger updates
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );
  };

  useEffect(() => () => {
    if (watchId.current != null && navigator.geolocation?.clearWatch) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  return { coords, error, loading, permission, requestOnce, startWatch };
}

// ---------- Prayer time providers ----------

// Parse HH:MM -> Date using base day (Date object of that day in local tz)
function hhmmToDate(hhmm, baseDay) {
  const clean = String(hhmm).replace(/\(.*?\)/g, "").trim(); // strip "(CEST)" etc
  const m = /^(\d{1,2})\s*:\s*(\d{2})$/.exec(clean);
  if (!m) return null;
  const H = Math.min(23, Math.max(0, parseInt(m[1],10)));
  const M = Math.min(59, Math.max(0, parseInt(m[2],10)));
  const d = new Date(baseDay);
  d.setHours(H, M, 0, 0);
  return d;
}

// Build base day from epoch seconds or ISO string
function baseFromApiTimestamp(tsSecOrIso) {
  if (typeof tsSecOrIso === "number") return new Date(tsSecOrIso * 1000);
  if (typeof tsSecOrIso === "string") {
    const dt = new Date(tsSecOrIso.length <= 10 ? `${tsSecOrIso}T00:00:00` : tsSecOrIso);
    if (!isNaN(+dt)) return dt;
  }
  return new Date();
}

// IRN provider (requires env). Example endpoint structure is placeholder; replace with your IRN path.
// Expected JSON shape example:
// { date: "2025-08-15", timings: { Fajr:"03:18", Sunrise:"05:30", Dhuhr:"13:31", Asr:"18:31", Maghrib:"21:15", Isha:"22:29" } }
async function fetchTimesFromIRN({ city = "oslo", date = "today" }) {
  if (!IRN_ENABLED) throw new Error("IRN not configured");
  let ymd;
  if (date === "today" || date === "tomorrow") {
    const d = new Date();
    if (date === "tomorrow") d.setDate(d.getDate() + 1);
    ymd = d.toISOString().slice(0,10);
  } else ymd = date;

  const url = `${IRN_API_BASE}?city=${encodeURIComponent(city)}&date=${encodeURIComponent(ymd)}`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${IRN_API_KEY}` } });
  if (!res.ok) throw new Error("IRN request failed");
  const j = await res.json();
  const baseDay = baseFromApiTimestamp(j?.date ?? ymd);
  const t = j?.timings || {};
  return {
    Fajr:     hhmmToDate(t.Fajr, baseDay),
    Soloppgang: hhmmToDate(t.Sunrise, baseDay),
    Dhuhr:    hhmmToDate(t.Dhuhr, baseDay),
    Asr:      hhmmToDate(t.Asr, baseDay),
    Maghrib:  hhmmToDate(t.Maghrib, baseDay),
    Isha:     hhmmToDate(t.Isha, baseDay),
  };
}

// Aladhan provider (Maliki/Shafi'i school=0, method=5). Uses API timestamp for the base day.
async function fetchTimesFromAladhan({ lat, lon, date = "today" }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    // IRN-nær uten API-nøkkel:
    // - method=99 (custom)
    // - methodSettings = FajrAngle, null, IshaAngle
    // - latitudeAdjustmentMethod=3 (Angle-Based) for høyere breddegrader
    method: "99",
    methodSettings: "18,null,17",
    latitudeAdjustmentMethod: "3",
    // Asr: 1x skygge (Maliki/Shafi'i)
    school: "0",
    timezonestring: tz,
    iso8601: "true"
  });
  const url = `https://api.aladhan.com/v1/timings/${date}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Aladhan failed");
  const j = await res.json();
  if (j?.code !== 200 || !j?.data?.timings) throw new Error("Aladhan invalid");
  const baseDay = baseFromApiTimestamp(Number(j?.data?.date?.timestamp));
  const t = j.data.timings;
  return {
    Fajr:       hhmmToDate(t.Fajr, baseDay),
    Soloppgang: hhmmToDate(t.Sunrise, baseDay),
    Dhuhr:      hhmmToDate(t.Dhuhr, baseDay),
    Asr:        hhmmToDate(t.Asr, baseDay),
    Maghrib:    hhmmToDate(t.Maghrib, baseDay),
    Isha:       hhmmToDate(t.Isha, baseDay),
  };
}

// Unified provider: IRN in Oslo (if configured) else Aladhan
async function fetchPrayerTimes({ lat, lon, cityName, date = "today" }) {
  const inOslo = isInOslo({ latitude: lat, longitude: lon }, cityName);
  if (inOslo && IRN_ENABLED) {
    try {
      return await fetchTimesFromIRN({ city: "oslo", date });
    } catch (e) {
      console.warn("IRN lookup failed, falling back to Aladhan:", e?.message || e);
    }
  }
  return await fetchTimesFromAladhan({ lat, lon, date });
}

// ---------- Countdown ----------
const ORDER = ["Fajr","Soloppgang","Dhuhr","Asr","Maghrib","Isha"];
function diffToText(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return (h > 0 ? String(h).padStart(2, "0") + ":" : "") + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}
function nextPrayerInfo(times) {
  if (!times) return { name: null, at: null, diffText: null, tomorrow: false };
  const now = new Date();
  for (const k of ORDER) {
    const t = times[k];
    if (t && t.getTime() > now.getTime()) {
      const ms = t.getTime() - now.getTime();
      return { name: k, at: t, diffText: diffToText(ms), tomorrow: false };
    }
  }
  return { name: null, at: null, diffText: null, tomorrow: true };
}

// ---------- Compass (shows delta°, green within ±3°) ----------
function ModernCompass({ targetBearing }) {
  const [heading, setHeading] = useState(null);
  const [showHelp, setShowHelp] = useState(false);

  const onOrientation = (e) => {
    let hdg = null;
    if (typeof e?.webkitCompassHeading === "number") hdg = e.webkitCompassHeading; // iOS
    else if (typeof e?.alpha === "number") hdg = 360 - e.alpha; // others
    if (hdg != null && !Number.isNaN(hdg)) setHeading(normalize(hdg));
  };

  const activateCompass = async () => {
    try {
      if (window.DeviceMotionEvent?.requestPermission) await window.DeviceMotionEvent.requestPermission();
      if (window.DeviceOrientationEvent?.requestPermission) {
        const p = await window.DeviceOrientationEvent.requestPermission();
        if (p !== "granted") setShowHelp(true);
      }
    } catch {}
    window.addEventListener("deviceorientationabsolute", onOrientation, true);
    window.addEventListener("deviceorientation", onOrientation, true);
    setTimeout(()=>{ if (heading == null) setShowHelp(true) }, 2500);
  };

  useEffect(() => () => {
    window.removeEventListener("deviceorientationabsolute", onOrientation, true);
    window.removeEventListener("deviceorientation", onOrientation, true);
  }, []);

  const delta = useMemo(() => {
    if (heading == null || targetBearing == null) return null;
    let d = targetBearing - heading;
    d = ((d + 540) % 360) - 180; // map to [-180, 180]
    return d;
  }, [heading, targetBearing]);

  const onTarget = delta != null && Math.abs(delta) <= 3;

  return (
    <div>
      <div style={{display:"flex", justifyContent:"center", gap:8}}>
        <button className="btn" onClick={activateCompass}>Tillat kompass</button>
        <button className="btn" onClick={()=>setShowHelp(true)}>Hjelp</button>
      </div>

      <div style={{position:"relative", width:280, height:320, margin:"12px auto 0"}}>
        {/* dial */}
        <div style={{position:"absolute", inset:"20px 0 0 0", borderRadius:"50%",
          background: onTarget
            ? "radial-gradient(140px 140px at 50% 45%, rgba(34,197,94,.25), rgba(15,23,42,.65))"
            : "radial-gradient(140px 140px at 50% 45%, rgba(255,255,255,.10), rgba(15,23,42,.65))",
          boxShadow:"inset 0 10px 30px rgba(0,0,0,.5), 0 6px 24px rgba(0,0,0,.35)", border:"1px solid rgba(148,163,184,.35)"}}/>
        <div style={{position:"absolute", inset:"30px 10px 34px 10px", borderRadius:"50%"}}>
          {[...Array(60)].map((_,i)=>(
            <div key={i} style={{position:"absolute", inset:0, transform:`rotate(${i*6}deg)`}}>
              <div style={{position:"absolute", top:8, left:"50%", transform:"translateX(-50%)", width: i%5===0 ? 3 : 2, height: i%5===0 ? 16 : 10, background:"#445169", opacity: i%5===0 ? 1 : .7, borderRadius:2}}/>
            </div>
          ))}
          <div style={{position:"absolute", inset:0, color:onTarget ? "#22c55e" : "#a5b4fc", fontWeight:700}}>
            <div style={{position:"absolute", top:14, left:"50%", transform:"translateX(-50%)"}}>N</div>
            <div style={{position:"absolute", bottom:46, left:"50%", transform:"translateX(-50%)"}}>S</div>
            <div style={{position:"absolute", top:"50%", left:14, transform:"translateY(-50%)"}}>V</div>
            <div style={{position:"absolute", top:"50%", right:14, transform:"translateY(-50%)"}}>Ø</div>
          </div>
        </div>
        {/* Kaaba fixed */}
        <div style={{position:"absolute", top:30, left:"50%", transform:"translateX(-50%)", zIndex:3}}>
          <img src="/icons/kaaba_3d.svg" alt="Kaaba" width={40} height={40} draggable="false" />
        </div>
        {/* Needle – rotate to target bearing relative to heading */}
        <svg width="280" height="280" style={{position:"absolute", top:20, left:0, right:0, margin:"0 auto", pointerEvents:"none", zIndex:4}} aria-hidden="true">
          <defs>
            <linearGradient id="needle" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={onTarget ? "#22c55e" : "#ef4444"}/>
              <stop offset="100%" stopColor={onTarget ? "#15803d" : "#991b1b"}/>
            </linearGradient>
            <linearGradient id="tail" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#94a3b8"/><stop offset="100%" stopColor="#475569"/>
            </linearGradient>
          </defs>
          <g transform={`rotate(${normalize(targetBearing ?? 0)} 140 140)`}>
            {/* Static arrow to target bearing */}
            <polygon points="140,40 132,140 148,140" fill="url(#needle)" opacity="0.96"/>
            <polygon points="132,140 148,140 140,208" fill="url(#tail)" opacity="0.86"/>
            <circle cx="140" cy="140" r="8.5" fill="#e5e7eb" stroke="#334155" strokeWidth="2"/>
            <circle cx="140" cy="140" r="2.8" fill="#1f2937"/>
          </g>
          {/* Heading needle (blue) */}
          {typeof window !== "undefined" && (
            <g transform={`rotate(${normalize(heading ?? 0)} 140 140)`}>
              <polygon points="140,50 135,140 145,140" fill="#3b82f6" opacity="0.9"/>
              <polygon points="135,140 145,140 140,205" fill="#1e40af" opacity="0.8"/>
            </g>
          )}
        </svg>
        {/* Delta readout */}
        <div style={{position:"absolute", bottom:6, left:0, right:0, textAlign:"center", fontSize:14}}>
          {delta == null
            ? <span className="hint">Tillat kompass for å se avvik i grader</span>
            : onTarget
              ? <span style={{color:"#22c55e"}}>✓ På Qibla (Δ {Math.abs(delta).toFixed(0)}°)</span>
              : <span>Avvik Δ {Math.abs(delta).toFixed(0)}° ({delta > 0 ? "sving høyre" : "sving venstre"})</span>}
        </div>
      </div>

      {/* Help modal */}
      {showHelp && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,.6)", display:"grid", placeItems:"center", zIndex:50}} onClick={()=>setShowHelp(false)}>
          <div style={{background:"rgba(11,18,32,.96)", backdropFilter:"blur(8px)", border:"1px solid #334155", borderRadius:12, padding:16, width:"90%", maxWidth:420}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
              <h3 style={{margin:0}}>Få i gang kompasset</h3>
              <button className="btn" onClick={()=>setShowHelp(false)}>Lukk</button>
            </div>
            <ol style={{margin:"12px 0 0 18px"}}>
              <li>Trykk <b>Tillat kompass</b> og gi tilgang til bevegelse/orientering.</li>
              <li>Safari (iPhone): aA → Nettstedsinnstillinger → slå på <b>Bevegelse & orientering</b>.</li>
              <li>Kalibrer ved å bevege telefonen i en <b>figur-8</b>.</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Map (Leaflet via CDN) ----------
function loadLeafletOnce() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    const js = document.createElement("script");
    js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    js.async = true;
    js.onload = () => resolve(window.L);
    js.onerror = reject;
    document.head.appendChild(css);
    document.body.appendChild(js);
  });
}

function QiblaMap({ coords }) {
  const mapRef = useRef(null);
  const divRef = useRef(null);

  useEffect(() => {
    let map;
    if (!coords) return;
    let cancelled = false;
    loadLeafletOnce().then((L) => {
      if (cancelled || !divRef.current) return;
      const mecca = [21.4225, 39.8262];
      map = L.map(divRef.current, { zoomControl: true, attributionControl: true }).setView([coords.latitude, coords.longitude], 5);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
      L.marker([coords.latitude, coords.longitude]).addTo(map).bindPopup("Din posisjon");
      L.marker(mecca).addTo(map).bindPopup("Kaaba (Mekka)");
      const line = L.polyline([[coords.latitude, coords.longitude], mecca], { color: "#ef4444", weight: 3 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding: [24,24] });
      mapRef.current = map;
    }).catch(()=>{});
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [coords?.latitude, coords?.longitude]);

  return <div ref={divRef} style={{width:"100%", height:320, borderRadius:12, overflow:"hidden"}} />;
}

// ---------- App ----------
const BACKGROUNDS = [
  "/backgrounds/mecca_panorama.jpg",
  "/backgrounds/kaaba_2024.jpg",
  "/backgrounds/mecca_aerial.jpg",
  "/backgrounds/mecca_city_panorama.jpg",
  "/backgrounds/mecca_exterior.jpg"
];

export default function App(){
  const { coords, error: geoError, loading, permission, requestOnce, startWatch } = useGeolocationWatch(5);
  const [city, setCity]   = useLocalStorage("aq_city", "");
  const [times, setTimes] = useState(null);
  const [apiError, setApiError] = useState("");
  const [bgIdx, setBgIdx] = useState(0);
  const [countdown, setCountdown] = useState({ name: null, at: null, diffText: null, tomorrow: false });
  const [remindersOn, setRemindersOn] = useLocalStorage("aq_reminders_on", false);
  const [showMap, setShowMap] = useState(false);
  const audioRef = useRef(null);
  const timersRef = useRef([]);

  // rotate background
  useEffect(() => { const id = setInterval(()=> setBgIdx(i => (i+1)%BACKGROUNDS.length), 25000); return () => clearInterval(id) }, []);

  // midnight refresh (check every 60s)
  useEffect(() => {
    let last = new Date().toDateString();
    const id = setInterval(async () => {
      const nowStr = new Date().toDateString();
      if (nowStr !== last) {
        last = nowStr;
        if (coords) await refreshTimes("today");
      }
    }, 60000);
    return () => clearInterval(id);
  }, [coords?.latitude, coords?.longitude, city]);

  // smooth countdown tick every 500ms
  useEffect(() => {
    const id = setInterval(() => setCountdown(nextPrayerInfo(times)), 500);
    return () => clearInterval(id);
  }, [times?.Fajr?.getTime?.()]);

  // reverse geocode on coords change
  useEffect(() => {
    if (!coords) return;
    reverseGeocode(coords.latitude, coords.longitude).then(n => n && setCity(n));
  }, [coords?.latitude, coords?.longitude]);

  // schedule reminders (tab-only)
  useEffect(() => {
    timersRef.current.forEach(id => clearTimeout(id));
    timersRef.current = [];
    if (!remindersOn || !times) return;
    const now = Date.now();
    ORDER.forEach(name => {
      const t = times[name];
      if (!(t instanceof Date)) return;
      const ms = t.getTime() - now;
      if (ms > 1000) {
        const id = setTimeout(() => {
          try { audioRef.current?.play?.() } catch {}
          try { if ("Notification" in window && Notification.permission === "granted") new Notification(`Tid for ${name}`) } catch {}
        }, ms);
        timersRef.current.push(id);
      }
    });
    return () => { timersRef.current.forEach(id => clearTimeout(id)); timersRef.current = [] };
  }, [remindersOn, times?.Fajr?.getTime?.()]);

  const qiblaDeg = useMemo(() => coords ? qiblaBearing(coords.latitude, coords.longitude) : null, [coords?.latitude, coords?.longitude]);

  async function refreshTimes(date = "today") {
    if (!coords) return;
    try {
      setApiError("");
      const todays = await fetchPrayerTimes({ lat: coords.latitude, lon: coords.longitude, cityName: city, date });
      const info = nextPrayerInfo(todays);
      if (info.tomorrow) {
        const tm = await fetchPrayerTimes({ lat: coords.latitude, lon: coords.longitude, cityName: city, date: "tomorrow" });
        const fajr = tm.Fajr;
        setTimes(todays);
        setCountdown({ name: "Fajr", at: fajr, diffText: diffToText(fajr.getTime() - Date.now()), tomorrow: true });
      } else {
        setTimes(todays);
        setCountdown(info);
      }
    } catch (e) {
      setApiError("Klarte ikke hente bønnetider.");
      setTimes(null);
    }
  }

  // initial fetch and start watch
  const onUseLocation = () => { requestOnce(); startWatch(); };
  useEffect(() => { if (!coords) return; refreshTimes("today") }, [coords?.latitude, coords?.longitude, city]);

  // notifications permission helper
  const ensureNotify = async () => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") { try { await Notification.requestPermission() } catch {} }
  };

  const bg = BACKGROUNDS[bgIdx];

  return (
    <div style={{minHeight:"100dvh", color:"var(--fg)", backgroundSize:"cover", backgroundPosition:"center", backgroundImage:`linear-gradient(rgba(4,6,12,.65), rgba(4,6,12,.65)), url(${bg})`, transition:"background-image .8s ease"}}>
      <style>{`
        :root { --fg:#e5e7eb; --muted:#cbd5e1; --card:rgba(15,23,42,.78); --border:#334155; --btn:#0b1220; --accent:#16a34a; }
        :root[data-theme="light"] { --fg:#0f172a; --muted:#475569; --card:rgba(255,255,255,.93); --border:#d1d5db; --btn:#f8fafc; --accent:#16a34a; }
        .container { padding: calc(env(safe-area-inset-top) + 14px) 16px 16px; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
        .card { border:1px solid var(--border); border-radius: 16px; padding: 14px; background: var(--card); backdrop-filter: blur(10px); }
        .btn { padding:10px 14px; border-radius:12px; border:1px solid var(--border); background: var(--btn); color: var(--fg); cursor:pointer; }
        .btn:hover { opacity:.95 }
        .btn-green { background: var(--accent); border-color: var(--accent); color: white; }
        .hint { color: var(--muted); font-size: 13px; }
        .row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        h1 { margin:0 0 6px 0; font-size: 28px; line-height:1.15 }
        ul.times { list-style:none; padding:0; margin:0 }
        .time-item { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border); font-size:16px }
        .error { color:#fecaca; background:rgba(239,68,68,.12); border:1px solid rgba(239,68,68,.35); padding:10px; border-radius:12px; }
      `}</style>

      <div className="container">
        <header style={{marginBottom:10, textAlign:"center"}}>
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
          {geoError && <div className="error" style={{marginTop:8}}>{geoError}</div>}
        </section>

        {/* Compass + Map + Times */}
        <div style={{display:"grid", gap:12, marginTop:12}}>
          <section className="card">
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
              <h3>Qibla-retning</h3>
              <button className="btn" onClick={()=>setShowMap(v=>!v)}>{showMap ? "Skjul kart" : "Vis Qibla på kart"}</button>
            </div>
            {coords ? (
              <>
                <ModernCompass targetBearing={qiblaDeg ?? 0} />
                {showMap && (
                  <div style={{marginTop:12}}>
                    <QiblaMap coords={coords} />
                    <div className="hint" style={{marginTop:6}}>Linjen viser retningen fra din posisjon til Kaaba (Mekka).</div>
                  </div>
                )}
              </>
            ) : <div className="hint">Velg/bekreft posisjon for å vise Qibla og kart.</div>}
          </section>

          <section className="card">
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <h3>Bønnetider</h3>
            <button className="btn" onClick={()=>refreshTimes("today")} title="Hent tider på nytt">Oppdater tider</button>
          </div>
          <div className="hint">Kilde: Aladhan (tilpasset: method=99 + vinkel-basert; IRN-nær uten API-nøkkel)</div>
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

                <div style={{marginTop:10, fontSize:15}}>
                  {countdown?.name
                    ? <>Neste bønn: <b>{countdown.name}</b> kl <b>{NB_TIME.format(countdown.at)}</b> (<span className="hint">{countdown.diffText}</span>)</>
                    : <span className="hint">Alle dagens bønner er passert – oppdateres ved midnatt.</span>
                  }
                </div>

                <div className="row" style={{marginTop:10}}>
                  <button className={remindersOn ? "btn btn-green" : "btn"} onClick={async ()=>{
                    if (!("Notification" in window)) return; if (Notification.permission === "default") { try { await Notification.requestPermission() } catch {} }
                    // toggle
                    const next = !remindersOn; 
                    if (!next) { /* clearing happens in effect cleanup */ }
                    else { /* schedule happens in effect above */ }
                    setRemindersOn(next);
                  }}>{remindersOn ? "Adhan-varsler: PÅ" : "Adhan-varsler: AV"}</button>

                  <audio ref={audioRef} preload="auto" src="/audio/adhan.mp3"></audio>
                </div>
              </>
            ) : <div className="hint">Henter bønnetider…</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
