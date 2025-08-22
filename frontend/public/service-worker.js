/* public/service-worker.js — sound-friendly */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}

  const title = data.title || 'Afkir Qibla';
  const options = {
    body: data.body || 'Ny melding',
    data: { url: data.url || '/' },
    // Viktig for lyd/synlighet: ikke "silent"
    silent: false,
    // La avsender styre tag/renotify hvis sendt i payload, ellers unik tag for å tvinge nytt varsel
    tag: data.tag || ('prayer-' + Date.now()),
    renotify: data.renotify !== undefined ? !!data.renotify : true,
    badge: data.badge || '/icons/badge-72.png',
    icon: data.icon || '/icons/icon-192.png',
    // Disse feltene hjelper enkelte plattformer (Chrome/Windows) å gi lyd og holde varselet synlig
    requireInteraction: data.requireInteraction !== undefined ? !!data.requireInteraction : true,
    timestamp: data.timestamp || Date.now(),
    vibrate: data.vibrate || [100, 50, 100] // ignoreres på desktop/iOS, ok på Android
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

// Auto re-subscribe (iOS bytter endpoint av og til)
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
  } catch {}
});

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}
