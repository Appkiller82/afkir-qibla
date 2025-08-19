// Service Worker for Web Push
// Filename: /service-worker.js  (must be served from the site root)

self.addEventListener('install', () => {
  // Activate the new SW immediately
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of all pages
  event.waitUntil(self.clients.claim());
});

// Handle incoming push messages
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    // Fallback if payload isn't JSON
    payload = { title: 'Varsel', body: event.data?.text?.() || '' };
  }

  const title = payload.title || 'Varsel';
  const body = payload.body || '';
  const url  = payload.url  || '/';
  const tag  = payload.tag  || 'default-tag';

  const options = {
    body,
    // Update these icons if you have your own in /public
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url },
    tag,
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Open the target URL when the notification is clicked
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    // If a window with the URL is already open, focus it
    for (const client of allClients) {
      try {
        const clientUrl = new URL(client.url);
        if (clientUrl.pathname === targetUrl || clientUrl.href === targetUrl) {
          return client.focus();
        }
      } catch (_) {}
    }
    // Otherwise open a new window
    return clients.openWindow(targetUrl);
  })());
});

// Optional: track dismissals
self.addEventListener('notificationclose', (event) => {
  // You could postMessage or send a beacon here if you want analytics
});
