// netlify/functions/send-test.ts
import type { Handler } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env as Record<string, string | undefined>;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
      return { statusCode: 500, body: 'Missing VAPID env vars' };
    }

    let body: any = {};
    try { body = event.body ? JSON.parse(event.body) : {}; } catch {
      return { statusCode: 400, body: 'Invalid JSON body' };
    }

    let sub = body?.sub;
    if (!sub && body?.id) {
      const store = getStore({ name: 'push-subs' });
      const saved = await store.getJSON<any>(`subs/${body.id}.json`);
      sub = saved?.sub;
    }
    if (!sub?.endpoint) {
      return { statusCode: 400, body: 'Missing subscription' };
    }

    const mod: any = await import('web-push');  // CJS/ESM safe
    const webpush = mod.default ?? mod;
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    await webpush.sendNotification(sub, JSON.stringify({
      title: 'Afkir Qibla',
      body: 'Testvarsel – Blobs versjon ✅',
      url: '/',
    }));

    return { statusCode: 201, body: 'Sent' };
  } catch (e: any) {
    console.error('send-test error:', e?.message || e);
    return { statusCode: 500, body: 'Server error in send-test' };
  }
};
