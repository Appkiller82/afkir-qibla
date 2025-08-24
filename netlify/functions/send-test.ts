// netlify/functions/send-test.ts
import { Handler } from "@netlify/functions";
import webpush from "web-push";
import fetch from "node-fetch";

// Env (samme navn som før / debug-env.js)
const UP_URL = process.env.UPSTASH_REDIS_REST_URL!;
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;
const VPUB = process.env.VAPID_PUBLIC_KEY!;
const VPRV = process.env.VAPID_PRIVATE_KEY!;
const VSUB = process.env.VAPID_SUBJECT || "mailto:you@example.com";

webpush.setVapidDetails(VSUB, VPUB, VPRV);

// Upstash helper (samme stil som før)
const up = (cmd: string) =>
  fetch(`${UP_URL}/${cmd}`, { headers: { Authorization: `Bearer ${UP_TOKEN}` } });

export const handler: Handler = async (event) => {
  try {
    if (!event.body) return json(400, { error: "Missing body" });

    const { pushSubId, subscription, payload } = JSON.parse(event.body);

    // 1) Finn subscription (direkte eller via pushSubId)
    let sub = subscription as any;
    if (!sub && pushSubId) {
      const r = await up(`hget/subs ${pushSubId}`);
      const raw = await r.text();
      // Upstash REST returnerer { result: "<json>" }
      let stored: any = null;
      try {
        const parsed = JSON.parse(raw);
        stored = parsed?.result ? JSON.parse(parsed.result) : null;
      } catch {}
      sub = stored?.subscription || null;
    }
    if (!sub?.endpoint) return json(400, { error: "Missing subscription" });

    // 2) SEND ALLTID EN PAYLOAD → nødvendig for synlig notif i iOS-bakgrunn
    const body = JSON.stringify(
      payload || {
        title: "Adhan",
        body: "Testvarsel – skal vises også i bakgrunnen",
        url: "/?from=push-test",
        tag: "adhan-test",
      }
    );

    await webpush.sendNotification(sub, body, { TTL: 60 });
    return json(200, { ok: true });
  } catch (e: any) {
    // Rydd døde abonnement (410 Gone)
    const msg = e?.message || String(e);
    const status = (e as any)?.statusCode;
    if (String(status) == "410") {
      try {
        const { pushSubId } = JSON.parse(event.body || "{}");
        if (pushSubId) await up(`hdel/subs ${pushSubId}`);
      } catch {}
    }
    return json(500, { error: msg });
  }
};

function json(status: number, body: any) {
  return {
    statusCode: status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
