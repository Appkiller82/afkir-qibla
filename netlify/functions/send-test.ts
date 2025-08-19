// netlify/functions/send-test.ts
export const handler = async (event: any) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env as Record<string, string | undefined>;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
      return { statusCode: 500, body: 'Missing VAPID env vars' };
    }
    if (!/^mailto:|^https?:\/\//i.test(VAPID_SUBJECT)) {
      return { statusCode: 500, body: 'VAPID_SUBJECT must be a mailto: or https:// URL' };
    }

    let body: any = {};
    if (event.body) {
      try { body = JSON.parse(event.body); } catch {}
    }
    const id: string | null = body?.id || null;

    const { getStore } = await import('@netlify/blobs');
    const store = getStore({ name: 'push-subs' });

    // Hent en subscription å sende til
    let subRecord: any;
    if (id) {
      subRecord = await store.getJSON(`subs/${id}.json`);
    } else {
      const list = await store.list({ prefix: 'subs/' });
      const first = list.blobs?.[0]?.key;
      if (first) subRecord = await store.getJSON(first);
    }
    if (!subRecord?.sub) {
      return { statusCode: 400, body: 'No subscriptions saved' };
    }

    // web-push import (funker for både CJS/ESM)
    const wpMod: any = await import('web-push');
    const webpush = wpMod.default ?? wpMod;
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const payload = JSON.stringify({
      title: 'Afkir Qibla',
      body: 'Testvarsel – det fungerer!',
      url: '/',
    });

    try {
      await webpush.sendNotification(subRecord.sub, payload);
      return { statusCode: 201, body: 'Sent' };
    } catch (err: any) {
      // 410 Gone → slett og gi forståelig svar
      if (err?.statusCode === 410 && subRecord?.meta?.id) {
        try { await store.delete(`subs/${subRecord.meta.id}.json`); } catch {}
        return { statusCode: 410, body: 'Subscription gone (deleted); please re-activate push' };
      }
      const msg = (err && (err.body || err.message || String(err))) || 'Send failed';
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('send-test error:', code, msg);
      return { statusCode: code, body: msg };
    }
  } catch (e: any) {
    console.error('send-test fatal:', e);
    return { statusCode: 500, body: 'Server error in send-test' };
  }
};
