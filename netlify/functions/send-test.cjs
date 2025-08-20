// Sender push til abonnementet du sender i body: { "subscription": {...} }
const webpush = require('web-push');

module.exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: { 'content-type': 'text/plain' }, body: 'Method Not Allowed' };
    }

    const pub  = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    if (!pub || !priv) {
      return { statusCode: 500, headers: { 'content-type': 'text/plain' }, body: 'Missing VAPID keys (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)' };
    }
    webpush.setVapidDetails('mailto:you@example.com', pub, priv);

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return { statusCode: 400, headers: { 'content-type': 'text/plain' }, body: 'Bad JSON' }; }

    const sub = body && body.subscription;
    if (!sub || !sub.endpoint) {
      return { statusCode: 400, headers: { 'content-type': 'text/plain' }, body: 'Missing subscription: send JSON { "subscription": {...} }' };
    }

    const payload = JSON.stringify({ title: 'Testvarsel', body: 'Dette er en test for bønnevarsler.', url: '/' });
    await webpush.sendNotification(sub, payload);

    return { statusCode: 201, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sendt: 1 }) };
  } catch (e) {
    const msg = (e && (e.body || e.message)) || String(e);
    return { statusCode: 500, headers: { 'content-type': 'text/plain' }, body: 'send-test error: ' + msg };
  }
};
