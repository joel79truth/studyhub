/**
 * scanner.worker.js - High-Performance Document Scanner Web Worker
 * Uses OpenCV.js and jscanify off-thread to clean photos of past papers.
 *
 * Performance-optimised:
 * - Low-res background estimate (4x downscaled, INTER_LINEAR upscale)
 * - Low-res local contrast blur (4x downscaled, INTER_LINEAR upscale)
 * - Coarse-to-fine deskew search (0.25x mask, skip if |angle| < 0.3 deg)
 * - Fast component lookup table and low-res proximity dilation for tidy despeckle
 * - OffscreenCanvas direct JPEG encoding in worker
 * - In-place Mat operations & rigorous memory management
 */

const DEBUG_TIMING = false;

let cvReady = false;
let cvInitPromise = null;

function initOpenCV() {
  if (cvReady) return Promise.resolve();
  if (cvInitPromise) return cvInitPromise;

  cvInitPromise = new Promise((resolve, reject) => {
    try {
      self.Module = {
        onRuntimeInitialized: () => {
          cvReady = true;
          try {
            importScripts('/vendor/jscanify.min.js');
          } catch (e) {
            console.warn('[scanner.worker] jscanify load warning:', e);
          }
          resolve();
        }
      };
      importScripts('/vendor/opencv.js');
    } catch (err) {
      reject(err);
    }
  });

  return cvInitPromise;
}

self.onmessage = async (e) => {
  const { type, id, payload } = e.data || {};

  if (type === 'init') {
    try {
      await initOpenCV();
      self.postMessage({ type: 'ready', id });
    } catch (err) {
      self.postMessage({ type: 'error', id, error: err.message || 'Failed to initialize OpenCV' });
    }
    return;
  }

  if (type === 'process') {
    try {
      await initOpenCV();
      const cv = self.cv || self.Module;
      if (!cv || !cv.Mat) throw new Error('OpenCV runtime unavailable');

      const { imageData, originalWidth, originalHeight } = payload;
      const result = await processDocument(cv, imageData, originalWidth, originalHeight);

      if (result.jpegBuffer) {
        self.postMessage({
          type: 'success',
          id,
          result: {
            width: result.width,
            height: result.height,
            jpegBuffer: result.jpegBuffer,
            isJpeg: true
          }
        }, [result.jpegBuffer]);
      } else {
        self.postMessage({
          type: 'success',
          id,
          result: {
            width: result.width,
            height: result.height,
            data: result.data, // Uint8ClampedArray
            isJpeg: false
          }
        }, [result.data.buffer]);
      }
    } catch (err) {
      console.error('[scanner.worker] processing error:', err);
      self.postMessage({ type: 'error', id, error: err.message || 'Processing failed' });
    }
  }
};

/**
 * Clean a single document photo with optimized stages
 */
async function processDocument(cv, inputImageData, srcW, srcH) {
  const timings = DEBUG_TIMING ? {} : null;
  const tStart = DEBUG_TIMING ? performance.now() : 0;

  // Create cv.Mat from input RGBA
  let src = new cv.Mat(srcH, srcW, cv.CV_8UC4);
  src.data.set(inputImageData.data || inputImageData);

  let paperMat = null;

  // Page-edge detection: jscanify contour detection
  const tEdge = DEBUG_TIMING ? performance.now() : 0;
  try {
    const JScanify = self.jscanify || (typeof jscanify !== 'undefined' ? jscanify : null);
    if (JScanify) {
      const scanner = new JScanify();
      const contour = scanner.findPaperContour(src);
      if (contour) {
        const contourArea = cv.contourArea(contour);
        const totalArea = srcW * srcH;
        if (contourArea >= 0.25 * totalArea) {
          const corners = scanner.getCornerPoints(contour);
          if (corners && corners.topLeftCorner && corners.topRightCorner && corners.bottomLeftCorner && corners.bottomRightCorner) {
            const { topLeftCorner: tl, topRightCorner: tr, bottomLeftCorner: bl, bottomRightCorner: br } = corners;
            const widthA = Math.hypot(br.x - bl.x, br.y - bl.y);
            const widthB = Math.hypot(tr.x - tl.x, tr.y - tl.y);
            const targetW = Math.round(Math.max(widthA, widthB));
            const heightA = Math.hypot(tr.x - br.x, tr.y - br.y);
            const heightB = Math.hypot(tl.x - bl.x, tl.y - bl.y);
            const targetH = Math.round(Math.max(heightA, heightB));

            if (targetW > 100 && targetH > 100) {
              const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, bl.x, bl.y, br.x, br.y]);
              const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, targetW, 0, 0, targetH, targetW, targetH]);
              const M = cv.getPerspectiveTransform(srcPts, dstPts);
              paperMat = new cv.Mat();
              cv.warpPerspective(src, paperMat, M, new cv.Size(targetW, targetH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
              srcPts.delete();
              dstPts.delete();
              M.delete();
            }
          }
        }
        contour.delete();
      }
    }
  } catch (jErr) {
    console.warn('[scanner.worker] Edge detection fallback to full frame:', jErr);
  }
  if (DEBUG_TIMING) timings['edge_detection'] = performance.now() - tEdge;

  if (!paperMat) {
    paperMat = src;
  } else {
    src.delete();
  }

  // Ensure long edge is capped to 2576
  const tResize = DEBUG_TIMING ? performance.now() : 0;
  const curMaxEdge = Math.max(paperMat.cols, paperMat.rows);
  let g = new cv.Mat();

  if (curMaxEdge > 2576) {
    const scale = 2576 / curMaxEdge;
    const targetW = Math.round(paperMat.cols * scale);
    const targetH = Math.round(paperMat.rows * scale);
    let resized = new cv.Mat();
    cv.resize(paperMat, resized, new cv.Size(targetW, targetH), 0, 0, cv.INTER_AREA);
    paperMat.delete();
    cv.cvtColor(resized, g, cv.COLOR_RGBA2GRAY);
    resized.delete();
  } else {
    cv.cvtColor(paperMat, g, cv.COLOR_RGBA2GRAY);
    paperMat.delete();
  }
  if (DEBUG_TIMING) timings['resize_and_gray'] = performance.now() - tResize;

  const w = g.cols;
  const h = g.rows;
  const numPixels = w * h;

  // === OPTIMIZATION 1: Low-res background estimate (4x downscaled) ===
  const tBg = DEBUG_TIMING ? performance.now() : 0;
  const sw = Math.round(w / 4);
  const sh = Math.round(h / 4);

  let gSmall = new cv.Mat();
  cv.resize(g, gSmall, new cv.Size(sw, sh), 0, 0, cv.INTER_AREA);

  // Scaled odd kernels: 31/4 -> 7, 51/4 -> 13, 61/4 -> 15
  let kClose = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7));
  let bgCloseSmall = new cv.Mat();
  cv.morphologyEx(gSmall, bgCloseSmall, cv.MORPH_CLOSE, kClose);
  kClose.delete();

  let bgMedianSmall = new cv.Mat();
  cv.medianBlur(bgCloseSmall, bgMedianSmall, 13);
  bgCloseSmall.delete();

  let bgSmall = new cv.Mat();
  cv.GaussianBlur(bgMedianSmall, bgSmall, new cv.Size(15, 15), 0, 0, cv.BORDER_DEFAULT);
  bgMedianSmall.delete();
  gSmall.delete();

  // Upscale back to full size with INTER_LINEAR
  let bg = new cv.Mat();
  cv.resize(bgSmall, bg, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR);
  bgSmall.delete();

  // Divide full-size g by bg: norm = (g / bg) * 255
  let norm = new cv.Mat();
  cv.divide(g, bg, norm, 255.0, cv.CV_8U);
  bg.delete();
  g.delete();
  if (DEBUG_TIMING) timings['background_estimate'] = performance.now() - tBg;

  // === OPTIMIZATION 1: Low-res local contrast blur ===
  const tContrast = DEBUG_TIMING ? performance.now() : 0;
  let normSmall = new cv.Mat();
  cv.resize(norm, normSmall, new cv.Size(sw, sh), 0, 0, cv.INTER_AREA);

  let blurSmall = new cv.Mat();
  // sigma 25 / 4 = 6.25
  cv.GaussianBlur(normSmall, blurSmall, new cv.Size(0, 0), 6.25, 6.25, cv.BORDER_DEFAULT);
  normSmall.delete();

  let blur = new cv.Mat();
  cv.resize(blurSmall, blur, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR);
  blurSmall.delete();

  let blurF = new cv.Mat();
  let normF = new cv.Mat();
  let diffF = new cv.Mat();
  blur.convertTo(blurF, cv.CV_32F);
  norm.convertTo(normF, cv.CV_32F);
  cv.subtract(blurF, normF, diffF);
  blur.delete();
  blurF.delete();
  normF.delete();
  if (DEBUG_TIMING) timings['local_contrast'] = performance.now() - tContrast;

  // Thresholds 16 (soft) and 48 (strong) - strictly maintained
  const tCC = DEBUG_TIMING ? performance.now() : 0;
  const diffData = diffF.data32F;

  let softMat = new cv.Mat.zeros(h, w, cv.CV_8U);
  const softData = softMat.data;
  const isStrong = new Uint8Array(numPixels);

  for (let idx = 0; idx < numPixels; idx++) {
    const val = diffData[idx];
    if (val > 16) softData[idx] = 255;
    if (val > 48) isStrong[idx] = 1;
  }

  let labels = new cv.Mat();
  let stats = new cv.Mat();
  let centroids = new cv.Mat();
  const n = cv.connectedComponentsWithStats(softMat, labels, stats, centroids, 8, cv.CV_32S);

  const labelsData = labels.data32S;
  const keep = new Uint8Array(n);
  for (let idx = 0; idx < numPixels; idx++) {
    if (isStrong[idx]) {
      keep[labelsData[idx]] = 1;
    }
  }
  keep[0] = 0; // Drop background

  for (let i = 1; i < n; i++) {
    const area = stats.intAt(i, cv.CC_STAT_AREA);
    if (area < 12) {
      keep[i] = 0;
    }
  }

  let maskMat = new cv.Mat.zeros(h, w, cv.CV_8U);
  const maskData = maskMat.data;
  for (let idx = 0; idx < numPixels; idx++) {
    if (keep[labelsData[idx]]) {
      maskData[idx] = 255;
    }
  }

  labels.delete();
  stats.delete();
  centroids.delete();
  softMat.delete();

  let k3 = cv.Mat.ones(3, 3, cv.CV_8U);
  let dilatedMask = new cv.Mat();
  cv.dilate(maskMat, dilatedMask, k3);
  k3.delete();
  maskMat.delete();
  if (DEBUG_TIMING) timings['cc_and_masking'] = performance.now() - tCC;

  // Render text with contrast stretching
  const tRender = DEBUG_TIMING ? performance.now() : 0;
  const dMaskData = dilatedMask.data;
  let outMat = new cv.Mat(h, w, cv.CV_8U);
  const outData = outMat.data;
  const factorInk = 255.0 / 55.0;
  const contrastFactor = 255.0 / (225 - 30);

  for (let idx = 0; idx < numPixels; idx++) {
    if (dMaskData[idx]) {
      let ink = diffData[idx] * factorInk;
      if (ink < 0) ink = 0;
      else if (ink > 255) ink = 255;
      let val = 255 - ink;
      let stretched = (val - 30) * contrastFactor;
      if (stretched < 0) stretched = 0;
      else if (stretched > 255) stretched = 255;
      outData[idx] = Math.round(stretched);
    } else {
      outData[idx] = 255;
    }
  }
  dilatedMask.delete();
  diffF.delete();
  if (DEBUG_TIMING) timings['render'] = performance.now() - tRender;

  // === OPTIMIZATION 2: Coarse-to-fine deskew on 0.25x mask ===
  const tDeskew = DEBUG_TIMING ? performance.now() : 0;
  let darkMask = new cv.Mat.zeros(h, w, cv.CV_8U);
  const darkData = darkMask.data;
  const normData = norm.data;
  for (let idx = 0; idx < numPixels; idx++) {
    if (normData[idx] < 140) {
      darkData[idx] = 255;
    }
  }
  norm.delete();

  let darkSmall = new cv.Mat();
  cv.resize(darkMask, darkSmall, new cv.Size(sw, sh), 0, 0, cv.INTER_NEAREST);
  darkMask.delete();

  const sCenter = new cv.Point(sw / 2, sh / 2);
  let rotSmall = new cv.Mat();

  const evalVariance = (angle) => {
    let rotM = cv.getRotationMatrix2D(sCenter, angle, 1.0);
    cv.warpAffine(darkSmall, rotSmall, rotM, new cv.Size(sw, sh), cv.INTER_NEAREST, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
    rotM.delete();

    const rotData = rotSmall.data;
    let sum = 0;
    let sqSum = 0;
    for (let r = 0; r < sh; r++) {
      let rowSum = 0;
      const rowOffset = r * sw;
      for (let c = 0; c < sw; c++) {
        if (rotData[rowOffset + c]) rowSum++;
      }
      sum += rowSum;
      sqSum += rowSum * rowSum;
    }
    const mean = sum / sh;
    return (sqSum / sh) - (mean * mean);
  };

  // Coarse search: -4 to +4 in 1.0 deg steps (9 steps)
  let coarseBestAngle = 0;
  let maxVar = -1;
  for (let a = -4; a <= 4; a += 1.0) {
    const v = evalVariance(a);
    if (v > maxVar) {
      maxVar = v;
      coarseBestAngle = a;
    }
  }

  // Fine search: +/- 1 around coarse best in 0.1 deg steps (21 steps)
  let bestAngle = coarseBestAngle;
  for (let step = -10; step <= 10; step++) {
    const a = coarseBestAngle + (step * 0.1);
    if (a < -4.0 || a > 4.0) continue;
    const v = evalVariance(a);
    if (v > maxVar) {
      maxVar = v;
      bestAngle = a;
    }
  }
  rotSmall.delete();
  darkSmall.delete();
  if (DEBUG_TIMING) timings['deskew_search'] = performance.now() - tDeskew;

  // Skip rotation entirely if |angle| < 0.3 degrees
  let deskewed = new cv.Mat();
  if (Math.abs(bestAngle) >= 0.3) {
    const center = new cv.Point(w / 2, h / 2);
    let rotMatrix = cv.getRotationMatrix2D(center, bestAngle, 1.0);
    cv.warpAffine(outMat, deskewed, rotMatrix, new cv.Size(w, h), cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
    rotMatrix.delete();
    outMat.delete();
  } else {
    deskewed = outMat;
  }

  // === OPTIMIZATION 7: Faster tidy despeckle with precomputed lookup table ===
  const tTidy = DEBUG_TIMING ? performance.now() : 0;
  const borderX = Math.round(w * 0.02);
  const borderY = Math.round(h * 0.02);
  const dData = deskewed.data;

  // Clear outer 2% margin
  for (let r = 0; r < h; r++) {
    const rowOffset = r * w;
    const isEdgeRow = r < borderY || r >= h - borderY;
    for (let c = 0; c < w; c++) {
      if (isEdgeRow || c < borderX || c >= w - borderX) {
        dData[rowOffset + c] = 255;
      }
    }
  }

  let inkBinary = new cv.Mat.zeros(h, w, cv.CV_8U);
  const inkData = inkBinary.data;
  for (let idx = 0; idx < numPixels; idx++) {
    if (dData[idx] < 240) {
      inkData[idx] = 255;
    }
  }

  let finalLabels = new cv.Mat();
  let finalStats = new cv.Mat();
  let finalCentroids = new cv.Mat();
  const numFinalCC = cv.connectedComponentsWithStats(inkBinary, finalLabels, finalStats, finalCentroids, 8, cv.CV_32S);

  // Fast precomputed component classification (avoids million-call bridge overhead)
  const isMainComponent = new Uint8Array(numFinalCC);
  const removeComponent = new Uint8Array(numFinalCC);
  for (let i = 1; i < numFinalCC; i++) {
    const area = finalStats.intAt(i, cv.CC_STAT_AREA);
    if (area >= 40) isMainComponent[i] = 1;
    else removeComponent[i] = 1;
  }

  let mainInkMask = new cv.Mat.zeros(h, w, cv.CV_8U);
  const mainInkData = mainInkMask.data;
  const finalLblData = finalLabels.data32S;

  for (let idx = 0; idx < numPixels; idx++) {
    const l = finalLblData[idx];
    if (isMainComponent[l]) {
      mainInkData[idx] = 255;
    }
  }

  // Morphological proximity dilation on low-res mask for speed
  let mainSmall = new cv.Mat();
  cv.resize(mainInkMask, mainSmall, new cv.Size(sw, sh), 0, 0, cv.INTER_NEAREST);
  mainInkMask.delete();

  let kNear = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7)); // 31 / 4 ~ 7
  let dilatedSmall = new cv.Mat();
  cv.dilate(mainSmall, dilatedSmall, kNear);
  kNear.delete();
  mainSmall.delete();

  let dilatedMain = new cv.Mat();
  cv.resize(dilatedSmall, dilatedMain, new cv.Size(w, h), 0, 0, cv.INTER_NEAREST);
  dilatedSmall.delete();

  const dMainData = dilatedMain.data;
  for (let idx = 0; idx < numPixels; idx++) {
    const l = finalLblData[idx];
    if (removeComponent[l] && dMainData[idx]) {
      removeComponent[l] = 0; // component is near main text
    }
  }
  dilatedMain.delete();

  for (let idx = 0; idx < numPixels; idx++) {
    const l = finalLblData[idx];
    if (removeComponent[l]) {
      dData[idx] = 255;
    }
  }

  inkBinary.delete();
  finalLabels.delete();
  finalStats.delete();
  finalCentroids.delete();
  if (DEBUG_TIMING) timings['final_tidy'] = performance.now() - tTidy;

  // === OPTIMIZATION 8: Encode JPEG in worker if OffscreenCanvas is available ===
  let jpegBuffer = null;
  const rgbaOut = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < numPixels; i++) {
    const v = dData[i];
    const offset = i * 4;
    rgbaOut[offset] = v;
    rgbaOut[offset + 1] = v;
    rgbaOut[offset + 2] = v;
    rgbaOut[offset + 3] = 255;
  }
  deskewed.delete();

  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const offscreen = new OffscreenCanvas(w, h);
      const ctx = offscreen.getContext('2d');
      const imgData = new ImageData(rgbaOut, w, h);
      ctx.putImageData(imgData, 0, 0);
      if (typeof offscreen.convertToBlob === 'function') {
        const blob = await offscreen.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        jpegBuffer = await blob.arrayBuffer();
      }
    } catch (encErr) {
      console.warn('[scanner.worker] OffscreenCanvas JPEG encode fallback:', encErr);
    }
  }

  if (DEBUG_TIMING) {
    timings['total'] = performance.now() - tStart;
    console.table(timings);
  }

  return {
    width: w,
    height: h,
    jpegBuffer,
    data: rgbaOut
  };
}
