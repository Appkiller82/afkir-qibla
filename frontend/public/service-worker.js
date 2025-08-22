// public/service-worker.js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}
  const title = data.title || 'Afkir Qibla';

  // Use apple-touch-icon for both icon and badge
  const options = {
    body: data.body || 'Ny melding',
    data: { url: data.url || '/' },
    icon: data.icon || '/icons/apple-touch-icon',
    badge: data.badge || '/icons/apple-touch-icon',
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
