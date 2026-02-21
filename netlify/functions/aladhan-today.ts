import type { Handler } from "@netlify/functions";

export const handler: Handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    // Frontend uses "when"; keep "date" for backwards compatibility.
    const { lat, lon, tz } = qs as any;
    const cc = String((qs as any).cc || "").toUpperCase();
    const when = (qs as any).when || (qs as any).date || "today";
    if (!lat || !lon || !tz) {
      return { statusCode: 400, body: "Missing lat/lon/tz" };
    }

    // Aladhan supports /timings (today) and /timings/{date}. We normalize "tomorrow" to YYYY-MM-DD.
    const date = normalizeDate(when, String(tz));

    const base = "https://api.aladhan.com/v1";
    const url = new URL(date === "today" ? `${base}/timings` : `${base}/timings/${encodeURIComponent(date)}`);
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lon));
    url.searchParams.set("timezonestring", String(tz));

    // Optional calculation tuning via env vars.
    // Norway can be overridden separately (…_NORWAY) by passing cc=NO from the frontend.
    const method = (cc === "NO" ? process.env.ALADHAN_METHOD_NORWAY || "11" : process.env.ALADHAN_METHOD) || "";
    const school = (cc === "NO" ? process.env.ALADHAN_SCHOOL_NORWAY || "0" : process.env.ALADHAN_SCHOOL) || "";
    const latAdj = (cc === "NO" ? process.env.ALADHAN_LAT_ADJ_NORWAY || "3" : process.env.ALADHAN_LAT_ADJ) || "";
    const fajrAngle = process.env.ALADHAN_FAJR_ANGLE || "";
    const ishaAngle = process.env.ALADHAN_ISHA_ANGLE || "";

    if (method) url.searchParams.set("method", method);
    if (school) url.searchParams.set("school", school);
    if (latAdj) url.searchParams.set("latitudeAdjustmentMethod", latAdj);

    // Some methods allow overriding angles via methodSettings.
    // Keep it conservative: only add if both angles are provided.
    if (fajrAngle && ishaAngle) {
      url.searchParams.set("methodSettings", `${fajrAngle},${ishaAngle},0`);
    }

    const upstream = await fetch(url.toString(), { headers: { "Accept": "application/json" } });
    const text = await upstream.text();
    if (!upstream.ok) {
      return { statusCode: upstream.status, body: text || "Upstream error" };
    }

    // Normalize to { timings: {Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha, ...} }
    let timings: any = null;
    try {
      const j = JSON.parse(text);
      timings = j?.data?.timings || j?.timings || null;
    } catch {
      timings = null;
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timings, source: "aladhan" }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "Server error" };
  }
};

function normalizeDate(input: string, tz: string): string {
  const v = String(input || "today").trim().toLowerCase();
  if (v === "today") return "today";
  if (v === "tomorrow") return addDaysInTimeZone(tz, 1);
  // Accept YYYY-MM-DD as-is (what Aladhan docs commonly show).
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return v;
}

function addDaysInTimeZone(tz: string, days: number): string {
  // Get today's date parts in the requested timezone, then add days in UTC.
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);

  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);

  const yyyy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(base.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}