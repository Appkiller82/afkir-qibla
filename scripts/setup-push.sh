#!/usr/bin/env bash
set -e
npm i @netlify/functions @netlify/blobs web-push luxon
echo "Husk å sette VITE_VAPID_PUBLIC_KEY i .env (kopier fra Netlify env VAPID_PUBLIC_KEY)"
