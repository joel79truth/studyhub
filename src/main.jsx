import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { setupDeepLinkHandler } from './utils/deepLinkHandler';

// Start deep link listener (auto-update removed to avoid CORS errors)
setupDeepLinkHandler();
// checkForUpdate();  // <-- removed to prevent CORS & 'not defined' errors

// Service worker registration is handled by vite-plugin-pwa (registerType:
// 'autoUpdate' in vite.config.js) — it auto-injects its own registration
// script (dist/registerSW.js). A manual register()/unregister() here used
// to race against that and could tear down the service worker mid-registration,
// which delayed FCM push-token registration. Do not add manual SW code back
// without checking vite.config.js first.

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);