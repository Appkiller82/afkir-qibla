import { Redis } from "@upstash/redis";
import webpush from "web-push";
import type { Handler } from "@netlify/functions";

const redis = Redis.fromEnv();

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { title = "Qibla melding", body = "", url = "https://afkirqibla.netlify.app/" } = JSON.parse(event.body || "{}");

    const allKey = "subs:all";
    const ids: string[] = await redis.smembers(allKey);

    let sent = 0;
    let removed = 0;

    for (const id of ids) {
      const subHashKey = `sub:${id}`;
      const data = await redis.hget<string>(subHashKey, "payload");
      if (!data) {
        await redis.srem(allKey, id);
        removed++;
        continue;
      }

      const subscription = JSON.parse(data);

      try {
        await webpush.sendNotification(
          subscription,
          JSON.stringify({ title, body, url })
        );
        sent++;
      } catch (e: any) {
        const status = e?.statusCode ?? e?.status;
        if (status === 404 || status === 410) {
          await redis.srem(allKey, id);
          await redis.del(subHashKey);
          removed++;
        } else {
          console.error("send error", status, e?.message);
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, sent, removed, totalBefore: ids.length }),
    };
  } catch (err) {
    console.error("send-all error", err);
    return { statusCode: 500, body: "Send failed" };
  }
};
