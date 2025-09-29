
const BONNETID_API_URL = process.env.BONNETID_API_URL || 'https://api.bonnetid.no/v1/times'
const BONNETID_API_KEY = process.env.BONNETID_API_KEY

const ALADHAN_API_URL = process.env.ALADHAN_API_URL || 'https://api.aladhan.com/v1/timings'
const ALADHAN_METHOD = process.env.ALADHAN_METHOD || '2'

// Norway tuning (fallback i Norge)
const ALADHAN_METHOD_NORWAY = process.env.ALADHAN_METHOD_NORWAY || '99' // 99=custom
const ALADHAN_FAJR_ANGLE   = process.env.ALADHAN_FAJR_ANGLE   || '16'
const ALADHAN_ISHA_ANGLE   = process.env.ALADHAN_ISHA_ANGLE   || '15'
const ALADHAN_SCHOOL_NORWAY = process.env.ALADHAN_SCHOOL_NORWAY || '0'
const ALADHAN_LAT_ADJ_NORWAY = process.env.ALADHAN_LAT_ADJ_NORWAY || 'AngleBased'

export function inNorway(lat, lon) {
  if (lat == null || lon == null) return false
  return lat >= 57.9 && lat <= 71.3 && lon >= 4.6 && lon <= 31.2
}

export async function fetchBonnetidToday(lat, lon, tz, when='today') {
  const candidates = [BONNETID_API_URL, 'https://api.bonnetid.no/v1/timings/today', 'https://api.bonnetid.no/v1/times/today']
  let lastErr
  for (const base of candidates) {
    try {
      const u = new URL(base)
      u.searchParams.set('lat', String(lat))
      u.searchParams.set('lon', String(lon))
      if (tz) u.searchParams.set('tz', tz)
      if (when && when !== 'today') u.searchParams.set('when', when)
      const res = await fetch(u.toString(), {
        headers: BONNETID_API_KEY ? { 'x-api-key': BONNETID_API_KEY } : undefined
      })
      if (res.ok) {
        const j = await res.json()
        const timings = j.timings || j.data?.timings || j?.data || j
        return { timings, provider: 'bonnetid' }
      }
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('Bonnetid fetch failed')
}

export async function fetchAladhanToday(lat, lon, tz, when='today') {
  const u = new URL(`${ALADHAN_API_URL}/${when}`)
  u.searchParams.set('latitude', String(lat))
  u.searchParams.set('longitude', String(lon))
  if (tz) u.searchParams.set('timezonestring', tz)
  u.searchParams.set('method', ALADHAN_METHOD)
  const res = await fetch(u.toString())
  if (!res.ok) throw new Error('Aladhan fetch failed')
  const j = await res.json()
  const timings = j.data?.timings || j.timings || j.data
  return { timings, provider: 'aladhan' }
}

export async function fetchAladhanTodayNorway(lat, lon, tz, when='today') {
  const u = new URL(`${ALADHAN_API_URL}/${when}`)
  u.searchParams.set('latitude', String(lat))
  u.searchParams.set('longitude', String(lon))
  if (tz) u.searchParams.set('timezonestring', tz)
  u.searchParams.set('method', ALADHAN_METHOD_NORWAY) // 99=custom
  u.searchParams.set('fajr', ALADHAN_FAJR_ANGLE)
  u.searchParams.set('isha', ALADHAN_ISHA_ANGLE)
  u.searchParams.set('school', ALADHAN_SCHOOL_NORWAY)
  u.searchParams.set('latitudeAdjustmentMethod', ALADHAN_LAT_ADJ_NORWAY)
  const res = await fetch(u.toString())
  if (!res.ok) throw new Error('Aladhan Norway-tuned fetch failed')
  const j = await res.json()
  const timings = j.data?.timings || j.timings || j.data
  return { timings, provider: 'aladhan (norway tuned)' }
}
