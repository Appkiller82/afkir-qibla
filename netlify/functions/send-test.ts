import webpush from 'web-push';
import { list, get, del } from '@netlify/blobs';

const PREFIX = 'subs/';

export default async (req: Request): Promise<Response> => {
  try {
    if (req.method !== 'POST' && req.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const pub  = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    if (!pub || !priv) {
      return new Response('Missing VAPID keys (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)', { status: 500 });
    }
    // VIKTIG: sett VAPID inne i handleren
    webpush.setVapidDetails('mailto:you@example.com', pub, priv);

    const { blobs = [] } = await list({ prefix: PREFIX });
    if (blobs.length === 0) return new Response('Missing subscription', { status: 400 });

    const payload = JSON.stringify({
      title: 'Testvarsel',
      body: 'Dette er en test for bønnevarsler.',
      url: '/',
    });

    let sendt = 0, feil = 0, fjernet = 0;
    for (const b of blobs) {
      try {
        const res = await get(b.key);
        const sub = await res.json();
        await webpush.sendNotification(sub, payload);
        sendt++;
      } catch (e: any) {
        feil++;
        if (e?.statusCode === 410 || e?.statusCode === 404) { await del(b.key); fjernet++; }
        console.error('Send feilet for', b.key, e?.statusCode, e?.body || e?.message);
      }
    }

    return new Response(JSON.stringify({ sendt, feil, fjernet }), {
      status: 201, headers: { 'content-type': 'application/json' }
    });
  } catch (err: any) {
    console.error('send-test crashed:', err);
    return new Response('send-test crashed: ' + (err?.stack || err?.message || String(err)), { status: 500 });
  }
};
