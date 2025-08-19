import { Handler } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import webpush from 'web-push';

const store = getStore({ name: 'push-subs', consistency: 'strong' });

webpush.setVapidDetails(
  'mailto:admin@example.com',
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export const handler: Handler = async () => {
  try {
    const { blobs } = await store.list();
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];

    for (const b of blobs) {
      try {
        const subStr = await store.get(b.key);
        if (!subStr) continue;
        const subscription = JSON.parse(String(subStr));
        await webpush.sendNotification(
          subscription,
          JSON.stringify({
            title: 'Hei fra Afkir Qibla',
            body: 'Dette er et testvarsel.',
            url: '/',
          })
        );
        results.push({ id: b.key, ok: true });
      } catch (err: any) {
        const code = err?.statusCode || err?.code;
        if (code === 404 || code === 410) {
          await store.delete(b.key);
        }
        results.push({ id: b.key, ok: false, error: String(err) });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ sent: results.length, results }),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (e) {
    return { statusCode: 500, body: 'Server error' };
  }
};
