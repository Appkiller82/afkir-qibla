import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors() });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors() });

  const body = await req.json();
  const { subscription, lat, lng, city, countryCode, tz } = body || {};
  if (!subscription?.endpoint) return new Response('Bad request', { status: 400, headers: cors() });

  const id = crypto.createHash('sha256').update(subscription.endpoint).digest('hex').slice(0, 16);
  const store = getStore('subs');
  await store.setJSON(`subs/${id}.json`, {
    id, subscription, lat, lng, city, countryCode, tz, createdAt: Date.now()
  });

  return new Response(JSON.stringify({ id }), {
    headers: { ...cors(), 'Content-Type': 'application/json' }
  });
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
