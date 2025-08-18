// push.js
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  if (!base64String) throw new Error('Mangler VAPID public key (VITE_VAPID_PUBLIC_KEY)');
  const pad = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function ensurePermission() {
  if (!('Notification' in window)) throw new Error('Nettleseren støtter ikke Notifications');
  if (Notification.permission === 'granted') return true;
  const res = await Notification.requestPermission();
  if (res !== 'granted') throw new Error('Tillatelse til varsler ble ikke gitt');
  return true;
}

export async function subscribeToPush(extra = {}) {
  // Tillatelse først
  await ensurePermission();

  // Service worker må være klar
  const reg = await navigator.serviceWorker.ready;
  if (!VAPID_PUBLIC_KEY) {
    throw new Error('Mangler VAPID public key (sett VITE_VAPID_PUBLIC_KEY i miljøvariabler)');
  }

  // Fjern ev. gammel sub (for å unngå “already subscribed” edge cases)
  try {
    const existing = await reg.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();
  } catch {}

  // Opprett abonnement
  let sub;
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  } catch (e) {
    // Gi mer menneskelig feilmelding
    if (e?.name === 'NotAllowedError') throw new Error('Varsler er blokkert i nettleseren for dette domenet');
    if (e?.name === 'InvalidStateError') throw new Error('Service worker er ikke klar/aktiv ennå');
    throw new Error('Subscribe feilet: ' + (e?.message || e));
  }

  // Registrer hos backend og lagre id lokalt
  const r = await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub, ...extra }),
  });
  if (!r.ok) {
    // Rull tilbake
    try { await sub.unsubscribe(); } catch {}
    throw new Error('Backend avviste abonnement (POST /api/subscribe)');
  }
  const { id } = await r.json();
  if (!id) throw new Error('Backend returnerte ikke id');
  localStorage.setItem('pushSubId', id);
  return id;
}

export async function unsubscribeFromPush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  const id = localStorage.getItem('pushSubId');

  if (id) {
    try {
      await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch {}
  }
  if (sub) await sub.unsubscribe();
  localStorage.removeItem('pushSubId');
}

export async function sendTestPush() {
  const id = localStorage.getItem('pushSubId');
  if (!id) throw new Error('Ingen lagret sub id');
  const r = await fetch('/api/send-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!r.ok) throw new Error('Send test feilet (POST /api/send-test)');
}
