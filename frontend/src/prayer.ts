// Frontend helper: unified timings fetch with Norway->Bonnetid then Aladhan (tuned), World->Aladhan
// Updates:
// - Prefer Asr 2x-skygge (Hanafi) when provided by Bonnetid/Aladhan payloads
// - Compute Dhuhr from Istiwa/Zawal + configurable safety offset (default: 2 min) when Istiwa is available
// - Adds optional debug logging (toggle via VITE_DEBUG_PRAYER=1)

export type Timings = {
  Fajr: string; Sunrise: string; Dhuhr: string; Asr: string; Maghrib: string; Isha: string;
};

const DEBUG = String((import.meta as any)?.env?.VITE_DEBUG_PRAYER || "") === "1";
const DHUHR_OFFSET_MIN = Number((import.meta as any)?.env?.VITE_DHUHR_OFFSET_MIN ?? 2); // default 2
const FORCE_HANAFI_ASR = String((import.meta as any)?.env?.VITE_ASR_MODE || "hanafi").toLowerCase() === "hanafi";

export async function fetchTimings(
  lat: number,
  lon: number,
  tz: string,
  countryCode: string | undefined | null,
  when: "today" | "tomorrow" = "today"
): Promise<Timings> {
  const cc = (countryCode || "").toUpperCase();

  if (cc === "NO") {
    // Try Bonnetid first
    try {
      const u = `/api/bonnetid-today?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&tz=${encodeURIComponent(tz)}&when=${encodeURIComponent(when)}`;
      const r = await fetch(u);
      if (!r.ok) throw new Error(`Bonnetid ${r.status}`);
      const j = await r.json();

      if (DEBUG) {
        console.log("[Prayer] Bonnetid ok", { url: u, keys: Object.keys(j || {}), timingKeys: Object.keys(j?.timings || {}) });
      }

      return ensure(j.timings);
    } catch (err) {
      if (DEBUG) console.warn("[Prayer] Bonnetid failed -> fallback Aladhan", err);

      // Fallback: Aladhan tuned for Norway
      const u2 = `/api/aladhan-today?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&tz=${encodeURIComponent(tz)}&when=${encodeURIComponent(when)}&cc=NO`;
      const r2 = await fetch(u2);
      if (!r2.ok) throw new Error(`Aladhan fallback ${r2.status}`);
      const j2 = await r2.json();

      if (DEBUG) {
        console.log("[Prayer] Aladhan fallback ok", { url: u2, keys: Object.keys(j2 || {}), timingKeys: Object.keys(j2?.timings || {}) });
      }

      return ensure(j2.timings);
    }
  }

  // Rest of world: Aladhan global
  const u3 = `/api/aladhan-today?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&tz=${encodeURIComponent(tz)}&when=${encodeURIComponent(when)}`;
  const r3 = await fetch(u3);
  if (!r3.ok) throw new Error(`Aladhan ${r3.status}`);
  const j3 = await r3.json();

  if (DEBUG) {
    console.log("[Prayer] Aladhan ok", { url: u3, keys: Object.keys(j3 || {}), timingKeys: Object.keys(j3?.timings || {}) });
  }

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

function addMinutesHHMM(hhmm: string, minutes: number): string {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h * 60 + m + minutes + 24 * 60) % (24 * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${pad2(hh)}:${pad2(mm)}`;
}

function pick(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return v;
  }
  return undefined;
}

function ensure(t: any): Timings {
  // Support multiple provider field names (Bonnetid/Aladhan/custom)
  const fajr = toHHMM(pick(t, ["Fajr", "fajr"]));
  const sunrise = toHHMM(pick(t, ["Sunrise", "sunrise", "Soloppgang", "soloppgang"]));
  const maghrib = toHHMM(pick(t, ["Maghrib", "maghrib"]));
  const isha = toHHMM(pick(t, ["Isha", "isha"]));

  // Istiwa/Zawal/Solar noon (if provided)
  const istiwa = toHHMM(pick(t, ["Istiwa", "istiwa", "Zawal", "zawal", "SolarNoon", "solarNoon", "Noon", "noon"]));
  const dhuhrRaw = toHHMM(pick(t, ["Dhuhr", "dhuhr", "Zuhr", "zuhr"]));
  const dhuhr = istiwa ? addMinutesHHMM(istiwa, isFinite(DHUHR_OFFSET_MIN) ? DHUHR_OFFSET_MIN : 2) : dhuhrRaw;

  // Asr: prefer 2x-skygge (Hanafi) if requested and present; otherwise use standard Asr
  const asr2 = toHHMM(pick(t, ["Asr2", "asr2", "Asr_2x", "asr_2x", "AsrHanafi", "asrHanafi", "Shadow2", "shadow2", "2x-skygge", "2x_sk", "2x_shadow"]));
  const asr1 = toHHMM(pick(t, ["Asr", "asr", "Asr1", "asr1", "Shadow1", "shadow1", "1x-skygge", "1x_sk", "1x_shadow"]));
  const asr = (FORCE_HANAFI_ASR && asr2) ? asr2 : (asr1 || asr2);

  if (DEBUG) {
    console.log("[Prayer] ensure()", { istiwa, dhuhrRaw, dhuhr, asr1, asr2, asr });
  }

  return { Fajr: fajr, Sunrise: sunrise, Dhuhr: dhuhr, Asr: asr, Maghrib: maghrib, Isha: isha };
}
