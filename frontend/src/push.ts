// frontend/src/push.ts
// Robust push helpers + test sender.
// Fixes: sendTest 400 by always including PushSubscription; avoids slice issues.
// Exports: subscribe, unsubscribe, updateMetaIfSubscribed, registerWithMetadata, sendTest.
export type PushKeys = { p256dh: string; auth: string }
export type PushSubscriptionJSON = { endpoint: string; keys: PushKeys }
export type AqMeta = {
  lat: number; lng: number; city?: string; countryCode?: string; tz?: string;
  mode?: 'auto' | 'manual'; savedAt?: number;
}

function cleanApiBase(): string {
  let b = (import.meta as any)?.env?.VITE_PUSH_SERVER_URL
  if (typeof b !== 'string' || !b) b = '/.netlify/functions'
  b = b.trim().replace(/\/+$/,'')
  // strip accidental /subscribe suffix
  b = b.replace(/\/subscribe$/,'')
  return b
}
const API_BASE = cleanApiBase()

function b64UrlToUint8Array(b64url: string): Uint8Array {
  if (typeof b64url !== 'string' || !/^[A-Za-z0-9\-_]{20,}$/.test(b64url)) {
    throw new Error('VAPID public key missing or invalid')
  }
  const padding = '='.repeat((4 - (b64url.length % 4)) % 4)
  const base64 = (b64url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

async function getVapidPublic(): Promise<string> {
  const env = (import.meta as any)?.env?.VITE_VAPID_PUBLIC_KEY
  if (typeof env === 'string' && env.length > 20) return env.trim()
  // fallback to server
  try {
    const r = await fetch(`${API_BASE}/vapid`)
    if (r.ok) {
      const j = await r.json().catch(() => ({} as any))
      if (j?.publicKey && typeof j.publicKey === 'string') return j.publicKey.trim()
    }
  } catch {}
  // second fallback (compat)
  try {
    const r = await fetch(`${API_BASE}/subscribe?vapid=1`)
    if (r.ok) {
      const j = await r.json().catch(() => ({} as any))
      if (j?.publicKey && typeof j.publicKey === 'string') return j.publicKey.trim()
    }
  } catch {}
  throw new Error('Could not obtain VAPID public key')
}

async function swReady(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) throw new Error('Service worker unsupported')
  return await navigator.serviceWorker.ready
}
export async function getSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await swReady()
    return await reg.pushManager.getSubscription()
  } catch { return null }
}

export async function subscribe(): Promise<boolean> {
  try {
    const reg = await swReady()
    const current = await reg.pushManager.getSubscription()
    if (current) return true
    const vapid = await getVapidPublic()
    const keyBytes = b64UrlToUint8Array(vapid)
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // pass ArrayBuffer for max WebKit compatibility
      applicationServerKey: keyBytes.buffer
    })
    // post to server (no meta here)
    await fetch(`${API_BASE}/subscribe`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() })
    }).catch(()=>{})
    try {
      const id = btoa(sub.endpoint) // simple local id
      localStorage.setItem('pushSubId', id)
    } catch {}
    return true
  } catch (e:any) {
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
    const reg = await swReady()
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return false
    const payload = { subscription: sub.toJSON() as PushSubscriptionJSON, meta }
    const res = await fetch(`${API_BASE}/subscribe`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return res.ok
  } catch (e) {
    console.error('updateMetaIfSubscribed failed', e)
    return false
  }
}

// compatibility name used by older UI
export async function registerWithMetadata(meta: AqMeta): Promise<boolean> {
  const ok = await subscribe()
  if (!ok) return false
  return await updateMetaIfSubscribed(meta)
}

async function ensureSubscription(): Promise<PushSubscription | null> {
  let sub = await getSubscription()
  if (sub) return sub
  const ok = await subscribe()
  if (!ok) return null
  sub = await getSubscription()
  return sub
}

export async function sendTest(title?: string, body?: string, url?: string): Promise<boolean> {
  try {
    const sub = await ensureSubscription()
    if (!sub) {
      console.warn('sendTest: no subscription')
      return false
    }
    const payload = {
      title: title || 'Test',
      body: body || 'Dette er en testmelding',
      url: url || '/'
    }
    const res = await fetch(`${API_BASE}/send-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), ...payload })
    })
    if (!res.ok) {
      const txt = await res.text().catch(()=>String(res.status))
      console.warn('sendTest: server returned', res.status, txt)
    }
    return res.ok
  } catch (e:any) {
    console.error('sendTest failed:', e?.message || e)
    return false
  }
}


export async function getEndpointInfo() {
  try {
    const reg = await swReady();
    const sub = await reg.pushManager.getSubscription();
    const endpoint = sub?.endpoint || null;
    return {
      permission: Notification?.permission || 'default',
      hasSubscription: !!sub,
      endpoint,
      endpointIsApple: endpoint ? endpoint.startsWith('https://web.push.apple.com') : false,
      ua: (typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a')
    };
  } catch (e) {
    return {
      permission: Notification?.permission || 'default',
      hasSubscription: false,
      endpoint: null,
      endpointIsApple: false,
      ua: (typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'),
      error: String(e?.message || e)
    };
  }
}
