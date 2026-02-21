import type { Handler } from "@netlify/functions";

function pickTuning(cc: string) {
  const isNo = cc === "NO";
  return {
    method: isNo ? process.env.ALADHAN_METHOD_NORWAY || "99" : process.env.ALADHAN_METHOD || "",
    school: isNo ? process.env.ALADHAN_SCHOOL_NORWAY || "1" : process.env.ALADHAN_SCHOOL || "",
    latAdj: isNo ? process.env.ALADHAN_LAT_ADJ_NORWAY || "3" : process.env.ALADHAN_LAT_ADJ || "",
    fajrAngle: isNo ? process.env.ALADHAN_FAJR_ANGLE_NORWAY || "16" : process.env.ALADHAN_FAJR_ANGLE || "",
    ishaAngle: isNo ? process.env.ALADHAN_ISHA_ANGLE_NORWAY || "14" : process.env.ALADHAN_ISHA_ANGLE || "",
    maghribMinutes: isNo ? process.env.ALADHAN_MAGHRIB_MINUTES_NORWAY || "0" : process.env.ALADHAN_MAGHRIB_MINUTES || "0",
    tune: isNo ? process.env.ALADHAN_TUNE_NORWAY || "0,0,5,0,0,0,0,0,0" : process.env.ALADHAN_TUNE || "",
  };
}

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
    const tz = String((qs as any).tz || "Europe/Oslo");
    const month = Number((qs as any).month || 0);
    const year = Number((qs as any).year || 0);
    const cc = String((qs as any).cc || "").toUpperCase();

    if (!lat || !lon || !month || !year) {
      return { statusCode: 400, body: "Missing lat/lon/month/year" };
    }

    const base = "https://api.aladhan.com/v1/calendar";
    const url = new URL(base);
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);
    url.searchParams.set("month", String(month));
    url.searchParams.set("year", String(year));
    url.searchParams.set("timezonestring", tz);

    const tuning = pickTuning(cc);
    if (tuning.method) url.searchParams.set("method", tuning.method);
    if (tuning.school) url.searchParams.set("school", tuning.school);
    if (tuning.latAdj) url.searchParams.set("latitudeAdjustmentMethod", tuning.latAdj);
    if (tuning.fajrAngle && tuning.ishaAngle) {
      url.searchParams.set("methodSettings", `${tuning.fajrAngle},${tuning.ishaAngle},${tuning.maghribMinutes}`);
    }
    if (tuning.tune) url.searchParams.set("tune", tuning.tune);

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
      body: JSON.stringify({ rows, source: cc === "NO" ? "aladhan-no-tuned" : "aladhan" }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "Server error" };
  }
};
