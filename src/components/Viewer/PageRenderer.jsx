import { useState, useEffect, useRef } from 'react';

export default function PageRenderer({
  pageNum,
  height,
  containerWidth,
  scale,
  requestPage,
  quality = 1.0,
}) {
  const canvasRef = useRef(null);
  const [bitmap, setBitmap] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bmp = await requestPage(pageNum, containerWidth, scale, quality);
      if (!cancelled) setBitmap(bmp);
    })();
    return () => { cancelled = true; };
  }, [pageNum, containerWidth, scale, quality, requestPage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap) return;
    const ctx = canvas.getContext('2d');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    ctx.drawImage(bitmap, 0, 0);
  }, [bitmap]);

  return (
    <div className="page-slot" style={{ height, width: '100%' }}>
      {bitmap ? (
        <canvas
          ref={canvasRef}
          className="page-canvas"
          style={{ maxWidth: '100%', height: 'auto' }}
        />
      ) : (
        <div className="placeholder" />
      )}
    </div>
  );
}