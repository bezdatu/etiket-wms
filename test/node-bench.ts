import fs from 'fs';
import { JSDOM } from 'jsdom';
import canvas from 'canvas';
import { runRecognitionPipeline } from '../src/recognition/pipeline';
import type { Product } from '../src/types';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
const nodeGlobal = globalThis as typeof globalThis & {
  window: Window & {
    BarcodeDetector?: new () => {
      detect: () => Promise<unknown[]>;
    };
  };
  document: Document;
  HTMLCanvasElement: typeof dom.window.HTMLCanvasElement;
  HTMLImageElement: typeof dom.window.HTMLImageElement;
  Image: typeof canvas.Image;
};

nodeGlobal.window = dom.window as Window & {
  BarcodeDetector?: new () => {
    detect: () => Promise<unknown[]>;
  };
};
Object.defineProperty(dom.window, 'localStorage', {
  value: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
  writable: true
});
nodeGlobal.document = dom.window.document;
nodeGlobal.HTMLCanvasElement = dom.window.HTMLCanvasElement;
nodeGlobal.HTMLImageElement = dom.window.HTMLImageElement;
nodeGlobal.Image = canvas.Image;

const originalCreateElement = document.createElement.bind(document);
document.createElement = (tagName: string) => {
  if (tagName.toLowerCase() === 'canvas') {
    return canvas.createCanvas(1, 1) as unknown as HTMLElement;
  }
  return originalCreateElement(tagName);
};

nodeGlobal.window.BarcodeDetector = class {
  constructor() {}
  async detect() { return []; }
};

const MOCK_PRODUCTS: Product[] = [
  { id: '1', name: 'Product 1', barcode: '123456', description: 'Test', photoUrl: '', labelSignature: '', recognitionProfile: { visualHash: '11111111111111111111111111111111', roiProfiles: [], barcodeHints: [], learnedAt: new Date().toISOString(), referenceCount: 1 } },
  { id: '2', name: 'Product 2', barcode: '654321', description: 'Test 2', photoUrl: '', labelSignature: '', recognitionProfile: { visualHash: '00000000000000000000000000000000', roiProfiles: [], barcodeHints: [], learnedAt: new Date().toISOString(), referenceCount: 1 } },
];

async function run() {
  console.log('Running pipeline manually in Node...');
  try {
    for (const img of ['public/test1.jpg', 'public/test2.jpg', 'public/test3.jpg']) {
      const buffer = fs.readFileSync(img);
      const imageSrc = `data:image/jpeg;base64,${buffer.toString('base64')}`;
      const res = await runRecognitionPipeline(imageSrc, MOCK_PRODUCTS);
      console.log(`\n--- Results for ${img} ---`);
      console.log(JSON.stringify({ ...res, normalizedImage: undefined }, null, 2));
    }
  } catch (error: unknown) {
    console.error('Pipeline Error:', error);
  } finally {
    process.exit(0);
  }
}
run();
