// netlify/functions/send-test.ts — force sound-friendly notifications
import type { Handler } from "@netlify/functions";
import webpush from "web-push";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  let body: any = {};
  try { body = JSON.parse(event.body || "{}"); } catch {}
  const { subscription, pushSubId } = body;

  try {
    const publicKey = process.env.VAPID_PUBLIC_KEY || "";
    const privateKey = process.env.VAPID_PRIVATE_KEY || "";
    if (!publicKey || !privateKey) return { statusCode: 500, body: "VAPID keys missing" };
    webpush.setVapidDetails("mailto:example@example.com", publicKey, privateKey);

    // Resolve subscription
    let sub: any = subscription;
    if (!sub) {
      const url = process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.UPSTASH_REDIS_REST_TOKEN;
      if (url && token && pushSubId) {
        const res = await fetch(`${url}/get/${pushSubId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const json = await res.json().catch(() => null);
          if (json && json.result) {
            try { sub = JSON.parse(json.result).subscription; } catch {}
          }
        }
      }
    }
    if (!sub) return { statusCode: 400, body: 'Missing "subscription" or "pushSubId"' };

    // Unik tag + requireInteraction + timestamp for bedre lyd/synlighet i Chrome/Windows
    const payload = JSON.stringify({
      title: "Afkir Qibla",
      body: "Testvarsel — det fungerer!",
      url: "/",
      tag: "test-" + Date.now(),
      renotify: true,
      requireInteraction: true,
      timestamp: Date.now()
      // NB: ingen custom sound i Web Push (ikke støttet), OS spiller standardlyd
    });

    await webpush.sendNotification(sub, payload);
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: true }) };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "send-test failed" };
  }
};
