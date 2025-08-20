import { list } from '@netlify/blobs';
const PREFIX = 'subs/';

export default async () => {
  try {
    const out = await list({ prefix: PREFIX });
    return new Response(JSON.stringify(out?.blobs || []), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    console.error('list-subs crashed:', err);
    return new Response('list-subs crashed: ' + (err?.stack || err?.message || String(err)), { status: 500 });
  }
};
