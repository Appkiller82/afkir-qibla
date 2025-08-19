// frontend/src/push.js
export async function enablePush() {
  const reg = await navigator.serviceWorker.ready;
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });

  const res = await fetch(import.meta.env.VITE_PUSH_SERVER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sub),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`subscribe failed: ${res.status} ${data?.message || ''}`);
  if (!data?.id) throw new Error('backend missing id');

  localStorage.setItem('pushSubId', data.id);
  return data.id;
}

export async function sendTest() {
  const id = localStorage.getItem('pushSubId') || null;
  const res = await fetch('/.netlify/functions/send-test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(id ? { id } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`send-test: ${res.status} ${text || ''}`);
  return text;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const outputArray = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) outputArray[i] = raw.charCodeAt(i);
  return outputArray;
}
