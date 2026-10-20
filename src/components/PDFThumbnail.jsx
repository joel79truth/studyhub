/**
 * PDFThumbnail.jsx
 *
 * Renders the first page of a PDF as a small canvas thumbnail.
 * Supports:
 * - Direct Supabase / CDN PDF files via pdfjs-dist.
 * - Google Drive PDF links via direct thumbnail service (lh3.googleusercontent.com).
 * - Concurrency semaphore (max 2 in flight) with a release timeout to prevent deadlocks.
 * - In-memory URL cache so navigation/scrolling never re-renders known thumbnails.
 */

import { useState, useEffect, useRef, memo } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { FileText } from 'lucide-react';

// Setup pdfjs worker once at module level
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Module-level thumbnail cache: url -> dataURL
const thumbCache = new Map();

// Concurrency semaphore: max 2 in parallel to protect low-end mobile CPUs
const MAX_CONCURRENT = 2;
let activeRenders = 0;
const waitQueue = [];

function acquireSlot() {
  return new Promise((resolve) => {
    if (activeRenders < MAX_CONCURRENT) {
      activeRenders++;
      resolve();
    } else {
      waitQueue.push(resolve);
    }
  });
}

function releaseSlot() {
  if (waitQueue.length > 0) {
    const next = waitQueue.shift();
    next();
  } else if (activeRenders > 0) {
    activeRenders--;
  }
}

// Extract Google Drive ID if present
function getGDriveId(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

const PDFThumbnail = memo(({ url, scale = 0.4 }) => {
  const gDriveId = getGDriveId(url);
  const [thumbnail, setThumbnail] = useState(() => thumbCache.get(url) || null);
  const [isVisible, setIsVisible] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const containerRef = useRef(null);

  // IntersectionObserver: only load when visible in viewport
  useEffect(() => {
    if (thumbCache.has(url)) return;

    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.05 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [url]);

  // Google Drive thumbnails: handled directly via image without heavy pdfjs parsing
  useEffect(() => {
    if (gDriveId && url) {
      const gDriveImg = `https://lh3.googleusercontent.com/d/${gDriveId}=s400`;
      setThumbnail(gDriveImg);
      thumbCache.set(url, gDriveImg);
    }
  }, [gDriveId, url]);

  // Regular PDF rendering via pdfjs
  useEffect(() => {
    if (!isVisible || !url || gDriveId || thumbnail || loadFailed) return;

    if (thumbCache.has(url)) {
      setThumbnail(thumbCache.get(url));
      return;
    }

    let cancelled = false;
    let slotReleased = false;

    const safeRelease = () => {
      if (!slotReleased) {
        slotReleased = true;
        releaseSlot();
      }
    };

    (async () => {
      await acquireSlot();
      if (cancelled) {
        safeRelease();
        return;
      }

      // Safety timeout: free slot after 8s if network or parsing stalls
      const timeoutId = setTimeout(() => {
        if (!slotReleased) {
          safeRelease();
        }
      }, 8000);

      let pdfDoc = null;
      try {
        const loadingTask = pdfjs.getDocument({
          url,
          disableAutoFetch: true,
          disableStream: true, // Prevents HTTP 206 range requests that fail on some storage CDNs
        });

        pdfDoc = await loadingTask.promise;
        if (cancelled) {
          clearTimeout(timeoutId);
          safeRelease();
          if (pdfDoc) pdfDoc.destroy();
          return;
        }

        const page = await pdfDoc.getPage(1);
        if (cancelled) {
          clearTimeout(timeoutId);
          safeRelease();
          if (pdfDoc) pdfDoc.destroy();
          return;
        }

        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');

        await page.render({ canvasContext: ctx, viewport }).promise;

        if (!cancelled) {
          const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
          thumbCache.set(url, dataUrl);
          setThumbnail(dataUrl);
        }
      } catch (err) {
        setLoadFailed(true);
      } finally {
        clearTimeout(timeoutId);
        safeRelease();
        if (pdfDoc) {
          try { pdfDoc.destroy(); } catch (_) {}
        }
      }
    })();

    return () => {
      cancelled = true;
      safeRelease();
    };
  }, [isVisible, url, gDriveId, thumbnail, loadFailed, scale]);

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center bg-slate-50">
      {thumbnail && !loadFailed ? (
        <img
          src={thumbnail}
          alt=""
          draggable={false}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => {
            // If GDrive image failed, try fallback endpoint
            if (gDriveId && !thumbnail.includes('drive.google.com/thumbnail')) {
              setThumbnail(`https://drive.google.com/thumbnail?id=${gDriveId}&sz=w400`);
            } else {
              setLoadFailed(true);
            }
          }}
        />
      ) : (
        <FileText className="w-1/2 h-1/2 text-slate-300" strokeWidth={1.5} />
      )}
    </div>
  );
});

PDFThumbnail.displayName = 'PDFThumbnail';
export default PDFThumbnail;
