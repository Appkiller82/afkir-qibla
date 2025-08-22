// frontend/src/push.ts — COMPLETE
// Works with: PushControls.jsx (enablePush, sendTest), PushControlsAuto.jsx (registerWithMetadata, sendTest),
// and App.jsx (updateMetaIfSubscribed).
// Single-source VAPID: reads from VITE_VAPID_PUBLIC_KEY or /vapid-public.txt (must match backend).

type PushMeta = {
  lat?: number;
  lng?: number;
  city?: string;
  countryCode?: string;
  tz?: string;
  mode?: 'auto' | 'manual';
  savedAt?: number;
};

const SERVER_BASE =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_PUSH_SERVER_URL) ||
  '';

/** Try env first, else /vapid-public.txt */
async function getVapidPublicKey(): Promise<string> {
  const fromEnv = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_VAPID_PUBLIC_KEY) || '';
  if (fromEnv && fromEnv.length > 0) return fromEnv.trim();
  try {
    const res = await fetch('/vapid-public.txt', { cache: 'no-store' });
    if (res.ok) return (await res.text()).trim();
  } catch {}
  throw new Error('Mangler VAPID public key');
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = typeof atob !== 'undefined' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

async function ensureSW(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) throw new Error('Service worker ikke støttet');
  return navigator.serviceWorker.ready;
}

async function ensurePermission(): Promise<void> {
  if (!('Notification' in window)) throw new Error('Notification ikke støttet');
  if (Notification.permission === 'default') {
    const res = await Notification.requestPermission();
    if (res !== 'granted') throw new Error('Varsler ble ikke tillatt');
  } else if (Notification.permission !== 'granted') {
    throw new Error('Varsler er blokkert i nettleseren');
  }
}

/** Subscribe and return PushSubscription */
async function createSubscription(): Promise<PushSubscription> {
  const reg = await ensureSW();
  const vapid = await getVapidPublicKey();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid),
  });
  return sub;
}

/** Low-level save call to backend */
async function saveToServer(payload: any): Promise<{ id?: string }> {
  const url = (SERVER_BASE || '') + '/.netlify/functions/subscribe';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || 'Server-feil ved subscribe');
  return json;
}

/** Exported: simple enable used by PushControls.jsx */
export async function enablePush(): Promise<string> {
  await ensurePermission();
  const sub = await createSubscription();
  const { id } = await saveToServer({ subscription: sub, mode: 'manual', savedAt: Date.now() });
  if (id) try { localStorage.setItem('pushSubId', id); } catch {}
  return id || '';
}

/** Exported: auto register with metadata used by PushControlsAuto.jsx */
export async function registerWithMetadata(meta: PushMeta): Promise<boolean> {
  await ensurePermission();
  const sub = await createSubscription();
  const resp = await saveToServer({ subscription: sub, ...meta });
  if (resp?.id) try { localStorage.setItem('pushSubId', resp.id); } catch {}
  return true;
}

/** Exported: update meta when already subscribed (used in App.jsx) */
export async function updateMetaIfSubscribed(meta: PushMeta): Promise<void> {
  try {
    const reg = await ensureSW();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await saveToServer({ subscription: sub, ...meta, upsert: true });
  } catch { /* silent */ }
}

/** Exported: send a test push by posting current subscription to the backend */
export async function sendTest(): Promise<boolean> {
  const reg = await ensureSW();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) throw new Error('Mangler subscription – aktiver push først');
  const url = (SERVER_BASE || '') + '/.netlify/functions/send-test';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      subscription: sub,
      pushSubId: (typeof localStorage !== 'undefined' && localStorage.getItem('pushSubId')) || null,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || 'send-test feilet');
  return true;
}
