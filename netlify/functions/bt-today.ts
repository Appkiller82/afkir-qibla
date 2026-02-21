import type { Handler } from "@netlify/functions";

export const handler: Handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};

    // Frontend kan sende "when" (today|tomorrow|YYYY-MM-DD).
    // Vi støtter også "date" for kompatibilitet.
    const lat = (qs as any).lat;
    const lon = (qs as any).lon;
    const tz  = (qs as any).tz;
    const date = (qs as any).when || (qs as any).date || "today";

    if (!lat || !lon || !tz) {
      return { statusCode: 400, body: "Missing lat/lon/tz" };
    }

    const apiKey = process.env.BONNETID_API_KEY || process.env.BONNETID_KEY || "";
    if (!apiKey) {
      return { statusCode: 500, body: "Missing BONNETID_API_KEY env" };
    }

    // Bruk env hvis du har, ellers default:
    const baseUrl = process.env.BONNETID_API_URL || "https://api.bonnetid.no/v1/prayertimes";

    const url = new URL(baseUrl);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("tz", String(tz));
    url.searchParams.set("date", String(date));

    const upstream = await fetch(url.toString(), {
      headers: {
        "X-API-Key": apiKey,
        "x-api-key": apiKey,
        "Authorization": `Bearer ${apiKey}` ,
        "Accept": "application/json",
      },
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return { statusCode: upstream.status, body: text || "Upstream error" };
    }

    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      return { statusCode: 502, body: "Invalid JSON from Bonnetid" };
    }

    // Bonnetid kan ha litt ulik struktur. Vi prøver noen varianter.
    const raw =
      j?.timings ||
      j?.data?.timings ||
      j?.result?.timings ||
      j?.data ||
      j?.result ||
      j;

    // Noen responser kan være liste-form ({ name, time }).
    const t = Array.isArray(raw)
      ? Object.fromEntries(
          raw
            .map((row: any) => {
              const key = String(row?.name || row?.key || row?.label || "").trim();
              const val = String(row?.time || row?.value || row?.val || "").trim();
              return [key, val];
            })
            .filter(([key, val]) => key && val)
        )
      : raw;

    const pick = (...keys: string[]) => {
      for (const k of keys) {
        const v = t?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
      }
      return "";
    };

    // Viktig: RIKTIG mapping fra Bonnetid-tabellen:
    // - Dhuhr skal være "Duhr", ikke "Istiwa"
    // - Asr skal være "Asr" eller "2x-skygge" (fallback til 1x)
    // - Maghrib skal være "Maghrib", ikke "Isha"
    const timings = {
      Fajr: pick("Fajr", "fajr"),
      Sunrise: pick("Soloppgang", "Sunrise", "sunrise", "Shuruq", "shuruq"),

      // Dhuhr: prioriter Duhr (bonnetid) -> Dhuhr (hvis API bruker engelsk)
      Dhuhr: pick("Duhr", "Dhuhr", "dhuhr", "Dhur", "Zuhr", "zuhr"),

      // Asr: prioriter Asr eller 2x-skygge (bonnetid har begge)
      Asr: pick("Asr", "2x-skygge", "asr", "Asr 2x", "1x-skygge", "Asr 1x"),

      Maghrib: pick("Maghrib", "maghrib", "Magrib", "magrib", "Sunset", "sunset"),
      Isha: pick("Isha", "isha"),

      // Ekstra (kan være nyttig, men frontend kan ignorere)
      Istiwa: pick("Istiwa", "istiwa"),
      Asr1x: pick("1x-skygge", "Asr 1x", "asr_1x", "asr1x"),
      Asr2x: pick("2x-skygge", "Asr 2x", "asr_2x", "asr2x"),
      Midnight: pick("Midnatt", "Midnight", "midnight"),
    };

    // Guardrails to avoid bad swaps seen from some payloads.
    // If Dhuhr accidentally equals Istiwa and "Duhr" exists, force Duhr.
    if (timings.Istiwa && timings.Dhuhr && timings.Dhuhr === timings.Istiwa) {
      const duhr = pick("Duhr", "Dhuhr", "dhuhr", "Dhur", "Zuhr", "zuhr");
      if (duhr) timings.Dhuhr = duhr;
    }
    // Keep Asr aligned with 2x-skygge if available.
    if (timings.Asr2x) timings.Asr = timings.Asr2x;

    // En liten sanity-check: hvis Maghrib mangler men Isha finnes,
    // skal vi ikke “gjette” Maghrib = Isha. Da lar vi Maghrib være tom.
    // (Dette hindrer akkurat feilen du fikk.)
    const debug = {
      commitRef: process.env.COMMIT_REF || null,
      selected: {
        DhuhrFrom: timings.Dhuhr === timings.Istiwa ? "istiwa" : "duhr/dhuhr/zuhr",
        AsrFrom: timings.Asr2x && timings.Asr === timings.Asr2x ? "2x-skygge" : "asr",
        MaghribEqualsIsha: !!(timings.Maghrib && timings.Isha && timings.Maghrib === timings.Isha),
      },
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timings, source: "bonnetid", debug }),
    };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "Server error" };
  }
};
