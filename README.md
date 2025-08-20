# Afkir Push – endelige filer

Disse tre filene løser 400-feilen og aktiverer auto-metadata for push:

- `netlify/functions/subscribe.ts` – tolerant versjon.
  - Returnerer 200 OK uten Upstash/metadata (ingen planlagte varsler).
  - Hvis `UPSTASH_*` og meta er satt, lagrer i Redis for planlagte varsler.
- `frontend/src/PushControlsAuto.jsx` – knappen som sender lat/lng/country/tz.
- `frontend/src/App.jsx` – oppdatert til å bruke `PushControlsAuto` og fjernet manglende bakgrunnsbilde.

## Bruk
1. Pakk ut over eksisterende filer (behold mappestrukturen).
2. Sjekk env: `/.netlify/functions/debug-env` → alle VAPID true.
3. I appen: Bruk stedstjenester → **Aktiver push (auto)** → **Send test**.

Når du senere legger inn Upstash‑nøkler, vil planlagte bønnevarsler begynne å gå uten nye kodeendringer.
