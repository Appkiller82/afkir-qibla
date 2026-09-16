// frontend/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Read-only prayer endpoints for local UI verification. Push actions are not proxied.
    proxy: {
      '/api/aladhan-month': { target: 'https://afkirqibla.netlify.app', changeOrigin: true },
      '/api/aladhan-today': { target: 'https://afkirqibla.netlify.app', changeOrigin: true },
    },
  }
});
