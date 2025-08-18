export const config = { schedule: "* * * * *" }; // hvert minutt (UTC)

import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { DateTime } from "luxon";

webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

const ORDER = ["Fajr","Sunrise","Dhuhr","Asr","Maghrib","Isha"];

export default async () => {
  const store = getStore('subs');

  let cursor; const keys = [];
  do {
    const page = await store.list({ cursor });
    for (const b of page.blobs || []) if (b.key.startsWith('subs/')) keys.push(b.key);
    cursor = page.cursor;
  } while (cursor);

  const nowUtc = DateTime.utc();

  for (const key of keys) {
    try {
      const json = await store.get(key);
      if (!json) continue;
      const rec = JSON.parse(json);
      const tz = rec.tz || "Europe/Oslo";
      const times = await fetchPrayerTimes(rec.lat, rec.lng, tz, rec.countryCode);
      const now = nowUtc.setZone(tz);

      for (const name of ORDER) {
        const hhmm = times[name];
        if (!hhmm) continue;
        const target = DateTime.fromFormat(hhmm, "H:mm", { zone: tz }).set({ year: now.year, month: now.month, day: now.day });
        const diff = Math.abs(now.diff(target, "seconds").seconds);
        if (diff <= 59) {
          await webpush.sendNotification(rec.subscription, JSON.stringify({
            title: name === "Sunrise" ? "Soloppgang" : name,
            body: `Det er tid for ${name === "Sunrise" ? "soloppgang" : name}.`,
            url: "/"
          }));
        }
      }
    } catch (e) {
      // optional: console.log(e);
    }
  }

  return new Response('ok');
};

async function fetchPrayerTimes(lat, lng, tz, countryCode) {
  const isNO = (countryCode || "").toUpperCase() === "NO";
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    method: isNO ? "99" : "5",
    timezonestring: tz,
    iso8601: "false",
    school: "0",
    ...(isNO ? { fajr: "18", isha: "14", latitudeAdjustmentMethod: "3" } : {})
  });
  const res = await fetch(`https://api.aladhan.com/v1/timings/today?${params.toString()}`);
  const data = await res.json();
  const t = data?.data?.timings || {};
  return {
    Fajr: t.Fajr, Sunrise: t.Sunrise, Dhuhr: t.Dhuhr, Asr: t.Asr, Maghrib: t.Maghrib, Isha: t.Isha
  };
}
