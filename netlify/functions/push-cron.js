
import webpush from 'web-push'
import { getStore } from '@netlify/blobs'

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:you@example.com'

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

export default async function handler(req, context) {
  if (context?.scheduled !== true) return new Response('Forbidden', { status: 403 })

  const subs = await getSubs()
  let sent = 0
  // naive: just send a heartbeat to ensure infra works (replace later with real scheduler)
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title:'Bønnetid', body:'Tid for bønn', tag:'prayer' }), { TTL: 120 })
      sent++
    } catch {}
  }
  return new Response(JSON.stringify({ ok:true, sent }), { status:200, headers:{'content-type':'application/json'} })
}

async function getSubs(){
  const store = getStore({ name: 'subs' })
  const keys = await store.list()
  const res = []
  for (const k of keys.blobs) {
    const v = await store.get(k.key, { type:'json' })
    if (v) res.push(v)
  }
  return res
}
