import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      workbox: {
        importScripts: ['firebase-push-sw.js'], // unchanged — your push setup
        // ADDED: tells the service worker how to handle live requests,
        // not just the precached app shell.
        runtimeCaching: [
          {
            // Supabase REST calls only (notes/past_papers/quiz table rows) —
            // NOT storage object downloads. Note files already go through
            // useDownloadManager -> downloadStore (IndexedDB) with their own
            // quota check and explicit user-triggered save/remove. Letting
            // Workbox NetworkFirst-cache the same PDF bytes a second time
            // here would silently double the storage a downloaded note
            // takes up, with no byte-size cap (only maxEntries: 200) — a
            // real problem on a phone with little free storage.
            urlPattern: ({ url }) =>
              url.hostname.endsWith('supabase.co') && !url.pathname.includes('/storage/v1/object/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-cache',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 200, maxAgeSeconds: 604800 }, // 7 days
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Your own backend (proxied /api, /chat-message, etc. in dev;
            // same routes hit onrender.com in prod)
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api') || url.pathname.startsWith('/chat-message'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 86400 }, // 1 day
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Past-paper scans, avatars, note images — cache-first since
            // these rarely change once uploaded
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: { maxEntries: 300, maxAgeSeconds: 2592000 }, // 30 days
            },
          },
        ],
      },
      manifest: {
        id: '/',
        name: 'StudyHub LUANAR',
        short_name: 'StudyHub',
        description: 'Your study companion for LUANAR',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
        screenshots: [
          {
            src: 'screenshots/screenshot-mobile.png',
            sizes: '1080x1920',
            type: 'image/png',
            form_factor: 'narrow',
          },
          {
            src: 'screenshots/screenshot-desktop.png',
            sizes: '1920x1080',
            type: 'image/png',
            form_factor: 'wide',
          },
        ],
      },
    }),
  ],
  // ---------- your existing config (unchanged) ----------
  server: {
    proxy: {
      '/upload': 'http://localhost:3000',
      '/save-token': 'http://localhost:3000',
      '/events': 'http://localhost:3000',
      '/chat-message': 'http://localhost:3000',
      '/submit-request': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
    },
  },
  preview: {
    allowedHosts: [
      'studyhub-backend-opdd.onrender.com',
      '.onrender.com',
    ],
    historyApiFallback: {
      rewrites: [
        { from: /^\/manifest\.webmanifest$/, to: '/manifest.webmanifest' },
        { from: /./, to: '/index.html' },
      ],
    },
  },
  build: {
    rolldownOptions: {
      external: ['@capacitor/app', '@capacitor/browser'],
      output: {
        codeSplitting: true,
      },
    },
    chunkSizeWarningLimit: 1000,
  },
});