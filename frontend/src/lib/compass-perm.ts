// frontend/src/lib/compass-perm.ts
export type CompassState = 'unknown' | 'granted' | 'denied' | 'unsupported'

const KEY = 'aq7.compass.granted.v1'

export function wasEverGranted(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
export function setEverGranted(v: boolean) {
  try { localStorage.setItem(KEY, v ? '1' : '0') } catch {}
}

// iOS krever bruker-gesture for requestPermission()
export async function requestCompassPermission(): Promise<CompassState> {
  if (typeof window === 'undefined') return 'unsupported'
  const anyDO = (window as any).DeviceOrientationEvent
  if (!anyDO) return 'unsupported'

  // Chrome/Android: ofte ingen requestPermission -> anse som granted
  if (typeof anyDO.requestPermission !== 'function') {
    setEverGranted(true)
    return 'granted'
  }

  try {
    const res = await anyDO.requestPermission()
    if (res === 'granted') { setEverGranted(true); return 'granted' }
    return 'denied'
  } catch {
    return 'denied'
  }
}

// Armér én-taps auto re-grant (første trykk hvor som helst i UI)
export function armOneTapAutoRegrant(onGranted?: () => void) {
  const anyDO = (window as any).DeviceOrientationEvent
  if (!anyDO || typeof anyDO.requestPermission !== 'function') return
  if (!wasEverGranted()) return // bare auto når vi vet bruker har godkjent før

  const once = async () => {
    document.removeEventListener('pointerdown', once, true)
    try {
      const res = await anyDO.requestPermission()
      if (res === 'granted') { setEverGranted(true); onGranted?.() }
    } catch {}
  }
  // lav-innbrudds “arm”: første berøring i appen
  document.addEventListener('pointerdown', once, true)
}
