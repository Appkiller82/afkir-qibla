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

export type PrayerDiagnostics = {
  proxyStatus: string;
  chosenLocationId: number | null;
  lastFetchStatus: string;
};

const BONNETID_MONTH_TTL_MS = 12 * 60 * 60 * 1000;
const BONNETID_LOCATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const diag: PrayerDiagnostics = {
  proxyStatus: "idle",
  chosenLocationId: null,
  lastFetchStatus: "idle",
};

export function getPrayerDiagnostics() {
  return { ...diag };
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

function isNorway(countryCode: string | undefined | null, tz: string) {
  const cc = (countryCode || "").toUpperCase();
  if (cc === "NO") return true;
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
  return m ? m[1] : "";
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
  const fullPath = path.endsWith("/") ? path : `${path}/`;
  diag.proxyStatus = `proxy fetch ${fullPath}`;
  const res = await fetch(`/api/bonnetid?path=${encodeURIComponent(fullPath)}`, { signal });
  diag.proxyStatus = `proxy ${res.status} ${fullPath}`;
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
  } catch {}
}

async function resolveBonnetidLocationId(lat: number, lon: number, signal?: AbortSignal) {
  const cacheKey = `aq_bt_loc:${roundedGeoKey(lat, lon)}`;
  const cached = loadCache<number>(cacheKey, BONNETID_LOCATION_TTL_MS);
  if (cached) {
    diag.chosenLocationId = cached;
    diag.lastFetchStatus = "location cache hit";
    return cached;
  }

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
  if (!Number.isFinite(id) || id <= 0) throw new Error("Kunne ikke finne nærmeste Bonnetid-lokasjon");

  saveCache(cacheKey, id);
  diag.chosenLocationId = id;
  diag.lastFetchStatus = "location resolved";
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

async function fetchAladhan(lat: number, lon: number, tz: string, when: "today" | "tomorrow", cc: string) {
  const u = `/api/aladhan-today?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&tz=${encodeURIComponent(tz)}&when=${encodeURIComponent(when)}&cc=${encodeURIComponent(cc)}`;
  const r = await fetch(u);
  const j = await readJsonOrThrow(r, "Aladhan");
  return ensure(j.timings);
}

export async function fetchMonthTimingsNO(
  year: number,
  month: number,
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<MonthRow[]> {
  const locationId = await resolveBonnetidLocationId(lat, lon, signal);
  const cacheKey = `bonnetid:${locationId}:${year}-${String(month).padStart(2, "0")}`;
  const cached = loadCache<MonthRow[]>(cacheKey, BONNETID_MONTH_TTL_MS);
  if (cached && cached.length) {
    diag.lastFetchStatus = "month cache hit";
    return cached;
  }

  const payload = await apiBonnetid(`/prayertimes/${locationId}/${year}/${month}/`, signal);
  if (!Array.isArray(payload)) throw new Error("Ugyldig månedsdata fra Bonnetid");

  const rows = mapBonnetidMonthRows(payload, year, month);
  saveCache(cacheKey, rows);
  diag.lastFetchStatus = `month ok (${rows.length} rows)`;
  return rows;
}

export async function fetchTimings(
  lat: number,
  lon: number,
  tz: string,
  countryCode: string | undefined | null,
  when: "today" | "tomorrow" = "today",
): Promise<Timings> {
  const cc = (countryCode || "").toUpperCase();
  if (cc === "NO") return true;
  // Hard requirement: fallback to timezone when geo/country is missing.
  return !cc && String(tz || "") === "Europe/Oslo";
}

  if (isNorway(cc, tz)) {
    const isoDate = normalizeDateInput(when, tz);
    const year = Number(isoDate.slice(0, 4));
    const month = Number(isoDate.slice(5, 7));
    const rows = await fetchMonthTimingsNO(year, month, lat, lon);
    const dayRow = rows.find((r) => r.date === isoDate);
    if (dayRow) {
      diag.lastFetchStatus = `today ${isoDate} ok`;
      return dayRow.timings;
    }
    throw new Error(`Bonnetid mangler dag ${isoDate}`);
  }

  diag.lastFetchStatus = "aladhan";
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
    return fetchMonthTimingsNO(year, month, lat, lon, signal);
  }

  const adUrl = new URL("/api/aladhan-month", window.location.origin);
  adUrl.searchParams.set("lat", String(lat));
  adUrl.searchParams.set("lon", String(lon));
  adUrl.searchParams.set("tz", String(tz));
  adUrl.searchParams.set("month", String(month));
  adUrl.searchParams.set("year", String(year));
  adUrl.searchParams.set("cc", String((countryCode || "").toUpperCase()));

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
  signal?: AbortSignal,
): Promise<MonthRow[]> {
  const locationId = await resolveBonnetidLocationId(lat, lon, signal);
  const cacheKey = `bonnetid:${locationId}:${year}-${String(month).padStart(2, "0")}`;
  const cached = loadCache<MonthRow[]>(cacheKey, BONNETID_MONTH_TTL_MS);
  if (cached && cached.length) return cached;

  const payload = await apiBonnetid(`/prayertimes/${locationId}/${year}/${month}/`, signal);
  if (!Array.isArray(payload)) throw new Error("Ugyldig månedsdata fra Bonnetid");

  const rows = mapBonnetidMonthRows(payload, year, month);
  runDevSpotCheck(rows, year, month, lat, lon);
  saveCache(cacheKey, rows);
  return rows;
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
    const year = Number(isoDate.slice(0, 4));
    const month = Number(isoDate.slice(5, 7));
    const rows = await fetchMonthTimingsNO(year, month, lat, lon);
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
    return fetchMonthTimingsNO(year, month, lat, lon, signal);
  }

  const adUrl = new URL("/api/aladhan-month", window.location.origin);
  adUrl.searchParams.set("lat", String(lat));
  adUrl.searchParams.set("lon", String(lon));
  adUrl.searchParams.set("tz", String(tz));
  adUrl.searchParams.set("month", String(month));
  adUrl.searchParams.set("year", String(year));
  adUrl.searchParams.set("cc", String((countryCode || "").toUpperCase()));

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
