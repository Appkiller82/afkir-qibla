// frontend/src/PushControls.jsx
import React, { useState } from "react";
import { subscribeForPush } from "./push"; // bruker din eksisterende subscribe-funksjon

export default function PushControls() {
  const [status, setStatus] = useState(
    (typeof window !== "undefined" && localStorage.getItem("pushSubId"))
      ? `Lagret ID: ${localStorage.getItem("pushSubId")?.slice(0,10)}…`
      : ""
  );

  async function onEnable() {
    try {
      setStatus("Aktiverer …");

      // 1) Tillatelser
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
      if (Notification.permission !== "granted") {
        throw new Error("Varsler er ikke tillatt.");
      }

      // 2) Posisjon
      const pos = await new Promise((res, rej) => {
        if (!("geolocation" in navigator)) return rej(new Error("Geolokasjon ikke støttet"));
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000 });
      });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      // 3) Service worker
      if (!("serviceWorker" in navigator)) throw new Error("Service Worker ikke støttet");
      const reg = await navigator.serviceWorker.register("/service-worker.js");

      // 4) Abonner (lagres i backend + localStorage av push.ts)
      await subscribeForPush(reg, lat, lng, timezone);

      const id = localStorage.getItem("pushSubId");
      setStatus(id ? `Aktivert. ID: ${id.slice(0,10)}…` : "Aktivert.");
    } catch (e) {
      console.error(e);
      setStatus(`Feil ved aktivering: ${e.message || e}`);
    }
  }

  // Robust "Send test" som prøver flere formater (JSON, raw, query) + optional secret-header
  async function onSend() {
    try {
      setStatus("Sender test …");
      const subId = localStorage.getItem("pushSubId");
      if (!subId) throw new Error("Fant ikke pushSubId i localStorage. Aktiver push først.");

      const secret = import.meta.env.VITE_CRON_SECRET;

      // 1) POST JSON
      let res = await fetch("/.netlify/functions/send-test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(secret ? { "x-cron-secret": secret } : {})
        },
        body: JSON.stringify({ subId })
      });

      // 2) POST raw text
      if (!res.ok) {
        res = await fetch("/.netlify/functions/send-test", {
          method: "POST",
          headers: {
            "content-type": "text/plain",
            ...(secret ? { "x-cron-secret": secret } : {})
          },
          body: subId
        });
      }

      // 3) GET med query
      if (!res.ok) {
        const url = "/.netlify/functions/send-test?subId=" + encodeURIComponent(subId);
        res = await fetch(url, {
          headers: {
            ...(secret ? { "x-cron-secret": secret } : {})
          }
        });
      }

      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}${text ? ` – ${text}` : ""}`);

      setStatus(`Sendt: ${text || "OK"}`);
    } catch (e) {
      console.error(e);
      setStatus(`Send-test feilet: ${e.message || e}`);
    }
  }

  async function onDisable() {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      await sub?.unsubscribe();
    } catch {}
    localStorage.removeItem("pushSubId");
    setStatus("Skrudd av lokalt.");
  }

  return (
    <div className="space-x-2">
      <button className="btn" onClick={onEnable}>Aktiver push</button>
      <button className="btn" onClick={onSend}>Send test</button>
      <button className="btn" onClick={onDisable}>Skru av</button>
      <div style={{ marginTop: 8, opacity: 0.8 }}>
        {status || "Ingen lagret ID"}
      </div>
    </div>
  );
}
