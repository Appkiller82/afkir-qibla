function normalizeFieldKey(key: string) {
  return String(key || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function toHHMM(value: unknown) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(":").map(Number);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  if (/^\d{1,2}\.\d{2}$/.test(s)) {
    const [h, m] = s.split(".").map(Number);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const m = s.match(/^(\d{1,2}:\d{2})/);
  return m ? m[1] : "";
}

function createLookup(t: any) {
  const map = new Map<string, string>();
  if (!t || typeof t !== "object") return map;
  for (const [k, v] of Object.entries(t)) {
    if (v === null || v === undefined) continue;
    const hit = String(v).trim();
    if (!hit) continue;
    map.set(normalizeFieldKey(k), hit);
  }
  return map;
}

function pick(lookup: Map<string, string>, ...aliases: string[]) {
  for (const alias of aliases) {
    const value = lookup.get(normalizeFieldKey(alias));
    if (value) return toHHMM(value);
  }
  return "";
}

export function mapTimings(raw: any) {
  const source = raw?.timings || raw?.data?.timings || raw?.result?.timings || raw?.data || raw?.result || raw;
  const lookup = createLookup(source);
  return {
    Fajr: pick(lookup, "fajr", "fajr_sadiq", "Morgengry 16°", "Morgengry"),
    Sunrise: pick(lookup, "shuruq_sunrise", "sunrise", "Soloppgang"),
    Dhuhr: pick(lookup, "duhr", "dhuhr", "zuhr", "Duhr"),
    Asr: pick(lookup, "asr", "2x-skygge", "asr_2x"),
    Maghrib: pick(lookup, "maghrib", "magrib"),
    Isha: pick(lookup, "isha"),
  };
}

export function resolveBonnetidRoot() {
  const candidate = String(process.env.BONNETID_API_URL || "https://api.bonnetid.no").trim();
  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  const base = new URL(withScheme);
  base.search = "";
  base.hash = "";
  if (!base.pathname || base.pathname === "") base.pathname = "/";
  return base;
}

export function authHeaders() {
  const token = process.env.BONNETID_API_TOKEN || process.env.BONNETID_API_KEY || "";
  if (!token) return null;
  return {
    Accept: "application/json",
    "Api-Token": token,
    "X-API-Key": token,
  };
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const t = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(t), Math.sqrt(1 - t));
}

export async function resolveNearestLocationId(base: URL, headers: Record<string, string>, lat: number, lon: number) {
  const url = new URL("/locations/", base);
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`locations ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list) || !list.length) throw new Error("No locations");

  let nearest: any = null;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const item of list) {
    const itemLat = Number(item?.lat);
    const itemLon = Number(item?.lon);
    if (!Number.isFinite(itemLat) || !Number.isFinite(itemLon)) continue;
    const d = haversineKm(lat, lon, itemLat, itemLon);
    if (d < nearestDist) {
      nearest = item;
      nearestDist = d;
    }
  }

  const id = nearest?.pk;
  if (!id) throw new Error("Could not resolve nearest location id");
  return Number(id);
}

export async function fetchPrayerMonth(base: URL, headers: Record<string, string>, locationId: number, year: number, month: number) {
  const url = new URL(`/prayertimes/${encodeURIComponent(String(locationId))}/${year}/${month}/`, base);
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`prayertimes ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error("Invalid prayertimes payload");
  return body;
}

export function normalizeDate(when: string, tz: string) {
  const v = String(when || "today").trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const addDays = v === "tomorrow" ? 1 : 0;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);

  const baseUtc = new Date(Date.UTC(y, m - 1, d));
  baseUtc.setUTCDate(baseUtc.getUTCDate() + addDays);
  return `${baseUtc.getUTCFullYear()}-${String(baseUtc.getUTCMonth() + 1).padStart(2, "0")}-${String(baseUtc.getUTCDate()).padStart(2, "0")}`;
}

export async function fetchLegacyDay(base: URL, headers: Record<string, string>, lat: string, lon: string, tz: string, isoDate: string) {
  const legacy = new URL(base.toString());
  const path = (legacy.pathname || "/").replace(/\/+$/, "");
  if (!path || path === "/") legacy.pathname = "/v1/prayertimes";
  legacy.searchParams.set("lat", lat);
  legacy.searchParams.set("lon", lon);
  legacy.searchParams.set("tz", tz);
  const [y, m, d] = isoDate.split("-");
  legacy.searchParams.set("date", `${d}-${m}-${y}`);

  const res = await fetch(legacy.toString(), { headers });
  if (!res.ok) throw new Error(`legacy ${res.status}`);
  const json = await res.json();
  return mapTimings(json);
}
