import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

const root = createRoot(document.getElementById('root'));
root.render(<App />);

// Registrer service worker: /service-worker.js
if ('serviceWorker' in navigator) {
  const isSecure = window.isSecureContext || window.location.hostname === 'localhost';
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
