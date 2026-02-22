exports.handler = async (event) => {
  const base = (process.env.BONNETID_API_BASE_URL || "https://api.bonnetid.no").replace(/\/$/, "");
  const token = process.env.BONNETID_API_KEY;

  console.log("[bonnetid_locations] hasKey:", Boolean(token), "base:", base);

  if (!token) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Missing BONNETID_API_KEY" }),
    };
  }

  const url = `${base}/locations/`;

  try {
    const r = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Api-Token": token, // <-- MUST be exact
      },
    });

    const text = await r.text();
    return {
      statusCode: r.status,
      headers: {
        "Content-Type": r.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
      body: text,
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: String(e), url }),
    };
  }
};
