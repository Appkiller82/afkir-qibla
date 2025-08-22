/* public/service-worker.js — bruker apple-touch-icon */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}

  const title = data.title || 'Afkir Qibla';
  const options = {
    body: data.body || 'Ny melding',
    data: { url: data.url || '/' },
    silent: false,
    renotify: true,
    tag: data.tag || ('prayer-' + Date.now()),
    requireInteraction: true,
    timestamp: Date.now(),

    // Bruk apple-touch-icon her
    badge: '/icons/badge-72.png',
    icon: '/icons/apple-touch-icon.png'
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
