const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const svg = Buffer.from(`
<svg width="96" height="96" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path fill="#ffffff" d="M12,3L1,9L12,15L21,10.09V17H23V9M5,13.18V17.18C5,19.39 8.13,21.18 12,21.18C15.87,21.18 19,19.39 19,17.18V13.18L12,17L5,13.18Z" />
</svg>
`);

const sizes = {
  'drawable-mdpi': 24,
  'drawable-hdpi': 36,
  'drawable-xhdpi': 48,
  'drawable-xxhdpi': 72,
  'drawable-xxxhdpi': 96,
  'drawable': 48
};

async function run() {
  const base = 'android/app/src/main/res';
  for (const [folder, size] of Object.entries(sizes)) {
    const dir = path.join(base, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await sharp(svg)
      .resize(size, size)
      .png()
      .toFile(path.join(dir, 'ic_stat_studyhub.png'));
    console.log('✅ Created:', folder + '/ic_stat_studyhub.png (' + size + 'x' + size + ')');
  }
}
run().catch(console.error);
