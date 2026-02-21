import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

const root = createRoot(document.getElementById('root'));
root.render(<App />);

// Service worker håndtering:
// - Dev/localhost: ikke registrer SW
// - Produksjon: engangs migrering for å unngå stale cache/hvitskjerm
if ('serviceWorker' in navigator) {
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const isDev = Boolean(import.meta.env?.DEV);

  const unregisterAll = async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    } catch {}
  };

  const registerSW = () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then(() => console.log('[SW] service-worker.js registered'))
      .catch((err) => console.error('[SW] Registration failed:', err));
  };

  if (isLocalhost || isDev) {
    unregisterAll().finally(() => {
      console.info('[SW] Dev/localhost detected; skipping service-worker registration.');
    });
  } else if (window.isSecureContext) {
    const migrateKey = 'aq_sw_migrated_v1';
    const migrated = localStorage.getItem(migrateKey) === '1';

    const start = async () => {
      if (!migrated) {
        await unregisterAll();
        localStorage.setItem(migrateKey, '1');
      }
      registerSW();
    };

    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start);
  } else {
    console.warn('[SW] Not a secure context; skipping registration.');
  }
}
