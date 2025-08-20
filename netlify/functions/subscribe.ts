// netlify/functions/subscribe.ts
import type { Handler } from '@netlify/functions';

/**
 * subscribe.ts (auto-upsert, tolerant)
 * - Always returns 200 OK unless JSON is invalid or subscription is missing.
 * - If Upstash + metadata (lat/lng) are provided, upserts the record and computes next prayer time.
 * - Uses manual base64url to be compatible with Netlify runtimes.
 * - Designed to work smoothly with updateMetaIfSubscribed() being called often.
 */

const UP_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

const NO_IRN_PROFILE = {
  fajrAngle: 18.0, ishaAngle: 14.0, latitudeAdj: 3, school: 0,
  offsets: { Fajr: -9, Dhuhr: +12, Asr: 0, Maghrib: +8, Isha: -46 },
};

type Times = Record<'Fajr'|'Sunrise'|'Dhuhr'|'Asr'|'Maghrib'|'Isha', Date>;

function idFromEndpoint(ep: string) {
  const b64 = Buffer.from(ep).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function redis(cmd: string[], retry = 1): Promise<any> {
  if (!UP_URL || !UP_TOKEN) throw new Error('NO_UPSTASH');
  const res = await fetch(UP_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ command: cmd }),
  });
  if (!res.ok) {
    if (retry > 0) return redis(cmd, retry - 1);
    throw new Error(`Redis error ${res.status}`);
  }
  return res.json();
}

function mkDate(ymdStr: string, hhmm: string) {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  const d = new Date(`${ymdStr}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d;
}

function ddmmyyyyToYmd(ddmmyyyy: string) {
  const [dd, mm, yyyy] = ddmmyyyy.split('-').map((x) => parseInt(x, 10));
  const y = String(yyyy);
  const m = String(mm).toString().padStart(2, '0');
  const d = String(dd).toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function fetchAladhan(lat: number, lng: number, when: 'today' | 'tomorrow', opts: { countryCode?: string, tz?: string }): Promise<Times> {
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
  if (!res.ok || j.code !== 200) throw new Error(`AlAdhan error ${res.status}`);

  const greg = j.data?.date?.gregorian?.date as string; // DD-MM-YYYY
  const ymd = ddmmyyyyToYmd(greg);

  const t = j.data.timings;
  const base: Times = {
    Fajr: mkDate(ymd, t.Fajr),
    Sunrise: mkDate(ymd, t.Sunrise),
    Dhuhr: mkDate(ymd, t.Dhuhr),
    Asr: mkDate(ymd, t.Asr),
    Maghrib: mkDate(ymd, t.Maghrib),
    Isha: mkDate(ymd, t.Isha),
  };

  // Apply Norway offsets if relevant
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

function nextPrayer(times: Times) {
  const now = Date.now();
  const order: (keyof Times)[] = ['Fajr','Sunrise','Dhuhr','Asr','Maghrib','Isha'];
  for (const k of order) {
    const d = times[k];
    if (d && d.getTime() > now) return { name: k, at: d.getTime() };
  }
  return null;
}

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    if (!event.body) return { statusCode: 400, body: 'Missing body' };

    let json: any;
    try { json = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

    const sub = json.subscription;
    const meta = json.meta || {};
    if (!sub?.endpoint) return { statusCode: 400, body: 'Missing subscription.endpoint' };
    const id = idFromEndpoint(sub.endpoint);

    const haveMeta = typeof meta.lat === 'number' && typeof meta.lng === 'number';
    const haveUpstash = !!(UP_URL && UP_TOKEN);

    // If we don't have Upstash or metadata: accept and return ID (no scheduling yet)
    if (!haveMeta || !haveUpstash) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: true, id, note: 'Stored without scheduling (no meta or Upstash).' }),
      };
    }

    // Compute next prayer now so cron can dispatch at the right time
    const countryCode = String(meta.countryCode || '').toUpperCase();
    const tz = meta.tz || 'UTC';

    let nxtName = 'Fajr';
    let nxtAt = Date.now() + 60 * 60 * 1000; // default 1h fallback

    try {
      const today = await fetchAladhan(meta.lat, meta.lng, 'today', { countryCode, tz });
      const nxt = nextPrayer(today);
      if (nxt) { nxtName = nxt.name as string; nxtAt = nxt.at; }
      else {
        const tomorrow = await fetchAladhan(meta.lat, meta.lng, 'tomorrow', { countryCode, tz });
        nxtName = 'Fajr';
        nxtAt = tomorrow.Fajr.getTime();
      }
    } catch {
      // Keep fallback
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
      'nextName', nxtName,
      'nextAt', String(nxtAt),
      'active', '1',
    ]);
    await redis(['SADD', 'subs:all', id]);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, id }),
    };
  } catch (e: any) {
    // If Upstash is not configured, fall back to OK without scheduling
    if (e?.message === 'NO_UPSTASH') {
      try {
        const j = JSON.parse(event.body || '{}');
        const sub = j.subscription || {};
        const id = sub.endpoint ? idFromEndpoint(sub.endpoint) : 'local';
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ok: true, id, note: 'Stored without scheduling (no Upstash configured).' }),
        };
      } catch {}
    }
    return { statusCode: 500, body: `subscribe failed: ${e?.message || String(e)}` };
  }
};
