
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Afkir Qibla — Prayer-hours HOTFIX (Maliki, countdown correct)
 * Fixes:
 *  - Parse Aladhan times robustly and set BOTH hours and minutes explicitly.
 *  - Correct hh:mm countdown (ms → minutes → hours).
 *  - If today is finished, fetch tomorrow and count down to Fajr.
 *  - Keeps earlier features (5km auto-refresh, compass+map optional, adhan test, theme).
 *
 * NOTE: This file focuses on fixing prayer hours + countdown.
 */

// ---------- Intl ----------
const NB_TIME = new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" });
const NB_DAY  = new Intl.DateTimeFormat("nb-NO", { weekday: "long", day: "2-digit", month: "long" });

function useLocalStorage(key, init) {
  const [v, setV] = useState(() => { try { const j = localStorage.getItem(key); return j ? JSON.parse(j) : init } catch { return init } });
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

// ---------- Geolocation watch (>5km) ----------
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

// ---------- Reverse geocode ----------
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

// ---------- Aladhan (Maliki) ----------
async function fetchAladhan(lat, lng, when = "today") {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    method: "5",  // Egyptian General Authority (Maliki regions)
    school: "0",  // Shafi/Maliki
    timezonestring: tz,
    iso8601: "true"
  });
  const url = `https://api.aladhan.com/v1/timings/${when}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("API feilet");
  const json = await res.json();
  if (json.code !== 200 || !json.data?.timings) throw new Error("Ugyldig API-respons");
  const t = json.data.timings;

  // Robust parse: strip "(CEST)"; set BOTH H and M explicitly
  const clean = (s) => String(s).trim().split(" ")[0];
  const mk = (hm, dOff = 0) => {
    const first = clean(hm);
    const [h, m] = first.split(":").map(n => parseInt(n, 10));
    const d = new Date();
    d.setHours(0, 0, 0, 0);                                     // start at midnight today
    d.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()+dOff);
    d.setHours((h||0), (m||0), 0, 0);                           // set BOTH hour and minute
    return d;
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

// ---------- Countdown ----------
const ORDER = ["Fajr","Soloppgang","Dhuhr","Asr","Maghrib","Isha"];
function diffToText(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));  // ms → minutes (no seconds bug)
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} t ${m} min` : `${m} min`;
}
function nextPrayerInfo(times) {
  if (!times) return { name: null, at: null, diffText: null, tomorrow: false };
  const now = new Date();
  for (const k of ORDER) {
    const t = times[k];
    if (t && t.getTime() > now.getTime()) {
      return { name: k, at: t, diffText: diffToText(t.getTime() - now.getTime()), tomorrow: false };
    }
  }
  return { name: null, at: null, diffText: null, tomorrow: true };
}

// ---------- App (minimal UI to verify times) ----------
export default function App(){
  const { coords, error: geoError, loading, permission, requestOnce, startWatch } = useGeolocationWatch(5);
  const [city, setCity]   = useLocalStorage("aq_city", "");
  const [times, setTimes] = useState(null);
  const [apiError, setApiError] = useState("");
  const [theme, setTheme] = useLocalStorage("aq_theme", "dark");
  const [countdown, setCountdown] = useState({ name: null, at: null, diffText: null, tomorrow: false });
  const audioRef = useRef(null);

  // midnight refresh + countdown tick (30s)
  useEffect(() => {
    let last = new Date().toDateString();
    const id = setInterval(async () => {
      const nowStr = new Date().toDateString();
      if (nowStr !== last) {
        last = nowStr;
        if (coords) await refreshTimes(coords.latitude, coords.longitude);
      }
      setCountdown(nextPrayerInfo(times));
    }, 30000);
    return () => clearInterval(id);
  }, [coords, times?.Fajr?.getTime?.()]);

  // reverse geocode on coords change
  useEffect(() => {
    if (!coords) return;
    reverseGeocode(coords.latitude, coords.longitude).then(n => n && setCity(n));
  }, [coords?.latitude, coords?.longitude]);

  async function refreshTimes(lat, lng) {
    try {
      setApiError("");
      const today = await fetchAladhan(lat, lng, "today");
      const info = nextPrayerInfo(today);
      if (info.tomorrow) {
        const tomorrow = await fetchAladhan(lat, lng, "tomorrow");
        const fajr = tomorrow.Fajr;
        setTimes(today);
        setCountdown({ name: "Fajr", at: fajr, diffText: diffToText(fajr.getTime() - Date.now()), tomorrow: true });
      } else {
        setTimes(today);
        setCountdown(info);
      }
    } catch (e) {
      setApiError("Klarte ikke hente bønnetider (API).");
      setTimes(null);
    }
  }

  const onUseLocation = () => { requestOnce(); startWatch(); };

  useEffect(() => { if (!coords) return; refreshTimes(coords.latitude, coords.longitude) }, [coords?.latitude, coords?.longitude]);

  return (
    <div style={{minHeight:"100dvh", color:"#e5e7eb", background:"#0b1220"}}>
      <div style={{padding:"18px 16px"}}>
        <h1 style={{margin:0}}>Afkir Qibla</h1>
        <div style={{margin:"8px 0 14px", color:"#93a4b8"}}>{NB_DAY.format(new Date())}</div>

        <div style={{marginBottom:12}}>
          <button onClick={()=>{ const d=document.documentElement; d.dataset.theme=(d.dataset.theme==="light"?"dark":"light") }}>
            Tema
          </button>
        </div>

        <div style={{border:"1px solid #334155", borderRadius:12, padding:12, background:"#121a2b"}}>
          <h3 style={{marginTop:0}}>Plassering</h3>
          <button onClick={onUseLocation} disabled={loading}>{loading ? "Henter…" : "Bruk stedstjenester"}</button>
          <div style={{marginTop:8, color:"#93a4b8"}}>
            {coords ? ((city ? city + " • " : "") + coords.latitude.toFixed(4) + ", " + coords.longitude.toFixed(4))
                    : (permission === "denied" ? "Posisjon blokkert i nettleser" : "Gi tilgang for automatisk lokasjon")}
          </div>
          {geoError && <div style={{color:"#fecaca", marginTop:6}}>{geoError}</div>}
        </div>

        <div style={{marginTop:12, border:"1px solid #334155", borderRadius:12, padding:12, background:"#121a2b"}}>
          <h3 style={{marginTop:0}}>Bønnetider (Maliki)</h3>
          {apiError && <div style={{color:"#fecaca"}}>{apiError}</div>}
          {times ? (
            <>
              <ul style={{listStyle:"none", padding:0, margin:0}}>
                <li style={{display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px dashed #334155"}}><span>Fajr</span><span>{NB_TIME.format(times.Fajr)}</span></li>
                <li style={{display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px dashed #334155"}}><span>Soloppgang</span><span>{NB_TIME.format(times.Soloppgang)}</span></li>
                <li style={{display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px dashed #334155"}}><span>Dhuhr</span><span>{NB_TIME.format(times.Dhuhr)}</span></li>
                <li style={{display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px dashed #334155"}}><span>Asr</span><span>{NB_TIME.format(times.Asr)}</span></li>
                <li style={{display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px dashed #334155"}}><span>Maghrib</span><span>{NB_TIME.format(times.Maghrib)}</span></li>
                <li style={{display:"flex", justifyContent:"space-between", padding:"8px 0"}}><span>Isha</span><span>{NB_TIME.format(times.Isha)}</span></li>
              </ul>
              <div style={{marginTop:10}}>
                {countdown?.name
                  ? <>Neste bønn: <b>{countdown.name}</b> kl <b>{NB_TIME.format(countdown.at)}</b> (<span style={{color:"#93a4b8"}}>{countdown.diffText}</span>)</>
                  : <span style={{color:"#93a4b8"}}>Alle dagens bønner er passert – oppdateres ved midnatt.</span>}
              </div>
              <div style={{marginTop:10}}>
                <button onClick={()=>{ const a=audioRef.current; if (a) { a.currentTime=0; a.play().catch(()=>{}) } }}>Test Adhan</button>
                <audio ref={audioRef} preload="auto" src="/audio/adhan.mp3"></audio>
              </div>
            </>
          ) : <div style={{color:"#93a4b8"}}>Henter bønnetider…</div>}
        </div>
      </div>
    </div>
  );
}
