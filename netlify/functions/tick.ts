// netlify/functions/tick.ts
import type { Handler } from '@netlify/functions';
import webpush from 'web-push';
import { getStore } from '@netlify/blobs';

// ---------- IRN Tuning for Norge ----------
const NO_IRN_PROFILE = {
  fajrAngle: 18.0,
  ishaAngle: 14.0,
  latitudeAdj: 3, // AngleBased
  school: 0,      // Maliki
  offsets: {
    Fajr: -9,
    Dhuhr: +12,
    Asr: 0,
    Maghrib: +8,
    Isha: -46,
  },
};

// ---------- Blobs helper ----------
function blobStore() {
  return getStore({
    name: 'push-subs',
    siteID: process.env.BLOBS_SITE_ID!,
    token: process.env.BLOBS_TOKEN!,
    consistency: 'strong',
  });
}

// ---------- Bønnetidskalkulering ----------
function isInNorway(lat: number, lon: number): boolean {
  return lat >= 57 && lat <= 72 && lon >= 4 && lon <= 32;
}

// Dummy prayer calculation — her kan du koble mot din eksisterende beregning
function calcNextPrayer(entry: any): { nextFireAt: number; nextPrayer: string } {
  const now = Date.now();

  // foreløpig: fyr 2 min frem i tid
  return { nextFireAt: now + 2 * 60 * 1000, nextPrayer: 'Fajr' };
}

// ---------- Push sender ----------
async function sendPush(sub: any, payload: any) {
  await webpush.sendNotification(sub, JSON.stringify(payload), {
    vapidDetails: {
      subject: process.env.VAPID_SUBJECT!,
      publicKey: process.env.VAPID_PUBLIC_KEY!,
      privateKey: process.env.VAPID_PRIVATE_KEY!,
    },
  });
}

// ---------- Main handler ----------
export const handler: Handler = async () => {
  try {
    const store = blobStore();
    const listing = await store.list({ prefix: 'subs/' });

    const keys =
      Array.isArray((listing as any).blobs)
        ? (listing as any).blobs.map((b: any) => b.key)
        : Array.isArray((listing as any).blobKeys)
        ? (listing as any).blobKeys
        : [];

    let processed = 0;

    for (const key of keys) {
      const entry = await store.get(key, { type: 'json' });
      if (!entry?.sub) continue;

      const { lat, lon } = entry;

      // velg profil
      const useIRN = lat && lon && isInNorway(lat, lon);

      const { nextFireAt, nextPrayer } = calcNextPrayer(entry);

      if (Date.now() >= (entry.nextFireAt || 0)) {
        // send push
        await sendPush(entry.sub, {
          title: 'Bønnetid',
          body: `${nextPrayer} er nå`,
        });

        // oppdater nextFireAt
        await store.setJSON(key, {
          ...entry,
          nextFireAt,
          nextPrayer,
          updatedAt: Date.now(),
          profile: useIRN ? 'IRN' : 'Aladhan',
        });
      }

      processed++;
    }

    return {
      statusCode: 200,
      body: `tick ok, processed ${processed} subs`,
    };
  } catch (e: any) {
    return { statusCode: 500, body: `tick failed: ${e.message}` };
  }
};
