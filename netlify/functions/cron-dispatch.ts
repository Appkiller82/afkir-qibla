// netlify/functions/cron-dispatch.ts
import type { Handler, Config } from "@netlify/functions";
import webpush from "web-push";

/**
 * Robust Netlify cron handler:
 * - Scheduled every minute (UTC)
 * - Manual trigger:  GET ?run=1
 * - Health check:    GET ?health=1
 * - Full try/catch; returns clear messages (no "Internal Error. ID: ...")
 *
 * Upstash REST rules:
 *   - Single command: POST UP_URL body=["CMD","ARG1",...]
 *   - Pipeline:       POST UP_URL/pipeline body=[["CMD",...],["CMD2",...]]
 */

export const config: Config = { schedule: "* * * * *" };

// --- Env ---
const UP_URL  = process.env.UPSTASH_REDIS_REST_URL || "";
const UP_TOK  = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const VAPID_PUB  = process.env.VAPID_PUBLIC_KEY  || "";
const VAPID_PRIV = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJ = process.env.VAPID_SUBJECT     || "";

// --- Windows ---
const LATE_TOLERANCE_MS = 5 * 60_000;   // send innenfor 5min før/etter nextAt
const TOO_LATE_MS       = 15 * 60_000;  // dropp eldre enn 15min

// --- Norge IRN profil (enkelt eksempel) ---
const IRN_NO = {
  fajrAngle: 18.0, ishaAngle: 14.0, latitudeAdj: 3, school: 0,
  offsets: { Fajr: -9, Dhuhr: +12, Asr: 0, Maghrib: +8, Isha: -46 }
};
type Times = Record<"Fajr"|"Sunrise"|"Dhuhr"|"Asr"|"Maghrib"|"Isha", Date>;

function mkDate(ymdStr: string, hhmm: string) {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  const d = new Date(`${ymdStr}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d;
}
function ddmmyyyyToYmd(ddmmyyyy: string) {
  const [dd, mm, yyyy] = ddmmyyyy.split("-").map((x) => parseInt(x, 10));
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}
async function fetchAladhan(
  lat: number, lng: number, when: "today" | "tomorrow",
  opts: { countryCode?: string; tz?: string }
): Promise<Times> {
  const tz = opts?.tz || "UTC";
  const p = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    timezonestring: tz,
    iso8601: "true",
  });
  if ((opts?.countryCode || "").toUpperCase() === "NO") {
    p.set("method", "99");
    p.set("fajr", String(IRN_NO.fajrAngle));
    p.set("isha", String(IRN_NO.ishaAngle));
    p.set("school", String(IRN_NO.school));
    p.set("latitudeAdjustmentMethod", String(IRN_NO.latitudeAdj));
  } else {
    p.set("method", "5");
    p.set("school", "0");
  }
  const res = await fetch(`https://api.aladhan.com/v1/timings/${when}?${p.toString()}`);
  const j = await res.json();
  if (!res.ok || j.code !== 200) throw new Error(`AlAdhan ${res.status}`);
  const ymd = ddmmyyyyToYmd(j.data?.date?.gregorian?.date as string);
  const t = j.data.timings;
  const base: Times = {
    Fajr: mkDate(ymd, t.Fajr),
    Sunrise: mkDate(ymd, t.Sunrise),
    Dhuhr: mkDate(ymd, t.Dhuhr),
    Asr: mkDate(ymd, t.Asr),
    Maghrib: mkDate(ymd, t.Maghrib),
    Isha: mkDate(ymd, t.Isha),
  };
  if ((opts?.countryCode || "").toUpperCase() === "NO") {
    const o = IRN_NO.offsets as Record<string, number>;
    base.Fajr.setMinutes(base.Fajr.getMinutes() + (o.Fajr || 0));
    base.Dhuhr.setMinutes(base.Dhuhr.getMinutes() + (o.Dhuhr || 0));
    base.Asr.setMinutes(base.Asr.getMinutes() + (o.Asr || 0));
    base.Maghrib.setMinutes(base.Maghrib.getMinutes() + (o.Maghrib || 0));
    base.Isha.setMinutes(base.Isha.getMinutes() + (o.Isha || 0));
  }
  return base;
}
function nextPrayer(times: Times) {
  const now = Date.now();
  const order: (keyof Times)[] = ["Fajr","Sunrise","Dhuhr","Asr","Maghrib","Isha"];
  for (const k of order) { const d = times[k]; if (d && d.getTime() > now) return { name: k, at: d.getTime() }; }
  return null;
}

// --- Upstash REST helpers ---
async function redisSingle(cmd: string[]) {
  if (!UP_URL || !UP_TOK) throw new Error("NO_UPSTASH");
  const r = await fetch(UP_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${UP_TOK}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const txt = await r.text();
  let j: any = {};
  try { j = JSON.parse(txt); } catch { j = { raw: txt }; }
  if (!r.ok) throw new Error(`Redis ${r.status} ${txt}`);
  return j;
}
async function redisPipe(cmds: string[][]) {
  if (!UP_URL || !UP_TOK) throw new Error("NO_UPSTASH");
  const r = await fetch(`${UP_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${UP_TOK}`, "content-type": "application/json" },
    body: JSON.stringify(cmds),
  });
  const txt = await r.text();
  let j: any = {};
  try { j = JSON.parse(txt); } catch { j = { raw: txt }; }
  if (!r.ok) throw new Error(`RedisPipe ${r.status} ${txt}`);
  return j;
}

// --- Core cron ---
async function runCron(): Promise<string> {
  console.log("[cron] tick", new Date().toISOString());

  if (!UP_URL || !UP_TOK) {
    console.log("[cron] Upstash not configured; idle");
    return "Upstash not configured; cron idle.";
  }
  if (!VAPID_PUB || !VAPID_PRIV || !VAPID_SUBJ) {
    console.error("[cron] Missing VAPID env");
    return "Missing VAPID env";
  }
  webpush.setVapidDetails(VAPID_SUBJ, VAPID_PUB, VAPID_PRIV);

  const sm = await redisSingle(["SMEMBERS","subs:all"]);
  const ids: string[] = (sm?.result) || sm || [];
  console.log("[cron] subs:", Array.isArray(ids) ? ids.length : 0);

  if (!Array.isArray(ids) || ids.length === 0) return "no subscribers";

  const now = Date.now();
  let sent = 0, updated = 0, skipped = 0;
  let skipNoHash=0, skipInactive=0, skipNoEndpoint=0, skipWindow=0;

  for (const id of ids) {
    const h = await redisSingle(["HGETALL", `sub:${id}`]);
    const arr: string[] = (h?.result) || h || [];
    if (!Array.isArray(arr) || arr.length === 0) { skipped++; skipNoHash++; continue; }
    const m: Record<string,string> = {};
    for (let i=0;i<arr.length;i+=2) m[arr[i]] = arr[i+1];

    if (m.active !== "1") { skipped++; skipInactive++; continue; }
    const endpoint = m.endpoint; if (!endpoint) { skipped++; skipNoEndpoint++; continue; }
    let keys: any = {}; try { keys = JSON.parse(m.keys || "{}"); } catch {}

    const nextAt   = Number(m.nextAt || 0);
    const lastSent = Number(m.lastSentAt || 0);
    const nextName = String(m.nextName || "");

    const tooEarly    = !nextAt || (now < (nextAt - LATE_TOLERANCE_MS));
    const alreadySent = lastSent && lastSent >= nextAt;
    const tooLate     = nextAt && (now - nextAt) > TOO_LATE_MS;

    if (tooEarly || alreadySent) { skipped++; skipWindow++; continue; }

    if (!nextAt || tooLate) {
      const lat = Number(m.lat), lng = Number(m.lng);
      const countryCode = String(m.countryCode || "");
      const tz = String(m.tz || "UTC");
      try {
        const today = await fetchAladhan(lat,lng,"today",{countryCode,tz});
        let nxt = nextPrayer(today);
        if (!nxt) {
          const tomorrow = await fetchAladhan(lat,lng,"tomorrow",{countryCode,tz});
          nxt = { name: "Fajr", at: tomorrow.Fajr.getTime() };
        }
        await redisSingle(["HSET", `sub:${id}`, "nextName", String(nxt!.name), "nextAt", String(nxt!.at)]);
        updated++;
      } catch (e:any) {
        console.error("[cron] reschedule-only failed", id, e?.message || e);
      }
      skipped++; continue;
    }

    // SEND
    const sub = { endpoint, keys } as any;
    const payload = JSON.stringify({ title: "Tid for bønn", body: nextName ? `Nå er det ${nextName}` : "Bønnetid", url: "/" });
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
      await redisPipe([["HSET", `sub:${id}`, "lastSentAt", String(nextAt), "lastSentName", nextName]]);
    } catch (e:any) {
      console.error("[cron] push failed for", id, e?.message || e);
    }

    // planlegg neste
    const lat = Number(m.lat), lng = Number(m.lng);
    const countryCode = String(m.countryCode || "");
    const tz = String(m.tz || "UTC");
    try {
      const today = await fetchAladhan(lat,lng,"today",{countryCode,tz});
      let nxt = nextPrayer(today);
      if (!nxt) {
        const tomorrow = await fetchAladhan(lat,lng,"tomorrow",{countryCode,tz});
        nxt = { name: "Fajr", at: tomorrow.Fajr.getTime() };
      }
      await redisSingle(["HSET", `sub:${id}`, "nextName", String(nxt!.name), "nextAt", String(nxt!.at)]);
      updated++;
    } catch (e:any) {
      console.error("[cron] could not reschedule", id, e?.message || e);
    }
  }

  const summary = { sent, updated, skipped, skipNoHash, skipInactive, skipNoEndpoint, skipWindow };
  console.log("[cron] done", summary);
  return `cron ok: sent=${sent} updated=${updated} skipped=${skipped}`;
}

// --- Handler ---
export const handler: Handler = async (event, _context) => {
  try {
    const method = event.httpMethod || "GET";
    const url = new URL(event.rawUrl || (event.headers["x-nf-raw-url"] as string) || ("http://x"+event.path));
    const qp = url.searchParams;

    if (qp.get("health") === "1") {
      let redisPing: any = null, upstashConfigured = !!(UP_URL && UP_TOK);
      if (upstashConfigured) {
        try {
          const r = await fetch(UP_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${UP_TOK}`, "content-type": "application/json" },
            body: JSON.stringify(["PING"]),
          });
          redisPing = await r.json().catch(() => ({}));
        } catch (e:any) { redisPing = { error: e?.message || String(e) }; }
      }
      const vapidConfigured = !!(VAPID_PUB && VAPID_PRIV && VAPID_SUBJ);
      return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ upstashConfigured, vapidConfigured, redisPing }) };
    }

    if (qp.get("run") === "1") {
      const result = await runCron();
      return { statusCode: 200, body: result };
    }

    // Scheduled invoke (POST) or manual GET without params
    if (method === "POST") {
      const result = await runCron();
      return { statusCode: 200, body: result };
    } else {
      return { statusCode: 200, body: "OK. Add ?run=1 to trigger now, or ?health=1 for status." };
    }
  } catch (e:any) {
    console.error("[cron] top-level error", e?.message || e);
    return { statusCode: 500, body: "cron error: " + (e?.message || String(e)) };
  }
};
