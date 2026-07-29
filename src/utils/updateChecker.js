// utils/updateChecker.js
export async function checkForUpdate() {
  try {
    const res = await fetch('https://studyhub-backend.onrender.com/api/update');
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    // Silently ignore network/CORS/404 errors
    return null;
  }
}

export async function downloadAndInstall(apkUrl, onProgress) {
  // Simulate or implement download
  for (let i = 0; i <= 100; i += 10) {
    await new Promise(r => setTimeout(r, 50));
    if (onProgress) onProgress(i);
  }
  // Trigger download
  const a = document.createElement('a');
  a.href = apkUrl;
  a.download = 'app.apk';
  document.body.appendChild(a);
  a.click();
  a.remove();
}