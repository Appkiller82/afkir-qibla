// netlify/functions/send-test.ts
import type { Handler } from '@netlify/functions';
import webpush from 'web-push';

export const handler: Handler = async (event) => {
  try {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    const subj = process.env.VAPID_SUBJECT;
    if (!pub || !priv || !subj) {
      return { statusCode: 500, body: 'VAPID env vars mangler (PUBLIC/PRIVATE/SUBJECT)' };
    }

    if (!event.body) return { statusCode: 400, body: 'Missing body (JSON expected)' };
    let body: any;
    try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
    const sub = body?.sub;
    if (!sub?.endpoint) return { statusCode: 400, body: 'Missing subscription' };

    webpush.setVapidDetails(subj, pub, priv);

    const payload = JSON.stringify({
      title: 'Push-test 🚀',
      body: 'Hei! Dette er en testmelding fra Netlify-funksjonen.',
      url: '/'
    });

    await webpush.sendNotification(sub, payload);
    return { statusCode: 200, body: 'Push sendt!' };
  } catch (err: any) {
    return { statusCode: 500, body: `send-test failed: ${err?.message || String(err)}` };
  }
};
