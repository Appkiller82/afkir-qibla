// netlify/functions/tick.ts
// KJØRER UTEN luxon. Riktig Netlify Blobs-API (getStore).
import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { calcNextPrayer } from "./calcNextPrayer";

// --- VAPID ---
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:aa@cmmco.no",
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

// Hjelper: format "HH:mm" i gitt tidssone
function fmtHHmm(ms: number, tz: string): string {
  return new Date(ms).toLocaleTimeString("no-NO", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Hent en blobs-store trygt. Hvis Netlify er riktig konfigurert trengs bare navnet.
// Hvis ikke, bruker vi de eksplisitte env-variablene (BLOBS_SITE_ID/BLOBS_TOKEN)
function openSubsStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;

  // @netlify/blobs v8 støtter både streng-navn og objekt
  if (siteID && token) {
    return getStore({ name: "subs", siteID, token });
  }
  return getStore("subs");
}

export default async function handler() {
  try {
    const store = openSubsStore();

    // List keys – API-format kan variere litt mellom versjoner, håndter begge
    const listing: any = await store.list();
    const keys: string[] = Array.isArray(listing)
      ? listing
      : (listing?.blobKeys ??
         listing?.blobs?.map((b: any) => b.key) ??
         []);

    for (const key of keys) {
      const record: any = await store.get(key, { type: "json" });
      if (!record?.sub) continue;

      // Krev minimumsdata
      if (!record.lat || !record.lon || !record.tz) {
        console.warn(`ℹ️  Skipper ${key} (mangler lat/lon/tz)`);
        continue;
      }

      const now = Date.now();

      // Ikke på tide enda?
      if (record.nextFireAt && record.nextFireAt > now) {
        continue;
      }

      // Beregn neste bønn (IRN i Norge, Aladhan ellers)
      const { name, time } = await calcNextPrayer(
        record.lat,
        record.lon,
        record.tz,
        record.madhhab
      );

      const local = fmtHHmm(time, record.tz);
      const payload = JSON.stringify({
        title: "Bønnetid",
        body: `${name} kl. ${local}`,
      });

      try {
        await webpush.sendNotification(record.sub, payload);
        console.log(`✅ Sent ${name} → ${key}`);
      } catch (err: any) {
        console.error(`❌ Failed push for ${key}`, err);
        // 404/410 = subscription død → slett
        const code = err?.statusCode || err?.code;
        if (code === 404 || code === 410) {
          try { await store.delete(key); } catch {}
          console.log(`🗑 Deleted invalid sub ${key}`);
        }
      }

      // Oppdater neste tidspunkt
      await store.setJSON(key, {
        ...record,
        nextFireAt: time,
        updatedAt: Date.now(),
      });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    console.error("tick failed:", err);
    const msg = err?.message || String(err);
    return new Response(`tick failed: ${msg}`, { status: 500 });
  }
}
