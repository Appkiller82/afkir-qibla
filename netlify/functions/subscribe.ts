// netlify/functions/subscribe.js
export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Må være JSON
    const ct = event.headers['content-type'] || event.headers['Content-Type'] || '';
    if (!ct.includes('application/json')) {
      return { statusCode: 400, body: 'Content-Type must be application/json' };
    }

    let sub;
    try {
      sub = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, body: 'Invalid JSON' };
    }

    if (!sub || typeof sub !== 'object' || !sub.endpoint) {
      return { statusCode: 400, body: 'Invalid subscription: missing endpoint' };
    }

    const { getStore } = await import('@netlify/blobs');
    const store = getStore({ name: 'push-subs' });

    // Lag en stabil ID basert på endpoint
    const id = Buffer.from(sub.endpoint).toString('base64url');

    const meta = {
      id,
      createdAt: new Date().toISOString(),
      ua: event.headers['user-agent'] || '',
      ip: event.headers['client-ip'] || event.headers['x-forwarded-for'] || '',
    };

    await store.setJSON(`subs/${id}.json`, { sub, meta });

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, id }),
    };
  } catch (e) {
    // Ikke send 502 til klient – logg og svar 500 med kort tekst
    console.error('subscribe error:', e);
    return { statusCode: 500, body: 'Server error in subscribe' };
  }
};
