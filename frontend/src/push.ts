// frontend/src/push.ts

// --- helpers ---
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getReg(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) throw new Error("Service Worker ikke støttet");
  // bruk samme sti som PWAen din
  return navigator.serviceWorker.register("/service-worker.js");
}

async function ensurePermission() {
  if (!("Notification" in window)) throw new Error("Varsler ikke støttet");
  const p = await Notification.requestPermission();
  if (p !== "granted") throw new Error("Varsling ikke tillatt");
}

async function subscribeBrowser(reg?: ServiceWorkerRegistration): Promise<PushSubscription> {
  await ensurePermission();
  const registration = reg ?? (await getReg());
  const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapid) throw new Error("Mangler VITE_VAPID_PUBLIC_KEY");
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid),
  });
}

async function postJSON(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json().catch(() => ({}));
}

// --- required exports ---

export async function enablePush(): Promise<string> {
  const sub = await subscribeBrowser();
  const data = await postJSON("/.netlify/functions/subscribe", { subscription: sub });
  const id = data?.id || data?.key || data?.subscriptionId || "OK";
  try { localStorage.setItem("pushSubId", String(id)); } catch {}
  return String(id);
}

export async function subscribeForPush(
  reg: ServiceWorkerRegistration,
  lat: number,
  lng: number,
  timezone: string
): Promise<string> {
  const sub = await subscribeBrowser(reg);
  const data = await postJSON("/.netlify/functions/subscribe", {
    subscription: sub,
    lat,
    lng,
    timezone,
  });
  const id = data?.id || data?.key || data?.subscriptionId || "OK";
  try { localStorage.setItem("pushSubId", String(id)); } catch {}
  return String(id);
}

export async function sendTest(): Promise<string> {
  const id = (() => { try { return localStorage.getItem("pushSubId") || undefined; } catch { return undefined; }})();
  const data = await postJSON("/.netlify/functions/send-test", { id });
  return data?.message || data?.result || "Test sendt";
}
