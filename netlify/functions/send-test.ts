// netlify/functions/send-test.ts (patched)
import type { Handler } from '@netlify/functions';
import webpush from 'web-push';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:you@example.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export const handler: Handler = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const subscription = body?.subscription;
    if (!subscription) {
      return { statusCode: 400, body: JSON.stringify({ ok:false, error:'Missing subscription' }) };
    }

    const payload = JSON.stringify({
      title: body?.title || 'Afkir Qibla',
      body: body?.body  || 'Testvarsel: dette er en bakgrunns‑push',
      url:  body?.url   || '/',
      tag:  'test'
    });

    await webpush.sendNotification(subscription as any, payload, { TTL: 60 });
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e: any) {
    return { statusCode: 400, body: JSON.stringify({ ok:false, error: e?.message || String(e) }) };
  }
};
