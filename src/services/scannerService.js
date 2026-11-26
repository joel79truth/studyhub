/**
 * scannerService.js
 * Client-side document scanner cleanup & A4 PDF generation.
 *
 * Performance & low-end mobile optimisations:
 * - Lazy worker warm-up (only when Past Papers scanner/images are used)
 * - Single-decode resize via canvas (avoids double memory spike & EXIF resize quirks)
 * - Adaptive resolution cap on <=2GB RAM devices (2048px vs 2576px)
 * - Direct JPEG encoding in Web Worker with Transferable ArrayBuffers
 * - 25-second timeout fallback per page + safe original fallback
 * - Explicit rotation helper for user orientation correction
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
      if (window.PDFLib) return resolve(window.PDFLib);
      existing.addEventListener('load', () => resolve(window.PDFLib), { once: true });
      existing.addEventListener('error', (e) => reject(e), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = 'pdf-lib-script';
    script.src = '/vendor/pdf-lib.min.js';
    script.onload = () => resolve(window.PDFLib);
    script.onerror = (err) => reject(new Error('Failed to load pdf-lib: ' + (err?.message || 'network error')));
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
        workerReadyPromise = null;
        workerInstance = null;
        for (const [, pending] of pendingRequests) {
          pending.rej(new Error('Document scanner worker failed'));
        }
        pendingRequests.clear();
        reject(err);
      };

      workerInstance.postMessage({ type: 'init' });
    } catch (err) {
      workerReadyPromise = null;
      workerInstance = null;
      reject(err);
    }
  });

  return workerReadyPromise;
}

/**
 * Pre-warm the scanner worker when Past Papers scanner/image flow is opened
 */
export function warmScannerWorker() {
  try {
    getScannerWorker().catch((err) => {
      console.warn('[scannerService] Warm-up warning:', err);
    });
  } catch {
    // ignore
  }
}

/**
 * Decode an image Blob/File into a single downscaled Canvas/ImageData without double-decoding.
 */
async function decodeImageSource(file) {
  const isLowMem = typeof navigator !== 'undefined' && navigator.deviceMemory && navigator.deviceMemory <= 2;
  const maxLongEdge = isLowMem ? 2048 : 2576;

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    try {
      const origW = bitmap.width;
      const origH = bitmap.height;
      const maxEdge = Math.max(origW, origH);
      let targetW = origW;
      let targetH = origH;

      if (maxEdge > maxLongEdge) {
        const scale = maxLongEdge / maxEdge;
        targetW = Math.max(1, Math.round(origW * scale));
        targetH = Math.max(1, Math.round(origH * scale));
      }

      const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(targetW, targetH)
        : document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      const imageData = ctx.getImageData(0, 0, targetW, targetH);
      return { imageData, width: targetW, height: targetH };
    } finally {
      if (typeof bitmap.close === 'function') bitmap.close();
    }
  }

  // Fallback for browsers without createImageBitmap
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image'));
      el.src = url;
    });

    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;
    const maxEdge = Math.max(origW, origH);
    let targetW = origW;
    let targetH = origH;

    if (maxEdge > maxLongEdge) {
      const scale = maxLongEdge / maxEdge;
      targetW = Math.max(1, Math.round(origW * scale));
      targetH = Math.max(1, Math.round(origH * scale));
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, targetW, targetH);
    const imageData = ctx.getImageData(0, 0, targetW, targetH);
    return { imageData, width: targetW, height: targetH };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function fileToImageData(file) {
  return decodeImageSource(file);
}

/**
 * Rotate any image Blob/File by 90/180/270 degrees (used for manual orientation fix on original fallback)
 */
export async function rotateImageBlob(blob, degrees = 90) {
  const normDeg = ((Number(degrees) || 0) % 360 + 360) % 360;
  if (normDeg === 0) return blob;

  const { imageData, width, height } = await decodeImageSource(blob);
  const srcCanvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;
  srcCanvas.getContext('2d').putImageData(imageData, 0, 0);

  const swap = normDeg === 90 || normDeg === 270;
  const dstW = swap ? height : width;
  const dstH = swap ? width : height;

  const dstCanvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(dstW, dstH)
    : document.createElement('canvas');
  dstCanvas.width = dstW;
  dstCanvas.height = dstH;

  const ctx = dstCanvas.getContext('2d');
  ctx.translate(dstW / 2, dstH / 2);
  ctx.rotate((normDeg * Math.PI) / 180);
  ctx.drawImage(srcCanvas, -width / 2, -height / 2);

  if (typeof dstCanvas.convertToBlob === 'function') {
    return dstCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
  }
  return new Promise((r) => dstCanvas.toBlob(r, 'image/jpeg', 0.88));
}

/**
 * Compress an oversized raw image before embedding in PDF (prevents low-end phone OOM)
 */
async function ensureEmbeddableImageBytes(blob) {
  const MAX_RAW_EMBED_BYTES = 2.5 * 1024 * 1024;
  const isJpegOrPng = blob.type === 'image/jpeg' || blob.type === 'image/jpg' || blob.type === 'image/png';
  if (isJpegOrPng && blob.size <= MAX_RAW_EMBED_BYTES) {
    return { bytes: await blob.arrayBuffer(), isPng: blob.type === 'image/png' };
  }

  const { imageData, width, height } = await decodeImageSource(blob);
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);

  let jpegBlob;
  if (typeof canvas.convertToBlob === 'function') {
    jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  } else {
    jpegBlob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  }
  return { bytes: await jpegBlob.arrayBuffer(), isPng: false };
}

/**
 * Clean a single photo using OpenCV in the Web Worker.
 * Includes a 25-second timeout fallback: if cleanup exceeds 25s or fails,
 * it returns useOriginal: true so the upload continues seamlessly.
 */
export async function cleanPhoto(file, onProgress, { rotationDeg = 0 } = {}) {
  const originalUrl = URL.createObjectURL(file);
  const CLEANUP_TIMEOUT_MS = 25000;

  const runCleanup = async () => {
    onProgress?.({ stage: 'loading_opencv', message: 'Starting scanner...' });
    const worker = await getScannerWorker();

    onProgress?.({ stage: 'preparing', message: 'Preparing page...' });
    const { imageData, width, height } = await fileToImageData(file);

    onProgress?.({ stage: 'cleaning', message: 'Detecting edges & cleaning...' });
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
        rotationDeg,
      }
    }, [imageData.data.buffer]);

    const cleanedResult = await processPromise;

    onProgress?.({ stage: 'encoding', message: 'Rendering preview...' });

    let cleanedBlob;
    if (cleanedResult.isJpeg && cleanedResult.jpegBuffer) {
      cleanedBlob = new Blob([cleanedResult.jpegBuffer], { type: 'image/jpeg' });
    } else {
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

  let timeoutTimer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutTimer = setTimeout(() => {
      reject(new Error('Cleanup timed out; keeping original image'));
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
  const MARGIN = 20;
  const AVAIL_WIDTH = A4_WIDTH - MARGIN * 2;
  const AVAIL_HEIGHT = A4_HEIGHT - MARGIN * 2;

  for (const page of pages) {
    let blobToEmbed = page.useOriginal ? page.originalBlob : page.cleanedBlob;
    if (page.useOriginal && page.rotationDeg) {
      blobToEmbed = await rotateImageBlob(blobToEmbed, page.rotationDeg);
    }

    const { bytes, isPng } = await ensureEmbeddableImageBytes(blobToEmbed);
    const embeddedImage = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);

    const imgWidth = embeddedImage.width;
    const imgHeight = embeddedImage.height;

    const scale = Math.min(AVAIL_WIDTH / imgWidth, AVAIL_HEIGHT / imgHeight);
    const drawWidth = imgWidth * scale;
    const drawHeight = imgHeight * scale;

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
