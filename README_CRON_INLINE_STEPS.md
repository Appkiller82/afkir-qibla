# Cron inline bundle

Files to make your scheduled function run:
- netlify/functions/cron-dispatch.ts (inline schedule + logs)
- netlify/functions/package.json (web-push dep)
- netlify.toml (Node 20, functions dir, esbuild, plugin to install deps)

## Steps (PowerShell)
1) Extract this zip at the repo root (overwrite when asked).
2) Commit & deploy:
   git add netlify/functions/cron-dispatch.ts netlify/functions/package.json netlify.toml
   git commit -m "cron-dispatch: inline schedule + logs; install deps via plugin"
   git push origin main
   # Then in Netlify: Clear cache and deploy site
3) Verify: Functions → Scheduled should show cron-dispatch,
   and logs should print “[cron] tick …” once a minute.
