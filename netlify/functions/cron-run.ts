import webpush from "web-push";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "mailto:admin@example.com";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(CONTACT_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

type Timings = Record<string, string>;
type TimingResult = { timings: Timings; timezone?: string };

const isInNorway = (lat: number, lng: number) => lat > 57 && lat < 72 && lng > 4 && lng < 32;

const nowHHMM = (tz?: string) => {
  const d = new Date();
  if (tz) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    }).formatToParts(d);
    const h = parts.find(p => p.type === "hour")?.value ?? "00";
    const m = parts.find(p => p.type === "minute")?.value ?? "00";
    return `${h}:${m}`;
  }
  const h = d.getHours().toString().padStart(2,"0");
  const m = d.getMinutes().toString().padStart(2,"0");
  return `${h}:${m}`;
};

const withinWindow = (target: string, current: string, windowMin = 1) => {
  const [th, tm] = target.slice(0,5).split(":").map(Number);
  const [ch, cm] = current.slice(0,5).split(":").map(Number);
  const t = th*60 + tm, c = ch*60 + cm;
  return Math.abs(t - c) <= windowMin;
};

async function fetchBonnetid(lat: number, lng: number): Promise<TimingResult> {
  const url = process.env.BONNETID_API_URL;
  const key = process.env.VITE_BONNETID_API_KEY;
  if (!url || !key) throw new Error("Missing BONNETID env");
  const res = await fetch(`${url}?lat=${lat}&lng=${lng}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Bonnetid ${res.status}`);
  const data = await res.json();
  const timings: Timings =
    (data && data.timings) ||
    (data && data.data && data.data.timings) || {};
  const timezone: string | undefined =
    data?.timezone || data?.data?.meta?.timezone;
  return { timings, timezone };
}

async function fetchAladhan(lat: number, lng: number): Promise<TimingResult> {
  const url = process.env.ALADHAN_API_URL || "https://api.aladhan.com/v1/timings";
  const res = await fetch(`${url}?latitude=${lat}&longitude=${lng}&method=2`);
  if (!res.ok) throw new Error(`Aladhan ${res.status}`);
  const data = await res.json();
  const timings: Timings = data?.data?.timings || {};
  const timezone: string | undefined = data?.data?.meta?.timezone;
  return { timings, timezone };
}

function norwayTuningFallback(): TimingResult {
  return { timings: { Fajr: "05:00", Dhuhr: "13:00", Asr: "16:00", Maghrib: "19:00", Isha: "21:00" } };
}

async function sendOne(sub: any, message: any) {
  try {
    await webpush.sendNotification(sub, JSON.stringify(message));
    return true;
  } catch (e) {
    console.error("Push failed:", e);
    return false;
  }
}

export async function handler() {
  try {
    // Get all subscription keys
    const keys = await redis.smembers<string>("subscriptions:set");
    if (!keys || keys.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ success: true, msg: "No subscribers" }) };
    }

    // Load all records
    const records = await redis.mget<string[]>(...keys);
    type Rec = { subscription: any; lat?: number|null; lng?: number|null; timezone?: string|null };
    const subs: Rec[] = (records || []).map(r => {
      try { return JSON.parse(r as any); } catch { return null as any; }
    }).filter(Boolean);

    // Cache timings per unique rounded location to reduce API calls
    const cache = new Map<string, TimingResult>();
    let totalSent = 0, totalSubs = subs.length, checked = 0, groups = 0;

    for (const rec of subs) {
      const lat = typeof rec.lat === "number" ? rec.lat : 59.9139;
      const lng = typeof rec.lng === "number" ? rec.lng : 10.7522;
      const tz  = rec.timezone || undefined;
      const key = `${Math.round(lat*1000)/1000},${Math.round(lng*1000)/1000},${tz||"na"}`;

      let tv = cache.get(key);
      if (!tv) {
        // fetch timings for this location
        let result: TimingResult;
        if (isInNorway(lat, lng)) {
          try {
            result = await fetchBonnetid(lat, lng);
          } catch (e) {
            result = norwayTuningFallback();
          }
        } else {
          result = await fetchAladhan(lat, lng);
        }
        cache.set(key, result);
        tv = result;
        groups++;
      }

      const current = nowHHMM(tv.timezone || tz);
      const order = ["Fajr","Sunrise","Dhuhr","Asr","Maghrib","Isha"];
      const toCheck = order.filter(k => tv!.timings[k]);

      for (const p of toCheck) {
        const t = tv!.timings[p].slice(0,5);
        if (withinWindow(t, current, 1)) {
          const ok = await sendOne(rec.subscription, {
            title: "Bønnetid",
            body: `Det er tid for ${p} (${t})`,
            icon: "/icons/icon-192.png",
            data: { prayer: p, time: t },
          });
          if (ok) totalSent++;
          break; // send bare ett varsel per kjøring til denne sub
        }
      }
      checked++;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        subs: totalSubs,
        sent: totalSent,
        groups,
        cacheKeys: Array.from(cache.keys()),
      }),
    };
  } catch (e: any) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
}
