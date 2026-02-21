import type { Handler } from "@netlify/functions";

function resolveBonnetidUrl(rawBase?: string) {
  const candidate = String(rawBase || "https://api.bonnetid.no").trim();
  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  const url = new URL(withScheme);
  url.search = "";
  url.hash = "";
  const path = (url.pathname || "/").replace(/\/+$/, "");
  if (!path || path === "/") url.pathname = "/v1/prayertimes";
  return url;
}

export const handler: Handler = async () => {
  try {
    const apiKey = process.env.BONNETID_API_KEY || "";
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: false, reason: "missing_api_key" }),
      };
    }

    const url = resolveBonnetidUrl(process.env.BONNETID_API_URL);
    url.searchParams.set("lat", "59.9139");
    url.searchParams.set("lon", "10.7522");
    url.searchParams.set("tz", "Europe/Oslo");
    url.searchParams.set("date", "today");

    const upstream = await fetch(url.toString(), {
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
    });

    const text = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "";

    return {
      statusCode: upstream.ok ? 200 : 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: upstream.ok,
        status: upstream.status,
        contentType,
        endpoint: `${url.origin}${url.pathname}`,
        sample: text.slice(0, 180),
      }),
    };
  } catch (e: any) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, reason: e?.message || "unknown_error" }),
    };
  }
};
