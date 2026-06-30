import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// 🌍 Store the install prompt event globally
window.__INSTALL_EVENT__ = null;

window.addEventListener('beforeinstallprompt', (e) => {
  alert('✅ Install prompt is ready!');   // ← temporary popup
  e.preventDefault();
  window.__INSTALL_EVENT__ = e;
});

window.addEventListener('appinstalled', () => {
  localStorage.setItem('studyhub_installed', 'true');
  window.__INSTALL_EVENT__ = null;
});

// ✅ Clean service worker registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => reg.unregister());
  }).then(() => {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('SW registered:', reg.scope))
        .catch(err => console.error('SW failed:', err));
    });
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);