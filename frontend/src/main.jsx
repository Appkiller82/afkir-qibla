import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('[App] Unhandled render error:', error);
  }

  handleReset = () => {
    try {
      localStorage.removeItem('aq_theme');
      localStorage.removeItem('aq_times_cache');
      localStorage.removeItem('aq_weather_cache');
    } catch {}
    window.location.reload();
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

const root = createRoot(document.getElementById('root'));
root.render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);

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
