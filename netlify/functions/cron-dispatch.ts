
// netlify/functions/cron-dispatch.ts
import type { Handler, Config } from "@netlify/functions";
import webpush from "web-push";

export const config: Config = { schedule: "* * * * *" }; // every minute UTC

const UP_URL  = process.env.UPSTASH_REDIS_REST_URL || "";
const UP_TOK  = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const VAPID_PUB  = process.env.VAPID_PUBLIC_KEY  || process.env.VITE_VAPID_PUBLIC_KEY || "";
const VAPID_PRIV = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJ = process.env.VAPID_SUBJECT     || "mailto:admin@example.com";

const LATE_TOLERANCE_MS = 5 * 60_000;
const TOO_LATE_MS       = 15 * 60_000;

const NO_IRN_PROFILE = {
  fajrAngle: 18.0, ishaAngle: 14.0, latitudeAdj: 3, school: 0,
  offsets: { Fajr: -9, Dhuhr: +12, Asr: 0, Maghrib: +8, Isha: -46 },
};
type Times = Record<'Fajr'|'Sunrise'|'Dhuhr'|'Asr'|'Maghrib'|'Isha', Date>;

function mkDate(ymdStr: string, hhmm: string) {
  const [h, m] = hhmm.split(':').map(x=>parseInt(x,10));
  const d = new Date(`${ymdStr}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d;
}
function ddmmyyyyToYmd(ddmmyyyy: string) {
  const [dd, mm, yyyy] = ddmmyyyy.split('-').map(x=>parseInt(x,10));
  return `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
}
async function fetchAladhan(lat:number,lng:number,when:'today'|'tomorrow',opts:{countryCode?:string,tz?:string}):Promise<Times>{
  const tz = opts?.tz || 'UTC';
  const p = new URLSearchParams({ latitude:String(lat), longitude:String(lng), timezonestring:tz, iso8601:'true' });
  if ((opts?.countryCode||'').toUpperCase()==='NO'){
    p.set('method','99');
    p.set('fajr',String(NO_IRN_PROFILE.fajrAngle));
    p.set('isha',String(NO_IRN_PROFILE.ishaAngle));
    p.set('school',String(NO_IRN_PROFILE.school));
    p.set('latitudeAdjustmentMethod',String(NO_IRN_PROFILE.latitudeAdj));
  } else {
    p.set('method','5');
    p.set('school','0');
  }
  const res = await fetch(`https://api.aladhan.com/v1/timings/${when}?${p.toString()}`);
  const j = await res.json();
  if (!res.ok || j.code !== 200) throw new Error(`AlAdhan ${res.status}`);
  const ymd = ddmmyyyyToYmd(j.data?.date?.gregorian?.date as string);
  const t = j.data.timings;
  const base:Times = { Fajr:mkDate(ymd,t.Fajr), Sunrise:mkDate(ymd,t.Sunrise), Dhuhr:mkDate(ymd,t.Dhuhr), Asr:mkDate(ymd,t.Asr), Maghrib:mkDate(ymd,t.Maghrib), Isha:mkDate(ymd,t.Isha) };
  if ((opts?.countryCode||'').toUpperCase()==='NO'){
    const o = NO_IRN_PROFILE.offsets;
    base.Fajr.setMinutes(base.Fajr.getMinutes()+(o.Fajr||0));
    base.Dhuhr.setMinutes(base.Dhuhr.getMinutes()+(o.Dhuhr||0));
    base.Asr.setMinutes(base.Asr.getMinutes()+(o.Asr||0));
    base.Maghrib.setMinutes(base.Maghrib.getMinutes()+(o.Maghrib||0));
    base.Isha.setMinutes(base.Isha.getMinutes()+(o.Isha||0));
  }
  return base;
}
function nextPrayer(times:Times){
  const now=Date.now();
  const order:(keyof Times)[]=['Fajr','Sunrise','Dhuhr','Asr','Maghrib','Isha'];
  for(const k of order){ const d=times[k]; if(d && d.getTime()>now) return { name:k, at:d.getTime() } }
  return null;
}

// Upstash REST
async function redisSingle(cmd: string[]) {
  if(!UP_URL || !UP_TOK) throw new Error('NO_UPSTASH');
  const res = await fetch(UP_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UP_TOK}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) {
    const txt = await res.text().catch(()=>String(res.status));
    throw new Error(`Redis ${res.status} ${txt}`);
  }
  return res.json();
}
async function redisMany(cmds: string[][]) {
  if(!UP_URL || !UP_TOK) throw new Error('NO_UPSTASH');
  const res = await fetch(`${UP_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UP_TOK}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) {
    const txt = await res.text().catch(()=>String(res.status));
    throw new Error(`RedisPipe ${res.status} ${txt}`);
  }
  return res.json();
}

function ensureVapid() {
  if (!VAPID_PUB || !VAPID_PRIV || !VAPID_SUBJ) {
    throw new Error('Missing VAPID env');
  }
  webpush.setVapidDetails(VAPID_SUBJ, VAPID_PUB, VAPID_PRIV);
}

async function runCron(): Promise<{text:string, stats:any}> {
  console.log('[cron] tick', new Date().toISOString());

  if (!UP_URL || !UP_TOK) {
    const text = 'Upstash not configured; cron idle.';
    console.log('[cron]', text);
    return { text, stats: {} };
  }
  ensureVapid();

  const r = await redisSingle(['SMEMBERS','subs:all']);
  const ids:string[] = r.result || r || [];
  console.log('[cron] subs:', ids.length);
  if (!ids.length) return { text: 'cron ok: sent=0 updated=0 skipped=0', stats: { sent:0,updated:0,skipped:0 } };

  const now = Date.now();
  let sent = 0, updated = 0, skipped = 0;
  let skipNoHash=0, skipInactive=0, skipNoEndpoint=0, skipWindow=0;

  for (const id of ids) {
    const h = await redisSingle(['HGETALL', `sub:${id}`]);
    const entries:string[] = h.result || h || [];
    if (!entries.length) { skipped++; skipNoHash++; continue; }
    const m:Record<string,string> = {}; for(let i=0;i<entries.length;i+=2){ m[entries[i]] = entries[i+1]; }

    if (m.active !== '1') { skipped++; skipInactive++; continue; }
    const endpoint = m.endpoint; if (!endpoint) { skipped++; skipNoEndpoint++; continue; }
    let keys:any = {}; try { keys = JSON.parse(m.keys || '{}'); } catch {}

    const nextAt   = Number(m.nextAt || 0);
    const lastSent = Number(m.lastSentAt || 0);
    const nextName = String(m.nextName || '');

    const tooEarly    = !nextAt || (now < (nextAt - LATE_TOLERANCE_MS));
    const alreadySent = lastSent && lastSent >= nextAt;
    const tooLate     = nextAt && (now - nextAt) > TOO_LATE_MS;

    if (tooEarly || alreadySent) { skipped++; skipWindow++; continue; }

    if (!nextAt || tooLate) {
      const lat = Number(m.lat), lng = Number(m.lng);
      const countryCode = String(m.countryCode || '');
      const tz = String(m.tz || 'UTC');
      try {
        const today = await fetchAladhan(lat,lng,'today',{countryCode,tz});
        let nxt = nextPrayer(today);
        if (!nxt) {
          const tomorrow = await fetchAladhan(lat,lng,'tomorrow',{countryCode,tz});
          nxt = { name: 'Fajr', at: tomorrow.Fajr.getTime() };
        }
        await redisMany([ ['HSET', `sub:${id}`, 'nextName', String(nxt!.name), 'nextAt', String(nxt!.at)] ]);
        updated++;
      } catch (e:any) {
        console.error('[cron] reschedule-only failed', id, e?.message || e);
      }
      skipped++; continue;
    }

    // SEND
    const sub = { endpoint, keys } as any;
    const payload = JSON.stringify({ title: 'Tid for bønn', body: nextName ? `Nå er det ${nextName}` : 'Bønnetid', url: '/' });
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
      await redisMany([['HSET', `sub:${id}`, 'lastSentAt', String(nextAt), 'lastSentName', nextName]]);
    } catch (e:any) {
      console.error('[cron] push failed for', id, e?.message || e);
    }

    // plan next
    const lat = Number(m.lat), lng = Number(m.lng);
    const countryCode = String(m.countryCode || '');
    const tz = String(m.tz || 'UTC');
    try {
      const today = await fetchAladhan(lat,lng,'today',{countryCode,tz});
      let nxt = nextPrayer(today);
      if (!nxt) {
        const tomorrow = await fetchAladhan(lat,lng,'tomorrow',{countryCode,tz});
        nxt = { name: 'Fajr', at: tomorrow.Fajr.getTime() };
      }
      await redisMany([ ['HSET', `sub:${id}`, 'nextName', String(nxt!.name), 'nextAt', String(nxt!.at)] ]);
      updated++;
    } catch (e:any) {
      console.error('[cron] could not reschedule', id, e?.message || e);
    }
  }

  const stats = { sent, updated, skipped, skipNoHash, skipInactive, skipNoEndpoint, skipWindow };
  console.log('[cron] done', stats);
  return { text: `cron ok: sent=${sent} updated=${updated} skipped=${skipped}`, stats };
}

export const handler: Handler = async (event) => {
  try {
    const method = event.httpMethod || "GET";
    const qs = event.queryStringParameters || {};

    if (method === "GET" && qs.health === "1") {
      let redisPing:any = null, upstashConfigured = !!(UP_URL && UP_TOK);
      if (upstashConfigured) {
        try {
          const r = await fetch(UP_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${UP_TOK}`, 'content-type':'application/json' },
            body: JSON.stringify(['PING']),
          });
          redisPing = await r.json().catch(()=>({}));
        } catch (e:any) { redisPing = { error: e?.message || String(e) }; }
      }
      const vapidConfigured = !!(VAPID_PUB && VAPID_PRIV && VAPID_SUBJ);
      return { statusCode: 200, headers: { "content-type":"application/json" }, body: JSON.stringify({ upstashConfigured, vapidConfigured, redisPing }) };
    }

    if (method === "GET" && qs.run === "1") {
      const { text, stats } = await runCron();
      return { statusCode: 200, body: `${text}\n${JSON.stringify(stats)}` };
    }

    if (method === "POST") {
      const { text, stats } = await runCron();
      return { statusCode: 200, body: `${text}\n${JSON.stringify(stats)}` };
    }

    // default GET without params
    return { statusCode: 200, body: "OK. Add ?run=1 to trigger or ?health=1 for status." };
  } catch (e:any) {
    console.error('[cron] top-level error', e?.message || e);
    return { statusCode: 500, body: 'cron error: ' + (e?.message || String(e)) };
  }
};
