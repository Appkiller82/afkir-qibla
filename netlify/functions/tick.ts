// netlify/functions/tick.ts
import type { Handler } from "@netlify/functions";
import webpush from "web-push";
import { getStore } from "@netlify/blobs";

// ---------- IRN-tuning ----------
const NO_IRN_PROFILE = {
  fajrAngle: 18.0,
  ishaAngle: 14.0,
  latitudeAdj: 3, // AngleBased
  school: 0, // Maliki
  offsets: {
    Fajr: -9,
    Dhuhr: +12,
    Asr: 0,
    Maghrib: +8,
    Isha: -46,
  },
};

function isInNorway(lat: number, lon: number): boolean {
  return lat >= 57 && lat <= 72 && lon >= 4 && lon <= 32;
}

// Dummy IRN-beregning (bytt ut med faktisk lib om ønskelig)
function getPrayerTimesWithIRN(lat: number, lon: number, date: Date, profile: any) {
  const base = new Date(date);
  return {
    Fajr: new Date(base.setHours(4, 30)),
    Dhuhr: new Date(base.setHours(13, 0)),
    Asr: new Date(base.setHours(17, 0)),
    Maghrib: new Date(base.setHours(21, 15)),
    Isha: new Date(base.setHours(22, 30)),
  };
}

// Hent fra Aladhan
async function fetchFromAladhan(lat: number, lon: number, date: Date) {
  const ts = Math.floor(date.getTime() / 1000);
  const url = `https://api.aladhan.com/v1/timings/${ts}?latitude=${lat}&longitude=${lon}&method=2`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Aladhan API error: ${res.status}`);
  const json = await res.json();
  return json.data.timings;
}

// Finn neste bønnetid fra et sett med tider
function findNextPrayer(now: Date, times: Record<string, string | Date>) {
  const upcoming = Object.entries(times)
    .map(([name, t]) => [name, typeof t === "string" ? new Date(`${now.toDateString()} ${t}`) : t] as const)
    .filter(([_, d]) => d > now)
    .sort((a, b) => a[1].getTime() - b[1].getTime());
  return upcoming[0] || null;
}

export const handler: Handler = async () => {
  try {
    const store = getStore("pushSubs");
    const subs = await store.list();

    const now = new Date();

    for (const key of subs.blobKeys) {
      const entryRaw = await store.get(key, { type: "json" });
      if (!entryRaw) continue;

      const { sub, lat, lon } = entryRaw as any;
      if (!lat || !lon) continue;

      let times;
      if (isInNorway(lat, lon)) {
        times = getPrayerTimesWithIRN(lat, lon, now, NO_IRN_PROFILE);
      } else {
        times = await fetchFromAladhan(lat, lon, now);
      }

      const next = findNextPrayer(now, times);
      if (!next) continue;

      // Lagre oppdatert neste tid
      await store.setJSON(key, {
        ...entryRaw,
        nextFireAt: next[1].getTime(),
        nextPrayer: next[0],
      });

      // Hvis tiden er "nå", send push
      const diff = next[1].getTime() - now.getTime();
      if (diff <= 0 || diff < 60 * 1000) {
        webpush.setVapidDetails(
          process.env.VAPID_SUBJECT!,
          process.env.VAPID_PUBLIC_KEY!,
          process.env.VAPID_PRIVATE_KEY!
        );
        await webpush.sendNotification(
          sub,
          JSON.stringify({
            title: "Adhan",
            body: `Tid for ${next[0]}`,
          })
        );
      }
    }

    return { statusCode: 200, body: "tick ok" };
  } catch (err: any) {
    return { statusCode: 500, body: `tick failed: ${err.message}` };
  }
};
