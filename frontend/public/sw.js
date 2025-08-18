self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}

  // Bruk apple-touch-icon som standard
  const title = data.title || 'Bønnetid';
  const body  = data.body  || 'Det er tid for bønn.';
  const url   = data.url   || '/';
  const icon  = data.icon  || '/icons/apple-touch-icon.png';
  const badge = data.badge || '/icons/apple-touch-icon.png';

  event.waitUntil(
    self.registration.showNotification(title, { body, icon, badge, data: { url } })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ includeUncontrolled: true, type: 'window' });
    const existing = allClients.find(c => c.url.includes(self.location.origin));
    if (existing) { existing.focus(); existing.navigate(url); }
    else { clients.openWindow(url); }
  })());
});
