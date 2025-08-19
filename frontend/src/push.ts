function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export async function ensurePushSubscription(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('Nettleseren støtter ikke Web Push.');
    return false;
  }

  // Register service worker with correct name
  const reg = await navigator.serviceWorker.register('/service-worker.js');

  // Ask for permission
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;

  // Get or create subscription
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  // Save subscription in backend
  await fetch('/.netlify/functions/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub }),
  });

  return true;
}

export async function unsubscribePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await fetch('/.netlify/functions/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe();
  }
}
