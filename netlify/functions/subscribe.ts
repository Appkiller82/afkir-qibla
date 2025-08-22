
// netlify/functions/subscribe.ts
import type { Handler } from "@netlify/functions";

type Subscription = {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
};

function hashId(endpoint: string): string {
  // simple stable id from endpoint
  const data = new TextEncoder().encode(endpoint);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 16777619);
  }
  return "sub_" + (h >>> 0).toString(16);
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  let body: any = {};
  try { body = JSON.parse(event.body || "{}"); } catch {}

  const { subscription, pushSubId, onlyUpdate, ...meta } = body;

  try {
    // Resolve or create id
    let id = pushSubId as string | undefined;
    if (!id && subscription?.endpoint) id = hashId(subscription.endpoint);

    if (!id) {
      return { statusCode: 400, body: 'Missing "subscription" or "pushSubId"' };
    }

    // If Upstash is configured, persist/merge
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (url && token) {
      // store payload under key id
      const payload: any = { id, updatedAt: Date.now(), ...meta };
      if (subscription) payload.subscription = subscription;
      // Merge existing if any
      await fetch(`${url}/set/${id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, id }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "subscribe failed" };
  }
};
