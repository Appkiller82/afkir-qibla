// netlify/functions/cron-dispatch.ts
import type { Handler } from '@netlify/functions';
import webpush from 'web-push';

const UP_URL = process.env.UPSTASH_REDIS_REST_URL!;
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT!;

const NO_IRN_PROFILE = {
  fajrAngle: 18.0, ishaAngle: 14.0, latitudeAdj: 3, school: 0,
  offsets: { Fajr: -9, Dhuhr: +12, Asr: 0, Maghrib: +8, Isha: -46 },
};
const ORDER = ['Fajr','Sunrise','Dhuhr','Asr','Maghrib','Isha'] as const;

function mkDate(ymdStr: string, hhmm: string) {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  const d = new Date(`${ymdStr}T00:00:00`); d.setHours(h, m, 0, 0); return d;
}
async function redis(cmd: string[]) {
  const res = await fetch(UP_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ command: cmd }),
  });
  if (!res.ok) throw new Error(`Redis error ${res.status}`);
  return res.json();
}
async function aladhan(lat: number, lng: number, when: 'today'|'tomorrow', opts: any) {
  const tz = opts?.tz || 'UTC';
  const p = new URLSearchParams({ latitude:String(lat), longitude:String(lng), timezonestring:tz, iso8601:'true' });
  if ((opts?.countryCode || '').toUpperCase() === 'NO') {
    p.set('method','99'); p.set('fajr', String(NO_IRN_PROFILE.fajrAngle));
    p.set('isha', String(NO_IRN_PROFILE.ishaAngle)); p.set('school', String(NO_IRN_PROFILE.school));
    p.set('latitudeAdjustmentMethod', String(NO_IRN_PROFILE.latitudeAdj));
  } else { p.set('method','5'); p.set('school','0'); }
  const url = `https://api.aladhan.com/v1/timings/${when}?${p.toString()}`;
  const res = await fetch(url); const j = await res.json();
  if (j.code !== 200) throw new Error('AlAdhan error');
  const t = j.data.timings, [dd,mm,yyyy] = j.data.date.gregorian.date.split('-').map((x: string)=>parseInt(x,10));
  const YMD = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  const base = {
    Fajr: mkDate(YMD, t.Fajr), Sunrise: mkDate(YMD, t.Sunrise), Dhuhr: mkDate(YMD, t.Dhuhr),
    Asr: mkDate(YMD, t.Asr), Maghrib: mkDate(YMD, t.Maghrib), Isha: mkDate(YMD, t.Isha),
  };
  if ((opts?.countryCode || '').toUpperCase() === 'NO') {
    const o = NO_IRN_PROFILE.offsets;
    base.Fajr.setMinutes(base.Fajr.getMinutes() + (o.Fajr||0));
    base.Dhuhr.setMinutes(base.Dhuhr.getMinutes() + (o.Dhuhr||0));
    base.Asr.setMinutes(base.Asr.getMinutes() + (o.Asr||0));
    base.Maghrib.setMinutes(base.Maghrib.getMinutes() + (o.Maghrib||0));
    base.Isha.setMinutes(base.Isha.getMinutes() + (o.Isha||0));
  }
  return base;
}
function nextPrayer(times: Record<string, Date>) {
  const now = Date.now();
  for (const k of ORDER) {
    const d = times[k]; if (d && d.getTime() > now) return { name: k, at: d.getTime() };
  }
  return null;
}

export const handler: Handler = async () => {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const subsAll = await redis(['SMEMBERS', 'subs:all']);
    const ids: string[] = subsAll.result || subsAll;
    const now = Date.now();
    const windowMs = 60_000;

    for (const id of ids) {
      const key = `sub:${id}`;
      const h = await redis(['HGETALL', key]);
      const flat = h.result || h;
      const entries = Array.isArray(flat) ? flat : [];
      const map: Record<string,string> = {};
      for (let i=0;i<entries.length;i+=2) map[entries[i]] = entries[i+1];

      if (!map.active || map.active === '0') continue;

      const nextAt = Number(map.nextAt || 0);
      const nextName = String(map.nextName || '');
      const endpoint = map.endpoint; if (!endpoint) continue;
      const keys = JSON.parse(map.keys || '{}');

      if (Math.abs(now - nextAt) <= windowMs) {
        const sub = { endpoint, keys };
        const payload = JSON.stringify({
          title: 'Tid for bønn',
          body: nextName ? `Nå er det ${nextName}` : 'Bønnetid',
          url: '/',
        });
        try { await webpush.sendNotification(sub as any, payload); } catch {}

        const lat = Number(map.lat), lng = Number(map.lng), countryCode = String(map.countryCode || ''), tz = String(map.tz || 'UTC');
        const today = await aladhan(lat, lng, 'today', { countryCode, tz });
        let nxt = nextPrayer(today);
        if (!nxt) {
          const tomorrow = await aladhan(lat, lng, 'tomorrow', { countryCode, tz });
          nxt = { name: 'Fajr', at: tomorrow.Fajr.getTime() };
        }
        await redis(['HSET', key, 'nextName', nxt.name, 'nextAt', String(nxt.at)]);
      }
    }

    return { statusCode: 200, body: 'ok' };
  } catch (e: any) {
    return { statusCode: 500, body: `cron failed: ${e?.message || String(e)}` };
  }
};
