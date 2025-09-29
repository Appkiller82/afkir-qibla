import type { Handler } from "@netlify/functions";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  try {
    const qs = new URLSearchParams(event.rawQuery || "");
    const lat = qs.get("lat");
    const lng = qs.get("lng") || qs.get("lon");
    const tz  = qs.get("tz") || "Europe/Oslo";
    const when = (qs.get("when") || "today").toLowerCase(); // today|tomorrow|date=YYYY-MM-DD

    if (!lat || !lng) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "lat & lng required" }) };
    }

    const base = process.env.BONNETID_API_URL || "https://api.bonnetid.no/v1/times";
    // base should be /v1/times (WITHOUT /today). We append /{when} here:
    const url = `${base}/${when}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&tz=${encodeURIComponent(tz)}`;

    const apiKey = process.env.VITE_BONNETID_API_KEY || process.env.BONNETID_API_KEY;
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
      },
    });

    const text = await res.text();
    return {
      statusCode: res.status,
      headers: { "Content-Type": "application/json", ...cors },
      body: text,
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: err?.message || "bt-today failed" }),
    };
  }
};
