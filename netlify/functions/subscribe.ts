// netlify/functions/subscribe.ts
import type { Handler } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

type SavedSub = {
  meta: {
    id: string;
    createdAt: string;
    tz?: string;
    lat?: number;
    lon?: number;
    madhhab?: string;
    // neste tidspunkt (epoch ms) når vi skal sende varsel
    nextFireAt?: number;
  };
  sub: any; // PushSubscription JSON
};

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const store = getStore({ name: 'push-subs' });

    let body: any = {};
    try { body = JSON.parse(event.body || '{}'); } catch {
      return { statusCode: 400, body: 'Invalid JSON body' };
    }

    const sub = body?.sub || body; // aksepter både {sub} og ren sub
    if (!sub?.endpoint) {
      return { statusCode: 400, body: 'Invalid subscription: missing endpoint' };
    }

    // stabil ID fra endpoint
    const id = Buffer.from(sub.endpoint).toString('base64url');

    const saved: SavedSub = {
      meta: {
        id,
        createdAt: new Date().toISOString(),
        tz: body?.tz,
        lat: typeof body?.lat === 'number' ? body.lat : undefined,
        lon: typeof body?.lon === 'number' ? body.lon : undefined,
        madhhab: body?.madhhab,
        nextFireAt: typeof body?.nextFireAt === 'number' ? body.nextFireAt : undefined,
      },
      sub,
    };

    await store.setJSON(`subs/${id}.json`, saved);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, id }),
    };
  } catch (e: any) {
    console.error('subscribe fatal:', e?.message || e);
    return { statusCode: 500, body: 'Server error in subscribe' };
  }
};
