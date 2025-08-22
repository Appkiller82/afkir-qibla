// netlify/functions/cron-dispatch.ts
export const config = {
  schedule: "* * * * *",
};

export default async () => {
  const startedAt = new Date().toISOString();

  const base = process.env.URL || process.env.DEPLOY_URL;
  const secret = process.env.CRON_SECRET || "";
  const url = `${base}/.netlify/functions/cron-run${secret ? `?secret=${encodeURIComponent(secret)}` : ""}`;

  let resText = "";
  let status = 0;

  try {
    const res = await fetch(url, { method: "POST" });
    status = res.status;
    resText = await res.text();
    console.log("[cron-dispatch] -> cron-run", status, resText.slice(0, 200));
  } catch (err) {
    console.error("[cron-dispatch] fetch error", err);
    status = 500;
    resText = String(err);
  }

  return new Response(
    JSON.stringify({ ok: true, startedAt, called: url, status, preview: resText.slice(0, 200) }),
    { headers: { "content-type": "application/json" } }
  );
};
