export const handler = async () => {
  try {
    const baseUrl = String(process.env.BONNETID_API_BASE_URL || "").replace(/\/$/, "");
    const apiToken = String(process.env.BONNETID_API_KEY || "").trim();
    if (!baseUrl || !apiToken) {
      return { statusCode: 500, body: "Missing BONNETID_API_BASE_URL or BONNETID_API_KEY" };
    }

    const upstream = await fetch(`${baseUrl}/locations/`, {
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
