# Netlify scheduled cron — make it log every minute

## What you will add
- `netlify/functions/cron-ping.ts`: a tiny scheduled function that logs once per minute.
- `frontend/src/_deploy_bump.txt`: a tiny file to force Netlify to rebuild & re-register schedules.

## Steps
1) Copy both files into your repo at the exact paths shown above.
2) Commit & push:
   - Windows PowerShell:
     git add netlify/functions/cron-ping.ts frontend/src/_deploy_bump.txt
     git commit -m "chore(cron): add cron-ping scheduled logger + rebuild bump"
     git push origin main
3) In Netlify UI: Deploys → **Clear cache and deploy site** (important to re-register schedules).
4) Verify logs:
   - Netlify → Functions → **cron-ping** → Logs
   - You should see one line **every minute** (UTC), e.g. `[cron-ping] tick 2025-08-22T07:01:00.123Z ...`

## If you don't see a tick every minute
- Ensure this is a production deploy of your primary branch (e.g. `main`) and it is **Published**.
- Confirm your `netlify.toml` points to the correct folders:
  [build]
    base = "frontend"
    publish = "frontend/dist"
    command = "npm run build"
  [functions]
    directory = "netlify/functions"
    node_bundler = "esbuild"
  [[plugins]]
    package = "@netlify/plugin-functions-install-core"
- Make a tiny edit (e.g. change a space in `_deploy_bump.txt`) and redeploy with **Clear cache and deploy site**.
- Check the build logs for "Packaging Functions" and that `cron-ping.ts` is listed.
- Scheduled functions run in UTC. Don't confuse local time with UTC when reading timestamps.

## Next: bring your main cron back
- Once `cron-ping` is ticking, your main `cron-dispatch.ts` (with `export const config = { schedule: "* * * * *" }`)
  should also run every minute.
- If `cron-dispatch` still doesn't log, compare its handler signature to `cron-ping`:
    * must export `handler: Handler` (return `{ statusCode, body }`),
    * must compile without errors (watch bundling step in build logs).
