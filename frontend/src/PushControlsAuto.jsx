// frontend/src/PushControlsAuto.jsx
import React, { useState } from "react";
import { registerWithMetadata, sendTest, getEndpointInfo, getEndpointInfo } from "./push";

export default function PushControlsAuto({ coords, city, countryCode, tz }) {
  const [status, setStatus] = useState("");
  const subId = (typeof window !== "undefined" && localStorage.getItem("pushSubId")) || null;

  async function onEnable() {
    if (!coords) {
      setStatus("Mangler posisjon. Trykk 'Bruk stedstjenester' først.");
      return;
    }
    setStatus("Aktiverer …");
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
    }
  }

  async function onSend() {
    setStatus("Sender test …");
    const ok = await sendTest();
    setStatus("Sendt: " + String(ok));
  }

  async function onDisable() {
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
      localStorage.removeItem("pushSubId");
      setStatus("Skrudd av");
    } catch (e) {
      console.error(e);
      setStatus("Feil ved avskrudd");
    }
  }

  async function onDebug() {
    try {
      const info = await getEndpointInfo();
      alert(`Apple endpoint: ${info.endpointIsApple}\n${info.endpoint || 'no subscription'}`);
    } catch (e) {
      alert('Debug fail: ' + (e?.message || e));
    }
  }

  return (
    <div className="space-x-2">
      <button onClick={onEnable}>Aktiver push (auto)</button>
      <button onClick={onSend}>Send test</button>
      <button onClick={onDisable}>Skru av</button>
      <button onClick={onDebug}>Vis push-debug</button>
      <div style={{ marginTop: 8, opacity: 0.8 }}>
        {subId ? `Lagret ID: ${String(subId).slice(0, 10)}…` : "Ingen lagret ID"}
      </div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>{status}</div>
    </div>
  );
}
