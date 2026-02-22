import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

async function hardResetAppState() {
  const keysToClear = [
    'aq_theme',
    'aq_times_cache',
    'aq_weather_cache',
    'aq_city',
    'aq_country',
    'aq_last_coords',
    'adminOffsets',
  ];

  try {
    keysToClear.forEach((k) => localStorage.removeItem(k));
  } catch {}

  if ('serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    } catch {}
  }

  if ('caches' in window) {
    try {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    } catch {}
  }
}

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) {
      console.error('[App] Unhandled render error stack:', error, info);
    } else {
      console.error('[App] Unhandled render error:', error?.message || error);
    }
  }

  handleReset = async () => {
    await hardResetAppState();
    window.location.href = window.location.href;
  };

  render() {
    if (this.state.hasError) {
      return (
        <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16, background: '#0b1220', color: '#e5e7eb', fontFamily: 'Inter, system-ui, sans-serif' }}>
          <section style={{ maxWidth: 520, width: '100%', border: '1px solid #334155', background: 'rgba(15,23,42,.9)', borderRadius: 16, padding: 18 }}>
            <h1 style={{ marginTop: 0, marginBottom: 10 }}>Afkir Qibla må startes på nytt</h1>
            <p style={{ marginTop: 0, color: '#cbd5e1' }}>
              Vi fanget en feil som kunne gi hvit eller mørk skjerm. Trykk knappen under for å nullstille lokal cache og laste appen på nytt.
            </p>
            <button onClick={this.handleReset} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #16a34a', background: '#16a34a', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
              Start appen på nytt
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

// Clean up known-bad/corrupt localStorage entries before app boot.
try {
  const raw = localStorage.getItem('adminOffsets');
  if (raw != null) {
    try {
      JSON.parse(raw);
    } catch {
      localStorage.removeItem('adminOffsets');
    }
  }
} catch {}

const root = createRoot(document.getElementById('root'));
root.render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);

// Service worker handling:
// - Dev/localhost: do not register SW
// - Prod: migrate by clearing stale registrations once and then register
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
    const migrateKey = 'aq_sw_migrated_v2';
    const migrated = localStorage.getItem(migrateKey) === '1';

    const start = async () => {
      if (!migrated) {
        await unregisterAll();
        if ('caches' in window) {
          try {
            const keys = await caches.keys();
            await Promise.all(keys.map((key) => caches.delete(key)));
          } catch {}
        }
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
