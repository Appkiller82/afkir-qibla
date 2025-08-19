// netlify/functions/tick.ts
import type { Handler } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

// Kjør hvert minutt
export const config = { schedule: '@minutely' };

// --- IRN-lignende profil for Norge (samme som i app.jsx) ---
const NO_IRN_PROFILE = {
  fajrAngle: 18.0,
  ishaAngle: 14.0,
  maghribAngle: 0,     // 0 = bruk solnedgang
  latitudeAdj: 3,      // AngleBased (Aladhan latitudeAdjustmentMethod=3)
  school: 0,           // Maliki/Shafi/Hanbali = 0, Hanafi = 1
  offsets: {           // i minutter
    Fajr: -9,
    Dhuhr: 12,
    Asr: 0,
    Maghrib: 8,
    Isha: -46,
    Sunrise: 0,        // ikke spesifisert hos deg, setter 0
  },
};

// Global fallback
const GLOBAL_METHOD = 5; // Egyptian
const PRAYER_ORDER: Array<'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha'> = [
  'Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha',
];

type SubRecord = {
  meta: {
    id: string;
    tz?: string;
    lat?: number;
    lon?: number;
    madhhab?: string;   // 'hanafi' -> school=1
    nextFireAt?: number;
    createdAt?: string;
  };
  sub: any;             // PushSubscription JSON
};

export const handler: Handler = async () => {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env as Record<string, string | undefined>;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    return { statusCode: 500, body: 'Missing VAPID env vars' };
  }

  // web-push (CJS/ESM-safe)
  const mod: any = await import('web-push');
  const webpush = mod.default ?? mod;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const store = getStore({ name: 'push-subs' });
  const list = await store.list({ prefix: 'subs/' });

  const now = Date.now();
  let processed = 0, sent = 0;

  for (const b of list.blobs || []) {
    const rec = await store.getJSON<SubRecord>(b.key);
    if (!rec?.sub?.endpoint) continue;
    processed++;

    // Bootstrap første gang
    if (!rec.meta.nextFireAt) {
      rec.meta.nextFireAt = await calcNextPrayerEpoch(rec).catch(() => undefined);
      await store.setJSON(b.key, rec);
      continue;
    }

    // Due?
    if (rec.meta.nextFireAt <= now) {
      try {
        await webpush.sendNotification(
          rec.sub,
          JSON.stringify({
            title: 'Bønnetid 🔔',
            body: 'Det er tid for bønn.',
            url: '/',
          })
        );
        sent++;

        // Sett neste
        rec.meta.nextFireAt = await calcNextPrayerEpoch(rec).catch(() => now + 60 * 60 * 1000);
        await store.setJSON(b.key, rec);
      } catch (err: any) {
        // 410 = subscription er “gone”
        if (err?.statusCode === 410) {
          try { await store.delete(b.key); } catch {}
        } else {
          console.error('tick send error:', err?.message || err);
        }
      }
    }
  }

  return { statusCode: 200, body: `tick ok; processed=${processed}, sent=${sent}` };
};

/** Beregn neste bønn (epoch ms) */
async function calcNextPrayerEpoch(rec: SubRecord): Promise<number | undefined> {
  const { lat, lon, tz, madhhab } = rec.meta;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !tz) return undefined;

  const isNorway = tz === 'Europe/Oslo'; // enkel, robust sjekk

  const today = toTZDate(tz); // "nå" i tz
  const y = today.getUTCFullYear(), m = today.getUTCMonth() + 1, d = today.getUTCDate();

  const url = isNorway
    ? buildNorwayUrl(y, m, d, lat, lon, tz)
    : buildGlobalUrl(y, m, d, lat, lon, tz, GLOBAL_METHOD, madhhab === 'hanafi' ? 1 : 0);

  const t = await fetchTimings(url);
  if (!t) return undefined;

  const schedule = {
    Fajr: toEpochInTZ(tz, t.Fajr),
    Dhuhr: toEpochInTZ(tz, t.Dhuhr),
    Asr: toEpochInTZ(tz, t.Asr),
    Maghrib: toEpochInTZ(tz, t.Maghrib),
    Isha: toEpochInTZ(tz, t.Isha),
  };

  const nowEpoch = toTZDate(tz).getTime();
  for (const p of PRAYER_ORDER) {
    if (schedule[p] > nowEpoch) return schedule[p];
  }

  // Neste dags Fajr
  const tmr = toTZDate(tz);
  tmr.setDate(tmr.getDate() + 1);
  const y2 = tmr.getUTCFullYear(), m2 = tmr.getUTCMonth() + 1, d2 = tmr.getUTCDate();

  const url2 = isNorway
    ? buildNorwayUrl(y2, m2, d2, lat, lon, tz)
    : buildGlobalUrl(y2, m2, d2, lat, lon, tz, GLOBAL_METHOD, madhhab === 'hanafi' ? 1 : 0);

  const t2 = await fetchTimings(url2);
  return t2?.Fajr ? toEpochInTZ(tz, t2.Fajr) : undefined;
}

/** ---------- helpers ---------- **/

function buildGlobalUrl(
  y: number, m: number, d: number,
  lat: number, lon: number, tz: string,
  method: number, school: 0 | 1,
) {
  const base = 'https://api.aladhan.com/v1/timings';
  const qs =
    `${y}-${m}-${d}` +
    `?latitude=${lat}&longitude=${lon}` +
    `&method=${method}` +
    `&school=${school}` +
    `&timezonestring=${encodeURIComponent(tz)}`;
  return `${base}/${qs}`;
}

/** Norway tuning via Aladhan Custom (method=99) + tune + latitudeAdjustmentMethod */
function buildNorwayUrl(y: number, m: number, d: number, lat: number, lon: number, tz: string) {
  const base = 'https://api.aladhan.com/v1/timings';
  const method = 99;

  // methodSettings: fajrAngle,maghribAngle,ishaAngle
  const methodSettings = `${NO_IRN_PROFILE.fajrAngle},${NO_IRN_PROFILE.maghribAngle},${NO_IRN_PROFILE.ishaAngle}`;

  // tune: Fajr,Sunrise,Dhuhr,Asr,Maghrib,Isha (i minutter)
  const tune = [
    NO_IRN_PROFILE.offsets.Fajr,
    NO_IRN_PROFILE.offsets.Sunrise,
    NO_IRN_PROFILE.offsets.Dhuhr,
    NO_IRN_PROFILE.offsets.Asr,
    NO_IRN_PROFILE.offsets.Maghrib,
    NO_IRN_PROFILE.offsets.Isha,
  ].join(',');

  // latitudeAdjustmentMethod: 1=MiddleOfNight, 2=OneSeventh, 3=AngleBased
  const lam = NO_IRN_PROFILE.latitudeAdj;

  const qs =
    `${y}-${m}-${d}` +
    `?latitude=${lat}&longitude=${lon}` +
    `&method=${method}` +
    `&methodSettings=${encodeURIComponent(methodSettings)}` +
    `&tune=${encodeURIComponent(tune)}` +
    `&latitudeAdjustmentMethod=${lam}` +
    `&school=${NO_IRN_PROFILE.school}` +
    `&timezonestring=${encodeURIComponent(tz)}`;

  return `${base}/${qs}`;
}

async function fetchTimings(url: string): Promise<any | undefined> {
  try {
    const resp = await fetch(url);
    const json = await resp.json();
    return json?.data?.timings;
  } catch {
    return undefined;
  }
}

/** "Nå" i gitt tz som Date (UTC-feltene satt etter tz) */
function toTZDate(tz: string): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
  const y = get('year'), m = get('month'), d = get('day');
  const hh = get('hour'), mm = get('minute'), ss = get('second');
  return new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
}

/** Konverter "HH:mm" i tz til epoch ms */
function toEpochInTZ(tz: string, hhmm: string): number {
  const [hh, mm] = hhmm.split(':').map((n) => parseInt(n, 10));
  const dt = toTZDate(tz);
  dt.setUTCHours(hh, mm, 0, 0);
  return dt.getTime();
}
