// netlify/functions/subscribe.ts
import type { Handler } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

function blobStore() {
  const siteID = process.env.BLOBS_SITE_ID!;
  const token  = process.env.BLOBS_TOKEN!;
  if (!siteID || !token) {
    throw new Error('BLOBS_SITE_ID/BLOBS_TOKEN missing in env');
  }
  return getStore({
    name: 'push-subs',
    siteID,
    token,
    consistency: 'strong',
  });
}

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const body = JSON.parse(event.body || '{}');

    // Aksepter både { sub: {...} } og flat subscription
    const sub = body?.sub && body.sub.endpoint ? body.sub : body;
    const id: string | undefined = sub?.endpoint;
    if (!id) {
      return { statusCode: 400, body: 'missing subscription endpoint' };
    }

    let stored = false;

    if (body.store) {
      const store = blobStore();
      // lagre under "subs/<encoded endpoint>"
      const key = `subs/${encodeURIComponent(id)}`;
      const record = {
        id,
        sub,
        tz: body.tz ?? null,
        lat: body.lat ?? null,
        lon: body.lon ?? null,
        madhhab: body.madhhab ?? null,
        nextFireAt: body.nextFireAt ?? null,
        savedAt: Date.now(),
      };
      await store.setJSON(key, record);
      stored = true;
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, id, stored }),
    };
  } catch (err: any) {
    return { statusCode: 500, body: err?.message || 'subscribe failed' };
  }
};
