
import { fetchBonnetidToday, fetchAladhanToday, fetchAladhanTodayNorway, inNorway } from './_util/providers.js'

export default async function handler(req) {
  const url = new URL(req.url)
  const lat = parseFloat(url.searchParams.get('lat'))
  const lon = parseFloat(url.searchParams.get('lon'))
  const tz = url.searchParams.get('tz') || ''
  const when = url.searchParams.get('when') || 'today'

  try {
    let data
    if (inNorway(lat, lon)) {
      try {
        data = await fetchBonnetidToday(lat, lon, tz, when)
      } catch {
        data = await fetchAladhanTodayNorway(lat, lon, tz, when)
      }
    } else {
      data = await fetchAladhanToday(lat, lon, tz, when)
    }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'unknown' }), { status: 500, headers: { 'content-type': 'application/json' } })
  }
}
