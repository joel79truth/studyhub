import { useState, useEffect } from 'react';
import { Download } from 'lucide-react';

export default function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const [status, setStatus] = useState('checking...');

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      setStatus('No SW support');
      return;
    }

    navigator.serviceWorker.ready
      .then(() => setStatus('SW ready'))
      .catch(err => setStatus('SW error: ' + err.message));

    const handler = (e) => {
      e.preventDefault();
      setInstallEvent(e);
      setStatus('Prompt ready');
    };

    window.addEventListener('beforeinstallprompt', handler);

    if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
      setStatus('Already installed');
      return () => window.removeEventListener('beforeinstallprompt', handler);
    }

    window.addEventListener('appinstalled', () => {
      setInstallEvent(null);
      setStatus('Installed!');
    });

    // If after 5 seconds the prompt hasn't fired, show what we know
    const timeout = setTimeout(() => {
      if (!installEvent) setStatus(prev => prev + ' | no prompt yet');
    }, 5000);

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

  return (
    <>
      {/* Tiny debug text – remove after testing */}
      <div style={{
        position: 'fixed',
        top: 2,
        left: 2,
        fontSize: '8px',
        color: '#666',
        background: 'rgba(255,255,255,0.7)',
        padding: '2px 6px',
        zIndex: 99999,
        borderRadius: '4px'
      }}>
        {status}
      </div>

      {installEvent && (
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
      )}
    </>
  );
}