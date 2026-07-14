import { useState, useEffect } from 'react';
import { Download } from 'lucide-react';

export default function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Already installed?
    if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
      setIsInstalled(true);
      return;
    }

    // Listen for the automatic prompt
    const handler = (e) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    window.addEventListener('beforeinstallprompt', handler);

    window.addEventListener('appinstalled', () => {
      setInstallEvent(null);
      setIsInstalled(true);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = () => {
    if (!installEvent) return;
    installEvent.prompt();
    installEvent.userChoice.then(() => setInstallEvent(null));
  };

  // Show nothing if installed
  if (isInstalled) return null;

  // Only show the automatic install button (if available)
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

  // ⛔ MANUAL FALLBACK REMOVED – no more "Add to Home screen" popup
  return null;
}