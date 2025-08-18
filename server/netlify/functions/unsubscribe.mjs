// Netlify Function: POST /api/unsubscribe
import { createClient } from '@netlify/blobs';

export default async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'missing id' });

    const blobs = createClient();
    await blobs.delete(`subs/${id}.json`).catch(()=>{});
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('unsubscribe error', e);
    return res.status(500).json({ error: 'server error' });
  }
};

export const config = { path: "/api/unsubscribe" };
