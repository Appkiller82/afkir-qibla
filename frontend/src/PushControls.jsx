// PushControls.jsx
import React, { useEffect, useState } from "react";
import { subscribeToPush, unsubscribeFromPush, sendTestPush } from "./push";

export default function PushControls() {
  const [status, setStatus] = useState("");

  // Registrer service worker riktig (må ligge i /public/service-worker.js)
  useEffect(() => {
    (async () => {
      try {
        if (!('serviceWorker' in navigator)) {
          setStatus('Service worker støttes ikke i denne nettleseren');
          return;
        }
        if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
          setStatus('Push krever HTTPS (eller localhost)');
          return;
        }
        // NB: riktig sti + scope
        const reg = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
        await navigator.serviceWorker.ready; // vent til aktiv
        // valgfritt: gi en liten bekreftelse
        if (reg?.active) setStatus(s => s || 'Service worker aktiv');
      } catch (e) {
        console.error(e);
        setStatus('Kunne ikke registrere service worker');
      }
    })();
  }, []);

  async function handleSubscribe() {
    try {
      let coords = {};
      if (navigator.geolocation) {
        try {
          const pos = await new Promise((res, rej) =>
            navigator.geolocation.getCurrentPosition(res, rej, { timeout: 4000 })
          );
          coords = pos.coords || {};
        } catch {}
      }
      const extra = {
        lat: coords.latitude,
        lng: coords.longitude,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      const id = await subscribeToPush(extra);
      setStatus(`Aktivert (id: ${id})`);
    } catch (e) {
      setStatus(e.message || "Feil");
    }
  }

  async function handleTest() {
    try {
      await sendTestPush();
      setStatus("Test sendt");
    } catch (e) {
      setStatus(e.message || "Feil");
    }
  }

  async function handleUnsub() {
    try {
      await unsubscribeFromPush();
      setStatus("Deaktivert");
    } catch (e) {
      setStatus(e.message || "Feil");
    }
  }

  return (
    <div style={{ display: "grid", gap: 8, padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}>
      <strong>Pushvarsler</strong>
      <button onClick={handleSubscribe}>Aktiver push</button>
      <button onClick={handleTest}>Send test</button>
      <button onClick={handleUnsub}>Skru av push</button>
      <small>{status}</small>
    </div>
  );
}
