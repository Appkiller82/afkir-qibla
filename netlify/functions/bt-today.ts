import type { Handler } from "@netlify/functions";

export const handler: Handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    // Frontend uses "when"; keep "date" for backwards compatibility.
    const { lat, lon, tz } = qs as any;
    const date = (qs as any).when || (qs as any).date || "today";
    if (!lat || !lon || !tz) {
      return { statusCode: 400, body: "Missing lat/lon/tz" };
    }
    const apiKey = process.env.BONNETID_API_KEY || "";
    if (!apiKey) {
      return { statusCode: 500, body: "Missing BONNETID_API_KEY env" };
    }

    const url = new URL("https://api.bonnetid.no/v1/prayertimes");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("tz", String(tz));
    url.searchParams.set("date", String(date));

    const upstream = await fetch(url.toString(), {
      headers: {
        "X-API-Key": apiKey,
        "Accept": "application/json",
      },
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return { statusCode: upstream.status, body: text || "Upstream error" };
    }

    // Normalize to { timings: {...} }
    let timings: any = null;
    try {
      const j = JSON.parse(text);
      timings = j?.timings || j?.data?.timings || j?.result?.timings || null;
    } catch {
      timings = null;
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timings, source: "bonnetid" }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "Server error" };
  }
};