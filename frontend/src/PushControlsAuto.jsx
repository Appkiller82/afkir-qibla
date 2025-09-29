import { useState } from "react";
import { subscribeForPush } from "./push";

export default function PushControlsAuto() {
  const [status, setStatus] = useState("");

  async function handleSubscribe() {
    try {
      // 1) Hent posisjon
      const pos = await new Promise((resolve, reject) => {
        if (!("geolocation" in navigator)) return reject(new Error("Geolokasjon ikke støttet"));
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 });
      });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      // 2) Hent timezone
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      // 3) Registrer service worker (om ikke allerede registrert)
      if (!("serviceWorker" in navigator)) throw new Error("Service Worker ikke støttet i denne nettleseren");
      const reg = await navigator.serviceWorker.register("/service-worker.js");

      // 4) Abonner (lagrer sub + lat/lng/tz i backend)
      await subscribeForPush(reg, lat, lng, timezone);

      setStatus(`Abonnement opprettet for ${lat.toFixed(2)}, ${lng.toFixed(2)} (${timezone})`);
    } catch (err) {
      console.error("Subscription feilet:", err);
      setStatus("Kunne ikke opprette push-abonnement. Sjekk tillatelser for varsler og posisjon.");
    }
  }

  return (
    <div>
      <button onClick={handleSubscribe}>
        Abonner på bønnetidsvarsler
      </button>
      {status && <p>{status}</p>}
    </div>
  );
}
