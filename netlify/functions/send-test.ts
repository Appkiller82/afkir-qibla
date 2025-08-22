
// netlify/functions/send-test.ts
import type { Handler } from "@netlify/functions";
import webpush from "web-push";

const UP_URL  = process.env.UPSTASH_REDIS_REST_URL || "";
const UP_TOK  = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const VAPID_PUB  = process.env.VAPID_PUBLIC_KEY  || process.env.VITE_VAPID_PUBLIC_KEY || "";
const VAPID_PRIV = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJ = process.env.VAPID_SUBJECT     || "mailto:admin@example.com";

type SubJSON = { endpoint: string; keys: { p256dh: string; auth: string } };

async function redisSingle(cmd: string[]) {
  if (!UP_URL || !UP_TOK) throw new Error("Upstash not configured");
  const res = await fetch(UP_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${UP_TOK}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) {
    const t = await res.text().catch(()=>String(res.status));
    throw new Error(`Redis ${res.status} ${t}`);
  }
  return res.json() as Promise<any>;
}
async function redisPipe(cmds: string[][]) {
  if (!UP_URL || !UP_TOK) throw new Error("Upstash not configured");
  const res = await fetch(`${UP_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${UP_TOK}`, "content-type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) {
    const t = await res.text().catch(()=>String(res.status));
    throw new Error(`RedisPipe ${res.status} ${t}`);
  }
  return res.json() as Promise<any>;
}

async function getSubscriptionFromId(id: string): Promise<SubJSON | null> {
  if (!id) return null;
  // Fetch endpoint and keys via pipeline to avoid parsing ambiguity
  const resp = await redisPipe([
    ["HGET", `sub:${id}`, "endpoint"],
    ["HGET", `sub:${id}`, "keys"],
  ]);
  const endpoint = resp?.[0]?.result || resp?.[0];
  const keysStr  = resp?.[1]?.result || resp?.[1];
  if (!endpoint || !keysStr) return null;
  let keys: any = null;
  try { keys = JSON.parse(keysStr); } catch {}
  if (!keys || !keys.p256dh || !keys.auth) return null;
  return { endpoint, keys };
}

function ensureVapid() {
  if (!VAPID_PUB || !VAPID_PRIV) {
    throw new Error("VAPID keys not set");
  }
  webpush.setVapidDetails(VAPID_SUBJ, VAPID_PUB, VAPID_PRIV);
}

async function sendToSub(sub: SubJSON, title?: string, body?: string, url?: string) {
  ensureVapid();
  const payload = JSON.stringify({
    title: title || "Test",
    body:  body  || "Dette er en test",
    url:   url   || "/",
  });
  return webpush.sendNotification(sub as any, payload);
}

export const handler: Handler = async (event) => {
  try {
    // GET ?id=<pushSubId> for quick manual tests
    if (event.httpMethod === "GET") {
      const id = event.queryStringParameters?.id;
      if (!id) {
        return { statusCode: 400, body: 'Missing body. Use POST with JSON {"subscription":{...}} or GET ?id=<pushSubId>' };
      }
      const sub = await getSubscriptionFromId(id);
      if (!sub) {
        return { statusCode: 404, body: "Subscription not found for id" };
      }
      await sendToSub(sub);
      return { statusCode: 200, body: JSON.stringify({ ok: true, via: "GET?id", id }) };
    }

    // POST: expect JSON
    if (!event.body) {
      return { statusCode: 400, body: "Missing body" };
    }
    let data: any = null;
    try { data = JSON.parse(event.body); } catch {
      return { statusCode: 400, body: "Invalid JSON" };
    }

    // Priority: subscription object
    if (data?.subscription?.endpoint && data?.subscription?.keys) {
      const sub: SubJSON = data.subscription;
      await sendToSub(sub, data?.title, data?.body, data?.url);
      return { statusCode: 200, body: JSON.stringify({ ok: true, via: "POST:subscription" }) };
    }

    // Or pushSubId (fetch from Upstash)
    if (typeof data?.pushSubId === "string" && data.pushSubId.length > 10) {
      const sub = await getSubscriptionFromId(data.pushSubId);
      if (!sub) return { statusCode: 404, body: "Subscription not found for pushSubId" };
      await sendToSub(sub, data?.title, data?.body, data?.url);
      return { statusCode: 200, body: JSON.stringify({ ok: true, via: "POST:pushSubId" }) };
    }

    return { statusCode: 400, body: "Missing \"subscription\" or \"pushSubId\"" };
  } catch (e: any) {
    console.error("send-test error:", e?.message || e);
    return { statusCode: 500, body: e?.message || "Unknown error" };
  }
};
