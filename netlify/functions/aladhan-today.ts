/**
 * Netlify Function: aladhan-today
 * Query: ?lat=..&lon=..&tz=..&when=today|tomorrow&cc=NO|..
 * Env: ALADHAN_API_URL, ALADHAN_METHOD, ALADHAN_METHOD_NORWAY, ALADHAN_SCHOOL_NORWAY,
 *      ALADHAN_LAT_ADJ_NORWAY, ALADHAN_FAJR_ANGLE, ALADHAN_ISHA_ANGLE
 */
export default async (request: Request) => {
  try {
    const url = new URL(request.url);
    const lat = url.searchParams.get("lat");
    const lon = url.searchParams.get("lon");
    const tz = url.searchParams.get("tz") || "UTC";
    const when = url.searchParams.get("when") || "today";
    const cc = (url.searchParams.get("cc") || "").toUpperCase();

    if (!lat || !lon) {
      return new Response(JSON.stringify({ error: "Missing lat/lon" }), { status: 400 });
    }

    const API = (process.env.ALADHAN_API_URL || "https://api.aladhan.com").replace(/\/+$/,"");
    const base = `${API}/v1/timings/${encodeURIComponent(when)}`;

    const params: Record<string, string> = {
      latitude: String(lat),
      longitude: String(lon),
      timezonestring: tz,
    };

    if (cc === "NO") {
      if (process.env.ALADHAN_METHOD_NORWAY) params.method = process.env.ALADHAN_METHOD_NORWAY;
      if (process.env.ALADHAN_SCHOOL_NORWAY) params.school = process.env.ALADHAN_SCHOOL_NORWAY;
      if (process.env.ALADHAN_LAT_ADJ_NORWAY) params.latitudeAdjustmentMethod = process.env.ALADHAN_LAT_ADJ_NORWAY;
      if (process.env.ALADHAN_FAJR_ANGLE) params.fajr = process.env.ALADHAN_FAJR_ANGLE;
      if (process.env.ALADHAN_ISHA_ANGLE) params.isha = process.env.ALADHAN_ISHA_ANGLE;
    } else {
      if (process.env.ALADHAN_METHOD) params.method = process.env.ALADHAN_METHOD;
    }

    const finalUrl = base + "?" + new URLSearchParams(params).toString();
    const res = await fetch(finalUrl);
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Aladhan ${res.status}` }), { status: 502 });
    }
    const j = await res.json();

    const timings = j?.data?.timings || j?.data || {};
    const normalized = normalizeTimings(timings);

    return new Response(JSON.stringify({ provider: "aladhan", url: finalUrl, timings: normalized }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500 });
  }
};

function pad2(n: number) { return (n < 10 ? "0" : "") + n; }
function toHHMM(v: any) {
  if (!v) return v;
  const s = String(v).trim();
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(":").map(Number);
    return `${pad2(h)}:${pad2(m)}`;
  }
  const m = s.match(/^(\d{1,2}:\d{2})/);
  if (m) return m[1];
  return s;
}
function normalizeTimings(t: any) {
  return {
    Fajr: toHHMM(t.Fajr || t.fajr),
    Sunrise: toHHMM(t.Sunrise || t.sunrise),
    Dhuhr: toHHMM(t.Dhuhr || t.dhuhr || t.Zuhr || t.zuhr),
    Asr: toHHMM(t.Asr || t.asr),
    Maghrib: toHHMM(t.Maghrib || t.maghrib),
    Isha: toHHMM(t.Isha || t.isha),
  };
}