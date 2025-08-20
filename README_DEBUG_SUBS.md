# Debug-subs
Netlify Function for å inspisere lagrede push-abonnement i Upstash.

## Bruk
- List første 50:
  - `/.netlify/functions/debug-subs`
- Med limit:
  - `/.netlify/functions/debug-subs?limit=10`
- Detaljer for ett abonnement (id fra localStorage `pushSubId`):
  - `/.netlify/functions/debug-subs?id=<id>`
- Eller med endpoint (url-encoded):
  - `/.netlify/functions/debug-subs?endpoint=<urlencoded-endpoint>`

## Miljøvariabler
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

Returnerer JSON og håndterer miljøer uten Upstash.
