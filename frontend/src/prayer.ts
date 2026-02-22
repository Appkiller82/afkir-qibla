// Unified prayer-time fetchers (Bonnetid via Netlify functions)
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

type BonnetidLocation = {
  id?: string | number;
  location_id?: string | number;
  lat?: number | string;
  lon?: number | string;
  latitude?: number | string;
  longitude?: number | string;
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
    Sunrise: normalizeHHMM(t.Sunrise || t.sunrise || t.shuruq_sunrise || t.Shuruq),
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

function pick(obj: any, keys: string[]) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return "";
}

function parseDateISO(row: any): string {
  const raw = String(
    pick(row, ["date", "gregorian_date", "gregorianDate", "date_gregorian", "dateISO", "day", "dato"]) || "",
  ).trim();
  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function parseTimings(row: any): Timings {
  const candidate = row?.timings || row;
  return ensure({
    Fajr: pick(candidate, ["Fajr", "fajr"]),
    Sunrise: pick(candidate, ["Sunrise", "sunrise", "Shuruq", "shuruq_sunrise"]),
    Dhuhr: pick(candidate, ["Dhuhr", "Duhr", "Zuhr", "dhuhr", "duhr", "zuhr"]),
    Asr: pick(candidate, ["Asr", "asr"]),
    Maghrib: pick(candidate, ["Maghrib", "maghrib"]),
    Isha: pick(candidate, ["Isha", "isha"]),
  });
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

function distance2(aLat: number, aLon: number, bLat: number, bLon: number) {
  const dLat = aLat - bLat;
  const dLon = aLon - bLon;
  return dLat * dLat + dLon * dLon;
}

function findNearestLocationId(locations: BonnetidLocation[], lat: number, lon: number): string {
  let bestId = "";
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const loc of locations) {
    const id = String(pick(loc, ["location_id", "id"]));
    if (!id) continue;

    const locLat = toNumber(pick(loc, ["lat", "latitude"]));
    const locLon = toNumber(pick(loc, ["lon", "lng", "longitude"]));
    if (!Number.isFinite(locLat) || !Number.isFinite(locLon)) continue;

    const d = distance2(lat, lon, locLat, locLon);
    if (d < bestDistance) {
      bestDistance = d;
      bestId = id;
    }
  }

  if (!bestId && locations.length > 0) {
    bestId = String(pick(locations[0], ["location_id", "id"]));
  }

  if (!bestId) throw new Error("Bonnetid locations missing usable id");
  return bestId;
}

async function fetchBonnetidMonth(
  lat: number,
  lon: number,
  month: number,
  year: number,
  signal?: AbortSignal,
): Promise<MonthRow[]> {
  const locationsUrl = new URL("/.netlify/functions/bonnetid_locations", window.location.origin);
  const locationsRes = await fetch(locationsUrl.toString(), { signal });
  const locationsBody = await readJsonOrThrow(locationsRes, "Bonnetid locations");
  const locations = Array.isArray(locationsBody)
    ? locationsBody
    : Array.isArray(locationsBody?.results)
      ? locationsBody.results
      : Array.isArray(locationsBody?.data)
        ? locationsBody.data
        : [];

  if (!locations.length) {
    throw new Error("Bonnetid locations returned no rows");
  }

  const locationId = findNearestLocationId(locations, lat, lon);
  const monthUrl = new URL("/.netlify/functions/bonnetid_prayertimes_month", window.location.origin);
  monthUrl.searchParams.set("location_id", locationId);
  monthUrl.searchParams.set("year", String(year));
  monthUrl.searchParams.set("month", String(month));

  const monthRes = await fetch(monthUrl.toString(), { signal });
  const monthBody = await readJsonOrThrow(monthRes, "Bonnetid month");
  const rows = Array.isArray(monthBody)
    ? monthBody
    : Array.isArray(monthBody?.results)
      ? monthBody.results
      : Array.isArray(monthBody?.data)
        ? monthBody.data
        : [];

  return rows
    .map((row: any) => {
      const date = parseDateISO(row);
      const normalized = parseTimings(row);
      return {
        date,
        weekday: String(pick(row, ["weekday", "ukedag"]) || ""),
        timings: normalized,
      };
    })
    .filter((row: MonthRow) => Boolean(row.date));
}

export async function fetchTimingsMonthly(
  lat: number,
  lon: number,
  year: number,
  month: number,
  _tz = "UTC",
  signal?: AbortSignal,
): Promise<UnifiedTimingRow[]> {
  const norway = await useNorwayProfile(lat, lon);
  const rows = await fetchBonnetidMonth(lat, lon, month, year, signal);
  return rows.map((row) => {
    const timings = norway ? applyNoOffsets(row.timings) : row.timings;
    return {
      dateISO: row.date,
      fajr: timings.Fajr,
      sunrise: timings.Sunrise,
      dhuhr: timings.Dhuhr,
      asr: timings.Asr,
      maghrib: timings.Maghrib,
      isha: timings.Isha,
    };
  });
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
  if (!row) throw new Error(`Missing Bonnetid month row for ${targetIso}`);
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
