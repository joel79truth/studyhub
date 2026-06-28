import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',   // local backend only
        changeOrigin: true,
        secure: false,
      }
    }
  },
  // 👇 Add this for the production preview server
  preview: {
    allowedHosts: [
      'studyhub-backend-opdd.onrender.com',  // exact host from the error
      '.onrender.com'                         // any future Render subdomain
    ]
  }
})