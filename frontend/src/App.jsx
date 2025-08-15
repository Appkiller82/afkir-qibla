
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Afkir Qibla — High‑lat fix for prayer times (Maliki) + robust fallback
 *
 * What’s new in this build:
 * 1) Force **latitudeAdjustmentMethod=3 (AngleBased)** for high latitudes (e.g., Norway)
 * 2) If method=5 (EGAS/Maliki) looks inconsistent, auto‑fallback to method=3 (MWL) — still school=0 (Shafi/Maliki)
 * 3) Explicit "Europe/Oslo" fallback if timeZone is missing/odd
 * 4) Extra sanity checks + console.debug to inspect raw API
 * Keeps: countdown fix, 5km auto‑refresh, map fallback, compass, theme, adhan test, etc.
 */

// ---------- Intl ----------
const NB_TIME = new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" });
const NB_DAY  = new Intl.DateTimeFormat("nb-NO", { weekday: "long", day: "2-digit", month: "long" });

function useLocalStorage(key, init) {
  const [v, setV] = useState(() => { try { const j = localStorage.getItem(key); return j ? JSON.parse(j) : init } catch { return init } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }, [key, v]);
  return [v, setV];
}

// ---------- Haversine ----------
function haversineKm(a,b){if(!a||!b)return 0;const R=6371;const dLat=(b.latitude-a.latitude)*Math.PI/180;const dLon=(b.longitude-a.longitude)*Math.PI/180;const lat1=a.latitude*Math.PI/180;const lat2=b.latitude*Math.PI/180;const s1=Math.sin(dLat/2), s2=Math.sin(dLon/2);const t=s1*s1+Math.cos(lat1)*Math.cos(lat2)*s2*s2;return 2*R*Math.atan2(Math.sqrt(t),Math.sqrt(1-t));}

// ---------- Geolocation Watch ----------
function useGeolocationWatch(minKm=5){
  const [coords,setCoords]=useState(null);
  const [error,setError]=useState(null);
  const [loading,setLoading]=useState(false);
  const [permission,setPermission]=useState("prompt");
  const last=useRef(null); const wid=useRef(null);

  useEffect(()=>{let m=true;(async()=>{try{if(navigator.permissions?.query){const p=await navigator.permissions.query({name:"geolocation"});if(m) setPermission(p.state);p.onchange=()=>m&&setPermission(p.state)}}catch{}})();return()=>{m=false}},[]);

  const requestOnce=()=>{
    if(!("geolocation"in navigator)){setError("Stedstjenester ikke tilgjengelig.");return}
    setLoading(true); setError(null);
    navigator.geolocation.getCurrentPosition(
      pos=>{const c={latitude:pos.coords.latitude,longitude:pos.coords.longitude}; last.current=c; setCoords(c); setLoading(false)},
      err=>{let msg=err?.message||"Kunne ikke hente posisjon."; if(err?.code===1) msg="Tilgang nektet. aA → Nettstedsinnstillinger → Sted = Tillat."; if(err?.code===2) msg="Posisjon utilgjengelig."; if(err?.code===3) msg="Tidsavbrudd."; setError(msg); setLoading(false)},
      {enableHighAccuracy:true, timeout:15000, maximumAge:0}
    );
  };

  const startWatch=()=>{
    if(!("geolocation"in navigator)) return;
    if(wid.current!=null) return;
    wid.current=navigator.geolocation.watchPosition(
      pos=>{const c={latitude:pos.coords.latitude,longitude:pos.coords.longitude}; if(!last.current){last.current=c; setCoords(c); return;} const km=haversineKm(last.current,c); if(km>=minKm){last.current=c; setCoords(c);}},
      ()=>{},
      {enableHighAccuracy:true, maximumAge:15000, timeout:20000}
    );
  };

  useEffect(()=>()=>{ if(wid.current!=null && navigator.geolocation?.clearWatch){navigator.geolocation.clearWatch(wid.current); wid.current=null;} },[]);

  return {coords,error,loading,permission,requestOnce,startWatch};
}

// ---------- Reverse geocode ----------
async function reverseGeocode(lat,lng){
  try{
    const url=`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=nb&zoom=10&addressdetails=1`;
    const res=await fetch(url,{headers:{"Accept":"application/json"}});
    const data=await res.json(); const a=data.address||{};
    return a.city||a.town||a.village||a.municipality||a.suburb||a.state||a.county||a.country||"";
  }catch{return ""}
}

// ---------- Qibla bearing ----------
function qiblaBearing(lat,lng){
  const kaabaLat=21.4225*Math.PI/180, kaabaLon=39.8262*Math.PI/180;
  const alat=(lat||0)*Math.PI/180, alon=(lng||0)*Math.PI/180;
  const dlon=kaabaLon-alon;
  const y=Math.sin(dlon)*Math.cos(kaabaLat);
  const x=Math.cos(alat)*Math.sin(kaabaLat)-Math.sin(alat)*Math.cos(kaabaLat)*Math.cos(dlon);
  return ((Math.atan2(y,x)*180/Math.PI)+360)%360;
}

// ---------- Aladhan helpers ----------
const ORDER=["Fajr","Sunrise","Dhuhr","Asr","Maghrib","Isha"];
const LABELS={Fajr:"Fajr", Sunrise:"Soloppgang", Dhuhr:"Dhuhr", Asr:"Asr", Maghrib:"Maghrib", Isha:"Isha"};

function cleanHM(s){return String(s).trim().split(" ")[0]}
function buildDate(hm, dayOff=0){
  const first=cleanHM(hm); const [h,m]=first.split(":").map(n=>parseInt(n,10));
  const d=new Date(); d.setHours(0,0,0,0);
  d.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()+dayOff);
  d.setHours((h||0),(m||0),0,0);
  return d;
}

function sanity(times){
  if(!times) return false;
  const f=times.Fajr, sr=times.Sunrise, du=times.Dhuhr, as=times.Asr, ma=times.Maghrib, is=times.Isha;
  return f<sr && sr<du && du<as && as<ma && ma<is; // simple ordering sanity
}

async function fetchTimings(params){
  const url=`https://api.aladhan.com/v1/timings/${params.when}?${params.qs}`;
  const res=await fetch(url);
  if(!res.ok) throw new Error("API feilet");
  const json=await res.json();
  if(json.code!==200||!json.data?.timings) throw new Error("Ugyldig API");
  console.debug("Aladhan raw:", json.data.timings, "meta:", json.data.meta);
  const t=json.data.timings;
  return {
    Fajr: buildDate(t.Fajr, params.dayOff||0),
    Sunrise: buildDate(t.Sunrise, params.dayOff||0),
    Dhuhr: buildDate(t.Dhuhr, params.dayOff||0),
    Asr: buildDate(t.Asr, params.dayOff||0),
    Maghrib: buildDate(t.Maghrib, params.dayOff||0),
    Isha: buildDate(t.Isha, params.dayOff||0)
  };
}

async function fetchAladhanSmart(lat,lng,when="today"){
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Oslo";
  const base = new URLSearchParams({
    latitude:String(lat), longitude:String(lng),
    timezonestring: tz, iso8601: "true",
    school:"0", // Shafi/Maliki
    latitudeAdjustmentMethod:"3" // AngleBased: better for high lat
  });

  // 1) Try Maliki-friendly EGAS (method=5)
  const egas = new URLSearchParams(base); egas.set("method","5");
  let times = await fetchTimings({ when, qs: egas.toString() });
  if (!sanity(times)) {
    // 2) Fallback to MWL (method=3) if ordering looks wrong
    const mwl = new URLSearchParams(base); mwl.set("method","3");
    times = await fetchTimings({ when, qs: mwl.toString() });
  }
  return times;
}

// ---------- Countdown ----------
function diffToText(ms){const totalMin=Math.max(0,Math.floor(ms/60000));const h=Math.floor(totalMin/60);const m=totalMin%60;return h>0?`${h} t ${m} min`:`${m} min`;}
function nextPrayerInfo(times){
  if(!times) return {name:null, at:null, diffText:null, tomorrow:false};
  const now=new Date();
  for(const k of ORDER){const t=times[k]; if(t && t.getTime()>now.getTime()){return {name:LABELS[k], at:t, diffText:diffToText(t.getTime()-now.getTime()), tomorrow:false};}}
  return {name:null, at:null, diffText:null, tomorrow:true};
}

// ---------- Minimal Compass (unchanged) ----------
function ModernCompass({ bearing }){
  const [heading,setHeading]=useState(null);
  const [showHelp,setShowHelp]=useState(false);
  const onOri=(e)=>{let hd=null; if(typeof e?.webkitCompassHeading==="number") hd=e.webkitCompassHeading; else if(typeof e?.alpha==="number") hd=360-e.alpha; if(hd!=null && !Number.isNaN(hd)) setHeading((hd+360)%360)};
  const req=async()=>{try{if(window.DeviceMotionEvent?.requestPermission) await window.DeviceMotionEvent.requestPermission()}catch{} if(window.DeviceOrientationEvent?.requestPermission){try{const p=await window.DeviceOrientationEvent.requestPermission(); if(p!=="granted"){setShowHelp(true); return false}}catch{setShowHelp(true); return false}} return true};
  const activate=async()=>{let ok=true; if(window.DeviceOrientationEvent?.requestPermission) ok=await req(); if(!ok){setShowHelp(true); return} window.addEventListener("deviceorientationabsolute",onOri,true); window.addEventListener("deviceorientation",onOri,true); setTimeout(()=>{if(heading==null)setShowHelp(true)},3000)};
  useEffect(()=>()=>{window.removeEventListener("deviceorientationabsolute",onOri,true); window.removeEventListener("deviceorientation",onOri,true);},[]);
  const used=heading==null?0:heading; const needle=(bearing==null||used==null)?0:((bearing-used+360)%360);
  return (<div style={{textAlign:"center"}}>
    <button className="btn" onClick={activate}>Tillat kompass</button>
    <div style={{position:"relative", width:260, height:260, margin:"12px auto 0"}}>
      <div style={{position:"absolute", inset:0, borderRadius:"50%", border:"1px solid #334155"}}/>
      <img src="/icons/kaaba_3d.svg" alt="Kaaba" width={34} height={34} style={{position:"absolute", top:8, left:"50%", transform:"translateX(-50%)"}}/>
      <svg width="260" height="260" style={{position:"absolute", inset:0}}>
        <g transform={`rotate(${needle} 130 130)`}>
          <polygon points="130,34 124,130 136,130" fill="#ef4444"/><polygon points="124,130 136,130 130,198" fill="#94a3b8"/>
          <circle cx="130" cy="130" r="7" fill="#e5e7eb" stroke="#334155" strokeWidth="2"/>
        </g>
      </svg>
    </div>
    {showHelp && <div className="hint" style={{marginTop:8}}>iPhone: aA → Nettstedsinnstillinger → Bevegelse & orientering → Tillat.</div>}
  </div>);
}

// ---------- Map (Leaflet CDN) ----------
function loadLeafletOnce(){ if(window.L) return Promise.resolve(window.L); return new Promise((resolve,reject)=>{const css=document.createElement("link"); css.rel="stylesheet"; css.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; const js=document.createElement("script"); js.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; js.async=true; js.onload=()=>resolve(window.L); js.onerror=reject; document.head.appendChild(css); document.body.appendChild(js);});}
function QiblaMap({coords}){
  const ref=useRef(null), mapRef=useRef(null);
  useEffect(()=>{let cancelled=false; if(!coords) return; loadLeafletOnce().then(L=>{ if(cancelled||!ref.current) return; const mecca=[21.4225,39.8262]; const m=L.map(ref.current).setView([coords.latitude,coords.longitude],5); L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19}).addTo(m); L.marker([coords.latitude,coords.longitude]).addTo(m).bindPopup("Din posisjon"); L.marker(mecca).addTo(m).bindPopup("Kaaba"); const line=L.polyline([[coords.latitude,coords.longitude],mecca],{color:"#ef4444",weight:3}).addTo(m); m.fitBounds(line.getBounds(),{padding:[24,24]}); mapRef.current=m; }).catch(()=>{}); return ()=>{cancelled=true; if(mapRef.current){mapRef.current.remove(); mapRef.current=null;}};},[coords?.latitude,coords?.longitude]);
  return <div ref={ref} style={{width:"100%", height:300, borderRadius:12, overflow:"hidden"}}/>;
}

// ---------- App ----------
export default function App(){
  const { coords, error: geoError, loading, permission, requestOnce, startWatch } = useGeolocationWatch(5);
  const [city,setCity]=useLocalStorage("aq_city","");
  const [times,setTimes]=useState(null);
  const [apiError,setApiError]=useState("");
  const [countdown,setCountdown]=useState({ name:null, at:null, diffText:null, tomorrow:false });
  const [remindersOn,setRemindersOn]=useLocalStorage("aq_reminders_on",false);
  const [showMap,setShowMap]=useState(false);
  const audioRef=useRef(null);

  // theme
  useEffect(()=>{document.documentElement.dataset.theme="dark"},[]);

  // midnight + tick
  useEffect(()=>{let last=new Date().toDateString(); const id=setInterval(async()=>{const nowStr=new Date().toDateString(); if(nowStr!==last){last=nowStr; if(coords) await refreshTimes(coords.latitude,coords.longitude);} setCountdown(nextPrayerInfo(times));},30000); return ()=>clearInterval(id);},[coords, times?.Fajr?.getTime?.()]);

  // reverse geocode
  useEffect(()=>{ if(!coords) return; reverseGeocode(coords.latitude,coords.longitude).then(n=>n&&setCity(n)); },[coords?.latitude,coords?.longitude]);

  // schedule simple in-tab reminders
  useEffect(()=>{
    let ids=[]; if(!remindersOn||!times) return;
    const now=Date.now();
    for(const k of ORDER){ const t=times[k]; if(t instanceof Date){ const ms=t.getTime()-now; if(ms>1000){ const id=setTimeout(()=>{ try{audioRef.current?.play?.()}catch{} try{ if("Notification"in window && Notification.permission==="granted") new Notification(`Tid for ${LABELS[k]}`)}catch{} }, ms); ids.push(id); } } }
    return ()=>ids.forEach(clearTimeout);
  },[remindersOn, times?.Fajr?.getTime?.()]);

  const qiblaDeg=useMemo(()=>coords?qiblaBearing(coords.latitude,coords.longitude):null,[coords?.latitude,coords?.longitude]);

  async function refreshTimes(lat,lng){
    try{
      setApiError("");
      const today=await fetchAladhanSmart(lat,lng,"today");
      let info=nextPrayerInfo(today);
      if(info.tomorrow){
        const tomorrow=await fetchAladhanSmart(lat,lng,"tomorrow");
        const fajr=tomorrow.Fajr;
        setTimes(today);
        setCountdown({name:"Fajr", at:fajr, diffText:diffToText(fajr.getTime()-Date.now()), tomorrow:true});
      } else { setTimes(today); setCountdown(info); }
    }catch(e){ console.error(e); setApiError("Klarte ikke hente bønnetider (API)."); setTimes(null); }
  }

  const onUseLocation=()=>{ requestOnce(); startWatch(); };
  useEffect(()=>{ if(!coords) return; refreshTimes(coords.latitude,coords.longitude); },[coords?.latitude,coords?.longitude]);

  return (
    <div style={{minHeight:"100dvh", color:"#e5e7eb", background:"#0b1220"}}>
      <div style={{padding:"18px 16px"}}>
        <header style={{textAlign:"center"}}>
          <h1 style={{margin:0}}>Afkir Qibla</h1>
          <div style={{color:"#93a4b8", marginTop:2}}>{NB_DAY.format(new Date())}</div>
        </header>

        <section style={{border:"1px solid #334155", borderRadius:12, padding:12, marginTop:12, background:"#121a2b"}}>
          <h3 style={{marginTop:0}}>Plassering</h3>
          <div style={{display:"flex", gap:8, alignItems:"center", flexWrap:"wrap"}}>
            <button onClick={onUseLocation} disabled={loading} style={{padding:"8px 12px"}}>{loading?"Henter…":"Bruk stedstjenester"}</button>
            <div style={{color:"#93a4b8"}}>{coords ? ((city?city+" • ":"")+coords.latitude.toFixed(4)+", "+coords.longitude.toFixed(4)) : (permission==="denied"?"Posisjon blokkert":"Gi tilgang for automatisk lokasjon")}</div>
          </div>
          {geoError && <div style={{color:"#fecaca", marginTop:6}}>{geoError}</div>}
        </section>

        <section style={{border:"1px solid #334155", borderRadius:12, padding:12, marginTop:12, background:"#121a2b"}}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <h3 style={{marginTop:0}}>Qibla-retning</h3>
            <button onClick={()=>setShowMap(v=>!v)} style={{padding:"8px 12px"}}>{showMap?"Skjul kart":"Vis Qibla på kart"}</button>
          </div>
          {coords ? (<>
            <ModernCompass bearing={qiblaDeg??0} />
            {showMap && (<div style={{marginTop:12}}><QiblaMap coords={coords}/><div style={{color:"#93a4b8", marginTop:6}}>Linjen viser retningen fra din posisjon til Kaaba.</div></div>)}
          </>) : <div style={{color:"#93a4b8"}}>Velg/bekreft posisjon for å vise Qibla og kart.</div>}
        </section>

        <section style={{border:"1px solid #334155", borderRadius:12, padding:12, marginTop:12, background:"#121a2b"}}>
          <h3 style={{marginTop:0}}>Bønnetider (Maliki med høy‑lat justering)</h3>
          {apiError && <div style={{color:"#fecaca"}}>{apiError}</div>}
          {times ? (<>
            <ul style={{listStyle:"none", padding:0, margin:0}}>
              <li style={{display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px dashed #334155"}}><span>Fajr</span><span>{NB_TIME.format(times.Fajr)}</span></li>
              <li style={{display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px dashed #334155"}}><span>Soloppgang</span><span>{NB_TIME.format(times.Sunrise)}</span></li>
              <li style={{display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px dashed #334155"}}><span>Dhuhr</span><span>{NB_TIME.format(times.Dhuhr)}</span></li>
              <li style={{display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px dashed #334155"}}><span>Asr</span><span>{NB_TIME.format(times.Asr)}</span></li>
              <li style={{display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px dashed #334155"}}><span>Maghrib</span><span>{NB_TIME.format(times.Maghrib)}</span></li>
              <li style={{display:"flex", justifyContent:"space-between", padding:"8px 0"}}><span>Isha</span><span>{NB_TIME.format(times.Isha)}</span></li>
            </ul>
            <div style={{marginTop:10}}>
              {(() => {
                const n = nextPrayerInfo(times);
                return n.name
                  ? <>Neste bønn: <b>{n.name}</b> kl <b>{NB_TIME.format(n.at)}</b> (<span style={{color:"#93a4b8"}}>{n.diffText}</span>)</>
                  : <span style={{color:"#93a4b8"}}>Alle dagens bønner er passert – oppdateres ved midnatt.</span>;
              })()}
            </div>
            <div style={{marginTop:10, display:"flex", gap:8}}>
              <button onClick={async()=>{ if("Notification" in window && Notification.permission==="default"){ try{await Notification.requestPermission()}catch{}} try{ const a=document.getElementById("adhan-audio"); a.currentTime=0; await a.play(); a.pause(); a.currentTime=0;}catch{} setRemindersOn(v=>!v); }} style={{padding:"8px 12px", background:remindersOn?"#16a34a":"#0b1220", border:"1px solid #334155", borderRadius:10, color:"#fff"}}>
                {remindersOn?"Adhan-varsler: PÅ":"Adhan-varsler: AV"}
              </button>
              <button onClick={()=>{ const a=document.getElementById("adhan-audio"); if(a){ a.currentTime=0; a.play().catch(()=>{}); }}} style={{padding:"8px 12px"}}>Test Adhan</button>
              <audio id="adhan-audio" preload="auto" src="/audio/adhan.mp3"></audio>
            </div>
          </>) : <div style={{color:"#93a4b8"}}>Henter bønnetider…</div>}
        </section>
      </div>
    </div>
  );
}
