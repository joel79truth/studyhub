import { useState, useEffect } from 'react';

export default function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallEvent(e);
      setIsVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
      setIsVisible(false);
    }

    window.addEventListener('appinstalled', () => {
      setIsVisible(false);
      setInstallEvent(null);
    });

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = () => {
    if (!installEvent) return;
    installEvent.prompt();
    installEvent.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        console.log('User accepted install');
      }
      setInstallEvent(null);
      setIsVisible(false);
    });
  };

  if (!isVisible) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#1e293b',
      color: 'white',
      padding: '12px 24px',
      borderRadius: '12px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      zIndex: 9999,
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
    }}>
      <span>Install this app for quick access</span>
      <button onClick={handleInstall}
        style={{ background: '#3b82f6', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' }}>
        Install
      </button>
      <button onClick={() => setIsVisible(false)}
        style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '18px', cursor: 'pointer' }}>
        ✕
      </button>
    </div>
  );
}