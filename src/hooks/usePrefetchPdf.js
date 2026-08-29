import { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjs from 'pdfjs-dist';

export function usePrefetchPdf(blobUrl) {
  const [pdf, setPdf] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [renderedPages, setRenderedPages] = useState({}); // pageNum -> ImageBitmap
  const [scale, setScale] = useState(1.0);
  const containerRef = useRef(null);
  const cancelAll = useRef(false);
  // Store render tasks so we can cancel them
  const renderTasks = useRef(new Map()); // pageNum -> renderTask
  const [currentPage, setCurrentPage] = useState(1);

  // ── Load PDF document ──
  useEffect(() => {
    if (!blobUrl) return;

    cancelAll.current = true; // cancel previous loads
    setPdf(null);
    setNumPages(0);
    setRenderedPages({});

    let cancelled = false;
    const load = async () => {
      try {
        const doc = await pdfjs.getDocument(blobUrl).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        setPdf(doc);
        setNumPages(doc.numPages);
      } catch (err) {
        console.error('PDF load error:', err);
      }
    };

    load();
    return () => {
      cancelled = true;
      // Cancel all pending render tasks
      renderTasks.current.forEach(task => task.cancel());
      renderTasks.current.clear();
    };
  }, [blobUrl]);

  // ── Progressive rendering of all pages (with proper cancellation) ──
  useEffect(() => {
    if (!pdf) return;

    // Abort previous render queue
    cancelAll.current = true;
    renderTasks.current.forEach(task => task.cancel());
    renderTasks.current.clear();

    const pages = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
    let cancelled = false;

    const renderNext = async () => {
      for (const pageNum of pages) {
        if (cancelled) break;

        // Skip if already rendering (should not happen after cleanup, but safe)
        if (renderTasks.current.has(pageNum)) continue;

        try {
          const page = await pdf.getPage(pageNum);
          const baseViewport = page.getViewport({ scale: 1 });
          const maxWidth = containerRef.current?.clientWidth || 800;
          const dynScale = (scale * maxWidth) / baseViewport.width;
          const viewport = page.getViewport({ scale: dynScale });

          // Create an offscreen canvas for this page
          const offscreen = document.createElement('canvas');
          offscreen.width = viewport.width;
          offscreen.height = viewport.height;
          const ctx = offscreen.getContext('2d');

          // Store render task to allow cancellation
          const renderTask = page.render({ canvasContext: ctx, viewport });
          renderTasks.current.set(pageNum, renderTask);

          await renderTask.promise;

          if (cancelled) break;

          const bitmap = await createImageBitmap(offscreen);
          if (cancelled) {
            bitmap.close();
            break;
          }

          // Update state: add this bitmap
          setRenderedPages(prev => ({ ...prev, [pageNum]: bitmap }));

          // Remove task from map
          renderTasks.current.delete(pageNum);
        } catch (err) {
          if (err?.name === 'RenderingCancelledException') {
            // Expected after scale change – just clean up
          } else {
            console.error(`Page ${pageNum} render failed:`, err);
          }
          // Remove from map even on error to avoid blocking future retries
          renderTasks.current.delete(pageNum);
        }
      }
    };

    // Start render queue with low priority
    const id = requestIdleCallback ? requestIdleCallback(renderNext) : setTimeout(renderNext, 0);
    return () => {
      cancelled = true;
      cancelIdleCallback ? cancelIdleCallback(id) : clearTimeout(id);
      // Cancel all tasks that are still in the map
      renderTasks.current.forEach(task => task.cancel());
      renderTasks.current.clear();
    };
  }, [pdf, scale]);

  // ── Page tracking via IntersectionObserver ──
  useEffect(() => {
    if (!pdf || numPages === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let best = 0;
        let bestPage = currentPage;
        entries.forEach(entry => {
          const page = Number(entry.target.dataset.page);
          if (entry.intersectionRatio > best) {
            best = entry.intersectionRatio;
            bestPage = page;
          }
        });
        if (best > 0.1) setCurrentPage(bestPage);
      },
      { threshold: [0.1, 0.5, 0.9] }
    );

    const elements = document.querySelectorAll('[data-page]');
    elements.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [pdf, numPages, currentPage]);

  const zoomIn = useCallback(() => setScale(prev => Math.min(2.5, +(prev + 0.2).toFixed(1))), []);
  const zoomOut = useCallback(() => setScale(prev => Math.max(0.5, +(prev - 0.2).toFixed(1))), []);

  return {
    pdf,
    numPages,
    renderedPages,
    scale,
    setScale,
    zoomIn,
    zoomOut,
    currentPage,
    containerRef,
  };
}