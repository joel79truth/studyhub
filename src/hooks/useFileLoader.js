import { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { saveFileOffline, getOfflineFile } from '../utils/offlineStorage';

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

export function useFileLoader(rawUrl, fileId, fileType, filename) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [fileLoading, setFileLoading] = useState(true);
  const [fileError, setFileError] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const [servedFromCache, setServedFromCache] = useState(false);
  const mounted = useRef(true);
  const blobUrlRef = useRef(null); // avoids stale-closure revokes

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!fileId) return;
    getOfflineFile(fileId).then(cached => {
      if (mounted.current) setIsOffline(!!cached);
    });
  }, [fileId]);

  // Main loading effect
  useEffect(() => {
    log('⏳ Starting file load process...', { rawUrl, fileType, fileId });
    setFileLoading(true);
    setFileError(null);
    setServedFromCache(false);

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

        const blob = await res.blob();
        if (!mounted.current || cancelled) return;

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
      // PPTX doesn't need a blob — uses rawUrl directly, no caching path.
      if (fileType === 'pptx') {
        setFileLoading(false);
        return;
      }

      // Cache-first, regardless of online/offline status. This is the
      // fix: previously the offline cache was only checked when the
      // device was offline, so an already-downloaded file was silently
      // re-fetched from the network on every view.
      if (fileId) {
        try {
          const cached = await getOfflineFile(fileId);
          if (cancelled) return;
          if (cached?.blob) {
            log('📦 Serving from offline cache — skipping network');
            applyBlob(cached.blob, true);
            return;
          }
        } catch (e) {
          console.warn('Offline cache lookup failed, falling back to network:', e);
        }
      }

      // Nothing cached — but if we're offline and have nothing, fail
      // clearly instead of attempting (and hanging on) a dead fetch.
      if (!navigator.onLine) {
        setFileError('You are offline and this file is not saved for offline use.');
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

  return { blobUrl, fileLoading, fileError, isOffline, servedFromCache };
}