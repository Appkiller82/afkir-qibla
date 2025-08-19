export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    let sub;
    try { sub = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON body' }; }
    if (!sub?.endpoint) return { statusCode: 400, body: 'Invalid subscription: missing endpoint' };

    const id = Buffer.from(sub.endpoint).toString('base64url');

    // Prøv å lagre i Blobs, men ikke feile om det svikter
    try {
      const { getStore } = await import('@netlify/blobs');
      const store = getStore({ name: 'push-subs' });
      await store.setJSON(`subs/${id}.json`, {
        sub,
        meta: { id, createdAt: new Date().toISOString() }
      });
    } catch (e) {
      console.error('blob save failed', e);
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, id })
    };
  } catch (e) {
    console.error('subscribe fatal', e);
    return { statusCode: 500, body: 'Server error in subscribe' };
  }
};
