
# Afkir Qibla — Push i dvale (serverstyrt cron)

Denne pakken inneholder filene som trengs for å sende push-varsler på bønnetider selv om appen er i dvale.

## Filoversikt
```
netlify/functions/cron-dispatch.ts  -> kaller cron-run hvert minutt (med secret)
netlify/functions/cron-run.ts       -> finner bønnetider og sender push
netlify.toml                        -> aktiverer cron hvert minutt
.env.example                        -> eksempel på miljøvariabler
README.md                           -> denne filen
```

## Miljøvariabler (legg inn i Netlify → Site settings → Environment variables)
```
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=

CRON_SECRET=4g9sK2pM7hQvX9T0dNcLm82RbPqZj1Wy
```

## Deploy
Fra prosjektmappen (der `netlify/` ligger):
```
netlify deploy --prod
```

## Rask test
- Åpne appen på telefon, "Aktiver push".
- Kjør manuelt i nettleser: `/.netlify/functions/cron-run?secret=4g9sK2pM7hQvX9T0dNcLm82RbPqZj1Wy`
- Du skal motta push selv om appen er lukket og i dvale.
