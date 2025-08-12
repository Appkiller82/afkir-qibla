import express from 'express'
import cors from 'cors'
import webpush from 'web-push'
import cron from 'node-cron'
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import { nanoid } from 'nanoid'
import dotenv from 'dotenv'
dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

const adapter = new JSONFile('./db.json')
const db = new Low(adapter, { subs: [] })
await db.read()
db.data ||= { subs: [] }

// Generate VAPID keys helper
if (process.argv.includes('--genkeys')) {
  const keys = webpush.generateVAPIDKeys()
  console.log('VAPID_PUBLIC_KEY=', keys.publicKey)
  console.log('VAPID_PRIVATE_KEY=', keys.privateKey)
  process.exit(0)
}

const PUBLIC = process.env.VAPID_PUBLIC_KEY
const PRIVATE = process.env.VAPID_PRIVATE_KEY
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com'
if (!PUBLIC || !PRIVATE) {
  console.warn('WARN: VAPID keys not set. Use --genkeys to generate and set env vars.')
} else {
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE)
}

app.get('/vapidPublicKey', (req,res) => {
  return res.json({ publicKey: PUBLIC || '' })
})

app.post('/subscribe', async (req,res) => {
  const { subscription, settings } = req.body || {}
  if (!subscription?.endpoint) return res.status(400).json({ error: 'No subscription' })
  const id = nanoid()
  const idx = db.data.subs.findIndex(s => s.subscription.endpoint === subscription.endpoint)
  const record = { id, subscription, settings: settings || {}, lastSent: null }
  if (idx >= 0) db.data.subs[idx] = { ...db.data.subs[idx], ...record }
  else db.data.subs.push(record)
  await db.write()
  return res.json({ ok: true, id })
})

app.post('/unsubscribe', async (req,res) => {
  const { endpoint } = req.body || {}
  const before = db.data.subs.length
  db.data.subs = db.data.subs.filter(s => s.subscription.endpoint != endpoint)
  await db.write()
  return res.json({ ok: true, removed: before - db.data.subs.length })
})

app.post('/send-test', async (req,res) => {
  const sub = db.data.subs[0]
  if (!sub) return res.json({ ok: false, message: 'No subscribers' })
  try {
    await webpush.sendNotification(sub.subscription, JSON.stringify({ title: 'Afkir Qibla', body: 'Testvarsel fungerer ✅' }))
    return res.json({ ok: true })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message })
  }
})

import { PrayerTimes, Coordinates, CalculationMethod, HighLatitudeRule, Madhab } from 'adhan'
function buildParams(methodKey) {
  const m = CalculationMethod
  switch (methodKey) {
    case 'MWL': return m.MuslimWorldLeague()
    case 'UmmAlQura': return m.UmmAlQura()
    case 'Egyptian': return m.Egyptian()
    case 'Karachi': return m.Karachi()
    case 'Dubai': return m.Dubai()
    case 'Moonsighting': return m.Moonsighting()
    default: return m.MuslimWorldLeague()
  }
}

function nextPrayerTimesUnix(settings) {
  const { lat, lng, method='MWL', hlr='MiddleOfTheNight', minutesBefore=10 } = settings || {}
  if (lat == null || lng == null) return null
  const now = new Date()
  const params = buildParams(method)
  params.madhab = Madhab.Shafi
  params.highLatitudeRule = HighLatitudeRule[hlr] ?? HighLatitudeRule.MiddleOfTheNight

  const coords = new Coordinates(lat, lng)
  const pt = new PrayerTimes(coords, now, params)
  const order = ['fajr','sunrise','dhuhr','asr','maghrib','isha']
  const times = [pt.fajr, pt.sunrise, pt.dhuhr, pt.asr, pt.maghrib, pt.isha]
  const leadMs = (minutesBefore||0)*60*1000
  let nextTs = null, nextName = null
  for (let i=0;i<times.length;i++) {
    const t = times[i].getTime() - leadMs
    if (t > now.getTime()) { nextTs = t; nextName = order[i]; break }
  }
  if (!nextTs) {
    const tomorrow = new Date(now.getTime()+24*60*60*1000)
    const pt2 = new PrayerTimes(coords, tomorrow, params)
    const times2 = [pt2.fajr, pt2.sunrise, pt2.dhuhr, pt2.asr, pt2.maghrib, pt2.isha]
    nextTs = (times2[0].getTime() - leadMs)
    nextName = order[0]
  }
  return { ts: nextTs, name: nextName }
}

cron.schedule('* * * * *', async () => {
  const now = Date.now()
  for (const sub of db.data.subs) {
    try {
      const res = nextPrayerTimesUnix(sub.settings)
      if (!res) continue
      const { ts, name } = res
      const delta = Math.abs(ts - now)
      if (delta <= 60*1000 && sub.lastSent !== name + ':' + new Date().toDateString()) {
        await webpush.sendNotification(sub.subscription, JSON.stringify({
          title: 'Bønnetid nærmer seg',
          body: `${name.charAt(0).toUpperCase()+name.slice(1)} om ca. ${sub.settings.minutesBefore||0} min.`,
          url: '/'
        }))
        sub.lastSent = name + ':' + new Date().toDateString()
        await db.write()
      }
    } catch (e) {}
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log('Push server running on', PORT))
