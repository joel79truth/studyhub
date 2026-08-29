import { useRef, useCallback, useEffect, useMemo } from 'react';
import { useMemoryPressure } from './useMemoryPressure';

const DEBUG = false; // flip on only when actively debugging
const log = DEBUG ? console.log.bind(console) : () => {};

const MAX_POOL_SIZE = 24; // generous buffer above typical virtualization window
const DPR = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

export function usePdfRenderer(pdf, scale, baseWidth) {
  const cacheLimit = useMemoryPressure();
  const cache = useRef(new Map());
  const tasks = useRef(new Map());
  const queue = useRef([]);
  const activeRender = useRef(false);
  const containerWidthRef = useRef(800);
  const scaleRef = useRef(scale);
  const baseWidthRef = useRef(baseWidth);
  const pool = useRef([]);
  const processQueueRef = useRef(() => {}); // avoids closure-ordering issues entirely
  const visiblePagesRef = useRef(new Set()); // pages PdfViewer says are currently on screen

  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { baseWidthRef.current = baseWidth; }, [baseWidth]);

  useEffect(() => {
    log('📏 usePdfRenderer: pdf exists?', !!pdf, '| scale:', scale, '| baseWidth:', baseWidth);
  }, [pdf, scale, baseWidth]);

  // ---- drawToCanvas ----
  const drawToCanvas = useCallback((bitmap, canvas) => {
    const ctx = canvas.getContext('2d');
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    ctx.drawImage(bitmap, 0, 0);
  }, []);

  // ---- Pool management ----
  const getFreeCanvas = useCallback(
    () => pool.current.find(c => !c.attachedToPage),
    []
  );

  const detachCanvas = useCallback((pageNum) => {
    const item = pool.current.find(c => c.attachedToPage === pageNum);
    if (item) {
      log(`🔌 Detaching canvas for page ${pageNum}`);
      if (item.canvas.parentNode) item.canvas.parentNode.removeChild(item.canvas);
      item.attachedToPage = null;
      // Keep pixels – no clearing
    }
  }, []);

  // New public API — PdfViewer calls this whenever its visible range
  // changes. Used below to make sure eviction never steals a canvas
  // from a page that's actually on screen right now.
  const setVisiblePages = useCallback((pageNumbers) => {
    visiblePagesRef.current = new Set(pageNumbers);
  }, []);

  // Picks the attached page whose canvas should be sacrificed: the one
  // that's been touched least recently AND is furthest from the page
  // currently being requested — and never a page that's currently
  // visible, regardless of distance/age. This is the fix for pages
  // going blank while scrolling.
  const pickEvictionTarget = useCallback((requestedPageNum) => {
    let best = null;
    let bestScore = -Infinity;
    const now = Date.now();
    for (const item of pool.current) {
      if (item.attachedToPage === null) continue;
      if (visiblePagesRef.current.has(item.attachedToPage)) continue; // never evict what's on screen
      const distance = Math.abs(item.attachedToPage - requestedPageNum);
      const age = now - (item.lastUsed || 0);
      // Weight distance heavily — never prefer evicting a near page
      // over a far one just because it was touched a moment later.
      const score = distance * 100000 + age;
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return best; // null if every attached page is currently visible
  }, []);

  // ---- Cache management ----
  const cacheSet = useCallback((pageNum, bitmap, renderScale) => {
    if (cache.current.size >= cacheLimit) {
      let oldestKey = null;
      let oldestTime = Infinity;
      cache.current.forEach((val, key) => {
        if (val.timestamp < oldestTime) {
          oldestTime = val.timestamp;
          oldestKey = key;
        }
      });
      if (oldestKey) {
        cache.current.get(oldestKey).bitmap.close();
        cache.current.delete(oldestKey);
      }
    }
    cache.current.set(pageNum, { bitmap, renderScale, timestamp: Date.now() });
  }, [cacheLimit]);

  const cancelTask = useCallback((pageNum) => {
    if (tasks.current.has(pageNum)) {
      tasks.current.get(pageNum)();
      tasks.current.delete(pageNum);
    }
  }, []);

  // ---- Actual rendering (heavy, offscreen) ----
  const renderPageAtQuality = useCallback(async (pageNum, quality) => {
    if (!pdf) return null;

    const cw = containerWidthRef.current;
    const bw = baseWidthRef.current;
    if (cw === 0 || bw === 0) {
      log(`⚠️ renderPageAtQuality: width zero (cw=${cw}, bw=${bw}) – retrying in 100ms`);
      setTimeout(() => {
        const existing = queue.current.find(item => item.pageNum === pageNum);
        if (!existing) {
          queue.current.push({ pageNum, quality, priority: 0 });
          processQueueRef.current();
        }
      }, 100);
      return null;
    }

    const renderScale = (cw * scaleRef.current * quality * DPR) / bw;
    if (renderScale <= 0) return null;

    const cached = cache.current.get(pageNum);
    if (cached && Math.abs(cached.renderScale - renderScale) / renderScale < 0.03) {
      cached.timestamp = Date.now();
      log(`💾 Cache hit for page ${pageNum}`);
      return cached.bitmap;
    }

    cancelTask(pageNum);

    let cancelled = false;
    tasks.current.set(pageNum, () => { cancelled = true; });

    try {
      log(`🖼️ Rendering page ${pageNum} at scale ${renderScale.toFixed(2)} (quality ${quality}, DPR ${DPR})`);
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: renderScale });

      const offCanvas = document.createElement('canvas');
      offCanvas.width = viewport.width;
      offCanvas.height = viewport.height;
      const ctx = offCanvas.getContext('2d');

      const renderTask = page.render({ canvasContext: ctx, viewport });
      tasks.current.set(pageNum, () => {
        renderTask.cancel();
        cancelled = true;
      });

      await renderTask.promise;
      if (cancelled) return null;

      const bitmap = await createImageBitmap(offCanvas);
      if (cancelled) {
        bitmap.close();
        return null;
      }

      cacheSet(pageNum, bitmap, renderScale);
      log(`✅ Page ${pageNum} rendered`);
      return bitmap;
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error(`❌ Page ${pageNum} render error:`, err);
      }
      return null;
    } finally {
      tasks.current.delete(pageNum);
    }
  }, [pdf, cacheSet, cancelTask]);

  // ---- Queue processing with yielding ----
  const processQueue = useCallback(async () => {
    if (activeRender.current || queue.current.length === 0) return;
    activeRender.current = true;

    queue.current.sort((a, b) => a.priority - b.priority);

    while (queue.current.length > 0) {
      const { pageNum, quality } = queue.current.shift();

      const item = pool.current.find(c => c.attachedToPage === pageNum);
      if (!item) continue;

      const cached = cache.current.get(pageNum);
      if (cached && Math.abs(cached.renderScale - ((containerWidthRef.current * scaleRef.current * quality * DPR) / baseWidthRef.current)) / cached.renderScale < 0.03) {
        cached.timestamp = Date.now();
        drawToCanvas(cached.bitmap, item.canvas);
        log(`🎨 Drew cached page ${pageNum} (from queue)`);
        continue;
      }

      const bitmap = await renderPageAtQuality(pageNum, quality);
      const currentItem = pool.current.find(c => c.attachedToPage === pageNum);
      if (currentItem && bitmap) {
        drawToCanvas(bitmap, currentItem.canvas);
        log(`🎨 Drew page ${pageNum}`);

        if (quality < 1) {
          queue.current.push({ pageNum, quality: 1, priority: 1 });
        }
      }

      await new Promise(resolve => setTimeout(resolve, 0));
    }

    activeRender.current = false;
  }, [renderPageAtQuality, drawToCanvas]);

  useEffect(() => { processQueueRef.current = processQueue; }, [processQueue]);

  // ---- Schedule render (public API) ----
  const scheduleRender = useCallback((pageNum, quality, priority) => {
    queue.current = queue.current.filter(item => item.pageNum !== pageNum);
    queue.current.push({ pageNum, quality, priority });
    if (!activeRender.current) {
      setTimeout(() => processQueueRef.current(), 0);
    }
  }, []);

  // ---- Attach canvas ----
  const attachCanvas = useCallback((pageNum, placeholder) => {
    const existing = pool.current.find(c => c.attachedToPage === pageNum);
    if (existing) {
      existing.lastUsed = Date.now();
      if (existing.canvas.parentNode !== placeholder) {
        placeholder.appendChild(existing.canvas);
      }
      return existing.canvas;
    }

    let free = getFreeCanvas();
    if (!free) {
      if (pool.current.length < MAX_POOL_SIZE) {
        const canvas = document.createElement('canvas');
        canvas.className = 'page-canvas';
        canvas.style.maxWidth = '100%';
        canvas.style.height = 'auto';
        free = { canvas, attachedToPage: null, lastUsed: 0 };
        pool.current.push(free);
      } else {
        const target = pickEvictionTarget(pageNum);
        if (target) {
          detachCanvas(target.attachedToPage);
          free = target;
          free.attachedToPage = null;
        } else {
          // Every pooled canvas is currently visible and we're at cap —
          // grow the pool rather than silently failing to render this
          // page. Should be rare; if this fires a lot, MAX_POOL_SIZE is
          // smaller than the viewer's actual visible+overscan window.
          log(`⚠️ Pool exhausted with no evictable target — growing pool for page ${pageNum}`);
          const canvas = document.createElement('canvas');
          canvas.className = 'page-canvas';
          canvas.style.maxWidth = '100%';
          canvas.style.height = 'auto';
          free = { canvas, attachedToPage: null, lastUsed: 0 };
          pool.current.push(free);
        }
      }
    }

    if (!free) return null;
    placeholder.appendChild(free.canvas);
    free.attachedToPage = pageNum;
    free.lastUsed = Date.now();
    log(`✅ Attached canvas for page ${pageNum}`);

    const cached = cache.current.get(pageNum);
    if (cached) {
      drawToCanvas(cached.bitmap, free.canvas);
      log(`⚡ Instantly drew cached page ${pageNum}`);
    } else {
      scheduleRender(pageNum, 0.6, 0);
    }
    return free.canvas;
  }, [getFreeCanvas, detachCanvas, drawToCanvas, scheduleRender, pickEvictionTarget]);

  // ---- Set container width ----
  const setContainerWidth = useCallback((w) => {
    if (containerWidthRef.current !== w) {
      log(`📏 Container width updated to ${w}px`);
      containerWidthRef.current = w;
      pool.current.forEach(item => {
        if (item.attachedToPage !== null) {
          scheduleRender(item.attachedToPage, 1, 0);
        }
      });
    }
  }, [scheduleRender]);

  // ---- Cleanup ----
  useEffect(() => {
    return () => {
      tasks.current.forEach(fn => fn());
      cache.current.forEach(entry => entry.bitmap.close());
      cache.current.clear();
    };
  }, []);

  // Stable object identity across renders — PdfViewer's updateView
  // depends on `renderer`, and without this memo a new object literal
  // here would be a new dependency every render even though every
  // individual function is already stable via useCallback.
  return useMemo(() => ({
    attachCanvas,
    detachCanvas,
    scheduleRender,
    setContainerWidth,
    setVisiblePages,
  }), [attachCanvas, detachCanvas, scheduleRender, setContainerWidth, setVisiblePages]);
}