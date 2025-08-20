import { put } from '@netlify/blobs';
const PREFIX = 'subs/';

export default async (req) => {
  try {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    let sub;
    try { sub = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
    if (!sub?.endpoint) return new Response('Missing endpoint', { status: 400 });

    const key = `${PREFIX}${encodeURIComponent(sub.endpoint)}.json`;
    await put(key, JSON.stringify(sub), { contentType: 'application/json' });

    return new Response('OK', { status: 201 });
  } catch (err) {
    console.error('save-sub crashed:', err);
    return new Response('save-sub crashed: ' + (err?.stack || err?.message || String(err)), { status: 500 });
  }
};
