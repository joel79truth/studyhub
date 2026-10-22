/**
 * scannerService.js
 * Client-side document scanner cleanup & A4 PDF generation.
 */

let workerInstance = null;
let workerReadyPromise = null;
let nextMsgId = 1;
const pendingRequests = new Map();

/**
 * Dynamically load PDFLib if not already present
 */
export async function loadPdfLib() {
  if (typeof window !== 'undefined' && window.PDFLib) {
    return window.PDFLib;
  }
  return new Promise((resolve, reject) => {
    const existing = document.getElementById('pdf-lib-script');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.PDFLib));
      existing.addEventListener('error', (e) => reject(e));
      if (window.PDFLib) return resolve(window.PDFLib);
      return;
    }
    const script = document.createElement('script');
    script.id = 'pdf-lib-script';
    script.src = '/vendor/pdf-lib.min.js';
    script.onload = () => resolve(window.PDFLib);
    script.onerror = (err) => reject(new Error('Failed to load pdf-lib: ' + err.message));
    document.head.appendChild(script);
  });
}

/**
 * Initialize or reuse the Scanner Web Worker
 */
export function getScannerWorker() {
  if (workerInstance && workerReadyPromise) {
    return workerReadyPromise;
  }

  workerReadyPromise = new Promise((resolve, reject) => {
    try {
      workerInstance = new Worker('/workers/scanner.worker.js');

      workerInstance.onmessage = (e) => {
        const { type, id, result, error } = e.data || {};
        if (type === 'ready') {
          resolve(workerInstance);
          return;
        }
        if (pendingRequests.has(id)) {
          const { res, rej } = pendingRequests.get(id);
          pendingRequests.delete(id);
          if (type === 'success') {
            res(result);
          } else {
            rej(new Error(error || 'Worker processing error'));
          }
        }
      };

      workerInstance.onerror = (err) => {
        console.error('[scannerService] Worker error:', err);
        reject(err);
      };

      workerInstance.postMessage({ type: 'init' });
    } catch (err) {
      reject(err);
    }
  });

  return workerReadyPromise;
}

/**
 * Convert a File or Blob into an ImageData object
 */
export async function fileToImageData(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(bitmap.width, bitmap.height)
    : document.createElement('canvas');

  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  if (typeof bitmap.close === 'function') bitmap.close();
  return { imageData, width: canvas.width, height: canvas.height };
}

/**
 * Clean a single photo using OpenCV in the Web Worker.
 * If cleanup fails for any reason, falls back to original image so upload still succeeds.
 */
export async function cleanPhoto(file, onProgress) {
  const originalUrl = URL.createObjectURL(file);

  try {
    onProgress?.({ stage: 'loading_opencv', message: 'Loading document scanner...' });
    const worker = await getScannerWorker();

    onProgress?.({ stage: 'preparing', message: 'Preparing image...' });
    const { imageData, width, height } = await fileToImageData(file);

    onProgress?.({ stage: 'cleaning', message: 'Flattening lighting & cleaning ink...' });
    const reqId = nextMsgId++;
    const processPromise = new Promise((res, rej) => {
      pendingRequests.set(reqId, { res, rej });
    });

    worker.postMessage({
      type: 'process',
      id: reqId,
      payload: {
        imageData,
        originalWidth: width,
        originalHeight: height,
      }
    }, [imageData.data.buffer]);

    const cleanedResult = await processPromise;

    onProgress?.({ stage: 'encoding', message: 'Rendering preview...' });
    // Convert RGBA Uint8ClampedArray back to JPEG blob
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(cleanedResult.width, cleanedResult.height)
      : document.createElement('canvas');

    canvas.width = cleanedResult.width;
    canvas.height = cleanedResult.height;
    const ctx = canvas.getContext('2d');
    const outImgData = new ImageData(cleanedResult.data, cleanedResult.width, cleanedResult.height);
    ctx.putImageData(outImgData, 0, 0);

    let cleanedBlob = null;
    if (typeof canvas.convertToBlob === 'function') {
      cleanedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    } else {
      cleanedBlob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    }

    const cleanedUrl = URL.createObjectURL(cleanedBlob);

    return {
      success: true,
      cleanedBlob,
      cleanedUrl,
      originalBlob: file,
      originalUrl,
      useOriginal: false,
      width: cleanedResult.width,
      height: cleanedResult.height,
    };
  } catch (err) {
    console.warn('[scannerService] Cleanup failed, falling back to original:', err);
    return {
      success: false,
      cleanedBlob: file,
      cleanedUrl: originalUrl,
      originalBlob: file,
      originalUrl,
      useOriginal: true,
      error: err.message,
    };
  }
}

/**
 * Build one standard A4 PDF from a list of page objects.
 * Uses pdf-lib, fits page inside A4 with white margins, ~0.85 JPEG quality.
 */
export async function buildA4PdfFromPages(pages, filename = 'scanned_paper.pdf') {
  const PDFLib = await loadPdfLib();
  const { PDFDocument } = PDFLib;

  const pdfDoc = await PDFDocument.create();

  // A4 dimensions in points (72 DPI)
  const A4_WIDTH = 595.28;
  const A4_HEIGHT = 841.89;
  const MARGIN = 20; // 20pt white margin on all sides
  const AVAIL_WIDTH = A4_WIDTH - MARGIN * 2;
  const AVAIL_HEIGHT = A4_HEIGHT - MARGIN * 2;

  for (const page of pages) {
    const blobToEmbed = page.useOriginal ? page.originalBlob : page.cleanedBlob;
    const arrayBuffer = await blobToEmbed.arrayBuffer();

    let embeddedImage;
    if (blobToEmbed.type === 'image/png') {
      embeddedImage = await pdfDoc.embedPng(arrayBuffer);
    } else {
      embeddedImage = await pdfDoc.embedJpg(arrayBuffer);
    }

    const imgWidth = embeddedImage.width;
    const imgHeight = embeddedImage.height;

    // Calculate scaling to fit within available page area
    const scale = Math.min(AVAIL_WIDTH / imgWidth, AVAIL_HEIGHT / imgHeight);
    const drawWidth = imgWidth * scale;
    const drawHeight = imgHeight * scale;

    // Center on page
    const x = (A4_WIDTH - drawWidth) / 2;
    const y = (A4_HEIGHT - drawHeight) / 2;

    const pdfPage = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
    pdfPage.drawImage(embeddedImage, {
      x,
      y,
      width: drawWidth,
      height: drawHeight,
    });
  }

  const pdfBytes = await pdfDoc.save();
  return new File([pdfBytes], filename, { type: 'application/pdf' });
}
