// netlify/functions/send-test.ts
import type { Handler } from '@netlify/functions'
import webpush from 'web-push'

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || process.env.VITE_VAPID_PUBLIC_KEY || ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com'

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

export const handler: Handler = async (event) => {
  try {
    if (!event.body) {
      console.warn('[send-test] missing body')
      return { statusCode: 400, body: 'Missing body' }
    }
    let data: any = {}
    try { data = JSON.parse(event.body) } catch {
      console.warn('[send-test] invalid json')
      return { statusCode: 400, body: 'Invalid JSON' }
    }

    const sub = data.subscription
    const title = data.title || 'Test'
    const body = data.body || 'Dette er en test'
    const url = data.url || '/'

    if (!sub || !sub.endpoint) {
      console.warn('[send-test] missing subscription.endpoint')
      return { statusCode: 400, body: 'Missing subscription.endpoint' }
    }
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      console.error('[send-test] VAPID keys not set')
      return { statusCode: 500, body: 'Server missing VAPID keys' }
    }

    await webpush.sendNotification(sub, JSON.stringify({ title, body, url }))
    return { statusCode: 200, body: JSON.stringify({ ok: true }) }
  } catch (e: any) {
    console.error('[send-test] error:', e?.message || e)
    return { statusCode: 500, body: e?.message || 'Unknown error' }
  }
}
