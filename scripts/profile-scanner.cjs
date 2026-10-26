/**
 * scripts/profile-scanner.cjs
 * Comprehensive timing and profiling script reproducing scanner.worker.js and scannerService.js.
 * Saves baseline.png and measures milliseconds per stage.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sharp = require('../backend/node_modules/sharp');

function loadOpenCV() {
  return new Promise((resolve, reject) => {
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
        // Load jscanify
        try {
          const jscanifyCode = fs.readFileSync(path.resolve(__dirname, '../public/vendor/jscanify.min.js'), 'utf8');
          vm.runInNewContext(jscanifyCode, ctx);
        } catch (e) {
          console.warn('jscanify load warning:', e);
        }
        resolve({ cv, jscanify: ctx.jscanify, initTimeMs: t1 - t0 });
      }
    };

    try {
      const code = fs.readFileSync(path.resolve(__dirname, '../public/vendor/opencv.js'), 'utf8');
      vm.runInNewContext(code, ctx);
    } catch (e) {
      reject(e);
    }
  });
}

function processDocumentWithTimings(cv, JScanifyClass, inputRgbaBuffer, srcW, srcH) {
  const timings = {};

  // Stage: ImageData to Mat conversion
  const tMatStart = performance.now();
  let src = new cv.Mat(srcH, srcW, cv.CV_8UC4);
  src.data.set(inputRgbaBuffer);
  timings['mat_creation'] = performance.now() - tMatStart;

  let paperMat = null;

  // Stage: jscanify edge detection
  const tEdgeStart = performance.now();
  try {
    if (JScanifyClass) {
      const scanner = new JScanifyClass();
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
  } catch (err) {
    console.warn('Edge detection error:', err);
  }
  timings['edge_detection'] = performance.now() - tEdgeStart;

  if (!paperMat) {
    paperMat = src;
  } else {
    src.delete();
  }

  // Stage: Resize to 2576 long edge
  const tResizeStart = performance.now();
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
  timings['resize_and_gray'] = performance.now() - tResizeStart;

  // Stage: Background estimate (CLOSE, median, Gaussian, divide)
  const tBgStart = performance.now();
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
  timings['background_estimate'] = performance.now() - tBgStart;

  // Stage: Local contrast blur (GaussianBlur sigma 25, subtract)
  const tContrastStart = performance.now();
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
  timings['local_contrast'] = performance.now() - tContrastStart;

  // Stage: Connected components and masking
  const tCCStart = performance.now();
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
  timings['cc_and_masking'] = performance.now() - tCCStart;

  // Stage: Render
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

  // Stage: Deskew search
  const tDeskewStart = performance.now();
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
  timings['deskew_search'] = performance.now() - tDeskewStart;

  // Stage: Rotate
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

  // Stage: Final tidy (border & connected component cleanup)
  const tTidyStart = performance.now();
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
      removeComponent[l] = 0;
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
  timings['final_tidy'] = performance.now() - tTidyStart;

  // Stage: RGBA pack
  const tRgbaStart = performance.now();
  const rgbaOut = Buffer.alloc(w * h * 4);
  for (let i = 0; i < numPixels; i++) {
    const v = dData[i];
    const offset = i * 4;
    rgbaOut[offset] = v;
    rgbaOut[offset + 1] = v;
    rgbaOut[offset + 2] = v;
    rgbaOut[offset + 3] = 255;
  }
  timings['rgba_transfer_pack'] = performance.now() - tRgbaStart;

  deskewed.delete();

  return {
    width: w,
    height: h,
    data: rgbaOut,
    timings,
    bestAngle,
  };
}

async function runBenchmark() {
  const testOutputDir = path.resolve(__dirname, '../test-output');
  if (!fs.existsSync(testOutputDir)) fs.mkdirSync(testOutputDir, { recursive: true });

  console.log('--- Initializing OpenCV.js ---');
  const { cv, jscanify, initTimeMs } = await loadOpenCV();
  console.log(`OpenCV initialized in ${initTimeMs.toFixed(1)} ms`);

  // Target photos:
  // 1. Source test photo 2220.jpg
  const testPhotoPath = 'C:/Users/Joel M/Pictures/2025-01-29/2220.jpg';
  const { data: raw2220, info: info2220 } = await sharp(testPhotoPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  console.log(`Loaded test photo: ${info2220.width}x${info2220.height} (${(info2220.width * info2220.height / 1e6).toFixed(1)} MP)`);

  // 2. Real phone-sized 12MP photo (3000x4000)
  const phone12MpBuffer = await sharp(testPhotoPath)
    .resize(3000, 4000, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer();
  console.log(`Prepared 12MP phone photo: 3000x4000 (12.0 MP)`);

  // Helper for encode & PDF
  const measureEncodeAndPdf = async (rgbaBuf, width, height) => {
    // JPEG encode timing
    const tJpg = performance.now();
    const jpegBuffer = await sharp(rgbaBuf, { raw: { width, height, channels: 4 } })
      .jpeg({ quality: 85 })
      .toBuffer();
    const jpegEncodeMs = performance.now() - tJpg;

    // PDF build timing
    const tPdf = performance.now();
    const pdfLibCode = fs.readFileSync(path.resolve(__dirname, '../public/vendor/pdf-lib.min.js'), 'utf8');
    const m = { exports: {} };
    const fn = new Function('module', 'exports', pdfLibCode);
    fn(m, m.exports);
    const { PDFDocument } = m.exports;
    const pdfDoc = await PDFDocument.create();
    const embedded = await pdfDoc.embedJpg(jpegBuffer);
    const page = pdfDoc.addPage([595.28, 841.89]);
    const scale = Math.min((595.28 - 40) / embedded.width, (841.89 - 40) / embedded.height);
    page.drawImage(embedded, {
      x: (595.28 - embedded.width * scale) / 2,
      y: (841.89 - embedded.height * scale) / 2,
      width: embedded.width * scale,
      height: embedded.height * scale,
    });
    await pdfDoc.save();
    const pdfBuildMs = performance.now() - tPdf;

    return { jpegBuffer, jpegEncodeMs, pdfBuildMs };
  };

  console.log('\n========================================');
  console.log('PROFILING TEST PHOTO (2220.jpg - 1920x2560)');
  console.log('========================================');
  const tTotalStart2220 = performance.now();
  const res2220 = processDocumentWithTimings(cv, jscanify, raw2220, info2220.width, info2220.height);
  const enc2220 = await measureEncodeAndPdf(res2220.data, res2220.width, res2220.height);
  const total2220 = performance.now() - tTotalStart2220;

  // Save baseline.png and cleaned-2220.jpg
  await sharp(res2220.data, { raw: { width: res2220.width, height: res2220.height, channels: 4 } })
    .png()
    .toFile(path.join(testOutputDir, 'baseline.png'));
  await sharp(enc2220.jpegBuffer)
    .toFile(path.join(testOutputDir, 'cleaned-2220.jpg'));
  console.log('Saved baseline.png and cleaned-2220.jpg to test-output/');

  console.log('\n========================================');
  console.log('PROFILING 12MP PHONE PHOTO (3000x4000)');
  console.log('========================================');
  const tTotalStart12Mp = performance.now();
  const res12Mp = processDocumentWithTimings(cv, jscanify, phone12MpBuffer, 3000, 4000);
  const enc12Mp = await measureEncodeAndPdf(res12Mp.data, res12Mp.width, res12Mp.height);
  const total12Mp = performance.now() - tTotalStart12Mp;

  const results = {
    initTimeMs,
    testPhoto: {
      width: res2220.width,
      height: res2220.height,
      timings: {
        ...res2220.timings,
        jpeg_encode: enc2220.jpegEncodeMs,
        pdf_build: enc2220.pdfBuildMs,
      },
      totalMs: total2220,
      bestAngle: res2220.bestAngle,
    },
    phone12Mp: {
      width: res12Mp.width,
      height: res12Mp.height,
      timings: {
        ...res12Mp.timings,
        jpeg_encode: enc12Mp.jpegEncodeMs,
        pdf_build: enc12Mp.pdfBuildMs,
      },
      totalMs: total12Mp,
      bestAngle: res12Mp.bestAngle,
    }
  };

  fs.writeFileSync(path.join(testOutputDir, 'profile_baseline.json'), JSON.stringify(results, null, 2));
  console.log('\n=== PROFILE SUMMARY JSON SAVED ===');
  console.log(JSON.stringify(results, null, 2));
}

runBenchmark().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
