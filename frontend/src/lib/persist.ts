// frontend/src/lib/persist.ts
export type AqMeta = {
  lat: number
  lng: number
  city?: string
  countryCode?: string
  tz?: string
  mode: 'auto' | 'manual'
  savedAt: number
}
const KEY = 'aq7.meta.v1'

export function saveMeta(m: AqMeta) {
  try { localStorage.setItem(KEY, JSON.stringify(m)) } catch {}
}
export function loadMeta(): AqMeta | null {
  try {
    const s = localStorage.getItem(KEY)
    return s ? (JSON.parse(s) as AqMeta) : null
  } catch { return null }
}
export function clearMeta() {
  try { localStorage.removeItem(KEY) } catch {}
}
