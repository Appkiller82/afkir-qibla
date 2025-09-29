// frontend/src/push.ts
// Minimal, BOM-free push helper for Netlify + Web Push
// Works with either VITE_PUSH_SERVER_URL (preferred) or defaults to Netlify Functions path.

const BASE =
  (import.meta as any).env?.VITE_PUSH_SERVER_URL?.replace(/\/+$/, '') ||
  '/.netlify/functions/push';

const VAPID_PUBLIC_KEY = (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY;

/** Convert VAPID public key from URL-safe base64 string to Uint8Array */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function ensurePermission(): Promise<void> {
  if (!('Notification' in window)) throw new Error('Varsler ikke støttet i denne nettleseren');
  if (Notification.permission === 'default') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Varseltillatelse ikke gitt');
  } else if (Notification.permission !== 'granted') {
    throw new Error('Varseltillatelse ikke gitt');
  }
}

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) throw new Error('Service Worker ikke støttet');
  return (await navigator.serviceWorker.getRegistration()) ||
         (await navigator.serviceWorker.register('/service-worker.js'));
}

async function createBrowserSubscription(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  if (!('pushManager' in reg)) throw new Error('Push API ikke tilgjengelig');
  if (!VAPID_PUBLIC_KEY) throw new Error('Mangler VITE_VAPID_PUBLIC_KEY');
  const appServerKey = urlBase64ToUint8Array(String(VAPID_PUBLIC_KEY));
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appServerKey });
}

type SubscribeArgs =
  | [ServiceWorkerRegistration, number, number, string]
  | [{ lat: number; lng: number; timezone: string }];

function isTuple(args: any[]): args is [ServiceWorkerRegistration, number, number, string] {
  return args.length === 4 && 'pushManager' in args[0];
}

/**
 * Subscribe for push on the server.
 * Supports two call signatures:
 *   subscribeForPush(reg, lat, lng, timezone)
 *   subscribeForPush({ lat, lng, timezone })
 */
export async function subscribeForPush(
  ...args: SubscribeArgs
): Promise<{ id?: string; endpoint?: string } & Record<string, any>> {
  let reg: ServiceWorkerRegistration | null = null;
  let lat: number, lng: number, timezone: string;

  if (isTuple(args)) {
    [reg, lat, lng, timezone] = args;
  } else {
    ({ lat, lng, timezone } = args[0]);
  }

  await ensurePermission();
  reg = reg || (await ensureServiceWorker());
  const subscription = await createBrowserSubscription(reg);

  const resp = await fetch(`${BASE}/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscription,
      lat,
      lng,
      timezone,
      // Optional: let server infer UA, etc.
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Server subscribe ${resp.status}: ${txt}`);
  }

  const data = await resp.json().catch(() => ({}));
  try {
    const id = data?.id || subscription?.endpoint || null;
    if (id) localStorage.setItem('pushSubId', String(id));
  } catch {}

  return { ...data, endpoint: subscription?.endpoint };
}

/**
 * Simple helper used by PushControls.jsx
 */
export async function enablePush(): Promise<string> {
  const reg = await ensureServiceWorker();
  await ensurePermission();

  // Location + timezone are useful to associate the sub with a user/region
  const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Geolokasjon ikke støttet'));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const result = await subscribeForPush(reg, lat, lng, timezone);
  const id = result?.id || result?.endpoint || '';
  if (!id) throw new Error('Manglende ID fra server');
  return id;
}

/**
 * Ask server to send a test notification to the stored subscription ID.
 */
export async function sendTest(): Promise<string> {
  const id = (typeof window !== 'undefined' && localStorage.getItem('pushSubId')) || '';
  const resp = await fetch(`${BASE}/send-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Server send-test ${resp.status}: ${txt}`);
  }
  const data = await resp.json().catch(() => ({}));
  return data?.message || 'OK';
}
