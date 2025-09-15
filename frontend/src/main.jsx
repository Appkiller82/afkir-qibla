import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App.jsx';
import KidsSurahRoute from './features/kids-surah/KidsSurahRoute.jsx';

const root = createRoot(document.getElementById('root'));
root.render(
  <BrowserRouter>
    <Routes>
      {/* Hovedappen din */}
      <Route path="/*" element={<App />} />
      {/* Barne-delen */}
      <Route path="/kids-suras/*" element={<KidsSurahRoute />} />
    </Routes>
  </BrowserRouter>
);

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
