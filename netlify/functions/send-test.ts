import webpush from "web-push";
import { getStore } from "@netlify/blobs";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:aa@cmmco.no",
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export default async (req: Request) => {
  try {
    const body = await req.json().catch(() => ({}));
    const sub = body?.sub || body?.subscription || null;

    let useSub = sub;
    if (!useSub) {
      // fallback: pick the first stored subscription
      const store = getStore("subs");
      const list: any = await store.list();
      const keys: string[] =
        (list?.blobs?.map((b: any) => b.key) ??
          list?.blobKeys ??
          []).filter(Boolean);

      if (!keys.length) {
        return new Response(
          'Missing subscription: send JSON { "subscription": {...} }',
          { status: 400 }
        );
      }
      const rec = await store.get(keys[0], { type: "json" });
      useSub = rec?.sub || null;
      if (!useSub?.endpoint) {
        return new Response("Stored subscription is invalid", { status: 400 });
      }
    }

    const payload = JSON.stringify({
      title: "Testvarsel",
      body: "Dette er en test av push-varsler 🚀",
    });

    await webpush.sendNotification(useSub, payload);

    return new Response(JSON.stringify({ ok: true, message: "Test push sendt!" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("send-test error", err);
    return new Response("send-test failed", { status: 500 });
  }
};
