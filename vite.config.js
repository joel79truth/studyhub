import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
  proxy: {
    '/upload': 'http://localhost:3000',
    '/save-token': 'http://localhost:3000',
    '/events': 'http://localhost:3000',
    '/chat-message': 'http://localhost:3000',
    '/submit-request': 'http://localhost:3000',
    '/api': 'http://localhost:3000',   // covers /api/programs, /api/metadata, /api/requests
    // If you need /api/drive/*, you can keep it as well
  }
},
  preview: {
    allowedHosts: [
      'studyhub-backend-opdd.onrender.com',
      '.onrender.com'
    ],
    historyApiFallback: {
      rewrites: [
        { from: /^\/manifest\.webmanifest$/, to: '/manifest.webmanifest' },
        { from: /./, to: '/index.html' }
      ]
    }
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
})