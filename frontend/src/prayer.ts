// Unified prayer-time fetchers (Aladhan only)
import { applyOffset, normalizeHHMM } from "./prayer-utils";

const COUNTRY_CACHE_PREFIX = "aq_country_cache:";
const COUNTRY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NO_IRN_PROFILE = {
  fajrAngle: 16.0,
  ishaAngle: 15.0,
  latitudeAdj: 3,
  school: 1,
  offsets: { Fajr: -9, Dhuhr: 6, Asr: 0, Maghrib: 5, Isha: 0 },
};
const NORWAY_BBOX = { minLat: 57.8, maxLat: 71.3, minLon: 4.0, maxLon: 31.5 };

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

export type UnifiedTimingRow = {
  dateISO: string;
  fajr: string;
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
};

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function withinNorwayBoundingBox(lat: number, lon: number) {
  return lat >= NORWAY_BBOX.minLat && lat <= NORWAY_BBOX.maxLat && lon >= NORWAY_BBOX.minLon && lon <= NORWAY_BBOX.maxLon;
}

function cacheKeyForCoords(lat: number, lon: number) {
  return `${COUNTRY_CACHE_PREFIX}${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function readCountryFromCache(lat: number, lon: number): string {
  const storage = safeStorage();
  if (!storage) return "";
  try {
    const raw = storage.getItem(cacheKeyForCoords(lat, lon));
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    if (!parsed?.code || !parsed?.ts) return "";
    if (Date.now() - Number(parsed.ts) > COUNTRY_CACHE_TTL_MS) return "";
    return String(parsed.code).toLowerCase();
  } catch {
    return "";
  }
}

function writeCountryToCache(lat: number, lon: number, code: string) {
  const storage = safeStorage();
  if (!storage || !code) return;
  try {
    storage.setItem(cacheKeyForCoords(lat, lon), JSON.stringify({ code: code.toLowerCase(), ts: Date.now() }));
  } catch {
    // ignore
  }
}

export async function getCountryCode(lat: number, lon: number): Promise<string> {
  const cached = readCountryFromCache(lat, lon);
  if (cached) return cached;

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("zoom", "5");
    url.searchParams.set("addressdetails", "1");

    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);

    const data = await res.json();
    const code = String(data?.address?.country_code || "").toLowerCase();
    if (code) {
      writeCountryToCache(lat, lon, code);
      return code;
    }
  } catch (err) {
    if (withinNorwayBoundingBox(lat, lon)) {
      console.warn("[prayer] Reverse geocoding failed, using Norway bbox fallback.", err);
      return "no";
    }
  }

  return "";
}

export async function useNorwayProfile(lat: number, lon: number): Promise<boolean> {
  const cc = await getCountryCode(lat, lon);
  return cc === "no";
}

function ensure(t: any): Timings {
  return {
    Fajr: normalizeHHMM(t.Fajr || t.fajr),
    Sunrise: normalizeHHMM(t.Sunrise || t.sunrise || t.shuruq_sunrise),
    Dhuhr: normalizeHHMM(t.Dhuhr || t.dhuhr || t.Duhr || t.duhr || t.Zuhr || t.zuhr),
    Asr: normalizeHHMM(t.Asr || t.asr),
    Maghrib: normalizeHHMM(t.Maghrib || t.maghrib),
    Isha: normalizeHHMM(t.Isha || t.isha),
  };
}

function applyNoOffsets(t: Timings): Timings {
  return {
    ...t,
    Fajr: applyOffset(t.Fajr, NO_IRN_PROFILE.offsets.Fajr),
    Dhuhr: applyOffset(t.Dhuhr, NO_IRN_PROFILE.offsets.Dhuhr),
    Asr: applyOffset(t.Asr, NO_IRN_PROFILE.offsets.Asr),
    Maghrib: applyOffset(t.Maghrib, NO_IRN_PROFILE.offsets.Maghrib),
    Isha: applyOffset(t.Isha, NO_IRN_PROFILE.offsets.Isha),
  };
}

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

function isoDateInTz(tz: string, dayOffset = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  const utcDate = new Date(Date.UTC(y, m - 1, d));
  utcDate.setUTCDate(utcDate.getUTCDate() + dayOffset);
  const yyyy = utcDate.getUTCFullYear();
  const mm = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utcDate.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildAladhanQuery(profileEnabled: boolean) {
  const query: Record<string, string> = {};
  if (profileEnabled) {
    query.method = "99";
    query.fajr = String(NO_IRN_PROFILE.fajrAngle);
    query.isha = String(NO_IRN_PROFILE.ishaAngle);
    query.school = String(NO_IRN_PROFILE.school);
    query.latitudeAdjustmentMethod = String(NO_IRN_PROFILE.latitudeAdj);
  }
  return query;
}

async function fetchAladhanMonth(
  lat: number,
  lon: number,
  month: number,
  year: number,
  tz: string,
  profileEnabled: boolean,
  signal?: AbortSignal,
): Promise<MonthRow[]> {
  const adUrl = new URL("/api/aladhan-month", window.location.origin);
  adUrl.searchParams.set("lat", String(lat));
  adUrl.searchParams.set("lon", String(lon));
  adUrl.searchParams.set("tz", String(tz));
  adUrl.searchParams.set("month", String(month));
  adUrl.searchParams.set("year", String(year));

  const params = buildAladhanQuery(profileEnabled);
  Object.entries(params).forEach(([k, v]) => adUrl.searchParams.set(k, v));

  const adRes = await fetch(adUrl.toString(), { signal });
  const adBody = await readJsonOrThrow(adRes, "Aladhan month");
  const rows = Array.isArray(adBody?.rows) ? adBody.rows : [];

  return rows.map((row: any) => {
    const normalized = ensure(row?.timings || {});
    const timings = profileEnabled ? applyNoOffsets(normalized) : normalized;
    return {
      date: String(row?.date || ""),
      weekday: row?.weekday,
      timings,
    };
  });
}

export async function fetchTimingsMonthly(
  lat: number,
  lon: number,
  year: number,
  month: number,
  tz = "UTC",
  signal?: AbortSignal,
): Promise<UnifiedTimingRow[]> {
  const norway = await useNorwayProfile(lat, lon);
  const rows = await fetchAladhanMonth(lat, lon, month, year, tz, norway, signal);
  return rows.map((row) => ({
    dateISO: row.date,
    fajr: row.timings.Fajr,
    sunrise: row.timings.Sunrise,
    dhuhr: row.timings.Dhuhr,
    asr: row.timings.Asr,
    maghrib: row.timings.Maghrib,
    isha: row.timings.Isha,
  }));
}

export async function fetchMonthTimings(
  lat: number,
  lon: number,
  month: number,
  year: number,
  tz: string,
  _countryCode: string | undefined | null,
  signal?: AbortSignal,
): Promise<MonthRow[]> {
  const rows = await fetchTimingsMonthly(lat, lon, year, month, tz, signal);
  return rows.map((row) => ({
    date: row.dateISO,
    timings: {
      Fajr: row.fajr,
      Sunrise: row.sunrise,
      Dhuhr: row.dhuhr,
      Asr: row.asr,
      Maghrib: row.maghrib,
      Isha: row.isha,
    },
  }));
}

export async function fetchTimings(
  lat: number,
  lon: number,
  tz: string,
  _countryCode: string | undefined | null,
  when: "today" | "tomorrow" = "today",
): Promise<Timings> {
  const targetIso = isoDateInTz(tz, when === "tomorrow" ? 1 : 0);
  const [year, month] = targetIso.split("-").map(Number);
  const rows = await fetchTimingsMonthly(lat, lon, year, month, tz);
  const row = rows.find((d) => d.dateISO === targetIso);
  if (!row) throw new Error(`Missing Aladhan month row for ${targetIso}`);
  return {
    Fajr: row.fajr,
    Sunrise: row.sunrise,
    Dhuhr: row.dhuhr,
    Asr: row.asr,
    Maghrib: row.maghrib,
    Isha: row.isha,
  };
}

export async function runDevCompareMode() {
  if (!import.meta.env.DEV) return;
  const probes = [
    { name: "Oslo", lat: 59.9133, lon: 10.822, year: 2026, month: 2, day: "2026-02-22" },
    { name: "Tromsø", lat: 69.6492, lon: 18.9553, year: 2026, month: 2 },
    { name: "Bergen", lat: 60.3913, lon: 5.3221, year: 2026, month: 2 },
  ];

  for (const p of probes) {
    try {
      const rows = await fetchTimingsMonthly(p.lat, p.lon, p.year, p.month, "Europe/Oslo");
      if (p.day) {
        const row = rows.find((r) => r.dateISO === p.day);
        console.log(`[compare:${p.name}] ${p.day}`, row, {
          expectedBonnetid: { fajr: "05:32", dhuhr: "12:35", asr: "15:24", maghrib: "17:30", isha: "19:21" },
        });
      } else {
        console.log(`[compare:${p.name}] first 3 days`, rows.slice(0, 3));
      }
    } catch (err) {
      console.warn(`[compare:${p.name}] failed`, err);
    }
  }
}
