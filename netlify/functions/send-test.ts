// netlify/functions/send-test.ts
import webpush from "web-push";
import { getStore } from "@netlify/blobs";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:aa@cmmco.no",
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export default async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = await req.json().catch(() => null);
    // Accept both shapes for safety
    let sub = body?.sub || body?.subscription || null;

    // If not provided, try last stored sub from Blobs (handy for quick tests)
    if (!sub) {
      try {
        const store = getStore("subs");
        const list = await store.list();
        const lastKey = list.blobs?.at(-1)?.key || list.blobKeys?.at(-1); // compat
        if (lastKey) {
          const rec = await store.get(lastKey, { type: "json" });
          sub = rec?.sub ?? null;
        }
      } catch {}
    }

    if (!sub || !sub.endpoint) {
      return new Response(
        'Missing subscription: send JSON { "sub": { ... } }',
        { status: 400 }
      );
    }

    const payload = JSON.stringify({
      title: "Test Push",
      body: "Dette er et testvarsel fra send-test.ts 🚀",
    });

    await webpush.sendNotification(sub, payload);

    return new Response(
      JSON.stringify({ ok: true, message: "Test push sendt!" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    console.error("send-test error", err);
    return new Response("send-test failed", { status: 500 });
  }
};
