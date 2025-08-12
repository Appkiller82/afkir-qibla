# Afkir Qibla – monorepo (PWA + push-server)

## Struktur
- `frontend/` – Vite + React PWA (installerbar som app)
- `server/` – Node push-server (Web Push) med cron-jobb

### Rask oppsett
- Deploy `server/` på Render/Railway/VPS (sett VAPID-nøkler)
- Deploy `frontend/` på Netlify/Vercel med `VITE_PUSH_SERVER_URL`

Se detaljert oppskrift i chatten vår (jeg kan guide steg-for-steg).
