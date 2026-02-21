import type { Handler } from "@netlify/functions";

function pickTiming(t: any, ...keys: string[]) {
  for (const k of keys) {
    const v = t?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).slice(0, 5);
  }
  return "";
}

async function fetchDay(baseUrl: string, apiKey: string, lat: string, lon: string, tz: string, year: number, month: number, day: number) {
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const url = new URL(baseUrl);
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  url.searchParams.set("tz", tz);
  url.searchParams.set("date", date);

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

  return {
    date,
    weekday: new Date(year, month - 1, day).toLocaleDateString("nb-NO", { weekday: "short" }),
    timings: {
      Fajr: pickTiming(t, "Fajr", "fajr"),
      Dhuhr: pickTiming(t, "Duhr", "Dhuhr", "dhuhr"),
      Asr: pickTiming(t, "Asr", "2x-skygge", "asr", "1x-skygge"),
      Maghrib: pickTiming(t, "Maghrib", "maghrib"),
      Isha: pickTiming(t, "Isha", "isha"),
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

    const baseUrl = process.env.BONNETID_API_URL || "https://api.bonnetid.no/v1/prayertimes";
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
