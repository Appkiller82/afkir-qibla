const BASE_URL = "https://api.bonnetid.no";

const ALLOWED_PATHS = [
  /^\/locations\/?$/,
  /^\/prayertimes\/\d+\/\d{4}\/\d{1,2}\/?$/,
];

function withTrailingSlash(path) {
  const cleaned = String(path || "").trim();
  if (!cleaned.startsWith("/")) return "";
  return cleaned.endsWith("/") ? cleaned : `${cleaned}/`;
}

function isAllowed(pathname) {
  return ALLOWED_PATHS.some((re) => re.test(pathname));
}

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    Vary: "Origin",
  };
}

export async function handler(event) {
  const origin = event.headers.origin || event.headers.Origin || "*";

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

    const requestedPath = withTrailingSlash(event.queryStringParameters?.path || "");
    if (!requestedPath) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        body: JSON.stringify({ error: "Missing ?path" }),
      };
    }

    if (!isAllowed(requestedPath)) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        body: JSON.stringify({ error: "Path not allowed", path: requestedPath }),
      };
    }

    const upstreamUrl = new URL(requestedPath, BASE_URL);
    const upstream = await fetch(upstreamUrl.toString(), {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "Api-Token": token,
      },
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        body: JSON.stringify({
          error: "Bonnetid redirect received",
          status: upstream.status,
          location: upstream.headers.get("location"),
          path: requestedPath,
        }),
      };
    }

    const body = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        ...corsHeaders(origin),
      },
      body,
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      body: JSON.stringify({ error: error?.message || "Proxy error" }),
    };
  }
}
