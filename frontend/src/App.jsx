import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Afkir Qibla — FIX 3 (IRN for Norway + Norway tuning)
 * ----------------------------------------------------
 * - Auto-switch provider: IRN (bonnetid.no) when in Norway and API key is present.
 * - Fallback to Aladhan with small "Norway tuning" offsets when IRN is unavailable.
 * - Outside Norway: unchanged Aladhan logic.
 * - reverseGeocode now returns {name, countryCode}.
 *
 * HOW TO ENABLE IRN:
 *   1) Put your IRN API key in IRN_API_KEY below (keep it empty to disable).
 *   2) Adjust IRN_BASE if your endpoint differs.
 *   3) Build & deploy as usual.
 */

// --------- IRN CONFIG (fill these later) ---------
const IRN_BASE = "https://api.bonnetid.no"; // adjust if you have a tenant-specific base
const IRN_API_KEY = ""; // <-- paste API key here to enable IRN in Norway

// ---------- Intl ----------
const NB_TIME = new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" });
const NB_DAY  = new Intl.DateTimeFormat("nb-NO", { weekday: "long", day: "2-digit", month: "long" });

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

  useEffect(() => () => { // cleanup
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
    const countryCode = (a.country_code || "").toUpperCase();
    return { name: name || "", countryCode };
  } catch { return { name: "", countryCode: "" } }
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

// ---------- Helpers ----------
function ddmmyyyyToYmd(ddmmyyyy) {
  const [dd, mm, yyyy] = String(ddmmyyyy).split("-").map(v => parseInt(v, 10));
  const y = String(yyyy);
  const m = String(mm).padStart(2, "0");
  const d = String(dd).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function extractHM(s) {
  const m = String(s).match(/(\\d{1,2}):(\\d{2})/);
  if (!m) throw new Error(`Ukjent tid: ${s}`);
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  return { hh, mm };
}
function mkDateFromYmdHM(ymd, hm) {
  const { hh, mm } = extractHM(hm);
  const d = new Date(`${ymd}T00:00:00`);
  d.setHours(hh, mm, 0, 0);
  return d;
}

// ---------- Aladhan (default/maliki) ----------
async function fetchAladhan(lat, lng, when = "today") {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    method: "5",           // Egyptian
    school: "0",           // Shafi/Maliki
    timezonestring: tz,
    iso8601: "true"
  });
  const url = `https://api.aladhan.com/v1/timings/${when}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("API feilet (Aladhan)");
  const json = await res.json();
  if (json.code !== 200 || !json.data?.timings) throw new Error("Ugyldig API-respons (Aladhan)");

  const t = json.data.timings;
  const greg = json?.data?.date?.gregorian?.date; // DD-MM-YYYY
  const ymd = greg ? ddmmyyyyToYmd(greg) : (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  })();

  return {
    Fajr:      mkDateFromYmdHM(ymd, t.Fajr),
    Soloppgang:mkDateFromYmdHM(ymd, t.Sunrise),
    Dhuhr:     mkDateFromYmdHM(ymd, t.Dhuhr),
    Asr:       mkDateFromYmdHM(ymd, t.Asr),
    Maghrib:   mkDateFromYmdHM(ymd, t.Maghrib),
    Isha:      mkDateFromYmdHM(ymd, t.Isha)
  };
}

// ---------- Norway tuning (small offsets) ----------
const NORWAY_OFFSETS = { Fajr: 0, Soloppgang: 0, Dhuhr: 1, Asr: 0, Maghrib: 0, Isha: 0 };
function applyOffsets(times, offsets) {
  const out = {};
  for (const k of Object.keys(times||{})) {
    const d = new Date(times[k]);
    const off = (offsets?.[k] ?? 0);
    d.setMinutes(d.getMinutes() + off);
    out[k] = d;
  }
  return out;
}

// ---------- IRN (bonnetid.no) ----------
async function fetchIRNByCoords(lat, lng, when="today") {
  const base = (IRN_BASE || "").replace(/\\/$/, "");
  const key = IRN_API_KEY;
  if (!base || !key) throw new Error("IRN API-konfig mangler");
  // Example flow (adjust to your actual API routes):
  // 1) Find nearest/covered place by coords
  const nearestURL = `${base}/v1/nearest?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`;
  const nearestRes = await fetch(nearestURL, { headers: { "Authorization": `Bearer ${key}` } });
  if (!nearestRes.ok) throw new Error("IRN nearest feilet");
  const nearest = await nearestRes.json();
  const placeId = nearest?.placeId || nearest?.id || nearest?.data?.placeId;
  if (!placeId) throw new Error("IRN: placeId mangler");
  // 2) Fetch timings
  const tRes = await fetch(`${base}/v1/timings?placeId=${encodeURIComponent(placeId)}&when=${encodeURIComponent(when)}`, {
    headers: { "Authorization": `Bearer ${key}` }
  });
  if (!tRes.ok) throw new Error("IRN timings feilet");
  const tJson = await tRes.json();
  const greg = tJson?.dateYMD || (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  })();
  const T = tJson?.timings || tJson?.data || tJson || {};
  return {
    Fajr: mkDateFromYmdHM(greg, T.Fajr || T.fajr || T.SUBH || T.F),
    Soloppgang: mkDateFromYmdHM(greg, T.Sunrise || T.sunrise || T.Shurooq || T.SR),
    Dhuhr: mkDateFromYmdHM(greg, T.Dhuhr || T.Thuhr || T.Zuhr || T.Z),
    Asr: mkDateFromYmdHM(greg, T.Asr || T.A),
    Maghrib: mkDateFromYmdHM(greg, T.Maghrib || T.Magrib || T.M),
    Isha: mkDateFromYmdHM(greg, T.Isha || T.I)
  };
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
  const [countryCode, setCountryCode] = useLocalStorage("aq_country", "");
  const [times, setTimes] = useState(null);
  const [apiError, setApiError] = useState("");
  const [bgIdx, setBgIdx] = useState(0);
  const [theme, setTheme] = useLocalStorage("aq_theme", "dark");
  const [countdown, setCountdown] = useState({ name: null, at: null, diffText: null, tomorrow: false });
  const [remindersOn, setRemindersOn] = useLocalStorage("aq_reminders_on", false);
  const [showMap, setShowMap] = useState(false);
  const audioRef = useRef(null);
  const timersRef = useRef([]);

  // rotate background
  useEffect(() => { const id = setInterval(()=> setBgIdx(i => (i+1)%BACKGROUNDS.length), 25000); return () => clearInterval(id) }, []);

  // midnight refresh (60s) and smooth countdown (500ms)
  useEffect(() => {
    let last = new Date().toDateString();
    const idDay = setInterval(async () => {
      const nowStr = new Date().toDateString();
      if (nowStr !== last) {
        last = nowStr;
        if (coords) await refreshTimes(coords.latitude, coords.longitude);
      }
    }, 60000);
    const idTick = setInterval(() => {
      setCountdown(nextPrayerInfo(times));
    }, 500);
    return () => { clearInterval(idDay); clearInterval(idTick) };
  }, [coords?.latitude, coords?.longitude, times?.Fajr?.getTime?.()]);

  // reverse geocode on coords change
  useEffect(() => {
    if (!coords) return;
    reverseGeocode(coords.latitude, coords.longitude).then(({name, countryCode}) => {
      if (name) setCity(name);
      if (countryCode) setCountryCode(countryCode);
    });
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

  async function fetchPrayerTimesSmart(lat, lng) {
    const inNorway = (countryCode || "").toUpperCase() === "NO";
    if (inNorway && IRN_API_KEY) {
      try {
        const irnTimes = await fetchIRNByCoords(lat, lng, "today");
        return irnTimes;
      } catch (e) {
        console.warn("IRN feilet, bruker Aladhan med Norway tuning.", e);
      }
    }
    const aa = await fetchAladhan(lat, lng, "today");
    if (inNorway) return applyOffsets(aa, NORWAY_OFFSETS);
    return aa;
  }

  async function refreshTimes(lat, lng) {
    try {
      setApiError("");
      const today = await fetchPrayerTimesSmart(lat, lng);
      const info = nextPrayerInfo(today);
      if (info.tomorrow) {
        // Fetch tomorrow via same logic (IRN if available; else Aladhan)
        let tomorrow;
        const inNorway = (countryCode || "").toUpperCase() === "NO";
        if (inNorway && IRN_API_KEY) {
          try { tomorrow = await fetchIRNByCoords(lat, lng, "tomorrow"); }
          catch { tomorrow = await fetchAladhan(lat, lng, "tomorrow"); }
        } else {
          tomorrow = await fetchAladhan(lat, lng, "tomorrow");
        }
        const fajr = tomorrow.Fajr;
        setTimes(today);
        setCountdown({ name: "Fajr", at: fajr, diffText: diffToText(fajr.getTime() - Date.now()), tomorrow: true });
      } else {
        setTimes(today);
        setCountdown(info);
      }
    } catch (e) {
      console.error(e);
      setApiError("Klarte ikke hente bønnetider (IRN/Aladhan).");
      setTimes(null);
    }
  }

  // initial fetch and start watch
  const onUseLocation = () => { requestOnce(); startWatch(); };

  useEffect(() => { if (!coords) return; refreshTimes(coords.latitude, coords.longitude) }, [coords?.latitude, coords?.longitude, countryCode]);

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
          <div style={{margin:"6px 0 2px"}}>
            <button className="btn" onClick={()=>{ const d = document.documentElement; d.dataset.theme = (d.dataset.theme==="light"?"dark":"light") }}>
              Tema
            </button>
          </div>
          <div className="hint">{NB_DAY.format(new Date())}</div>
        </header>

        {/* Location */}
        <section className="card">
          <h3>Plassering</h3>
          <div className="row" style={{marginTop:8}}>
            <button className="btn" onClick={onUseLocation} disabled={loading}>{loading ? "Henter…" : "Bruk stedstjenester"}</button>
            <span className="hint">
              {coords
                ? ((city ? city + (countryCode?` (${countryCode})`:"") + " • " : "") + coords.latitude.toFixed(4) + ", " + coords.longitude.toFixed(4))
                : (permission === "denied" ? "Posisjon er blokkert i nettleseren." : "Gi tilgang for automatisk lokasjon")}
            </span>
          </div>
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
                <ModernCompass bearing={qiblaDeg ?? 0} />
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
            <h3>Bønnetider</h3>
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
                    await ensureNotify();
                    try { audioRef.current?.play?.().then(()=>{ audioRef.current.pause(); audioRef.current.currentTime=0; }) } catch {}
                    setRemindersOn(v=>!v);
                  }}>{remindersOn ? "Adhan-varsler: PÅ" : "Adhan-varsler: AV"}</button>

                  <button className="btn" onClick={()=>{ const a = audioRef.current; if (a) { a.currentTime=0; a.play().catch(()=>{}) } }}>Test Adhan</button>
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

// ---------- Compass (same visuals) ----------
function ModernCompass({ bearing }) {
  const [heading, setHeading] = useState(null);
  const [manualHeading, setManualHeading] = useState(0);
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

  const usedHeading = heading == null ? manualHeading : heading;
  const delta = (bearing == null || usedHeading == null) ? null : (((bearing - usedHeading + 540) % 360) - 180); // -180..180
  const aligned = delta != null && Math.abs(delta) <= 3;
  const needleAngle = (bearing == null || usedHeading == null) ? 0 : ((bearing - usedHeading + 360) % 360);

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
          {delta == null ? "Aktiver kompass" : `Avvik: ${Math.abs(Math.round(delta))}° ${aligned ? "✓ På Qibla" : ""}`}
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
