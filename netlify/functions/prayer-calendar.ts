import type { Handler } from "@netlify/functions";

type DayRow = {
  date: string;
  weekday: string;
  timings: {
    Fajr: string;
    Dhuhr: string;
    Asr: string;
    Maghrib: string;
    Isha: string;
  };
};

export const handler: Handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const lat = Number(qs.lat);
    const lon = Number(qs.lon);
    const month = Number(qs.month);
    const year = Number(qs.year);
    const cc = String(qs.cc || "").toUpperCase();
    const tz = String(qs.tz || "Europe/Oslo");

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !month || !year) {
      return { statusCode: 400, body: "Missing lat/lon/month/year" };
    }

    const days = cc === "NO"
      ? await getBonnetidMonth({ lat, lon, month, year, tz })
      : await getAladhanMonth({ lat, lon, month, year, tz });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ days, source: cc === "NO" ? "bonnetid" : "aladhan" }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "Server error" };
  }
};

async function getAladhanMonth({ lat, lon, month, year, tz }: { lat: number; lon: number; month: number; year: number; tz: string }): Promise<DayRow[]> {
  const url = new URL("https://api.aladhan.com/v1/calendar");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("month", String(month));
  url.searchParams.set("year", String(year));
  url.searchParams.set("timezonestring", tz);

  const r = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Calendar API failed: ${r.status}`);
  const j = await r.json();

  return (j?.data || []).map((d: any) => ({
    date: d?.date?.gregorian?.date,
    weekday: d?.date?.gregorian?.weekday?.en || "",
    timings: {
      Fajr: toHHMM(d?.timings?.Fajr),
      Dhuhr: toHHMM(d?.timings?.Dhuhr),
      Asr: toHHMM(d?.timings?.Asr),
      Maghrib: toHHMM(d?.timings?.Maghrib),
      Isha: toHHMM(d?.timings?.Isha),
    },
  }));
}

async function getBonnetidMonth({ lat, lon, month, year, tz }: { lat: number; lon: number; month: number; year: number; tz: string }): Promise<DayRow[]> {
  const apiKey = process.env.BONNETID_API_KEY || "";
  if (!apiKey) throw new Error("Missing BONNETID_API_KEY env");
  const baseUrl = process.env.BONNETID_API_URL || "https://api.bonnetid.no/v1/prayertimes";

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const requests = Array.from({ length: daysInMonth }, (_, i) => i + 1).map(async (day) => {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const url = new URL(baseUrl);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("tz", tz);
    url.searchParams.set("date", date);

    const response = await fetch(url.toString(), {
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/json",
      },
    });

    if (!response.ok) throw new Error(`Bonnetid day ${date} failed: ${response.status}`);
    const raw = await response.json();
    const timings = normalizeBonnetidTimings(raw);

    return {
      date: `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`,
      weekday: new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
      timings,
    };
  });

  return await Promise.all(requests);
}

function normalizeBonnetidTimings(raw: any): DayRow["timings"] {
  const t = raw?.timings || raw?.data?.timings || raw?.result?.timings || raw?.data || raw?.result || raw;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = t?.[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return toHHMM(v);
    }
    return "";
  };
  return {
    Fajr: pick("Fajr", "fajr"),
    Dhuhr: pick("Duhr", "Dhuhr", "dhuhr"),
    Asr: pick("Asr", "2x-skygge", "asr", "1x-skygge"),
    Maghrib: pick("Maghrib", "maghrib"),
    Isha: pick("Isha", "isha"),
  };
}

function toHHMM(v: any): string {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{1,2})[:.](\d{2})/);
  if (!m) return s;
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}