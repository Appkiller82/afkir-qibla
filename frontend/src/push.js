const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const pad = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i=0; i<raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function ensurePermission() {
  if (!('Notification' in window)) throw new Error('Nettleseren støtter ikke Notifications');
  if (Notification.permission === 'granted') return true;
  const res = await Notification.requestPermission();
  return res === 'granted';
}

export async function subscribeToPush(extra = {}) {
  if (!await ensurePermission()) throw new Error('Tillatelse ble ikke gitt');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  });
  const r = await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub, ...extra })
  });
  if (!r.ok) throw new Error('Subscribe feilet');
  const { id } = await r.json();
  localStorage.setItem('pushSubId', id);
  return id;
}

export async function unsubscribeFromPush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  const id = localStorage.getItem('pushSubId');
  if (id) {
    await fetch('/api/unsubscribe', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id })
    });
  }
  if (sub) await sub.unsubscribe();
  localStorage.removeItem('pushSubId');
}

export async function sendTestPush() {
  const id = localStorage.getItem('pushSubId');
  if (!id) throw new Error('Ingen lagret sub id');
  await fetch('/api/send-test', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ id })
  });
}
