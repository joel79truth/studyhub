import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// 🌍 Store the install prompt event globally
window.__INSTALL_EVENT__ = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__INSTALL_EVENT__ = e;
  alert('✅ Install prompt fired! The install button will work now.');
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

// 🩺 PWA DIAGNOSTIC – runs after page load
window.addEventListener('load', async () => {
  const results = [];
  const base = window.location.origin;

  // 1. Check manifest
  try {
    const res = await fetch(`${base}/manifest.json`);
    const contentType = res.headers.get('content-type');
    if (!res.ok) {
      results.push('❌ manifest.json not found (HTTP ' + res.status + ')');
    } else if (!contentType || !contentType.includes('application/manifest+json')) {
      results.push('❌ manifest.json MIME type is ' + contentType + ' (needs application/manifest+json)');
    } else {
      const json = await res.json();
      if (!json.icons || json.icons.length < 2) {
        results.push('⚠️ manifest.json has fewer than 2 icons');
      } else {
        results.push('✅ manifest.json loaded with correct MIME');
      }
    }
  } catch (e) {
    results.push('❌ Failed to fetch manifest: ' + e.message);
  }

  // 2. Check icons
  try {
    const icon192 = await fetch(`${base}/icons/icon-192.png`);
    if (!icon192.ok) results.push('❌ icon-192.png missing');
    else results.push('✅ icon-192.png loaded');
  } catch {
    results.push('❌ icon-192.png fetch error');
  }

  try {
    const icon512 = await fetch(`${base}/icons/icon-512.png`);
    if (!icon512.ok) results.push('❌ icon-512.png missing');
    else results.push('✅ icon-512.png loaded');
  } catch {
    results.push('❌ icon-512.png fetch error');
  }

  // 3. Check service worker
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.ready;
    results.push(reg.active ? '✅ Service worker active' : '⚠️ Service worker not active');
  } else {
    results.push('❌ Service workers not supported');
  }

  // 4. Display
  alert('📋 PWA Diagnostic:\n\n' + results.join('\n'));
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);