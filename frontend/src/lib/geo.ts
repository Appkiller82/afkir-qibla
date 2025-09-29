export async function getLocationWithFallback(opts?: PositionOptions): Promise<{lat:number; lon:number; tz:string}> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Oslo';

  // 1) Prøv siste lagrede posisjon
  const saved = localStorage.getItem('lastLocation');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed?.lat && parsed?.lon) return { lat: parsed.lat, lon: parsed.lon, tz };
    } catch {}
  }

  // 2) Prøv Permissions API (om tilgjengelig)
  try {
    const status = await (navigator.permissions as any)?.query?.({ name: 'geolocation' as any });
    if (status?.state === 'denied') {
      // Ikke stopp – vi tilbyr fallback videre
      throw new Error('denied');
    }
  } catch {}

  // 3) Prøv geolokasjon med kort timeout
  const latlon = await new Promise<GeolocationPosition>((resolve, reject) => {
    const id = navigator.geolocation.watchPosition(resolve, reject, {
      enableHighAccuracy: false, timeout: 8000, maximumAge: 60000
    });
    // Sikkerhetsnett: stopp watch etter timeout:
    setTimeout(() => {
      try { navigator.geolocation.clearWatch(id); } catch {}
    }, 9000);
  }).catch(() => null);

  if (latlon?.coords) {
    const res = { lat: +latlon.coords.latitude.toFixed(6), lon: +latlon.coords.longitude.toFixed(6), tz };
    localStorage.setItem('lastLocation', JSON.stringify(res));
    return res;
  }

  // 4) Fallback: Oslo sentrum – men la UI tydelig vise at dette er en default
  const fallback = { lat: 59.9139, lon: 10.7522, tz };
  localStorage.setItem('lastLocation', JSON.stringify(fallback));
  return fallback;
}
