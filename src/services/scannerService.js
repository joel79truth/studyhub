/**
 * scannerService.js
 * Client-side document scanner cleanup & A4 PDF generation.
 *
 * Performance-optimised:
 * - Warm worker pre-load on mount
 * - Early input capping (max 2576 long edge before memory allocation)
 * - Worker direct JPEG encoding (OffscreenCanvas)
 * - Transferable ArrayBuffers
 * - 20-second timeout fallback per page
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
 * Pre-warm the scanner worker early (called on AdminUpload mount)
 */
export function warmScannerWorker() {
  try {
    getScannerWorker().catch((err) => {
      console.warn('[scannerService] Warm-up warning:', err);
    });
  } catch (e) {
    // ignore
  }
}

/**
 * Convert a File or Blob into an ImageData object,
 * capping long edge early to 2576 px to avoid huge memory allocations.
 */
export async function fileToImageData(file) {
  let bitmap;
  // First get original dimensions
  const initialBitmap = await createImageBitmap(file);
  const origW = initialBitmap.width;
  const origH = initialBitmap.height;
  const maxEdge = Math.max(origW, origH);

  let targetW = origW;
  let targetH = origH;

  if (maxEdge > 2576) {
    const scale = 2576 / maxEdge;
    targetW = Math.round(origW * scale);
    targetH = Math.round(origH * scale);
  }

  // If resizing is needed and supported by createImageBitmap
  try {
    if (targetW !== origW || targetH !== origH) {
      bitmap = await createImageBitmap(file, {
        resizeWidth: targetW,
        resizeHeight: targetH,
        resizeQuality: 'high',
      });
      if (typeof initialBitmap.close === 'function') initialBitmap.close();
    } else {
      bitmap = initialBitmap;
    }
  } catch (e) {
    bitmap = initialBitmap;
  }

  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(bitmap.width, bitmap.height)
    : document.createElement('canvas');

  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (typeof bitmap.close === 'function') bitmap.close();

  return { imageData, width: canvas.width, height: canvas.height };
}

/**
 * Clean a single photo using OpenCV in the Web Worker.
 * Includes a 20-second timeout fallback: if cleanup exceeds 20s or fails,
 * it returns useOriginal: true so the upload continues seamlessly.
 */
export async function cleanPhoto(file, onProgress) {
  const originalUrl = URL.createObjectURL(file);
  const CLEANUP_TIMEOUT_MS = 20000; // 20s speed gate fallback

  const runCleanup = async () => {
    onProgress?.({ stage: 'loading_opencv', message: 'Starting document scanner...' });
    const worker = await getScannerWorker();

    onProgress?.({ stage: 'preparing', message: 'Scaling and preparing image...' });
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

    onProgress?.({ stage: 'encoding', message: 'Finalizing preview...' });

    let cleanedBlob = null;
    if (cleanedResult.isJpeg && cleanedResult.jpegBuffer) {
      // Direct JPEG from worker (no extra canvas encode!)
      cleanedBlob = new Blob([cleanedResult.jpegBuffer], { type: 'image/jpeg' });
    } else {
      // Fallback canvas encode
      const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(cleanedResult.width, cleanedResult.height)
        : document.createElement('canvas');

      canvas.width = cleanedResult.width;
      canvas.height = cleanedResult.height;
      const ctx = canvas.getContext('2d');
      const outImgData = new ImageData(cleanedResult.data, cleanedResult.width, cleanedResult.height);
      ctx.putImageData(outImgData, 0, 0);

      if (typeof canvas.convertToBlob === 'function') {
        cleanedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      } else {
        cleanedBlob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
      }
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
  };

  // Timeout promise
  let timeoutTimer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutTimer = setTimeout(() => {
      reject(new Error('Cleanup timed out after 20 seconds; keeping original image'));
    }, CLEANUP_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([runCleanup(), timeoutPromise]);
    clearTimeout(timeoutTimer);
    return result;
  } catch (err) {
    clearTimeout(timeoutTimer);
    console.warn('[scannerService] Cleanup fallback to original:', err.message || err);
    return {
      success: false,
      cleanedBlob: file,
      cleanedUrl: originalUrl,
      originalBlob: file,
      originalUrl,
      useOriginal: true,
      error: err.message || 'Cleanup error',
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
