// Netlify Functions v2 (ESM). Node 20 har global fetch/Request/Response.
// Proxy'er /v1/times/today til Bonnetid-API og legger på x-api-key server-side.
// Frontend kaller: /.netlify/functions/bt-today?lat=...&lon=...&tz=...

const ALLOWED_ORIGIN = "https://afkirqibla.netlify.app";

export default async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": ALLOWED_ORIGIN,
        "access-control-allow-methods": "GET,OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
      },
    });
  }

  try {
    const url = new URL(req.url);
    const lat = url.searchParams.get("lat");
    const lon = url.searchParams.get("lon");
    const tz  = url.searchParams.get("tz") || "Europe/Oslo";

    if (!lat || !lon) {
      return json(
        { error: "Missing required query params: lat, lon" },
        400
      );
    }

    const upstream = `https://api.bonnetid.no/v1/times/today?lat=${encodeURIComponent(
      lat
    )}&lon=${encodeURIComponent(lon)}&tz=${encodeURIComponent(tz)}`;

    const r = await fetch(upstream, {
      headers: {
        "x-api-key": process.env.VITE_BONNETID_API_KEY as string,
      },
    });

    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: {
        "content-type": r.headers.get("content-type") || "application/json",
        "access-control-allow-origin": ALLOWED_ORIGIN,
        "access-control-allow-headers": "content-type",
      },
    });
  } catch (err: any) {
    return json(
      { error: "Upstream fetch failed", details: String(err?.message || err) },
      502
    );
  }
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": ALLOWED_ORIGIN,
      "access-control-allow-headers": "content-type",
    },
  });
}
