import type { Handler } from "@netlify/functions";
import {
  authHeaders,
  fetchLegacyDay,
  fetchPrayerMonth,
  mapTimings,
  normalizeDate,
  resolveBonnetidRoot,
  resolveNearestLocationId,
} from "./bonnetid-client";

export const handler: Handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const lat = String((qs as any).lat || "");
    const lon = String((qs as any).lon || "");
    const tz = String((qs as any).tz || "");
    const when = String((qs as any).when || (qs as any).date || "today");

    if (!lat || !lon || !tz) return { statusCode: 400, body: "Missing lat/lon/tz" };

    const headers = authHeaders();
    if (!headers) {
      return { statusCode: 500, body: "Missing BONNETID_API_TOKEN/BONNETID_API_KEY env" };
    }

    const base = resolveBonnetidRoot();
    const isoDate = normalizeDate(when, tz);

    try {
      const locationId = await resolveNearestLocationId(base, headers, Number(lat), Number(lon));
      const year = Number(isoDate.slice(0, 4));
      const month = Number(isoDate.slice(5, 7));
      const day = Number(isoDate.slice(8, 10));
      const monthRows = await fetchPrayerMonth(base, headers, locationId, year, month);

      const hit = monthRows.find((row: any) => {
        const dateValue = String(row?.date || "");
        if (dateValue.startsWith(isoDate)) return true;
        const rowDay = Number(row?.id ?? row?.day ?? row?.gregorian_date ?? 0);
        return rowDay === day;
      });

      if (!hit) throw new Error("day missing");
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timings: mapTimings(hit), source: "bonnetid" }),
      };
    } catch {
      const timings = await fetchLegacyDay(base, headers, lat, lon, tz, isoDate);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timings, source: "bonnetid-legacy" }),
      };
    }
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "Server error" };
  }
};
