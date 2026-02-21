import type { Handler } from "@netlify/functions";

function resolveBonnetidUrl(rawBase?: string) {
  const candidate = String(rawBase || "https://api.bonnetid.no").trim();
  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  const url = new URL(withScheme);
  url.search = "";
  url.hash = "";
  const path = (url.pathname || "/").replace(/\/+$/, "");
  if (!path || path === "") {
    url.pathname = "/v1/prayertimes";
  } else if (path === "/") {
    url.pathname = "/v1/prayertimes";
  }
  return url;
}


function normalizeFieldKey(key: string) {
  return String(key || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function createTimingLookup(t: any) {
  const map = new Map<string, string>();
  if (!t || typeof t !== "object") return map;
  for (const [rawKey, rawValue] of Object.entries(t)) {
    if (rawValue === undefined || rawValue === null) continue;
    const value = String(rawValue).trim();
    if (!value) continue;
    map.set(normalizeFieldKey(String(rawKey)), value);
  }
  return map;
}

function pickTiming(lookup: Map<string, string>, ...aliases: string[]) {
  for (const alias of aliases) {
    const hit = lookup.get(normalizeFieldKey(alias));
    if (hit) return hit;
  }
  return "";
}

function toBonnetidDateFormat(isoDate: string) {
  const [y, m, d] = String(isoDate || "").split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}-${m}-${y}`;
}

function normalizeDate(input: string, tz: string) {
  const v = String(input || "today").trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const addDays = v === "tomorrow" ? 1 : 0;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);

  const baseUtc = new Date(Date.UTC(y, m - 1, d));
  baseUtc.setUTCDate(baseUtc.getUTCDate() + addDays);
  const yy = baseUtc.getUTCFullYear();
  const mm = String(baseUtc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(baseUtc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
export const handler: Handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};

    // Frontend kan sende "when" (today|tomorrow|YYYY-MM-DD).
    // Vi støtter også "date" for kompatibilitet.
    const lat = (qs as any).lat;
    const lon = (qs as any).lon;
    const tz  = (qs as any).tz;
    const when = (qs as any).when || (qs as any).date || "today";

    if (!lat || !lon || !tz) {
      return { statusCode: 400, body: "Missing lat/lon/tz" };
    }

    const apiKey = process.env.BONNETID_API_KEY || "";
    if (!apiKey) {
      return { statusCode: 500, body: "Missing BONNETID_API_KEY env (set in Netlify Site Configuration -> Environment variables)" };
    }

    // Bruk env hvis du har, ellers default:
    const baseUrl = resolveBonnetidUrl(process.env.BONNETID_API_URL);

    const url = new URL(baseUrl.toString());
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("tz", String(tz));
    url.searchParams.set("date", toBonnetidDateFormat(normalizeDate(String(when), String(tz))));

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

    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      return { statusCode: 502, body: "Invalid JSON from Bonnetid" };
    }

    // Bonnetid kan ha litt ulik struktur. Vi prøver noen varianter.
    const t =
      j?.timings ||
      j?.data?.timings ||
      j?.result?.timings ||
      j?.data ||
      j?.result ||
      j;

    const lookup = createTimingLookup(t);

    // Viktig: RIKTIG mapping fra Bonnetid-tabellen:
    // - Dhuhr skal være "Duhr", ikke "Istiwa"
    // - Asr skal være "Asr" eller "2x-skygge" (fallback til 1x)
    // - Maghrib skal være "Maghrib", ikke "Isha"
    const timings = {
      Fajr: pickTiming(lookup, "Morgengry 16°", "Morgengry16°", "Morgengry", "Fajr", "fajr"),
      Sunrise: pickTiming(lookup, "Soloppgang", "Sunrise", "sunrise"),

      // Dhuhr: prioriter Duhr (bonnetid) -> Dhuhr (hvis API bruker engelsk)
      Dhuhr: pickTiming(lookup, "Duhr", "Duhur", "Dhor", "Dhuhr", "Zuhr", "zuhr", "dhuhr"),

      // Asr: prioriter Asr eller 2x-skygge (bonnetid har begge)
      Asr: pickTiming(lookup, "Asr", "2x-skygge", "asr_2x", "asr2x", "asr"),

      Maghrib: pickTiming(lookup, "Maghrib", "Magrib", "maghrib", "magrib"),
      Isha: pickTiming(lookup, "Isha", "isha"),

      // Ekstra (kan være nyttig, men frontend kan ignorere)
      Istiwa: pickTiming(lookup, "Istiwa", "istiwa"),
      Asr1x: pickTiming(lookup, "1x-skygge", "asr_1x", "asr1x"),
      Asr2x: pickTiming(lookup, "2x-skygge", "asr_2x", "asr2x"),
      Midnight: pickTiming(lookup, "Midnatt", "Midnight", "midnight"),
    };

    // En liten sanity-check: hvis Maghrib mangler men Isha finnes,
    // skal vi ikke “gjette” Maghrib = Isha. Da lar vi Maghrib være tom.
    // (Dette hindrer akkurat feilen du fikk.)
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timings, source: "bonnetid" }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "Server error" };
  }
};