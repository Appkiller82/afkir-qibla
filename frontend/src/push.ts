// frontend/src/push.ts
// Web Push klienthjelpere: subscribe/unsubscribe + oppdater meta til server
export type PushKeys = { p256dh: string; auth: string }
export type PushSubscriptionJSON = { endpoint: string; keys: PushKeys }

export type AqMeta = {
  lat: number; lng: number; city?: string; countryCode?: string; tz?: string;
  mode?: 'auto' | 'manual'; savedAt?: number;
}

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string
const API_BASE = (import.meta.env.VITE_PUSH_SERVER_URL as string) || '/.netlify/functions'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) throw new Error('Service worker unsupported');
  const reg = await navigator.serviceWorker.ready;
  return reg;
}
export async function getSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await getRegistration();
    return await reg.pushManager.getSubscription();
  } catch { return null }
}

export async function subscribe(): Promise<boolean> {
  try {
    const reg = await getRegistration();
    // allerede subbed?
    const current = await reg.pushManager.getSubscription();
    if (current) return true;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC)
    });
    // send til server (uten meta her – meta kommer via updateMetaIfSubscribed)
    await fetch(`${API_BASE}/subscribe`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() })
    }).catch(()=>{});
    return true;
  } catch (e) {
    console.error('subscribe failed', e);
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
    return res.ok;
  } catch (e) {
    console.error('updateMetaIfSubscribed failed', e);
    return false;
  }
}
