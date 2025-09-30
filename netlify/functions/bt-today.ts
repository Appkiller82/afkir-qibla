
// Netlify Node Function (exports.handler) for Bonnetid
exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const lat = qs.lat;
    const lon = qs.lon;
    const tz = qs.tz || "UTC";
    const when = qs.when || "today";

    if (!lat || !lon) {
      return json(400, { error: "Missing lat/lon" });
    }

    const API = (process.env.BONNETID_API_URL || "https://api.bonnetid.no").replace(/\/+$/, "");
    const KEY = process.env.BONNETID_API_KEY || "";

    const endpoints = [
      `${API}/v1/timings/${encodeURIComponent(when)}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&tz=${encodeURIComponent(tz)}`,
      `${API}/v1/timings?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&tz=${encodeURIComponent(tz)}&when=${encodeURIComponent(when)}`,
    ];

    let data = null;
    let lastError = null;

    for (const eurl of endpoints) {
      try {
        const res = await fetch(eurl, {
          headers: {
            "content-type": "application/json",
            ...(KEY ? { "x-api-key": KEY } : {}),
            ...(KEY ? { "authorization": `Bearer ${KEY}` } : {}),
          },
        });
        if (!res.ok) { lastError = new Error(`Bonnetid ${res.status} ${res.statusText}`); continue; }
        data = await res.json();
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!data) {
      throw lastError || new Error("Unknown Bonnetid error");
    }

    const timings = data?.timings || data?.data?.timings || data?.data || {};
    const normalized = normalizeTimings(timings);
    return json(200, { provider: "bonnetid", timings: normalized });
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
  if (/^\d{1,2}\.\d{2}$/.test(s)) {
    const [h, m] = s.split(".").map(Number);
    return `${pad2(h)}:${pad2(m)}`;
  }
  const m = s.match(/^(\d{1,2}:\d{2})/);
  if (m) return m[1];
  return s;
}
function normalizeTimings(t) {
  return {
    Fajr: toHHMM(t.Fajr || t.fajr),
    Sunrise: toHHMM(t.Sunrise || t.sunrise || t.Soloppgang),
    Dhuhr: toHHMM(t.Dhuhr || t.dhuhr || t.Zuhr || t.zuhr),
    Asr: toHHMM(t.Asr || t.asr),
    Maghrib: toHHMM(t.Maghrib || t.maghrib),
    Isha: toHHMM(t.Isha || t.isha),
  };
}
