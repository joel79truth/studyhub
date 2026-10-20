/**
 * ActualPaperView.jsx
 *
 * Renders the actual uploaded paper (PDF or high-res scanned image)
 * directly inline in the Past Papers page with zero redirection.
 *
 * Features:
 * - Mobile-first responsive sizing: perfectly fits mobile screens without overflowing.
 * - High-DPI canvas rendering matching Google Docs / Chrome PDF viewer (crystal clear vector text, no stretching).
 * - Exact aspect ratio enforcement so fonts and diagrams are never distorted or squished.
 * - Full-page maximize view: dedicated full-screen lightbox for viewing images and pages edge-to-edge.
 * - Aggressive offline & low-network caching: pre-caches documents via Cache API & localStorage metadata.
 * - Zoom in / Zoom out / 100% / Fit Width / Full Page controls.
 */

import React, { useState, useEffect, useRef, useMemo, memo, useCallback } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from '../supabase';
import {
  MessageCircleQuestion,
  Maximize2,
  Minimize2,
  FileText,
  Image as ImageIcon,
  AlertCircle,
  Loader2,
  X,
  Download,
} from 'lucide-react';
import GoogleLensIcon from './GoogleLensIcon';

// Setup worker once at module level
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// ── Cache API Helper for Low-Network / Offline Support ───────────────────────
const PAPERS_CACHE_NAME = 'studyhub-papers-v1';

async function getCachedDocumentBuffer(url) {
  if (typeof window === 'undefined' || !('caches' in window) || !url) return null;
  try {
    const cache = await caches.open(PAPERS_CACHE_NAME);
    const match = await cache.match(url);
    if (match) {
      return await match.arrayBuffer();
    }
  } catch (e) {
    console.debug('[ActualPaperView] Cache read error:', e);
  }
  return null;
}

async function saveDocumentToCache(url, response) {
  if (typeof window === 'undefined' || !('caches' in window) || !url || !response) return;
  try {
    const cache = await caches.open(PAPERS_CACHE_NAME);
    await cache.put(url, response.clone());
  } catch (e) {
    console.debug('[ActualPaperView] Cache write error:', e);
  }
}

// ─── Single PDF Page Canvas (Google Docs style crispness & true aspect ratio) ──
const PdfPage = memo(({ pdfDoc, pageNumber, scale, containerWidth }) => {
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    let renderTask = null;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        // Device pixel ratio capped at 2.5 for mobile memory efficiency while razor-sharp
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

        // 1. Get base unscaled viewport to extract exact natural aspect ratio
        const baseViewport = page.getViewport({ scale: 1.0 });
        const aspectRatio = baseViewport.width / baseViewport.height;

        // 2. Compute CSS display dimensions
        const cssWidth = Math.round(baseViewport.width * scale);
        const cssHeight = Math.round(baseViewport.height * scale);

        // 3. Set canvas buffer to physical pixels (DPR-aware) — prevents blurry or stretched text
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        // 4. Render viewport matching the internal buffer dimensions exactly
        const renderViewport = page.getViewport({ scale: scale * dpr });

        renderTask = page.render({
          canvasContext: ctx,
          viewport: renderViewport,
        });

        await renderTask.promise;
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled && err?.name !== 'RenderingCancelledException') {
          console.warn(`[ActualPaperView] Page ${pageNumber} render error:`, err);
          setError(err.message);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (renderTask) {
        try { renderTask.cancel(); } catch (_) {}
      }
    };
  }, [pdfDoc, pageNumber, scale]);

  return (
    <div
      className="relative bg-white shadow-md rounded-xl border border-slate-200/90 my-3 sm:my-5 mx-auto overflow-hidden w-full flex justify-center"
      style={{ maxWidth: scale <= 1.0 ? '100%' : `${Math.round(612 * scale)}px` }}
    >
      <div className="absolute top-2.5 left-2.5 z-10 px-2 py-0.5 bg-black/60 text-white rounded text-[10px] font-bold tracking-wider backdrop-blur-sm pointer-events-none select-none">
        Page {pageNumber}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center p-12 min-h-[300px] sm:min-h-[380px] bg-slate-50 w-full">
          <Loader2 className="w-6 h-6 text-indigo-600 animate-spin mb-2" />
          <span className="text-xs text-slate-400">Loading page {pageNumber}...</span>
        </div>
      )}

      {error && (
        <div className="p-8 text-center text-xs text-rose-500 bg-rose-50 w-full">
          Failed to render page {pageNumber}
        </div>
      )}

      <canvas
        ref={canvasRef}
        className={`block transition-opacity duration-200 ${loading ? 'opacity-0' : 'opacity-100'}`}
        style={{
          width: '100%',
          maxWidth: `${Math.round(612 * scale)}px`,
          height: 'auto',
          display: loading ? 'none' : 'block',
        }}
      />
    </div>
  );
});

PdfPage.displayName = 'PdfPage';

// ─── Main ActualPaperView ────────────────────────────────────────────────────
export default function ActualPaperView({ paper, onSwitchToText, onAskPaper }) {
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      return Math.min(window.innerWidth - 24, 850);
    }
    return 650;
  });

  // Calculate default responsive fit scale (fits mobile screens automatically)
  const computeFitScale = useCallback((availWidth = containerWidth) => {
    const targetW = availWidth > 0 ? availWidth : (typeof window !== 'undefined' ? window.innerWidth - 24 : 650);
    // Standard document is ~612pt wide
    const fit = +(targetW / 612).toFixed(2);
    // On desktop cap comfortable initial size at 1.15, on mobile allow fit (e.g. 0.55 - 0.70)
    return Math.max(0.45, Math.min(1.15, fit));
  }, [containerWidth]);

  const [scale, setScale] = useState(() => {
    if (typeof window !== 'undefined') {
      const avail = Math.min(window.innerWidth - 24, 850);
      return Math.max(0.45, Math.min(1.15, +(avail / 612).toFixed(2)));
    }
    return 1.0;
  });

  const [rawPaper, setRawPaper] = useState(() => {
    // Check localStorage metadata cache first for instant 0ms load
    if (paper?.paperId) {
      try {
        const cached = localStorage.getItem(`sh_file_meta_${paper.paperId}`);
        return cached ? JSON.parse(cached) : null;
      } catch {
        return null;
      }
    }
    return null;
  });

  const [loading, setLoading] = useState(!rawPaper);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState(null);
  const [isFullPage, setIsFullPage] = useState(false);
  const [fullPageZoom, setFullPageZoom] = useState(1.0);
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState(null);

  // Measure container width on resize to ensure proper fitting on mobile
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      } else if (typeof window !== 'undefined') {
        setContainerWidth(Math.min(window.innerWidth - 24, 850));
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // 1. Fetch raw paper record from Supabase & cache metadata
  const fetchPaperFile = useCallback(async () => {
    if (!paper) return;
    try {
      let found = null;

      // Try matching by paper_id first
      if (paper.paperId) {
        const { data } = await supabase
          .from('past_paper')
          .select('id, file_url, file_name, file_type, thumbnail_url, page_count, title, course, year')
          .eq('paper_id', paper.paperId)
          .maybeSingle();
        if (data?.file_url) found = data;
      }

      // Try matching by pastPaperId if not found
      if (!found && paper.pastPaperId) {
        const { data } = await supabase
          .from('past_paper')
          .select('id, file_url, file_name, file_type, thumbnail_url, page_count, title, course, year')
          .eq('id', paper.pastPaperId)
          .maybeSingle();
        if (data?.file_url) found = data;
      }

      // Fallback: match by course and year
      if (!found && paper.courseId && paper.year) {
        const { data } = await supabase
          .from('past_paper')
          .select('id, file_url, file_name, file_type, thumbnail_url, page_count, title, course, year')
          .eq('course_id', paper.courseId)
          .eq('year', paper.year)
          .limit(1)
          .maybeSingle();
        if (data?.file_url) found = data;
      }

      // Fallback: check if questions have cropped page images
      if (!found && paper.paperId) {
        const { data: questions } = await supabase
          .from('past_papers')
          .select('image_url')
          .eq('paper_id', paper.paperId)
          .not('image_url', 'is', null)
          .limit(1);
        if (questions && questions[0]?.image_url) {
          found = {
            file_url: questions[0].image_url,
            file_type: 'image',
            file_name: 'Exam Question Scan',
          };
        }
      }

      if (found) {
        setRawPaper(found);
        // Save metadata to localStorage so it loads with 0ms delay next time
        if (paper.paperId) {
          try {
            localStorage.setItem(`sh_file_meta_${paper.paperId}`, JSON.stringify(found));
          } catch {}
        }
      }
    } catch (err) {
      console.warn('[ActualPaperView] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [paper]);

  useEffect(() => {
    fetchPaperFile();
  }, [fetchPaperFile]);

  // Determine file kind
  const fileUrl = rawPaper?.file_url || null;
  const isPdf = useMemo(() => {
    if (!fileUrl) return false;
    const lower = fileUrl.toLowerCase();
    const type = (rawPaper?.file_type || '').toLowerCase();
    return lower.includes('.pdf') || type.includes('pdf');
  }, [fileUrl, rawPaper?.file_type]);

  const isImage = useMemo(() => {
    if (!fileUrl) return false;
    const lower = fileUrl.toLowerCase();
    const type = (rawPaper?.file_type || '').toLowerCase();
    return (
      lower.includes('.jpg') ||
      lower.includes('.jpeg') ||
      lower.includes('.png') ||
      lower.includes('.webp') ||
      type.includes('image') ||
      type.includes('jpg') ||
      type.includes('png')
    );
  }, [fileUrl, rawPaper?.file_type]);

  // 2. If it's a PDF, load the PDF document with Cache API caching
  useEffect(() => {
    if (!isPdf || !fileUrl) {
      setPdfDoc(null);
      return;
    }

    let cancelled = false;
    setPdfLoading(true);
    setPdfError(null);

    (async () => {
      try {
        let pdfSource = { url: fileUrl, disableAutoFetch: true, disableStream: false };

        // Check Cache API first (lightning fast on low network / offline)
        const cachedBuffer = await getCachedDocumentBuffer(fileUrl);
        if (cachedBuffer && !cancelled) {
          pdfSource = { data: cachedBuffer };
        }

        const loadingTask = pdfjs.getDocument(pdfSource);
        const doc = await loadingTask.promise;

        if (!cancelled) {
          setPdfDoc(doc);
          setPdfLoading(false);

          // If not previously cached, fetch and save in background for future offline use
          if (!cachedBuffer && typeof window !== 'undefined' && 'caches' in window) {
            fetch(fileUrl, { mode: 'cors' })
              .then((res) => {
                if (res.ok) saveDocumentToCache(fileUrl, res);
              })
              .catch(() => {});
          }
        } else {
          doc.destroy();
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[ActualPaperView] PDF load error:', err);
          setPdfError(err.message || 'Failed to load paper PDF');
          setPdfLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (pdfDoc) {
        try { pdfDoc.destroy(); } catch (_) {}
      }
    };
  }, [isPdf, fileUrl]);

  // ── Native Pinch-to-Zoom & Pan state ──
  const [zoomScale, setZoomScale] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPinching, setIsPinching] = useState(false);
  const pinchStartDistRef = useRef(0);
  const pinchStartZoomRef = useRef(1.0);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panCurrentRef = useRef({ x: 0, y: 0 });
  const lastTapTimeRef = useRef(0);

  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 2) {
      setIsPinching(true);
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchStartDistRef.current = dist;
      pinchStartZoomRef.current = zoomScale;
    } else if (e.touches.length === 1) {
      // Double tap detection (< 300ms) to reset zoom to default fit-to-width view
      const now = Date.now();
      if (now - lastTapTimeRef.current < 300) {
        setZoomScale(1.0);
        setPan({ x: 0, y: 0 });
        panCurrentRef.current = { x: 0, y: 0 };
        lastTapTimeRef.current = 0;
        return;
      }
      lastTapTimeRef.current = now;

      if (zoomScale > 1.05) {
        panStartRef.current = {
          x: e.touches[0].clientX - panCurrentRef.current.x,
          y: e.touches[0].clientY - panCurrentRef.current.y,
        };
      }
    }
  }, [zoomScale]);

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length === 2 && isPinching) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (pinchStartDistRef.current > 0) {
        const factor = dist / pinchStartDistRef.current;
        const newZoom = Math.min(3.5, Math.max(1.0, pinchStartZoomRef.current * factor));
        setZoomScale(+newZoom.toFixed(2));
      }
    } else if (e.touches.length === 1 && zoomScale > 1.05) {
      const nextX = e.touches[0].clientX - panStartRef.current.x;
      const nextY = e.touches[0].clientY - panStartRef.current.y;
      const maxPan = 280 * (zoomScale - 1);
      const clampedX = Math.max(-maxPan, Math.min(maxPan, nextX));
      const clampedY = Math.max(-maxPan * 1.5, Math.min(maxPan * 1.5, nextY));
      panCurrentRef.current = { x: clampedX, y: clampedY };
      setPan({ x: clampedX, y: clampedY });
    }
  }, [isPinching, zoomScale]);

  const handleTouchEnd = useCallback((e) => {
    if (e.touches.length < 2) {
      setIsPinching(false);
      if (zoomScale <= 1.05) {
        setZoomScale(1.0);
        setPan({ x: 0, y: 0 });
        panCurrentRef.current = { x: 0, y: 0 };
      }
    }
  }, [zoomScale]);

  const [currentPageNumber, setCurrentPageNumber] = useState(1);
  const pageRefs = useRef(new Map());

  // Capture page 1 as a tiny thumbnail dataURL for AI context (scale 0.3 ≈ 50KB JPEG)
  useEffect(() => {
    if (!pdfDoc || !isPdf) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await pdfDoc.getPage(1);
        const viewport = page.getViewport({ scale: 0.3 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) setThumbnailDataUrl(canvas.toDataURL('image/jpeg', 0.7));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [pdfDoc, isPdf]);

  // Track active page via IntersectionObserver as user scrolls through pages
  useEffect(() => {
    if (!isPdf || !pdfDoc) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let bestEntry = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!bestEntry || entry.intersectionRatio > bestEntry.intersectionRatio) {
              bestEntry = entry;
            }
          }
        }
        if (bestEntry) {
          const pNum = Number(bestEntry.target.getAttribute('data-page-number'));
          if (pNum && !isNaN(pNum)) {
            setCurrentPageNumber(pNum);
          }
        }
      },
      { threshold: [0.1, 0.3, 0.6] }
    );

    pageRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [isPdf, pdfDoc]);

  // Compress current page image before sending (max 1280px on long side, 0.7 JPEG)
  const getPageImageBase64 = useCallback(async (pageNum) => {
    if (isPdf && pdfDoc) {
      try {
        const page = await pdfDoc.getPage(pageNum);
        const baseViewport = page.getViewport({ scale: 1.0 });
        const maxDim = Math.max(baseViewport.width, baseViewport.height);
        const targetScale = maxDim > 1280 ? 1280 / maxDim : 1.0;
        const viewport = page.getViewport({ scale: targetScale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        return canvas.toDataURL('image/jpeg', 0.7);
      } catch (err) {
        console.warn('[ActualPaperView] Failed rendering compressed page image fallback:', err);
      }
    } else if (isImage && fileUrl) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = fileUrl;
        });
        const w = img.naturalWidth || img.width || 800;
        const h = img.naturalHeight || img.height || 1000;
        const maxDim = Math.max(w, h);
        const targetScale = maxDim > 1280 ? 1280 / maxDim : 1.0;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * targetScale);
        canvas.height = Math.round(h * targetScale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.7);
      } catch (err) {
        console.debug('[ActualPaperView] Failed converting image to compressed base64 (CORS/network):', err);
      }
    }
    return null;
  }, [isPdf, pdfDoc, isImage, fileUrl]);

  // Keyboard listener for full page escape
  useEffect(() => {
    if (!isFullPage) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsFullPage(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullPage]);

  // ─── Loading State ───
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-3" />
        <p className="text-sm font-semibold text-slate-700">Loading original paper...</p>
        <p className="text-xs text-slate-400 mt-1">Retrieving official scan and document pages</p>
      </div>
    );
  }

  // ─── No File Found ───
  if (!fileUrl) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-lg mx-auto my-8 text-center shadow-sm">
        <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4 text-slate-400">
          <ImageIcon className="w-7 h-7" />
        </div>
        <h3 className="font-bold text-slate-800 text-base">No Scanned Image Attached</h3>
        <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
          The original scan file is not attached to this record, but all questions have been
          digitally extracted and are available to read, solve, and study with AI.
        </p>
        <button
          onClick={onSwitchToText}
          className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all shadow-sm active:scale-95"
        >
          <FileText className="w-4 h-4" />
          Switch to Extracted Text
        </button>
      </div>
    );
  }

  const numPages = pdfDoc?.numPages || 1;
  const pageNumbers = Array.from({ length: numPages }, (_, i) => i + 1);

  return (
    <div ref={containerRef} className="w-full flex flex-col items-center max-w-full overflow-hidden">
      {/* ── Slim Toolbar: Full Page icon button & Ask button on the right ── */}
      <div className="w-full flex items-center justify-end gap-2.5 px-3 sm:px-6 py-2 flex-shrink-0 z-20">
        <button
          type="button"
          onClick={() => {
            setFullPageZoom(1.0);
            setIsFullPage((prev) => !prev);
          }}
          aria-label={isFullPage ? 'Exit full page' : 'Full page'}
          className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-[10px] text-slate-700 hover:text-slate-900 hover:bg-slate-100 active:bg-slate-200 transition-colors cursor-pointer"
          title={isFullPage ? 'Exit full page' : 'Full page'}
        >
          {isFullPage ? (
            <Minimize2 size={18} strokeWidth={1.75} />
          ) : (
            <Maximize2 size={18} strokeWidth={1.75} />
          )}
        </button>

        {onAskPaper && (
          <button
            type="button"
            onClick={async () => {
              const imageBase64 = await getPageImageBase64(currentPageNumber);
              onAskPaper({
                mode: 'page_image',
                type: isPdf ? 'pdf' : 'image',
                pageNumber: currentPageNumber,
                imageBase64: imageBase64 || null,
                thumbnailUrl: imageBase64 || (isPdf ? (thumbnailDataUrl || fileUrl) : fileUrl),
                fileUrl,
                numPages: isPdf ? (pdfDoc?.numPages || 1) : 1,
                paperTitle: `${paper?.courseName || 'Past Paper'}${paper?.year ? ` ${paper.year}` : ''}`,
                paperId: paper?.paperId || paper?.id || rawPaper?.paper_id || rawPaper?.id || null,
              });
            }}
            aria-label="Ask about this paper"
            className="min-h-[40px] h-[38px] px-[14px] text-[14px] font-[500] rounded-[10px] text-blue-600 bg-blue-50 border border-blue-200 active:bg-blue-100 hover:bg-blue-100/60 transition-colors flex items-center gap-1.5 shadow-none outline-none select-none cursor-pointer"
          >
            <GoogleLensIcon size={18} className="text-blue-600" />
            <span>Ask</span>
          </button>
        )}
      </div>

      {/* ── Document Container (Responsive, edge-to-edge on mobile, with pinch-to-zoom) ── */}
      <div
        className="w-full flex flex-col items-center px-1.5 sm:px-4 pb-16 overflow-x-auto max-w-full"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          touchAction: zoomScale > 1.05 ? 'none' : 'pan-y',
        }}
      >
        <div
          className="w-full flex flex-col items-center origin-top"
          style={{
            transform: zoomScale > 1.0 ? `scale(${zoomScale}) translate(${pan.x / zoomScale}px, ${pan.y / zoomScale}px)` : 'none',
            transition: isPinching ? 'none' : 'transform 0.15s ease-out',
          }}
        >
          {isPdf ? (
            pdfLoading ? (
              <div className="flex flex-col items-center justify-center p-14 text-center">
                <Loader2 className="w-7 h-7 text-indigo-600 animate-spin mb-2" />
                <p className="text-xs text-slate-500 font-medium">Rendering PDF pages...</p>
              </div>
            ) : pdfError ? (
              <div className="p-8 text-center bg-rose-50 border border-rose-100 rounded-xl my-4 max-w-md w-full">
                <AlertCircle className="w-6 h-6 text-rose-500 mx-auto mb-2" />
                <p className="text-xs font-bold text-rose-700">Failed to render PDF document</p>
                <p className="text-[11px] text-slate-500 mt-1">{pdfError}</p>
                <button
                  onClick={onSwitchToText}
                  className="mt-3 px-4 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg shadow-sm"
                >
                  View Extracted Text
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center w-full max-w-full">
                {pageNumbers.map((pageNum) => (
                  <div
                    key={pageNum}
                    data-page-number={pageNum}
                    ref={(el) => {
                      if (el) pageRefs.current.set(pageNum, el);
                      else pageRefs.current.delete(pageNum);
                    }}
                    className="w-full flex flex-col items-center"
                  >
                    <PdfPage
                      pdfDoc={pdfDoc}
                      pageNumber={pageNum}
                      scale={scale}
                      containerWidth={containerWidth}
                    />
                  </div>
                ))}
              </div>
            )
          ) : isImage ? (
            <div
              className="group relative bg-white shadow-md rounded-xl overflow-hidden border border-slate-200/90 my-3 sm:my-5 mx-auto w-full cursor-pointer"
              style={{ maxWidth: scale <= 1.0 ? '100%' : `${Math.round(620 * scale)}px` }}
              onClick={() => setIsFullPage(true)}
            >
              {/* Overlay hint to maximize image */}
              <div className="absolute top-3 right-3 z-10 opacity-90 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsFullPage(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-black/75 hover:bg-black text-white text-xs font-semibold rounded-full shadow-lg backdrop-blur-md active:scale-95 transition-all"
                >
                  <Maximize2 size={14} strokeWidth={1.75} className="text-indigo-300" />
                  <span>Tap for Full View</span>
                </button>
              </div>

              <img
                src={fileUrl}
                alt={`${paper?.courseName || 'Past Paper'} original scan`}
                className="w-full h-auto object-contain block mx-auto"
                loading="eager"
              />
            </div>
          ) : (
            <div className="p-8 text-center bg-white border border-slate-200 rounded-xl my-4">
              <p className="text-sm font-semibold text-slate-800">Unsupported preview format</p>
              <button
                onClick={onSwitchToText}
                className="mt-3 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl"
              >
                View Extracted Text
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Full Page Maximize Modal / Lightbox ── */}
      {isFullPage && (
        <div className="fixed inset-0 z-[150] bg-black/95 backdrop-blur-md flex flex-col ed-fade-in select-none">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-black/60 border-b border-white/10 text-white flex-shrink-0 z-20">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setIsFullPage(false)}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 transition-all text-white"
                title="Exit full view (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold truncate">
                  {paper?.courseName || 'Past Paper'}
                </p>
                <p className="text-[10px] sm:text-xs text-white/60">
                  {paper?.year ? `${paper.year} Exam Paper` : 'Original Document'}
                </p>
              </div>
            </div>

            {/* Lightbox controls: exit icon in same spot */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsFullPage(false)}
                aria-label="Exit full page"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-[10px] bg-white/10 hover:bg-white/20 active:scale-95 text-white transition-all cursor-pointer"
                title="Exit full page (Esc)"
              >
                <Minimize2 size={18} strokeWidth={1.75} />
              </button>

              <a
                href={fileUrl}
                download
                target="_blank"
                rel="noreferrer"
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white active:scale-95 transition-all"
                title="Open / Download original file"
              >
                <Download className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Full Screen Content */}
          <div className="flex-1 overflow-auto flex items-center justify-center p-2 sm:p-6 no-scrollbar">
            {isPdf ? (
              <div
                className="flex flex-col items-center gap-6 my-auto"
                style={{ width: `${Math.round(fullPageZoom * 100)}%`, maxWidth: '1000px' }}
              >
                {pageNumbers.map((pageNum) => (
                  <PdfPage
                    key={pageNum}
                    pdfDoc={pdfDoc}
                    pageNumber={pageNum}
                    scale={fullPageZoom * 1.3}
                    containerWidth={1000}
                  />
                ))}
              </div>
            ) : (
              <div
                className="relative flex items-center justify-center my-auto transition-transform duration-150"
                style={{ transform: `scale(${fullPageZoom})`, transformOrigin: 'center center' }}
              >
                <img
                  src={fileUrl}
                  alt={`${paper?.courseName || 'Past Paper'} full page`}
                  className="max-h-[86vh] max-w-[94vw] object-contain rounded-lg shadow-2xl block mx-auto"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
