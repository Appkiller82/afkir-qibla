
// Frontend helper: unified timings fetch with Norway->Bonnetid (strict), World->Aladhan
export type Timings = {
  Fajr: string; Sunrise: string; Dhuhr: string; Asr: string; Maghrib: string; Isha: string;
};

async function readJsonOrThrow(res: Response, source: string) {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!res.ok) throw new Error(`${source} ${res.status}: ${text || "empty"}`);
  if (!ct.includes("application/json")) throw new Error(`${source} returned non-JSON response`);
  try { return JSON.parse(text); } catch { throw new Error(`${source} invalid JSON`); }
}

export async function fetchTimings(
  lat: number,
  lon: number,
  tz: string,
  countryCode: string | undefined | null,
  when: "today" | "tomorrow" = "today"
): Promise<Timings> {
  const cc = (countryCode || "").toUpperCase();

  if (cc === "NO") {
    try {
      const u = `/api/bonnetid-today?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&tz=${encodeURIComponent(tz)}&when=${encodeURIComponent(when)}`;
      const r = await fetch(u);
      const j = await readJsonOrThrow(r, "Bonnetid");
      return ensure(j.timings);
    } catch {
      // Fallback for Norway if Bonnetid path is unavailable in deploy/runtime.
      const u2 = `/api/aladhan-today?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&tz=${encodeURIComponent(tz)}&when=${encodeURIComponent(when)}&cc=NO`;
      const r2 = await fetch(u2);
      const j2 = await readJsonOrThrow(r2, "Aladhan");
      return ensure(j2.timings);
    }
  }

  // Rest of world: Aladhan global
  const u3 = `/api/aladhan-today?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&tz=${encodeURIComponent(tz)}&when=${encodeURIComponent(when)}&cc=${encodeURIComponent(cc)}`;
  const r3 = await fetch(u3);
  const j3 = await readJsonOrThrow(r3, "Aladhan");
  return ensure(j3.timings);
}

function pad2(n: number) { return (n < 10 ? "0" : "") + n; }
function toHHMM(v: any) {
  if (!v) return v;
  const s = String(v).trim();
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(":").map(Number);
    return `${pad2(h)}:${pad2(m)}`;
  }
  if (/^\d{1,2}\.\d{2}$/.test(s)) {
    const [h, m] = s.split(".").map(Number);
    return `${pad2(h)}:${pad2(m)}`;
  }
  const m = s.match(/^(\d{1,2}:\d{2})/);
  if (m) return m[1];
  return s;
}

function ensure(t: any): Timings {
  return {
    Fajr: toHHMM(t.Fajr || t.fajr),
    Sunrise: toHHMM(t.Sunrise || t.sunrise),
    Dhuhr: toHHMM(t.Dhuhr || t.dhuhr || t.Zuhr || t.zuhr),
    Asr: toHHMM(t.Asr || t.asr),
    Maghrib: toHHMM(t.Maghrib || t.maghrib),
    Isha: toHHMM(t.Isha || t.isha),
  };
}
