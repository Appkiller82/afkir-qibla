// Netlify Function: POST /api/subscribe
import { createClient } from '@netlify/blobs';

export default async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const body = await req.json();
    const sub = body.subscription;
    if (!sub || !sub.endpoint) return res.status(400).json({ error: 'missing subscription' });

    // enkel id fra endpoint
    const id = Buffer.from(sub.endpoint).toString('base64url').slice(-24);
    const blobs = createClient();
    await blobs.set(`subs/${id}.json`, JSON.stringify(sub), { contentType: 'application/json' });

    return res.status(200).json({ id });
  } catch (e) {
    console.error('subscribe error', e);
    return res.status(500).json({ error: 'server error' });
  }
};

export const config = { path: "/api/subscribe" };
