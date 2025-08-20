// netlify/functions/subscribe.ts
import { getStore } from "@netlify/blobs";

export default async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = await req.json().catch(() => null);
    if (!body?.sub) {
      return new Response("Missing subscription", { status: 400 });
    }

    // Hent butikk for subscriptions
    const store = getStore("subs");

    // Lag nøkkel basert på endpoint (unik ID)
    const key = Buffer.from(body.sub.endpoint).toString("base64");

    // Lagre ekstra info sammen med subscription
    const record = {
      sub: body.sub,
      lat: body.lat ?? null,
      lon: body.lon ?? null,
      tz: body.tz ?? "Europe/Oslo",
      madhhab: body.madhhab ?? "maliki",
      createdAt: Date.now(),
      nextFireAt: 0,
    };

    await store.setJSON(key, record);

    return new Response(JSON.stringify({ ok: true, stored: true, id: key }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("subscribe error", err);
    return new Response("subscribe failed", { status: 500 });
  }
};
