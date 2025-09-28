// frontend/src/push.ts
// Robust push-hjelpere for Afkir Qibla

type Meta = {
  lat: number
  lng: number
  tz: string
  city?: string
  countryCode?: string
};

const BASE = (import.meta.env.VITE_PUSH_SERVER_URL || '/.netlify/functions').replace(/\/+$/, '');

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function getSWRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) throw new Error('Service Worker ikke støttet');
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg) return reg;
  // fallback – registrer om ikke finnes
  return navigator.serviceWorker.register('/service-worker.js');
}

async function ensureSubscription(reg: ServiceWorkerRegistration) {
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;

  const pub = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!pub) throw new Error('Mangler VITE_VAPID_PUBLIC_KEY i build');

  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(pub),
  });
}

// Kalles fra UI: oppretter/gjenbruker subscription og registrerer i backend.
// Lagrer pushSubId i localStorage ved suksess.
export async function subscribeForPush(
  reg?: ServiceWorkerRegistration,
  lat?: number,
  lng?: number,
  tz?: string
) {
  try {
    // Tillat varsler
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    if (Notification.permission !== 'granted') {
      throw new Error('Varsler er ikke tillatt');
    }

    const sw = reg || (await getSWRegistration());
    const sub = await ensureSubscription(sw);

    // Send til backend
    const res = await fetch(`${BASE}/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subscription: sub.toJSON(),
        lat, lng, tz,
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Subscribe HTTP ${res.status}${txt ? ` – ${txt}` : ''}`);
    }

    // backend svarer med { id: "..." } eller tekst
    let id = '';
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const j = await res.json();
      id = j?.id || j?.subId || '';
    } else {
      id = (await res.text())?.trim();
    }
    if (!id) id = 'unknown-' + (await sw.pushManager.getSubscription())?.endpoint?.slice(-10);

    localStorage.setItem('pushSubId', id);
    return id;
  } catch (e: any) {
    console.error('[push] subscribeForPush feilet:', e);
    throw e;
  }
}

// Brukt av App.jsx for å holde posisjonsmetadata oppdatert i backend
export async function updateMetaIfSubscribed(meta: Meta) {
  try {
    const id = localStorage.getItem('pushSubId');
    if (!id) return;

    const payload = { id, ...meta };
    const res = await fetch(`${BASE}/update-meta`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn('[push] update-meta HTTP', res.status, txt);
    }
  } catch (e) {
    console.warn('[push] update-meta feilet', e);
  }
}

// Valgfri: behold for andre kall
export async function sendTestDirect(subId?: string, secret?: string) {
  const headers: Record<string, string> = {};
  if (secret) headers['x-cron-secret'] = secret;

  // prøv JSON → raw → query
  let r = await fetch(`${BASE}/send-test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ subId }),
  });
  if (!r.ok) {
    r = await fetch(`${BASE}/send-test`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', ...headers },
      body: subId || '',
    });
  }
  if (!r.ok) {
    r = await fetch(`${BASE}/send-test?subId=${encodeURIComponent(subId || '')}`, { headers });
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text().catch(() => '')}`);
  return r.text();
}
