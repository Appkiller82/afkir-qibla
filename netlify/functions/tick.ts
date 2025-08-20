// netlify/functions/tick.ts
import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { DateTime } from "luxon";
import { calcNextPrayer } from "./calcNextPrayer";

// VAPID (må være satt i Netlify env)
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:aa@cmmco.no",
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

// Hvor bredt «vindu» vi godtar rundt klokkeslettet (ms)
const FIRE_WINDOW_MS = 60_000; // 1 minutt

export default async () => {
  try {
    const store = getStore("subs");

    // List har litt ulik shape i ulike versjoner, støtt begge:
    const list: any = await store.list();
    const keys: string[] =
      (list?.blobs?.map((b: any) => b.key) ??
        list?.blobKeys ??
        []).filter(Boolean);

    if (!keys.length) {
      return new Response(JSON.stringify({ ok: true, count: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const now = DateTime.now().toMillis();
    let sent = 0;
    let skipped = 0;

    for (const key of keys) {
      // Hent lagret record
      const rec: any = await store.get(key, { type: "json" }).catch(() => null);
      if (!rec?.sub?.endpoint) {
        // korrupte/gamle nøkler – fjern
        try {
          await store.delete(key);
        } catch {}
        continue;
      }

      const tz: string = rec.tz || "Europe/Oslo";
      const lat: number | null = rec.lat ?? null;
      const lon: number | null = rec.lon ?? null;
      const madhhab: string = rec.madhhab || "maliki";
      const nextFireAt: number = Number(rec.nextFireAt ?? 0);

      // Ikke tid ennå?
      if (nextFireAt && now + FIRE_WINDOW_MS < nextFireAt) {
        skipped++;
        continue;
      }

      // Beregn neste bønn (navn+tid i epoch ms)
      const { name, time } = calcNextPrayer(lat, lon, tz, madhhab);

      // Hvis vi hadde en forrige nextFireAt, og det faktisk er «nå» (innen vindu),
      // send push for det tidspunktet:
      if (!nextFireAt || Math.abs(now - nextFireAt) <= FIRE_WINDOW_MS) {
        const fmt = DateTime.fromMillis(time).setZone(tz).toFormat("HH:mm");
        const payload = JSON.stringify({
          title: "Bønnetid",
          body: `${name} nå (${fmt})`,
        });

        try {
          await webpush.sendNotification(rec.sub, payload);
          sent++;
        } catch (err: any) {
          // Ugyldig subscription? Slett
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            try {
              await store.delete(key);
            } catch {}
            continue; // hopp oppdatering
          }
          // Andre feil: logg, men fortsett
          console.error(`push failed for ${key}`, err);
        }
      } else {
        // For langt unna – hopp sending, men vi oppdaterer next uansett
        skipped++;
      }

      // Lagre NESTE varsel-tid (time fra calcNextPrayer)
      await store.setJSON(key, {
        ...rec,
        nextFireAt: time,
        // (valgfritt) bump en «updatedAt»
        updatedAt: now,
      });
    }

    return new Response(
      JSON.stringify({ ok: true, processed: keys.length, sent, skipped }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    console.error("tick failed:", err);
    return new Response("tick failed", { status: 500 });
  }
};
