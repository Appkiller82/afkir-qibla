import { Redis } from "@upstash/redis";
import type { Handler } from "@netlify/functions";

const redis = Redis.fromEnv();

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { subscription, coords, city, countryCode, tz } = JSON.parse(event.body || "{}");

    if (!subscription?.endpoint) {
      return { statusCode: 400, body: "Invalid subscription" };
    }

    const id = subscription.endpoint;
    const subKey = `sub:${id}`;
    const allKey = `subs:all`;

    const geoBucket = coords
      ? `subs:geo:${tz || "unknown"}:${Math.round(coords.lat * 100) / 100}:${Math.round(coords.lon * 100) / 100}`
      : null;

    await redis.hmset(subKey, {
      payload: JSON.stringify(subscription),
      city: city || "",
      country: countryCode || "",
      tz: tz || "",
      createdAt: Date.now(),
    });

    await redis.sadd(allKey, id);
    if (geoBucket) await redis.sadd(geoBucket, id);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, id }),
    };
  } catch (err) {
    console.error("subscribe error", err);
    return { statusCode: 500, body: "Subscribe failed" };
  }
};
