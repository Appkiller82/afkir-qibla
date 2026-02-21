# Qibla Prayer Integration (Bonnetid + Aladhan)

## Hva gjør pakken?
- **Norge:** Prøver først **Bonnetid**. Hvis det feiler → **Aladhan med Norway‑tuning**.
- **Utenfor Norge:** **Aladhan global** (standard method/innstillinger fra env).
- Returnerer normaliserte tider: `Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha` (HH:mm).

## Filtre
- `netlify/functions/bt-today.ts` – Bonnetid
- `netlify/functions/aladhan-today.ts` – Aladhan (tuner automatisk for `cc=NO`)
- `frontend/src/prayer.ts` – Frontend hjelper
- `netlify.toml` – Redirects til funksjonene

## Miljøvariabler (Netlify)
- `BONNETID_API_URL` (f.eks. `https://api.bonnetid.no`)
- `BONNETID_API_KEY` (**din nøkkel**, anbefalt)
- `BONNETID_KEY` (valgfri fallback env-variabel)
- `ALADHAN_API_URL` (f.eks. `https://api.aladhan.com`)
- `ALADHAN_METHOD`
- `ALADHAN_SCHOOL` (f.eks. `1` = Shafi, `2` = Hanafi)
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

> Merk: I Norge-fallback (`cc=NO`) settes `school=2` (Hanafi / 2x-skygge) som standard hvis `ALADHAN_SCHOOL_NORWAY` ikke er satt.


## Feilsøking etter deploy (viktig)
Hvis bønnetider fortsatt er feil etter redeploy, sjekk at **riktig commit faktisk er i produksjon**.

1. Åpne deploy-listen og se commit-hash for "Published".
2. Kall funksjonen direkte i nettleser:
   - `/api/bonnetid-today?lat=59.913263&lon=10.752245&tz=Europe/Oslo&when=today`
3. Se feltet `debug.commitRef` i JSON-responsen.
   - Hvis den ikke matcher siste commit i GitHub `main`, kjører Netlify fortsatt eldre kode.

Du kan også sjekke mappingen i samme respons:
- `debug.selected.AsrFrom` bør være `2x-skygge` når tilgjengelig.
- `timings.Dhuhr` skal være nær `Duhr` (ikke `Istiwa`).
- `timings.Maghrib` skal ikke være lik `timings.Isha`.
