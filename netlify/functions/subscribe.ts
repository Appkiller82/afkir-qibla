// netlify/functions/subscribe.ts
import type { Handler } from '@netlify/functions';

const UP_URL = process.env.UPSTASH_REDIS_REST_URL!;
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

const NO_IRN_PROFILE = {
  fajrAngle: 18.0,
  ishaAngle: 14.0,
  latitudeAdj: 3,
  school: 0,
  offsets: { Fajr: -9, Dhuhr: +12, Asr: 0, Maghrib: +8, Isha: -46 },
};

async function redis(cmd: string[], retry = 1): Promise<any> {
  if (!UP_URL || !UP_TOKEN) throw new Error('Upstash env vars mangler');
  const res = await fetch(UP_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ command: cmd }),
  });
  if (!res.ok && retry > 0) return redis(cmd, retry - 1);
  if (!res.ok) throw new Error(`Redis error ${res.status}`);
  return res.json();
}

function idFromEndpoint(ep: string) {
  return Buffer.from(ep).toString('base64url');
}

function mkDate(ymdStr: string, hhmm: string) {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  const d = new Date(`${ymdStr}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d;
}

async function aladhan(lat: number, lng: number, when: 'today' | 'tomorrow', opts: any) {
  const tz = opts?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const p = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    timezonestring: tz,
    iso8601: 'true',
  });

  if ((opts?.countryCode || '').toUpperCase() === 'NO') {
    p.set('method', '99');
    p.set('fajr', String(NO_IRN_PROFILE.fajrAngle));
    p.set('isha', String(NO_IRN_PROFILE.ishaAngle));
    p.set('school', String(NO_IRN_PROFILE.school));
    p.set('latitudeAdjustmentMethod', String(NO_IRN_PROFILE.latitudeAdj));
  } else {
    p.set('method', '5');
    p.set('school', '0');
  }

  const url = `https://api.aladhan.com/v1/timings/${when}?${p.toString()}`;
  const res = await fetch(url);
  const j = await res.json();
  if (j.code !== 200) throw new Error('AlAdhan error');

  const t = j.data.timings;
  const greg = j.data?.date?.gregorian?.date; // DD-MM-YYYY
  const [dd, mm, yyyy] = greg.split('-').map((x: string) => parseInt(x, 10));
  const YMD = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;

  const base = {
    Fajr: mkDate(YMD, t.Fajr),
    Sunrise: mkDate(YMD, t.Sunrise),
    Dhuhr: mkDate(YMD, t.Dhuhr),
    Asr: mkDate(YMD, t.Asr),
    Maghrib: mkDate(YMD, t.Maghrib),
    Isha: mkDate(YMD, t.Isha),
  };

  if ((opts?.countryCode || '').toUpperCase() === 'NO') {
    const o = NO_IRN_PROFILE.offsets;
    base.Fajr.setMinutes(base.Fajr.getMinutes() + (o.Fajr || 0));
    base.Dhuhr.setMinutes(base.Dhuhr.getMinutes() + (o.Dhuhr || 0));
    base.Asr.setMinutes(base.Asr.getMinutes() + (o.Asr || 0));
    base.Maghrib.setMinutes(base.Maghrib.getMinutes() + (o.Maghrib || 0));
    base.Isha.setMinutes(base.Isha.getMinutes() + (o.Isha || 0));
  }
  return base;
}

const ORDER = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;

function nextPrayer(times: Record<string, Date>) {
  const now = Date.now();
  for (const k of ORDER) {
    const d = times[k];
    if (d && d.getTime() > now) return { name: k, at: d.getTime() };
  }
  return null;
}

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    const json = JSON.parse(event.body || '{}');
    const sub = json.subscription;
    const meta = json.meta || {};
    if (!sub?.endpoint) return { statusCode: 400, body: 'Missing subscription.endpoint' };
    if (typeof meta.lat !== 'number' || typeof meta.lng !== 'number') {
      return { statusCode: 400, body: 'Missing meta.lat/lng' };
    }

    const id = idFromEndpoint(sub.endpoint);
    const countryCode = String(meta.countryCode || '').toUpperCase();
    const tz = meta.tz || 'UTC';

    const today = await aladhan(meta.lat, meta.lng, 'today', { countryCode, tz });
    let nxt = nextPrayer(today);
    if (!nxt) {
      const tomorrow = await aladhan(meta.lat, meta.lng, 'tomorrow', { countryCode, tz });
      nxt = { name: 'Fajr', at: tomorrow.Fajr.getTime() };
    }

    const key = `sub:${id}`;
    await redis(['HSET', key,
      'endpoint', sub.endpoint,
      'keys', JSON.stringify(sub.keys || {}),
      'lat', String(meta.lat),
      'lng', String(meta.lng),
      'city', meta.city || '',
      'countryCode', countryCode,
      'tz', tz,
      'nextName', nxt.name,
      'nextAt', String(nxt.at),
      'active', '1',
    ]);
    await redis(['SADD', 'subs:all', id]);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, id }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: `subscribe failed: ${e?.message || String(e)}` };
  }
};
