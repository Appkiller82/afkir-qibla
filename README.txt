# Make Netlify log a cron every minute (definitive)

## Files included
- netlify/functions/cron-heartbeat.ts  ← scheduled function (new name, 1/min)
- frontend/src/_deploy_bump.txt        ← tiny file to force full rebuild

## Steps (do exactly these)
1) Copy both files into your repo with the same paths.
2) Commit & push:
     git add netlify/functions/cron-heartbeat.ts frontend/src/_deploy_bump.txt
     git commit -m "chore(cron): add cron-heartbeat scheduled logger + rebuild bump"
     git push origin main

3) In Netlify UI:
     Deploys → **Clear cache and deploy site**
     Wait until the deploy is **Published** (not Draft/Preview).

4) Verify scheduler:
     Netlify → Functions → **cron-heartbeat** → Logs
     You should see one line **every minute (UTC)**:
       [cron-heartbeat] tick 2025-08-22T07:01:00.123Z method= POST ...

   If you DO NOT see it:
     - Confirm the build log shows “Packaging Functions” and lists cron-heartbeat.ts.
     - Confirm your netlify.toml points to:
         [build]
           base = "frontend"
           publish = "frontend/dist"
           command = "npm run build"
         [functions]
           directory = "netlify/functions"
           node_bundler = "esbuild"
         [[plugins]]
           package = "@netlify/plugin-functions-install-core"
     - Make a tiny edit to _deploy_bump.txt and repeat **Clear cache and deploy site**.
     - Ensure you are checking the **Production** deploy, not a preview.
     - Check Site settings → Functions → Scheduled functions: cron-heartbeat should be listed.

5) Bring back your own cron after heartbeat ticks
     - Ensure your cron-dispatch.ts has:
         export const config = { schedule: "* * * * *" }
         export const handler: Handler = async (event) => ({ statusCode: 200, body: "..." })
     - Do a small commit and again use **Clear cache and deploy site** to re-register.
