// frontend/src/push.ts
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export async function enablePush(): Promise<string> {
  if (!('serviceWorker' in navigator)) throw new Error('Service worker ikke støttet');
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapidKey) throw new Error('VITE_VAPID_PUBLIC_KEY mangler');

  const sub = existing ?? await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });

  // Minimal backend lagring (uten metadata) – gir stabil ID tilbake
  const res = await fetch('/.netlify/functions/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON ? sub.toJSON() : sub, meta: {} }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`subscribe failed: ${res.status} ${data?.message || ''}`);

  localStorage.setItem('pushSub', JSON.stringify(sub.toJSON ? sub.toJSON() : sub));
  if (data?.id) localStorage.setItem('pushSubId', data.id);
  return data?.id || 'ok';
}

export async function registerWithMetadata(meta: {
  lat: number; lng: number; city?: string; countryCode?: string; tz?: string;
}): Promise<string> {
  if (!('serviceWorker' in navigator)) throw new Error('Service worker ikke støttet');
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapidKey) throw new Error('VITE_VAPID_PUBLIC_KEY mangler');

  const sub = existing ?? await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });

  const payload = {
    subscription: sub.toJSON ? sub.toJSON() : sub,
    meta: {
      ...meta,
      tz: meta.tz || Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };
  const res = await fetch('/.netlify/functions/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`subscribe failed: ${res.status} ${data?.message || ''}`);

  localStorage.setItem('pushSub', JSON.stringify(sub.toJSON ? sub.toJSON() : sub));
  if (data?.id) localStorage.setItem('pushSubId', data.id);
  return data?.id || 'ok';
}

export async function sendTest(): Promise<string> {
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ? existing.toJSON() : JSON.parse(localStorage.getItem('pushSub') || 'null');
  if (!sub?.endpoint) throw new Error('Ingen gyldig subscription. Prøv "Aktiver push" først.');

  const res = await fetch('/.netlify/functions/send-test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sub }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`send-test: ${res.status} ${text || ''}`);
  return text;
}
