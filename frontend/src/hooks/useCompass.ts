// frontend/src/hooks/useCompass.ts
import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * useCompass - cross-platform compass adapter for PWAs.
 * - iOS: uses webkitCompassHeading (0..360, 0=N)
 * - Others: uses DeviceOrientationEvent.alpha -> converts to compass heading
 * - Compensates for screen orientation (portrait/landscape)
 * - Optional low-pass smoothing
 */
export function useCompass(opts?: { smoothing?: number }) {
  const smoothing = Math.min(Math.max(opts?.smoothing ?? 0.25, 0), 0.95)

  const [supported, setSupported] = useState<boolean>(false)
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown')
  const [heading, setHeading] = useState<number | null>(null)
  const lastRef = useRef<number | null>(null)

  const getScreenAngle = () => {
    const scr: any = (window as any).screen
    const ang = scr?.orientation?.angle
    if (typeof ang === 'number') return ang
    const legacy: any = (window as any).orientation
    if (typeof legacy === 'number') return legacy
    return 0
  }
  const normalize = (deg: number) => {
    let x = deg % 360
    if (x < 0) x += 360
    return x
  }
  const toCompassFromAlpha = (alpha: number) => normalize(360 - alpha)

  useEffect(() => {
    const hasDO = typeof (window as any).DeviceOrientationEvent !== 'undefined'
    setSupported(hasDO)
    if (!hasDO) return

    try {
      const anyDO = (window as any).DeviceOrientationEvent
      if (typeof anyDO.requestPermission === 'function') {
        setPermission('unknown') // iOS: needs user gesture elsewhere (CompassGate)
      } else {
        setPermission('granted') // non-iOS typically no prompt
      }
    } catch {
      setPermission('unknown')
    }

    const onDO = (e: any) => {
      let h: number | null = null
      if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) {
        h = e.webkitCompassHeading
      } else if (typeof e.alpha === 'number' && !Number.isNaN(e.alpha)) {
        h = toCompassFromAlpha(e.alpha)
      }
      if (h == null) return

      h = normalize(h + getScreenAngle())
      const last = lastRef.current
      const next = last == null ? h : (last + smoothing * (h - last))
      lastRef.current = next
      setHeading(next)
      if (permission !== 'granted') setPermission('granted')
    }

    window.addEventListener('deviceorientation', onDO, true)
    return () => window.removeEventListener('deviceorientation', onDO, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smoothing])

  return useMemo(() => ({
    heading, supported, permission
  }), [heading, supported, permission])
}

export default useCompass
