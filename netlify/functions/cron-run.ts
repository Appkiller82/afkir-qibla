
// netlify/functions/cron-run.ts
// Server-side bønnevarsler: finner "due nå" og sender push via send-test.ts
import type { Handler } from '@netlify/functions';

const CRON_SECRET = process.env.CRON_SECRET || '';
const BASE = process.env.URL || process.env.DEPLOY_URL || '';
const SEND_TEST_PATH = '/.netlify/functions/send-test';

const UP_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UP_TOK = process.env.UPSTASH_REDIS_REST_TOKEN || '';

type SubMeta = {
  id: string;
  endpoint: string | null;
  tz?: string | null;
  lat?: string | null;
  lng?: string | null;
  countryCode?: string | null;
};

export const handler: Handler = async (event) => {
  try {
    const url = new URL(event.rawUrl);
    if (CRON_SECRET && url.searchParams.get('secret') !== CRON_SECRET) {
      return { statusCode: 401, body: 'unauthorized' };
    }

    const force = url.searchParams.get('force');

    const ids = await smembers('subs:all');
    if (!ids.length) return ok({ note: 'no subs' });

    const metas = await fetchMetas(ids);

    let sent = 0, skipped = 0, checked = 0;
    for (const m of metas) {
      checked++;
      if (!m.endpoint) { skipped++; continue; }
      const lat = Number(m.lat), lng = Number(m.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) { skipped++; continue; }

      const tz = (m.tz || 'UTC') as string;
      const cc = String(m.countryCode || '').toUpperCase();

      const due = await findDuePrayer(lat, lng, tz, cc, force);
      if (!due) continue;

      const idem = await makeIdempotencyKey(m.id, tz, due.name);
      const fresh = await setnxWithTtl(idem.key, '1', idem.ttlSec);
      if (!fresh) { skipped++; continue; }

      const title = `Tid for ${due.name}`;
      const body  = `Kl ${due.hhmm} – ${due.name} (${tz})`;

      const r = await fetch(`${BASE}${SEND_TEST_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pushSubId: m.id, title, body, url: '/' }),
      }).catch(()=>null);

      if (r && r.ok) sent++; else skipped++;
    }

    return ok({ processed: checked, sent, skipped });
  } catch (e: any) {
    return { statusCode: 500, body: `cron-run failed: ${e?.message || e}` };
  }
};

function ok(obj: any) {
  return { statusCode: 200, body: JSON.stringify({ ok: true, now: new Date().toISOString(), ...obj }) };
}

async function upstashPipe(cmds: any[]) {
  if (!UP_URL || !UP_TOK) throw new Error('Upstash not configured');
  const r = await fetch(`${UP_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UP_TOK}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error(`Upstash ${r.status} ${await r.text()}`);
  return r.json();
}
async function smembers(key: string): Promise<string[]> {
  const r = await upstashPipe([['SMEMBERS', key]]);
  const v = r?.[0]?.result || r?.[0] || [];
  return Array.isArray(v) ? v : [];
}
async function fetchMetas(ids: string[]): Promise<SubMeta[]> {
  const cmds = ids.map((id) => ['HMGET', `sub:${id}`, 'endpoint','tz','lat','lng','countryCode']);
  const res = await upstashPipe(cmds);
  return ids.map((id, i) => {
    const a = res?.[i]?.result || [];
    const [endpoint, tz, lat, lng, countryCode] = a;
    return { id, endpoint, tz, lat, lng, countryCode };
  });
}
async function setnxWithTtl(key: string, val: string, ttlSec: number): Promise<boolean> {
  const r = await upstashPipe([['SETNX', key, val], ['EXPIRE', key, ttlSec]]);
  return !!(r?.[0]?.result);
}

function addMin(d: Date, m: number) { const x = new Date(d.getTime()); x.setMinutes(x.getMinutes()+m); return x; }

async function aladhanStd(lat: number, lng: number, tz: string) {
  const url = `https://api.aladhan.com/v1/timings/today?latitude=${lat}&longitude=${lng}&method=5&school=0&timezonestring=${encodeURIComponent(tz)}&iso8601=true`;
  const j = await (await fetch(url)).json();
  const t = j?.data?.timings || {};
  return toDates(j, t, { Fajr: 0, Dhuhr: 0, Asr: 0, Maghrib: 0, Isha: 0 });
}
async function aladhanNO(lat: number, lng: number, tz: string) {
  const url = `https://api.aladhan.com/v1/timings/today?latitude=${lat}&longitude=${lng}&method=99&fajr=18&isha=14&school=0&latitudeAdjustmentMethod=3&timezonestring=${encodeURIComponent(tz)}&iso8601=true`;
  const j = await (await fetch(url)).json();
  const t = j?.data?.timings || {};
  return toDates(j, t, { Fajr: -9, Dhuhr: +12, Asr: 0, Maghrib: +8, Isha: -46 });
}

function toDates(j: any, timings: any, offsets: Record<string,number>) {
  const greg = j?.data?.date?.gregorian?.date || '';
  const [dd,mm,yyyy] = String(greg).split('-').map((n:string)=>parseInt(n,10));
  const ymd = Number.isFinite(yyyy) ? `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}` : new Date().toISOString().slice(0,10);
  const mk = (hhmm: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm)); if (!m) return null;
    const d = new Date(`${ymd}T00:00:00`); d.setHours(parseInt(m[1],10), parseInt(m[2],10), 0, 0); return d;
  };
  const out: any = {
    Fajr: mk(timings.Fajr),
    Sunrise: mk(timings.Sunrise),
    Dhuhr: mk(timings.Dhuhr),
    Asr: mk(timings.Asr),
    Maghrib: mk(timings.Maghrib),
    Isha: mk(timings.Isha)
  };
  for (const k of Object.keys(offsets)) if (out[k]) out[k] = addMin(out[k], offsets[k]);
  return out;
}

async function findDuePrayer(lat: number, lng: number, tz: string, cc: string, forceHHMM: string | null) {
  const inNO = cc === 'NO';
  const times = inNO ? await aladhanNO(lat, lng, tz) : await aladhanStd(lat, lng, tz);

  const order = ['Fajr','Sunrise','Dhuhr','Asr','Maghrib','Isha'] as const;
  const label: Record<string,string> = { Fajr:'Fajr', Sunrise:'Soloppgang', Dhuhr:'Dhuhr', Asr:'Asr', Maghrib:'Maghrib', Isha:'Isha' };

  const now = new Date();
  if (forceHHMM && /^\d{1,2}:\d{2}$/.test(forceHHMM)) {
    const [hh,mm] = forceHHMM.split(':').map(n=>parseInt(n,10));
    now.setHours(hh, mm, 0, 0);
  }

  const windowMs = 45 * 1000;
  for (const k of order) {
    const t = (times as any)[k] as Date | null;
    if (!t) continue;
    const diff = Math.abs(t.getTime() - now.getTime());
    if (diff <= windowMs) {
      const hh = String(t.getHours()).padStart(2,'0');
      const mm = String(t.getMinutes()).padStart(2,'0');
      return { name: label[k], hhmm: `${hh}:${mm}` };
    }
  }
  return null;
}

async function makeIdempotencyKey(id: string, tz: string, prayerName: string) {
  const now = new Date();
  const end = new Date(); end.setUTCHours(23,59,59,999);
  const ttlSec = Math.max(60, Math.floor((end.getTime() - now.getTime())/1000));
  const ymd = new Date().toISOString().slice(0,10);
  return { key: `sent:${id}:${ymd}:${prayerName}`, ttlSec };
}
