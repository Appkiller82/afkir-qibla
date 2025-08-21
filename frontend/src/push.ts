// frontend/src/push.ts
// Web Push klienthjelpere: subscribe/unsubscribe + oppdater meta til server
// Nå med *kompatibilitetseksporter* for eldre kode: registerWithMetadata, sendTest
export type PushKeys = { p256dh: string; auth: string }
export type PushSubscriptionJSON = { endpoint: string; keys: PushKeys }

export type AqMeta = {
  lat: number; lng: number; city?: string; countryCode?: string; tz?: string;
  mode?: 'auto' | 'manual'; savedAt?: number;
}

const VAPID_PUBLIC = (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY as string | undefined
const API_BASE = ((import.meta as any).env?.VITE_PUSH_SERVER_URL as string | undefined) || '/.netlify/functions'

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
    if (!VAPID_PUBLIC) {
      console.warn('VITE_VAPID_PUBLIC_KEY mangler');
      return false;
    }
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

// ---- Kompatibilitet for eldre komponenter ----

// Eldre komponenter forventer registerWithMetadata(meta)
// Vi implementerer denne som: subscribe() -> updateMetaIfSubscribed(meta)
export async function registerWithMetadata(meta: AqMeta): Promise<boolean> {
  const ok = await subscribe();
  if (!ok) {
    console.error('registerWithMetadata: subscribe failed');
    return false;
  }
  const up = await updateMetaIfSubscribed(meta);
  if (!up) {
    console.warn('registerWithMetadata: updateMetaIfSubscribed returned false');
  }
  return true;
}

// Eldre UI kaller sendTest() fra klienten – videresender til server-funksjonen
export async function sendTest(title?: string, body?: string, url?: string): Promise<boolean> {
  try {
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
