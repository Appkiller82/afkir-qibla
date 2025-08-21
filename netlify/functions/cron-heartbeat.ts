import type { Handler, Config } from "@netlify/functions";

// NEW name to force schedule re-registration
export const config: Config = { schedule: "* * * * *" }; // every minute (UTC)

export const handler: Handler = async (event) => {
  const now = new Date().toISOString();
  console.log("[cron-heartbeat] tick", now, "method=", event.httpMethod, "path=", event.path);
  return { statusCode: 200, body: `cron-heartbeat ok ${now}` };
};
