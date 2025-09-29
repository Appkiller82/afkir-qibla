// Netlify Functions v2 (ESM)
// Proxy for Bonnetid "today" med fallback på flere mulige stier.

const PROD_ORIGIN = "https://afkirqibla.netlify.app";
const DEV_ORIGIN  = "http://localhost:5173"; // Vite dev, justér ved behov
const ALLOWED_ORIGINS = new Set([PROD_ORIGIN, DEV_ORIGIN]);

export default async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : PROD_ORIGIN;

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(allowOrigin, /*expose*/ true),
    });
  }

  try {
    const url = new URL(req.url);
    const lat = url.searchParams.get("lat");
    const lon = url.searchParams.get("lon");
    const tz  = url.searchParams.get("tz") || "Europe/Oslo";
    const date = "today";

    if (!lat || !lon) return j({ error: "Missing: lat, lon" }, 400, allowOrigin);

    const apiKey =
      process.env.BONNETID_API_KEY ||
      process.env.BONNETID_X_API_KEY ||
      process.env.X_API_KEY;

    if (!apiKey) return j({ error: "Missing BONNETID_API_KEY" }, 500, allowOrigin);

    // Prøv kjente varianter (rekkefølgen betyr noe)
    const targets = [
      `https://api.bonnetid.no/v1/times/${date}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&tz=${encodeURIComponent(tz)}`,
      `https://api.bonnetid.no/v1/timings/${date}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&tz=${encodeURIComponent(tz)}`,
      `https://api.bonnetid.no/v1/prayer-times/${date}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&tz=${encodeURIComponent(tz)}`
    ];

    let lastErr: string | undefined;

    for (const target of targets) {
      try {
        const r = await fetch(target, {
          headers: {
            "x-api-key": apiKey,
            "accept": "application/json",
          },
        });

        if (r.ok) {
          const text = await r.text();
          return new Response(text, {
            status: 200,
            headers: {
              "content-type": r.headers.get("content-type") || "application/json",
              "cache-control": "public, max-age=60",
              ...corsHeaders(allowOrigin),
            },
          });
        }

        // 404/5xx -> prøv neste kandidat
        lastErr = `${r.status} ${r.statusText} on ${new URL(target).pathname}`;
      } catch (e: any) {
        lastErr = e?.message || String(e);
      }
    }

    return j(
      { error: "All Bonnetid variants failed", detail: lastErr },
      502,
      allowOrigin
    );
  } catch (err: any) {
    return j(
      { error: "Unhandled", detail: err?.message || String(err) },
      500,
      origin
    );
  }
};

function corsHeaders(origin: string, expose = false) {
  const h: Record<string, string> = {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
  if (expose) h["access-control-expose-headers"] = "content-type, cache-control";
  return h;
}

function j(data: any, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      ...corsHeaders(origin),
    },
  });
}
