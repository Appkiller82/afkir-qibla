// frontend/src/push.ts
// Robust Web Push client with: VAPID fallback, safe key conversion, and
// guaranteed local 'pushSubId' persistence (computed from endpoint).
// Also exports legacy names: registerWithMetadata(), sendTest().

export type PushKeys = { p256dh: string; auth: string }
export type PushSubscriptionJSON = { endpoint: string; keys: PushKeys }
export type AqMeta = {
  lat?: number; lng?: number; city?: string; countryCode?: string; tz?: string;
  mode?: 'auto' | 'manual'; savedAt?: number;
}

const LS_ID_KEY = 'pushSubId'

// ---- Helpers ----
function getApiBase(): string {
  let raw = (import.meta as any)?.env?.VITE_PUSH_SERVER_URL
  if (!raw) raw = '/.netlify/functions'
  raw = String(raw).trim().replace(/\/+$/,'').replace(/\/subscribe$/,'')
  return raw
}
const API_BASE = getApiBase()

function base64UrlEncode(str: string): string {
  const b = btoa(str)
  return b.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}

function urlBase64ToUint8Array(base64String: string) {
  if (typeof base64String !== 'string' || !/^[A-Za-z0-9\-_]{20,}$/.test(base64String)) {
    throw new Error('VAPID public key missing or invalid')
  }
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function getVapidPublic(): Promise<string> {
  const v = (import.meta as any)?.env?.VITE_VAPID_PUBLIC_KEY
  if (typeof v === 'string' && v.trim()) return v.trim()
  // fallback: ask server
  try {
    const res = await fetch('/.netlify/functions/subscribe?vapid=1')
    if (res.ok) {
      const j = await res.json().catch(()=>({} as any))
      if (j && typeof j.publicKey === 'string') return j.publicKey
    }
  } catch {}
  throw new Error('VAPID public key not available')
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) throw new Error('Service worker unsupported');
  return await navigator.serviceWorker.ready;
}

export async function getSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await getRegistration();
    return await reg.pushManager.getSubscription();
  } catch { return null }
}

// ---- API ----
export async function subscribe(): Promise<boolean> {
  try {
    const vapid = await getVapidPublic();
    const reg = await getRegistration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const keyBytes = urlBase64ToUint8Array(vapid);
      // Use ArrayBuffer path for Safari/WebKit compatibility
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: (keyBytes as Uint8Array).buffer
      });
    }

    // Ensure we persist a *string* pushSubId locally (derived from endpoint)
    const j = sub.toJSON() as PushSubscriptionJSON
    const localId = base64UrlEncode(j.endpoint)
    try { localStorage.setItem(LS_ID_KEY, localId) } catch {}

    // Send to server; read id if server provides (overwrite local if present)
    const res = await fetch(`${API_BASE}/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: j })
    }).catch(()=>null as any);
    if (res && res.ok) {
      const data = await res.json().catch(()=>({} as any))
      if (data && typeof data.id === 'string') {
        try { localStorage.setItem(LS_ID_KEY, data.id) } catch {}
      }
    }
    return true;
  } catch (e:any) {
    console.error('subscribe failed:', e?.message || e)
    return false;
  }
}

export async function unsubscribe(): Promise<boolean> {
  try {
    const sub = await getSubscription();
    if (!sub) return true;
    await sub.unsubscribe();
    try { localStorage.removeItem(LS_ID_KEY) } catch {}
    return true;
  } catch { return false }
}

export async function updateMetaIfSubscribed(meta: AqMeta): Promise<boolean> {
  try {
    const reg = await getRegistration();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return false;
    const payload = { subscription: sub.toJSON() as PushSubscriptionJSON, meta }
    const res = await fetch(`${API_BASE}/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (e) {
    console.error('updateMetaIfSubscribed failed', e);
    return false;
  }
}

// ---- Compat exports ----
export async function registerWithMetadata(meta: AqMeta): Promise<boolean> {
  const ok = await subscribe();
  if (!ok) return false;
  return await updateMetaIfSubscribed(meta);
}

export async function sendTest(title?: string, body?: string, url?: string): Promise<boolean> {
  try {
    // ensure sub exists
    let sub = await getSubscription();
    if (!sub) {
      const ok = await subscribe();
      if (!ok) return false;
      sub = await getSubscription();
      if (!sub) return false;
    }
    const payload = { title: title || 'Test', body: body || 'Dette er en test', url: url || '/' }
    const res = await fetch(`${API_BASE}/send-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (e) {
    console.error('sendTest failed', e);
    return false;
  }
}
