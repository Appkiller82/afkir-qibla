
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Afkir Qibla – Maliki (method=5) + precise countdown + "Neste bønn" line
 * - Prayer times via Aladhan (method=5 Egyptian; school=0 Maliki)
 * - Correct HOURS+MINUTES countdown (never seconds)
 * - Shows: "Neste bønn: NAME kl HH:MM (om X t Y min)"
 * - Auto refresh at midnight; fetch tomorrow's Fajr when needed
 * - Compass: Kaaba fixed; needle = bearing - heading (normal compass)
 * - Theme button BETWEEN title and date (safe-area friendly)
 */

// -------- Intl -------
const NB_TIME = new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" });
const NB_DAY = new Intl.DateTimeFormat("nb-NO", { weekday: "long", day: "2-digit", month: "long" });

function useLocalStorage(key, init) {
  const [v, setV] = useState(() => {
    try { const j = localStorage.getItem(key); return j ? JSON.parse(j) : init } catch { return init }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }, [key, v]);
  return [v, setV];
}

// -------- Geolocation -------
function useGeolocation() {
  const [coords, setCoords] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [permission, setPermission] = useState("prompt");

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

  const request = () => {
    if (!("geolocation" in navigator)) { setError("Stedstjenester er ikke tilgjengelig i denne nettleseren."); return }
    setLoading(true); setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }); setLoading(false) },
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
  return { coords, error, loading, permission, request };
}

// -------- Qibla bearing -------
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

// -------- Aladhan (method=5, school=0) -------
async function fetchAladhan(lat, lng, when = "today") {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    method: "5",   // Egyptian General Authority of Survey (common in Maliki regions)
    school: "0",   // Shafi/Maliki (1x)
    timezonestring: tz,
    iso8601: "true"
  });
  const url = `https://api.aladhan.com/v1/timings/${when}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("API feilet");
  const json = await res.json();
  if (json.code !== 200 || !json.data?.timings) throw new Error("Ugyldig API-respons");
  const t = json.data.timings;
  const base = new Date();
  const mk = (hm, dayOffset=0) => {
    const first = String(hm).split(" ")[0]; // strip "(CEST)" etc.
    const [h, m] = first.split(":").map(x => parseInt(x, 10));
    return new Date(base.getFullYear(), base.getMonth(), base.getDate()+dayOffset, h||0, m||0, 0, 0);
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

// -------- Countdown helpers -------
const ORDER = ["Fajr","Soloppgang","Dhuhr","Asr","Maghrib","Isha"];

function diffToText(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));  // ms → minutes
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
      const diffMs = t.getTime() - now.getTime();
      return { name: k, at: t, diffText: diffToText(diffMs), tomorrow: false };
    }
  }
  return { name: null, at: null, diffText: null, tomorrow: true };
}

// -------- Compass -------
function ModernCompass({ bearing }) {
  const [heading, setHeading] = useState(null);
  const [manualHeading, setManualHeading] = useState(0);

  useEffect(() => {
    const onOrientation = (e) => {
      let hdg = null;
      if (typeof e?.webkitCompassHeading === "number") hdg = e.webkitCompassHeading; // iOS
      else if (typeof e?.alpha === "number") hdg = 360 - e.alpha; // others
      if (hdg != null && !Number.isNaN(hdg)) setHeading((hdg + 360) % 360);
    };
    window.addEventListener("deviceorientationabsolute", onOrientation, true);
    window.addEventListener("deviceorientation", onOrientation, true);
    return () => {
      window.removeEventListener("deviceorientationabsolute", onOrientation, true);
      window.removeEventListener("deviceorientation", onOrientation, true);
    };
  }, []);

  const usedHeading = heading == null ? manualHeading : heading;
  const needleAngle = (bearing == null || usedHeading == null) ? 0 : ((bearing - usedHeading + 360) % 360);

  return (
    <div>
      <div style={{position:"relative", width:280, height:300, margin:"12px auto 0"}}>
        <div style={{position:"absolute", inset:"20px 0 0 0", borderRadius:"50%",
          background:"radial-gradient(140px 140px at 50% 45%, rgba(255,255,255,.10), rgba(15,23,42,.65))",
          boxShadow:"inset 0 10px 30px rgba(0,0,0,.5), 0 6px 24px rgba(0,0,0,.35)",
          border:"1px solid rgba(148,163,184,.35)"}}/>
        <div style={{position:"absolute", inset:"30px 10px 10px 10px", borderRadius:"50%"}}>
          {[...Array(60)].map((_,i)=>(
            <div key={i} style={{position:"absolute", inset:0, transform:`rotate(${i*6}deg)`}}>
              <div style={{position:"absolute", top:8, left:"50%", transform:"translateX(-50%)", width: i%5===0 ? 3 : 2, height: i%5===0 ? 16 : 10, background:"#445169", opacity: i%5===0 ? 1 : .7, borderRadius:2}}/>
            </div>
          ))}
          <div style={{position:"absolute", inset:0, color:"#a5b4fc", fontWeight:700}}>
            <div style={{position:"absolute", top:14, left:"50%", transform:"translateX(-50%)"}}>N</div>
            <div style={{position:"absolute", bottom:14, left:"50%", transform:"translateX(-50%)"}}>S</div>
            <div style={{position:"absolute", top:"50%", left:14, transform:"translateY(-50%)"}}>V</div>
            <div style={{position:"absolute", top:"50%", right:14, transform:"translateY(-50%)"}}>Ø</div>
          </div>
        </div>
        <div style={{position:"absolute", top:30, left:"50%", transform:"translateX(-50%)", zIndex:3}}>
          <img src="/icons/kaaba_3d.svg" alt="Kaaba" width={40} height={40} draggable="false" />
        </div>
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
          Qibla: <b>{(bearing ?? 0).toFixed(1)}°</b>
        </div>
        <div className="hint" style={{marginTop:4}}>Når viseren ligger rett på Kaaba-ikonet, peker du mot Qibla.</div>
      </div>
    </div>
  );
}

// -------- App -------
const BACKGROUNDS = [
  "/backgrounds/mecca_panorama.jpg",
  "/backgrounds/kaaba_2024.jpg",
  "/backgrounds/mecca_aerial.jpg",
  "/backgrounds/mecca_city_panorama.jpg",
  "/backgrounds/mecca_exterior.jpg"
];

export default function App(){
  const { coords, error: geoError, loading, permission, request } = useGeolocation();
  const [times, setTimes] = useState(null);
  const [apiError, setApiError] = useState("");
  const [bgIdx, setBgIdx] = useState(0);
  const [theme, setTheme] = useLocalStorage("aq_theme", "dark");
  const [countdown, setCountdown] = useState({ name: null, at: null, diffText: null, tomorrow: false });
  const audioRef = useRef(null);

  useEffect(() => { const id = setInterval(()=> setBgIdx(i => (i+1)%BACKGROUNDS.length), 25000); return () => clearInterval(id) }, []);

  // Refresh at midnight & update countdown each minute
  useEffect(() => {
    let last = new Date().toDateString();
    const id = setInterval(async () => {
      const nowStr = new Date().toDateString();
      if (nowStr !== last) {
        last = nowStr;
        if (coords) await refreshTimes(coords.latitude, coords.longitude);
      } else {
        setCountdown(nextPrayerInfo(times));
      }
    }, 60000);
    return () => clearInterval(id);
  }, [coords, times?.Fajr?.getTime?.()]);

  const qiblaDeg = useMemo(() => coords ? qiblaBearing(coords.latitude, coords.longitude) : null, [coords?.latitude, coords?.longitude]);

  async function refreshTimes(lat, lng) {
    try {
      setApiError("");
      // Today
      const today = await fetchAladhan(lat, lng, "today");
      const info = nextPrayerInfo(today);
      if (info.tomorrow) {
        // If everything today is passed, show tomorrow's Fajr countdown
        const tomorrow = await fetchAladhan(lat, lng, "tomorrow");
        const fajr = tomorrow.Fajr;
        const diffMs = fajr.getTime() - Date.now();
        setTimes(today);
        setCountdown({ name: "Fajr", at: fajr, diffText: diffToText(diffMs), tomorrow: true });
      } else {
        setTimes(today);
        setCountdown(info);
      }
    } catch (e) {
      setApiError("Klarte ikke hente bønnetider (API).");
      setTimes(null);
    }
  }

  const onUseLocation = () => { request() };

  useEffect(() => { if (!coords) return; refreshTimes(coords.latitude, coords.longitude) }, [coords?.latitude, coords?.longitude]);

  const bg = BACKGROUNDS[bgIdx];

  return (
    <div style={{minHeight:"100dvh", color:"var(--fg)", backgroundSize:"cover", backgroundPosition:"center", backgroundImage:`linear-gradient(rgba(4,6,12,.65), rgba(4,6,12,.65)), url(${bg})`, transition:"background-image .8s ease"}}>
      <style>{`
        :root { --fg:#e5e7eb; --muted:#cbd5e1; --card:rgba(15,23,42,.78); --border:#334155; --btn:#0b1220; }
        :root[data-theme="light"] { --fg:#0f172a; --muted:#475569; --card:rgba(255,255,255,.93); --border:#d1d5db; --btn:#f8fafc; }
        .container { padding: calc(env(safe-area-inset-top) + 14px) 16px 16px; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
        .card { border:1px solid var(--border); border-radius: 16px; padding: 14px; background: var(--card); backdrop-filter: blur(10px); }
        .btn { padding:10px 14px; border-radius:12px; border:1px solid var(--border); background: var(--btn); color: var(--fg); cursor:pointer; }
        .btn:hover { opacity:.95 }
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
          {/* Theme button BETWEEN title and date */}
          <div style={{margin:"6px 0 2px"}}>
            <button className="btn" onClick={()=>setTheme(theme==="dark"?"light":"dark")}>Tema: {theme==="dark"?"Mørk":"Lys"}</button>
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
                ? (coords.latitude.toFixed(4) + ", " + coords.longitude.toFixed(4))
                : (permission === "denied" ? "Posisjon er blokkert i nettleseren." : "Gi tilgang for automatisk lokasjon")}
            </span>
          </div>
          {geoError && <div className="error" style={{marginTop:8}}>{geoError}</div>}
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
          <h3>Bønnetider (Maliki)</h3>
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

              {/* Next line: human-friendly summary */}
              <div style={{marginTop:10, fontSize:15}}>
                {countdown?.name
                  ? <>Neste bønn: <b>{countdown.name}</b> kl <b>{NB_TIME.format(countdown.at)}</b> (<span className="hint">{countdown.diffText}</span>)</>
                  : <span className="hint">Alle dagens bønner er passert – oppdateres ved midnatt.</span>
                }
              </div>

              <div style={{marginTop:10}}>
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
