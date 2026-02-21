# Qibla Prayer Integration (Bonnetid + Aladhan)

## Hva gjør pakken?
- **Norge:** Bruker **Aladhan med Norge-tuning** (grader + offsets via serverless functions).
- **Utenfor Norge:** **Aladhan global** (standard method).
- Returnerer normaliserte tider: `Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha` (HH:mm).

## Filtre
- `netlify/functions/bonnetid.ts` – sikker proxy til `api.bonnetid.no` (sender `Api-Token` fra env)
- `netlify/functions/aladhan-today.ts` – Aladhan (tuner automatisk for `cc=NO`)
- `frontend/src/prayer.ts` – Frontend hjelper (månedshenting + caching + Norway-routing)
- `netlify.toml` – Redirects til funksjonene

## Miljøvariabler (Netlify)
- `BONNETID_API_TOKEN` (valgfri nå hvis du kun kjører Aladhan-tuning i Norge)
- `BONNETID_API_KEY` (fallback)
- `ALADHAN_API_URL` (f.eks. `https://api.aladhan.com`)
- `ALADHAN_METHOD` (global)
- `ALADHAN_SCHOOL` (global)
- `ALADHAN_LAT_ADJ` (global)
- `ALADHAN_FAJR_ANGLE` (global fallback)
- `ALADHAN_ISHA_ANGLE` (global fallback)
- `ALADHAN_TUNE` (global fallback)

**Norge defaults**
- `ALADHAN_METHOD_NORWAY` (default `99` = custom)
- `ALADHAN_SCHOOL_NORWAY` (default `1` = 2x-skygge / Hanafi)
- `ALADHAN_LAT_ADJ_NORWAY` (default `3`)
- `ALADHAN_FAJR_ANGLE_NORWAY` (default `16`)
- `ALADHAN_ISHA_ANGLE_NORWAY` (default `14`)
- `ALADHAN_MAGHRIB_MINUTES_NORWAY` (default `0`)
- `ALADHAN_TUNE_NORWAY` (default `0,0,5,0,0,0,0,0,0`)

## Frontend bruk
```ts
import { fetchTimings } from "./prayer";

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const timings = await fetchTimings(lat, lon, tz, countryCode, "today");
```

> **countryCode**: send `"NO"` i Norge for Norge-tuning. Ellers landets ISO2, eller tom streng.
