export async function fetchBonnetid(lat: number, lng: number, when: string = "today") {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const url = `/api/bonnetid-today?lat=${lat}&lng=${lng}&when=${when}&tz=${encodeURIComponent(tz)}`;

  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Bonnetid proxy ${res.status}`);
  const json = await res.json();

  const timings = json?.timings || json?.data?.timings || {};
  const timezone = json?.timezone || json?.data?.meta?.timezone || tz;

  const today = new Date().toISOString().slice(0,10);
  const mk = (v: string) => {
    if (!v) return null;
    const [h,m] = String(v).slice(0,5).split(":").map(Number);
    const d = new Date(`${today}T00:00:00`);
    d.setHours(h, m, 0, 0);
    return d;
  };

  return {
    Fajr:       mk(timings.Fajr || timings.fajr),
    Soloppgang: mk(timings.Sunrise || timings.sunrise || timings.Soloppgang),
    Dhuhr:      mk(timings.Dhuhr || timings.dhuhr || timings.Zuhr || timings.zuhr),
    Asr:        mk(timings.Asr || timings.asr),
    Maghrib:    mk(timings.Maghrib || timings.maghrib),
    Isha:       mk(timings.Isha || timings.isha),
    _tz:        timezone,
  };
}
