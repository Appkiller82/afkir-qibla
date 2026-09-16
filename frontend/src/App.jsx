import React, { useEffect, useMemo, useRef, useState } from "react";
import PushControlsAuto from "./PushControlsAuto.jsx";
import AutoLocationModal from "./AutoLocationModal.jsx";
import { updateMetaIfSubscribed } from "./push";
import { fetchMonthTimings, runDevCompareMode } from "./prayer";
import AppView from "./AppView.jsx";
import Compass from "./Compass.jsx";
import "./design.css";

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
  return name;
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
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset");
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
    daily: Array.isArray(data?.daily?.time)
      ? data.daily.time.map((date, index) => ({
          date,
          code: data?.daily?.weather_code?.[index],
          min: data?.daily?.temperature_2m_min?.[index],
          max: data?.daily?.temperature_2m_max?.[index],
        }))
      : [],
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
    daily: Array.isArray(w.daily) ? w.daily : [],
  };
}

function formatForecastDate(isoDate) {
  if (!isoDate) return "Ukjent dato";
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat("nb-NO", { weekday: "short", day: "2-digit", month: "2-digit" }).format(d);
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
  // Let the browser start the download before releasing the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
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
  "/backgrounds/kaaba-dusk.webp",
  "/backgrounds/kaaba-dawn.webp"
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
  const [bgIdx, setBgIdx] = useState(() => Math.floor(Math.random() * CANDIDATE_BACKGROUNDS.length));
  const [rotateBackground, setRotateBackground] = useLocalStorage("aq_rotate_background", true);
  const [selectedBackground, setSelectedBackground] = useLocalStorage("aq_background", CANDIDATE_BACKGROUNDS[0]);
  const [page, setPage] = useState("home");
  const [countdown, setCountdown] = useState({ name: null, at: null, diffText: null, tomorrow: false });
  const [remindersOn, setRemindersOn] = useLocalStorage("aq_reminders_on", false);
  const [showMap, setShowMap] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [quranMode, setQuranMode] = useLocalStorage("aq_quran_mode", false);
  const [theme, setTheme] = useLocalStorage("aq_theme", "dark");
  const [lastCoords, setLastCoords] = useLocalStorage("aq_last_coords", null);
  const [weather, setWeather] = useState(() => normalizeWeatherCache(loadCache("aq_weather_cache")));
  const [weatherError, setWeatherError] = useState("");
  const [weatherTab, setWeatherTab] = useState("now");
  const [calendarRows, setCalendarRows] = useState([]);
  const [calendarError, setCalendarError] = useState("");
  const [offline, setOffline] = useState(typeof navigator !== "undefined" ? !navigator.onLine : false);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const audioRef = useRef(null);
  const timersRef = useRef([]);
  const refreshSeqRef = useRef(0);

  // Validate backgrounds once
  useEffect(() => { validateBackgrounds(CANDIDATE_BACKGROUNDS).then(setBgList) }, []);
  // Rotate backgrounds
  useEffect(() => {
    if (!rotateBackground || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setBgIdx(i => (i + 1) % bgList.length), 25000);
    return () => clearInterval(id);
  }, [bgList.length, rotateBackground]);
  const bg = rotateBackground ? bgList[bgIdx % bgList.length] : (bgList.includes(selectedBackground) ? selectedBackground : bgList[0]);
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
      if (msg.includes("ALADHAN_")) {
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
        setApiError("Klarte ikke hente bønnetider (API).");
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
    // Vær og bønnetider deler samme activeCoords slik at lokasjonsbytte oppdaterer begge likt.
    // Ikke hent vær fra en separat lokasjonskilde.
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

  return <AppView {...{ page, setPage, city, coords, lastCoords, activeCoords, permission, loading, onUseLocation, offline, theme, setTheme, quranMode, setQuranMode, bg, bgList, rotateBackground, setRotateBackground, setSelectedBackground, countdown, times, timesText, apiError, remindersOn, setRemindersOn, audioRef, weather, weatherError, weatherTab, setWeatherTab, calendarRows, calendarError, todayIsoForView, showMap, setShowMap, qiblaDeg, showModal, setShowModal, allowLocation, effectiveCountryCode, timeZone, NB_DAY, formatPrayerTime, formatMetric, weatherIcon, weatherCodeToText, formatForecastDate, formatCalendarDate, exportCalendarIcs, ModernCompass: Compass, QiblaMap, PushControlsAuto, AutoLocationModal }} />;
}
