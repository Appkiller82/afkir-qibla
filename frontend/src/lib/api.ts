
export async function getTodayTimes(lat:number, lon:number, tz:string) {
  const url = `/api/bonnetid-today?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&tz=${encodeURIComponent(tz)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('API-feil')
  return res.json()
}
