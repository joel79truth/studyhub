import { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { saveFileOffline, getOfflineFile } from '../utils/offlineStorage';
import { getDownload } from '../utils/downloadStore';


const DEBUG = false;
const log = DEBUG ? console.log.bind(console) : () => {};

const getAuthToken = async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
};

const getProxiedUrl = (rawUrl) => {
  if (!rawUrl) return rawUrl;
  const isExternal =
    rawUrl.includes('drive.google.com') || rawUrl.includes('supabase.co');
  if (isExternal) {
    const direct = rawUrl.replace(
      /drive\.google\.com\/file\/d\/([^/]+)\/view/,
      'drive.google.com/uc?export=download&id=$1'
    );
    return `/api/file-proxy?url=${encodeURIComponent(direct)}`;
  }
  return rawUrl;
};

// Checks the actual bytes instead of trusting HTTP 200 — catches Google
// Drive's "can't scan this file for viruses" interstitial, which large
// files get served with a 200 status instead of the real bytes.
async function looksLikeValidFile(blob, fileType) {
  try {
    const header = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    if (fileType === 'pdf') {
      return header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44
        && header[3] === 0x46 && header[4] === 0x2d; // "%PDF-"
    }
    if (fileType === 'pptx') {
      return header[0] === 0x50 && header[1] === 0x4b; // "PK" (zip)
    }
    return true;
  } catch {
    return false;
  }
}

export function useFileLoader(rawUrl, fileId, fileType, filename) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [fileLoading, setFileLoading] = useState(true);
  const [fileError, setFileError] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const [servedFromCache, setServedFromCache] = useState(false);
  // NEW: what the loading screen should actually say, and real byte
  // progress during a network download so a slow connection shows a
  // moving number instead of a spinner that could mean anything.
  const [loadStage, setLoadStage] = useState('checking-cache'); // 'checking-cache' | 'downloading'
  const [downloadProgress, setDownloadProgress] = useState(null); // number 0-100 | 'indeterminate' | null
  const mounted = useRef(true);
  const blobUrlRef = useRef(null); // avoids stale-closure revokes

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
  if (!fileId) return;
  let cancelled = false;
  (async () => {
    const downloaded = await getDownload(fileId);
    if (!cancelled && downloaded) { setIsOffline(true); return; }
    const cached = await getOfflineFile(fileId);
    if (!cancelled) setIsOffline(!!cached);
  })();
  return () => { cancelled = true; };
}, [fileId]);

  // Main loading effect
  useEffect(() => {
    log('⏳ Starting file load process...', { rawUrl, fileType, fileId });
    setFileLoading(true);
    setFileError(null);
    setServedFromCache(false);
    setLoadStage('checking-cache');
    setDownloadProgress(null);

    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
      setBlobUrl(null);
    }

    if (!rawUrl) {
      setFileError('No file URL provided.');
      setFileLoading(false);
      return;
    }

    if (!['pdf', 'pptx'].includes(fileType)) {
      setFileError(`Unsupported file type: ${fileType}`);
      setFileLoading(false);
      return;
    }

    let cancelled = false;

    const applyBlob = (blob, fromCache) => {
      if (!mounted.current || cancelled) return;
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setBlobUrl(url);
      setServedFromCache(fromCache);
      setFileLoading(false);
    };

    const fetchFromNetwork = async () => {
      try {
        setLoadStage('downloading');
        setDownloadProgress(null);

        const token = await getAuthToken();
        const proxied = getProxiedUrl(rawUrl);
        const apiUrl = proxied.startsWith('/api/')
          ? `${import.meta.env.VITE_API_URL}${proxied}`
          : proxied;

        log('🌐 Fetching file from:', apiUrl);
        const res = await fetch(apiUrl, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        let blob;
        if (res.body && typeof res.body.getReader === 'function') {
          // Stream with real progress — same pattern as
          // useDownloadManager's explicit downloads, so slow connections
          // show an actual percentage instead of a spinner.
          const total = Number(res.headers.get('content-length')) || 0;
          setDownloadProgress(total ? 0 : 'indeterminate');

          const reader = res.body.getReader();
          const chunks = [];
          let received = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (cancelled) { reader.cancel(); return; }
            chunks.push(value);
            received += value.length;
            if (mounted.current) {
              setDownloadProgress(total ? Math.min(99, Math.round((received / total) * 100)) : 'indeterminate');
            }
          }
          blob = new Blob(chunks);
        } else {
          // Fallback for environments without a streamable fetch body
          // (some older WebViews) — no progress, but still works.
          setDownloadProgress('indeterminate');
          blob = await res.blob();
        }

        if (!mounted.current || cancelled) return;

        const valid = await looksLikeValidFile(blob, fileType);
        if (!valid) {
          throw new Error(
            'The file server returned something other than the document — this usually happens with large files hosted on Google Drive. Try again in a moment, or ask your lecturer to re-upload it.'
          );
        }

        setDownloadProgress(100);
        applyBlob(blob, false);

        if (fileId) {
          saveFileOffline(fileId, blob, {
            name: filename,
            fileType,
            originalUrl: rawUrl,
          }).then(() => log('💾 Saved file offline:', fileId))
            .catch(e => console.error('💾 Offline save failed:', e));
        }
      } catch (err) {
        console.error('❌ File loading error:', err.message);
        if (mounted.current && !cancelled) {
          setFileError(err.message);
          setFileLoading(false);
        }
      }
    };

    const run = async () => {
  if (fileType === 'pptx') {
    setFileLoading(false);
    return;
  }

  setLoadStage('checking-cache');

  if (fileId) {
    // 1. Explicit download — never re-fetch, never auto-delete, but DO
    // validate before trusting it.
    try {
      const downloaded = await getDownload(fileId);
      if (cancelled) return;
      if (downloaded?.blob) {
        if (await looksLikeValidFile(downloaded.blob, fileType)) {
          log('✅ Serving from explicit download — fully offline');
          applyBlob(downloaded.blob, true);
          return;
        }
        console.warn('Explicit download for', fileId, 'failed validation — skipping');
      }
    } catch (e) {
      console.warn('Download store lookup failed:', e);
    }

    // 2. Soft cache — best-effort, safe to skip silently if invalid.
    try {
      const cached = await getOfflineFile(fileId);
      if (cancelled) return;
      if (cached?.blob) {
        if (await looksLikeValidFile(cached.blob, fileType)) {
          log('📦 Serving from soft cache — skipping network');
          applyBlob(cached.blob, true);
          return;
        }
        console.warn('Soft cache for', fileId, 'failed validation — refetching from network');
      }
    } catch (e) {
      console.warn('Offline cache lookup failed, falling back to network:', e);
    }
  }

  // 3. Nothing valid locally — need network.
  if (!navigator.onLine) {
    setFileError(
      'You\u2019re offline and haven\u2019t downloaded this file yet. Connect to the internet once to download it for offline use.'
    );
    setFileLoading(false);
    return;
  }

  await fetchFromNetwork();
};
    run();

    return () => {
      cancelled = true;
    };
  }, [rawUrl, fileType, fileId, filename]);

  // Revoke on unmount only — the effect above already revokes on
  // dependency change, so this just covers final cleanup.
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, []);

  return { blobUrl, fileLoading, fileError, isOffline, servedFromCache, loadStage, downloadProgress };
}