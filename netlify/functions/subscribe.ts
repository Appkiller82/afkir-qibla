import type { Handler } from "@netlify/functions";

const UP_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || "";

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

function b64url(str: string) {
  return Buffer.from(String(str))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function upstash(cmds: (string | number)[][]) {
  if (!UP_URL || !UP_TOKEN) throw new Error("Upstash creds missing");
  const res = await fetch(`${UP_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UP_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status} ${await res.text()}`);
  return res.json();
}

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod === "GET") {
      if (event.queryStringParameters && "vapid" in event.queryStringParameters) {
        return VAPID_PUBLIC_KEY
          ? json(200, { publicKey: VAPID_PUBLIC_KEY })
          : json(404, { error: "VAPID public key not set" });
      }
      return json(200, { ok: true });
    }

    if (event.httpMethod !== "POST") return json(405, "Method Not Allowed");
    if (!event.body) return json(400, "Missing body");

    let parsed: any;
    try {
      parsed = JSON.parse(event.body);
    } catch (e) {
      console.error("[subscribe] bad json:", e);
      return json(400, "Bad JSON");
    }

    const { subscription, meta } = parsed || {};
    if (!subscription || !subscription.endpoint) {
      console.error("[subscribe] invalid subscription payload:", parsed);
      return json(400, "Invalid subscription");
    }

    const id = b64url(subscription.endpoint);
    const tz =
      (meta && meta.tz) ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "UTC";

    try {
      const cmds: (string | number)[][] = [
        ["SADD", "subs:all", id],
        [
          "HSET",
          `sub:${id}`,
          "endpoint",
          String(subscription.endpoint),
          "keys",
          JSON.stringify(subscription.keys || {}),
          "active",
          "1",
          "tz",
          String(tz),
          "updatedAt",
          String(Date.now()),
        ],
      ];
      if (meta && typeof meta === "object") {
        if (typeof meta.lat === "number" && typeof meta.lng === "number") {
          cmds.push([
            "HSET",
            `sub:${id}`,
            "lat",
            String(meta.lat),
            "lng",
            String(meta.lng),
          ]);
        }
        if (meta.city) cmds.push(["HSET", `sub:${id}`, "city", String(meta.city)]);
        if (meta.countryCode)
          cmds.push([
            "HSET",
            `sub:${id}`,
            "countryCode",
            String(meta.countryCode),
          ]);
        if (meta.mode)
          cmds.push(["HSET", `sub:${id}`, "mode", String(meta.mode)]);
      }
      await upstash(cmds);
    } catch (e: any) {
      console.error("[subscribe] upstash error:", e?.message || e);
    }

    return json(200, { ok: true, id });
  } catch (err: any) {
    console.error("[subscribe] fatal:", err?.message || err);
    return json(200, { ok: true, note: "soft-errored" });
  }
};
