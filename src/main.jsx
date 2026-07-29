import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { setupDeepLinkHandler } from './utils/deepLinkHandler';

// Start deep link listener (auto-update removed to avoid CORS errors)
setupDeepLinkHandler();
// checkForUpdate();  // <-- removed to prevent CORS & 'not defined' errors

// Optional: service worker for web version (harmless to keep)
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