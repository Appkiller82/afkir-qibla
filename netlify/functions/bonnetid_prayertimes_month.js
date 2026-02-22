exports.handler = async (event) => {
  const base = (process.env.BONNETID_API_BASE_URL || "https://api.bonnetid.no").replace(/\/$/, "");
  const token = process.env.BONNETID_API_KEY;

  console.log("[bonnetid] hasKey", Boolean(process.env.BONNETID_API_KEY));
  console.log("[bonnetid] base", base);

  if (!token) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Missing BONNETID_API_KEY" }),
    };
  }

  const locationId = event?.queryStringParameters?.location_id;
  const year = event?.queryStringParameters?.year;
  const month = event?.queryStringParameters?.month;

  if (!locationId || !year || !month) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Missing required query params: location_id, year, month" }),
    };
  }

  const url = `${base}/prayertimes/${locationId}/${year}/${month}/`;
  const r = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Api-Token": token,
    },
  });

  const body = await r.text();
  return {
    statusCode: r.status,
    headers: {
      "content-type": r.headers.get("content-type") || "application/json",
      "cache-control": "no-store",
    },
    body,
  };
};
