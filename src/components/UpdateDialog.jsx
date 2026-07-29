import { useState, useEffect } from 'react';

// Re‑implement checkForUpdate and downloadAndInstall inline to avoid importing the problematic file
// (or you can keep the imports – just ensure the original functions catch errors)
async function checkForUpdate() {
  try {
    const res = await fetch('https://studyhub-backend.onrender.com/api/update');
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    // Silently ignore network / CORS errors
    return null;
  }
}

async function downloadAndInstall(apkUrl, onProgress) {
  // Simulate download progress (replace with real download logic if needed)
  for (let i = 0; i <= 100; i += 10) {
    await new Promise(r => setTimeout(r, 50));
    onProgress(i);
  }
  // After download, trigger install (e.g., open APK)
  const a = document.createElement('a');
  a.href = apkUrl;
  a.download = 'app.apk';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function UpdateDialog() {
  const [update, setUpdate] = useState(null);
  const [progress, setProgress] = useState(-1); // -1 = hidden, 0-100

  useEffect(() => {
    // Skip check in development to avoid unnecessary CORS errors
    if (process.env.NODE_ENV === 'development') return;

    // Use a try/catch wrapper around the async call
    const fetchUpdate = async () => {
      try {
        const result = await checkForUpdate();
        if (result) setUpdate(result);
      } catch (_) {
        // If checkForUpdate throws unexpectedly, ignore it
      }
    };
    fetchUpdate();
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