# Qibla Prayer Integration (Bonnetid + Aladhan)

## Hva gjør pakken?
- **Norge:** Bruker **Bonnetid** (via serverless proxy/endepunkter).
- **Utenfor Norge:** **Aladhan global** (standard method).
- Returnerer normaliserte tider: `Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha` (HH:mm).

## Filtre
- `netlify/functions/bonnetid.ts` – sikker proxy til `api.bonnetid.no` (sender `Api-Token` fra env)
- `netlify/functions/aladhan-today.ts` – Aladhan (tuner automatisk for `cc=NO`)
- `frontend/src/prayer.ts` – Frontend hjelper (månedshenting + caching + Norway-routing)
- `netlify.toml` – Redirects til funksjonene

## Miljøvariabler (Netlify)
- `BONNETID_API_TOKEN` (**anbefalt**, token for Bonnetid)
- `BONNETID_API_KEY` (fallback)
- `ALADHAN_API_URL` (f.eks. `https://api.aladhan.com`)
- `ALADHAN_METHOD` (global)
- `ALADHAN_SCHOOL` (global)
- `ALADHAN_LAT_ADJ` (global)
- `ALADHAN_FAJR_ANGLE` (global fallback)
- `ALADHAN_ISHA_ANGLE` (global fallback)
- `ALADHAN_TUNE` (global fallback)

**Valgfri Norge-tuning for Aladhan-endepunkter**
- `ALADHAN_METHOD_NORWAY`
- `ALADHAN_SCHOOL_NORWAY`
- `ALADHAN_LAT_ADJ_NORWAY`
- `ALADHAN_FAJR_ANGLE_NORWAY`
- `ALADHAN_ISHA_ANGLE_NORWAY`
- `ALADHAN_MAGHRIB_MINUTES_NORWAY`
- `ALADHAN_TUNE_NORWAY`

## Frontend bruk
```ts
import { fetchTimings } from "./prayer";

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const timings = await fetchTimings(lat, lon, tz, countryCode, "today");
```

> **countryCode**: send `"NO"` i Norge for Bonnetid-ruting. Ellers landets ISO2, eller tom streng.
