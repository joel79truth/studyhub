const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const homeDir = process.env.USERPROFILE || process.env.HOME;
const desktop = path.join(homeDir, 'Desktop');

const userScreenshots = [
  {
    file: 'C:/Users/Joel M/.gemini/antigravity/brain/f0217f42-4006-4bc8-82f8-b23369508cef/.user_uploaded/media_1788706987116.png',
    title: 'Smart Academic Dashboard',
    subtitle: 'Track exams, recent modules & your study progress',
    name: '1-Dashboard'
  },
  {
    file: 'C:/Users/Joel M/.gemini/antigravity/brain/f0217f42-4006-4bc8-82f8-b23369508cef/.user_uploaded/media_1788706998676.png',
    title: 'Past Exam Papers',
    subtitle: 'Browse official LUANAR exam questions by course',
    name: '2-PastPapers'
  },
  {
    file: 'C:/Users/Joel M/.gemini/antigravity/brain/f0217f42-4006-4bc8-82f8-b23369508cef/.user_uploaded/media_1788707008096.png',
    title: 'Lecture Notes & Slides',
    subtitle: 'Download once and read offline anytime, anywhere',
    name: '3-LectureNotes'
  },
  {
    file: 'C:/Users/Joel M/.gemini/antigravity/brain/f0217f42-4006-4bc8-82f8-b23369508cef/.user_uploaded/media_1788707016281.png',
    title: 'Interactive Practice Quizzes',
    subtitle: 'Strengthen weak topics and prepare for your exams',
    name: '4-PracticeQuizzes'
  }
];

async function generateFeatureGraphic() {
  console.log('Generating 1024x500 Feature Graphic...');
  const width = 1024;
  const height = 500;

  // Render robot at height 370
  const robotBuf = await sharp('public/images/Ai.png')
    .resize({ height: 370 })
    .toBuffer();

  // Render logo at 80x80
  const logoBuf = await sharp('public/images/luanar7.png')
    .resize(80, 80)
    .toBuffer();

  const svgBanner = Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#022c22" />
          <stop offset="45%" stop-color="#064e3b" />
          <stop offset="100%" stop-color="#0f172a" />
        </linearGradient>
        <radialGradient id="glow1" cx="80%" cy="50%" r="55%">
          <stop offset="0%" stop-color="#10b981" stop-opacity="0.3" />
          <stop offset="100%" stop-color="#10b981" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="glow2" cx="20%" cy="30%" r="40%">
          <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.25" />
          <stop offset="100%" stop-color="#3b82f6" stop-opacity="0" />
        </radialGradient>
      </defs>

      <!-- Background -->
      <rect width="${width}" height="${height}" fill="url(#bg)" />
      <rect width="${width}" height="${height}" fill="url(#glow1)" />
      <rect width="${width}" height="${height}" fill="url(#glow2)" />

      <!-- Subtle Grid -->
      <g stroke="rgba(255,255,255,0.06)" stroke-width="1">
        <line x1="0" y1="125" x2="1024" y2="125" />
        <line x1="0" y1="250" x2="1024" y2="250" />
        <line x1="0" y1="375" x2="1024" y2="375" />
        <line x1="250" y1="0" x2="250" y2="500" />
        <line x1="600" y1="0" x2="600" y2="500" />
      </g>

      <!-- Text content -->
      <text x="165" y="112" font-family="system-ui, -apple-system, sans-serif" font-size="38" font-weight="800" fill="#ffffff">StudyHub <tspan fill="#34d399">LUANAR</tspan></text>
      <text x="65" y="165" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="600" fill="#e2e8f0">Your Smart Academic Companion</text>
      <text x="65" y="200" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="400" fill="#94a3b8">Lectures · Past Exam Papers · Offline Reading · AI Tutor</text>

      <!-- Feature Badges -->
      <g transform="translate(65, 240)">
        <!-- Badge 1 -->
        <rect x="0" y="0" width="220" height="42" rx="21" fill="rgba(255,255,255,0.1)" stroke="rgba(52, 211, 153, 0.45)" stroke-width="1.5" />
        <text x="20" y="26" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="#ffffff">Offline Lecture Notes</text>

        <!-- Badge 2 -->
        <rect x="235" y="0" width="190" height="42" rx="21" fill="rgba(255,255,255,0.1)" stroke="rgba(96, 165, 250, 0.45)" stroke-width="1.5" />
        <text x="25" y="26" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="#ffffff" transform="translate(230, 0)">Past Exam Papers</text>

        <!-- Badge 3 -->
        <rect x="0" y="56" width="220" height="42" rx="21" fill="rgba(255,255,255,0.1)" stroke="rgba(251, 191, 36, 0.45)" stroke-width="1.5" />
        <text x="20" y="82" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="#ffffff">Interactive Quizzes</text>

        <!-- Badge 4 -->
        <rect x="235" y="56" width="190" height="42" rx="21" fill="rgba(255,255,255,0.1)" stroke="rgba(167, 139, 250, 0.45)" stroke-width="1.5" />
        <text x="25" y="82" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="#ffffff" transform="translate(230, 0)">AI Study Assistant</text>
      </g>

      <!-- Subtitle note -->
      <text x="65" y="420" font-family="system-ui, sans-serif" font-size="14" font-weight="500" fill="#6ee7b7">Designed specifically for LUANAR Students</text>
    </svg>
  `);

  const featureGraphicBase = sharp(svgBanner)
    .composite([
      { input: logoBuf, top: 60, left: 65 },
      { input: robotBuf, top: 65, left: 630 }
    ])
    .flatten({ background: '#022c22' });

  // Save JPEG (1024x500, no alpha)
  await featureGraphicBase
    .clone()
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toFile(path.join(desktop, 'StudyHub-Feature-Graphic-1024x500.jpg'));

  // Save 24-bit PNG (1024x500, no alpha)
  await featureGraphicBase
    .clone()
    .png()
    .toFile(path.join(desktop, 'StudyHub-Feature-Graphic-1024x500.png'));

  console.log('✅ Feature Graphic generated successfully.');
}

async function processScreenshots() {
  console.log('Processing Screenshots...');
  const canvasW = 1080;
  const canvasH = 1920;

  for (const item of userScreenshots) {
    // 1. Crop status bar (42px) and bottom nav bar (36px)
    // Original: 446 x 1024
    const croppedPhone = await sharp(item.file)
      .extract({ left: 0, top: 42, width: 446, height: 1024 - 42 - 36 })
      .toBuffer();

    // Scale cropped phone UI to height 1400
    const scaledPhone = await sharp(croppedPhone)
      .resize({ height: 1400 })
      .toBuffer();

    const scaledMeta = await sharp(scaledPhone).metadata();
    const phoneW = scaledMeta.width;
    const phoneH = scaledMeta.height;
    const phoneX = Math.round((canvasW - phoneW) / 2);
    const phoneY = 440;

    const escapeXml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeTitle = escapeXml(item.title);
    const safeSubtitle = escapeXml(item.subtitle);

    const svgOverlay = Buffer.from(`
      <svg width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#042f2e" />
            <stop offset="40%" stop-color="#064e3b" />
            <stop offset="100%" stop-color="#0f172a" />
          </linearGradient>
          <radialGradient id="topGlow" cx="50%" cy="15%" r="40%">
            <stop offset="0%" stop-color="#10b981" stop-opacity="0.25" />
            <stop offset="100%" stop-color="#10b981" stop-opacity="0" />
          </radialGradient>
          <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#000000" flood-opacity="0.55" />
          </filter>
        </defs>

        <!-- Canvas Background -->
        <rect width="${canvasW}" height="${canvasH}" fill="url(#bgGrad)" />
        <rect width="${canvasW}" height="${canvasH}" fill="url(#topGlow)" />

        <!-- Header Texts -->
        <text x="540" y="190" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="54" font-weight="800" fill="#ffffff">${safeTitle}</text>
        <text x="540" y="255" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="500" fill="#94a3b8">${safeSubtitle}</text>

        <!-- Phone Base with Shadow -->
        <rect x="${phoneX - 6}" y="${phoneY - 6}" width="${phoneW + 12}" height="${phoneH + 12}" rx="28" fill="#1e293b" filter="url(#shadow)" stroke="rgba(255,255,255,0.15)" stroke-width="3" />
      </svg>
    `);

    // Rounded mask for the phone content
    const maskSvg = Buffer.from(`
      <svg width="${phoneW}" height="${phoneH}">
        <rect width="${phoneW}" height="${phoneH}" rx="22" fill="#fff" />
      </svg>
    `);

    const maskedPhone = await sharp(scaledPhone)
      .composite([{ input: maskSvg, blend: 'dest-in' }])
      .toBuffer();

    // Composite showcase screenshot (1080 x 1920 - Ratio 1.777, <= 2.0, NO ALPHA)
    await sharp(svgOverlay)
      .composite([{ input: maskedPhone, top: phoneY, left: phoneX }])
      .flatten({ background: '#042f2e' })
      .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
      .toFile(path.join(desktop, `StudyHub-Screenshot-${item.name}.jpg`));

    // Also produce Direct Clean Phone Screenshot (1080 x 2160 - Ratio exactly 2.0, NO ALPHA)
    await sharp(croppedPhone)
      .resize(1080, 2160, { fit: 'cover' })
      .flatten({ background: '#f8fafc' })
      .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
      .toFile(path.join(desktop, `StudyHub-Direct-${item.name}.jpg`));

    console.log(`✅ Processed Screenshot: ${item.name}`);
  }
}

(async () => {
  try {
    await generateFeatureGraphic();
    await processScreenshots();
    console.log('🎉 All store assets created successfully on Desktop!');
  } catch (err) {
    console.error('❌ Error processing assets:', err);
  }
})();
