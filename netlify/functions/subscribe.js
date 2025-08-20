// netlify/functions/subscribe.js
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const sub = JSON.parse(event.body || '{}');
    if (!sub || !sub.endpoint) {
      return { statusCode: 400, body: 'Invalid subscription' };
    }

    // TODO: lagre i Netlify Blobs / KV / database.
    // For enkel test: legg i en blob med endpoint som nøkkel
    // npm i @netlify/blobs (kjør i ROT: npm install @netlify/blobs)
    const { getStore } = await import('@netlify/blobs');
    const store = getStore({ name: 'push-subs' });
    const id = Buffer.from(sub.endpoint).toString('base64url');

    await store.setJSON(id, sub);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, id })
    };
  } catch (e) {
    return { statusCode: 500, body: 'Server error: ' + e.message };
  }
};
