# Qibla Prayer Integration (Bonnetid + Aladhan)

## Hva gjør pakken?
- **Norge:** Bruker **Bonnetid** (via serverless proxy).
- **Utenfor Norge:** **Aladhan global** (standard method).
- Returnerer normaliserte tider: `Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha` (HH:mm).

## Filtre
- `netlify/functions/bonnetid.ts` – sikker proxy til `api.bonnetid.no` (sender `Api-Token` fra env)
- `netlify/functions/aladhan-today.ts` – Aladhan (tuner automatisk for `cc=NO`)
- `frontend/src/prayer.ts` – Frontend hjelper (månedshenting + caching + Norway-routing)
- `netlify.toml` – Redirects til funksjonene

## Miljøvariabler (Netlify)
- `BONNETID_API_TOKEN` (**anbefalt**, token for `Api-Token` header)
- `BONNETID_API_KEY` (støttes som fallback for bakoverkompatibilitet)
- `ALADHAN_API_URL` (f.eks. `https://api.aladhan.com`)
- `ALADHAN_METHOD`
- `ALADHAN_METHOD_NORWAY`
- `ALADHAN_SCHOOL_NORWAY`
- `ALADHAN_LAT_ADJ_NORWAY`
- `ALADHAN_FAJR_ANGLE`
- `ALADHAN_ISHA_ANGLE`

## Frontend bruk
```ts
import { fetchTimings } from "./prayer";

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const timings = await fetchTimings(lat, lon, tz, countryCode, "today");
```

> **countryCode**: send `"NO"` i Norge for Bonnetid. Ellers landets ISO2, eller tom streng.
