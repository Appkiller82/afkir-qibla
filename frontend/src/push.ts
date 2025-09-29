/**
 * Robust Web Push subscription helper, with iOS (PWA) detection.
 * Usage from a click handler: await ensurePushSubscription();
 */

function urlB64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export async function ensurePushSubscription() {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Push not supported in this browser.");
  }

  // iOS: requires installed PWA (standalone)
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || (navigator as any).standalone;
  if (isIOS && !isStandalone) {
    throw new Error("På iPhone må appen installeres på Hjem-skjermen for å aktivere push-varsler. Del/Share → «Legg til på Hjem-skjerm».");
  }

  // Permission must be requested from a user gesture (call this from a click)
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Varseltillatelse ble ikke gitt.");

  const reg = await navigator.serviceWorker.register("/service-worker.js"); // make sure file is in /public or root
  await navigator.serviceWorker.ready;

  // Get public VAPID key from function (server truth)
  const vapidRes = await fetch("/.netlify/functions/vapid");
  if (!vapidRes.ok) throw new Error("Kunne ikke hente VAPID-nøkkel fra server.");
  const { publicKey } = await vapidRes.json();

  const appServerKey = urlB64ToUint8Array(publicKey);
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appServerKey });

  // Send to backend
  const saveRes = await fetch("/.netlify/functions/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub),
  });
  if (!saveRes.ok) throw new Error("Kunne ikke lagre abonnement på server.");

  return sub;
}
