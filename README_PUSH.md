# AfkirQibla – Push Pack

Filer i denne pakken:
- `netlify.toml` – ruter /api/* til Netlify Functions
- `public/manifest.webmanifest` – PWA manifest
- `public/sw.js` – Service Worker for push
- `public/icons/icon-192.png`, `public/icons/icon-512.png` – PWA ikoner (plassholdere)
- `src/push.js` – Frontend-hjelpere for subscribe/unsubscribe/test
- `src/PushControls.jsx` – Ferdig UI-komponent du kan plassere i appen
- `netlify/functions/*` – Subscribe/Unsubscribe/Send-test og planlagt `send-prayer-pushes` (cron hvert minutt)
- `.env.example` – legg inn `VITE_VAPID_PUBLIC_KEY`
- `scripts/setup-push.sh` / `scripts/setup-push.ps1` – installer avhengigheter

Se hovedinstruks i chatten.
