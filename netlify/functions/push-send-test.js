// netlify/functions/push-send-test.js
import webpush from "web-push";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEYS = [
  process.env.SUBSCRIPTIONS_KEY || "push:subs",
  "subscriptions",
  "aq:subs",
  "push_subscriptions",
];

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function redis(cmd, ...args) {
  const url = `${REDIS_URL}/${cmd}/${args.map(encodeURIComponent).join("/")}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
  if (!res.ok) throw new Error(`Redis ${cmd} failed: ${res.status}`);
  return res.json();
}

async function loadAllSubscriptions() {
  // Prøv set → list → hash på flere nøkler
  const subs = [];
  for (const key of KEYS) {
    // Set
    try {
      const { result } = await redis("smembers", key);
      if (Array.isArray(result)) subs.push(...result);
    } catch {}
    // List
    try {
      const { result } = await redis("lrange", key, 0, -1);
      if (Array.isArray(result)) subs.push(...result);
    } catch {}
    // Hash (lagret som hset key <endpoint> <json>)
    try {
      const { result } = await redis("hgetall", key);
      if (Array.isArray(result)) {
        for (let i = 0; i < result.length; i += 2) subs.push(result[i + 1]);
      }
    } catch {}
  }
  // Fjern duplikater
  return Array.from(new Set(subs));
}

export async function handler(event) {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const payload = JSON.stringify({
      title: body.title || "Test fra Qibla 🚀",
      body: body.body || "Manuelt pushvarsel",
    });

    const subsRaw = await loadAllSubscriptions();
    if (!subsRaw.length) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, sent: 0, removed: 0, msg: "Ingen subscriptions funnet" }) };
    }

    let sent = 0, removed = 0;
    await Promise.all(subsRaw.map(async (entry) => {
      try {
        const sub = typeof entry === "string" ? JSON.parse(entry) : entry;
        await webpush.sendNotification(sub, payload);
        sent++;
      } catch (err) {
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          removed++;
          // Prøv å slette fra alle mulige nøkler
          await Promise.all(KEYS.map(k => redis("srem", k, entry).catch(()=>{})));
          await Promise.all(KEYS.map(k => redis("lrem", k, 0, entry).catch(()=>{})));
          // For hash – må ha endpoint som field; hopper over hvis ukjent
        } else {
          console.error("Send error:", err);
        }
      }
    }));

    return { statusCode: 200, body: JSON.stringify({ ok: true, sent, removed }) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
}
