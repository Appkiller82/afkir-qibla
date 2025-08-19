// netlify/functions/send-test.ts
import { Handler } from '@netlify/functions';
import webpush from 'web-push';

const handler: Handler = async (event) => {
  try {
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) {
      throw new Error('Missing VAPID env vars');
    }

    if (!event.body) return { statusCode: 400, body: 'Missing body' };
    const { sub } = JSON.parse(event.body);

    if (!sub?.endpoint) {
      return { statusCode: 400, body: 'Missing subscription' };
    }

    // Sett VAPID keys
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!,
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );

    // Send test
    await webpush.sendNotification(sub, JSON.stringify({
      title: 'Push-test 🚀',
      body: 'Hei! Dette er en testmelding fra Netlify-funksjonen.',
    }));

    return {
      statusCode: 200,
      body: 'Push sendt!',
    };
  } catch (err: any) {
    return { statusCode: 500, body: err.message || 'send-test failed' };
  }
};

export { handler };
