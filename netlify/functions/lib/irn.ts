// Server-only IRN client. Never import this module into the frontend.
const cache = new Map<string, { until: number; value: any }>();
async function cached(key: string, ttl: number, load: () => Promise<any>) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await load();
  if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
  cache.set(key, { until: Date.now() + ttl, value });
  return value;
}
export class IrnError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export async function municipalityFor(lat: number, lon: number) {
  // Exact coordinates in the key: rounding can cross a municipality boundary.
  return cached(`municipality:${lat},${lon}`, 86400000, async () => {
    const url = new URL('https://ws.geonorge.no/kommuneinfo/v1/punkt');
    url.search = new URLSearchParams({ nord: String(lat), ost: String(lon), koordsys: '4258' }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (res.status === 404) return null;
    if (!res.ok) throw new IrnError('LOCATION_UNAVAILABLE', 'Kunne ikke kontrollere kommunen. Prøv igjen.');
    const data = await res.json();
    if (!/^\d{4}$/.test(data?.kommunenummer)) throw new IrnError('LOCATION_UNAVAILABLE', 'Ugyldig svar fra kommuneoppslaget.');
    return data;
  });
}
async function irnGet(path: string, token: string) {
  const res = await fetch(`https://api.bonnetid.no${path}`, {
    headers: { 'Api-Token': token, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000), redirect: 'error',
  });
  if (!res.ok) throw new IrnError('IRN_UNAVAILABLE', 'IRNs bønnetider er midlertidig utilgjengelige. Prøv igjen.');
  return res.json();
}
export function selectLocation(locations: any[], municipality: string) {
  const matches = locations.filter(p => p.district_code === `NO${municipality}`);
  if (matches.length !== 1 || !Number.isInteger(matches[0].pk)) {
    throw new IrnError('IRN_LOCATION_MISSING', 'Ingen entydig IRN-tabell for denne kommunen.');
  }
  return matches[0];
}
export function normalizeMonth(data: any, location: any, year: number, month: number) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!Array.isArray(data) || data.length !== days) throw new IrnError('IRN_INCOMPLETE', 'IRNs månedstabell er ufullstendig.');
  const rows = data.map(d => {
    const match = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(d.date || '');
    if (!match || +match[2] !== month || +match[3] !== year || +match[1] < 1 || +match[1] > days || d.district_code !== location.district_code) {
      throw new IrnError('IRN_INCOMPLETE', 'IRN svarte med feil dato eller sted.');
    }
    const timings = { Fajr: d.fajr, Sunrise: d.shuruq_sunrise, Dhuhr: d.duhr, Asr: d.asr, Maghrib: d.maghrib, Isha: d.isha };
    if (Object.values(timings).some(t => typeof t !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
      throw new IrnError('IRN_INCOMPLETE', 'IRN mangler en eller flere bønnetider.');
    }
    return { date: `${year}-${String(month).padStart(2,'0')}-${match[1].padStart(2,'0')}`, timings, source: 'irn', sourceLocation: location.name };
  }).sort((a,b) => a.date.localeCompare(b.date));
  if (new Set(rows.map(r => r.date)).size !== days) throw new IrnError('IRN_INCOMPLETE', 'IRN har dupliserte datoer.');
  return rows;
}
export async function loadIrnMonth(municipality: string, year: number, month: number) {
  const token = process.env.IRN_API_KEY?.trim();
  if (!token) throw new IrnError('IRN_NOT_CONFIGURED', 'IRN-tilkoblingen er ikke konfigurert.');
  const locations = await cached('locations', 86400000, () => irnGet('/locations/', token));
  const location = selectLocation(locations, municipality);
  const rows = await cached(`month:${location.pk}:${year}:${month}`, 3600000, async () => {
    const data = await irnGet(`/prayertimes/${location.pk}/${year}/${month}/`, token);
    return normalizeMonth(data, location, year, month);
  });
  return { rows, source: 'irn', location: { id: location.pk, name: location.name, municipality } };
}

