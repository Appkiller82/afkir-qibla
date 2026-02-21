# Qibla Prayer Integration (Bonnetid + Aladhan)

## Hva gjør pakken?
- **Norge:** Prøver først **Bonnetid**. Hvis det feiler → **Aladhan med Norway‑tuning**.
- **Utenfor Norge:** **Aladhan global** (standard method).
- Returnerer normaliserte tider: `Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha` (HH:mm).

## Filtre
- `netlify/functions/bt-today.ts` – Bonnetid
- `netlify/functions/aladhan-today.ts` – Aladhan (tuner automatisk for `cc=NO`)
- `frontend/src/prayer.ts` – Frontend hjelper
- `netlify.toml` – Redirects til funksjonene

## Miljøvariabler (Netlify)
- `BONNETID_API_URL` (f.eks. `https://api.bonnetid.no` eller full sti; appen normaliserer til `/v1/prayertimes` hvis sti mangler)
- `BONNETID_API_KEY` (**din nøkkel**)
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

> **countryCode**: send `"NO"` i Norge for Bonnetid→tuned fallback. Ellers landets ISO2, eller tom streng.