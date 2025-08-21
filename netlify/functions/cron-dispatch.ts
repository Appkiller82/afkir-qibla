// netlify/functions/cron-dispatch.ts
import type { Handler } from "@netlify/functions";

export const config = { schedule: "* * * * *" }; // every minute

// ====== Constants matching frontend NO_IRN_PROFILE ======
const NO_IRN_PROFILE = {
  fajrAngle: 18.0,
  ishaAngle: 14.0,
  latitudeAdj: 3,
  school: 0,
  // EXACT same offsets as in frontend
  offsets: { Fajr: -9, Dhuhr: +12, Asr: 0, Maghrib: +8, Isha: -46 }
};

const PRAYERS = ["Fajr","Dhuhr","Asr","Maghrib","Isha"] as const;
type Timings = Record<(typeof PRAYERS)[number], string>;

const UP_URL  = process.env.UPSTASH_REDIS_REST_URL as string;
const UP_TOK  = process.env.UPSTASH_REDIS_REST_TOKEN as string;
const PUSH_ENDPOINT = process.env.PUSH_ENDPOINT || `${process.env.URL}/.netlify/functions/push`;

// Sets we try to read subscription ids from
const SUBS_SET_KEYS = (process.env.SUBS_SET_KEYS || "subs,subs:all,subs all")
  .split(",").map(s=>s.trim()).filter(Boolean);

// ============ Helpers ============
async function upstash(path: string, init?: RequestInit) {
  const res = await fetch(`${UP_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${UP_TOK}`,
      "content-type": "application/json",
      ...(init?.headers || {})
    }
  });
  if (!res.ok) throw new Error(`Upstash ${path} -> ${res.status}`);
  return res.json() as Promise<any>;
}

async function listSubIds(): Promise<string[]> {
  for (const key of SUBS_SET_KEYS) {
    try {
      const r = await upstash(`/smembers/${encodeURIComponent(key)}`);
      if (Array.isArray(r?.result) && r.result.length) return r.result;
    } catch {}
  }
  return [];
}

async function readMeta(id: string): Promise<any|null> {
  try {
    const g = await upstash(`/get/sub:${id}`);
    if (typeof g?.result === "string" && g.result.length) {
      try { return JSON.parse(g.result); } catch {}
    }
  } catch {}
  try {
    const h = await upstash(`/hget/sub:${id}`, { method: "POST", body: JSON.stringify({ field: "data" }) });
    if (typeof h?.result === "string" && h.result.length) {
      try { return JSON.parse(h.result); } catch {}
    }
  } catch {}
  return null;
}

async function writeMeta(id: string, meta: any) {
  await upstash(`/set/sub:${id}`, { method: "POST", body: JSON.stringify({ value: JSON.stringify(meta) }) });
}

function hhmmToMinutes(hhmm: string): number {
  const m = String(hhmm||"00:00").match(/(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  const h = parseInt(m[1],10), mm = parseInt(m[2],10);
  return h*60 + mm;
}

function nowInTz(tz: string): { ymd: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find(p=>p.type===t)?.value || "";
  const y = get("year"), M = get("month"), d = get("day");
  const h = parseInt(get("hour")||"0",10), m = parseInt(get("minute")||"0",10);
  return { ymd: `${y}-${M}-${d}`, minutes: h*60 + m };
}

function nextYmdInTz(tz: string, todayYmd?: string): string {
  const base = todayYmd ? new Date(`${todayYmd}T00:00:00Z`) : new Date();
  const one = 24*60*60*1000;
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year:"numeric", month:"2-digit", day:"2-digit" });
  return fmt.format(new Date(base.getTime()+one));
}

function inDueWindow(nowMin: number, targetMin: number, earlyMin = 1, lateMin = 5) {
  return nowMin >= targetMin - earlyMin && nowMin <= targetMin + lateMin;
}

async function fetchTimingsAlAdhan(lat: number, lng: number, tz: string, method = 5, school = 0, ymd?: string): Promise<Timings|null> {
  try {
    const qp = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      method: String(method),
      school: String(school),
      timezonestring: tz,
      iso8601: "true"
    });
    if (ymd) qp.set("date", ymd);
    const url = `https://api.aladhan.com/v1/timings?${qp.toString()}`;
    const res = await fetch(url);
    const json = await res.json();
    const t = json?.data?.timings;
    if (!t) return null;
    const out: any = {};
    for (const p of PRAYERS) out[p] = String(t[p]||"00:00").split(" ")[0];
    return out as Timings;
  } catch { return null; }
}

async function fetchTimingsIRN_NO(lat: number, lng: number, tz: string, ymd?: string): Promise<Timings|null> {
  try {
    const qp = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      method: "99",
      fajr: String(NO_IRN_PROFILE.fajrAngle),
      isha: String(NO_IRN_PROFILE.ishaAngle),
      school: String(NO_IRN_PROFILE.school),
      latitudeAdjustmentMethod: String(NO_IRN_PROFILE.latitudeAdj),
      timezonestring: tz,
      iso8601: "true"
    });
    if (ymd) qp.set("date", ymd);
    const url = `https://api.aladhan.com/v1/timings?${qp.toString()}`;
    const res = await fetch(url);
    const json = await res.json();
    const t = json?.data?.timings;
    if (!t) return null;
    const base: any = {};
    for (const p of PRAYERS) base[p] = String(t[p]||"00:00").split(" ")[0];
    // Apply exact same offsets
    const o = NO_IRN_PROFILE.offsets;
    const adj: any = {};
    for (const p of PRAYERS) {
      const mins = hhmmToMinutes(base[p]) + (o[p as keyof typeof o] || 0);
      const wrapped = (mins % (24*60) + (24*60)) % (24*60);
      const h = Math.floor(wrapped/60), m = wrapped%60;
      adj[p] = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
    }
    return adj as Timings;
  } catch { return null; }
}

async function fetchTimingsSmart(lat: number, lng: number, tz: string, ymd: string, countryCode?: string, method?: number, school?: number): Promise<Timings|null> {
  const isNorway = (countryCode||"").toUpperCase() === "NO";
  if (isNorway) return await fetchTimingsIRN_NO(lat, lng, tz, ymd);
  return await fetchTimingsAlAdhan(lat, lng, tz, method ?? 5, school ?? 0, ymd);
}

function nextPrayerAfter(nowMin: number, timings: Timings) {
  for (const p of PRAYERS) {
    const tm = hhmmToMinutes(timings[p]);
    if (tm > nowMin) return { name: p, minutes: tm };
  }
  return null;
}

async function callPush(sub: any, payload: any) {
  const body = JSON.stringify({ subscription: sub, payload });
  let res = await fetch(`${PUSH_ENDPOINT}?mode=manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
  if (!res.ok) {
    res = await fetch(`${PUSH_ENDPOINT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });
  }
  return res.ok;
}

// ============ Handler ============
const handler: Handler = async () => {
  if (!UP_URL || !UP_TOK) {
    console.warn("[cron] Missing Upstash env");
    return { statusCode: 200, body: "missing upstash env" };
  }

  const ids = await listSubIds();
  if (!ids.length) return { statusCode: 200, body: "no subs" };

  let sent = 0, skipped = 0, updated = 0, errors = 0;

  for (const id of ids) {
    try {
      const meta = await readMeta(id);
      if (!meta?.sub?.endpoint) { skipped++; continue; }

      // Expect meta to contain precise per-user data
      const tz = meta.tz || "Europe/Oslo";
      const lat = Number(meta.lat);
      const lng = Number(meta.lng);
      const method = isFinite(Number(meta.method)) ? Number(meta.method) : undefined;
      const school = isFinite(Number(meta.school)) ? Number(meta.school) : undefined;
      // Prefer countryCode (as in frontend), fallback to country
      const countryCode = (meta.countryCode || meta.country || "").toUpperCase();

      if (!isFinite(lat) || !isFinite(lng)) { skipped++; continue; }

      const { ymd, minutes: nowMin } = nowInTz(tz);

      // Refresh timings cache per-day
      if (!meta._timings || meta._timings_ymd !== ymd) {
        const t = await fetchTimingsSmart(lat, lng, tz, ymd, countryCode, method, school);
        if (!t) { skipped++; continue; }
        meta._timings = t;
        meta._timings_ymd = ymd;
        updated++;
      }

      const timings: Timings = meta._timings;

      // Check if any prayer is due within window
      let due: { name: string; minutes: number } | null = null;
      for (const p of PRAYERS) {
        const tm = hhmmToMinutes(timings[p]);
        if (inDueWindow(nowMin, tm, 1, 5)) { due = { name: p, minutes: tm }; break; }
      }

      // Compute nextName (for info)
      const upcoming = nextPrayerAfter(nowMin, timings);
      if (upcoming) {
        meta.nextName = upcoming.name;
        meta.nextAtYmd = ymd;
        meta.nextAtMinutes = upcoming.minutes;
      }

      // Dedup by day|prayer
      const currentKey = due ? `${ymd}|${due.name}` : "";
      if (due && meta.lastSentKey !== currentKey) {
        const ok = await callPush(meta.sub, {
          title: `Tid for ${due.name}`,
          body: `Det er tid for ${due.name} nå`,
          url: "/"
        });
        if (ok) {
          sent++;
          meta.lastSentKey = currentKey;
        } else {
          errors++;
        }
      } else {
        skipped++;
      }

      await writeMeta(id, meta);
    } catch (e) {
      errors++;
    }
  }

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sent, skipped, updated, errors })
  };
};

export default handler;
