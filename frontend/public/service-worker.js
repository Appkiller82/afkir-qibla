self.addEventListener("install", (event) => { self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || "Bønnetid";
  const body = data.body || "Det er tid for bønn.";
  const icon = data.icon || "/icons/icon-192.png";
  const badge = data.badge || "/icons/badge-72.png";
  const tag = data.tag || "bonnetid";
  const options = { body, icon, badge, tag, renotify: true };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
    const url = "/";
    for (const client of allClients) { if ("focus" in client) return client.focus(); }
    if (self.clients && "openWindow" in self.clients) return self.clients.openWindow(url);
  })());
});
