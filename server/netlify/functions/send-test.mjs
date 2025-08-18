// Netlify Function: POST /api/send-test
import webpush from 'web-push';
import { createClient } from '@netlify/blobs';

const PUB  = process.env.VAPID_PUBLIC_KEY;
const PRIV = process.env.VAPID_PRIVATE_KEY;
const SUBJ = process.env.VAPID_SUBJECT || 'mailto:you@example.com';

webpush.setVapidDetails(SUBJ, PUB, PRIV);

export default async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'missing id' });

    const blobs = createClient();
    const raw = await blobs.get(`subs/${id}.json`);
    if (!raw) return res.status(404).json({ error: 'not found' });
    const subscription = await raw.json();

    const payload = JSON.stringify({
      title: 'Afkir Qibla',
      body: 'Test-varsel fungerer ✅',
      url: '/',
      icon: '/icons/apple-touch-icon.png'
    });

    await webpush.sendNotification(subscription, payload);
    return res.status(200).json({ ok: true });
  } catch (e) {
    // Håndter typiske feil (410 = subscription død)
    if (e.statusCode === 410 || e.statusCode === 404) {
      try {
        const blobs = createClient();
        await blobs.delete(`subs/${(req.body||{}).id}.json`).catch(()=>{});
      } catch {}
      return res.status(410).json({ error: 'gone' });
    }
    console.error('send-test error', e);
    return res.status(500).json({ error: 'server error' });
  }
};

export const config = { path: "/api/send-test" };
