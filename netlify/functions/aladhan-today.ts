import type { Handler } from "@netlify/functions";

// Valgfri fallback til Aladhan API dersom Bonnetid ikke er tilgjengelig.
// Ingen API-nøkkel nødvendig. Dette brukes f.eks. for test eller backup.
export const handler: Handler = async (event) => {
  try {
    const { lat, lon, tz, date = "today" } = event.queryStringParameters || {};
    if (!lat || !lon || !tz) {
      return { statusCode: 400, body: "Missing lat/lon/tz" };
    }

    let endpoint: string;
    if (date === "today") {
      endpoint = `https://api.aladhan.com/v1/timings?latitude=${encodeURIComponent(String(lat))}&longitude=${encodeURIComponent(String(lon))}&timezonestring=${encodeURIComponent(String(tz))}`;
    } else {
      endpoint = `https://api.aladhan.com/v1/timings/${encodeURIComponent(String(date))}?latitude=${encodeURIComponent(String(lat))}&longitude=${encodeURIComponent(String(lon))}&timezonestring=${encodeURIComponent(String(tz))}`;
    }

    const upstream = await fetch(endpoint, { headers: { "Accept": "application/json" } });
    const text = await upstream.text();
    if (!upstream.ok) {
      return { statusCode: upstream.status, body: text || "Upstream error" };
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: text,
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "Server error" };
  }
};
