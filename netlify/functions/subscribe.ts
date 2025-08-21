// netlify/functions/subscribe.ts
import type { Handler } from "@netlify/functions"
import webpush from "web-push"

const UP_URL   = process.env.UPSTASH_REDIS_REST_URL || ""
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || ""

const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || ""
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || ""
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT || "mailto:push@example.com"

async function redis(cmd: any) {
  if (!UP_URL || !UP_TOKEN) return { ok: false, skipped: true }
  const res = await fetch(UP_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${UP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
  })
  const txt = await res.text()
  try { return JSON.parse(txt) } catch { return { error: txt, status: res.status } }
}

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod === "GET") {
      // Vapids for client (anti-slice fix)
      const wantVapid = event.queryStringParameters?.vapid
      if (wantVapid) {
        if (!VAPID_PUBLIC_KEY) return { statusCode: 404, body: JSON.stringify({ error: "no-public-key" }) }
        return { statusCode: 200, body: JSON.stringify({ publicKey: VAPID_PUBLIC_KEY }) }
      }
      return { statusCode: 200, body: "ok" }
    }

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "method not allowed" }
    }

    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    }

    const body = event.body ? JSON.parse(event.body) : {}
    const sub = body.subscription
    const meta = body.meta || {}

    if (!sub || !sub.endpoint) {
      return { statusCode: 400, body: "missing subscription" }
    }

    // Persist basic info if Upstash is configured
    if (UP_URL && UP_TOKEN) {
      const id = Buffer.from(sub.endpoint).toString("base64url")
      const key = `sub:${id}`
      const hset = ["HSET", key,
        "endpoint", sub.endpoint,
        "keys", JSON.stringify(sub.keys || {}),
        "active", "1",
        "lat", meta.lat ? String(meta.lat) : "",
        "lng", meta.lng ? String(meta.lng) : "",
        "city", meta.city || "",
        "countryCode", meta.countryCode || "",
        "tz", meta.tz || "",
      ]
      await redis(hset)
      await redis(["SADD", "subs:all", id])
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) }
  } catch (e: any) {
    console.error("subscribe error:", e?.message || e)
    return { statusCode: 500, body: e?.message || "subscribe failed" }
  }
}
