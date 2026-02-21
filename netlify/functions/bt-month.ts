import type { Handler } from "@netlify/functions";

function toIsoDate(value: string | undefined, fallbackMonth: number, fallbackYear: number, day: number) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return `${fallbackYear}-${String(fallbackMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function pickTiming(t: any, ...keys: string[]) {
  for (const k of keys) {
    const v = t?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).slice(0, 5);
  }
  return "";
}

export const handler: Handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const lat = (qs as any).lat;
    const lon = (qs as any).lon;
    const tz = (qs as any).tz;
    const month = Number((qs as any).month);
    const year = Number((qs as any).year);

    if (!lat || !lon || !tz || !month || !year) {
      return { statusCode: 400, body: "Missing lat/lon/tz/month/year" };
    }

    const apiKey = process.env.BONNETID_API_KEY || "";
    if (!apiKey) {
      return { statusCode: 500, body: "Missing BONNETID_API_KEY env" };
    }

    const baseUrl = process.env.BONNETID_API_URL || "https://api.bonnetid.no/v1/prayertimes";
    const daysInMonth = new Date(year, month, 0).getDate();
    const rows = [] as any[];

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const url = new URL(baseUrl);
      url.searchParams.set("lat", String(lat));
      url.searchParams.set("lon", String(lon));
      url.searchParams.set("tz", String(tz));
      url.searchParams.set("date", date);

      const upstream = await fetch(url.toString(), {
        headers: {
          "X-API-Key": apiKey,
          Accept: "application/json",
        },
      });

      if (!upstream.ok) {
        const body = await upstream.text();
        return { statusCode: upstream.status, body: body || `Bonnetid failed for ${date}` };
      }

      const data = await upstream.json();
      const t = data?.timings || data?.data?.timings || data?.result?.timings || data?.data || data?.result || data;

      rows.push({
        date: toIsoDate(date, month, year, day),
        weekday: new Date(year, month - 1, day).toLocaleDateString("nb-NO", { weekday: "short" }),
        timings: {
          Fajr: pickTiming(t, "Fajr", "fajr"),
          Dhuhr: pickTiming(t, "Duhr", "Dhuhr", "dhuhr"),
          Asr: pickTiming(t, "Asr", "2x-skygge", "asr", "1x-skygge"),
          Maghrib: pickTiming(t, "Maghrib", "maghrib"),
          Isha: pickTiming(t, "Isha", "isha"),
        },
      });
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, source: "bonnetid" }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "Server error" };
  }
};
