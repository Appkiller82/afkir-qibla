// netlify/functions/calcNextPrayer.ts

type PrayerName = "Fajr" | "Dhuhr" | "Asr" | "Maghrib" | "Isha";

const NO_IRN_PROFILE = {
  fajrAngle: 18.0,
  ishaAngle: 14.0,
  latitudeAdj: 3, // AngleBased
  school: 0,      // Shafi/Maliki/Hanbali
  offsets: { Fajr: -9, Dhuhr: +12, Asr: 0, Maghrib: +8, Isha: -46 },
};

// Norge-boks (grovt, men trygt)
function isInNorway(lat: number, lon: number): boolean {
  return lat >= 57.9 && lat <= 71.2 && lon >= 4.5 && lon <= 31.5;
}

export async function calcNextPrayer(
  lat: number,
  lon: number,
  tz: string,
  madhhab?: string | number
): Promise<{ name: PrayerName; time: number }> {
  const now = Date.now();

  // Hent dagens tider
  const today = await getTimings(lat, lon, tz, isInNorway(lat, lon), madhhab);

  // Finn første bønn frem i tid i dag
  const candidateToday = pickNext(today, tz, now);
  if (candidateToday) return candidateToday;

  // Ellers: ta neste dags tider og velg Fajr
  const tomorrow = await getTimings(lat, lon, tz, isInNorway(lat, lon), madhhab, /*tomorrow*/ true);
  const fajr = tomorrow.Fajr;
  const fajrMs = toMillisLocalDate(fajr, tz, /*isTomorrow*/ true);
  return { name: "Fajr", time: fajrMs };
}

/** Henter bønnetider fra Aladhan. For Norge bruker vi method=99 + IRN-tuning; ellers method=5 (Egyptian). */
async function getTimings(
  lat: number,
  lon: number,
  tz: string,
  useIRN: boolean,
  madhhab?: string | number,
  tomorrow = false
): Promise<Record<PrayerName, string>> {
  // Velg dato (dd-mm-yyyy i UTC)
  const base = new Date();
  if (tomorrow) base.setUTCDate(base.getUTCDate() + 1);
  const dd = String(base.getUTCDate()).padStart(2, "0");
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = base.getUTCFullYear();

  let url = `https://api.aladhan.com/v1/timings/${dd}-${mm}-${yyyy}?latitude=${lat}&longitude=${lon}&timezonestring=${encodeURIComponent(
    tz
  )}`;

  if (useIRN) {
    const t = NO_IRN_PROFILE.offsets;
    const tune = [t.Fajr, t.Dhuhr, t.Asr, t.Maghrib, t.Isha].join(",");
    url += `&method=99&methodSettings=${NO_IRN_PROFILE.fajrAngle},0,${NO_IRN_PROFILE.ishaAngle}` +
           `&latitudeAdjustmentMethod=${NO_IRN_PROFILE.latitudeAdj}` +
           `&school=${NO_IRN_PROFILE.school}` +
           `&tune=${tune}`;
  } else {
    // Globalt: Egyptian (5). school: 1=Hanafi, 0=Shafi/Maliki/Hanbali
    const school = (madhhab === 1 || String(madhhab).toLowerCase() === "hanafi") ? 1 : 0;
    url += `&method=5&school=${school}`;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Aladhan error ${res.status}`);
  const json = await res.json();

  const t = json?.data?.timings;
  if (!t) throw new Error("No timings from Aladhan");

  // Returner HH:mm-strenger
  return {
    Fajr:   normalizeTime(t.Fajr),
    Dhuhr:  normalizeTime(t.Dhuhr),
    Asr:    normalizeTime(t.Asr),
    Maghrib:normalizeTime(t.Maghrib),
    Isha:   normalizeTime(t.Isha),
  };
}

/** Plukker første bønn etter 'nowMs' blant dagens tider. */
function pickNext(
  timings: Record<PrayerName, string>,
  tz: string,
  nowMs: number
): { name: PrayerName; time: number } | null {
  const order: PrayerName[] = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
  let best: { name: PrayerName; time: number } | null = null;
  for (const name of order) {
    const ms = toMillisLocalDate(timings[name], tz, /*tomorrow*/ false);
    if (ms > nowMs && (!best || ms < best.time)) best = { name, time: ms };
  }
  return best;
}

/** Konverterer "HH:mm" i gitt tz til epoch ms i dag (eller i morgen hvis isTomorrow=true). */
function toMillisLocalDate(hhmm: string, tz: string, isTomorrow: boolean): number {
  // Få lokal dato i tz, sett time/min
  const now = new Date();
  // Lag et "lokalt" tidspunkt i tz ved å beregne offset via Intl
  const locale = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  if (isTomorrow) locale.setDate(locale.getDate() + 1);
  const [h, m] = hhmm.split(":").map(Number);
  locale.setHours(h, m, 0, 0);
  return locale.getTime();
}

/** Fjerner evt. " (CEST)"-suffix og returnerer "HH:mm" */
function normalizeTime(s: string): string {
  // Aladhan kan returnere "04:12 (CEST)" — behold kun HH:MM
  const m = s.match(/^(\d{1,2}:\d{2})/);
  return m ? m[1] : s;
}
