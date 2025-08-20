# Cron bundle
Filer for planlagte bønnevarsler:

- `netlify/functions/cron-dispatch.ts` – kjører hvert minutt og sender push ved bønnetid.
- `netlify.toml` – aktiverer Netlify Scheduled Function.

## Miljøvariabler (server)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

## Steg
1. Legg filene inn i repoet (behold sti/filnavn).
2. Sett miljøvariabler i Netlify → Site settings → Environment.
3. Deploy.
4. Verifiser at `cron-dispatch` kjører (Netlify Functions logs).
