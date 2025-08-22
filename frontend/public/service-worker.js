// public/service-worker.js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}
  const title = data.title || 'Afkir Qibla';

  // Based on your working version — no icon/badge references to avoid 404s.
  const options = {
    body: data.body || 'Ny melding',
    data: { url: data.url || '/' },
    // Harmless, iOS-friendly hints (do not trigger any asset fetches):
    tag: data.tag || 'afkir-qibla',
    renotify: false,
    requireInteraction: false,
    timestamp: Date.now()
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
