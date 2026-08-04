const sharp = require('sharp');

async function enhanceImage(buffer) {
  return sharp(buffer)
    .greyscale()
    .normalize()
    .sharpen()
    .toBuffer();
}

module.exports = { enhanceImage };