// frontend/src/push.ts

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function assert(cond: any, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getSWRegistration(): Promise<ServiceWorkerRegistration> {
  assert('serviceWorker' in navigator, 'Service worker støttes ikke i denne nettleseren.');
  // Viktig: main.jsx må registrere /service-worker.js
  const reg = await navigator.serviceWorker.ready;
  console.log('[push] SW ready:', reg);
  return reg;
}

async function ensurePermission(): Promise<void> {
  assert('Notification' in window, 'Varsler støttes ikke i denne nettleseren.');
  const current = Notification.permission;
  if (current === 'granted') return;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Du må tillate varsler for å aktivere push.');
}

async function getOrCreateSubscription(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    console.log('[push] Reusing existing subscription');
    return sub;
  }
  assert(VAPID_PUBLIC_KEY, 'Mangler VITE_VAPID_PUBLIC_KEY (sjekk Netlify Environment variables).');

  // Enkel sanity-check på formen (URL-safe base64)
  if (!/^[A-Za-z0-9\-_]+$/.test(VAPID_PUBLIC_KEY)) {
    console.warn('[push] VAPID key ser rar ut – må være URL-safe base64');
  }

  sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  console.log('[push] Created new subscription');
  return sub;
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const res = await fetch('/.netlify/functions/save-sub', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sub),
  });
  const text = await res.text();
  console.log('[push] save-sub →', res.status, text);
  if (!res.ok) throw new Error(`save-sub feilet (${res.status}): ${text || 'ukjent feil'}`);
}

/** Aktiver push-varsler og returner endpoint (lagres også i localStorage). */
export async function enablePush(): Promise<string> {
  try {
    await ensurePermission();
    const reg = await getSWRegistration();
    const sub = await getOrCreateSubscription(reg);
    await saveSubscription(sub);

    const id = sub.endpoint || '';
    try { localStorage.setItem('pushSubId', id); } catch {}
    console.log('[push] Enabled. endpoint:', id);
    return id;
  } catch (err: any) {
    console.error('[enablePush] error:', err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/** Kjør server-side testutsendelse. */
export async function sendTest(): Promise<string> {
  try {
    const res = await fetch('/.netlify/functions/send-test', { method: 'POST' });
    const txt = await res.text();
    console.log('[push] send-test →', res.status, txt);
    if (!res.ok) throw new Error(`send-test feilet (${res.status}): ${txt || 'ukjent feil'}`);
    return txt;
  } catch (err: any) {
    console.error('[sendTest] error:', err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/** Valgfritt: fjern lokalt ID. */
export function clearLocalPushId(): void {
  try { localStorage.removeItem('pushSubId'); } catch {}
}

/** Valgfritt: unsubscribe i nettleseren. */
export async function unsubscribePush(): Promise<boolean> {
  try {
    const reg = await getSWRegistration();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return true;
    const ok = await sub.unsubscribe();
    try { localStorage.removeItem('pushSubId'); } catch {}
    console.log('[push] Unsubscribed');
    return ok;
  } catch (err) {
    console.error('[unsubscribePush] error:', err);
    return false;
  }
}
