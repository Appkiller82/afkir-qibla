
import { getStore } from '@netlify/blobs'
export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const body = await req.json()
  const { endpoint } = body || {}
  if (!endpoint) return new Response('Bad Request', { status: 400 })
  const id = 's:' + Buffer.from(endpoint).toString('base64').slice(0,24)
  const store = getStore({ name: 'subs' })
  await store.delete(id)
  return new Response(JSON.stringify({ ok:true }), { status: 200, headers: { 'content-type':'application/json' } })
}
