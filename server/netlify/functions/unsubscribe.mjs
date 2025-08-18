import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors() });
  const { id } = await req.json();
  if (!id) return new Response('Bad request', { status: 400, headers: cors() });

  const store = getStore('subs');
  await store.delete(`subs/${id}.json`);
  return new Response('ok', { headers: cors() });
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
