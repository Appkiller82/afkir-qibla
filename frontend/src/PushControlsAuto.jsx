// frontend/src/PushControlsAuto.jsx
import React, { useState } from "react";
import { registerWithMetadata, sendTest } from "./push";

export default function PushControlsAuto({ coords, city, countryCode, tz }) {
  const [status, setStatus] = useState("");
  const subId =
    (typeof window !== "undefined" && localStorage.getItem("pushSubId")) || null;

  async function onEnable() {
    if (!coords) {
      setStatus("Mangler posisjon. Trykk 'Bruk stedstjenester' først.");
      return;
    }
    setStatus("Aktiverer …");
    try {
      const id = await registerWithMetadata({
        lat: coords.latitude,
        lng: coords.longitude,
        city,
        countryCode,
        tz,
      });
      setStatus(`Aktivert. ID: ${id.slice(0, 10)}…`);
    } catch (e) {
      console.error(e);
      setStatus(`Feil ved aktivering: ${e.message}`);
    }
  }

  async function onSend() {
    setStatus("Sender test …");
    try {
      const msg = await sendTest();
      setStatus(`Sendt: ${msg}`);
    } catch (e) {
      console.error(e);
      setStatus(`Send-test feilet: ${e.message}`);
    }
  }

  function onDisable() {
    localStorage.removeItem("pushSubId");
    setStatus("Skrudd av lokalt.");
  }

  return (
    <div className="space-x-2">
      <button onClick={onEnable}>Aktiver push (auto)</button>
      <button onClick={onSend}>Send test</button>
      <button onClick={onDisable}>Skru av</button>
      <div style={{ marginTop: 8, opacity: 0.8 }}>
        {status ||
          (subId
            ? `Lagret ID: ${subId.slice(0, 10)}…`
            : "Ingen lagret ID")}
      </div>
    </div>
  );
}
