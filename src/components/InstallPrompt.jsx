import { useState, useEffect } from 'react';
import { Download } from 'lucide-react';

export default function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const [showManual, setShowManual] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Already installed?
    if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
      setIsInstalled(true);
      return;
    }

    // If service worker not supported, manual guide is all we have
    if (!('serviceWorker' in navigator)) {
      setShowManual(true);
      return;
    }

    // Wait for SW to be ready
    navigator.serviceWorker.ready.catch(() => {});

    // Listen for the automatic prompt
    const handler = (e) => {
      e.preventDefault();
      setInstallEvent(e);
      setShowManual(false);
    };
    window.addEventListener('beforeinstallprompt', handler);

    window.addEventListener('appinstalled', () => {
      setInstallEvent(null);
      setIsInstalled(true);
      setShowManual(false);
    });

    // If after 6 seconds no prompt, show manual install guidance
    const timeout = setTimeout(() => {
      if (!installEvent) {
        setShowManual(true);
      }
    }, 6000);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      clearTimeout(timeout);
    };
  }, []);

  const handleInstall = () => {
    if (!installEvent) return;
    installEvent.prompt();
    installEvent.userChoice.then(() => setInstallEvent(null));
  };

  // Don't show anything if already installed
  if (isInstalled) return null;

  // Show automatic button if event is available
  if (installEvent) {
    return (
      <button
        onClick={handleInstall}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 
                   flex items-center gap-2 px-4 py-2 
                   bg-white/90 backdrop-blur-md border border-gray-200 
                   rounded-full shadow-lg hover:shadow-xl 
                   text-sm font-medium text-gray-700 hover:text-gray-900 
                   transition-all duration-200 active:scale-95"
      >
        <Download size={16} />
        <span>Install App</span>
      </button>
    );
  }

  // Manual fallback – small instruction bar
  if (showManual) {
    return (
      <div
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 
                   flex items-center gap-2 px-4 py-2 
                   bg-gray-900/90 backdrop-blur-md border border-gray-700 
                   rounded-full shadow-lg 
                   text-xs text-gray-200"
      >
        <span>Tap ⠅ <strong>Add to Home screen</strong></span>
      </div>
    );
  }

  return null;
}