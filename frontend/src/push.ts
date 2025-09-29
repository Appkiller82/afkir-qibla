export async function subscribeForPush(reg: ServiceWorkerRegistration, lat?: number, lng?: number, timezone?: string) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications not granted");

  const vapidRes = await fetch("/.netlify/functions/vapid");
  const { publicKey } = await vapidRes.json();

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await fetch("/.netlify/functions/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription: sub.toJSON ? sub.toJSON() : sub,
      lat, lng, timezone,
    }),
  });

  return sub;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
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

