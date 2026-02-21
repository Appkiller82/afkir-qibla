import type { Handler } from "@netlify/functions";

const BASE = "https://api.bonnetid.no";

function corsHeaders(origin?: string) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    Vary: "Origin",
  };
}

export const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || "";
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(origin), body: "" };
  }

  try {
    const token = process.env.BONNETID_API_TOKEN || process.env.BONNETID_API_KEY || "";
    if (!token) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        body: JSON.stringify({ error: "Missing BONNETID_API_TOKEN/BONNETID_API_KEY" }),
      };
    }

    const rawPath = String(event.queryStringParameters?.path || "").trim();
    if (!rawPath || !rawPath.startsWith("/")) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        body: JSON.stringify({ error: "Missing or invalid ?path=/..." }),
      };
    }

    const url = new URL(rawPath, BASE);
    // Safety: prevent forwarding to non-whitelisted host in case of malformed input.
    if (url.origin !== BASE) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        body: JSON.stringify({ error: "Invalid path host" }),
      };
    }

    const upstream = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Api-Token": token,
        "X-API-Key": token,
        Authorization: `Bearer ${token}`,
      },
    });

    const text = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        ...corsHeaders(origin),
      },
      body: text,
    };
  } catch (e: any) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      body: JSON.stringify({ error: e?.message || "Server error" }),
    };
  }
};
