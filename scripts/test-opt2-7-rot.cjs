/**
 * scripts/test-opt2-7.cjs
 * Test Optimizations 1, 2, and 7:
 * Opt 1: Low-res smooth compute
 * Opt 2: Coarse-to-fine deskew (-4..+4 in 1.0 deg steps on 0.25x mask, refine +/-1 in 0.1 steps, skip if < 0.3 deg)
 * Opt 7: Cheaper tidy (run on low-res mask or single CC pass)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sharp = require('sharp');

function loadOpenCV() {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ctx = {
      console,
      setTimeout,
      clearTimeout,
      performance,
      require,
      Buffer,
      Uint8Array,
      Uint8ClampedArray,
      Float32Array,
      Int32Array,
      Math,
      WebAssembly,
      TextDecoder,
    };
    ctx.document = { currentScript: null, title: '' };
    ctx.location = { href: 'http://localhost/' };
    ctx.window = ctx;
    ctx.self = ctx;
    ctx.global = ctx;

    ctx.Module = {
      onRuntimeInitialized: () => {
        const t1 = performance.now();
        const cv = ctx.cv || ctx.Module;
        try {
          const jscanifyCode = fs.readFileSync(path.resolve(__dirname, '../public/vendor/jscanify.min.js'), 'utf8');
          vm.runInNewContext(jscanifyCode, ctx);
        } catch (e) {
          console.warn('jscanify load warning:', e);
        }
        resolve({ cv, jscanify: ctx.jscanify, initTimeMs: t1 - t0 });
      }
    };

    const opencvCode = fs.readFileSync(path.resolve(__dirname, '../public/vendor/opencv.js'), 'utf8');
    vm.runInNewContext(opencvCode, ctx);
  });
}

function calculateMetrics(bufA, bufB, width, height) {
  let sumAbsDiff = 0;
  const n = width * height;

  let sumA = 0;
  let sumB = 0;
  let sumA2 = 0;
  let sumB2 = 0;
  let sumAB = 0;

  for (let i = 0; i < n; i++) {
    const a = bufA[i];
    const b = bufB[i];
    sumAbsDiff += Math.abs(a - b);

    sumA += a;
    sumB += b;
    sumA2 += a * a;
    sumB2 += b * b;
    sumAB += a * b;
  }

  const mae = sumAbsDiff / n;
  const meanA = sumA / n;
  const meanB = sumB / n;
  const varA = (sumA2 / n) - (meanA * meanA);
  const varB = (sumB2 / n) - (meanB * meanB);
  const covAB = (sumAB / n) - (meanA * meanB);

  const c1 = 6.5025;
  const c2 = 58.5225;

  const ssim = ((2 * meanA * meanB + c1) * (2 * covAB + c2)) /
               ((meanA * meanA + meanB * meanB + c1) * (varA + varB + c2));

  return { mae, ssim };
}

async function run() {
  console.log('--- Loading OpenCV ---');
  const { cv, jscanify } = await loadOpenCV();
  console.log('OpenCV ready');

  const testPhotoPath = 'C:/Users/Joel M/Pictures/2025-01-29/2220.jpg';
  const { data: raw2220, info } = await sharp(testPhotoPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const baselineRaw = await sharp('test-output/baseline.png').grayscale().raw().toBuffer();

  const timings = {};
  const tTotalStart = performance.now();

  let src = new cv.Mat(info.height, info.width, cv.CV_8UC4);
  src.data.set(raw2220);

  let paperMat = null;
  const tEdgeStart = performance.now();
  if (jscanify) {
    const scanner = new jscanify();
    const contour = scanner.findPaperContour(src);
    if (contour) {
      const contourArea = cv.contourArea(contour);
      const totalArea = info.width * info.height;
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
  timings['edge_detection'] = performance.now() - tEdgeStart;

  if (!paperMat) paperMat = src;
  else src.delete();

  const curMaxEdge = Math.max(paperMat.cols, paperMat.rows);
  const scale = 2576 / curMaxEdge;
  const targetW = Math.round(paperMat.cols * scale);
  const targetH = Math.round(paperMat.rows * scale);

  let resized = new cv.Mat();
  cv.resize(paperMat, resized, new cv.Size(targetW, targetH), 0, 0, cv.INTER_AREA);
  paperMat.delete();

  let g = new cv.Mat();
  cv.cvtColor(resized, g, cv.COLOR_RGBA2GRAY);
  resized.delete();

  const w = g.cols;
  const h = g.rows;
  const sw = Math.round(w / 4);
  const sh = Math.round(h / 4);

  // === OPT 1: Low-res background estimate ===
  const tBgStart = performance.now();
  let gSmall = new cv.Mat();
  cv.resize(g, gSmall, new cv.Size(sw, sh), 0, 0, cv.INTER_AREA);

  let k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7));
  let bgCloseSmall = new cv.Mat();
  cv.morphologyEx(gSmall, bgCloseSmall, cv.MORPH_CLOSE, k);
  k.delete();

  let bgMedianSmall = new cv.Mat();
  cv.medianBlur(bgCloseSmall, bgMedianSmall, 13);
  bgCloseSmall.delete();

  let bgSmall = new cv.Mat();
  cv.GaussianBlur(bgMedianSmall, bgSmall, new cv.Size(15, 15), 0, 0, cv.BORDER_DEFAULT);
  bgMedianSmall.delete();
  gSmall.delete();

  let bg = new cv.Mat();
  cv.resize(bgSmall, bg, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR);
  bgSmall.delete();

  let norm = new cv.Mat();
  cv.divide(g, bg, norm, 255.0, cv.CV_8U);
  bg.delete();
  g.delete();
  timings['background_estimate'] = performance.now() - tBgStart;

  // === OPT 1: Low-res local contrast blur ===
  const tContrastStart = performance.now();
  let normSmall = new cv.Mat();
  cv.resize(norm, normSmall, new cv.Size(sw, sh), 0, 0, cv.INTER_AREA);

  let blurSmall = new cv.Mat();
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
  timings['local_contrast'] = performance.now() - tContrastStart;

  // CC and Masking (soft: 16, strong: 48)
  const tCCStart = performance.now();
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
    if (isStrong[idx]) keep[labelsData[idx]] = 1;
  }
  keep[0] = 0;

  for (let i = 1; i < n; i++) {
    const area = stats.intAt(i, cv.CC_STAT_AREA);
    if (area < 12) keep[i] = 0;
  }

  let maskMat = new cv.Mat.zeros(h, w, cv.CV_8U);
  const maskData = maskMat.data;
  for (let idx = 0; idx < numPixels; idx++) {
    if (keep[labelsData[idx]]) maskData[idx] = 255;
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
  timings['cc_and_masking'] = performance.now() - tCCStart;

  // Render
  const tRenderStart = performance.now();
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
  timings['render'] = performance.now() - tRenderStart;

  // === OPT 2: Coarse-to-fine deskew on 0.25x mask ===
  const tDeskewStart = performance.now();
  let darkMask = new cv.Mat.zeros(h, w, cv.CV_8U);
  const darkData = darkMask.data;
  const normData = norm.data;
  for (let idx = 0; idx < numPixels; idx++) {
    if (normData[idx] < 140) darkData[idx] = 255;
  }
  norm.delete();

  // Downscale to 0.25x (sw, sh)
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

  // Coarse search: -4 to +4 in 1.0 steps
  let coarseBestAngle = 0;
  let maxVar = -1;
  for (let a = -4; a <= 4; a += 1.0) {
    const v = evalVariance(a);
    if (v > maxVar) {
      maxVar = v;
      coarseBestAngle = a;
    }
  }

  // Fine search: +/- 1 around coarse best in 0.1 steps
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
  timings['deskew_search'] = performance.now() - tDeskewStart;

  // Skip rotation if |angle| < 0.3 degrees
  const tRotateStart = performance.now();
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
  timings['rotate'] = performance.now() - tRotateStart;

  // === OPT 7: Cheaper tidy despeckle ===
  // 1) Border wipe (2% outer edges)
  const tTidyStart = performance.now();
  const borderX = Math.round(w * 0.02);
  const borderY = Math.round(h * 0.02);
  const dData = deskewed.data;

  for (let r = 0; r < h; r++) {
    const rowOffset = r * w;
    const isEdgeRow = r < borderY || r >= h - borderY;
    for (let c = 0; c < w; c++) {
      if (isEdgeRow || c < borderX || c >= w - borderX) dData[rowOffset + c] = 255;
    }
  }

  // 2) Run CC once on low-res mask (0.25x) to find isolated speckles:
  // Ink is where pixel < 240
  let inkSmall = new cv.Mat.zeros(sh, sw, cv.CV_8U);
  const inkSmallData = inkSmall.data;
  // Sample or downscale:
  for (let r = 0; r < sh; r++) {
    const fullR = r * 4;
    const rowOffset = fullR * w;
    const sOffset = r * sw;
    for (let c = 0; c < sw; c++) {
      if (dData[rowOffset + c * 4] < 240) {
        inkSmallData[sOffset + c] = 255;
      }
    }
  }

  let finalLabels = new cv.Mat();
  let finalStats = new cv.Mat();
  let finalCentroids = new cv.Mat();
  const numFinalCC = cv.connectedComponentsWithStats(inkSmall, finalLabels, finalStats, finalCentroids, 8, cv.CV_32S);

  // Components with area < 3 in low-res (~48 in full res) are speckles
  let mainInkSmall = new cv.Mat.zeros(sh, sw, cv.CV_8U);
  const mainInkData = mainInkSmall.data;
  const finalLblData = finalLabels.data32S;
  const numSmallPixels = sh * sw;

  for (let idx = 0; idx < numSmallPixels; idx++) {
    const l = finalLblData[idx];
    if (l > 0 && finalStats.intAt(l, cv.CC_STAT_AREA) >= 3) {
      mainInkData[idx] = 255;
    }
  }

  let kNear = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7)); // 31 / 4 ~ 7
  let dilatedMain = new cv.Mat();
  cv.dilate(mainInkSmall, dilatedMain, kNear);
  kNear.delete();
  mainInkSmall.delete();

  const dMainData = dilatedMain.data;
  const removeComponent = new Uint8Array(numFinalCC);
  for (let i = 1; i < numFinalCC; i++) {
    if (finalStats.intAt(i, cv.CC_STAT_AREA) < 3) {
      removeComponent[i] = 1;
    }
  }

  for (let idx = 0; idx < numSmallPixels; idx++) {
    const l = finalLblData[idx];
    if (l > 0 && removeComponent[l] && dMainData[idx]) {
      removeComponent[l] = 0; // component is near other ink
    }
  }
  dilatedMain.delete();

  // Clear speckles on full-res image
  for (let r = 0; r < sh; r++) {
    const sOffset = r * sw;
    const fullRStart = r * 4;
    for (let c = 0; c < sw; c++) {
      const l = finalLblData[sOffset + c];
      if (l > 0 && removeComponent[l]) {
        // wipe the 4x4 block
        for (let dr = 0; dr < 4 && fullRStart + dr < h; dr++) {
          const rowStart = (fullRStart + dr) * w;
          const fullCStart = c * 4;
          for (let dc = 0; dc < 4 && fullCStart + dc < w; dc++) {
            dData[rowStart + fullCStart + dc] = 255;
          }
        }
      }
    }
  }

  inkSmall.delete();
  finalLabels.delete();
  finalStats.delete();
  finalCentroids.delete();
  timings['final_tidy'] = performance.now() - tTidyStart;

  const totalMs = performance.now() - tTotalStart;

  // Save opt output
  const outputRaw = Buffer.from(dData);
  await sharp(outputRaw, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toFile('test-output/opt2-7.png');

  // Metrics vs baseline
  const { mae, ssim } = calculateMetrics(outputRaw, baselineRaw, w, h);

  console.log('\n=== OPTIMIZATION 1 + 2 + 7 RESULTS ===');
  console.log(`Background estimate: ${timings['background_estimate'].toFixed(1)} ms`);
  console.log(`Local contrast blur: ${timings['local_contrast'].toFixed(1)} ms`);
  console.log(`Deskew search:       ${timings['deskew_search'].toFixed(1)} ms (was 1132 ms)`);
  console.log(`Rotate:              ${timings['rotate'].toFixed(1)} ms (was 321 ms)`);
  console.log(`Final tidy:          ${timings['final_tidy'].toFixed(1)} ms (was 5890 ms)`);
  console.log(`Edge detection:      ${timings['edge_detection'].toFixed(1)} ms`);
  console.log(`CC and masking:      ${timings['cc_and_masking'].toFixed(1)} ms`);
  console.log(`Render:              ${timings['render'].toFixed(1)} ms`);
  console.log(`Total processing:    ${totalMs.toFixed(1)} ms (was 33213 ms)`);
  console.log(`Best angle:          ${bestAngle.toFixed(2)} deg (skipped rotation: ${Math.abs(bestAngle) < 0.3})`);
  console.log(`Quality MAE:         ${mae.toFixed(4)} (scale 0-255)`);
  console.log(`Quality SSIM:        ${ssim.toFixed(4)} (scale 0-1)`);

  deskewed.delete();
}

run().catch(console.error);
