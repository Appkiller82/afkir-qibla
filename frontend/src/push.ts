// frontend/src/push.ts

export async function updateMetaIfSubscribed(): Promise<void> {
  try {
    // Finn en SW-registrering hvis den finnes
    const reg = await navigator.serviceWorker?.ready;
    const sub = await reg?.pushManager.getSubscription();

    // Oppdater dokumenttittel (safe no-op i SSR/build)
    if (typeof document !== "undefined") {
      document.title = sub ? "Afkir Qibla • Varsler på" : "Afkir Qibla";

      // Oppdater evt. meta-tagger hvis de finnes
      const metaAppName =
        document.querySelector('meta[name="application-name"]') ||
        document.querySelector('meta[name="apple-mobile-web-app-title"]');
      if (metaAppName) {
        metaAppName.setAttribute(
          "content",
          sub ? "Afkir Qibla • 🔔" : "Afkir Qibla"
        );
      }
    }
  } catch {
    // bevisst no-op; vi vil aldri knekke build for dette
  }
}

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
