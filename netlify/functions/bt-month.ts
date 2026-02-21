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

function toBonnetidDateFormat(year: number, month: number, day: number) {
  return `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`;
}

function pickTiming(lookup: Map<string, string>, ...aliases: string[]) {
  for (const alias of aliases) {
    const hit = lookup.get(normalizeFieldKey(alias));
    if (hit) return hit.slice(0, 5);
  }
  return "";
}

async function fetchDay(baseUrl: URL | string, apiKey: string, lat: string, lon: string, tz: string, year: number, month: number, day: number) {
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const url = new URL(baseUrl.toString());
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  url.searchParams.set("tz", tz);
  url.searchParams.set("date", toBonnetidDateFormat(year, month, day));

  const upstream = await fetch(url.toString(), {
    headers: {
      "X-API-Key": apiKey,
      Accept: "application/json",
    },
  });

  if (!upstream.ok) {
    return {
      date,
      weekday: new Date(year, month - 1, day).toLocaleDateString("nb-NO", { weekday: "short" }),
      timings: { Fajr: "", Dhuhr: "", Asr: "", Maghrib: "", Isha: "" },
      error: `upstream ${upstream.status}`,
    };
  }

  const data = await upstream.json();
  const t = data?.timings || data?.data?.timings || data?.result?.timings || data?.data || data?.result || data;
  const lookup = createTimingLookup(t);

  return {
    date,
    weekday: new Date(year, month - 1, day).toLocaleDateString("nb-NO", { weekday: "short" }),
    timings: {
      Fajr: pickTiming(lookup, "Morgengry 16°", "Morgengry16°", "Morgengry", "Fajr", "fajr"),
      Dhuhr: pickTiming(lookup, "Duhr", "Duhur", "Dhor", "Dhuhr", "Zuhr", "zuhr", "dhuhr"),
      Asr: pickTiming(lookup, "Asr", "2x-skygge", "asr_2x", "asr2x", "asr"),
      Maghrib: pickTiming(lookup, "Maghrib", "Magrib", "maghrib", "magrib"),
      Isha: pickTiming(lookup, "Isha", "isha"),
    },
  };
}

export const handler: Handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const lat = String((qs as any).lat || "");
    const lon = String((qs as any).lon || "");
    const tz = String((qs as any).tz || "");
    const month = Number((qs as any).month);
    const year = Number((qs as any).year);

    if (!lat || !lon || !tz || !month || !year) {
      return { statusCode: 400, body: "Missing lat/lon/tz/month/year" };
    }

    const apiKey = process.env.BONNETID_API_KEY || "";
    if (!apiKey) {
      return { statusCode: 500, body: "Missing BONNETID_API_KEY env (set in Netlify Site Configuration -> Environment variables)" };
    }

    const baseUrl = resolveBonnetidUrl(process.env.BONNETID_API_URL);
    const daysInMonth = new Date(year, month, 0).getDate();
    const concurrency = 5;
    const queue = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const rows: any[] = [];

    async function worker() {
      while (queue.length) {
        const day = queue.shift();
        if (!day) return;
        const row = await fetchDay(baseUrl, apiKey, lat, lon, tz, year, month, day);
        rows.push(row);
      }
    }

    await Promise.all(Array.from({ length: concurrency }, worker));

    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, source: "bonnetid" }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "Server error" };
  }
};
