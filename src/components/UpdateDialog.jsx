import { useState, useEffect } from 'react';
import { checkForUpdate, downloadAndInstall } from '../utils/updateChecker';

export default function UpdateDialog() {
  const [update, setUpdate] = useState(null);
  const [progress, setProgress] = useState(-1); // -1 = hidden, 0-100

  useEffect(() => {
    checkForUpdate().then(setUpdate).catch(console.error);
  }, []);

  if (!update || progress > 0) return null;

  const handleUpdate = () => {
    setProgress(0);
    downloadAndInstall(update.apkUrl, (p) => setProgress(p))
      .catch(() => setProgress(-1));
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex',
      justifyContent: 'center', alignItems: 'center', zIndex: 9999
    }}>
      {progress >= 0 ? (
        <div style={{ background: '#fff', padding: 30, borderRadius: 12, textAlign: 'center' }}>
          <h3>Downloading... {progress}%</h3>
          <progress value={progress} max="100" style={{ width: '100%' }} />
        </div>
      ) : (
        <div style={{ background: '#fff', padding: 30, borderRadius: 12, maxWidth: 350 }}>
          <h2>{update.title || 'Update Available'}</h2>
          <p>{update.message}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            {!update.forceUpdate && (
              <button onClick={() => setUpdate(null)}>Later</button>
            )}
            <button onClick={handleUpdate} style={{ fontWeight: 'bold' }}>
              Update Now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}