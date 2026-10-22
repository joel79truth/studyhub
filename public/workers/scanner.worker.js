/**
 * scanner.worker.js - Document Scanner Web Worker
 * Runs OpenCV.js and jscanify off-thread to clean photos of past papers.
 */

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
          // Load jscanify if available
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
      const result = processDocument(cv, imageData, originalWidth, originalHeight);
      self.postMessage({
        type: 'success',
        id,
        result: {
          width: result.width,
          height: result.height,
          data: result.data, // Uint8ClampedArray
        }
      }, [result.data.buffer]);
    } catch (err) {
      console.error('[scanner.worker] processing error:', err);
      self.postMessage({ type: 'error', id, error: err.message || 'Processing failed' });
    }
  }
};

/**
 * Clean a single document photo
 */
function processDocument(cv, inputImageData, srcW, srcH) {
  // Create cv.Mat from raw RGBA ImageData
  let src = new cv.Mat(srcH, srcW, cv.CV_8UC4);
  src.data.set(inputImageData.data || inputImageData);

  let paperMat = null;

  // Page-edge detection: use jscanify before Step 1
  try {
    const JScanify = self.jscanify || (typeof jscanify !== 'undefined' ? jscanify : null);
    if (JScanify) {
      const scanner = new JScanify();
      const contour = scanner.findPaperContour(src);
      if (contour) {
        const contourArea = cv.contourArea(contour);
        const totalArea = srcW * srcH;
        // Accept contour if it spans at least 25% of camera frame
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

  if (!paperMat) {
    paperMat = src;
  } else {
    src.delete();
  }

  // Scale rule: kernel sizes (31, 51, 61) and sigma 25 are in pixels.
  // Process at a long edge of 2576 px.
  const curMaxEdge = Math.max(paperMat.cols, paperMat.rows);
  const scale = 2576 / curMaxEdge;
  const targetW = Math.round(paperMat.cols * scale);
  const targetH = Math.round(paperMat.rows * scale);

  let resized = new cv.Mat();
  cv.resize(paperMat, resized, new cv.Size(targetW, targetH), 0, 0, cv.INTER_AREA);
  paperMat.delete();

  // Convert to grayscale
  let g = new cv.Mat();
  cv.cvtColor(resized, g, cv.COLOR_RGBA2GRAY);
  resized.delete();

  // Step 1: Flatten lighting
  // Kernel sizes scaled if long edge differs from 2576 (here long edge is exactly 2576)
  const kCloseSize = 31;
  const kMedianSize = 51;
  const kGaussSize = 61;
  const sigma = 25;

  let k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(kCloseSize, kCloseSize));
  let bgClose = new cv.Mat();
  cv.morphologyEx(g, bgClose, cv.MORPH_CLOSE, k);
  k.delete();

  let bgMedian = new cv.Mat();
  cv.medianBlur(bgClose, bgMedian, kMedianSize);
  bgClose.delete();

  let bg = new cv.Mat();
  cv.GaussianBlur(bgMedian, bg, new cv.Size(kGaussSize, kGaussSize), 0, 0, cv.BORDER_DEFAULT);
  bgMedian.delete();

  let norm = new cv.Mat();
  cv.divide(g, bg, norm, 255.0, cv.CV_8U);
  bg.delete();
  g.delete();

  // Step 2: Local contrast (positive = darker than surroundings)
  let blur = new cv.Mat();
  cv.GaussianBlur(norm, blur, new cv.Size(0, 0), sigma, sigma, cv.BORDER_DEFAULT);

  let blurF = new cv.Mat();
  let normF = new cv.Mat();
  let diffF = new cv.Mat();
  blur.convertTo(blurF, cv.CV_32F);
  norm.convertTo(normF, cv.CV_32F);
  cv.subtract(blurF, normF, diffF);
  blur.delete();
  blurF.delete();
  normF.delete();

  // Step 3: Keep real ink only, drop faint back-page text
  const h = diffF.rows;
  const w = diffF.cols;
  const numPixels = h * w;
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

  // Step 4: Render
  // ink = np.clip(diff * (255.0/55.0), 0, 255)
  // out = np.where(mask, 255 - ink, 255).astype(np.uint8)
  // out = np.clip((out.astype(np.float32) - 30) * (255.0/(225-30)), 0, 255).astype(np.uint8)
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

  // Step 5: Deskew
  // Try angles -4..+4 in 0.1 steps on a 0.4x downscaled dark-pixel mask (norm < 140)
  // Pick angle with highest variance of row sums, rotate with INTER_CUBIC, borderValue 255
  let darkMask = new cv.Mat.zeros(h, w, cv.CV_8U);
  const darkData = darkMask.data;
  const normData = norm.data;
  for (let idx = 0; idx < numPixels; idx++) {
    if (normData[idx] < 140) {
      darkData[idx] = 255;
    }
  }
  norm.delete();

  const sw = Math.round(w * 0.4);
  const sh = Math.round(h * 0.4);
  let darkSmall = new cv.Mat();
  cv.resize(darkMask, darkSmall, new cv.Size(sw, sh), 0, 0, cv.INTER_NEAREST);
  darkMask.delete();

  const sCenter = new cv.Point(sw / 2, sh / 2);
  let bestAngle = 0;
  let maxVar = -1;
  let rotSmall = new cv.Mat();

  for (let a = -40; a <= 40; a++) {
    const angle = a * 0.1;
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
    const variance = (sqSum / sh) - (mean * mean);
    if (variance > maxVar) {
      maxVar = variance;
      bestAngle = angle;
    }
  }
  rotSmall.delete();
  darkSmall.delete();

  let deskewed = new cv.Mat();
  if (Math.abs(bestAngle) >= 0.05) {
    const center = new cv.Point(w / 2, h / 2);
    let rotMatrix = cv.getRotationMatrix2D(center, bestAngle, 1.0);
    cv.warpAffine(outMat, deskewed, rotMatrix, new cv.Size(w, h), cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
    rotMatrix.delete();
    outMat.delete();
  } else {
    deskewed = outMat;
  }

  // Step 6: Final tidy
  // Outer 2% border set to white (255)
  const borderX = Math.round(w * 0.02);
  const borderY = Math.round(h * 0.02);
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

  // Remove isolated connected components under 40 px not near other ink
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

  let mainInkMask = new cv.Mat.zeros(h, w, cv.CV_8U);
  const mainInkData = mainInkMask.data;
  const finalLblData = finalLabels.data32S;

  for (let idx = 0; idx < numPixels; idx++) {
    const l = finalLblData[idx];
    if (l > 0 && finalStats.intAt(l, cv.CC_STAT_AREA) >= 40) {
      mainInkData[idx] = 255;
    }
  }

  let kNear = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(31, 31));
  let dilatedMain = new cv.Mat();
  cv.dilate(mainInkMask, dilatedMain, kNear);
  kNear.delete();
  mainInkMask.delete();

  const dMainData = dilatedMain.data;
  const removeComponent = new Uint8Array(numFinalCC);
  for (let i = 1; i < numFinalCC; i++) {
    if (finalStats.intAt(i, cv.CC_STAT_AREA) < 40) {
      removeComponent[i] = 1;
    }
  }

  for (let idx = 0; idx < numPixels; idx++) {
    const l = finalLblData[idx];
    if (l > 0 && removeComponent[l] && dMainData[idx]) {
      removeComponent[l] = 0; // component is near other ink
    }
  }
  dilatedMain.delete();

  for (let idx = 0; idx < numPixels; idx++) {
    const l = finalLblData[idx];
    if (l > 0 && removeComponent[l]) {
      dData[idx] = 255;
    }
  }

  inkBinary.delete();
  finalLabels.delete();
  finalStats.delete();
  finalCentroids.delete();

  // Convert to RGBA Uint8ClampedArray for browser consumption
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

  return {
    width: w,
    height: h,
    data: rgbaOut
  };
}
