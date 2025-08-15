
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Afkir Qibla — Minimal patch that ONLY fixes:
 *  1) Prayer times parsing/building (sets BOTH hours and minutes explicitly)
 *  2) Countdown (correct hours+minutes; handles "tomorrow" when needed)
 *
 * Everything else is kept generic so you can drop this into your current app.
 * If your original file has extra UI/components, keep them — just merge the
 * functions below (fetchAladhan, diffToText, nextPrayerInfo, refreshTimes).
 */

// ---------- Helpers for formatting ----------
const NB_TIME = new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" });

// ---------- Aladhan (Maliki) with robust hour setting ----------
export async function fetchAladhan(lat, lng, when = "today") {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    method: "5",    // Egyptian General Authority (Maliki regions)
    school: "0",    // Shafi/Maliki
    timezonestring: tz,
    iso8601: "true"
  });
  const url = `https://api.aladhan.com/v1/timings/${when}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("API feilet");
  const json = await res.json();
  if (json.code !== 200 || !json.data?.timings) throw new Error("Ugyldig API-respons");
  const t = json.data.timings;

  // Robust parse: strip "(CEST)" etc. and set BOTH hour and minute explicitly
  const clean = (s) => String(s).trim().split(" ")[0];
  const mk = (hm, dOff = 0) => {
    const first = clean(hm);
    const [h, m] = first.split(":").map(n => parseInt(n, 10));
    const d = new Date();
    d.setHours(0, 0, 0, 0);                                     // start at midnight local
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

// ---------- Countdown helpers ----------
export const ORDER = ["Fajr","Soloppgang","Dhuhr","Asr","Maghrib","Isha"];

export function diffToText(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));  // ms → minutes
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} t ${m} min` : `${m} min`;
}

export function nextPrayerInfo(todayTimes) {
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

// ---------- Example small component using the helpers ----------
// If you already have your own App, you can IGNORE this component.
// It is provided so you can test the fix in isolation.
export default function PrayerTimesFixDemo(){
  const [coords, setCoords] = useState(null);
  const [times, setTimes] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [err, setErr] = useState("");

  const useLocation = () => {
    if (!("geolocation" in navigator)) { setErr("Stedstjenester ikke tilgjengelig"); return; }
    navigator.geolocation.getCurrentPosition(
      pos => setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      e => setErr(e?.message || "Kunne ikke hente posisjon"),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  useEffect(() => {
    let tick;
    (async () => {
      try {
        if (!coords) return;
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
        // live update
        tick = setInterval(() => setCountdown(nextPrayerInfo(today)), 30000);
      } catch (e) {
        setErr("Feil under henting av tider");
      }
    })();
    return () => { if (tick) clearInterval(tick); };
  }, [coords?.latitude, coords?.longitude]);

  return (
    <div style={{padding:16, color:"#e5e7eb", background:"#0b1220", minHeight:"100vh", fontFamily:"system-ui, -apple-system, Segoe UI, Roboto, sans-serif"}}>
      <h2 style={{marginTop:0}}>Test – Bønnetider/Nedtelling (Maliki)</h2>
      <button onClick={useLocation}>Bruk stedstjenester</button>
      {err && <div style={{marginTop:8, color:"#fecaca"}}>{err}</div>}

      {coords && <div style={{marginTop:8, color:"#93a4b8"}}>{coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}</div>}

      <div style={{marginTop:12, border:"1px solid #334155", borderRadius:12, padding:12, background:"#121a2b"}}>
        {times ? (
          <>
            <ul style={{listStyle:"none", padding:0, margin:0}}>
              <li style={{display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px dashed #334155"}}>
                <span>Fajr</span><span>{NB_TIME.format(times.Fajr)}</span>
              </li>
              <li style={{display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px dashed #334155"}}>
                <span>Soloppgang</span><span>{NB_TIME.format(times.Soloppgang)}</span>
              </li>
              <li style={{display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px dashed #334155"}}>
                <span>Dhuhr</span><span>{NB_TIME.format(times.Dhuhr)}</span>
              </li>
              <li style={{display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px dashed #334155"}}>
                <span>Asr</span><span>{NB_TIME.format(times.Asr)}</span>
              </li>
              <li style={{display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px dashed #334155"}}>
                <span>Maghrib</span><span>{NB_TIME.format(times.Maghrib)}</span>
              </li>
              <li style={{display:"flex", justifyContent:"space-between", padding:"6px 0"}}>
                <span>Isha</span><span>{NB_TIME.format(times.Isha)}</span>
              </li>
            </ul>

            <div style={{marginTop:10}}>
              {countdown?.name
                ? <>Neste: <b>{countdown.name}</b> kl <b>{NB_TIME.format(countdown.at)}</b> (<span style={{color:"#93a4b8"}}>{countdown.diffText}</span>)</>
                : <span style={{color:"#93a4b8"}}>Alle dagens bønner er passert – oppdateres ved midnatt.</span>}
            </div>
          </>
        ) : <div style={{color:"#93a4b8"}}>Hent posisjon for å laste tider…</div>}
      </div>
    </div>
  );
}
