// IRN municipality tables for Norway; existing Aladhan calculations abroad.
import { normalizeHHMM } from "./prayer-utils";

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
  source?: string;
  sourceLocation?: string;
};

export type UnifiedTimingRow = {
  source?: string;
  sourceLocation?: string;
  dateISO: string;
  fajr: string;
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
};

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

async function fetchAladhanMonth(
  lat: number,
  lon: number,
  month: number,
  year: number,
  tz: string,
  signal?: AbortSignal,
): Promise<MonthRow[]> {
  const adUrl = new URL("/api/aladhan-month", window.location.origin);
  adUrl.searchParams.set("lat", String(lat));
  adUrl.searchParams.set("lon", String(lon));
  adUrl.searchParams.set("tz", String(tz));
  adUrl.searchParams.set("month", String(month));
  adUrl.searchParams.set("year", String(year));

  const adRes = await fetch(adUrl.toString(), { signal });
  const adBody = await readJsonOrThrow(adRes, "Aladhan month");
  const rows = Array.isArray(adBody?.rows) ? adBody.rows : [];

  return rows.map((row: any) => {
    const normalized = ensure(row?.timings || {});
    const timings = normalized;
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
  let rows: MonthRow[];
  // This box only decides whether to ask Kartverket; it never decides the country.
  if (lat >= 57.8 && lat <= 81 && lon >= -10 && lon <= 35) {
    const url = new URL('/api/irn-month', window.location.origin);
    url.search = new URLSearchParams({ lat: String(lat), lon: String(lon), year: String(year), month: String(month) }).toString();
    const res = await fetch(url, { signal });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error || 'Kunne ikke hente IRNs bønnetider.');
    if (body.source === 'irn' && Array.isArray(body.rows) && body.rows.length) rows = body.rows;
    else if (body.source === 'not_norway') rows = await fetchAladhanMonth(lat, lon, month, year, tz, signal);
    else throw new Error('Ugyldig svar fra IRN-tilkoblingen.');
  } else rows = await fetchAladhanMonth(lat, lon, month, year, tz, signal);
  return rows.map((row) => ({
    source: row.source || 'aladhan',
    sourceLocation: row.sourceLocation,
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
    source: row.source,
    sourceLocation: row.sourceLocation,
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
  if (!row) throw new Error(`Missing prayer month row for ${targetIso}`);
  return {
    Fajr: row.fajr,
    Sunrise: row.sunrise,
    Dhuhr: row.dhuhr,
    Asr: row.asr,
    Maghrib: row.maghrib,
    Isha: row.isha,
  };
}

