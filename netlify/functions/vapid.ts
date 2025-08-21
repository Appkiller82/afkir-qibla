// netlify/functions/vapid.ts
import type { Handler } from '@netlify/functions';

export const handler: Handler = async () => {
  const pub = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || '';
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey: pub })
  };
};
