import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// 🌍 Store the install prompt event globally
window.__INSTALL_EVENT__ = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__INSTALL_EVENT__ = e;
});

// Mark as installed so we never show the button again
window.addEventListener('appinstalled', () => {
  localStorage.setItem('studyhub_installed', 'true');
  window.__INSTALL_EVENT__ = null;
});

// ✅ Register service worker for PWA
if ('serviceWorker' in navigator) {
  // Unregister old workers first
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
)