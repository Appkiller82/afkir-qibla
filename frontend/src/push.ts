// frontend/src/push.ts

// Konverter base64 til Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service Worker ikke støttet");
  }
  return navigator.serviceWorker.register("/service-worker.js");
}

async function subscribeClient(reg?: ServiceWorkerRegistration): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Varsling ble ikke tillatt av bruker");
  }
  const registration = reg || (await getRegistration());
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  const appServerKey = urlBase64ToUint8Array(vapidKey);
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: appServerKey,
  });
}

async function saveSubscription(sub: PushSubscription, extra?: any) {
  const res = await fetch("/.netlify/functions/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription: sub, ...extra }),
  });
  return res.json();
}

// 🔹 Disse må være med:
export async function enablePush(): Promise<string> {
  const sub = await subscribeClient();
  const data = await saveSubscription(sub);
  return data?.id || "OK";
}

export async function subscribeForPush(
  reg: ServiceWorkerRegistration,
  lat: number,
  lng: number,
  timezone: string
): Promise<string> {
  const sub = await subscribeClient(reg);
  const data = await saveSubscription(sub, { lat, lng, timezone });
  return data?.id || "OK";
}

export async function sendTest(): Promise<string> {
  const res = await fetch("/.netlify/functions/send-test", { method: "POST" });
  const data = await res.json();
  return data?.message || "Test sendt";
}
