import { createClient } from "@netlify/blobs";

export const config = { path: "/api/unsubscribe" };

export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405, headers: { "content-type": "application/json" }
      });
    }
    const { id } = await request.json();
    if (!id) {
      return new Response(JSON.stringify({ error: "missing id" }), {
        status: 400, headers: { "content-type": "application/json" }
      });
    }
    const blobs = createClient();
    await blobs.delete(`subs/${id}.json`).catch(() => {});
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  } catch (e) {
    console.error("unsubscribe error", e);
    return new Response(JSON.stringify({ error: "server error" }), {
      status: 500, headers: { "content-type": "application/json" }
    });
  }
};
