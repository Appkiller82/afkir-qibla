import webpush from "web-push";
import { createClient } from "@netlify/blobs";

const PUB  = process.env.VAPID_PUBLIC_KEY;
const PRIV = process.env.VAPID_PRIVATE_KEY;
const SUBJ = process.env.VAPID_SUBJECT || "mailto:you@example.com";
webpush.setVapidDetails(SUBJ, PUB, PRIV);

export const config = { path: "/api/send-test" };

export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405, headers: { "content-type": "application/json" }
      });
    }
    const { id } = await request.json();
    if (!id) {
      return new Response(JSON.stringify({ error: "missing id" }), {
        status: 400, headers: { "content-type": "application/json" }
      });
    }

    const blobs = createClient();
    const raw = await blobs.get(`subs/${id}.json`);
    if (!raw) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404, headers: { "content-type": "application/json" }
      });
    }
    const rec = await raw.json();           // { id, subscription, lat, lng, tz, countryCode }
    const subscription = rec.subscription;  // <- viktig

    const payload = JSON.stringify({
      title: "Afkir Qibla",
      body: "Test-varsel fungerer ✅",
      url: "/",
      icon: "/icons/apple-touch-icon.png"
    });

    await webpush.sendNotification(subscription, payload);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  } catch (e) {
    if (e?.statusCode === 410 || e?.statusCode === 404) {
      try {
        const blobs = createClient();
        const { id } = await request.json().catch(() => ({}));
        if (id) await blobs.delete(`subs/${id}.json`).catch(() => {});
      } catch {}
      return new Response(JSON.stringify({ error: "gone" }), {
        status: 410, headers: { "content-type": "application/json" }
      });
    }
    console.error("send-test error", e);
    return new Response(JSON.stringify({ error: "server error" }), {
      status: 500, headers: { "content-type": "application/json" }
    });
  }
};
