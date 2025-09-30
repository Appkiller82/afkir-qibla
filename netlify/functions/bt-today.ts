/**
 * Netlify Function: bt-today (Bonnetid primary for Norway)
 * Query: ?lat=..&lon=..&tz=..&when=today|tomorrow (default today)
 * Env: BONNETID_API_URL, BONNETID_API_KEY
 */
export default async (request: Request) => {
  try {
    const url = new URL(request.url);
    const lat = url.searchParams.get("lat");
    const lon = url.searchParams.get("lon");
    const tz = url.searchParams.get("tz") || "UTC";
    const when = url.searchParams.get("when") || "today";

    if (!lat || !lon) {
      return new Response(JSON.stringify({ error: "Missing lat/lon" }), { status: 400 });
    }

    const API = process.env.BONNETID_API_URL || "https://api.bonnetid.no";
    const KEY = process.env.BONNETID_API_KEY || "";

    // Try canonical endpoint first, then a couple of safe fallbacks.
    const endpoints = [
      `${API.replace(/\/+$/,"")}/v1/timings/${encodeURIComponent(when)}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&tz=${encodeURIComponent(tz)}`,
      `${API.replace(/\/+$/,"")}/v1/timings?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&tz=${encodeURIComponent(tz)}&when=${encodeURIComponent(when)}`,
    ];

    let lastError: any = null;
    let data: any = null;

    for (const eurl of endpoints) {
      try {
        const res = await fetch(eurl, {
          headers: {
            "content-type": "application/json",
            ...(KEY ? { "x-api-key": KEY } : {}),
            ...(KEY ? { "authorization": `Bearer ${KEY}` } : {}),
          },
        });
        if (!res.ok) {
          lastError = new Error(`Bonnetid ${res.status} ${res.statusText}`);
          continue;
        }
        data = await res.json();
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!data) {
      throw lastError || new Error("Unknown Bonnetid error");
    }

    // Accept both {timings:{...}} and {data:{timings:{...}}}
    const timings = data?.timings || data?.data?.timings || data?.data || {};
    const normalized = normalizeTimings(timings);

    return new Response(JSON.stringify({ provider: "bonnetid", timings: normalized }), {
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
  // Already HH:mm
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(":").map(Number);
    return `${pad2(h)}:${pad2(m)}`;
  }
  // "05.15" or "5.15"
  if (/^\d{1,2}\.\d{2}$/.test(s)) {
    const [h, m] = s.split(".").map(Number);
    return `${pad2(h)}:${pad2(m)}`;
  }
  // "05:15 (CEST)" -> strip suffix
  const m = s.match(/^(\d{1,2}:\d{2})/);
  if (m) return m[1];
  return s;
}
function normalizeTimings(t: any) {
  return {
    Fajr: toHHMM(t.Fajr || t.fajr),
    Sunrise: toHHMM(t.Sunrise || t.sunrise || t.Soloppgang),
    Dhuhr: toHHMM(t.Dhuhr || t.dhuhr || t.Zuhr || t.zuhr),
    Asr: toHHMM(t.Asr || t.asr),
    Maghrib: toHHMM(t.Maghrib || t.maghrib),
    Isha: toHHMM(t.Isha || t.isha),
  };
}