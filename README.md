# Qibla Prayer Integration (IRN i Norge)

## Hva gjør pakken?
- Bruker **IRN / bonnetid.no** i norske kommuner, og AlAdhan utenfor Norge.
- Kartverkets kommuneoppslag kobler koordinater til IRNs `district_code`. Ingen gjetting basert på nærmeste by.
- Dagens tider, nedtelling, Adhan i åpen app og månedskalender bruker samme tabell. IRNs tider får ingen lokale minuttjusteringer.
- Ved API-feil vises bare lagrede tider for samme dato og posisjon, tydelig merket. Ingen skjult overgang til beregnede tider i Norge.
- Returnerer normaliserte tider: `Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha` (`HH:mm`).

## Viktige filer
- `netlify/functions/aladhan-today.ts` – AlAdhan dag-endepunkt (proxy)
- `netlify/functions/aladhan-month.ts` – AlAdhan måned-endepunkt (proxy)
- `netlify/functions/irn-month.ts` – server-endepunkt med validering og trygge feilmeldinger
- `netlify/functions/lib/irn.ts` – kommuneoppslag, IRN-kall og tidsbegrenset servercache
- `frontend/src/prayer.ts` – velger IRN eller AlAdhan, uten API-nøkkel i nettleseren
- `netlify.toml` – API-ruter

## Miljøvariabler (Netlify)
- `ALADHAN_METHOD` (valgfri, brukes likt for dag + måned)
- `IRN_API_KEY` (påkrevd, Functions-scope i Production). Ikke bruk `VITE_`-prefiks, og ikke legg nøkkelen i GitHub.
- En ny deploy kreves etter endringer i Netlify-miljøvariabler.

IRN må ha en komplett månedstabell og en entydig kommuneoppføring. Manglende dekning eller API-feil meldes eksplisitt. Serveren kontrollerer hele måneden, inkludert datoer og alle seks tider.

Tester: `npm --prefix frontend test`. Med `IRN_API_KEY` midlertidig i prosessmiljøet kjøres også en ekte integrasjonstest mot Kartverket og fem IRN-byer. `npm --prefix frontend run build` bygger klienten.

Push-infrastrukturen er uendret av denne integrasjonen. Den eksisterende `cron-run` er en testutsender, ikke en full planlegger for bønnevarsler.

## Frontend bruk
```ts
import { fetchTimings, fetchMonthTimings } from "./prayer";

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const day = await fetchTimings(lat, lon, tz, null, "today");
const month = await fetchMonthTimings(lat, lon, 2, 2026, tz, null);
```

