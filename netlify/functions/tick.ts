// netlify/functions/tick.ts
import { client } from "@netlify/blobs";
import webpush from "web-push";
import { DateTime } from "luxon";
import { calcNextPrayer } from "./calcNextPrayer";

// VAPID-konfig
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:aa@cmmco.no",
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export default async function handler() {
  try {
    // Merk: Bruker samme oppsett som før – ikke endret for å unngå å "knekke" noe som funker
    const store = client({
      name: "subs",
      siteID: process.env.BLOBS_SITE_ID,         // behold navnet du allerede bruker i env
      token: process.env.BLOBS_TOKEN,
    });

    // Hent alle subscriptions
    const keys = await store.list();
    for (const key of keys.blobKeys) {
      const record = await store.get(key, { type: "json" });
      if (!record?.sub) continue;

      // Krev minimumsdata for korrekt beregning
      if (!record.lat || !record.lon || !record.tz) {
        console.warn(`ℹ️  Skipper ${key} (mangler lat/lon/tz)`);
        continue;
      }

      const now = DateTime.now().toMillis();

      // Sjekk om det er tid for varsel
      if (record.nextFireAt && record.nextFireAt > now) {
        continue; // Ikke ennå
      }

      // Beregn neste bønn
      const { name, time } = await calcNextPrayer(
        record.lat,
        record.lon,
        record.tz,
        record.madhhab
      );

      // For brukervennlig tekst i riktig tidssone
      const localTime = DateTime.fromMillis(time)
        .setZone(record.tz)
        .toFormat("HH:mm");

      // Send push-varsel
      const payload = JSON.stringify({
        title: "Bønnetid",
        body: `${name} kl. ${localTime}`,
      });

      try {
        await webpush.sendNotification(record.sub, payload);
        console.log(`✅ Sent ${name} to ${key}`);
      } catch (err: any) {
        console.error(`❌ Failed push for ${key}`, err);
        // Hvis subscription er ugyldig → slett
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          await store.delete(key);
          console.log(`🗑 Deleted invalid sub ${key}`);
        }
      }

      // Lagre neste fireAt
      await store.setJSON(key, {
        ...record,
        nextFireAt: time,
        updatedAt: Date.now(),
      });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    console.error("tick failed:", err);
    return new Response(`tick failed: ${err?.message || String(err)}`, { status: 500 });
  }
}
