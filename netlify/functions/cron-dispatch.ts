// netlify/functions/cron-dispatch.ts
// Scheduled function that sends prayer push notifications.
// Adds tolerance window for late cron ticks and de-duplication via lastSentAt.
import type { Config } from "@netlify/functions"
import webpush from "web-push"

// Run every minute (UTC). This file is NOT invokable via URL in prod.
export const config: Config = { schedule: "* * * * *" }

// ---- Config / env ----
const UP_URL = process.env.UPSTASH_REDIS_REST_URL || ""
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || ""
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || ""
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || ""
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT     || ""

// Allow small lateness, avoid stale sends
const LATE_TOLERANCE_MS = 5 * 60_000   // send if up to 5 min late
const TOO_LATE_MS       = 15 * 60_000  // drop if over 15 min late

// Norway (IRN) tuning
const NO_IRN_PROFILE = {
  fajrAngle: 18.0, ishaAngle: 14.0, latitudeAdj: 3, school: 0,
  offsets: { Fajr: -9, Dhuhr: +12, Asr: 0, Maghrib: +8, Isha: -46 },
}
type Times = Record<'Fajr'|'Sunrise'|'Dhuhr'|'Asr'|'Maghrib'|'Isha', Date>

function mkDate(ymdStr: string, hhmm: string) {
  const [h, m] = hhmm.split(':').map(x=>parseInt(x,10))
  const d = new Date(`${ymdStr}T00:00:00`)
  d.setHours(h, m, 0, 0)
  return d
}
function ddmmyyyyToYmd(ddmmyyyy: string) {
  const [dd, mm, yyyy] = ddmmyyyy.split('-').map(x=>parseInt(x,10))
  return `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`
}
async function fetchAladhan(lat:number,lng:number,when:'today'|'tomorrow',opts:{countryCode?:string,tz?:string}):Promise<Times>{
  const tz = opts?.tz || 'UTC'
  const p = new URLSearchParams({ latitude:String(lat), longitude:String(lng), timezonestring:tz, iso8601:'true' })
  if ((opts?.countryCode||'').toUpperCase()==='NO'){
    p.set('method','99')
    p.set('fajr',String(NO_IRN_PROFILE.fajrAngle))
    p.set('isha',String(NO_IRN_PROFILE.ishaAngle))
    p.set('school',String(NO_IRN_PROFILE.school))
    p.set('latitudeAdjustmentMethod',String(NO_IRN_PROFILE.latitudeAdj))
  } else {
    p.set('method','5') // Umm Al-Qura
    p.set('school','0')
  }
  const res = await fetch(`https://api.aladhan.com/v1/timings/${when}?${p.toString()}`)
  const j = await res.json()
  if (!res.ok || j.code !== 200) throw new Error(`AlAdhan error ${res.status}`)
  const ymd = ddmmyyyyToYmd(j.data?.date?.gregorian?.date as string)
  const t = j.data.timings
  const base:Times = { Fajr:mkDate(ymd,t.Fajr), Sunrise:mkDate(ymd,t.Sunrise), Dhuhr:mkDate(ymd,t.Dhuhr), Asr:mkDate(ymd,t.Asr), Maghrib:mkDate(ymd,t.Maghrib), Isha:mkDate(ymd,t.Isha) }
  if ((opts?.countryCode||'').toUpperCase()==='NO'){
    const o = NO_IRN_PROFILE.offsets
    base.Fajr.setMinutes(base.Fajr.getMinutes()+(o.Fajr||0))
    base.Dhuhr.setMinutes(base.Dhuhr.getMinutes()+(o.Dhuhr||0))
    base.Asr.setMinutes(base.Asr.getMinutes()+(o.Asr||0))
    base.Maghrib.setMinutes(base.Maghrib.getMinutes()+(o.Maghrib||0))
    base.Isha.setMinutes(base.Isha.getMinutes()+(o.Isha||0))
  }
  return base
}
function nextPrayer(times:Times){
  const now=Date.now()
  const order:(keyof Times)[]=['Fajr','Sunrise','Dhuhr','Asr','Maghrib','Isha']
  for(const k of order){ const d=times[k]; if(d && d.getTime()>now) return { name:k, at:d.getTime() } }
  return null
}

// ---- Upstash REST helpers ----
// Single: POST base URL with JSON array body ["CMD","arg1",...]
async function redisSingle(cmd: string[]) {
  if(!UP_URL || !UP_TOKEN) throw new Error('NO_UPSTASH')
  const res = await fetch(UP_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmd),
  })
  if (!res.ok) {
    const txt = await res.text().catch(()=>String(res.status))
    throw new Error(`Redis ${res.status} ${txt}`)
  }
  return res.json()
}
// Pipeline: POST /pipeline with body as 2D array [[...],[...]]
async function redisMany(cmds: string[][]) {
  if(!UP_URL || !UP_TOKEN) throw new Error('NO_UPSTASH')
  const res = await fetch(`${UP_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmds),
  })
  if (!res.ok) {
    const txt = await res.text().catch(()=>String(res.status))
    throw new Error(`RedisPipe ${res.status} ${txt}`)
  }
  return res.json()
}

async function runCron(): Promise<string> {
  console.log('[cron] tick', new Date().toISOString())

  if (!UP_URL || !UP_TOKEN) {
    console.log('[cron] Upstash not configured; idle')
    return 'Upstash not configured; cron idle.'
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    console.error('[cron] Missing VAPID env')
    return 'Missing VAPID env'
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

  const r = await redisSingle(['SMEMBERS','subs:all'])
  const ids:string[] = r.result || r || []
  console.log('[cron] subs:', ids.length)

  if (!ids.length) {
    console.log('[cron] no subscribers; ok')
    return 'no subscribers'
  }

  const now = Date.now()
  let sent = 0, updated = 0, skipped = 0
  let skipNoHash=0, skipInactive=0, skipNoEndpoint=0, skipWindow=0

  for (const id of ids) {
    const h = await redisSingle(['HGETALL', `sub:${id}`])
    const entries:string[] = h.result || h || []
    if (!entries.length) { skipped++; skipNoHash++; continue }
    const m:Record<string,string> = {}; for(let i=0;i<entries.length;i+=2){ m[entries[i]] = entries[i+1] }

    if (m.active !== '1') { skipped++; skipInactive++; continue }
    const endpoint = m.endpoint; if (!endpoint) { skipped++; skipNoEndpoint++; continue }
    let keys:any = {}; try { keys = JSON.parse(m.keys || '{}') } catch {}

    const nextAt   = Number(m.nextAt || 0)
    const lastSent = Number(m.lastSentAt || 0)
    const nextName = String(m.nextName || '')

    // Window logic
    const tooEarly    = !nextAt || (now < (nextAt - LATE_TOLERANCE_MS))
    const alreadySent = lastSent && lastSent >= nextAt
    const tooLate     = nextAt && (now - nextAt) > TOO_LATE_MS

    if (tooEarly || alreadySent || tooLate) { skipped++; skipWindow++; continue }

    // === SEND ===
    const sub = { endpoint, keys } as any
    const payload = JSON.stringify({ title: 'Tid for bønn', body: nextName ? `Nå er det ${nextName}` : 'Bønnetid', url: '/' })
    try {
      await webpush.sendNotification(sub, payload)
      sent++
      // mark as sent to avoid duplicates if cron fires multiple times
      await redisMany([['HSET', `sub:${id}`, 'lastSentAt', String(nextAt), 'lastSentName', nextName]])
    } catch (e:any) {
      console.error('[cron] push failed for', id, e?.message || e)
    }

    // Reschedule next prayer
    const lat = Number(m.lat), lng = Number(m.lng)
    const countryCode = String(m.countryCode || '')
    const tz = String(m.tz || 'UTC')
    try {
      const today = await fetchAladhan(lat,lng,'today',{countryCode,tz})
      let nxt = nextPrayer(today)
      if (!nxt) {
        const tomorrow = await fetchAladhan(lat,lng,'tomorrow',{countryCode,tz})
        nxt = { name: 'Fajr', at: tomorrow.Fajr.getTime() }
      }
      await redisMany([ ['HSET', `sub:${id}`, 'nextName', String(nxt!.name), 'nextAt', String(nxt!.at)] ])
      updated++
    } catch (e:any) {
      console.error('[cron] could not reschedule', id, e?.message || e)
    }
  }

  console.log('[cron] done', { sent, updated, skipped, skipNoHash, skipInactive, skipNoEndpoint, skipWindow })
  return `cron ok: sent=${sent} updated=${updated} skipped=${skipped}`
}

// Default export for scheduled functions
export default async (req: Request): Promise<Response> => {
  const { next_run } = await req.json().catch(() => ({} as any))
  console.log('[cron] scheduled invoke; next_run:', next_run)
  const result = await runCron()
  return new Response(result, { status: 200 })
}
