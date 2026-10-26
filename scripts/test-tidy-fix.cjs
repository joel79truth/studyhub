/**
 * Test optimized full-res CC with precomputed stats vs baseline.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sharp = require('sharp');

function loadOpenCV() {
  return new Promise((resolve) => {
    const ctx = {
      console, setTimeout, clearTimeout, performance, require, Buffer,
      Uint8Array, Uint8ClampedArray, Float32Array, Int32Array, Math, WebAssembly, TextDecoder,
      document: { currentScript: null, title: '' }, location: { href: 'http://localhost/' }
    };
    ctx.window = ctx; ctx.self = ctx; ctx.global = ctx;
    ctx.Module = {
      onRuntimeInitialized: () => {
        const cv = ctx.cv || ctx.Module;
        resolve(cv);
      }
    };
    const opencvCode = fs.readFileSync(path.resolve(__dirname, '../public/vendor/opencv.js'), 'utf8');
    vm.runInNewContext(opencvCode, ctx);
  });
}

function calculateMetrics(bufA, bufB, width, height) {
  let sumAbsDiff = 0;
  const n = width * height;
  let sumA = 0, sumB = 0, sumA2 = 0, sumB2 = 0, sumAB = 0;

  for (let i = 0; i < n; i++) {
    const a = bufA[i];
    const b = bufB[i];
    sumAbsDiff += Math.abs(a - b);
    sumA += a; sumB += b;
    sumA2 += a * a; sumB2 += b * b;
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
  const cv = await loadOpenCV();
  const baselineRaw = await sharp('test-output/baseline.png').grayscale().raw().toBuffer();
  const opt1Raw = await sharp('test-output/opt1.png').grayscale().raw().toBuffer();

  const info = await sharp('test-output/baseline.png').metadata();
  const w = info.width;
  const h = info.height;
  const numPixels = w * h;

  // Let's test tidy on opt1 output with precomputed array
  let deskewed = new cv.Mat(h, w, cv.CV_8U);
  deskewed.data.set(opt1Raw);

  const t0 = performance.now();
  let inkBinary = new cv.Mat.zeros(h, w, cv.CV_8U);
  const inkData = inkBinary.data;
  const dData = deskewed.data;
  for (let idx = 0; idx < numPixels; idx++) {
    if (dData[idx] < 240) inkData[idx] = 255;
  }

  let finalLabels = new cv.Mat();
  let finalStats = new cv.Mat();
  let finalCentroids = new cv.Mat();
  const numFinalCC = cv.connectedComponentsWithStats(inkBinary, finalLabels, finalStats, finalCentroids, 8, cv.CV_32S);

  // PRECOMPUTE lookup table for components! (O(numComponents) instead of calling intAt inside 5M loop!)
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

  // Downscaled dilation for speed
  const sw = Math.round(w / 4);
  const sh = Math.round(h / 4);
  let mainSmall = new cv.Mat();
  cv.resize(mainInkMask, mainSmall, new cv.Size(sw, sh), 0, 0, cv.INTER_NEAREST);
  mainInkMask.delete();

  let kNear = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7));
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
      removeComponent[l] = 0; // component is near other ink
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

  const tidyMs = performance.now() - t0;
  console.log(`Optimized full-res tidy with precomputation took: ${tidyMs.toFixed(1)} ms (was 5890 ms)`);

  const outputRaw = Buffer.from(dData);
  const { mae, ssim } = calculateMetrics(outputRaw, baselineRaw, w, h);
  console.log(`MAE vs baseline:  ${mae.toFixed(4)}`);
  console.log(`SSIM vs baseline: ${ssim.toFixed(4)}`);
}

run().catch(console.error);
