import { list } from '@netlify/blobs';
const PREFIX = 'subs/';

export default async () => {
  const out = await list({ prefix: PREFIX });
  return new Response(JSON.stringify(out?.blobs || []), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};
