// Unified prayer-time fetchers:
// - Norway: Bonnetid month endpoint via Netlify proxy
// - Rest of world: Aladhan standard profile
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

function isNorway(countryCode: string | undefined | null, tz: string) {
  const cc = (countryCode || "").toUpperCase();
  if (cc === "NO") return true;
  return String(tz || "") === "Europe/Oslo";
}

const LOCATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_TTL_MS = 12 * 60 * 60 * 1000;

function storageRead<T>(key: string, ttlMs: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.value || !parsed?.ts) return null;
    if (Date.now() - Number(parsed.ts) > ttlMs) return null;
    return parsed.value as T;
  } catch {
    return null;
  }
}

function storageWrite<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify({ value, ts: Date.now() }));
  } catch {
    // ignore storage quota / private mode errors
  }
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

async function apiBonnetid(path: string, signal?: AbortSignal) {
  const url = `/api/bonnetid?path=${encodeURIComponent(path)}`;
  const res = await fetch(url, { signal });
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

function locationCacheKey(lat: number, lon: number) {
  return `bonnetid:loc:${lat.toFixed(2)}:${lon.toFixed(2)}`;
}

async function resolveLocationId(lat: number, lon: number, signal?: AbortSignal): Promise<number> {
  const cacheKey = locationCacheKey(lat, lon);
  const cached = storageRead<number>(cacheKey, LOCATION_TTL_MS);
  if (cached) return cached;

  const list = await apiBonnetid("/locations/", signal);
  if (!Array.isArray(list) || list.length === 0) throw new Error("Bonnetid locations payload is empty");

  let bestId = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of list) {
    const itemLat = Number(item?.lat);
    const itemLon = Number(item?.lon);
    const id = Number(item?.pk ?? item?.id);
    if (!Number.isFinite(itemLat) || !Number.isFinite(itemLon) || !Number.isFinite(id)) continue;
    const dist = haversineKm(lat, lon, itemLat, itemLon);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestId = id;
    }
  }

  if (!bestId) throw new Error("Could not resolve Bonnetid location_id");
  storageWrite(cacheKey, bestId);
  return bestId;
}

function monthCacheKey(locationId: number, year: number, month: number) {
  return `bonnetid:${locationId}:${year}-${pad2(month)}`;
}

function mapBonnetidMonth(rows: any[], year: number, month: number): MonthRow[] {
  return rows.map((row: any, index: number) => {
    const day = Number(row?.day ?? row?.id ?? row?.gregorian_day ?? index + 1);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || ""))
      ? String(row.date).slice(0, 10)
      : `${year}-${pad2(month)}-${pad2(day)}`;
    const timings = {
      fajr: row?.fajr,
      shuruq_sunrise: row?.shuruq_sunrise,
      duhr: row?.duhr,
      asr: row?.asr,
      maghrib: row?.maghrib,
      isha: row?.isha,
    };

    return {
      date,
      weekday: row?.weekday,
      timings: ensure(timings),
    };
  });
}

function dateInTz(tz: string, dayOffset = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + dayOffset);
  return {
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate(),
    iso: `${utcDate.getUTCFullYear()}-${pad2(utcDate.getUTCMonth() + 1)}-${pad2(utcDate.getUTCDate())}`,
  };
}

async function fetchMonthTimingsNO(
  year: number,
  month: number,
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<MonthRow[]> {
  const locationId = await resolveLocationId(lat, lon, signal);
  const cacheKey = monthCacheKey(locationId, year, month);
  const cached = storageRead<MonthRow[]>(cacheKey, MONTH_TTL_MS);
  if (cached?.length) return cached;

  const payload = await apiBonnetid(`/prayertimes/${locationId}/${year}/${month}/`, signal);
  if (!Array.isArray(payload)) throw new Error("Bonnetid month payload is invalid");
  const mapped = mapBonnetidMonth(payload, year, month);
  storageWrite(cacheKey, mapped);
  return mapped;
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
  const normalizedCc = isNorway(cc, tz) ? "NO" : cc;
  if (normalizedCc !== "NO") return fetchAladhan(lat, lon, tz, when, normalizedCc);

  const target = dateInTz(tz, when === "tomorrow" ? 1 : 0);
  const monthRows = await fetchMonthTimingsNO(target.year, target.month, lat, lon);
  const dayRow = monthRows.find((row) => row.date === target.iso);
  if (!dayRow) throw new Error(`Bonnetid day missing for ${target.iso}`);
  return dayRow.timings;
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
  const cc = String((countryCode || "").toUpperCase());
  const normalizedCc = isNorway(cc, tz) ? "NO" : cc;
  if (normalizedCc === "NO") {
    return fetchMonthTimingsNO(year, month, lat, lon, signal);
  }
  const adUrl = new URL("/api/aladhan-month", window.location.origin);
  adUrl.searchParams.set("lat", String(lat));
  adUrl.searchParams.set("lon", String(lon));
  adUrl.searchParams.set("tz", String(tz));
  adUrl.searchParams.set("month", String(month));
  adUrl.searchParams.set("year", String(year));
  adUrl.searchParams.set("cc", normalizedCc);

  const adRes = await fetch(adUrl.toString(), { signal });
  const adBody = await readJsonOrThrow(adRes, "Aladhan month");
  const rows = Array.isArray(adBody?.rows) ? adBody.rows : [];

  return rows.map((row: any) => ({
    date: String(row?.date || ""),
    weekday: row?.weekday,
    timings: ensure(row?.timings || {}),
  }));
}

export async function debugCheckBonnetidOsloFebruary2026(signal?: AbortSignal) {
  const rows = await fetchMonthTimingsNO(2026, 2, 59.9139, 10.7522, signal);
  const target = rows.find((r) => r.date === "2026-02-21");
  const expected = { Fajr: "05:35", Dhuhr: "12:35", Asr: "15:21", Maghrib: "17:28", Isha: "19:18" };
  const actual = {
    Fajr: target?.timings?.Fajr || "",
    Dhuhr: target?.timings?.Dhuhr || "",
    Asr: target?.timings?.Asr || "",
    Maghrib: target?.timings?.Maghrib || "",
    Isha: target?.timings?.Isha || "",
  };
  const mismatch = Object.entries(expected).filter(([k, v]) => (actual as any)[k] !== v);
  if (mismatch.length) {
    throw new Error(`Bonnetid spot-check mismatch ${JSON.stringify({ expected, actual })}`);
  }
  return actual;
}
