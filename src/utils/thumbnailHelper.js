import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

if (!pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
}

/**
 * Generate a lightweight JPEG data URL thumbnail (~30-50KB) for a PDF or image file.
 * @param {File|Blob} file 
 * @param {number} maxDimension 
 * @returns {Promise<string|null>}
 */
export async function generateFileThumbnail(file, maxDimension = 450) {
  if (!file) return null;

  try {
    // 1. If it's an image file
    if (file.type && file.type.startsWith('image/')) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            let w = img.width;
            let h = img.height;
            if (w > h) {
              if (w > maxDimension) {
                h = Math.round((h * maxDimension) / w);
                w = maxDimension;
              }
            } else {
              if (h > maxDimension) {
                w = Math.round((w * maxDimension) / h);
                h = maxDimension;
              }
            }
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.75));
          };
          img.onerror = () => resolve(null);
          img.src = e.target.result;
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
    }

    // 2. If it's a PDF file
    const isPdf = file.type === 'application/pdf' || (file.name && file.name.toLowerCase().endsWith('.pdf'));
    if (isPdf) {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjs.getDocument({
        data: arrayBuffer,
        disableAutoFetch: true,
        disableStream: true,
      });

      const pdfDoc = await loadingTask.promise;
      const page = await pdfDoc.getPage(1);
      const viewport = page.getViewport({ scale: 1.0 });

      // Scale down to maxDimension
      const scale = Math.min(1.0, maxDimension / Math.max(viewport.width, viewport.height));
      const scaledViewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(scaledViewport.width);
      canvas.height = Math.round(scaledViewport.height);
      const ctx = canvas.getContext('2d');

      await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.75);

      if (pdfDoc.destroy) pdfDoc.destroy();
      return dataUrl;
    }

    return null;
  } catch (err) {
    console.warn('[thumbnailHelper] Failed to generate thumbnail:', err.message);
    return null;
  }
}
