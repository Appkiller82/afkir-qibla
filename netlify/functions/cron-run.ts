// netlify/functions/cron-run.ts
// Manual trigger (invokable via URL) to run the same logic as the scheduled function.
// Useful because scheduled functions cannot be invoked from a URL in production.
import type { Handler } from "@netlify/functions"

export const handler: Handler = async () => {
  // dynamic import of cron-dispatch default export
  const mod: any = await import("./cron-dispatch.ts")
  const resp: Response = await mod.default(new Request("https://local/"))
  const text = await resp.text()
  return { statusCode: 200, body: text }
}
