// netlify/functions/send-test.ts
import type { Handler } from "@netlify/functions"
import webpush from "web-push"

const UP_URL = process.env.UPSTASH_REDIS_REST_URL || ""
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || ""

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

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' }
    }
    const body = event.body ? JSON.parse(event.body) : {}
    const title = String(body.title || 'Test')
    const msg = String(body.body || 'Dette er en testmelding fra Netlify-funksjonen.')
    const url = String(body.url || '/')

    let subscription = body.subscription

    // Fallback: pull from Upstash if pushSubId supplied
    if (!subscription && body.pushSubId && UP_URL && UP_TOKEN) {
      try {
        const r = await redisSingle(['HGETALL', `sub:${body.pushSubId}`])
        const entries:string[] = r.result || r || []
        const m:Record<string,string> = {}; for(let i=0;i<entries.length;i+=2){ m[entries[i]] = entries[i+1] }
        if (m.endpoint && m.keys) {
          const keys = JSON.parse(m.keys)
          subscription = { endpoint: m.endpoint, keys }
        }
      } catch (e) {
        // ignore, we'll validate below
      }
    }

    if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return { statusCode: 400, body: 'Invalid subscription: include PushSubscription JSON' }
    }

    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      return { statusCode: 500, body: 'VAPID keys not set on server' }
    }

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:you@example.com",
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    )

    const payload = JSON.stringify({ title, body: msg, url })
    await webpush.sendNotification(subscription, payload)

    return { statusCode: 200, body: JSON.stringify({ ok: true }) }
  } catch (err:any) {
    console.error('send-test error:', err?.message || err)
    return { statusCode: 500, body: err?.message || 'Unknown error' }
  }
}
