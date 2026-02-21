// Unified prayer-time fetchers (temporary):
// - Norway: Aladhan with NO tuning profile from server endpoint
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
  return fetchAladhan(lat, lon, tz, when, normalizedCc);
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
