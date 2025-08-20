# PushControlsAuto – tillegg

Denne pakken inneholder en alternativ komponent som **automatisk** registrerer push med posisjon/metadata, slik at backend kan planlegge bønnevarsler (cron).

## Filer
- `frontend/src/PushControlsAuto.jsx` — ny komponent.
- `frontend/src/App.withPushAuto.jsx` — kun en liten “how-to” for bytte.

## Bruk
1. Importér komponenten i `App.jsx`:
   ```jsx
   import PushControlsAuto from './PushControlsAuto.jsx';
   ```

2. Der du i dag har push-kortet:
   ```jsx
   <section className="card">
     <h3>Push-varsler</h3>
     <div className="hint" style={{marginBottom:8}}>Aktiver push for å få varsler om bønnetider på denne enheten.</div>
     <PushControlsAuto
       coords={coords}
       city={city}
       countryCode={countryCode}
       tz={Intl.DateTimeFormat().resolvedOptions().timeZone}
     />
   </section>
   ```

3. Sørg for at du allerede har lagt inn miljøvariabler og at `subscribe.ts`/`cron-dispatch.ts` fra hovedpakken er deployet.

Du kan beholde **begge** variantene (gammel `PushControls` og nye `PushControlsAuto`) parallelt for testing.
