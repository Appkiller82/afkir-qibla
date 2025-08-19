// netlify/functions/send-test.js
export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
      return { statusCode: 500, body: 'Missing VAPID env vars' };
    }

    const ct = event.headers['content-type'] || event.headers['Content-Type'] || '';
    let body = {};
    if (ct.includes('application/json') && event.body) {
      try { body = JSON.parse(event.body); } catch { /* ignore */ }
    }

    const id = body?.id; // valgfritt: send til én sub
    const { getStore } = await import('@netlify/blobs');
    const store = getStore({ name: 'push-subs' });

    // Hent subscription
    let subRecord;
    if (id) {
      subRecord = await store.getJSON(`subs/${id}.json`);
      if (!subRecord?.sub) return { statusCode: 404, body: 'Subscription not found' };
    } else {
      // fallback: prøv å finne én (første) lagret sub
      const list = await store.list({ prefix: 'subs/' });
      const first = list.blobs?.[0]?.key;
      if (!first) return { statusCode: 400, body: 'No subscriptions saved' };
      subRecord = await store.getJSON(first);
    }

    const webpush = (await import('web-push')).default;
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const payload = JSON.stringify({
      title: 'Afkir Qibla',
      body: 'Testvarsel – det fungerer!',
      url: '/', // åpnes ved klikk
    });

    try {
      await webpush.sendNotification(subRecord.sub, payload);
      return { statusCode: 201, body: 'Sent' };
    } catch (err) {
      // 410 Gone = abonnement ugyldig → slett det
      if (err?.statusCode === 410 && subRecord?.meta?.id) {
        await store.delete(`subs/${subRecord.meta.id}.json`).catch(() => {});
      }
      console.error('send-test error:', err);
      return { statusCode: 500, body: 'Send failed' };
    }
  } catch (e) {
    console.error('send-test fatal:', e);
    return { statusCode: 500, body: 'Server error in send-test' };
  }
};
