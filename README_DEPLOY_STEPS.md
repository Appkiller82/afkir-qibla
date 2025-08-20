# Afkir Qibla 7 – Deploy Fix Bundle

Dette er en "drop-in" pakke for å få Netlify-deploy grønn, og fjerne 500 på "Aktiver push".

## Innhold
- `netlify.toml` – peker Netlify til `frontend`, publiserer `dist`, og binder funksjoner + cron.
- `netlify/functions/subscribe.ts` – **super-tolerant** (200 selv uten Upstash).
- `netlify/functions/cron-dispatch.ts` – cron som sender push ved bønnetid (krever Upstash + VAPID).
- `frontend/public/icons/kaaba_3d.svg` – ikon brukt i kompasset.
- `frontend/public/backgrounds/*.jpg` – små plassholdere for å unngå 404.
- `frontend/src/mobileWebAppCapable.js` – valgfri runtime-fiks for iOS-metatag (hvis du ikke vil redigere index.html).
- `scripts/windows/fix-deploy.ps1` – PowerShell-hjelper (Windows).

## Steg-for-steg (Windows PowerShell)

1) **Pakk ut** zip'en i repo-roten (slik at filene havner på nøyaktig stier som over).

2) **Fjern eventuelt gammel JS som kan skygge TS**
```powershell
if (Test-Path "netlify/functions/subscribe.js") { git rm -f netlify/functions/subscribe.js }
```

3) **Installer nødvendige pakker i frontend** (fordi `base=frontend`):
```powershell
cd frontend
npm i web-push @netlify/functions
cd ..
```

4) **Commit og push**
```powershell
git add -A
git commit -m "Deploy fix: netlify.toml + tolerant subscribe + cron + web-push + assets"
git push origin main
```

5) **Deploy** (Netlify vil nå bygge fra `frontend`, bundle funksjonene med esbuild og publisere `dist`).

6) **(Valgfritt) iOS meta-advarsel**
- Enten legg til i `frontend/index.html` i `<head>`:
  ```html
  <meta name="mobile-web-app-capable" content="yes">
  ```
- Eller importer og kall runtime-fiks i `App.jsx`:
  ```js
  import { ensureMobileWebAppCapable } from "./mobileWebAppCapable";
  useEffect(() => { ensureMobileWebAppCapable(); }, []);
  ```

## Etter deploy

- **Aktiver push**: skal få 200 selv uten Upstash (du vil se en `note` i svaret).
- **Send test**: fungerer umiddelbart.
- **Bakgrunnsbilder**: plassholdere vises (bytt ut med dine ekte bilder når du vil).
- **Planlagte push (cron)**: krever at du setter miljøvariabler i Netlify:
  - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
  - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`

Når disse er på plass, vil `cron-dispatch` sende push ved bønnetid – også i bakgrunnen på iPhone (PWA på Hjem-skjerm, varsler tillatt).
