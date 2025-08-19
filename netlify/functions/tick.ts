import { getStore } from '@netlify/blobs';

function blobStore() {
  return getStore({
    name: 'push-subs',
    siteID: process.env.BLOBS_SITE_ID!,
    token:  process.env.BLOBS_TOKEN!,
    consistency: 'strong',
  });
}

export const handler = async () => {
  try {
    const store = blobStore();

    // hent alle lagrede subs
    const list = await store.list({ prefix: 'subs/' });
    for (const key of list.blobKeys) {
      const entry = await store.get(key, { type: 'json' });
      if (!entry) continue;

      // ... din eksisterende logikk:
      //  - beregn tider (IRN i Norge, Aladhan ellers)
      //  - finn next
      //  - hvis due nå → send push
      //  - oppdater nextFireAt og nextPrayer
      // await store.setJSON(key, { ...entry, nextFireAt, nextPrayer });
    }

    return { statusCode: 200, body: 'tick ok' };
  } catch (e: any) {
    return { statusCode: 500, body: `tick failed: ${e.message}` };
  }
};
