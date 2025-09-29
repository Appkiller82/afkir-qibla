
# Afkir Qibla – Fresh Push Build

This is a minimal, robust setup that:
- Uses Bonnetid in Norway (fallback to Aladhan), Aladhan elsewhere
- Registers Web Push (VAPID) and stores subscriptions in Netlify Blobs
- Sends automatic notifications at Fajr, Dhuhr, Asr, Maghrib, Isha via a Netlify Scheduled Function (every 2 min)
- Works on iPhone when installed to Home Screen (iOS 16.4+)

## Deploy (Netlify)
1) Create a new site from this folder. In **Site settings → Environment variables**, set:
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`
   - `BONNETID_API_URL` (e.g. `https://api.bonnetid.no/v1/times`)
   - `BONNETID_API_KEY` (if your endpoint requires it)
   - `ALADHAN_API_URL` (default ok) and optional `ALADHAN_METHOD` (default 2)

2) Ensure `netlify.toml` is used. It defines the scheduled function `push-cron` every 2 minutes.

3) Deploy. Then open on iPhone Safari, **Add to Home Screen**, open the app, allow notifications, and tap **Slå på varsler**.

## Notes
- On first subscribe we send a one-time confirmation notification.
- You can disable this by changing `subscribeForPush(false)` in `PushToggle`.
