import type { Handler } from "@netlify/functions";
import {
  authHeaders,
  fetchLegacyDay,
  fetchPrayerMonth,
  mapTimings,
  resolveBonnetidRoot,
  resolveNearestLocationId,
} from "./bonnetid-client";

export const handler: Handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const lat = String((qs as any).lat || "");
    const lon = String((qs as any).lon || "");
    const tz = String((qs as any).tz || "");
    const month = Number((qs as any).month || 0);
    const year = Number((qs as any).year || 0);

    if (!lat || !lon || !tz || !month || !year) {
      return { statusCode: 400, body: "Missing lat/lon/tz/month/year" };
    }

    const headers = authHeaders();
    if (!headers) {
      return { statusCode: 500, body: "Missing BONNETID_API_TOKEN/BONNETID_API_KEY env" };
    }

    const base = resolveBonnetidRoot();
    let rows: any[] = [];

    try {
      const locationId = await resolveNearestLocationId(base, headers, Number(lat), Number(lon));
      const list = await fetchPrayerMonth(base, headers, locationId, year, month);
      rows = list.map((row: any, idx: number) => {
        const dayNumber = Number(row?.id ?? row?.day ?? idx + 1);
        const date = `${year}-${String(month).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
        const timings = mapTimings(row);
        return {
          date,
          weekday: new Date(year, month - 1, dayNumber).toLocaleDateString("nb-NO", { weekday: "short" }),
          timings,
        };
      });
    } catch {
      const daysInMonth = new Date(year, month, 0).getDate();
      for (let day = 1; day <= daysInMonth; day += 1) {
        const isoDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        try {
          const timings = await fetchLegacyDay(base, headers, lat, lon, tz, isoDate);
          rows.push({
            date: isoDate,
            weekday: new Date(year, month - 1, day).toLocaleDateString("nb-NO", { weekday: "short" }),
            timings,
          });
        } catch {
          rows.push({
            date: isoDate,
            weekday: new Date(year, month - 1, day).toLocaleDateString("nb-NO", { weekday: "short" }),
            timings: { Fajr: "", Sunrise: "", Dhuhr: "", Asr: "", Maghrib: "", Isha: "" },
          });
        }
      }
    }

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
