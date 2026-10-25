/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'favicon-32.png'],
      manifest: {
        id: '/',
        name: 'Finanzas Personales',
        short_name: 'Finanzas',
        description: 'Gastos, cuentas y tarjetas en cuotas',
        lang: 'es-AR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        categories: ['finance'],
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        // Atajos al mantener apretado el ícono: la carga rápida es el uso más frecuente.
        shortcuts: [
          { name: 'Nuevo gasto', short_name: 'Gasto', url: '/nuevo', icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
          { name: 'Compra con tarjeta', short_name: 'Tarjeta', url: '/nuevo/tarjeta', icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: { TZ: 'America/Argentina/Buenos_Aires' },
  },
});
