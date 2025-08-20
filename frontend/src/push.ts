export async function enablePush() {
  const reg = await navigator.serviceWorker.ready;
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY!;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });

  // ✅ Bruk subscribe (ikke save-sub) og send { sub: ... }
  await fetch('/.netlify/functions/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sub: sub.toJSON ? sub.toJSON() : sub }),
  });

  localStorage.setItem('pushSub', JSON.stringify(sub.toJSON ? sub.toJSON() : sub));
}

export async function sendTest() {
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    (existing && (existing.toJSON ? existing.toJSON() : (existing as any))) ||
    JSON.parse(localStorage.getItem('pushSub') || 'null');

  if (!sub?.endpoint) throw new Error('Mangler subscription — trykk "Aktiver push" først.');

  // ✅ send med subscription i body
  const res = await fetch('/.netlify/functions/send-test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sub }),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`send-test: ${res.status} ${txt}`);
  return txt;
}
