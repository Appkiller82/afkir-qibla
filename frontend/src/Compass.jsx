import React, { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import Dialog from "./Dialog.jsx";

export default function Compass({ bearing }) {
  const [heading, setHeading] = useState(null);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState("");
  const [help, setHelp] = useState(false);
  const received = useRef(false);
  useEffect(() => {
    if (!active) return;
    const onOrientation = e => {
      // Relative alpha is not necessarily referenced to north. Do not present it as a compass.
      const value = typeof e.webkitCompassHeading === "number" ? e.webkitCompassHeading
        : (e.absolute === true && typeof e.alpha === "number" ? 360 - e.alpha : null);
      if (value == null || !Number.isFinite(value)) return;
      received.current = true;
      setHeading((value + 360) % 360);
      setMessage("");
    };
    window.addEventListener("deviceorientationabsolute", onOrientation, true);
    window.addEventListener("deviceorientation", onOrientation, true);
    const timeout = setTimeout(() => {
      if (!received.current) setMessage("Ingen kompassdata ennå. Prøv på en mobil, eller bruk kartet.");
    }, 4000);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("deviceorientationabsolute", onOrientation, true);
      window.removeEventListener("deviceorientation", onOrientation, true);
    };
  }, [active]);
  const activate = async () => {
    try {
      if (typeof window.DeviceOrientationEvent?.requestPermission === "function") {
        const result = await window.DeviceOrientationEvent.requestPermission();
        if (result !== "granted") { setMessage("Tilgang til kompass ble ikke gitt. Åpne hjelp eller bruk kartet."); return; }
      }
      setActive(true);
      setMessage(received.current ? "" : "Venter på kompassdata…");
    } catch { setMessage("Kunne ikke aktivere kompass. Åpne hjelp eller bruk kartet."); }
  };
  const delta = heading == null || bearing == null ? null : (bearing - heading + 540) % 360 - 180;
  const aligned = delta != null && Math.abs(delta) <= 3;
  return <div className="modern-compass">
    <div className={`compass-dial ${aligned ? "aligned" : ""}`}>
      <svg viewBox="0 0 300 300" className="compass-svg" role="img" aria-label={delta == null ? "Kompass venter på sensordata" : `Avvik fra Qibla: ${Math.abs(Math.round(delta))} grader`}>
        <circle cx="150" cy="150" r="143" fill="none" stroke="currentColor" strokeWidth="1.5"/>
        {Array.from({ length:72 },(_,i) => <path key={i} d={`M150 14v${i%6 === 0 ? 13 : 5}`} transform={`rotate(${i*5} 150 150)`} stroke="currentColor" opacity={i%6 === 0 ? .8 : .35}/>) }
        <path d="M150 62v176M62 150h176" stroke="currentColor" opacity=".15"/>
        <g fill="currentColor" fontSize="16" fontFamily="Georgia" textAnchor="middle"><text x="150" y="48">N</text><text x="150" y="263">S</text><text x="42" y="156">V</text><text x="258" y="156">Ø</text></g>
        {delta != null && <g transform={`rotate(${delta} 150 150)`}><path d="m150 59-12 91h24Z" fill="currentColor"/><path d="m138 150 12 60 12-60" fill="currentColor" opacity=".25"/></g>}
        <circle cx="150" cy="150" r="26" fill="var(--card)" stroke="currentColor" strokeWidth="1.5"/>
        <image href="/icons/kaaba.svg" x="135" y="135" width="30" height="30"/>
      </svg>
    </div>
    <p className="hint centered" role="status">{message || (delta == null ? "Aktiver kompasset og hold mobilen flatt." : aligned ? "Du vender mot Qibla" : `Drei ${Math.abs(Math.round(delta))}° mot ${delta > 0 ? "høyre" : "venstre"}`)}</p>
    <div className="compass-actions"><button className="btn btn-gold" onClick={activate}><Icon name="compass" size={18}/>{active ? "Kompass aktivert" : "Aktiver kompass"}</button><button className="text-button" onClick={() => setHelp(true)}>Hjelp</button></div>
    <Dialog open={help} onClose={() => setHelp(false)} title="Få i gang kompasset"><p className="hint">Gi nettleseren tilgang til bevegelse og orientering. Hold mobilen flatt, og flytt deg bort fra metall og magneter.</p><p className="hint">Kalibrer ved å bevege telefonen i et åttetall. På en PC uten kompass kan du bruke kartet.</p><button className="btn" onClick={() => setHelp(false)}>Lukk</button></Dialog>
  </div>;
}
