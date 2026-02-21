import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

const root = createRoot(document.getElementById('root'));
root.render(<App />);

// Registrer service worker i produksjon (ikke i dev/localhost for å unngå hvitskjerm pga stale cache)
if ('serviceWorker' in navigator) {
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const isDev = Boolean(import.meta.env?.DEV);

  if (isLocalhost || isDev) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
    console.info('[SW] Dev/localhost detected; skipping service-worker registration.');
  } else {
    const isSecure = window.isSecureContext;
    if (isSecure) {
      const registerSW = () => {
        navigator.serviceWorker
          .register('/service-worker.js')
          .then(() => console.log('[SW] service-worker.js registered'))
          .catch((err) => console.error('[SW] Registration failed:', err));
      };
      if (document.readyState === 'complete') registerSW();
      else window.addEventListener('load', registerSW);
    } else {
      console.warn('[SW] Not a secure context; skipping registration.');
    }
  }
}
