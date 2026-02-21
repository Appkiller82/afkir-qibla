import type { Handler } from "@netlify/functions";
import { authHeaders, resolveBonnetidRoot } from "./bonnetid-client";

export const handler: Handler = async () => {
  try {
    const headers = authHeaders();
    if (!headers) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: false, reason: "missing_api_token_or_key" }),
      };
    }

    const base = resolveBonnetidRoot();
    const locationsUrl = new URL("/locations/", base);
    const upstream = await fetch(locationsUrl.toString(), { headers });
    const text = await upstream.text();

    return {
      statusCode: upstream.ok ? 200 : 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: upstream.ok,
        status: upstream.status,
        endpoint: `${locationsUrl.origin}${locationsUrl.pathname}`,
        sample: text.slice(0, 180),
      }),
    };
  } catch (e: any) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, reason: e?.message || "unknown_error" }),
    };
  }
};
