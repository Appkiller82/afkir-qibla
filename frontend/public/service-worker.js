
const CACHE = 'afkir-qibla-v8';
self.addEventListener('install', e => { e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', () => {});

self.addEventListener('push', event => {
  let data = { title: 'Bønnetid', body: 'Det er tid for bønn.', url: '/?play=adhan' };
  try { if (event.data) data = Object.assign(data, event.data.json()); } catch {}
  event.waitUntil(self.registration.showNotification(data.title || 'Bønnetid', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/?play=adhan' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/?play=adhan';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled:true }).then(windowClients => {
    for (const client of windowClients) {
      client.navigate(url);
      if ('focus' in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
