// Unified prayer-time fetchers:
// - Norway: Bonnetid (via secure Netlify proxy)
// - Rest of world: Aladhan
export type Timings = {
  Fajr: string;
  Sunrise: string;
  Dhuhr: string;
  Asr: string;
  Maghrib: string;
  Isha: string;
};

export type MonthRow = {
  date: string; // YYYY-MM-DD
  weekday?: string;
  timings: Timings;
};

const BONNETID_MONTH_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const BONNETID_LOCATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d
const monthInFlight = new Map<string, Promise<MonthRow[]>>();

async function readJsonOrThrow(res: Response, source: string) {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!res.ok) throw new Error(`${source} ${res.status}: ${text || "empty"}`);
  if (!ct.includes("application/json")) throw new Error(`${source} returned non-JSON response`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${source} invalid JSON`);
  }
}

function hasCoreTimings(t: Timings) {
  return !!(t?.Fajr && t?.Dhuhr && t?.Asr && t?.Maghrib && t?.Isha);
}

function looksSuspiciousNorway(t: Timings) {
  if (!hasCoreTimings(t)) return true;
  if (t.Maghrib && t.Isha && t.Maghrib === t.Isha) return true;
  return false;
}

function isNorway(countryCode: string | undefined | null, tz: string) {
  const cc = (countryCode || "").toUpperCase();
  if (cc === "NO") return true;
  // Hard requirement: fallback to timezone when geo/country is missing.
  return !cc && String(tz || "") === "Europe/Oslo";
}

function pad2(n: number) {
  return (n < 10 ? "0" : "") + n;
}

function toHHMM(v: any) {
  if (!v) return "";
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
  return "";
}

function ensure(t: any): Timings {
  return {
    Fajr: toHHMM(t.Fajr || t.fajr),
    Sunrise: toHHMM(t.Sunrise || t.sunrise || t.shuruq_sunrise),
    Dhuhr: toHHMM(t.Dhuhr || t.dhuhr || t.Duhr || t.duhr || t.Zuhr || t.zuhr),
    Asr: toHHMM(t.Asr || t.asr),
    Maghrib: toHHMM(t.Maghrib || t.maghrib),
    Isha: toHHMM(t.Isha || t.isha),
  };
}

function normalizeDateInput(input: "today" | "tomorrow" | string, tz: string) {
  const v = String(input || "today").trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const addDays = v === "tomorrow" ? 1 : 0;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);

  const baseUtc = new Date(Date.UTC(y, m - 1, d));
  baseUtc.setUTCDate(baseUtc.getUTCDate() + addDays);

  return `${baseUtc.getUTCFullYear()}-${String(baseUtc.getUTCMonth() + 1).padStart(2, "0")}-${String(baseUtc.getUTCDate()).padStart(2, "0")}`;
}

async function apiBonnetid(path: string, signal?: AbortSignal) {
  const res = await fetch(`/api/bonnetid?path=${encodeURIComponent(path)}`, { signal });
  return readJsonOrThrow(res, "Bonnetid proxy");
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const t = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(t), Math.sqrt(1 - t));
}

function roundedGeoKey(lat: number, lon: number) {
  return `${lat.toFixed(2)}:${lon.toFixed(2)}`;
}

function loadCache<T>(key: string, ttlMs: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (Date.now() - Number(parsed.ts || 0) > ttlMs) return null;
    return parsed.value ?? null;
  } catch {
    return null;
  }
}

function saveCache<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), value }));
  } catch {
    // ignore
  }
}

async function resolveBonnetidLocationId(lat: number, lon: number, signal?: AbortSignal) {
  const locCacheKey = `aq_bt_loc:${roundedGeoKey(lat, lon)}`;
  const cached = loadCache<number>(locCacheKey, BONNETID_LOCATION_TTL_MS);
  if (cached) return cached;

  const locations = await apiBonnetid("/locations/", signal);
  if (!Array.isArray(locations) || !locations.length) throw new Error("Bonnetid ga ingen lokasjoner");

  let nearest: any = null;
  let nearestDist = Number.POSITIVE_INFINITY;

  for (const item of locations) {
    const itemLat = Number(item?.lat);
    const itemLon = Number(item?.lon);
    if (!Number.isFinite(itemLat) || !Number.isFinite(itemLon)) continue;
    const d = haversineKm(lat, lon, itemLat, itemLon);
    if (d < nearestDist) {
      nearest = item;
      nearestDist = d;
    }
  }

  const id = Number(nearest?.pk);
  if (!Number.isFinite(id) || id <= 0) throw new Error("Kunne ikke bestemme nærmeste Bonnetid-lokasjon");

  saveCache(locCacheKey, id);
  return id;
}

function rowToDateString(row: any, year: number, month: number, index: number) {
  const explicit = String(row?.date || "");
  if (/^\d{4}-\d{2}-\d{2}/.test(explicit)) return explicit.slice(0, 10);

  const day = Number(row?.id ?? row?.day ?? row?.gregorian_date ?? index + 1);
  if (!Number.isFinite(day) || day < 1 || day > 31) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function mapBonnetidMonthRows(rows: any[], year: number, month: number): MonthRow[] {
  return rows
    .map((row, idx) => {
      const date = rowToDateString(row, year, month, idx);
      if (!date) return null;
      return {
        date,
        timings: ensure({
          fajr: row?.fajr,
          shuruq_sunrise: row?.shuruq_sunrise,
          duhr: row?.duhr,
          asr: row?.asr,
          maghrib: row?.maghrib,
          isha: row?.isha,
        }),
      };
    })
    .filter(Boolean) as MonthRow[];
}

function runDevSpotCheck(rows: MonthRow[], year: number, month: number, lat: number, lon: number) {
  if (!import.meta.env.DEV) return;
  if (!(year === 2026 && month === 2)) return;
  // Oslo area only (roughly) for requested acceptance spot-check.
  if (haversineKm(lat, lon, 59.9139, 10.7522) > 80) return;

  const row = rows.find((r) => r.date === "2026-02-21");
  if (!row) {
    console.error("[Bonnetid spot-check] ❌ Missing date 2026-02-21 in month data");
    return;
  }

  const expected = { Fajr: "05:35", Dhuhr: "12:35", Asr: "15:21", Maghrib: "17:28", Isha: "19:18" };
  const actual = row.timings;
  const mismatches = Object.entries(expected).filter(([k, v]) => (actual as any)[k] !== v);

  if (mismatches.length) {
    console.error("[Bonnetid spot-check] ❌ Mismatch for 2026-02-21", { expected, actual, mismatches });
  } else {
    console.info("[Bonnetid spot-check] ✅ Match for 2026-02-21", actual);
  }
}

export async function fetchMonthTimingsNO(
  year: number,
  month: number,
  lat: number,
  lon: number,
  tz: string,
  signal?: AbortSignal,
): Promise<MonthRow[]> {
  const roundedKey = roundedGeoKey(lat, lon);
  const cacheKey = `bonnetid:v2:${roundedKey}:${year}-${String(month).padStart(2, "0")}`;
  const cached = loadCache<MonthRow[]>(cacheKey, BONNETID_MONTH_TTL_MS);
  if (cached && cached.length) return cached;

  const inFlight = monthInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async () => {
    try {
      const rows = await fetchBonnetidMonthEndpoint(lat, lon, month, year, tz, signal);
      if (!rows.length) throw new Error("Bonnetid month endpoint returned empty rows");
      runDevSpotCheck(rows, year, month, lat, lon);
      saveCache(cacheKey, rows);
      return rows;
    } catch {
      // Fallback to legacy proxy path (kept for compatibility).
      const locationId = await resolveBonnetidLocationId(lat, lon, signal);
      const payload = await apiBonnetid(`/prayertimes/${locationId}/${year}/${month}/`, signal);
      if (!Array.isArray(payload)) throw new Error("Ugyldig månedsdata fra Bonnetid");
      const rows = mapBonnetidMonthRows(payload, year, month);
      if (!rows.length) throw new Error("Bonnetid fallback returned empty rows");
      runDevSpotCheck(rows, year, month, lat, lon);
      saveCache(cacheKey, rows);
      return rows;
    } finally {
      monthInFlight.delete(cacheKey);
    }
  })();

  monthInFlight.set(cacheKey, request);
  return request;
}


async function fetchBonnetidMonthEndpoint(
  lat: number,
  lon: number,
  month: number,
  year: number,
  tz: string,
  signal?: AbortSignal,
): Promise<MonthRow[]> {
  const url = new URL("/api/bonnetid-month", window.location.origin);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("tz", String(tz));
  url.searchParams.set("month", String(month));
  url.searchParams.set("year", String(year));

  const res = await fetch(url.toString(), { signal });
  const body = await readJsonOrThrow(res, "Bonnetid month");
  const rows = Array.isArray(body?.rows) ? body.rows : [];

  return rows
    .map((row: any) => ({
      date: String(row?.date || ""),
      weekday: row?.weekday,
      timings: ensure(row?.timings || {}),
    }))
    .filter((row: MonthRow) => /^\d{4}-\d{2}-\d{2}$/.test(row.date));
}

async function fetchAladhan(lat: number, lon: number, tz: string, when: "today" | "tomorrow", cc: string) {
  const u = `/api/aladhan-today?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&tz=${encodeURIComponent(tz)}&when=${encodeURIComponent(when)}&cc=${encodeURIComponent(cc)}`;
  const r = await fetch(u);
  const j = await readJsonOrThrow(r, "Aladhan");
  return ensure(j.timings);
}

export async function fetchTimings(
  lat: number,
  lon: number,
  tz: string,
  countryCode: string | undefined | null,
  when: "today" | "tomorrow" = "today",
): Promise<Timings> {
  const cc = (countryCode || "").toUpperCase();

  if (isNorway(cc, tz)) {
    const isoDate = normalizeDateInput(when, tz);

    // 1) Prefer dedicated Bonnetid day endpoint.
    try {
      const btUrl = new URL("/api/bonnetid-today", window.location.origin);
      btUrl.searchParams.set("lat", String(lat));
      btUrl.searchParams.set("lon", String(lon));
      btUrl.searchParams.set("tz", String(tz));
      btUrl.searchParams.set("when", isoDate);

      const btRes = await fetch(btUrl.toString());
      const btBody = await readJsonOrThrow(btRes, "Bonnetid today");
      const timings = ensure(btBody?.timings || btBody?.data?.timings || {});
      if (!looksSuspiciousNorway(timings)) return timings;
      console.error("[Prayer] /api/bonnetid-today returned suspicious timings", { isoDate, timings });
    } catch (err) {
      console.error("[Prayer] /api/bonnetid-today failed", {
        isoDate,
        error: err instanceof Error ? err.message : String(err),
      });
      // Continue to month fallback.
    }

    // 2) Fall back to Bonnetid month endpoint and pick requested date.
    const year = Number(isoDate.slice(0, 4));
    const month = Number(isoDate.slice(5, 7));
    const rows = await fetchMonthTimingsNO(year, month, lat, lon, tz);
    const dayRow = rows.find((r) => r.date === isoDate);
    if (dayRow && !looksSuspiciousNorway(dayRow.timings)) return dayRow.timings;

    throw new Error(`Bonnetid mangler gyldige tider for ${isoDate}`);
  }

  // Rest of world: Aladhan unchanged
  return fetchAladhan(lat, lon, tz, when, cc);
}

export async function fetchMonthTimings(
  lat: number,
  lon: number,
  month: number,
  year: number,
  tz: string,
  countryCode: string | undefined | null,
  signal?: AbortSignal,
): Promise<MonthRow[]> {
  if (isNorway(countryCode, tz)) {
    return fetchMonthTimingsNO(year, month, lat, lon, tz, signal);
  }

  return fetchAladhanMonth(lat, lon, month, year, tz, String((countryCode || "").toUpperCase()), signal);
}

async function fetchAladhanMonth(
  lat: number,
  lon: number,
  month: number,
  year: number,
  tz: string,
  cc: string,
  signal?: AbortSignal,
): Promise<MonthRow[]> {
  const adUrl = new URL("/api/aladhan-month", window.location.origin);
  adUrl.searchParams.set("lat", String(lat));
  adUrl.searchParams.set("lon", String(lon));
  adUrl.searchParams.set("tz", String(tz));
  adUrl.searchParams.set("month", String(month));
  adUrl.searchParams.set("year", String(year));
  adUrl.searchParams.set("cc", cc);

  const adRes = await fetch(adUrl.toString(), { signal });
  if (!adRes.ok) throw new Error(await adRes.text());
  const adBody = await adRes.json();
  const rows = Array.isArray(adBody?.rows) ? adBody.rows : [];
  return rows.map((row: any) => ({
    date: String(row?.date || ""),
    weekday: row?.weekday,
    timings: ensure(row?.timings || {}),
  }));
}
