// netlify/functions/subscribe.ts
import type { Handler } from '@netlify/functions';

const UP_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

const NO_IRN_PROFILE = {
  fajrAngle: 18.0, ishaAngle: 14.0, latitudeAdj: 3, school: 0,
  offsets: { Fajr: -9, Dhuhr: +12, Asr: 0, Maghrib: +8, Isha: -46 },
};

async function redis(cmd: string[]) {
  if (!UP_URL || !UP_TOKEN) throw new Error('NO_UPSTASH');
  const res = await fetch(UP_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ command: cmd }),
  });
  if (!res.ok) throw new Error(`Redis error ${res.status}`);
  return res.json();
}

function idFromEndpoint(ep: string) {
  return Buffer.from(ep).toString('base64url');
}

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    const json = JSON.parse(event.body || '{}');
    const sub = json.subscription;
    const meta = json.meta || {};
    if (!sub?.endpoint) return { statusCode: 400, body: 'Missing subscription.endpoint' };

    const id = idFromEndpoint(sub.endpoint);

    // Hvis vi mangler Upstash eller mangler meta.lat/lng — aksepter likevel og returner ID (ingen scheduling)
    const haveMeta = typeof meta.lat === 'number' && typeof meta.lng === 'number';
    if (!haveMeta || !UP_URL || !UP_TOKEN) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: true, id, note: 'Stored without scheduling (no meta or no Upstash configured).' }),
      };
    }

    // Full lagring hvis meta + Upstash finnes
    const countryCode = String(meta.countryCode || '').toUpperCase();
    const tz = meta.tz || 'UTC';

    const key = `sub:${id}`;
    await redis(['HSET', key,
      'endpoint', sub.endpoint,
      'keys', JSON.stringify(sub.keys || {}),
      'lat', String(meta.lat),
      'lng', String(meta.lng),
      'city', meta.city || '',
      'countryCode', countryCode,
      'tz', tz,
      'active', '1',
    ]);
    await redis(['SADD', 'subs:all', id]);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, id }),
    };
  } catch (e: any) {
    if (e?.message === 'NO_UPSTASH') {
      const json = JSON.parse(event.body || '{}');
      const sub = json.subscription || {};
      const id = sub.endpoint ? idFromEndpoint(sub.endpoint) : 'local';
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: true, id, note: 'Stored without scheduling (no Upstash configured).' }),
      };
    }
    return { statusCode: 500, body: `subscribe failed: ${e?.message || String(e)}` };
  }
};
