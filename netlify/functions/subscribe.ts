// netlify/functions/subscribe.ts
import { getStore } from "@netlify/blobs";

export default async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = await req.json().catch(() => null);
    const sub = body?.sub || body?.subscription || null;

    if (!sub || !sub.endpoint) {
      return new Response(
        'Bad Request: missing "sub". Send JSON { "sub": { ... } }',
        { status: 400 }
      );
    }

    const store = getStore("subs");

    // stable key per endpoint
    const key = Buffer.from(sub.endpoint).toString("base64");

    const record = {
      sub,
      lat: body?.lat ?? null,
      lon: body?.lon ?? null,
      tz: body?.tz ?? "Europe/Oslo",
      madhhab: body?.madhhab ?? "maliki",
      createdAt: Date.now(),
      // if client didn’t compute one yet, set a safe near‑future placeholder
      nextFireAt: body?.nextFireAt ?? Date.now() + 5 * 60 * 1000,
    };

    await store.setJSON(key, record);

    return new Response(
      JSON.stringify({ ok: true, stored: true, id: key }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    console.error("subscribe error", err);
    // Don’t throw—always return a Response so Netlify doesn’t emit 502
    return new Response("subscribe failed", { status: 500 });
  }
};
