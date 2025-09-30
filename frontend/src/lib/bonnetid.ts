// Enkel klient-wrapper som henter via Netlify Function (server-proxy)
export type PrayerTimes = {
  Fajr?: string; Sunrise?: string; Dhuhr?: string; Asr?: string; Maghrib?: string; Isha?: string;
  [k: string]: any;
};

export async function fetchBonnetid(lat: number, lon: number, when: string = "today") {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const url = `/api/bonnetid-today?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}&tz=${encodeURIComponent(tz)}&date=${encodeURIComponent(when)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Bonnetid feilet: ${res.status} ${msg}`);
  }
  const json = await res.json();

  // API kan være { timings: {...} } eller { data: { timings: {...} } }
  const timings = json?.timings || json?.data?.timings || json;
  return ensureDates(timings, when);
}

// Mapper "HH:mm" til Date-objekter samme dato (lokal tid) + beholder strenger
export function ensureDates(raw: Record<string, string>, when: string) {
  const keys = ["Fajr","Sunrise","Dhuhr","Asr","Maghrib","Isha"];
  const out: any = {};
  for (const k of keys) out[k] = raw?.[k] ?? null;

  const base = when === "today" ? new Date() : new Date(when);
  for (const k of keys) {
    const val = out[k];
    if (typeof val === "string" && /^\d{1,2}:\d{2}$/.test(val)) {
      const [hh, mm] = val.split(":").map(Number);
      const d = new Date(base);
      d.setHours(hh, mm, 0, 0);
      out[k + "Date"] = d;
    } else {
      out[k + "Date"] = null;
    }
  }
  return out as PrayerTimes & Record<string, Date | null>;
}
