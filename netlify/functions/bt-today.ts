import type { Handler } from "@netlify/functions";

// Proxy til Bonnetid API: /v1/prayertimes
// Bruker server-side header X-API-Key fra env (BONNETID_API_KEY)
export const handler: Handler = async (event) => {
  try {
    const { lat, lon, tz, date = "today" } = event.queryStringParameters || {};
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
    url.searchParams.set("date", String(date)); // 'today' eller YYYY-MM-DD

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

    // Viderekoble svaret uendret for fleksibilitet i frontend
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: text,
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "Server error" };
  }
};
