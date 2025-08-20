# Subscribe super-tolerant fix
Drop-in erstatning for 500-feil når Upstash ikke er satt.

## Legg filen her
netlify/functions/subscribe.ts

## Hvorfor?
Tidligere implementasjon kastet 500 hvis UPSTASH_* manglet. Denne returnerer alltid 200 (unntatt ved ugyldig JSON/manglende endpoint).

## Etterpå
1) Slett evt. gammel `subscribe.js` som kan skygge for TS-filen:
   git rm netlify/functions/subscribe.js || true
2) (Anbefalt) netlify.toml:
   [functions]
     node_bundler = "esbuild"
3) Commit & deploy:
   git add netlify/functions/subscribe.ts netlify.toml
   git commit -m "subscribe: super-tolerant (no 500 without Upstash)"
   git push origin main
4) Test i konsollen:
   fetch('/.netlify/functions/subscribe', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({subscription:{endpoint:'x',keys:{}}, meta:{}})}).then(r=>r.text()).then(console.log)
