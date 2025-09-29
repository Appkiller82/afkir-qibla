function urlB64ToUint8Array(base64String) {
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
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone;
  if (isIOS && !isStandalone) {
    throw new Error("På iPhone må appen installeres på Hjem-skjermen (Del → «Legg til på Hjem-skjerm»).");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Varseltillatelse ble ikke gitt.");

  const reg = await navigator.serviceWorker.register("/service-worker.js");
  await navigator.serviceWorker.ready;

  const vapidRes = await fetch("/.netlify/functions/vapid");
  if (!vapidRes.ok) throw new Error("Kunne ikke hente VAPID-nøkkel fra server.");
  const { publicKey } = await vapidRes.json();

  const appServerKey = urlB64ToUint8Array(publicKey);
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appServerKey });

  const saveRes = await fetch("/.netlify/functions/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub),
  });
  if (!saveRes.ok) throw new Error("Kunne ikke lagre abonnement på server.");
  return sub;
}
