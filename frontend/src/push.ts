// frontend/src/push.ts
// Web Push helpers with strong guards + clean URL joining.
// Includes compat exports: registerWithMetadata(), sendTest().

export type PushKeys = { p256dh: string; auth: string }
export type PushSubscriptionJSON = { endpoint: string; keys: PushKeys }
export type AqMeta = {
  lat: number; lng: number; city?: string; countryCode?: string; tz?: string;
  mode?: 'auto' | 'manual'; savedAt?: number;
}

// ---- Env & URL helpers ----
function getVapidPublic(): string {
  const raw = (import.meta as any)?.env?.VITE_VAPID_PUBLIC_KEY
  if (typeof raw !== 'string') return ''
  return raw.trim()
}
function getApiBase(): string {
  let raw = (import.meta as any)?.env?.VITE_PUSH_SERVER_URL
  if (typeof raw !== 'string' || !raw) raw = '/.netlify/functions'
  raw = raw.trim()
  // normalize base: strip trailing slashes and accidental '/subscribe'
  raw = raw.replace(/\/+$/,'').replace(/\/subscribe$/,'')
  return raw || '/.netlify/functions'
}
const API_BASE = getApiBase()

function urlBase64ToUint8Array(base64String: string) {
  if (typeof base64String !== 'string' || !/^[A-Za-z0-9\-_]{20,}$/.test(base64String)) {
    throw new Error('VITE_VAPID_PUBLIC_KEY missing or invalid')
  }
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
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

// ---- Main API ----
export async function subscribe(): Promise<boolean> {
  try {
    const vapid = getVapidPublic();
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

// ---- Compatibility layer ----
export async function registerWithMetadata(meta: AqMeta): Promise<boolean> {
  const ok = await subscribe();
  if (!ok) return false;
  return await updateMetaIfSubscribed(meta);
}

export async function sendTest(title?: string, body?: string, url?: string): Promise<boolean> {
  try {
    // ensure we include a valid subscription in the request
    const reg = await getRegistration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const ok = await subscribe();
      if (!ok) return false;
      sub = await reg.pushManager.getSubscription();
    }
    if (!sub) return false;

    const payload = { title: title || 'Test', body: body || 'Dette er en test', url: url || '/', subscription: sub.toJSON() }
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
