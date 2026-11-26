/**
 * scanner.worker.js - High-Performance Document Scanner Web Worker
 * Uses OpenCV.js and jscanify off-thread to clean photos of past papers.
 *
 * Features:
 * - Downscaled document boundary detection (approxPolyDP convex 4-gon + jscanify fallback)
 * - Perspective distortion correction & unnecessary background crop
 * - Optional manual 90/180/270 deg orientation rotation
 * - Low-res illumination normalization & shadow removal
 * - High-pass ink extraction + dark-fill preservation for diagrams, tables, equations, handwriting
 * - Coarse-to-fine deskew (-7 to +7 deg on 0.25x mask)
 * - Fast component lookup table & proximity despeckle (preserves math dots & subscripts)
 * - OffscreenCanvas direct JPEG encoding in worker + strict Mat memory cleanup
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

      const { imageData, originalWidth, originalHeight, rotationDeg = 0 } = payload;
      const result = await processDocument(cv, imageData, originalWidth, originalHeight, rotationDeg);

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
            data: result.data,
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
 * Order 4 corner points consistently as [topLeft, topRight, bottomRight, bottomLeft]
 */
function orderQuadPoints(pts) {
  if (!pts || pts.length !== 4) return null;
  const sortedBySum = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const tl = sortedBySum[0];
  const br = sortedBySum[3];
  const remaining = [sortedBySum[1], sortedBySum[2]].sort((a, b) => (a.y - a.x) - (b.y - b.x));
  const tr = remaining[0];
  const bl = remaining[1];
  return { tl, tr, br, bl };
}

/**
 * Validate that a 4-point quad forms a sane paper boundary
 */
function isValidPaperQuad(quad, frameW, frameH) {
  if (!quad) return null;
  const { tl, tr, br, bl } = quad;
  const pts = [tl, tr, br, bl];
  for (const p of pts) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    if (p.x < -frameW * 0.05 || p.x > frameW * 1.05 || p.y < -frameH * 0.05 || p.y > frameH * 1.05) {
      return null;
    }
  }

  const widthBottom = Math.hypot(br.x - bl.x, br.y - bl.y);
  const widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const heightRight = Math.hypot(tr.x - br.x, tr.y - br.y);
  const heightLeft = Math.hypot(tl.x - bl.x, tl.y - bl.y);

  const targetW = Math.round(Math.max(widthBottom, widthTop));
  const targetH = Math.round(Math.max(heightRight, heightLeft));
  const minW = Math.min(widthBottom, widthTop);
  const minH = Math.min(heightRight, heightLeft);

  if (targetW < frameW * 0.25 || targetH < frameH * 0.25) return null;
  if (minW < targetW * 0.45 || minH < targetH * 0.45) return null;

  const aspect = Math.max(targetW / Math.max(1, targetH), targetH / Math.max(1, targetW));
  if (aspect > 3.2) return null;

  return { tl, tr, br, bl, targetW, targetH };
}

/**
 * Fast downscaled document boundary detection & perspective warp
 */
function detectAndWarpPaper(cv, src, srcW, srcH) {
  const EDGE_MAX = 520;
  const maxDim = Math.max(srcW, srcH);
  const scale = maxDim > EDGE_MAX ? EDGE_MAX / maxDim : 1;
  const ew = Math.max(64, Math.round(srcW * scale));
  const eh = Math.max(64, Math.round(srcH * scale));
  const totalSmallArea = ew * eh;

  let small = new cv.Mat();
  if (scale < 1) {
    cv.resize(src, small, new cv.Size(ew, eh), 0, 0, cv.INTER_AREA);
  } else {
    small = src.clone();
  }

  let bestQuad = null;

  // Pass 1: Blurred + Morph-closed grayscale Canny + approxPolyDP 4-corner detection
  let smallGray = new cv.Mat();
  let blurred = new cv.Mat();
  let closed = new cv.Mat();
  let edges = new cv.Mat();
  let dilatedEdges = new cv.Mat();
  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();

  try {
    cv.cvtColor(small, smallGray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(smallGray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

    // Suppress internal text lines while keeping outer page border crisp
    const kClose = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
    cv.morphologyEx(blurred, closed, cv.MORPH_CLOSE, kClose);
    kClose.delete();

    cv.Canny(closed, edges, 45, 130);
    const kDil = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(edges, dilatedEdges, kDil);
    kDil.delete();

    cv.findContours(dilatedEdges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    // Inspect top contours by area
    const candidates = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area >= totalSmallArea * 0.22 && area <= totalSmallArea * 0.97) {
        candidates.push({ cnt, area });
      } else {
        cnt.delete();
      }
    }
    candidates.sort((a, b) => b.area - a.area);

    for (let i = 0; i < Math.min(5, candidates.length) && !bestQuad; i++) {
      const { cnt } = candidates[i];
      const peri = cv.arcLength(cnt, true);
      for (const epsFactor of [0.02, 0.03, 0.04, 0.05]) {
        const approx = new cv.Mat();
        cv.approxPolyDP(cnt, approx, epsFactor * peri, true);
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          const pts = [];
          for (let r = 0; r < 4; r++) {
            pts.push({
              x: approx.intAt(r, 0) / scale,
              y: approx.intAt(r, 1) / scale,
            });
          }
          const ordered = orderQuadPoints(pts);
          const valid = isValidPaperQuad(ordered, srcW, srcH);
          if (valid) {
            bestQuad = valid;
            approx.delete();
            break;
          }
        }
        approx.delete();
      }
    }

    for (const c of candidates) {
      c.cnt.delete();
    }
  } catch (err) {
    console.warn('[scanner.worker] Quad edge detection warning:', err);
  } finally {
    smallGray.delete();
    blurred.delete();
    closed.delete();
    edges.delete();
    dilatedEdges.delete();
    contours.delete();
    hierarchy.delete();
  }

  // Pass 2: Fallback to jscanify contour detection on downscaled image
  if (!bestQuad) {
    try {
      const JScanify = self.jscanify || (typeof jscanify !== 'undefined' ? jscanify : null);
      if (JScanify) {
        const scanner = new JScanify();
        const contour = scanner.findPaperContour(small);
        if (contour) {
          const contourArea = cv.contourArea(contour);
          if (contourArea >= 0.25 * totalSmallArea && contourArea <= 0.97 * totalSmallArea) {
            const corners = scanner.getCornerPoints(contour);
            if (
              corners &&
              corners.topLeftCorner &&
              corners.topRightCorner &&
              corners.bottomLeftCorner &&
              corners.bottomRightCorner
            ) {
              const valid = isValidPaperQuad({
                tl: { x: corners.topLeftCorner.x / scale, y: corners.topLeftCorner.y / scale },
                tr: { x: corners.topRightCorner.x / scale, y: corners.topRightCorner.y / scale },
                bl: { x: corners.bottomLeftCorner.x / scale, y: corners.bottomLeftCorner.y / scale },
                br: { x: corners.bottomRightCorner.x / scale, y: corners.bottomRightCorner.y / scale },
              }, srcW, srcH);
              if (valid) bestQuad = valid;
            }
          }
          contour.delete();
        }
      }
    } catch (jErr) {
      console.warn('[scanner.worker] jscanify fallback warning:', jErr);
    }
  }

  small.delete();

  if (!bestQuad) return null;

  const { tl, tr, br, bl, targetW, targetH } = bestQuad;
  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, bl.x, bl.y, br.x, br.y]);
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, targetW, 0, 0, targetH, targetW, targetH]);
  const M = cv.getPerspectiveTransform(srcPts, dstPts);
  const paperMat = new cv.Mat();
  cv.warpPerspective(
    src,
    paperMat,
    M,
    new cv.Size(targetW, targetH),
    cv.INTER_LINEAR,
    cv.BORDER_CONSTANT,
    new cv.Scalar(255, 255, 255, 255)
  );
  srcPts.delete();
  dstPts.delete();
  M.delete();
  return paperMat;
}

/**
 * Clean a single document photo with optimized stages
 */
async function processDocument(cv, inputImageData, srcW, srcH, rotationDeg = 0) {
  const timings = DEBUG_TIMING ? {} : null;
  const tStart = DEBUG_TIMING ? performance.now() : 0;

  let src = new cv.Mat(srcH, srcW, cv.CV_8UC4);
  src.data.set(inputImageData.data || inputImageData);

  // Apply explicit 90/180/270 rotation first if requested
  const normRot = ((Number(rotationDeg) || 0) % 360 + 360) % 360;
  if (normRot === 90 || normRot === 180 || normRot === 270) {
    const rotated = new cv.Mat();
    const rotFlag =
      normRot === 90 ? cv.ROTATE_90_CLOCKWISE
        : normRot === 180 ? cv.ROTATE_180
        : cv.ROTATE_90_COUNTERCLOCKWISE;
    cv.rotate(src, rotated, rotFlag);
    src.delete();
    src = rotated;
  }

  const effW = src.cols;
  const effH = src.rows;

  // Stage 1: Boundary detection & perspective warp
  const tEdge = DEBUG_TIMING ? performance.now() : 0;
  let paperMat = detectAndWarpPaper(cv, src, effW, effH);
  if (DEBUG_TIMING) timings['edge_detection'] = performance.now() - tEdge;

  if (!paperMat) {
    paperMat = src;
  } else {
    src.delete();
  }

  // Cap long edge to 2576 and convert to grayscale
  const tResize = DEBUG_TIMING ? performance.now() : 0;
  const curMaxEdge = Math.max(paperMat.cols, paperMat.rows);
  let g = new cv.Mat();

  if (curMaxEdge > 2576) {
    const scale = 2576 / curMaxEdge;
    const targetW = Math.round(paperMat.cols * scale);
    const targetH = Math.round(paperMat.rows * scale);
    const resized = new cv.Mat();
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

  // Stage 2: Low-res background estimation (4x downscaled) for shadow removal
  const tBg = DEBUG_TIMING ? performance.now() : 0;
  const sw = Math.max(16, Math.round(w / 4));
  const sh = Math.max(16, Math.round(h / 4));

  const gSmall = new cv.Mat();
  cv.resize(g, gSmall, new cv.Size(sw, sh), 0, 0, cv.INTER_AREA);

  const kClose = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7));
  const bgCloseSmall = new cv.Mat();
  cv.morphologyEx(gSmall, bgCloseSmall, cv.MORPH_CLOSE, kClose);
  kClose.delete();

  const bgMedianSmall = new cv.Mat();
  cv.medianBlur(bgCloseSmall, bgMedianSmall, 13);
  bgCloseSmall.delete();

  const bgSmall = new cv.Mat();
  cv.GaussianBlur(bgMedianSmall, bgSmall, new cv.Size(15, 15), 0, 0, cv.BORDER_DEFAULT);
  bgMedianSmall.delete();
  gSmall.delete();

  const bg = new cv.Mat();
  cv.resize(bgSmall, bg, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR);
  bgSmall.delete();

  const norm = new cv.Mat();
  cv.divide(g, bg, norm, 255.0, cv.CV_8U);
  bg.delete();
  g.delete();
  if (DEBUG_TIMING) timings['background_estimate'] = performance.now() - tBg;

  // Stage 3: Local contrast extraction (preserves faint pencil & ink evenly across lighting)
  const tContrast = DEBUG_TIMING ? performance.now() : 0;
  const normSmall = new cv.Mat();
  cv.resize(norm, normSmall, new cv.Size(sw, sh), 0, 0, cv.INTER_AREA);

  const blurSmall = new cv.Mat();
  cv.GaussianBlur(normSmall, blurSmall, new cv.Size(0, 0), 6.25, 6.25, cv.BORDER_DEFAULT);
  normSmall.delete();

  const blur = new cv.Mat();
  cv.resize(blurSmall, blur, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR);
  blurSmall.delete();

  const blurF = new cv.Mat();
  const normF = new cv.Mat();
  const diffF = new cv.Mat();
  blur.convertTo(blurF, cv.CV_32F);
  norm.convertTo(normF, cv.CV_32F);
  cv.subtract(blurF, normF, diffF);
  blur.delete();
  blurF.delete();
  normF.delete();
  if (DEBUG_TIMING) timings['local_contrast'] = performance.now() - tContrast;

  // Stage 4: Hysteresis ink segmentation + solid dark-diagram fill preservation
  const tCC = DEBUG_TIMING ? performance.now() : 0;
  const diffData = diffF.data32F;
  const normData = norm.data;

  const softMat = new cv.Mat.zeros(h, w, cv.CV_8U);
  const softData = softMat.data;
  const isStrong = new Uint8Array(numPixels);

  for (let idx = 0; idx < numPixels; idx++) {
    const val = diffData[idx];
    const nVal = normData[idx];
    // High-pass edges OR genuinely dark normalized ink (preserves filled diagram blocks/table headers)
    if (val > 16 || nVal < 110) softData[idx] = 255;
    if (val > 48 || nVal < 85) isStrong[idx] = 1;
  }

  const labels = new cv.Mat();
  const stats = new cv.Mat();
  const centroids = new cv.Mat();
  const n = cv.connectedComponentsWithStats(softMat, labels, stats, centroids, 8, cv.CV_32S);

  const labelsData = labels.data32S;
  const keep = new Uint8Array(n);
  for (let idx = 0; idx < numPixels; idx++) {
    if (isStrong[idx]) {
      keep[labelsData[idx]] = 1;
    }
  }
  keep[0] = 0;

  // Scale minimum speck threshold by resolution so tiny decimal points/dots stay intact
  const minSoftArea = numPixels >= 2000000 ? 8 : 4;
  for (let i = 1; i < n; i++) {
    const area = stats.intAt(i, cv.CC_STAT_AREA);
    if (area < minSoftArea) {
      keep[i] = 0;
    }
  }

  const maskMat = new cv.Mat.zeros(h, w, cv.CV_8U);
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

  const k3 = cv.Mat.ones(3, 3, cv.CV_8U);
  const dilatedMask = new cv.Mat();
  cv.dilate(maskMat, dilatedMask, k3);
  k3.delete();
  maskMat.delete();
  if (DEBUG_TIMING) timings['cc_and_masking'] = performance.now() - tCC;

  // Render crisp ink on pure white paper background with contrast stretching
  const tRender = DEBUG_TIMING ? performance.now() : 0;
  const dMaskData = dilatedMask.data;
  const outMat = new cv.Mat(h, w, cv.CV_8U);
  const outData = outMat.data;
  const factorInk = 255.0 / 55.0;
  const contrastFactor = 255.0 / (225 - 30);

  for (let idx = 0; idx < numPixels; idx++) {
    if (dMaskData[idx]) {
      const nVal = normData[idx];
      let ink = diffData[idx] * factorInk;
      // Preserve solid dark regions where local diff is smaller than normalized darkness
      const normDarkInk = (255 - nVal) * 1.15;
      if (nVal < 115 && normDarkInk > ink) ink = normDarkInk;
      if (ink < 0) ink = 0;
      else if (ink > 255) ink = 255;
      const val = 255 - ink;
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

  // Stage 5: Coarse-to-fine deskew on 0.25x mask (-7 to +7 degrees)
  const tDeskew = DEBUG_TIMING ? performance.now() : 0;
  const darkMask = new cv.Mat.zeros(h, w, cv.CV_8U);
  const darkData = darkMask.data;
  for (let idx = 0; idx < numPixels; idx++) {
    if (normData[idx] < 140) {
      darkData[idx] = 255;
    }
  }
  norm.delete();

  const darkSmall = new cv.Mat();
  cv.resize(darkMask, darkSmall, new cv.Size(sw, sh), 0, 0, cv.INTER_NEAREST);
  darkMask.delete();

  const sCenter = new cv.Point(sw / 2, sh / 2);
  const rotSmall = new cv.Mat();

  const evalVariance = (angle) => {
    const rotM = cv.getRotationMatrix2D(sCenter, angle, 1.0);
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

  let coarseBestAngle = 0;
  let maxVar = -1;
  for (let a = -7; a <= 7; a += 1.0) {
    const v = evalVariance(a);
    if (v > maxVar) {
      maxVar = v;
      coarseBestAngle = a;
    }
  }

  let bestAngle = coarseBestAngle;
  for (let step = -10; step <= 10; step++) {
    const a = coarseBestAngle + (step * 0.1);
    if (a < -7.0 || a > 7.0) continue;
    const v = evalVariance(a);
    if (v > maxVar) {
      maxVar = v;
      bestAngle = a;
    }
  }
  rotSmall.delete();
  darkSmall.delete();
  if (DEBUG_TIMING) timings['deskew_search'] = performance.now() - tDeskew;

  let deskewed;
  if (Math.abs(bestAngle) >= 0.3) {
    deskewed = new cv.Mat();
    const center = new cv.Point(w / 2, h / 2);
    const rotMatrix = cv.getRotationMatrix2D(center, bestAngle, 1.0);
    cv.warpAffine(outMat, deskewed, rotMatrix, new cv.Size(w, h), cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
    rotMatrix.delete();
    outMat.delete();
  } else {
    deskewed = outMat;
  }

  // Stage 6: Gentle border cleanup (0.8%) + proximity-aware despeckle
  const tTidy = DEBUG_TIMING ? performance.now() : 0;
  const borderX = Math.round(w * 0.008);
  const borderY = Math.round(h * 0.008);
  const dData = deskewed.data;

  for (let r = 0; r < h; r++) {
    const rowOffset = r * w;
    const isEdgeRow = r < borderY || r >= h - borderY;
    for (let c = 0; c < w; c++) {
      if (isEdgeRow || c < borderX || c >= w - borderX) {
        dData[rowOffset + c] = 255;
      }
    }
  }

  const inkBinary = new cv.Mat.zeros(h, w, cv.CV_8U);
  const inkData = inkBinary.data;
  for (let idx = 0; idx < numPixels; idx++) {
    if (dData[idx] < 240) {
      inkData[idx] = 255;
    }
  }

  const finalLabels = new cv.Mat();
  const finalStats = new cv.Mat();
  const finalCentroids = new cv.Mat();
  const numFinalCC = cv.connectedComponentsWithStats(inkBinary, finalLabels, finalStats, finalCentroids, 8, cv.CV_32S);

  const mainAreaThresh = numPixels >= 2000000 ? 32 : 16;
  const isMainComponent = new Uint8Array(numFinalCC);
  const removeComponent = new Uint8Array(numFinalCC);
  for (let i = 1; i < numFinalCC; i++) {
    const area = finalStats.intAt(i, cv.CC_STAT_AREA);
    if (area >= mainAreaThresh) isMainComponent[i] = 1;
    else removeComponent[i] = 1;
  }

  const mainInkMask = new cv.Mat.zeros(h, w, cv.CV_8U);
  const mainInkData = mainInkMask.data;
  const finalLblData = finalLabels.data32S;

  for (let idx = 0; idx < numPixels; idx++) {
    const l = finalLblData[idx];
    if (isMainComponent[l]) {
      mainInkData[idx] = 255;
    }
  }

  const mainSmall = new cv.Mat();
  cv.resize(mainInkMask, mainSmall, new cv.Size(sw, sh), 0, 0, cv.INTER_NEAREST);
  mainInkMask.delete();

  const kNear = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7));
  const dilatedSmall = new cv.Mat();
  cv.dilate(mainSmall, dilatedSmall, kNear);
  kNear.delete();
  mainSmall.delete();

  const dilatedMain = new cv.Mat();
  cv.resize(dilatedSmall, dilatedMain, new cv.Size(w, h), 0, 0, cv.INTER_NEAREST);
  dilatedSmall.delete();

  const dMainData = dilatedMain.data;
  for (let idx = 0; idx < numPixels; idx++) {
    const l = finalLblData[idx];
    if (removeComponent[l] && dMainData[idx]) {
      removeComponent[l] = 0;
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

  // Stage 7: Encode JPEG directly in worker
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
