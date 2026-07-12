import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';               // 👈 1. import

export default defineConfig({
  plugins: [
    react(),
    VitePWA({                                              // 👈 2. add the PWA plugin
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
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
          {
            src: 'icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  // ---------- your existing config below (do not change) ----------
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
    rolldownOptions: {                                    // if this was a typo for rollupOptions, keep it
      external: ['@capacitor/app', '@capacitor/browser'],
      output: {
        codeSplitting: true,
      },
    },
    chunkSizeWarningLimit: 1000,
  },
});