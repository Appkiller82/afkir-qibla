
const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY

export async function ensureSW() {
  if (!('serviceWorker' in navigator)) throw new Error('Service Worker ikke støttet')
  const reg = await navigator.serviceWorker.register('/service-worker.js')
  return reg
}

export async function subscribeForPush(probe = false) {
  const reg = await ensureSW()
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Varsling ble ikke tillatt')

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
  })

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const coords = await getCoordsSafe()
  const body = {
    endpoint: sub.endpoint,
    keys: (sub.toJSON() as any).keys,
    tz,
    lat: coords?.latitude ?? null,
    lon: coords?.longitude ?? null,
    ua: navigator.userAgent,
    probe
  }

  const res = await fetch('/.netlify/functions/push-subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error('Kunne ikke lagre abonnement')
}

export async function unsubscribeFromPush() {
  const reg = await ensureSW()
  const sub = await reg.pushManager.getSubscription()
  if (sub) {
    await fetch('/.netlify/functions/push-unsubscribe', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({ endpoint: sub.endpoint })
    })
    await sub.unsubscribe()
  }
}

function urlBase64ToUint8Array(base64String:string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64); const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function getCoordsSafe(): Promise<GeolocationCoordinates | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null)
    navigator.geolocation.getCurrentPosition(p => resolve(p.coords), () => resolve(null), {timeout: 8000})
  })
}
