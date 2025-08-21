// netlify/functions/subscribe.ts
import type { Handler } from "@netlify/functions"

const UP_URL   = process.env.UPSTASH_REDIS_REST_URL || ""
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || ""
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || ""
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || ""
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT     || ""

async function redisSingle(cmd: string[]) {
  if(!UP_URL || !UP_TOKEN) return { skipped: true } // tolerant: no-op
  const res = await fetch(UP_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmd),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Redis ${res.status} ${text}`)
  try { return JSON.parse(text) } catch { return { result: text } }
}
async function redisMany(cmds: string[][]) {
  if(!UP_URL || !UP_TOKEN) return { skipped: true } // tolerant: no-op
  const res = await fetch(`${UP_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmds),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`RedisPipe ${res.status} ${text}`)
  try { return JSON.parse(text) } catch { return { result: text } }
}
function b64url(s: string) {
  return Buffer.from(s, 'utf8').toString('base64url')
}
function toKV(m: Record<string, any>) {
  const out: string[] = []
  for (const [k,v] of Object.entries(m)) {
    if (v === undefined || v === null) continue
    out.push(String(k), typeof v === 'string' ? v : JSON.stringify(v))
  }
  return out
}

export const handler: Handler = async (event) => {
  try {
    // GET: expose public VAPID for client
    if (event.httpMethod === 'GET') {
      return new Response(JSON.stringify({ publicKey: VAPID_PUBLIC_KEY || '' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }

    if (event.httpMethod !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    const body = event.body ? JSON.parse(event.body) : {}
    const subscription = body.subscription
    const meta = body.meta || {}

    if (!subscription || !subscription.endpoint) {
      // answer 200 to keep client happy, but indicate missing subscription
      return new Response(JSON.stringify({ ok: false, reason: 'NO_SUBSCRIPTION' }), {
        status: 200, headers: { 'content-type': 'application/json' }
      })
    }

    const id = b64url(subscription.endpoint)
    const now = Date.now()

    // Persist to Upstash if configured
    const cmdList: string[][] = [
      ['SADD', 'subs:all', id],
      ['HSET', `sub:${id}`, ...toKV({
        active: '1',
        endpoint: subscription.endpoint,
        keys: subscription.keys ? JSON.stringify(subscription.keys) : undefined,
        lat: meta.lat, lng: meta.lng,
        city: meta.city, countryCode: meta.countryCode, tz: meta.tz,
        mode: meta.mode, savedAt: meta.savedAt || now
      })]
    ]
    try { await redisMany(cmdList) } catch (e) { console.warn('[subscribe] redis skipped/failed:', (e as any)?.message || e) }

    return new Response(JSON.stringify({ ok: true, id }), {
      status: 200, headers: { 'content-type': 'application/json' }
    })
  } catch (e: any) {
    console.error('[subscribe] error', e?.message || e)
    // Be tolerant: never 500 the client for subscribe
    return new Response(JSON.stringify({ ok: false, error: 'SUBSCRIBE_FAILED' }), {
      status: 200, headers: { 'content-type': 'application/json' }
    })
  }
}
