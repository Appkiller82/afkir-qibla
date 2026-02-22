export const handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const locationId = String(qs.location_id || "").trim();
    const year = String(qs.year || "").trim();
    const month = String(qs.month || "").trim();

    if (!locationId || !year || !month) {
      return { statusCode: 400, body: "Missing location_id/year/month" };
    }

    const baseUrl = String(process.env.BONNETID_API_BASE_URL || "").replace(/\/$/, "");
    const apiToken = String(process.env.BONNETID_API_KEY || "").trim();
    if (!baseUrl || !apiToken) {
      return { statusCode: 500, body: "Missing BONNETID_API_BASE_URL or BONNETID_API_KEY" };
    }

    const upstreamUrl = `${baseUrl}/prayertimes/${encodeURIComponent(locationId)}/${encodeURIComponent(year)}/${encodeURIComponent(month)}/`;
    const upstream = await fetch(upstreamUrl, {
      headers: {
        Accept: "application/json",
        "Api-Token": apiToken,
      },
    });

    const body = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
      },
      body,
    };
  } catch (err) {
    return { statusCode: 500, body: err?.message || "Server error" };
  }
};
