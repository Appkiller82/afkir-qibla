import webpush from 'web-push';
import { list, get, del } from '@netlify/blobs';

const PREFIX = 'subs/';
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

webpush.setVapidDetails('mailto:you@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export default async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const { blobs = [] } = await list({ prefix: PREFIX });
  if (blobs.length === 0) return new Response('Missing subscription', { status: 400 });

  const payload = JSON.stringify({
    title: 'Testvarsel',
    body: 'Dette er en test for bønnevarsler.',
    url: '/',
  });

  let ok = 0, fail = 0, removed = 0;

  for (const b of blobs) {
    try {
      const res = await get(b.key);
      const sub = await res.json();
      await webpush.sendNotification(sub, payload);
      ok++;
    } catch (e) {
      fail++;
      if (e?.statusCode === 410 || e?.statusCode === 404) { await del(b.key); removed++; }
      console.error('Send feilet for', b.key, e?.statusCode, e?.body || e?.message);
    }
  }

  return new Response(JSON.stringify({ sendt: ok, feil: fail, fjernet: removed }), {
    status: 201,
    headers: { 'content-type': 'application/json' }
  });
};
