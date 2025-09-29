// frontend/src/push.ts

type Meta = {
  lat: number | null
  lng: number | null
  tz?: string
  city?: string
  countryCode?: string
  subscribedAt?: string
  updatedAt?: string
  app?: string
  platform?: string
}

type SubscribePayload = {
  subscription: PushSubscription
  meta: Meta
}

type UpdateMetaPayload = {
  endpoint: string
  meta: Meta
}

// ---- Helpers ----
function getVapidPublicKey(): string {
  // Vite-injected env
  const k = (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY as string | undefined
  if (!k) throw new Error("Mangler VITE_VAPID_PUBLIC_KEY i frontend-miljøet.")
  return k
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// Best-effort reverse geocode (frivillig – kan droppes om du vil)
async function reverseGeocode(lat: number, lng: number): Promise<{ city: string; countryCode: string }> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}` +
      `&accept-language=nb&zoom=10&addressdetails=1`
    const res = await fetch(url, { headers: { Accept: "application/json" } })
    if (!res.ok) return { city: "", countryCode: "" }
    const json = await res.json()
    const a = json?.address ?? {}
    const city =
      a.city || a.town || a.village || a.municipality || a.suburb || a.state || a.county || ""
    const countryCode = (a.country_code || "").toUpperCase()
    return { city, countryCode }
  } catch {
    return { city: "", countryCode: "" }
  }
}

/**
 * Abonner på push og send subscription + metadata til backend
 * Matches: subscribeForPush(reg, lat, lng, timezone)
 */
export async function subscribeForPush(
  reg: ServiceWorkerRegistration,
  lat: number,
  lng: number,
  tz: string
): Promise<PushSubscription> {
  // 1) Varsel-tillatelse
  if (!("Notification" in window)) throw new Error("Notification API ikke støttet.")
  if (Notification.permission === "default") {
    const r = await Notification.requestPermission()
    if (r !== "granted") throw new Error("Varsel-tillatelse ble ikke gitt.")
  } else if (Notification.permission !== "granted") {
    throw new Error("Varsel-tillatelse er blokkert i nettleseren.")
  }

  // 2) Finn/lag subscription
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    const vapid = getVapidPublicKey()
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid),
    })
  }

  // 3) (Valgfritt) slå opp by/land
  const { city, countryCode } = await reverseGeocode(lat, lng)

  // 4) Send til backend (upsert)
  const payload: SubscribePayload = {
    subscription: sub,
    meta: {
      lat,
      lng,
      tz,
      city,
      countryCode,
      subscribedAt: new Date().toISOString(),
      app: "Afkir Qibla",
      platform: navigator?.userAgent ?? "",
    },
  }

  try {
    const resp = await fetch("/.netlify/functions/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) {
      // Klient er likevel registrert lokalt
      console.warn("Subscribe backend svarte ikke OK:", resp.status, await resp.text().catch(() => ""))
    }
  } catch (e) {
    // Klient er likevel registrert lokalt
    console.warn("Subscribe backend feilet:", e)
  }

  try {
    localStorage.setItem("aq_push_subscribed", "1")
  } catch {}
  return sub
}

/**
 * Oppdater metadata for eksisterende subscription (kalles når bruker flytter/oppdaterer by)
 * Matches: updateMetaIfSubscribed({ lat, lng, city, countryCode, tz })
 */
export async function updateMetaIfSubscribed(meta: Meta): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return

  const body: UpdateMetaPayload = {
    endpoint: sub.endpoint,
    meta: { ...meta, updatedAt: new Date().toISOString() },
  }

  // Prøv eget endepunkt først; fallback til subscribe (upsert)
  let ok = false
  try {
    const r = await fetch("/.netlify/functions/update-meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    ok = r.ok
  } catch {}

  if (!ok) {
    try {
      await fetch("/.netlify/functions/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: sub,
          meta: body.meta,
        } as SubscribePayload),
      })
    } catch {}
  }
}

/**
 * Lokal avmelding + forsøk å informere backend
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return false
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return false

  try {
    await fetch("/.netlify/functions/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    })
  } catch {}

  const ok = await sub.unsubscribe()
  try {
    localStorage.removeItem("aq_push_subscribed")
  } catch {}
  return ok
}
