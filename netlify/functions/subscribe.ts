// frontend/src/push.ts

/**
 * Aktiver web push i nettleseren og registrer subscription hos backend.
 * Lagrer hele subscription lokalt (localStorage: "pushSub") og en bekreftelses-id ("pushSubId").
 */
export async function enablePush(): Promise<string> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push Notifications ikke støttet i denne nettleseren');
  }

  // Vent på at SW er klar (forutsetter at /service-worker.js er registrert et annet sted i appen)
  const reg = await navigator.serviceWorker.ready;

  // Sørg for at vi har en VAPID public key
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapidKey) throw new Error('VITE_VAPID_PUBLIC_KEY mangler');

  // Be om subscription (bruk eksisterende om den finnes)
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  }));

  // Registrer hos backend (stateless – backend lagrer ikke, men returnerer en stabil id)
  const res = await fetch('/.netlify/functions/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sub),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`subscribe failed: ${res.status} ${data?.message || ''}`);

  // Lagre lokalt (nyttig for fallback/feilsøking)
  localStorage.setItem('pushSub', JSON.stringify(sub.toJSON ? sub.toJSON() : sub));
  if (data?.id) localStorage.setItem('pushSubId', data.id);

  return data?.id || 'ok';
}

/**
 * Sender en test‑push. Sender hele subscription i request‑body (stateless backend).
 */
export async function sendTest(): Promise<string> {
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ? existing.toJSON() : JSON.parse(localStorage.getItem('pushSub') || 'null');

  if (!sub?.endpoint) {
    throw new Error('Ingen gyldig subscription. Prøv "Aktiver push" først.');
  }

  const res = await fetch('/.netlify/functions/send-test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sub }), // 👈 viktig: sender hele subscription
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`send-test: ${res.status} ${text || ''}`);
  return text;
}

/**
 * Valgfritt: Skru av lokalt (fjerner lagret id/sub og forsøker å unsubscribe i SW).
 */
export async function disablePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch {
    // ignorer
  } finally {
    localStorage.removeItem('pushSub');
    localStorage.removeItem('pushSubId');
  }
}

/** Helper: Base64URL -> Uint8Array (for VAPID public key) */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}
