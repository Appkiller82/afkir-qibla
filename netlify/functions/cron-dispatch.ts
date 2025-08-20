// netlify/functions/cron-dispatch.ts
import type { Handler } from '@netlify/functions'
import webpush from 'web-push'

// Schedule: every minute (UTC)
export const config = { schedule: '* * * * *' }

const UP_URL = process.env.UPSTASH_REDIS_REST_URL || ''
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || ''
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || ''
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT     || ''

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

// === Correct Upstash REST helpers ===
// Single command: POST base URL with JSON array body ["CMD","arg1",...]
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
// Pipeline: POST /pipeline with body as a 2D JSON array [[...],[...]]
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

export const handler: Handler = async () => {
  console.log('[cron] tick', new Date().toISOString())

  try {
    if (!UP_URL || !UP_TOKEN) {
      console.log('[cron] Upstash not configured; idle')
      return { statusCode: 200, body: 'Upstash not configured; cron idle.' }
    }
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
      console.error('[cron] Missing VAPID env')
      return { statusCode: 500, body: 'Missing VAPID env' }
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

    const r = await redisSingle(['SMEMBERS','subs:all'])
    const ids:string[] = r.result || r || []
    console.log('[cron] subs:', ids.length)

    if (!ids.length) {
      console.log('[cron] no subscribers; ok')
      return { statusCode: 200, body: 'no subscribers' }
    }

    const now = Date.now()
    const windowMs = 60_000 // ±60s
    let sent = 0, updated = 0, skipped = 0

    for (const id of ids) {
      const h = await redisSingle(['HGETALL', `sub:${id}`])
      const entries:string[] = h.result || h || []
      if (!entries.length) { skipped++; continue }
      const m:Record<string,string> = {}; for(let i=0;i<entries.length;i+=2){ m[entries[i]] = entries[i+1] }

      if (m.active !== '1') { skipped++; continue }
      const endpoint = m.endpoint; if (!endpoint) { skipped++; continue }
      let keys:any = {}; try { keys = JSON.parse(m.keys || '{}') } catch {}
      const nextAt = Number(m.nextAt || 0); const nextName = String(m.nextName || '')
      if (!nextAt || Math.abs(now - nextAt) > windowMs) { skipped++; continue }

      const sub = { endpoint, keys } as any
      const payload = JSON.stringify({ title: 'Tid for bønn', body: nextName ? `Nå er det ${nextName}` : 'Bønnetid', url: '/' })
      try {
        await webpush.sendNotification(sub, payload)
        sent++;
      } catch (e:any) {
        console.error('[cron] push failed for', id, e?.message || e)
      }

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

    console.log('[cron] done', { sent, updated, skipped })
    return { statusCode: 200, body: `cron ok: sent=${sent} updated=${updated} skipped=${skipped}` }
  } catch (e:any) {
    console.error('[cron] failed:', e?.message || String(e))
    return { statusCode: 500, body: `cron failed: ${e?.message || String(e)}` }
  }
}
