// frontend/src/push.ts
export type AqMeta = {
  lat: number; lng: number; city?: string; countryCode?: string; tz?: string;
  mode?: 'auto' | 'manual'; savedAt?: number;
}
export type PushKeys = { p256dh: string; auth: string }
export type PushSubscriptionJSON = { endpoint: string; keys: PushKeys }

function getApiBase(): string {
  let raw = (import.meta as any)?.env?.VITE_PUSH_SERVER_URL
  if (!raw) raw = '/.netlify/functions'
  raw = String(raw).trim().replace(/\/+$/,'').replace(/\/subscribe$/,'')
  return raw || '/.netlify/functions'
}
const API_BASE = getApiBase()

function isBase64Url(s: any) {
  return typeof s === 'string' && /^[A-Za-z0-9\-_]{50,}$/.test(s)
}
function urlBase64ToBytes(base64Url: string) {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const str = atob(base64 + pad)
  const out = new Uint8Array(str.length)
  for (let i=0;i<str.length;i++) out[i] = str.charCodeAt(i)
  return out
}
async function getVapidPublic(): Promise<string> {
  const env = (import.meta as any)?.env?.VITE_VAPID_PUBLIC_KEY
  if (isBase64Url(env)) return env as string
  for (const url of [`${API_BASE}/vapid`, `${API_BASE}/subscribe?vapid=1`]) {
    try {
      const r = await fetch(url); if (!r.ok) continue
      const j = await r.json().catch(()=>null) as any
      const key = j?.publicKey || j?.vapid || j?.key
      if (isBase64Url(key)) return key
    } catch {}
  }
  throw new Error('VAPID public key missing on client & server')
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) throw new Error('Service worker unsupported')
  return await navigator.serviceWorker.ready
}

export async function getSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await getRegistration()
    return await reg.pushManager.getSubscription()
  } catch { return null }
}

export async function subscribe(): Promise<boolean> {
  try {
    const reg = await getRegistration()
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      const vapid = await getVapidPublic()
      const keyBytes = urlBase64ToBytes(vapid)
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes.buffer })
    }
    const res = await fetch(`${API_BASE}/subscribe`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() })
    })
    const j = await res.json().catch(()=>({}))
    const id = j?.id
    if (typeof window !== 'undefined' && id) {
      try { localStorage.setItem('pushSubId', String(id)) } catch {}
    }
    return res.ok
  } catch (e:any) {
    console.error('subscribe failed:', e?.message || e)
    return false
  }
}

export async function updateMetaIfSubscribed(meta: AqMeta): Promise<boolean> {
  try {
    const reg = await getRegistration()
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return false
    const res = await fetch(`${API_BASE}/subscribe`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), meta })
    })
    return res.ok
  } catch { return false }
}

export async function registerWithMetadata(meta: AqMeta): Promise<boolean> {
  const ok = await subscribe()
  if (!ok) return false
  return await updateMetaIfSubscribed(meta)
}

export async function sendTest(title?: string, body?: string, url?: string): Promise<boolean> {
  try {
    const ok = await subscribe()
    if (!ok) console.warn('sendTest: subscribe failed (continuing)')
    const reg = await getRegistration().catch(()=>null as any)
    const sub = reg ? await reg.pushManager.getSubscription() : null
    const payload:any = { title: title || 'Test', body: body || 'Dette er en test', url: url || '/' }
    if (sub) payload.subscription = sub.toJSON()
    const res = await fetch(`${API_BASE}/send-test`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
    return res.ok
  } catch (e:any) {
    console.error('sendTest failed:', e?.message || e)
    return false
  }
}
