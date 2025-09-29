
import webpush from 'web-push'
import { getStore } from '@netlify/blobs'

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:you@example.com'

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const body = await req.json()
  const { endpoint, keys, tz } = body || {}
  if (!endpoint || !keys?.p256dh || !keys?.auth) return new Response('Bad Request', { status: 400 })

  const id = 's:' + Buffer.from(endpoint).toString('base64').slice(0,24)
  const store = getStore({ name: 'subs' })
  await store.set(id, JSON.stringify({ id, endpoint, keys, tz, createdAt: Date.now() }))
  try {
    await webpush.sendNotification({ endpoint, keys }, JSON.stringify({ title:'Push aktivert', body:'Du vil få varsler ved bønnetid.', tag:'confirm' }))
  } catch {}
  return new Response(JSON.stringify({ ok:true, id }), { status: 200, headers: { 'content-type':'application/json' } })
}
