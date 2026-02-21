# Qibla Prayer Integration (AlAdhan only)

## Hva gjør pakken?
- Bruker **kun AlAdhan** for alle bønnetider.
- Henter både **dagens tider** og **månedskalender** via AlAdhan-endepunkter.
- Returnerer normaliserte tider: `Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha` (`HH:mm`).

## Viktige filer
- `netlify/functions/aladhan-today.ts` – AlAdhan dag-endepunkt (proxy)
- `netlify/functions/aladhan-month.ts` – AlAdhan måned-endepunkt (proxy)
- `frontend/src/prayer.ts` – Frontend fetch/normalisering (AlAdhan only)
- `netlify.toml` + `frontend/public/_redirects` – kun AlAdhan-ruter

## Miljøvariabler (Netlify)
- `ALADHAN_METHOD` (valgfri, brukes likt for dag + måned)

Ingen Bonnetid-variabler trengs.

## Frontend bruk
```ts
import { fetchTimings, fetchMonthTimings } from "./prayer";

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const day = await fetchTimings(lat, lon, tz, null, "today");
const month = await fetchMonthTimings(lat, lon, 2, 2026, tz, null);
```
