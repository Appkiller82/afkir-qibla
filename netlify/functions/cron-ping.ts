import type { Handler, Config } from "@netlify/functions";

// Minimal scheduled function to confirm Netlify's scheduler ticks every minute (UTC).
export const config: Config = { schedule: "* * * * *" };

export const handler: Handler = async (event) => {
  const now = new Date().toISOString();
  console.log("[cron-ping] tick", now, "method=", event.httpMethod);
  return { statusCode: 200, body: `cron-ping ok ${now}` };
};
