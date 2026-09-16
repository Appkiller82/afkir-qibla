import { IrnError, municipalityFor, loadIrnMonth } from './lib/irn';
const json = (statusCode: number, body: unknown) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
export const handler = async (event: any) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  const q = event.queryStringParameters || {};
  const lat = Number(q.lat), lon = Number(q.lon), month = Number(q.month), year = Number(q.year);
  if (q.lat == null || q.lon == null || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2020 || year > 2100) {
    return json(400, { error: 'Ugyldig posisjon eller måned.' });
  }
  try {
    const place = await municipalityFor(lat, lon);
    if (!place) return json(200, { source: 'not_norway', rows: [] });
    return json(200, await loadIrnMonth(place.kommunenummer, year, month));
  } catch (e) {
    return json(503, { code: e instanceof IrnError ? e.code : 'IRN_UNAVAILABLE', error: e instanceof IrnError ? e.message : 'Kunne ikke hente IRNs bønnetider. Prøv igjen.' });
  }
};

