// frontend/src/push.ts
// Robust Web Push helpers.
// - Fetches VAPID public key from server if not provided correctly in VITE_VAPID_PUBLIC_KEY
// - Cleans API base to avoid '/subscribe/send-test' mistakes
// - Provides compat exports: registerWithMetadata(), sendTest()

export type PushKeys = { p256dh: string; auth: string }
export type PushSubscriptionJSON = { endpoint: string; keys: PushKeys }
export type AqMeta = {
  lat: number; lng: number; city?: string; countryCode?: string; tz?: string;
  mode?: 'auto' | 'manual'; savedAt?: number;
}

// ----------- Helpers
function isValidBase64Url(s: any): s is string {
  return typeof s === 'string' && /^[A-Za-z0-9\-_]{20,}$/.test(s.trim())
}

function getApiBase(): string {
  let raw = (import.meta as any)?.env?.VITE_PUSH_SERVER_URL
  if (typeof raw !== 'string' || !raw) raw = '/.netlify/functions'
  raw = raw.trim()
  raw = raw.replace(/\/+$/,'')             // strip trailing slash(es)
  raw = raw.replace(/\/subscribe$/,'')     // never end at /subscribe
  return raw || '/.netlify/functions'
}
const API_BASE = getApiBase()

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function fetchVapidKeyFromServer(): Promise<string> {
  const res = await fetch(`${API_BASE}/subscribe?vapid=1`, { method: 'GET' })
  if (!res.ok) throw new Error(`server VAPID ${res.status}`)
  const j = await res.json().catch(() => ({} as any))
  if (!isValidBase64Url(j?.publicKey)) throw new Error('server VAPID invalid')
  return j.publicKey.trim()
}
async function getVapidPublic(): Promise<string> {
  const local = (import.meta as any)?.env?.VITE_VAPID_PUBLIC_KEY
  if (isValidBase64Url(local)) return String(local).trim()
  try {
    const k = await fetchVapidKeyFromServer()
    return k
  } catch (e) {
    console.error('Could not obtain VAPID public key from env nor server.', e)
    throw new Error('VAPID public key missing or invalid')
  }
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

// ----------- Main API
export async function subscribe(): Promise<boolean> {
  try {
    const vapid = await getVapidPublic()
    const reg = await getRegistration();
    const current = await reg.pushManager.getSubscription();
    if (current) return true;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid)
    });

    await fetch(`${API_BASE}/subscribe`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() })
    }).catch(()=>{});
    return true;
  } catch (e: any) {
    console.error('subscribe failed:', e?.message || e);
    return false;
  }
}

export async function unsubscribe(): Promise<boolean> {
  try {
    const sub = await getSubscription();
    if (!sub) return true;
    await sub.unsubscribe();
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
    if (!res.ok) console.warn('updateMetaIfSubscribed: server returned', res.status)
    return res.ok;
  } catch (e) {
    console.error('updateMetaIfSubscribed failed', e);
    return false;
  }
}

// ----------- Compat
export async function registerWithMetadata(meta: AqMeta): Promise<boolean> {
  const ok = await subscribe();
  if (!ok) return false;
  return await updateMetaIfSubscribed(meta);
}
export async function sendTest(title?: string, body?: string, url?: string): Promise<boolean> {
  try {
    // ensure we are subscribed (so server can derive endpoint if necessary)
    const ok = await subscribe()
    if (!ok) console.warn('sendTest: subscribe returned false (continuing anyway)')
    const reg = await getRegistration();
    const sub = await reg.pushManager.getSubscription();
    const payload: any = { title: title || 'Test', body: body || 'Dette er en test', url: url || '/' }
    if (sub) payload.subscription = sub.toJSON()
    const res = await fetch(`${API_BASE}/send-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.warn('sendTest: server returned', res.status)
    return res.ok;
  } catch (e) {
    console.error('sendTest failed', e);
    return false;
  }
}
