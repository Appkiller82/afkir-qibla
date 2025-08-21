// netlify/functions/cron-run.ts
type TryTarget = {
  path: string;
  requiresBody?: boolean;
};

export const config = { /* no schedule here if cron-dispatch has it */ };

export default async (req: Request): Promise<Response> => {
  const now = new Date().toISOString();
  const urlObj = new URL(req.url);
  const secret = urlObj.searchParams.get("secret");
  const expected = process.env.CRON_SECRET || "";

  if (expected && secret !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
  }

  console.log("[cron] tick", now);

  const base = process.env.URL || process.env.DEPLOY_URL;
  // Try multiple known function names to avoid 404s depending on your file names
  const targets: TryTarget[] = [
    { path: "/.netlify/functions/send-test", requiresBody: true },
    { path: "/.netlify/functions/push", requiresBody: true },
    { path: "/.netlify/functions/send-push", requiresBody: true },
    { path: "/.netlify/functions/notify" },
    { path: "/.netlify/functions/notifications" },
    { path: "/.netlify/functions/sendNotifications", requiresBody: true },
  ];

  const body = JSON.stringify({
    source: "cron",
    reason: "prayer-window",
    now,
  });

  let lastStatus = 0;
  let lastText = "";
  let called: string | null = null;

  for (const t of targets) {
    const url = `${base}${t.path}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: t.requiresBody ? { "content-type": "application/json" } : undefined,
        body: t.requiresBody ? body : undefined,
      });
      lastStatus = res.status;
      lastText = await res.text();
      called = t.path;
      console.log("[cron] push try:", t.path, lastStatus, lastText.slice(0, 200));

      if (res.status !== 404) {
        // Stop on first non-404 (either 200/202/400/500 etc.). 404 means function not found; keep trying.
        break;
      }
    } catch (e) {
      lastStatus = 500;
      lastText = String(e);
      called = t.path;
      console.error("[cron] push fetch error:", t.path, e);
      break;
    }
  }

  return new Response(
    JSON.stringify({ ok: true, now, called, status: lastStatus, preview: lastText.slice(0, 200) }),
    { headers: { "content-type": "application/json" } }
  );
};
