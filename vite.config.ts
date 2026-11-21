import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import 'dotenv/config';

export default defineConfig({
  plugins: [react(), tailwind(), VitePWA({
    registerType: 'autoUpdate',
    manifest: { name: 'EmberWatch Wildfire Scenario Lab', short_name: 'EmberWatch', theme_color: '#080d16',
      background_color: '#080d16', display: 'standalone', start_url: '/',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      ] },
    workbox: { globPatterns: ['**/*.{js,css,html,svg,png,json}'], maximumFileSizeToCacheInBytes: 4_000_000, navigateFallbackDenylist: [/^\/api\//] },
  })],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:' + (process.env.PORT || 3001) } },
  build: { outDir: 'dist/client', rollupOptions: { output: { manualChunks: { maplibre: ['maplibre-gl'] } } }, chunkSizeWarningLimit: 1200 },
});
