// Minimal client helper used by your PushControls component
export const urlBase64ToUint8Array = (base64String: string) => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export async function subscribeForPush(reg: ServiceWorkerRegistration, payload: any) {
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;
  if (!publicKey) throw new Error("Missing VITE_VAPID_PUBLIC_KEY");
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const res = await fetch("/.netlify/functions/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub, ...payload }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("Subscribe failed: " + text);
  }
  return res.json();
}

export async function sendPushAll(title: string, body: string, url: string) {
  const res = await fetch("/.netlify/functions/push/send-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, url }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
