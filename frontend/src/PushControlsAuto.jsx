// frontend/src/PushControlsAuto.jsx
import React, { useState } from "react";
import { registerWithMetadata, sendTest, unsubscribe } from "./push";

export default function PushControlsAuto({ coords, city, countryCode, tz }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const subId = (() => { try { return localStorage.getItem("pushSubId"); } catch { return null; } })();

  async function onEnable() {
    if (!coords) {
      setStatus("Mangler posisjon. Trykk 'Bruk stedstjenester' først.");
      return;
    }
    setStatus("Aktiverer …");
    setBusy(true);
    try {
      const ok = await registerWithMetadata({
        lat: coords.latitude,
        lng: coords.longitude,
        city,
        countryCode,
        tz,
        mode: "auto",
        savedAt: Date.now(),
      });
      setStatus(ok ? "Aktivert!" : "Kunne ikke aktivere");
    } catch (e) {
      console.error(e);
      setStatus("Feil ved aktivering (se konsoll)");
    } finally { setBusy(false); }
  }

  async function onSend() {
    setStatus("Sender test …");
    setBusy(true);
    const ok = await sendTest();
    setStatus(ok ? "Testvarsel sendt." : "Kunne ikke sende testvarsel.");
    setBusy(false);
  }

  async function onDisable() {
    setBusy(true);
    try {
      const ok = await unsubscribe();
      if (!ok) { setStatus("Kunne ikke skru av varsler. Prøv igjen."); return; }
      try { localStorage.removeItem("pushSubId"); } catch {}
      setStatus("Push-varsler er skrudd av.");
    } catch (e) {
      console.error(e);
      setStatus("Feil ved avskrudd");
    } finally { setBusy(false); }
  }

  return (
    <div className="push-controls">
      <button className="btn" disabled={busy} onClick={onEnable}>Aktiver push</button>
      <button className="btn" disabled={busy} onClick={onSend}>Send test</button>
      <button className="btn" disabled={busy} onClick={onDisable}>Skru av</button>
      <div className="push-status">
        {subId ? "Varsler er registrert på denne enheten." : "Varsler er ikke registrert på denne enheten."}
      </div>
      <div className="push-status" role="status">{status}</div>
    </div>
  );
}
