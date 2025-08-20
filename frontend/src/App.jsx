import React, { useEffect, useMemo, useRef, useState } from "react";
import PushControlsAuto from "./PushControlsAuto.jsx";
import AutoLocationModal from "./AutoLocationModal.jsx";
import { updateMetaIfSubscribed } from "./push";

/* The rest of the code is mostly like your previous App.jsx, but we:
   - Auto-start location watch when permission is 'granted'
   - Show a modal popup to request location on first load
   - On coords/city changes, call updateMetaIfSubscribed(meta) to keep push "always on" across cities
*/

const NO_IRN_PROFILE = {
  fajrAngle: 18.0, ishaAngle: 14.0, latitudeAdj: 3, school: 0,
  offsets: { Fajr: -9, Dhuhr: +12, Asr: 0, Maghrib: +8, Isha: -46 }
};

const NB_TIME = new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" });
const NB_DAY  = new Intl.DateTimeFormat("nb-NO", { weekday: "long", day: "2-digit", month: "long" });

function useLocalStorage(key, init) {
  const [v, setV] = useState(() => {
    try { const j = localStorage.getItem(key); return j ? JSON.parse(j) : init } catch { return init }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }, [key, v]);
  return [v, setV];
}

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
          // AUTO: if already granted, request once & start watch
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

function ddmmyyyyToYmd(ddmmyyyy) {
  const [dd, mm, yyyy] = String(ddmmyyyy).split("-").map(v => parseInt(v, 10));
  const y = String(yyyy);
  const m = String(mm).padStart(2, "0");
  const d = String(dd).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function parseAladhanToDates(json) {
  const t = json.data.timings;
  const greg = json?.data?.date?.gregorian?.date;
  const ymd = greg ? ddmmyyyyToYmd(greg) : (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  })();
  const mk = (hhmm) => {
    const m = String(hhmm).match(/(\d{1,2}):(\d{2})/);
    const hh = parseInt(m[1],10), mm = parseInt(m[2],10);
    const d = new Date(`${ymd}T00:00:00`); d.setHours(hh,mm,0,0); return d;
  };
  return {
    Fajr: mk(t.Fajr),
    Soloppgang: mk(t.Sunrise),
    Dhuhr: mk(t.Dhuhr),
    Asr: mk(t.Asr),
    Maghrib: mk(t.Maghrib),
    Isha: mk(t.Isha)
  };
}
const addMinutes = (d, m) => { const x = new Date(d); x.setMinutes(x.getMinutes()+m); return x; };

async function fetchAladhan(lat, lng, when = "today") {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    method: "5",
    school: "0",
    timezonestring: tz,
    iso8601: "true"
  });
  const url = `https://api.aladhan.com/v1/timings/${when}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("API feilet");
  const json = await res.json();
  if (json.code !== 200 || !json.data?.timings) throw new Error("Ugyldig API-respons");
  return parseAladhanToDates(json);
}

async function fetchAladhanCustomNO(lat, lng, when = "today") {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    method: "99",
    fajr: String(NO_IRN_PROFILE.fajrAngle),
    isha: String(NO_IRN_PROFILE.ishaAngle),
    school: String(NO_IRN_PROFILE.school),
    latitudeAdjustmentMethod: String(NO_IRN_PROFILE.latitudeAdj),
    timezonestring: tz,
    iso8601: "true"
  });
  const url = `https://api.aladhan.com/v1/timings/${when}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("API feilet");
  const json = await res.json();
  if (json.code !== 200 || !json.data?.timings) throw new Error("Ugyldig API-respons");
  const base = parseAladhanToDates(json);
  const o = NO_IRN_PROFILE.offsets;
  return {
    Fajr: addMinutes(base.Fajr, o.Fajr || 0),
    Soloppgang: base.Soloppgang,
    Dhuhr: addMinutes(base.Dhuhr, o.Dhuhr || 0),
    Asr: addMinutes(base.Asr, o.Asr || 0),
    Maghrib: addMinutes(base.Maghrib, o.Maghrib || 0),
    Isha: addMinutes(base.Isha, o.Isha || 0)
  };
}
async function fetchPrayerTimesSmart(lat, lng, when="today", countryCode="") {
  const inNorway = (countryCode||"").toUpperCase() === "NO";
  if (inNorway) return await fetchAladhanCustomNO(lat, lng, when);
  return await fetchAladhan(lat, lng, when);
}

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

export default function App(){
  const { coords, loading, permission, requestOnce, startWatch } = useGeolocationWatch(5);
  const [city, setCity]   = useLocalStorage("aq_city", "");
  const [countryCode, setCountryCode] = useLocalStorage("aq_country", "");
  const [times, setTimes] = useState(null);
  const [apiError, setApiError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [countdown, setCountdown] = useState({ name: null, at: null, diffText: null, tomorrow: false });
  const audioRef = useRef(null);
  const timersRef = useRef([]);

  // Show modal automatically on first load if permission is prompt/denied and no coords
  useEffect(() => {
    if (!coords && (permission === "prompt" || permission === "denied")) setShowModal(true);
    else setShowModal(false);
  }, [coords, permission]);

  // On allow from modal → request location + start watch
  const allowLocation = () => { requestOnce(); startWatch(); setShowModal(false); };

  // If permission is granted, auto request + watch (handled in hook's init)

  // Reverse geocode
  useEffect(() => {
    if (!coords) return;
    (async () => {
      const r = await reverseGeocode(coords.latitude, coords.longitude);
      if (r?.name) setCity(r.name);
      if (r?.countryCode) setCountryCode(r.countryCode);
    })();
  }, [coords?.latitude, coords?.longitude]);

  // Fetch times when coords/country change
  useEffect(() => {
    if (!coords) return;
    (async () => {
      try {
        setApiError("");
        const today = await fetchPrayerTimesSmart(coords.latitude, coords.longitude, "today", countryCode);
        const info = nextPrayerInfo(today);
        if (info.tomorrow) {
          const tomorrow = await fetchPrayerTimesSmart(coords.latitude, coords.longitude, "tomorrow", countryCode);
          const fajr = tomorrow.Fajr;
          setTimes(today);
          setCountdown({ name: "Fajr", at: fajr, diffText: diffToText(fajr.getTime() - Date.now()), tomorrow: true });
        } else {
          setTimes(today);
          setCountdown(info);
        }
      } catch (e) {
        console.error(e); setApiError("Klarte ikke hente bønnetider (API)."); setTimes(null);
      }
    })();
  }, [coords?.latitude, coords?.longitude, countryCode]);

  // Keep push metadata up to date automatically (always-on across city changes)
  useEffect(() => {
    if (!coords) return;
    updateMetaIfSubscribed({
      lat: coords.latitude,
      lng: coords.longitude,
      city,
      countryCode,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }).catch(()=>{});
  }, [coords?.latitude, coords?.longitude, city, countryCode]);

  // Smooth countdown
  useEffect(() => {
    const id = setInterval(() => setCountdown(nextPrayerInfo(times)), 500);
    return () => clearInterval(id);
  }, [times?.Fajr?.getTime?.()]);

  const bg = "/backgrounds/kaaba_2024.jpg";

  return (
    <div style={{minHeight:"100dvh"}}>
      <style>{`
        :root { --fg:#e5e7eb; --muted:#cbd5e1; --card:rgba(15,23,42,.78); --border:#334155; --btn:#0b1220; --accent:#16a34a; }
        .container { padding: 16px; color: var(--fg); font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
        .card { border:1px solid var(--border); border-radius: 16px; padding: 14px; background: var(--card); backdrop-filter: blur(10px); }
        .btn { padding:10px 14px; border-radius:12px; border:1px solid var(--border); background: var(--btn); color: var(--fg); cursor:pointer; }
        .btn-green { background: var(--accent); border-color: var(--accent); color: white; }
        .hint { color: var(--muted); font-size: 13px; }
      `}</style>

      <div className="container">
        <header style={{marginBottom:10, textAlign:"center"}}>
          <h1>Afkir Qibla</h1>
          <div className="hint">{NB_DAY.format(new Date())}</div>
        </header>

        <section className="card">
          <h3>Plassering</h3>
          <div className="hint" style={{marginBottom:8}}>
            {coords ? (city ? `${city} • ${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}` : "Posisjon funnet")
                    : "Gi posisjon for å hente lokale bønnetider"}
          </div>
          {/* Optional manual button (still available) */}
          <button className="btn" onClick={() => { /* fallback */ }} style={{display:"none"}}>Bruk stedstjenester</button>
        </section>

        <section className="card" style={{marginTop:12}}>
          <h3>Push-varsler</h3>
          <div className="hint" style={{marginBottom:8}}>Aktiver push for bønnetider på denne enheten. Du kan flytte mellom byer uten å skru av/på.</div>
          <PushControlsAuto
            coords={coords}
            city={city}
            countryCode={countryCode}
            tz={Intl.DateTimeFormat().resolvedOptions().timeZone}
          />
        </section>

        <section className="card" style={{marginTop:12}}>
          <h3>Bønnetider</h3>
          {!times ? <div className="hint">Henter bønnetider…</div> : (
            <ul style={{listStyle:"none", padding:0, margin:0}}>
              <li>Fajr <b>{NB_TIME.format(times.Fajr)}</b></li>
              <li>Soloppgang <b>{NB_TIME.format(times.Soloppgang)}</b></li>
              <li>Dhuhr <b>{NB_TIME.format(times.Dhuhr)}</b></li>
              <li>Asr <b>{NB_TIME.format(times.Asr)}</b></li>
              <li>Maghrib <b>{NB_TIME.format(times.Maghrib)}</b></li>
              <li>Isha <b>{NB_TIME.format(times.Isha)}</b></li>
            </ul>
          )}
          <div className="hint" style={{marginTop:8}}>
            {countdown?.name ? `Neste: ${countdown.name} • ${countdown.diffText}` : "Oppdateres ved midnatt"}
          </div>
        </section>
      </div>

      <AutoLocationModal
        open={showModal}
        onAllow={allowLocation}
        onClose={() => setShowModal(false)}
      />
    </div>
  );
}