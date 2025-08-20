// netlify/functions/debug-subs.ts
import type { Handler } from '@netlify/functions';

/**
 * /debug-subs — Upstash diagnostics for prayer push subscriptions.
 *
 * Query params:
 *   - id: subscription id (base64url)
 *   - endpoint: raw endpoint URL (will be converted to id)
 *   - limit: number of items when listing (default 50)
 *
 * Examples:
 *   /.netlify/functions/debug-subs
 *   /.netlify/functions/debug-subs?limit=10
 *   /.netlify/functions/debug-subs?id=abc123...
 *   /.netlify/functions/debug-subs?endpoint=https%3A%2F%2Ffcm.googleapis.com%2Ffcm%2Fsend%2F...
 */

const UP_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

function idFromEndpoint(ep: string) {
  const b64 = Buffer.from(ep).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

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

export const handler: Handler = async (event) => {
  try {
    if (!UP_URL || !UP_TOKEN) {
      return { statusCode: 200, headers: {'content-type':'application/json'}, body: JSON.stringify({ ok: true, note: 'Upstash not configured on this environment.' }) };
    }

    const q = event.queryStringParameters || {};
    const limit = Math.max(1, Math.min(500, parseInt(String(q.limit || '50'), 10) || 50));
    let id = (q.id || '') as string;
    const endpoint = (q.endpoint || '') as string;
    if (!id && endpoint) id = idFromEndpoint(decodeURIComponent(endpoint));

    if (id) {
      const key = `sub:${id}`;
      const h = await redis(['HGETALL', key]);
      const entries: string[] = h.result || h || [];
      const obj: Record<string,string> = {};
      for (let i=0;i<entries.length;i+=2) obj[entries[i]] = entries[i+1];
      const nextAt = obj.nextAt ? Number(obj.nextAt) : undefined;
      const details = {
        id,
        active: obj.active === '1',
        city: obj.city || '',
        countryCode: obj.countryCode || '',
        tz: obj.tz || '',
        nextName: obj.nextName || '',
        nextAt,
        nextAtISO: nextAt ? new Date(nextAt).toISOString() : null,
        hasEndpoint: !!obj.endpoint,
        hasKeys: !!obj.keys,
        lat: obj.lat ? Number(obj.lat) : undefined,
        lng: obj.lng ? Number(obj.lng) : undefined,
      };
      return { statusCode: 200, headers: {'content-type':'application/json'}, body: JSON.stringify({ ok: true, details }) };
    }

    // List mode
    const s = await redis(['SMEMBERS', 'subs:all']);
    const ids: string[] = s.result || s || [];
    const selected = ids.slice(0, limit);
    const list = [];
    for (const sid of selected) {
      const h = await redis(['HGETALL', `sub:${sid}`]);
      const entries: string[] = h.result || h || [];
      const obj: Record<string,string> = {};
      for (let i=0;i<entries.length;i+=2) obj[entries[i]] = entries[i+1];
      const nextAt = obj.nextAt ? Number(obj.nextAt) : undefined;
      list.push({
        id: sid,
        active: obj.active === '1',
        city: obj.city || '',
        countryCode: obj.countryCode || '',
        tz: obj.tz || '',
        nextName: obj.nextName || '',
        nextAt,
        nextAtISO: nextAt ? new Date(nextAt).toISOString() : null,
      });
    }

    return { statusCode: 200, headers: {'content-type':'application/json'}, body: JSON.stringify({ ok: true, count: list.length, list }) };
  } catch (e: any) {
    if (e?.message === 'NO_UPSTASH') {
      return { statusCode: 200, headers: {'content-type':'application/json'}, body: JSON.stringify({ ok: true, note: 'Upstash not configured on this environment.' }) };
    }
    return { statusCode: 500, body: `debug-subs failed: ${e?.message || String(e)}` };
  }
};
