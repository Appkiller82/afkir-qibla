// frontend/src/lib/qibla.ts
/** Qibla bearing from (lat,lng) to Kaaba. Returns 0..360 degrees (0=N). */
export function qiblaBearing(lat: number, lng: number) {
  const toRad = (d: number) => d * Math.PI / 180
  const toDeg = (r: number) => r * 180 / Math.PI
  const φ1 = toRad(lat), λ1 = toRad(lng)
  const φ2 = toRad(21.4225), λ2 = toRad(39.8262) // Kaaba
  const Δλ = λ2 - λ1
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  let θ = toDeg(Math.atan2(y, x))
  if (θ < 0) θ += 360
  return θ
}

/** Signed shortest turn from current heading to target bearing. */
export function headingDelta(current: number, target: number) {
  return ((target - current + 540) % 360) - 180
}
