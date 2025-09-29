// frontend/src/push.ts

// --- Helpers ---
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) throw new Error("Service Worker ikke støttet");
  return navigator.serviceWorker.register("/service-worker.js");
}

async function requestPermission() {
  if (!("Notification" in window)) throw new Error("Varsler ikke støttet");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Varsler ikke tillatt av bruker");
}

async function subscribeClient(reg?: ServiceWorkerRegistration): Promise<PushSubscription> {
  await requestPermission();
  const registration = reg ?? (await getRegistration());
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidKey) throw new Error("Mangler VITE_VAPID_PUBLIC_KEY");
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });
}

async function saveSubscription(subscription: PushSubscription, extra?: any) {
  const res = await fetch("/.netlify/functions/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription, ...extra }),
  });
  return res.json().catch(() => ({}));
}

// --- Eksporter som brukes i JSX ---

// Brukt av PushControls.jsx
export async function enablePush(): Promise<string> {
  const sub = await subscribeClient();
  const data = await saveSubscription(sub);
  const id = data?.id || data?.key || "OK";
  try {
    localStorage.setItem("pushSubId", String(id));
  } catch {}
  return String(id);
}

// Brukt av PushControlsAuto.jsx
export async function subscribeForPush(
  reg: ServiceWorkerRegistration,
  lat: number,
  lng: number,
  timezone: string
): Promise<string> {
  const sub = await subscribeClient(reg);
  const data = await saveSubscription(sub, { lat, lng, timezone });
  const id = data?.id || data?.key || "OK";
  try {
    localStorage.setItem("pushSubId", String(id));
  } catch {}
  return String(id);
}

// Brukt av PushControls.jsx
export async function sendTest(): Promise<string> {
  const id = (() => {
    try {
      return localStorage.getItem("pushSubId") || undefined;
    } catch {
      return undefined;
    }
  })();
  const res = await fetch("/.netlify/functions/send-test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const data = await res.json().catch(() => ({}));
  return data?.message || data?.result || "Test sendt";
}

// Brukt av App.jsx
export async function updateMetaIfSubscribed(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;

  const sub = await reg.pushManager.getSubscription();
  const isOn = !!sub;

  // Sett attributt på <html>
  try {
    document.documentElement.setAttribute("data-push", isOn ? "on" : "off");
  } catch {}

  // Oppdater app-badge hvis støttet
  try {
    // @ts-ignore
    if (isOn && "setAppBadge" in navigator) await (navigator as any).setAppBadge(1);
    // @ts-ignore
    if (!isOn && "clearAppBadge" in navigator) await (navigator as any).clearAppBadge();
  } catch {}

  return isOn;
}
// src/push.ts

/**
 * Update lightweight UI/meta when user is subscribed to push.
 * Safe no-op on platforms without SW/Push.
 * Returns true if a subscription exists.
 */
export async function updateMetaIfSubscribed(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    const isOn = !!sub;

    // Example: toggle an attribute the app can style against
    document.documentElement.toggleAttribute('data-has-push', isOn);

    // (Optional) nudge theme-color if you want a visual cue when push is on
    const themeMeta =
      document.querySelector('meta[name="theme-color"]') ||
      document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');

    if (themeMeta && !themeMeta.getAttribute('data-initialized')) {
      // Don’t clobber on every call; mark once
      themeMeta.setAttribute('data-initialized', '1');
      // If content is empty, set a sensible default
      if (!themeMeta.getAttribute('content')) {
        themeMeta.setAttribute('content', '#0f766e');
      }
    }

    return isOn;
  } catch {
    return false;
  }
}
