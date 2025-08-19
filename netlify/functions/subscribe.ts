import type { Handler } from '@netlify/functions';

type SavedSub = {
  meta: {
    id: string;
    createdAt: string;
    tz?: string;
    lat?: number;
    lon?: number;
    madhhab?: string;
    nextFireAt?: number;
  };
  sub: any;
};

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body: any = {};
    try { body = JSON.parse(event.body || '{}'); } catch {
      return { statusCode: 400, body: 'Invalid JSON body' };
    }

    const sub = body?.sub || body;
    if (!sub?.endpoint) {
      return { statusCode: 400, body: 'Invalid subscription: missing endpoint' };
    }

    // Stabil ID av endpoint
    const id = Buffer.from(sub.endpoint).toString('base64url');

    // Prøv å lagre i Blobs – men ikke gjør “Aktiver” avhengig av det
    let stored = false;
    try {
      // Lazy import så vi ikke krasjer hvis Blobs ikke er konfigurert
      const { getStore } = await import('@netlify/blobs');
      const store = getStore({ name: 'push-subs' });

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
      stored = true;
    } catch (e: any) {
      // Ikke fall ned – vi svarer 200 uansett, så “Aktiver” funker
      console.error('subscribe: blobs store failed:', e?.message || e);
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, id, stored }),
    };
  } catch (e: any) {
    console.error('subscribe fatal:', e?.message || e);
    return { statusCode: 500, body: 'Server error in subscribe' };
  }
};
