// frontend/src/push.ts
// Robust Web Push client helpers with server-fallback for VAPID.
// Fixes 'h.slice is not a function' by validating key types and never assuming .slice exists.
// Also exports registerWithMetadata() and sendTest() for backwards-compat.

export type PushKeys = { p256dh: string; auth: string }
export type PushSubscriptionJSON = { endpoint: string; keys: PushKeys }
export type AqMeta = {
  lat: number; lng: number; city?: string; countryCode?: string; tz?: string;
  mode?: 'auto' | 'manual'; savedAt?: number;
}

// ---------------- Env + URL helpers ----------------
function getCleanApiBase(): string {
  try {
    let raw = (import.meta as any)?.env?.VITE_PUSH_SERVER_URL
    if (typeof raw !== 'string' || !raw) raw = '/.netlify/functions'
    raw = raw.trim()
    // strip trailing slashes and accidental '/subscribe'
    raw = raw.replace(/\/+$/,'').replace(/\/subscribe$/,'')
    return raw || '/.netlify/functions'
  } catch { return '/.netlify/functions' }
}
const API_BASE = getCleanApiBase()

function isBase64Url(s: unknown) {
  return typeof s === 'string' && /^[A-Za-z0-9\-_]+$/.test(s) && s.length >= 30
}

function urlBase64ToUint8Array(base64String: string) {
  if (!isBase64Url(base64String)) {
    throw new Error('VAPID public key missing or invalid')
  }
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function fetchServerVapid(): Promise<string | ''> {
  // Try GET /subscribe?vapid=1 then /vapid
  const tryUrls = [`${API_BASE}/subscribe?vapid=1`, `${API_BASE}/vapid`]
  for (const u of tryUrls) {
    try {
      const r = await fetch(u, { method: 'GET' })
      if (!r.ok) continue
      const j = await r.json().catch(()=>null as any)
      const k = (j && (j.publicKey || j.key || j.vapid || j.v)) as any
      if (isBase64Url(k)) return String(k)
    } catch {}
  }
  return ''
}

async function ensureVapidPublicKey(): Promise<string> {
  const fromEnv = (import.meta as any)?.env?.VITE_VAPID_PUBLIC_KEY
  if (isBase64Url(fromEnv)) return String(fromEnv)
  const fromServer = await fetchServerVapid()
  if (isBase64Url(fromServer)) return fromServer
  throw new Error('Ingen gyldig VAPID-public key i klient eller fra server')
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) throw new Error('Service worker unsupported')
  const reg = await navigator.serviceWorker.ready
  return reg
}
export async function getSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await getRegistration()
    return await reg.pushManager.getSubscription()
  } catch { return null }
}

// ---------------- Main API ----------------
export async function subscribe(): Promise<boolean> {
  try {
    const reg = await getRegistration()
    const existing = await reg.pushManager.getSubscription()
    if (existing) return true

    const vapid = await ensureVapidPublicKey()
    const key = urlBase64ToUint8Array(vapid)

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key
    })

    await fetch(`${API_BASE}/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() })
    }).catch(()=>{})

    return true
  } catch (e: any) {
    console.error('subscribe failed:', e?.message || e)
    return false
  }
}

export async function unsubscribe(): Promise<boolean> {
  try {
    const sub = await getSubscription()
    if (!sub) return true
    await sub.unsubscribe()
    return true
  } catch { return false }
}

export async function updateMetaIfSubscribed(meta: AqMeta): Promise<boolean> {
  try {
    const reg = await getRegistration()
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return false
    const payload = { subscription: sub.toJSON() as PushSubscriptionJSON, meta }
    const res = await fetch(`${API_BASE}/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) console.warn('updateMetaIfSubscribed: server returned', res.status)
    return res.ok
  } catch (e) {
    console.error('updateMetaIfSubscribed failed', e)
    return false
  }
}

// ---------------- Back-compat ----------------
export async function registerWithMetadata(meta: AqMeta): Promise<boolean> {
  const ok = await subscribe()
  if (!ok) return false
  return await updateMetaIfSubscribed(meta)
}

export async function sendTest(title?: string, body?: string, url?: string): Promise<boolean> {
  try {
    // Ensure there IS a subscription before testing
    const reg = await getRegistration()
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      const ok = await subscribe()
      if (!ok) return false
      sub = await reg.pushManager.getSubscription()
      if (!sub) return false
    }
    const payload = { title: title || 'Test', body: body || 'Dette er en test', url: url || '/', subscription: sub!.toJSON() }
    const res = await fetch(`${API_BASE}/send-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return res.ok
  } catch (e) {
    console.error('sendTest failed', e)
    return false
  }
}
