
// Netlify Node Function (exports.handler) for Aladhan
exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const lat = qs.lat;
    const lon = qs.lon;
    const tz = qs.tz || "UTC";
    const when = qs.when || "today";
    const cc = (qs.cc || "").toUpperCase();

    if (!lat || !lon) {
      return json(400, { error: "Missing lat/lon" });
    }

    const API = (process.env.ALADHAN_API_URL || "https://api.aladhan.com").replace(/\/+$/, "");
    const base = `${API}/v1/timings/${encodeURIComponent(when)}`;

    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      timezonestring: tz,
    });

    if (cc === "NO") {
      if (process.env.ALADHAN_METHOD_NORWAY) params.set("method", process.env.ALADHAN_METHOD_NORWAY);
      if (process.env.ALADHAN_SCHOOL_NORWAY) params.set("school", process.env.ALADHAN_SCHOOL_NORWAY);
      if (process.env.ALADHAN_LAT_ADJ_NORWAY) params.set("latitudeAdjustmentMethod", process.env.ALADHAN_LAT_ADJ_NORWAY);
      if (process.env.ALADHAN_FAJR_ANGLE) params.set("fajr", process.env.ALADHAN_FAJR_ANGLE);
      if (process.env.ALADHAN_ISHA_ANGLE) params.set("isha", process.env.ALADHAN_ISHA_ANGLE);
    } else {
      if (process.env.ALADHAN_METHOD) params.set("method", process.env.ALADHAN_METHOD);
    }

    const finalUrl = `${base}?${params.toString()}`;
    const res = await fetch(finalUrl);
    if (!res.ok) {
      return json(502, { error: `Aladhan ${res.status}`, url: finalUrl });
    }
    const j = await res.json();
    const timings = j?.data?.timings || j?.data || {};
    const normalized = normalizeTimings(timings);
    return json(200, { provider: "aladhan", url: finalUrl, timings: normalized });
  } catch (err) {
    return json(500, { error: String(err && err.message ? err.message : err) });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function pad2(n) { return (n < 10 ? "0" : "") + n; }
function toHHMM(v) {
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
function normalizeTimings(t) {
  return {
    Fajr: toHHMM(t.Fajr || t.fajr),
    Sunrise: toHHMM(t.Sunrise || t.sunrise),
    Dhuhr: toHHMM(t.Dhuhr || t.dhuhr || t.Zuhr || t.zuhr),
    Asr: toHHMM(t.Asr || t.asr),
    Maghrib: toHHMM(t.Maghrib || t.maghrib),
    Isha: toHHMM(t.Isha || t.isha),
  };
}
