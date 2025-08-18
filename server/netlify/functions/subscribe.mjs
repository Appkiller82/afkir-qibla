import { createClient } from '@netlify/blobs';

export const config = { path: "/api/subscribe" };

export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405, headers: { "content-type": "application/json" }
      });
    }

    const body = await request.json();
    const sub = body?.subscription;
    if (!sub?.endpoint) {
      return new Response(JSON.stringify({ error: "missing subscription" }), {
        status: 400, headers: { "content-type": "application/json" }
      });
    }

    // meta (kan være undefined – går fint)
    const meta = {
      lat: body?.lat,
      lng: body?.lng,
      tz: body?.tz,
      countryCode: body?.countryCode
    };

    // Lag enkel ID av endpoint
    const id = Buffer.from(sub.endpoint).toString("base64url").slice(-24);

    const blobs = createClient();
    await blobs.set(`subs/${id}.json`, JSON.stringify({ id, subscription: sub, ...meta }), {
      contentType: "application/json"
    });

    return new Response(JSON.stringify({ id }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  } catch (e) {
    console.error("subscribe error", e);
    return new Response(JSON.stringify({ error: "server error" }), {
      status: 500, headers: { "content-type": "application/json" }
    });
  }
};
