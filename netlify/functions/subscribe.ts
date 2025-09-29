// netlify/functions/subscribe.ts
import type { Handler } from "@netlify/functions";

const UP_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || "";

function b64url(str: string) {
  return Buffer.from(str).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/,"");
}

async function redisSingle(cmd: (string|number)[]) {
  if (!UP_URL || !UP_TOKEN) return { ok: false, skipped: true };
  const res = await fetch(UP_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${UP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) {
    const t = await res.text().catch(()=>`${res.status}`);
    throw new Error(`Redis ${res.status} ${t}`);
  }
  return await res.json();
}
async function redisMany(cmds: (string|number)[][]) {
  if (!UP_URL || !UP_TOKEN) return { ok: false, skipped: true };
  const res = await fetch(`${UP_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${UP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) {
    const t = await res.text().catch(()=>`${res.status}`);
    throw new Error(`RedisPipe ${res.status} ${t}`);
  }
  return await res.json();
}

export const handler: Handler = async (event) => {
  try {
    // GET ?vapid=1 → expose public key to clients that don't have VITE_ set
    if (event.httpMethod === "GET") {
      if (event.queryStringParameters && "vapid" in event.queryStringParameters) {
        if (VAPID_PUBLIC_KEY) {
          return { statusCode: 200, body: JSON.stringify({ publicKey: VAPID_PUBLIC_KEY }) };
        }
        return { statusCode: 404, body: JSON.stringify({ error: "VAPID public key not set" }) };
      }
      return { statusCode: 200, body: "ok" };
    }

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    if (!event.body) return { statusCode: 400, body: "Missing body" };

    const { subscription, meta } = JSON.parse(event.body);
    if (!subscription || !subscription.endpoint) {
      return { statusCode: 400, body: "Invalid subscription" };
    }

    const id = b64url(subscription.endpoint);
    const tz = (meta && meta.tz) || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    // Always add to set + ensure a hash exists with minimal fields
    const cmds: (string|number)[][] = [
      ["SADD", "subs:all", id],
      ["HSET", `sub:${id}`,
        "endpoint", String(subscription.endpoint),
        "keys", JSON.stringify(subscription.keys || {}),
        "active", "1",
        "tz", String(tz),
        "updatedAt", String(Date.now())
      ]
    ];

    // If meta provided, enrich the hash
    if (meta && typeof meta === "object") {
      if (typeof meta.lat === "number" && typeof meta.lng === "number") {
        cmds.push(["HSET", `sub:${id}`, "lat", String(meta.lat), "lng", String(meta.lng)]);
      }
      if (meta.city) cmds.push(["HSET", `sub:${id}`, "city", String(meta.city)]);
      if (meta.countryCode) cmds.push(["HSET", `sub:${id}`, "countryCode", String(meta.countryCode)]);
      if (meta.mode) cmds.push(["HSET", `sub:${id}`, "mode", String(meta.mode)]);
    }

    try {
      await redisMany(cmds);
    } catch (e) {
      // Be tolerant: do not fail activation if Redis has issues
      console.error("subscribe: redis error", (e as any)?.message || e);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, id }),
      headers: { "content-type": "application/json" }
    };
  } catch (err:any) {
    console.error("subscribe failed:", err?.message || err);
    return { statusCode: 500, body: err?.message || "subscribe failed" };
  }
};
