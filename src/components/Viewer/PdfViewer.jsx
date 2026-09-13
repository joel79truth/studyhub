import { useEffect, useRef, useCallback, useMemo } from 'react';

export default function PdfViewer({
  pageSizes,
  scale,
  containerWidth,
  pdf,
  currentPage,
  onPageChange,
  renderer,
}) {
  const scrollRef = useRef(null);
  const visiblePagesRef = useRef(new Set());
  const lastScrollTop = useRef(0);
  const directionRef = useRef(0);
  const velocityRef = useRef(0);
  const rafId = useRef(null);
  const lastTime = useRef(Date.now());
  const pageElsRef = useRef(new Map()); // pageNum -> placeholder element, avoids querySelector

  // Latest-value refs so the scroll listener effect never needs to
  // depend on fast-changing props/callbacks and therefore never gets
  // torn down mid-scroll (which was cancelling in-flight updates and
  // causing pages to never get attached).
  const currentPageRef = useRef(currentPage);
  const onPageChangeRef = useRef(onPageChange);
  const rendererRef = useRef(renderer);
  const layoutRef = useRef({ pageSizes, pageHeights: [], pageTops: [0] });

  // Tracks the (scale, containerWidth, devicePixelRatio) combination each
  // currently-attached canvas was last rasterized at. Repositioning a page
  // (scrolling) should never force a repaint; changing its target
  // resolution (zoom, container resize, moving the window to a different
  // DPR display) always should.
  const lastRenderParamsRef = useRef({ scale, containerWidth, dpr: 1 });
  const dprRef = useRef(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { onPageChangeRef.current = onPageChange; }, [onPageChange]);
  useEffect(() => { rendererRef.current = renderer; }, [renderer]);

  // Update renderer with container width
  useEffect(() => {
    renderer.setContainerWidth(containerWidth);
    // Let the renderer know the true pixel ratio so it can rasterize at
    // native resolution instead of CSS-pixel resolution. Optional chaining
    // keeps this a no-op if the renderer hasn't implemented it yet, but a
    // canvas-based viewer needs this to match Chrome/Drive's crispness.
    renderer.setPixelRatio?.(dprRef.current);
  }, [containerWidth, renderer]);

  // Track devicePixelRatio changes (e.g. dragging the window between a
  // standard and a HiDPI monitor). matchMedia fires once per ratio change
  // and we re-subscribe with the new ratio each time.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pageHeights = useMemo(() => {
    if (!containerWidth || pageSizes.length === 0) return [];
    const fallback = pageSizes[0]; // page 1 is always measured first and available
    return pageSizes.map((size) => {
      const { width, height } = size || fallback || { width: 1, height: 1.414 }; // last-resort A4-ish ratio
      return (containerWidth * scale * height) / width;
    });
  }, [pageSizes, containerWidth, scale]);

  const pageTops = useMemo(() => {
    const tops = [0];
    for (let i = 0; i < pageHeights.length; i++) tops.push(tops[i] + pageHeights[i]);
    return tops;
  }, [pageHeights]);

  useEffect(() => {
    layoutRef.current = { pageSizes, pageHeights, pageTops };
  }, [pageSizes, pageHeights, pageTops]);

  const totalHeight = pageTops[pageTops.length - 1] || 0;

  // Stable across the component's lifetime — reads everything it
  // needs from refs, so its identity never has to change and the
  // scroll listener never has to be rebuilt.
  const updateView = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const { pageSizes, pageTops } = layoutRef.current;
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
    // Scale overscan with scroll velocity: fast flings pre-attach a wider
    // band so pages are already painted by the time they reach the
    // viewport, matching the "never see a blank page" feel of Drive/Chrome.
    const overscan = containerHeight * (0.5 + Math.min(velocityRef.current * 2, 1.5));

    const newVisible = new Set();
    for (let i = 0; i < pageSizes.length; i++) {
      const top = pageTops[i];
      const bottom = pageTops[i + 1];
      if (bottom >= viewTop - overscan && top <= viewBottom + overscan) newVisible.add(i + 1);
    }

    // Detach non-visible pages
    visiblePagesRef.current.forEach((p) => {
      if (!newVisible.has(p)) {
        renderer.detachCanvas(p);
      }
    });

    // Attach newly visible pages
    newVisible.forEach((p) => {
      if (!visiblePagesRef.current.has(p)) {
        const el = pageElsRef.current.get(p);
        if (el) {
          renderer.attachCanvas(p, el);
        } else {
          console.warn(`Placeholder not found for page ${p}`);
        }
      }
    });
    visiblePagesRef.current = newVisible;

    // Let the renderer's canvas pool know what's actually on screen,
    // so eviction never steals a canvas from a visible page even
    // under pool pressure.
    renderer.setVisiblePages?.(Array.from(newVisible));

    // Calculate current page (center of viewport)
    const center = viewTop + containerHeight / 2;
    let current = 1, minDist = Infinity;
    for (let i = 0; i < pageSizes.length; i++) {
      const pageCenter = (pageTops[i] + pageTops[i + 1]) / 2;
      const dist = Math.abs(pageCenter - center);
      if (dist < minDist) { minDist = dist; current = i + 1; }
    }
    if (current !== currentPageRef.current) onPageChangeRef.current(current);
  }, []); // stable forever — everything it needs comes from refs

  const scheduleUpdate = useCallback(() => {
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      updateView();
    });
  }, [updateView]);

  // Forces every currently-visible page to detach and re-attach, so the
  // renderer repaints it at the current scale/DPR instead of leaving a
  // stale bitmap that the browser just stretches with CSS (the cause of
  // "zooming makes it blurry" — a repositioned canvas is not a
  // repainted canvas).
  const forceRerasterizeVisible = useCallback(() => {
    const renderer = rendererRef.current;
    visiblePagesRef.current.forEach((p) => renderer.detachCanvas(p));
    visiblePagesRef.current = new Set();
    scheduleUpdate();
  }, [scheduleUpdate]);

  // Attach scroll listener exactly once. Since updateView and
  // scheduleUpdate are now stable, this effect never tears down
  // mid-scroll, so an in-flight visibility update never gets
  // cancelled by cancelAnimationFrame before it can attach pages.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => scheduleUpdate();
    container.addEventListener('scroll', onScroll, { passive: true });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scheduleUpdate();
      });
    });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, [scheduleUpdate]);

  // Re-run visibility whenever layout actually changes (page sizes
  // loaded/updated, zoom changed, container resized). If scale or
  // containerWidth specifically changed — not just pageSizes arriving for
  // the first time — force a repaint of whatever's already on screen.
  useEffect(() => {
    if (pageHeights.length === 0) return;

    const prev = lastRenderParamsRef.current;
    const paramsChanged = prev.scale !== scale || prev.containerWidth !== containerWidth;
    lastRenderParamsRef.current = { scale, containerWidth, dpr: dprRef.current };

    if (paramsChanged && visiblePagesRef.current.size > 0) {
      forceRerasterizeVisible();
      return;
    }

    const id = setTimeout(() => scheduleUpdate(), 0);
    return () => clearTimeout(id);
  }, [pageHeights, scale, containerWidth, scheduleUpdate, forceRerasterizeVisible]);

  const setPageEl = useCallback((pageNum, el) => {
    if (el) pageElsRef.current.set(pageNum, el);
    else pageElsRef.current.delete(pageNum);
  }, []);

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        background: '#e2e5ea',
        position: 'relative',
        scrollbarWidth: 'none',
        padding: '20px 0',
        minHeight: 0,
      }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {pageSizes.map((_, i) => {
          const pageNum = i + 1;
          const top = pageTops[i];
          const height = pageHeights[i];
          return (
            <div
              key={pageNum}
              data-page={pageNum}
              ref={(el) => setPageEl(pageNum, el)}
              style={{
                position: 'absolute', top, left: 0, right: 0, height,
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                boxShadow: '0 1px 4px rgba(0,0,0,.15)',
                background: '#fff',
              }}
              className="page-slot"
            />
          );
        })}
      </div>
    </div>
  );
}