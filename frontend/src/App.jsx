import React, { useEffect, useMemo, useRef, useState } from "react";
import PushControlsAuto from "./PushControlsAuto.jsx";
import AutoLocationModal from "./AutoLocationModal.jsx";
import { updateMetaIfSubscribed } from "./push";
import { fetchMonthTimings, runDevCompareMode } from "./prayer";

/**
 * Afkir Qibla 7 – RESTORED UI (oppdatert for unified bønnetider)
 * - Qibla retning (kompass + kart), bakgrunnsbilder m/rotasjon, tema-knapp,
 *   bønnetider og nedtelling, Adhan av/på + test-knapp.
 * - Auto-modal for posisjon, auto watch ved tillatelse,
 *   auto-oppdatering av push-metadata (always-on push ved bytte by).
 * - Bønnetider hentes via fetchTimings (Aladhan).
 */

// ---------- Intl ----------
const NB_TIME = new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" });
const NB_DAY  = new Intl.DateTimeFormat("nb-NO", { weekday: "long", day: "2-digit", month: "long" });
const NB_TEMP = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 });

function useLocalStorage(key, init) {
  const [v, setV] = useState(() => {
    try { const j = localStorage.getItem(key); return j ? JSON.parse(j) : init } catch { return init }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }, [key, v]);
  return [v, setV];
}

// ---------- Distance (km) ----------
function haversineKm(a, b) {
  if (!a || !b) return 0;
  const R = 6371;
  const dLat = (b.latitude - a.latitude) * Math.PI/180;
  const dLon = (b.longitude - a.longitude) * Math.PI/180;
  const lat1 = a.latitude * Math.PI/180;
  const lat2 = b.latitude * Math.PI/180;
  const sinDLat = Math.sin(dLat/2), sinDLon = Math.sin(dLon/2);
  const t = sinDLat*sinDLat + Math.cos(lat1)*Math.cos(lat2)*sinDLon*sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(t), Math.sqrt(1-t));
  return R * c;
}

// ---------- Geolocation + watch >5km ----------
function useGeolocationWatch(minKm = 5) {
  const [coords, setCoords] = useState(null);
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
          // AUTO: hvis allerede granted → hent posisjon + start watch uten klikk
          if (p.state === "granted") {
            requestOnce();
            startWatch();
          }
        }
      } catch {}
    })();
    return () => { mounted = false };
  }, []);

  const requestOnce = () => {
    if (!("geolocation" in navigator)) { alert("Stedstjenester er ikke tilgjengelig i denne nettleseren."); return }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }; lastCoords.current = c; setCoords(c); setLoading(false) },
      (err) => { console.warn(err); setLoading(false) },
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
        if (km >= minKm) { lastCoords.current = c; setCoords(c); }
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

  return { coords, loading, permission, requestOnce, startWatch };
}

// ---------- Reverse geocode ----------
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=nb&zoom=10&addressdetails=1`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    const data = await res.json();
    const a = data.address || {};
    const name = a.city || a.town || a.village || a.municipality || a.suburb || a.state || a.county || a.country;
    const countryCode = (a.country_code || "").toUpperCase();
    return { name: name || "", countryCode };
  } catch {
    return { name: "", countryCode: "" };
  }
}

// ---------- Qibla bearing ----------
function qiblaBearing(lat, lng) {
  const kaabaLat = 21.4225 * Math.PI / 180;
  const kaabaLon = 39.8262 * Math.PI / 180;
  const alat = (lat||0) * Math.PI / 180;
  const alon = (lng||0) * Math.PI / 180;
  const dlon = kaabaLon - alon;
  const y = Math.sin(dlon) * Math.cos(kaabaLat);
  const x = Math.cos(alat) * Math.sin(kaabaLat) - Math.sin(alat) * Math.cos(kaabaLat) * Math.cos(dlon);
  const brng = Math.atan2(y, x);
  return (brng * 180 / Math.PI + 360) % 360;
}


function inferCountryCode(_lat, _lng, fallback = "") {
  return (fallback || "").toUpperCase();
}

// ---------- Helpers (ny) ----------
// Konverter "HH:mm" til lokal Date (uten UTC-drift)
function hhmmToLocalDate(hhmm, baseDate) {
  if (!hhmm) return null;
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let y; let mo; let dNum;
  if (baseDate && /^\d{4}-\d{2}-\d{2}$/.test(baseDate)) {
    const [yy, mm, dd] = baseDate.split("-").map(Number);
    y = yy; mo = mm; dNum = dd;
  } else {
    const now = new Date();
    y = now.getFullYear();
    mo = now.getMonth() + 1;
    dNum = now.getDate();
  }
  const d = new Date(y, mo - 1, dNum, parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
  return d;
}
function ensureDates(strTimings /* {Fajr:"05:15", ...} */, baseDate) {
  return {
    Fajr: hhmmToLocalDate(strTimings.Fajr, baseDate),
    Soloppgang: hhmmToLocalDate(strTimings.Sunrise, baseDate), // i UI heter den Soloppgang
    Dhuhr: hhmmToLocalDate(strTimings.Dhuhr, baseDate),
    Asr: hhmmToLocalDate(strTimings.Asr, baseDate),
    Maghrib: hhmmToLocalDate(strTimings.Maghrib, baseDate),
    Isha: hhmmToLocalDate(strTimings.Isha, baseDate),
  };
}


function formatPrayerTime(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "--:--";
  return NB_TIME.format(value);
}

function formatPrayerLabel(name) {
  return name === "Dhuhr" ? "Duhr" : name;
}

// ---------- Countdown ----------
const ORDER = ["Fajr","Soloppgang","Dhuhr","Asr","Maghrib","Isha"];
function diffToText(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return (h > 0 ? String(h).padStart(2, "0") + ":" : "")
       + String(m).padStart(2, "0") + ":"
       + String(s).padStart(2, "0");
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

const WEATHER_CODES = {
  0: "Klart",
  1: "For det meste klart",
  2: "Delvis skyet",
  3: "Overskyet",
  45: "Tåke",
  48: "Rimtåke",
  51: "Lett yr",
  53: "Yr",
  55: "Tett yr",
  61: "Lett regn",
  63: "Regn",
  65: "Kraftig regn",
  71: "Lett snø",
  73: "Snø",
  75: "Kraftig snø",
  80: "Regnbyger",
  81: "Regnbyger",
  82: "Kraftige byger",
  95: "Tordenvær",
};

function weatherCodeToText(code) {
  return WEATHER_CODES[code] || "Oppdatert vær";
}

function weatherIcon(code) {
  if (code === 0 || code === 1) return "☀️";
  if ([71, 73, 75].includes(code)) return "❄️";
  if ([2, 3, 45, 48].includes(code)) return "☁️";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "🌧️";
  if (code === 95) return "⛈️";
  return "🌤️";
}

async function fetchWeather(lat, lng, signal) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("current", "temperature_2m,apparent_temperature,wind_speed_10m,weather_code");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,sunrise,sunset");
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error("Weather API failed");
  const data = await res.json();
  return {
    currentTemp: data?.current?.temperature_2m,
    feelsLike: data?.current?.apparent_temperature,
    wind: data?.current?.wind_speed_10m,
    code: data?.current?.weather_code,
    min: data?.daily?.temperature_2m_min?.[0],
    max: data?.daily?.temperature_2m_max?.[0],
    sunrise: data?.daily?.sunrise?.[0] ? new Date(data.daily.sunrise[0]) : null,
    sunset: data?.daily?.sunset?.[0] ? new Date(data.daily.sunset[0]) : null,
  };
}



async function fetchMonthlyCalendar(lat, lng, month, year, tz, countryCode, signal) {
  return fetchMonthTimings(lat, lng, month, year, tz, countryCode, signal);
}


function saveCache(key, value) {
  try { localStorage.setItem(key, JSON.stringify({ value, ts: Date.now() })); } catch {}
}

function loadCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj?.value ?? null;
  } catch {
    return null;
  }
}

function timesCacheKey(lat, lng, isoDate) {
  const latKey = Number(lat).toFixed(2);
  const lngKey = Number(lng).toFixed(2);
  return `aq_times_cache:${latKey}:${lngKey}:${isoDate}`;
}

function normalizeWeatherCache(w) {
  if (!w || typeof w !== "object") return null;
  const sunrise = w.sunrise ? new Date(w.sunrise) : null;
  const sunset = w.sunset ? new Date(w.sunset) : null;
  return {
    ...w,
    sunrise: sunrise && !Number.isNaN(sunrise.getTime()) ? sunrise : null,
    sunset: sunset && !Number.isNaN(sunset.getTime()) ? sunset : null,
  };
}

function safeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatMetric(value, unit = "") {
  const n = safeNum(value);
  if (n == null) return "--";
  return `${NB_TEMP.format(n)}${unit}`;
}

function formatCalendarDate(value) {
  if (!value) return "--.--.----";
  const [y, m, d] = String(value).split("-");
  if (!y || !m || !d) return String(value);
  return `${d}.${m}.${y}`;
}

function isoDateInTz(tz, dayOffset = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  const utcDate = new Date(Date.UTC(y, m - 1, d));
  utcDate.setUTCDate(utcDate.getUTCDate() + dayOffset);
  const yyyy = utcDate.getUTCFullYear();
  const mm = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utcDate.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function exportCalendarIcs(city, days) {
  if (!days?.length) return;
  const pad = (n) => String(n).padStart(2, "0");
  const dt = (dateStr, time) => {
    const [y,m,d] = dateStr.split("-").map(Number);
    const [hh,mm] = time.split(":").map(Number);
    return `${y}${pad(m)}${pad(d)}T${pad(hh)}${pad(mm)}00`;
  };
  const lines = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Afkir Qibla//NO"];
  days.forEach((day) => {
    ["Fajr","Dhuhr","Asr","Maghrib","Isha"].forEach((name) => {
      const time = day.timings[name];
      if (!time) return;
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${day.date.replaceAll('-','')}-${name.toLowerCase()}@afkir`);
      lines.push(`DTSTAMP:${dt(day.date, "00:00")}`);
      lines.push(`DTSTART:${dt(day.date, time)}`);
      lines.push(`SUMMARY:${name} (${city || "Afkir"})`);
      lines.push("END:VEVENT");
    });
  });
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "afkir-prayertider.ics";
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Compass (restored) ----------
function ModernCompass({ bearing }) {
  const [heading, setHeading] = useState(null);
  const [showHelp, setShowHelp] = useState(false);

  const onOrientation = (e) => {
    let hdg = null;
    if (typeof e?.webkitCompassHeading === "number") hdg = e.webkitCompassHeading; // iOS
    else if (typeof e?.alpha === "number") hdg = 360 - e.alpha; // others
    if (hdg != null && !Number.isNaN(hdg)) setHeading((hdg + 360) % 360);
  };

  const requestSensors = async () => {
    try { if (window.DeviceMotionEvent?.requestPermission) await window.DeviceMotionEvent.requestPermission() } catch {}
    if (window.DeviceOrientationEvent?.requestPermission) {
      try { const p = await window.DeviceOrientationEvent.requestPermission(); if (p !== "granted") { setShowHelp(true); return false } } catch { setShowHelp(true); return false }
    }
    return true;
  };

  const activateCompass = async () => {
    let ok = true;
    if (window.DeviceOrientationEvent?.requestPermission) ok = await requestSensors();
    if (!ok) { setShowHelp(true); return }
    window.addEventListener("deviceorientationabsolute", onOrientation, true);
    window.addEventListener("deviceorientation", onOrientation, true);
    setTimeout(() => { if (heading == null) setShowHelp(true) }, 3000);
  };

  useEffect(() => () => {
    window.removeEventListener("deviceorientationabsolute", onOrientation, true);
    window.removeEventListener("deviceorientation", onOrientation, true);
  }, []);

  const needleAngle = (bearing == null || heading == null) ? 0 : ((bearing - heading + 360) % 360);
  const delta = (bearing == null || heading == null) ? null : (((bearing - heading + 540) % 360) - 180);
  const aligned = delta != null && Math.abs(delta) <= 3;

  return (
    <div>
      <div style={{display:"flex", justifyContent:"center", gap:8}}>
        <button className="btn" onClick={activateCompass}>Tillat kompass</button>
        <button className="btn" onClick={()=>setShowHelp(true)}>Hjelp</button>
      </div>

      <div style={{position:"relative", width:280, height:300, margin:"12px auto 0"}}>
        {/* dial */}
        <div style={{position:"absolute", inset:"20px 0 0 0", borderRadius:"50%",
          background:"radial-gradient(140px 140px at 50% 45%, rgba(255,255,255,.10), rgba(15,23,42,.65))",
          boxShadow:"inset 0 10px 30px rgba(0,0,0,.5), 0 6px 24px rgba(0,0,0,.35)", border:`1px solid ${aligned ? "rgba(16,185,129,.8)" : "rgba(148,163,184,.35)"}`}}/>
        <div style={{position:"absolute", inset:"30px 10px 10px 10px", borderRadius:"50%"}}>
          {[...Array(60)].map((_,i)=>(
            <div key={i} style={{position:"absolute", inset:0, transform:`rotate(${i*6}deg)`}}>
              <div style={{position:"absolute", top:8, left:"50%", transform:"translateX(-50%)", width: i%5===0 ? 3 : 2, height: i%5===0 ? 16 : 10, background: aligned ? "#10b981" : "#445169", opacity: i%5===0 ? 1 : .7, borderRadius:2}}/>
            </div>
          ))}
          <div style={{position:"absolute", inset:0, color: aligned ? "#10b981" : "#a5b4fc", fontWeight:700}}>
            <div style={{position:"absolute", top:14, left:"50%", transform:"translateX(-50%)"}}>N</div>
            <div style={{position:"absolute", bottom:14, left:"50%", transform:"translateX(-50%)"}}>S</div>
            <div style={{position:"absolute", top:"50%", left:14, transform:"translateY(-50%)"}}>V</div>
            <div style={{position:"absolute", top:"50%", right:14, transform:"translateY(-50%)"}}>Ø</div>
          </div>
        </div>
        {/* Kaaba fixed */}
        <div style={{position:"absolute", top:30, left:"50%", transform:"translateX(-50%)", zIndex:3}}>
          <img src="/icons/kaaba_3d.svg" alt="Kaaba" width={40} height={40} draggable="false" />
        </div>
        {/* Needle */}
        <svg width="280" height="280" style={{position:"absolute", top:20, left:0, right:0, margin:"0 auto", pointerEvents:"none", zIndex:4}} aria-hidden="true">
          <defs>
            <linearGradient id="needle" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={aligned ? "#10b981" : "#ef4444"}/><stop offset="100%" stopColor={aligned ? "#065f46" : "#991b1b"}/>
            </linearGradient>
            <linearGradient id="tail" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#94a3b8"/><stop offset="100%" stopColor="#475569"/>
            </linearGradient>
          </defs>
          <g transform={`rotate(${needleAngle} 140 140)`}>
            <polygon points="140,40 132,140 148,140" fill="url(#needle)" opacity="0.98"/>
            <polygon points="132,140 148,140 140,208" fill="url(#tail)" opacity="0.86"/>
            <circle cx="140" cy="140" r="8.5" fill={aligned ? "#10b981" : "#e5e7eb"} stroke={aligned ? "#065f46" : "#334155"} strokeWidth="2"/>
            <circle cx="140" cy="140" r="2.8" fill="#1f2937"/>
          </g>
        </svg>
      </div>

      <div style={{textAlign:"center", marginTop:10}}>
        <div className="hint">
          {aligned === null ? "Aktiver kompass" : `Avvik: ${Math.abs(Math.round(delta))}° ${aligned ? "✓ På Qibla" : ""}`}
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

// ---------- Map (Leaflet) ----------
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

// ---------- Backgrounds (restore & validate) ----------
const CANDIDATE_BACKGROUNDS = [
  "/backgrounds/mecca_panorama.jpg",
  "/backgrounds/kaaba_2024.jpg",
  "/backgrounds/mecca_aerial.jpg",
  "/backgrounds/mecca_city_panorama.jpg",
  "/backgrounds/mecca_exterior.jpg" // hvis ikke finnes, blir filtrert bort av validering
];

async function validateBackgrounds(list) {
  const checks = await Promise.all(list.map(src => new Promise(resolve => {
    const img = new Image(); img.onload = () => resolve(src); img.onerror = () => resolve(null); img.src = src;
  })));
  const ok = checks.filter(Boolean);
  return ok.length ? ok : ["/backgrounds/kaaba_2024.jpg"];
}

// ---------- App ----------
const DEFAULT_COORDS = { latitude: 59.9139, longitude: 10.7522 }; // Oslo fallback

export default function App(){
  const { coords, loading, permission, requestOnce, startWatch } = useGeolocationWatch(5);
  const [city, setCity]   = useLocalStorage("aq_city", "");
  const [countryCode, setCountryCode] = useLocalStorage("aq_country", "");
  const [times, setTimes] = useState(null);
  const [timesText, setTimesText] = useState(null);
  const [apiError, setApiError] = useState("");
  const [bgList, setBgList] = useState(CANDIDATE_BACKGROUNDS);
  const [bgIdx, setBgIdx] = useState(0);
  const [countdown, setCountdown] = useState({ name: null, at: null, diffText: null, tomorrow: false });
  const [remindersOn, setRemindersOn] = useLocalStorage("aq_reminders_on", false);
  const [showMap, setShowMap] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [quranMode, setQuranMode] = useLocalStorage("aq_quran_mode", false);
  const [theme, setTheme] = useLocalStorage("aq_theme", "dark");
  const [lastCoords, setLastCoords] = useLocalStorage("aq_last_coords", null);
  const [weather, setWeather] = useState(() => normalizeWeatherCache(loadCache("aq_weather_cache")));
  const [weatherError, setWeatherError] = useState("");
  const [calendarRows, setCalendarRows] = useState([]);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const [offline, setOffline] = useState(typeof navigator !== "undefined" ? !navigator.onLine : false);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const audioRef = useRef(null);
  const timersRef = useRef([]);
  const refreshSeqRef = useRef(0);

  // Validate backgrounds once
  useEffect(() => { validateBackgrounds(CANDIDATE_BACKGROUNDS).then(setBgList) }, []);
  // Rotate backgrounds
  useEffect(() => { const id = setInterval(()=> setBgIdx(i => (i+1)%bgList.length), 25000); return () => clearInterval(id) }, [bgList.length]);
  const bg = bgList[bgIdx % bgList.length];
  const activeCoords = coords || lastCoords || DEFAULT_COORDS;
  const effectiveCountryCode = inferCountryCode(activeCoords?.latitude, activeCoords?.longitude, countryCode || "");
  const todayIsoForView = isoDateInTz(timeZone, 0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
  }, [theme]);

  useEffect(() => {
    runDevCompareMode();
  }, []);

  useEffect(() => {
    if (coords?.latitude && coords?.longitude) setLastCoords(coords);
  }, [coords?.latitude, coords?.longitude]);

  // Show modal if permission prompt/denied and no coords
  useEffect(() => { setShowModal(!coords && (permission === "prompt" || permission === "denied")) }, [coords, permission]);
  const allowLocation = () => { requestOnce(); startWatch(); setShowModal(false); };

  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // midnight refresh + smooth countdown
  useEffect(() => {
    let last = new Date().toDateString();
    const idDay = setInterval(async () => {
      const nowStr = new Date().toDateString();
      if (nowStr !== last) {
        last = nowStr;
        if (activeCoords) await refreshTimes(activeCoords.latitude, activeCoords.longitude);
      }
    }, 60000);
    const idTick = setInterval(() => {
      setCountdown((prev) => {
        if (prev?.tomorrow && prev?.at instanceof Date) {
          return { ...prev, diffText: diffToText(prev.at.getTime() - Date.now()) };
        }
        const info = nextPrayerInfo(times);
        if (!info?.name) return info;
        const atText = info.name === "Soloppgang" ? timesText?.Soloppgang : timesText?.[info.name];
        return { ...info, atText: atText || (info.at ? formatPrayerTime(info.at) : null) };
      });
    }, 1000);
    return () => { clearInterval(idDay); clearInterval(idTick) };
  }, [activeCoords?.latitude, activeCoords?.longitude, times?.Fajr?.getTime?.(), effectiveCountryCode, timesText?.Fajr]);

  // reverse geocode on coords change
  useEffect(() => {
    if (!activeCoords) return;
    let active = true;
    if (!coords && !city) setCity("Oslo");
    reverseGeocode(activeCoords.latitude, activeCoords.longitude).then((r) => {
      if (!active) return;
      if (r?.name) setCity(r.name);
      if (r?.countryCode) setCountryCode(r.countryCode);
    });
    return () => {
      active = false;
    };
  }, [activeCoords?.latitude, activeCoords?.longitude, coords, city, countryCode]);

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

  const qiblaDeg = useMemo(() => activeCoords ? qiblaBearing(activeCoords.latitude, activeCoords.longitude) : null, [activeCoords?.latitude, activeCoords?.longitude]);

  async function refreshTimes(lat, lng) {
    const seq = ++refreshSeqRef.current;
    try {
      setApiError("");
      const tz = timeZone;

      const todayIso = isoDateInTz(tz, 0);
      const tomorrowIso = isoDateInTz(tz, 1);
      const [todayYear, todayMonth] = todayIso.split("-").map(Number);
      const [tomorrowYear, tomorrowMonth] = tomorrowIso.split("-").map(Number);

      const monthRows = await fetchMonthlyCalendar(lat, lng, todayMonth, todayYear, tz, effectiveCountryCode);
      if (seq !== refreshSeqRef.current) return;
      setCalendarRows(monthRows || []);
      setCalendarError("");
      const todayRow = monthRows.find((row) => row.date === todayIso);

      if (!todayRow?.timings) {
        throw new Error(`Mangler tider i månedskalender for ${todayIso}`);
      }

      const todayStr = todayRow.timings;
      if (todayStr?.Maghrib && todayStr?.Isha && todayStr.Maghrib === todayStr.Isha) {
        console.warn("[Aladhan] Maghrib equals Isha for selected date", { date: todayIso, timings: todayStr });
      }
      const today = ensureDates(todayStr, todayIso);
      if (seq !== refreshSeqRef.current) return;
      setTimes(today);
      setTimesText({
        Fajr: todayStr.Fajr || "",
        Soloppgang: todayStr.Sunrise || "",
        Dhuhr: todayStr.Dhuhr || "",
        Asr: todayStr.Asr || "",
        Maghrib: todayStr.Maghrib || "",
        Isha: todayStr.Isha || "",
      });
      saveCache(timesCacheKey(lat, lng, todayIso), todayStr);

      const info = nextPrayerInfo(today);
      const infoAtText = info?.name
        ? (info.name === "Soloppgang" ? todayStr.Sunrise : todayStr[info.name])
        : null;
      setCountdown({ ...info, atText: infoAtText || (info.at ? formatPrayerTime(info.at) : null) });

      if (info.tomorrow) {
        let tomorrowRows = monthRows;
        if (tomorrowMonth !== todayMonth || tomorrowYear !== todayYear) {
          tomorrowRows = await fetchMonthlyCalendar(lat, lng, tomorrowMonth, tomorrowYear, tz, effectiveCountryCode);
          if (seq !== refreshSeqRef.current) return;
        }
        const tomorrowRow = tomorrowRows.find((row) => row.date === tomorrowIso);
        if (!tomorrowRow?.timings) throw new Error(`Mangler tider i månedskalender for ${tomorrowIso}`);
        const tomorrowStr = tomorrowRow.timings;
        const tomorrow = ensureDates(tomorrowStr, tomorrowIso);
        const fajr = tomorrow.Fajr;
        if (!fajr) throw new Error("Mangler Fajr for i morgen");
        if (seq !== refreshSeqRef.current) return;
        setCountdown({
          name: "Fajr",
          at: fajr,
          atText: tomorrowStr.Fajr || formatPrayerTime(fajr),
          diffText: diffToText(fajr.getTime() - Date.now()),
          tomorrow: true
        });
      }
    } catch (e) {
      if (seq !== refreshSeqRef.current) return;
      console.error(e);
      const msg = String(e?.message || "");
      if (msg.includes("Missing BONNETID_API_KEY")) {
        setCalendarError("Bonnetid API-nøkkel mangler i servermiljøet.");
      } else if (msg.includes("ALADHAN_")) {
        setCalendarError("Aladhan-konfigurasjon mangler i miljøvariabler.");
      } else {
        setCalendarError("Klarte ikke hente månedskalender akkurat nå.");
      }
      const todayIso = isoDateInTz(timeZone, 0);
      const cached = loadCache(timesCacheKey(lat, lng, todayIso));
      if (cached) {
        setApiError("Viser lagrede tider for denne posisjonen.");
        setTimes(ensureDates(cached, todayIso));
        setTimesText({
          Fajr: cached.Fajr || "",
          Soloppgang: cached.Sunrise || "",
          Dhuhr: cached.Dhuhr || "",
          Asr: cached.Asr || "",
          Maghrib: cached.Maghrib || "",
          Isha: cached.Isha || "",
        });
      } else {
        if (msg.includes("Missing BONNETID_API_KEY")) {
          setApiError("Bonnetid API-nøkkel mangler på serveren. Kontakt administrator.");
        } else {
          setApiError("Klarte ikke hente bønnetider (API).");
        }
        setTimes(null);
        setTimesText(null);
      }
    }
  }

  // initial fetch and start watch
  const onUseLocation = () => { requestOnce(); startWatch(); };
  useEffect(() => { if (!activeCoords) return; refreshTimes(activeCoords.latitude, activeCoords.longitude) }, [activeCoords?.latitude, activeCoords?.longitude, effectiveCountryCode]);

  useEffect(() => {
    if (!activeCoords) return;
    let active = true;
    setWeatherError("");
    const controller = new AbortController();
    fetchWeather(activeCoords.latitude, activeCoords.longitude, controller.signal)
      .then((w) => {
        if (!active) return;
        setWeather(w);
        saveCache("aq_weather_cache", w);
      })
      .catch(() => {
        if (!active) return;
        const cached = loadCache("aq_weather_cache");
        setWeather(normalizeWeatherCache(cached));
        setWeatherError(cached ? "" : "Kunne ikke hente værdata akkurat nå.");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [activeCoords?.latitude, activeCoords?.longitude]);

  useEffect(() => {
    if (!activeCoords) return;
    setCalendarError("");
  }, [activeCoords?.latitude, activeCoords?.longitude, effectiveCountryCode, timeZone]);

  // Keep push metadata up to date automatically (always-on across city changes)
  useEffect(() => {
    if (!coords) return;
    updateMetaIfSubscribed({
      lat: coords.latitude,
      lng: coords.longitude,
      city,
      countryCode: effectiveCountryCode,
      tz: timeZone,
    }).catch(()=>{});
  }, [coords?.latitude, coords?.longitude, city, effectiveCountryCode]);

  return (
    <div style={{minHeight:"100dvh", color:"var(--fg)", backgroundSize:"cover", backgroundPosition:"center", backgroundImage:`linear-gradient(${quranMode ? "rgba(3, 12, 16, .78), rgba(3, 12, 16, .78)" : "rgba(4,6,12,.65), rgba(4,6,12,.65)"}), url(${bg})`, transition:"background-image .8s ease"}}>
      <style>{`
        :root { --fg:#0f172a; --muted:#475569; --card:rgba(255,255,255,.93); --border:#d1d5db; --btn:#f8fafc; --accent:#16a34a; --accent-secondary:#0284c7; }
        :root[data-theme="dark"] { --fg:#e5e7eb; --muted:#cbd5e1; --card:rgba(15,23,42,.78); --border:#334155; --btn:#0b1220; --accent:#16a34a; --accent-secondary:#38bdf8; }
        .container { max-width: 1060px; margin: 0 auto; padding: calc(env(safe-area-inset-top) + 12px) 12px calc(env(safe-area-inset-bottom) + 20px); font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
        .card { border:1px solid var(--border); border-radius: 18px; padding: 16px; background: var(--card); backdrop-filter: blur(14px); box-shadow: 0 12px 28px rgba(2, 6, 23, 0.22); }
        .hero { background: linear-gradient(135deg, rgba(22,163,74,.18), rgba(56,189,248,.16)); padding-bottom: 12px; }
        .btn { padding:10px 14px; border-radius:12px; border:1px solid var(--border); background: var(--btn); color: var(--fg); cursor:pointer; font-weight: 600; }
        .btn:hover { opacity:.95 }
        .btn-green { background: var(--accent); border-color: var(--accent); color: white; }
        .hint { color: var(--muted); font-size: 13px; }
        .row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        h1 { margin:0 0 6px 0; font-size: clamp(32px, 5vw, 44px); line-height:1.1 }
        h3 { margin: 0; font-size: 18px; }
        ul.times { list-style:none; padding:0; margin:0 }
        .time-item { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border); font-size:16px }
        .error { color:#fecaca; background:rgba(239,68,68,.12); border:1px solid rgba(239,68,68,.35); padding:10px; border-radius:12px; }
        .calendar-wrap { margin-top:8px; max-height:220px; overflow-y:auto; overflow-x:auto; -webkit-overflow-scrolling: touch; border:1px solid var(--border); border-radius:12px; }
        .calendar-table { width:max-content; min-width:100%; border-collapse:separate; border-spacing:0; font-size:13px; table-layout:auto; }
        .calendar-table thead th {
          position: sticky;
          top: 0;
          background: color-mix(in srgb, var(--card) 95%, #94a3b8 5%);
          z-index: 1;
          text-align:left;
          font-weight:700;
        }
        .calendar-table th, .calendar-table td { padding:8px 9px; border-bottom:1px solid var(--border); white-space: nowrap; }
        .calendar-table td { font-variant-numeric: tabular-nums; }
        .calendar-date-cell { white-space: normal; }
        .calendar-date { display:block; }
        .calendar-today { display:block; font-size:10px; font-weight:700; color: var(--accent-secondary); text-transform: uppercase; letter-spacing: .04em; line-height: 1.1; margin-bottom: 2px; }
        .calendar-table th:first-child, .calendar-table td:first-child { min-width: 108px; }
        .calendar-table th:not(:first-child), .calendar-table td:not(:first-child) { min-width: 72px; }
        .calendar-table th:not(:last-child), .calendar-table td:not(:last-child) { border-right:1px solid var(--border); }
        .calendar-table tbody tr:nth-child(even) { background: rgba(148, 163, 184, .08); }
        .calendar-table tbody tr.today-row { background: rgba(56,189,248,.14); font-weight: 700; }

        @media (max-width: 520px) {
          .calendar-wrap { max-height: 200px; overflow-x: hidden; }
          .calendar-table { width: 100%; min-width: 100%; font-size: 11.5px; table-layout: fixed; }
          .calendar-table th, .calendar-table td { padding: 7px 4px; }
          .calendar-table th:first-child, .calendar-table td:first-child { width: 28%; min-width: 0; }
          .calendar-table th:not(:first-child), .calendar-table td:not(:first-child) { width: 14.4%; min-width: 0; }
        }

        .hero-stat { border: 1px solid var(--border); border-radius: 14px; padding: 12px; background: rgba(2, 6, 23, .25); }
        .kpi { font-size: 24px; font-weight: 700; }
        .section-grid { display:grid; gap:12px; margin-top:12px; grid-template-columns: 1.2fr .8fr; }
        @media (max-width: 920px){ .section-grid { grid-template-columns: 1fr; } .hero-stat .kpi{ font-size:20px; } }
      `}</style>

      <div className="container">
        <header className="card hero" style={{marginBottom:12, textAlign:"left"}}>
          <div className="row" style={{justifyContent:"space-between", marginBottom:10}}>
            <div>
              <h1>Afkir Qibla</h1>
              <div className="hint">{NB_DAY.format(new Date())}</div>
            </div>
            <button className="btn" onClick={()=> setTheme(t => t === "dark" ? "light" : "dark") }>
              Tema: {theme === "dark" ? "Mørk" : "Lys"}
            </button>
          </div>

          <div className="hero-grid" style={{display:"grid", gridTemplateColumns:"1fr", gap:10}}>
            <div className="hero-stat"><div className="hint">Sted</div><div className="kpi">{city || "Ukjent"}</div></div>
            <div className="hero-stat"><div className="hint">Qibla</div><div className="kpi">{qiblaDeg != null ? `${Math.round(qiblaDeg)}°` : "--"}</div></div>
            <div className="hero-stat"><div className="hint">Neste bønn</div><div className="kpi">{countdown?.name || "--"}</div></div>
            <div className="hero-stat">
              <div className="hint">Nedtelling</div>
              <div className="kpi" style={{fontSize:20}}>
                {countdown?.diffText || "--:--"}
              </div>
            </div>
          </div>
        </header>

        {/* Location */}
        <section className="card">
          <h3>Plassering</h3>
          <div className="row" style={{marginTop:8}}>
            <button className="btn" onClick={onUseLocation} disabled={loading}>{loading ? "Henter…" : "Bruk stedstjenester"}</button>
            <span className="hint" style={{color: offline ? "#fbbf24" : "var(--muted)"}}>{offline ? "Offline-modus aktiv" : "Online"}</span>
            <span className="hint">
              {activeCoords
                ? ((city ? city + " • " : "") + activeCoords.latitude.toFixed(4) + ", " + activeCoords.longitude.toFixed(4))
                : (permission === "denied" ? "Posisjon er blokkert i nettleseren." : "Gi tilgang for automatisk lokasjon")}
            </span>
          </div>
        </section>

        {/* Compass + Map + Times */}
        <div className="section-grid">
          {/* Qibla retning */}
          <section className="card">
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
              <h3>Qibla retning</h3>
              <button className="btn" onClick={()=>setShowMap(v=>!v)}>{showMap ? "Skjul kart" : "Vis kart"}</button>
            </div>
            {activeCoords ? (
              <>
                <div className="hint" style={{marginBottom:8}}>
                  {qiblaDeg != null ? `Qibla: ${Math.round(qiblaDeg)}°` : "Finne retning…"}
                </div>
                <ModernCompass bearing={qiblaDeg ?? 0} />
                {showMap && (
                  <div style={{marginTop:12}}>
                    <QiblaMap coords={activeCoords} />
                    <div className="hint" style={{marginTop:6}}>Linjen viser retningen fra din posisjon til Kaaba (Mekka).</div>
                  </div>
                )}
              </>
            ) : <div className="hint">Velg/bekreft posisjon for å vise Qibla og kart.</div>}
          </section>

          <div style={{display:"grid", gap:12}}>
            <section className="card">
              <h3>Været nå</h3>
              {weatherError && <div className="error" style={{marginTop:8}}>{weatherError}</div>}
              {!weather && !weatherError && <div className="hint" style={{marginTop:8}}>Henter værdata…</div>}
              {weather && (
                <div style={{marginTop:10}}>
                  <div style={{fontSize:28, fontWeight:700}}>{weatherIcon(weather.code)} {formatMetric(weather.currentTemp, "°")}</div>
                  <div className="hint" style={{marginTop:4}}>{weatherCodeToText(weather.code)} · Føles som {formatMetric(weather.feelsLike, "°")}</div>
                  <div className="hint" style={{marginTop:4}}>Vind: {formatMetric(weather.wind, " m/s")} · Min/maks: {formatMetric(weather.min, "°")} / {formatMetric(weather.max, "°")}</div>
                </div>
              )}
            </section>

            <section className="card">
              <div
                style={{display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer"}}
                onClick={() => setCalendarExpanded((v) => !v)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setCalendarExpanded((v) => !v);
                  }
                }}
                aria-expanded={calendarExpanded}
              >
                <h3>Månedskalender</h3>
                <span className="hint" style={{fontWeight: 700}}>{calendarExpanded ? "Skjul" : "Vis"}</span>
              </div>
              {calendarError && <div className="error" style={{marginTop:8}}>{calendarError}</div>}
              {calendarExpanded && (
                <div className="calendar-wrap">
                  <table className="calendar-table">
                    <thead>
                      <tr><th style={{textAlign:"left"}}>Dato</th><th style={{textAlign:"left"}}>Fajr</th><th style={{textAlign:"left"}}>Duhr</th><th style={{textAlign:"left"}}>Asr</th><th style={{textAlign:"left"}}>Maghrib</th><th style={{textAlign:"left"}}>Isha</th></tr>
                    </thead>
                    <tbody>
                      {calendarRows.map((row) => {
                        const isTodayRow = row.date === todayIsoForView;
                        return (
                          <tr key={row.date} className={isTodayRow ? "today-row" : undefined}>
                            <td className="calendar-date-cell">{isTodayRow && <span className="calendar-today">i dag</span>}<span className="calendar-date">{formatCalendarDate(row.date)}</span></td><td>{row.timings.Fajr || "--:--"}</td><td>{row.timings.Dhuhr || "--:--"}</td><td>{row.timings.Asr || "--:--"}</td><td>{row.timings.Maghrib || "--:--"}</td><td>{row.timings.Isha || "--:--"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card">
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                <h3>Quran & Dhikr</h3>
                <button className={quranMode ? "btn btn-green" : "btn"} onClick={() => setQuranMode(v => !v)}>{quranMode ? "På" : "Av"}</button>
              </div>
              <div className="hint" style={{marginTop:8}}>Stillere modus for moské/ramadan med korte påminnelser.</div>
              {quranMode && (
                <ul style={{margin:"10px 0 0", paddingLeft:18}}>
                  <li className="hint">"Hasbunallahu wa ni'mal wakeel" × 7</li>
                  <li className="hint">"Astaghfirullah" × 33</li>
                  <li className="hint">Surah Al-Ikhlas, Al-Falaq, An-Nas før søvn.</li>
                </ul>
              )}
            </section>
          </div>

          {/* Bønnetider */}
          <section className="card">
            <h3>Bønnetider</h3>
            {apiError && <div className="error" style={{margin:"8px 0"}}>{apiError}</div>}
            {times ? (
              <>
                <ul className="times">
                  <li className="time-item"><span>Fajr</span><span>{timesText?.Fajr || formatPrayerTime(times.Fajr)}</span></li>
                  <li className="time-item"><span>Soloppgang</span><span>{timesText?.Soloppgang || formatPrayerTime(times.Soloppgang)}</span></li>
                  <li className="time-item"><span>Duhr</span><span>{timesText?.Dhuhr || formatPrayerTime(times.Dhuhr)}</span></li>
                  <li className="time-item"><span>Asr</span><span>{timesText?.Asr || formatPrayerTime(times.Asr)}</span></li>
                  <li className="time-item"><span>Maghrib</span><span>{timesText?.Maghrib || formatPrayerTime(times.Maghrib)}</span></li>
                  <li className="time-item"><span>Isha</span><span>{timesText?.Isha || formatPrayerTime(times.Isha)}</span></li>
                </ul>

                <div style={{marginTop:10, fontSize:15}}>
                  {countdown?.name
                    ? <>{countdown.tomorrow ? "Neste bønn i morgen: " : "Neste bønn: "}<b>{formatPrayerLabel(countdown.name)}</b> kl <b>{countdown.atText || formatPrayerTime(countdown.at)}</b> (<span className="hint">{countdown.diffText}</span>)</>
                    : <span className="hint">Alle dagens bønner er passert – oppdateres ved midnatt.</span>
                  }
                </div>

                <div className="row" style={{marginTop:10}}>
                  <button className={remindersOn ? "btn btn-green" : "btn"} onClick={async ()=>{
                    if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission() } catch {} }
                    try { audioRef.current?.play?.().then(()=>{ audioRef.current.pause(); audioRef.current.currentTime=0; }) } catch {}
                    setRemindersOn(v=>!v);
                  }}>{remindersOn ? "Adhan-varsler: PÅ" : "Adhan-varsler: AV"}</button>

                  <button className="btn" onClick={()=>{ const a = audioRef.current; if (a) { a.currentTime=0; a.play().catch(()=>{}) } }}>Test Adhan</button>
                  <audio ref={audioRef} preload="auto" src="/audio/adhan.mp3"></audio>
                </div>
              </>
            ) : <div className="hint">Henter bønnetider…</div>}
          </section>

          {/* Push controls card (auto-metadata) */}
          <section className="card">
            <h3>Push-varsler</h3>
            <div className="hint" style={{marginBottom:8}}>Aktiver push for å få varsler om bønnetider på denne enheten.</div>
            <PushControlsAuto
              coords={coords}
              city={city}
              countryCode={effectiveCountryCode}
              tz={timeZone}
            />
          </section>
        </div>
      </div>

      <AutoLocationModal open={showModal} onAllow={allowLocation} onClose={()=>setShowModal(false)} />
    </div>
  );
}
