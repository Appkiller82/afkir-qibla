/* public/service-worker.js */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

// Show notification on push with robust defaults for iOS
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}
  const title = data.title || 'Afkir Qibla';
  const options = {
    body: data.body || 'Ny melding',
    data: { url: data.url || '/' },
    tag: data.tag || 'prayer',
    renotify: true,
    badge: '/icons/badge-72.png',
    icon: '/icons/icon-192.png'
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) { client.navigate?.(url); return client.focus(); }
      }
      return self.clients.openWindow ? self.clients.openWindow(url) : null;
    })
  );
});

// Auto re-subscribe if the subscription changes (iOS rotates endpoints occasionally)
self.addEventListener('pushsubscriptionchange', async () => {
  try {
    const res = await fetch('/vapid-public.txt');
    const vapid = res.ok ? (await res.text()).trim() : null;
    const reg = await self.registration;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapid ? urlBase64ToUint8Array(vapid) : undefined,
    });
    await fetch('/.netlify/functions/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: sub, mode: 'auto', savedAt: Date.now() })
    });
  } catch { /* silent */ }
});

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}
