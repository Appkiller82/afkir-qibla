import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function handler(event: any) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { subscription, lat, lng, timezone } = body;

    if (!subscription || !subscription.endpoint) {
      return { statusCode: 400, body: "Invalid subscription" };
    }

    // Normalize shape we store
    const record = {
      subscription,
      lat: typeof lat === "number" ? lat : null,
      lng: typeof lng === "number" ? lng : null,
      timezone: typeof timezone === "string" ? timezone : null,
      createdAt: Date.now(),
    };

    // Avoid duplicates: use endpoint as a set key
    const key = `sub:${subscription.endpoint}`;
    await redis.set(key, JSON.stringify(record));
    await redis.sadd("subscriptions:set", key); // set of keys

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e: any) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
}
