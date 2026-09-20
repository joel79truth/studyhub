import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { Sparkles, HelpCircle, FileText } from 'lucide-react';

const PAGE_GAP = 24; // 24px Google-style paper card separation
const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;

export default function PdfViewer({
  pageSizes,
  scale,
  containerWidth,
  pdf,
  currentPage,
  onPageChange,
  renderer,
  onAskSelection,
  onScaleChange,
}) {
  const scrollRef = useRef(null);
  const visiblePagesRef = useRef(new Set());
  const lastScrollTop = useRef(0);
  const directionRef = useRef(0);
  const velocityRef = useRef(0);
  const rafId = useRef(null);
  const lastTime = useRef(Date.now());

  const pageElsRef = useRef(new Map());       // pageNum -> card DOM element
  const textLayerElsRef = useRef(new Map());  // pageNum -> textLayer container DOM element
  const activeTextTasksRef = useRef(new Map()); // pageNum -> TextLayer instance

  const currentPageRef = useRef(currentPage);
  const onPageChangeRef = useRef(onPageChange);
  const rendererRef = useRef(renderer);
  const pdfRef = useRef(pdf);

  // Tracks selection for floating "Ask StudyHub" popover
  const [selectionInfo, setSelectionInfo] = useState(null); // { text, pageNum, rect: { top, left, width, height } }

  // Touch pinch-to-zoom refs
  const touchStateRef = useRef({
    isPinching: false,
    initialDistance: 0,
    initialScale: scale,
    centerX: 0,
    centerY: 0,
  });

  const lastRenderParamsRef = useRef({ scale, containerWidth, dpr: 1 });
  const dprRef = useRef(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { onPageChangeRef.current = onPageChange; }, [onPageChange]);
  useEffect(() => { rendererRef.current = renderer; }, [renderer]);
  useEffect(() => { pdfRef.current = pdf; }, [pdf]);

  // Update renderer with container width and pixel ratio
  useEffect(() => {
    renderer.setContainerWidth(containerWidth);
    renderer.setPixelRatio?.(dprRef.current);
  }, [containerWidth, renderer]);

  // Track devicePixelRatio changes (e.g. moving across displays)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(`(resolution: ${dprRef.current}dppx)`);
    const onChange = () => {
      dprRef.current = window.devicePixelRatio || 1;
      rendererRef.current.setPixelRatio?.(dprRef.current);
      forceRerasterizeVisible();
    };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // Compute unscaled reference base width
  const baseWidth = useMemo(() => pageSizes[0]?.width || 595, [pageSizes]);

  // Calculate layout with proper page widths and vertical card gutters (PAGE_GAP)
  const layout = useMemo(() => {
    if (!containerWidth || pageSizes.length === 0) {
      return { pageHeights: [], pageWidths: [], pageTops: [PAGE_GAP], totalHeight: 0 };
    }

    const fallback = pageSizes[0] || { width: 595, height: 842 };
    const pageHeights = [];
    const pageWidths = [];
    const pageTops = [PAGE_GAP];

    for (let i = 0; i < pageSizes.length; i++) {
      const size = pageSizes[i] || fallback;
      const { width, height } = size;
      // Target display CSS width for this page
      const targetWidth = Math.round((containerWidth * scale * width) / baseWidth);
      const targetHeight = Math.round((targetWidth * height) / width);

      pageWidths.push(targetWidth);
      pageHeights.push(targetHeight);
      pageTops.push(pageTops[i] + targetHeight + PAGE_GAP);
    }

    const totalHeight = pageTops[pageTops.length - 1] || 0;
    return { pageHeights, pageWidths, pageTops, totalHeight };
  }, [pageSizes, containerWidth, scale, baseWidth]);

  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  // ── Render Text Layer for a visible page ────────────────────────────────
  const renderTextLayer = useCallback(async (pageNum) => {
    const doc = pdfRef.current;
    if (!doc) return;

    const container = textLayerElsRef.current.get(pageNum);
    if (!container) return;

    // If already rendered for current scale, skip re-render
    if (container.dataset.renderedScale === String(scale) && container.children.length > 0) {
      return;
    }

    // Cancel any in-flight text layer render for this page
    if (activeTextTasksRef.current.has(pageNum)) {
      try {
        activeTextTasksRef.current.get(pageNum).cancel();
      } catch (_) {}
      activeTextTasksRef.current.delete(pageNum);
    }

    try {
      const page = await doc.getPage(pageNum);
      const { pageWidths } = layoutRef.current;
      const targetCssWidth = pageWidths[pageNum - 1] || containerWidth;
      const basePageWidth = page.view ? page.view[2] - page.view[0] : 595;
      const viewportScale = targetCssWidth / basePageWidth;
      const viewport = page.getViewport({ scale: viewportScale });

      container.innerHTML = '';
      container.style.width = `${Math.round(viewport.width)}px`;
      container.style.height = `${Math.round(viewport.height)}px`;
      container.style.setProperty('--total-scale-factor', viewport.scale);
      if (pdfjs.setLayerDimensions) {
        try { pdfjs.setLayerDimensions(container, viewport); } catch (_) {}
      }

      const textContent = await page.getTextContent();
      const textLayer = new pdfjs.TextLayer({
        textContentSource: textContent,
        container,
        viewport,
      });

      activeTextTasksRef.current.set(pageNum, textLayer);
      await textLayer.render();
      container.dataset.renderedScale = String(scale);
    } catch (err) {
      if (err?.name !== 'AbortException' && err?.name !== 'RenderingCancelledException') {
        // Silently catch cancellations during scroll
      }
    } finally {
      activeTextTasksRef.current.delete(pageNum);
    }
  }, [containerWidth, scale]);

  // ── Update View & Virtualization ─────────────────────────────────────────
  const updateView = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const { pageTops, totalHeight } = layoutRef.current;
    const renderer = rendererRef.current;
    const containerHeight = container.clientHeight;

    if (containerHeight === 0) {
      setTimeout(() => {
        if (rafId.current) cancelAnimationFrame(rafId.current);
        rafId.current = requestAnimationFrame(() => {
          rafId.current = null;
          updateView();
        });
      }, 50);
      return;
    }

    const scrollTop = container.scrollTop;
    const now = Date.now();
    const dt = now - lastTime.current;
    if (dt > 0) velocityRef.current = Math.abs(scrollTop - lastScrollTop.current) / dt;
    lastTime.current = now;

    if (scrollTop > lastScrollTop.current) directionRef.current = 1;
    else if (scrollTop < lastScrollTop.current) directionRef.current = -1;
    else directionRef.current = 0;
    lastScrollTop.current = scrollTop;

    const viewTop = scrollTop;
    const viewBottom = scrollTop + containerHeight;
    const overscan = containerHeight * (0.6 + Math.min(velocityRef.current * 2, 1.6));

    const newVisible = new Set();
    const pageCount = pageSizes.length;
    for (let i = 0; i < pageCount; i++) {
      const top = pageTops[i];
      const bottom = pageTops[i + 1] - PAGE_GAP;
      if (bottom >= viewTop - overscan && top <= viewBottom + overscan) {
        newVisible.add(i + 1);
      }
    }

    // Detach canvases for pages leaving viewport
    visiblePagesRef.current.forEach((p) => {
      if (!newVisible.has(p)) {
        renderer.detachCanvas(p);
      }
    });

    // Attach canvases and render text layers for newly visible pages
    newVisible.forEach((p) => {
      if (!visiblePagesRef.current.has(p)) {
        const el = pageElsRef.current.get(p);
        if (el) {
          renderer.attachCanvas(p, el);
          renderTextLayer(p);
        }
      }
    });
    visiblePagesRef.current = newVisible;
    renderer.setVisiblePages?.(Array.from(newVisible));

    // Calculate current page (closest to center of viewport)
    const center = viewTop + containerHeight / 2;
    let current = 1;
    let minDist = Infinity;
    for (let i = 0; i < pageCount; i++) {
      const pageCenter = (pageTops[i] + pageTops[i + 1] - PAGE_GAP) / 2;
      const dist = Math.abs(pageCenter - center);
      if (dist < minDist) {
        minDist = dist;
        current = i + 1;
      }
    }
    if (current !== currentPageRef.current) {
      onPageChangeRef.current(current);
    }
  }, [pageSizes.length, renderTextLayer]);

  const scheduleUpdate = useCallback(() => {
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      updateView();
    });
  }, [updateView]);

  const forceRerasterizeVisible = useCallback(() => {
    const renderer = rendererRef.current;
    visiblePagesRef.current.forEach((p) => {
      renderer.detachCanvas(p);
      // Clean up textLayer data so it re-renders at new scale
      const tEl = textLayerElsRef.current.get(p);
      if (tEl) {
        tEl.innerHTML = '';
        delete tEl.dataset.renderedScale;
      }
    });
    visiblePagesRef.current = new Set();
    scheduleUpdate();
  }, [scheduleUpdate]);

  // Scroll listener
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => scheduleUpdate();
    container.addEventListener('scroll', onScroll, { passive: true });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => scheduleUpdate());
    });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, [scheduleUpdate]);

  // Re-run visibility on layout/scale/size updates
  useEffect(() => {
    if (layout.pageHeights.length === 0) return;

    const prev = lastRenderParamsRef.current;
    const paramsChanged = prev.scale !== scale || prev.containerWidth !== containerWidth;
    lastRenderParamsRef.current = { scale, containerWidth, dpr: dprRef.current };

    if (paramsChanged && visiblePagesRef.current.size > 0) {
      forceRerasterizeVisible();
      return;
    }

    const id = setTimeout(() => scheduleUpdate(), 0);
    return () => clearTimeout(id);
  }, [layout, scale, containerWidth, scheduleUpdate, forceRerasterizeVisible]);

  // ── Text Selection & Floating "Ask StudyHub" Bar ────────────────────────
  const checkTextSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setSelectionInfo(null);
      return;
    }

    const selectedText = sel.toString().trim();
    if (selectedText.length < 2) {
      setSelectionInfo(null);
      return;
    }

    // Check if selection anchor is within one of our text layers
    let node = sel.anchorNode;
    let textLayerEl = null;
    while (node && node !== document.body) {
      if (node.classList && node.classList.contains('textLayer')) {
        textLayerEl = node;
        break;
      }
      node = node.parentNode;
    }

    if (!textLayerEl) {
      setSelectionInfo(null);
      return;
    }

    const pageNum = parseInt(textLayerEl.dataset.page, 10) || currentPageRef.current;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (rect.width === 0 && rect.height === 0) {
      setSelectionInfo(null);
      return;
    }

    setSelectionInfo({
      text: selectedText,
      pageNum,
      rect: {
        top: Math.max(12, rect.top - 10),
        left: rect.left + rect.width / 2,
        width: rect.width,
        height: rect.height,
      },
    });
  }, []);

  useEffect(() => {
    const handleMouseUp = () => {
      setTimeout(checkTextSelection, 30);
    };
    const handleKeyUp = () => {
      setTimeout(checkTextSelection, 30);
    };
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setSelectionInfo(null);
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('touchend', handleMouseUp);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [checkTextSelection]);

  // ── Touch Pinch-to-Zoom Gesture ──────────────────────────────────────────
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        touchStateRef.current = {
          isPinching: true,
          initialDistance: dist,
          initialScale: scale,
          centerX: (t1.clientX + t2.clientX) / 2,
          centerY: (t1.clientY + t2.clientY) / 2,
        };
      }
    };

    const onTouchMove = (e) => {
      if (!touchStateRef.current.isPinching || e.touches.length !== 2) return;
      e.preventDefault(); // Prevent default browser zoom to handle custom smooth PDF zoom

      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const ratio = dist / (touchStateRef.current.initialDistance || 1);
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, +(touchStateRef.current.initialScale * ratio).toFixed(2)));

      if (Math.abs(nextScale - scale) > 0.04 && onScaleChange) {
        onScaleChange(nextScale);
      }
    };

    const onTouchEnd = (e) => {
      if (touchStateRef.current.isPinching && e.touches.length < 2) {
        touchStateRef.current.isPinching = false;
      }
    };

    // Desktop Trackpad Pinch / Ctrl+Wheel
    const onWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = -e.deltaY * 0.005;
        const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, +(scale + delta).toFixed(2)));
        if (onScaleChange) onScaleChange(nextScale);
      }
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('wheel', onWheel);
    };
  }, [scale, onScaleChange]);

  const setPageEl = useCallback((pageNum, el) => {
    if (el) pageElsRef.current.set(pageNum, el);
    else pageElsRef.current.delete(pageNum);
  }, []);

  const setTextLayerEl = useCallback((pageNum, el) => {
    if (el) {
      textLayerElsRef.current.set(pageNum, el);
      // Re-trigger text render if page is already visible
      if (visiblePagesRef.current.has(pageNum)) {
        renderTextLayer(pageNum);
      }
    } else {
      textLayerElsRef.current.delete(pageNum);
    }
  }, [renderTextLayer]);

  const handleActionClick = (actionType) => {
    if (!selectionInfo) return;
    const { text, pageNum } = selectionInfo;
    setSelectionInfo(null);
    window.getSelection()?.removeAllRanges();

    if (onAskSelection) {
      onAskSelection(text, pageNum, actionType);
    }
  };

  return (
    <div ref={scrollRef} className="pdf-scroll-viewport">
      {/* Total vertical scroll space with pages absolutely positioned */}
      <div
        style={{
          height: layout.totalHeight,
          position: 'relative',
          minWidth: '100%',
          width: 'fit-content',
          margin: '0 auto',
          paddingBottom: 40,
        }}
      >
        {pageSizes.map((_, i) => {
          const pageNum = i + 1;
          const top = layout.pageTops[i];
          const height = layout.pageHeights[i] || 800;
          const width = layout.pageWidths[i] || (containerWidth * scale);
          const isActive = pageNum === currentPage;

          return (
            <div
              key={pageNum}
              data-page={pageNum}
              ref={(el) => setPageEl(pageNum, el)}
              className={`pdf-page-card ${isActive ? 'is-active' : ''}`}
              style={{
                position: 'absolute',
                top,
                left: '50%',
                transform: 'translateX(-50%)',
                width,
                height,
              }}
            >
              {/* Text Layer (pdfjs text elements for crisp selection) */}
              <div
                ref={(el) => setTextLayerEl(pageNum, el)}
                data-page={pageNum}
                className="textLayer"
              />

              {/* Page Number Ribbon (subtle Google-style page indicator) */}
              <div className="page-number-pill">
                Page {pageNum} of {pageSizes.length}
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating "Ask StudyHub" Popover Bar */}
      {selectionInfo && (
        <div
          className="selection-ask-popover"
          style={{
            top: selectionInfo.rect.top,
            left: selectionInfo.rect.left,
          }}
          onMouseDown={(e) => e.preventDefault()} // Prevent losing selection on click
        >
          <button
            type="button"
            className="selection-ask-btn-primary"
            onClick={() => handleActionClick('ask')}
          >
            <Sparkles size={14} />
            Ask StudyHub
          </button>
          <button
            type="button"
            className="selection-ask-btn-secondary"
            onClick={() => handleActionClick('explain')}
          >
            <HelpCircle size={13} />
            Explain
          </button>
          <button
            type="button"
            className="selection-ask-btn-secondary"
            onClick={() => handleActionClick('summarize')}
          >
            <FileText size={13} />
            Summary
          </button>
          <div className="selection-ask-arrow" />
        </div>
      )}
    </div>
  );
}