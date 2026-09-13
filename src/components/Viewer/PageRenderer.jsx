import { useState, useEffect, useRef } from 'react';

// NOTE ON ARCHITECTURE
// ---------------------
// PdfViewer.jsx does not render this component — it renders bare
// placeholder <div>s and hands them to an imperative `renderer` object
// (renderer.attachCanvas / renderer.detachCanvas) that owns a pool of
// canvases and moves them between page slots. That's the right call for a
// long scrolling document: it avoids mounting/unmounting a fresh <canvas>
// (and losing its bitmap) every time a page scrolls in and out of the
// overscan band.
//
// This component is a *self-contained* alternative for cases where you
// want a single page rendered as an ordinary React component — e.g. a
// thumbnail strip, a "page N of M" single-page mode, or a print preview —
// where React owning the mount/unmount lifecycle is fine because there's
// no pool to manage. Keep it if you use it for one of those; otherwise
// delete it so nobody wires it into the scrolling view by mistake and gets
// two competing rendering strategies for the same pages.

export default function PageRenderer({
  pageNum,
  height,
  containerWidth,
  scale,
  requestPage,
  quality = 1.0,
}) {
  const canvasRef = useRef(null);
  const bitmapRef = useRef(null); // for cleanup — state alone can't tell us the *previous* bitmap to close
  const [bitmap, setBitmap] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bmp = await requestPage(pageNum, containerWidth, scale, quality);
      if (cancelled) {
        // Request finished after this page scrolled away or params
        // changed again — release it immediately instead of leaking it.
        bmp?.close?.();
        return;
      }
      setBitmap(bmp);
    })();
    return () => { cancelled = true; };
  }, [pageNum, containerWidth, scale, quality, requestPage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap) return;

    // requestPage is expected to rasterize at physical (device) pixels
    // already — that's the buffer we draw into. The element's CSS size is
    // set separately to the *logical* target width so the browser doesn't
    // rescale a lower-res buffer up (blurry) or shrink a higher-res one
    // without us intending it (wasted paint).
    const dpr = window.devicePixelRatio || 1;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.style.width = `${bitmap.width / dpr}px`;
    canvas.style.height = `${bitmap.height / dpr}px`;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);

    // Release the previous bitmap now that it's off-canvas. ImageBitmap
    // holds real GPU/CPU memory until closed — without this, scrolling
    // through a long document silently accumulates one bitmap per page
    // ever rendered.
    if (bitmapRef.current && bitmapRef.current !== bitmap) {
      bitmapRef.current.close?.();
    }
    bitmapRef.current = bitmap;
  }, [bitmap]);

  useEffect(() => {
    return () => {
      bitmapRef.current?.close?.();
      bitmapRef.current = null;
    };
  }, []);

  return (
    <div className="page-slot" style={{ height, width: '100%', display: 'flex', justifyContent: 'center' }}>
      {bitmap ? (
        <canvas
          ref={canvasRef}
          className="page-canvas"
          style={{ maxWidth: '100%', boxShadow: '0 1px 4px rgba(0,0,0,.15)' }}
        />
      ) : (
        <div
          className="placeholder"
          style={{ width: '100%', height: '100%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.1)' }}
        />
      )}
    </div>
  );
}