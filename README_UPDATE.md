# Afkir Qibla 7 – Restore UI + Always-on Push
Dette bundle gjeninnfører hele UI-opplevelsen (kompass, kart, bakgrunner, tema, samme bønnetider/nedtelling, Adhan PÅ/AV + test), og legger kun til:
- auto-modal for posisjon
- automatisk geolocation-watch når tillatelse er gitt
- automatisk oppdatering av push-metadata (samme abonnement, riktig by)

## Filer
- `frontend/src/App.jsx` – komplett (RESTORED + ny auto-funksjonalitet)
- `frontend/src/AutoLocationModal.jsx` – popup for posisjon
- `frontend/src/push.ts` – inkluderer `updateMetaIfSubscribed(...)`
- `netlify/functions/subscribe.ts` – tolerant auto-upsert (løser 500 uten Upstash)

## Viktig
- Advarselen i konsollen: `<meta name="apple-mobile-web-app-capable" content="yes"> is deprecated`  
  → Legg også til denne i `public/index.html` (behold gjerne den gamle for bakoverkomp):
  ```html
  <meta name="mobile-web-app-capable" content="yes">
  ```

## Deploy
```bash
git add frontend/src/App.jsx frontend/src/AutoLocationModal.jsx frontend/src/push.ts netlify/functions/subscribe.ts
git commit -m "Restore UI + auto location + always-on push metadata; tolerant subscribe"
git push origin main
```
