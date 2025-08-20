# scripts/windows/fix-deploy.ps1
# 1) Remove old subscribe.js if exists (can shadow subscribe.ts)
if (Test-Path "..\..\netlify\functions\subscribe.js") { git rm -f ..\..\netlify\functions\subscribe.js }

# 2) Install function dependencies in the build base (frontend)
Push-Location ..\..\frontend
npm i web-push @netlify/functions
Pop-Location

# 3) Add & commit
git add -A
git commit -m "Deploy fix: netlify.toml, tolerant subscribe, cron, web-push"
git push origin main
