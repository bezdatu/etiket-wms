const fs = require('fs');
const heicConvert = require('/tmp/my-image-tools/node_modules/heic-convert');

async function convert(fileIn, fileOut) {
  const inputBuffer = fs.readFileSync(fileIn);
  const outputBuffer = await heicConvert({
    buffer: inputBuffer,
    format: 'JPEG',
    quality: 1
  });
  fs.writeFileSync(fileOut, Buffer.from(outputBuffer));
  console.log('Converted ' + fileIn);
}

(async () => {
    try {
        await convert('test/IMG_9121.HEIC', 'public/test1.jpg');
        await convert('test/IMG_9122.HEIC', 'public/test2.jpg');
        await convert('test/IMG_9126.HEIC', 'public/test3.jpg');
    } catch (e) { console.error(e) }
})();
