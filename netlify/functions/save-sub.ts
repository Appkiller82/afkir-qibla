import { getStore } from "@netlify/blobs";

export default async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = await req.json().catch(() => null);
    // accept both keys from frontend/backends
    const sub = body?.sub || body?.subscription || null;
    if (!sub || !sub.endpoint) {
      return new Response(
        'Missing subscription: send JSON { "subscription": {...} } or { "sub": {...} }',
        { status: 400 }
      );
    }

    const store = getStore("subs");
    const key = Buffer.from(sub.endpoint).toString("base64");

    const record = {
      sub,
      lat: body?.lat ?? null,
      lon: body?.lon ?? null,
      tz: body?.tz ?? "Europe/Oslo",
      madhhab: body?.madhhab ?? "maliki",
      createdAt: Date.now(),
      nextFireAt: body?.nextFireAt ?? Date.now() + 5 * 60 * 1000,
    };

    await store.setJSON(key, record);

    return new Response(JSON.stringify({ ok: true, stored: true, id: key }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("save-sub error", err);
    return new Response("save-sub failed", { status: 500 });
  }
};
