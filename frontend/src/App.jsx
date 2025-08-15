
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Afkir Qibla — Focused FIX (only two things):
 *  1) Prayer times no longer show "09:xx": we parse HH:MM robustly and set BOTH hour+minute on Date.
 *  2) Countdown shows correct hours + minutes (no huge-hour bug), and rolls to tomorrow when needed.
 *
 * Drop-in replacement for your App.jsx if you just need prayer times + countdown fixed.
 * If your app has extra UI, you can copy only the four helpers:
 *   fetchAladhan, diffToText, nextPrayerInfo, refreshTimes
 */

// ---------- Intl ----------
const NB_TIME = new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit", hour12: false });
const NB_DAY  = new Intl.DateTimeFormat("nb-NO", { weekday: "long", day: "2-digit", month: "long" });

function useLocalStorage(key, init) {
  const [v, setV] = useState(() => {
    try { const j = localStorage.getItem(key); return j ? JSON.parse(j) : init } catch { return init }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }, [key, v]);
  return [v, setV];
}

// ---------- Simple geolocation (unchanged) ----------
function useGeolocationOnce() {
  const [coords, setCoords] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [permission, setPermission] = useState("prompt");

  useEffect(() => {
    (async () => {
      try {
        if (navigator.permissions?.query) {
          const p = await navigator.permissions.query({ name: "geolocation" });
          setPermission(p.state);
          p.onchange = () => setPermission(p.state);
        }
      } catch {}
    })();
  }, []);

  const getOnce = () => {
    if (!("geolocation" in navigator)) { setError("Stedstjenester ikke tilgjengelig i denne nettleseren."); return; }
    setLoading(true); setError(null);
    navigator.geolocation.getCurrentPosition(
      pos => { setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }); setLoading(false); },
      err => {
        let msg = err?.message || "Kunne ikke hente posisjon.";
        if (err?.code === 1) msg = "Tilgang til posisjon ble nektet. aA → Nettstedsinnstillinger → Sted = Tillat.";
        if (err?.code === 2) msg = "Posisjon utilgjengelig. Prøv nær et vindu.";
        if (err?.code === 3) msg = "Tidsavbrudd. Prøv igjen.";
        setError(msg); setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  return { coords, loading, error, permission, getOnce };
}

// ---------- Qibla bearing (unchanged) ----------
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

// ---------- Aladhan (Maliki) — robust HH:MM parsing ----------
async function fetchAladhan(lat, lng, when = "today") {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Oslo";
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    method: "5",   // Egyptian (Maliki)
    school: "0",   // Shafi/Maliki
    timezonestring: tz,
    iso8601: "true"
  });
  const url = `https://api.aladhan.com/v1/timings/${when}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("API feilet");
  const json = await res.json();
  if (json.code !== 200 || !json.data?.timings) throw new Error("Ugyldig API-respons");
  const t = json.data.timings;

  // "HH:MM (CEST)" -> "HH:MM"; set BOTH hour & minute explicitly
  const clean = (s) => String(s).trim().split(" ")[0];
  const mk = (hm, dOff = 0) => {
    const first = clean(hm);
    const [h, m] = first.split(":").map(n => parseInt(n, 10));
    const d = new Date();
    d.setHours(0, 0, 0, 0);                     // start at local midnight
    d.setFullYear(d.getFullYear(), d.getMonth(), d.getDate() + dOff);
    d.setHours((h||0), (m||0), 0, 0);           // set BOTH hour & minute
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

// ---------- Countdown helpers ----------
const ORDER = ["Fajr","Soloppgang","Dhuhr","Asr","Maghrib","Isha"];

function diffToText(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));  // ms → minutes (avoid seconds bug)
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} t ${m} min` : `${m} min`;
}

function nextPrayerInfo(todayTimes) {
  if (!todayTimes) return { name: null, at: null, diffText: null, tomorrow: false };
  const now = new Date();
  for (const k of ORDER) {
    const t = todayTimes[k];
    if (t && t.getTime() > now.getTime()) {
      return { name: k, at: t, diffText: diffToText(t.getTime() - now.getTime()), tomorrow: false };
    }
  }
  return { name: null, at: null, diffText: null, tomorrow: true };
}

// ---------- Minimal UI to verify the fix ----------
export default function App(){
  const { coords, loading, error, permission, getOnce } = useGeolocationOnce();
  const [times, setTimes] = useState(null);
  const [countdown, setCountdown] = useState({ name: null, at: null, diffText: null, tomorrow: false });
  const [apiError, setApiError] = useState("");

  // fetch + tick
  useEffect(() => {
    let tick;
    (async () => {
      if (!coords) return;
      try {
        const today = await fetchAladhan(coords.latitude, coords.longitude, "today");
        const info = nextPrayerInfo(today);
        if (info.tomorrow) {
          const tomorrow = await fetchAladhan(coords.latitude, coords.longitude, "tomorrow");
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
      // live update every 30s
      tick = setInterval(() => setCountdown(prev => {
        if (!times) return prev;
        return nextPrayerInfo(times);
      }), 30000);
    })();
    return () => { if (tick) clearInterval(tick); };
  }, [coords?.latitude, coords?.longitude]);

  return (
    <div style={{minHeight:"100vh", color:"#e5e7eb", background:"#0b1220", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"}}>
      <div style={{padding:"18px 16px"}}>
        <h1 style={{margin:0}}>Afkir Qibla</h1>
        <div style={{color:"#93a4b8", marginTop:2}}>{NB_DAY.format(new Date())}</div>

        <div style={{marginTop:12}}>
          <button onClick={getOnce} disabled={loading} style={{padding:"8px 12px"}}>{loading ? "Henter…" : "Bruk stedstjenester"}</button>
          <span style={{marginLeft:8, color:"#93a4b8"}}>
            {coords ? `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}` : (permission === "denied" ? "Posisjon blokkert" : "Tillat posisjon for å hente tider")}
          </span>
          {error && <div style={{marginTop:6, color:"#fecaca"}}>{error}</div>}
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
            </>
          ) : <div style={{color:"#93a4b8"}}>Hent posisjon for å laste tider…</div>}
        </div>
      </div>
    </div>
  );
}
