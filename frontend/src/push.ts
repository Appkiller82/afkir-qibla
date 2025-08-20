// frontend/src/push.ts

// VAPID public key må ligge i Netlify env som VITE_VAPID_PUBLIC_KEY
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function assert(cond: any, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getSWRegistration(): Promise<ServiceWorkerRegistration> {
  assert("serviceWorker" in navigator, "Service worker støttes ikke i denne nettleseren.");
  // SW må være registrert i main.jsx på /service-worker.js (du har dette fra før)
  return navigator.serviceWorker.ready;
}

async function ensurePermission(): Promise<void> {
  assert("Notification" in window, "Varsler støttes ikke i denne nettleseren.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Du må tillate varsler for å aktivere push.");
}

async function getOrCreateSubscription(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  let sub = await reg.pushManager.getSubscription();
  if (sub) return sub;

  assert(VAPID_PUBLIC_KEY, "Mangler VITE_VAPID_PUBLIC_KEY (sjekk Netlify Environment variables).");

  sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  return sub;
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const res = await fetch("/.netlify/functions/save-sub", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sub),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`save-sub feilet (${res.status}): ${text || "ukjent feil"}`);
  }
}

/**
 * Aktiver push-varsler på denne enheten.
 * Returnerer endpoint-id (forkortet kan vises i UI).
 */
export async function enablePush(): Promise<string> {
  try {
    await ensurePermission();
    const reg = await getSWRegistration();
    const sub = await getOrCreateSubscription(reg);
    await saveSubscription(sub);

    // lagre til enkel feilsøking i UI
    const id = sub.endpoint || "";
    try { localStorage.setItem("pushSubId", id); } catch {}
    return id;
  } catch (err: any) {
    // litt mer nyttig logging
    console.error("[enablePush] error:", err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Kall send-test funksjonen (server sender push til alle lagrede subs).
 * Returnerer tekst fra server (f.eks. {"sendt":1,"feil":0,"fjernet":0})
 */
export async function sendTest(): Promise<string> {
  try {
    const res = await fetch("/.netlify/functions/send-test", { method: "POST" });
    const text = await res.text();
    if (!res.ok) throw new Error(`send-test feilet (${res.status}): ${text || "ukjent feil"}`);
    return text;
  } catch (err: any) {
    console.error("[sendTest] error:", err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * (Valgfritt) Skru av lokalt – fjerner kun lokalt lagret endpoint.
 * Skal du “unsubscribe” ordentlig fra push, kan du bruke funksjonen under.
 */
export function clearLocalPushId(): void {
  try { localStorage.removeItem("pushSubId"); } catch {}
}

/**
 * (Valgfritt) Avmeld fra push hos nettleseren (opphever selve abonnementet).
 * Merk: Du kan også lage en server-funksjon som sletter lagrede subs ved avmelding.
 */
export async function unsubscribePush(): Promise<boolean> {
  try {
    const reg = await getSWRegistration();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return true;
    const ok = await sub.unsubscribe();
    try { localStorage.removeItem("pushSubId"); } catch {}
    return ok;
  } catch (err) {
    console.error("[unsubscribePush] error:", err);
    return false;
  }
}
