// netlify/functions/subscribe.ts
import type { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let sub: any = null;
    try {
      sub = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, body: 'Invalid JSON body' };
    }

    if (!sub?.endpoint) {
      return { statusCode: 400, body: 'Invalid subscription: missing endpoint' };
    }

    // Lag en stabil ID basert på endpoint uten crypto
    const id = Buffer.from(sub.endpoint).toString('base64url');

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, id }),
    };
  } catch (e: any) {
    console.error('subscribe fatal:', e?.message || e);
    return { statusCode: 500, body: 'Server error in subscribe' };
  }
};
