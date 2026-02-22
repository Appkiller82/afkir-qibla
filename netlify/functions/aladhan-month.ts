import type { Handler } from "@netlify/functions";

function toHHMM(v: any) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{1,2}:\d{2})/);
  return m ? m[1] : "";
}

export const handler: Handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const lat = String((qs as any).lat || "");
    const lon = String((qs as any).lon || "");
    const tz = String((qs as any).tz || "UTC");
    const month = Number((qs as any).month || 0);
    const year = Number((qs as any).year || 0);

    if (!lat || !lon || !month || !year) {
      return { statusCode: 400, body: "Missing lat/lon/month/year" };
    }

    const url = new URL(`https://api.aladhan.com/v1/calendar/${year}/${month}`);
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);
    url.searchParams.set("timezonestring", tz);

    const method = String(process.env.ALADHAN_METHOD || "").trim();
    if (method) url.searchParams.set("method", method);

    const upstream = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    const text = await upstream.text();
    if (!upstream.ok) return { statusCode: upstream.status, body: text || "Upstream error" };

    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      return { statusCode: 502, body: "Invalid JSON from Aladhan" };
    }

    const rows = (j?.data || []).map((d: any) => ({
      date: `${d?.date?.gregorian?.year}-${String(d?.date?.gregorian?.month?.number || month).padStart(2, "0")}-${String(d?.date?.gregorian?.day || "01").padStart(2, "0")}`,
      weekday: d?.date?.gregorian?.weekday?.en,
      timings: {
        Fajr: toHHMM(d?.timings?.Fajr),
        Sunrise: toHHMM(d?.timings?.Sunrise),
        Dhuhr: toHHMM(d?.timings?.Dhuhr || d?.timings?.Zuhr),
        Asr: toHHMM(d?.timings?.Asr),
        Maghrib: toHHMM(d?.timings?.Maghrib),
        Isha: toHHMM(d?.timings?.Isha),
      },
    }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, source: "aladhan" }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "Server error" };
  }
};
