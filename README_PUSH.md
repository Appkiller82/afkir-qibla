# Afkir Qibla – Push bundle

Dette er en minimal pakke for å:

1) Aktivere push-varsler (Aktiver → Send test)
2) Kjøre planlagte bønnevarsler uten Netlify Blobs (Upstash Redis + Scheduled Functions)
3) Bruke IRN-lignende profil i Norge og AlAdhan globalt

## Filstruktur

- `netlify/functions/debug-env.js` – Sjekk at env-variabler er satt (returnerer booleans).
- `netlify/functions/send-test.ts` – Sender en enkel test-push til gjeldende subscription.
- `netlify/functions/subscribe.ts` – Lagrer abonnement + metadata i Upstash og beregner neste bønnetid.
- `netlify/functions/cron-dispatch.ts` – Cron (hver minutt) som sender varsel ved bønnetid og planlegger neste.
- `frontend/src/push.ts` – Hjelpefunksjoner for å aktivere push og sende test.
- `frontend/src/PushControls.jsx` – Enkel UI-komponent for Aktiver/Send test.
- `public/service-worker.js` – Viser push-varsel og håndterer klikk.
- `netlify.toml` – Slår på esbuild og cron hvert minutt.
- `.env.example` – Mal for miljøvariabler.

## Miljøvariabler

### På Netlify (Server)
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (f.eks. `mailto:you@example.com`)
- `UPSTASH_REDIS_REST_URL` (for planlagte varsler)
- `UPSTASH_REDIS_REST_TOKEN` (for planlagte varsler)

### På Netlify (Frontend/Vite)
- `VITE_VAPID_PUBLIC_KEY` (samme public VAPID-key som over)

Bekreft ved å åpne `/.netlify/functions/debug-env` – alle skal være `true` (unntatt Upstash hvis du ikke bruker planlagt push enda).

## Integrasjon

1. Kopiér `public/service-worker.js` til prosjektets public-root (eller justér register-sti i `main.jsx`).
2. Importer `PushControls.jsx` et passende sted (du har allerede gjort det i App.jsx).
3. Legg inn env-variabler i Netlify → Site settings → Environment.
4. Deploy.

## Planlagte bønne-varsler

- `subscribe.ts` beregner neste bønnetid basert på lat/lng:
  - Norge: method=99 + IRN-offsets
  - Utenfor Norge: method=5 (Egyptian)
- `cron-dispatch.ts` kjører hvert minutt (se `netlify.toml`) og sender push når `now ≈ nextAt`.

For best presisjon bør klienten sende metadata med `registerWithMetadata({ lat, lng, city, countryCode, tz })` etter at lokasjon og reverse geocode er kjent.

Lykke til! 🚀
