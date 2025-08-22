// netlify/functions/cron-run.ts
// Safe version: does NOT modify your send-test.ts contract.
// It only calls it with a pushSubId if provided via env (CRON_TEST_PUSH_SUB_ID).

export default async (req: Request): Promise<Response> => {
  const now = new Date().toISOString();
  const urlObj = new URL(req.url);
  const secret = urlObj.searchParams.get("secret");
  const expected = process.env.CRON_SECRET || "";

  if (expected && secret !== expected) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  console.log("[cron] tick", now);

  const base = process.env.URL || process.env.DEPLOY_URL;

  // Read one or many IDs from env to avoid touching your send-test.ts
  // Example: CRON_TEST_PUSH_SUB_ID="sub1"  or  "sub1,sub2,sub3"
  const idsEnv = process.env.CRON_TEST_PUSH_SUB_ID || "";
  const ids = idsEnv.split(",").map(s => s.trim()).filter(Boolean);

  // If no ID provided, we call send-test without body just to log the explicit 400,
  // but we return a helpful hint so you know how to wire it.
  if (ids.length === 0) {
    const res = await fetch(`${base}/.netlify/functions/send-test`, { method: "POST" });
    const text = await res.text();
    console.log("[cron] send-test (no body) status:", res.status, text.slice(0, 200));
    return json({
      ok: true,
      mode: "noop",
      now,
      called: "/.netlify/functions/send-test",
      status: res.status,
      note: "Set env CRON_TEST_PUSH_SUB_ID to a known pushSubId to let cron-run call your send-test.ts correctly."
    });
  }

  // Call your send-test.ts once per ID
  const results: any[] = [];
  for (const id of ids) {
    try {
      const r = await fetch(`${base}/.netlify/functions/send-test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pushSubId: id, reason: "cron", now }),
      });
      const preview = await r.text();
      console.log("[cron] send-test", id, r.status, preview.slice(0, 200));
      results.push({ id, status: r.status, preview: preview.slice(0, 120) });
    } catch (e: any) {
      console.error("[cron] send-test error", id, e);
      results.push({ id, error: String(e) });
    }
  }

  return json({ ok: true, mode: "ids", now, called: "/.netlify/functions/send-test", results });
};

const json = (obj: any, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
