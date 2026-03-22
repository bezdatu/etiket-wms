import { DecodeHintType } from '@zxing/library';
import type { BarcodePreviewMatch, BarcodeResult } from './types';
import { recognitionConfig } from '../config/recognition';
import { sanitizeBarcode } from './utils';

let zxingReaderPromise: Promise<{
  decodeFromCanvas: (canvas: HTMLCanvasElement) => {
    getText: () => string;
    getBarcodeFormat: () => { toString: () => string };
    getResultPoints: () => Array<{ getX: () => number; getY: () => number }>;
  };
  decodeFromImageElement: (image: HTMLImageElement) => Promise<{
    getText: () => string;
    getBarcodeFormat: () => { toString: () => string };
    getResultPoints: () => Array<{ getX: () => number; getY: () => number }>;
  }>;
}> | null = null;

const getZxingReader = async () => {
  if (!zxingReaderPromise) {
    zxingReaderPromise = Promise.all([import('@zxing/browser'), import('@zxing/library')]).then(
      ([{ BrowserMultiFormatReader }, library]) => {
        const hints = new Map();
        hints.set(DecodeHintType.TRY_HARDER, true);
        hints.set(
          DecodeHintType.POSSIBLE_FORMATS,
          [
            library.BarcodeFormat.EAN_13,
            library.BarcodeFormat.EAN_8,
            library.BarcodeFormat.UPC_A,
            library.BarcodeFormat.UPC_E,
            library.BarcodeFormat.CODE_128,
            library.BarcodeFormat.CODE_39,
            library.BarcodeFormat.ITF,
            library.BarcodeFormat.CODABAR,
          ],
        );
        return new BrowserMultiFormatReader(hints);
      },
    );
  }
  return zxingReaderPromise;
};

type BarcodeDetectorFormat = {
  format: string;
  rawValue: string;
};

const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

const canvasToImage = (canvas: HTMLCanvasElement) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load barcode candidate image'));
    image.src = canvas.toDataURL('image/png');
  });

const rotateCanvas = (source: HTMLCanvasElement, degrees: 90 | 270) => {
  const rotate90 = degrees === 90;
  const canvas = createCanvas(source.height, source.width);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  if (rotate90) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  return canvas;
};

const cropCanvas = (source: HTMLCanvasElement, x: number, y: number, width: number, height: number) => {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
};

type BarcodeCanvasCandidate = {
  canvas: HTMLCanvasElement;
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
};

const normalizePreviewPoints = (
  points: Array<{ getX: () => number; getY: () => number }>,
  candidate: BarcodeCanvasCandidate,
) =>
  points.map((point) => ({
    x: point.getX() / candidate.scaleX + candidate.offsetX,
    y: point.getY() / candidate.scaleY + candidate.offsetY,
  }));

const createEnhancedCanvas = (source: HTMLCanvasElement, filter: string) => {
  const canvas = createCanvas(source.width, source.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.filter = filter;
  ctx.drawImage(source, 0, 0);
  ctx.filter = 'none';
  return canvas;
};

const resizeCanvas = (source: HTMLCanvasElement, maxDimension: number) => {
  const scale = Math.min(1, maxDimension / Math.max(source.width, source.height));
  if (scale === 1) {
    return { canvas: source, scaleX: 1, scaleY: 1 };
  }
  const canvas = createCanvas(source.width * scale, source.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { canvas: source, scaleX: 1, scaleY: 1 };
  }
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return {
    canvas,
    scaleX: canvas.width / source.width,
    scaleY: canvas.height / source.height,
  };
};

const buildPreviewCandidates = (source: HTMLCanvasElement): BarcodeCanvasCandidate[] => {
  const full = resizeCanvas(source, 1440);
  const enhancedFull = resizeCanvas(createEnhancedCanvas(source, 'grayscale(1) contrast(1.85) brightness(1.04)'), 1440);
  const centerWidth = source.width * 0.72;
  const centerHeight = source.height * 0.72;
  const centerX = (source.width - centerWidth) / 2;
  const centerY = (source.height - centerHeight) / 2;
  const centerCrop = cropCanvas(source, centerX, centerY, centerWidth, centerHeight);
  const center = resizeCanvas(centerCrop, 1280);
  const enhancedCenter = resizeCanvas(createEnhancedCanvas(centerCrop, 'grayscale(1) contrast(1.95) brightness(1.02)'), 1280);

  return [
    { canvas: full.canvas, offsetX: 0, offsetY: 0, scaleX: full.scaleX, scaleY: full.scaleY },
    { canvas: enhancedFull.canvas, offsetX: 0, offsetY: 0, scaleX: enhancedFull.scaleX, scaleY: enhancedFull.scaleY },
    { canvas: center.canvas, offsetX: centerX, offsetY: centerY, scaleX: center.scaleX, scaleY: center.scaleY },
    { canvas: enhancedCenter.canvas, offsetX: centerX, offsetY: centerY, scaleX: enhancedCenter.scaleX, scaleY: enhancedCenter.scaleY },
  ];
};

const buildBarcodeCandidates = async (
  normalizedCanvas: HTMLCanvasElement,
  fallbackImage: HTMLImageElement,
) => {
  const fullCanvas = createCanvas(fallbackImage.width, fallbackImage.height);
  const fullCtx = fullCanvas.getContext('2d');
  if (fullCtx) {
    fullCtx.drawImage(fallbackImage, 0, 0, fullCanvas.width, fullCanvas.height);
  }

  const horizontalBand = createCanvas(fullCanvas.width, Math.max(1, fullCanvas.height * 0.34));
  const bandCtx = horizontalBand.getContext('2d');
  if (bandCtx) {
    const sy = Math.max(0, (fullCanvas.height - horizontalBand.height) / 2);
    bandCtx.drawImage(
      fullCanvas,
      0,
      sy,
      fullCanvas.width,
      horizontalBand.height,
      0,
      0,
      horizontalBand.width,
      horizontalBand.height,
    );
  }

  const enhancedNormalized = createCanvas(normalizedCanvas.width, normalizedCanvas.height);
  const enhancedCtx = enhancedNormalized.getContext('2d');
  if (enhancedCtx) {
    enhancedCtx.filter = 'grayscale(1) contrast(1.55) brightness(1.08)';
    enhancedCtx.drawImage(normalizedCanvas, 0, 0);
    enhancedCtx.filter = 'none';
  }

  const enhancedBand = createCanvas(horizontalBand.width, horizontalBand.height);
  const enhancedBandCtx = enhancedBand.getContext('2d');
  if (enhancedBandCtx) {
    enhancedBandCtx.filter = 'grayscale(1) contrast(1.7) brightness(1.04)';
    enhancedBandCtx.drawImage(horizontalBand, 0, 0);
    enhancedBandCtx.filter = 'none';
  }

  const verticalBand = createCanvas(Math.max(1, fullCanvas.width * 0.42), fullCanvas.height);
  const verticalBandCtx = verticalBand.getContext('2d');
  if (verticalBandCtx) {
    const sx = Math.max(0, (fullCanvas.width - verticalBand.width) / 2);
    verticalBandCtx.drawImage(
      fullCanvas,
      sx,
      0,
      verticalBand.width,
      fullCanvas.height,
      0,
      0,
      verticalBand.width,
      verticalBand.height,
    );
  }

  const focusedCenter = cropCanvas(
    fullCanvas,
    fullCanvas.width * 0.18,
    fullCanvas.height * 0.18,
    fullCanvas.width * 0.64,
    fullCanvas.height * 0.64,
  );

  const enhancedFull = createCanvas(fullCanvas.width, fullCanvas.height);
  const enhancedFullCtx = enhancedFull.getContext('2d');
  if (enhancedFullCtx) {
    enhancedFullCtx.filter = 'grayscale(1) contrast(1.8) brightness(1.05)';
    enhancedFullCtx.drawImage(fullCanvas, 0, 0);
    enhancedFullCtx.filter = 'none';
  }

  const rotatedNormalized90 = rotateCanvas(normalizedCanvas, 90);
  const rotatedNormalized270 = rotateCanvas(normalizedCanvas, 270);
  const rotatedFull90 = rotateCanvas(fullCanvas, 90);
  const rotatedFull270 = rotateCanvas(fullCanvas, 270);

  return [
    { label: 'normalized', canvas: normalizedCanvas, image: await canvasToImage(normalizedCanvas) },
    { label: 'enhanced-normalized', canvas: enhancedNormalized, image: await canvasToImage(enhancedNormalized) },
    { label: 'full-frame', canvas: fullCanvas, image: await canvasToImage(fullCanvas) },
    { label: 'enhanced-full', canvas: enhancedFull, image: await canvasToImage(enhancedFull) },
    { label: 'focused-center', canvas: focusedCenter, image: await canvasToImage(focusedCenter) },
    { label: 'center-band', canvas: horizontalBand, image: await canvasToImage(horizontalBand) },
    { label: 'enhanced-band', canvas: enhancedBand, image: await canvasToImage(enhancedBand) },
    { label: 'vertical-band', canvas: verticalBand, image: await canvasToImage(verticalBand) },
    { label: 'rotated-normalized-90', canvas: rotatedNormalized90, image: await canvasToImage(rotatedNormalized90) },
    { label: 'rotated-normalized-270', canvas: rotatedNormalized270, image: await canvasToImage(rotatedNormalized270) },
    { label: 'rotated-full-90', canvas: rotatedFull90, image: await canvasToImage(rotatedFull90) },
    { label: 'rotated-full-270', canvas: rotatedFull270, image: await canvasToImage(rotatedFull270) },
  ];
};

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<BarcodeDetectorFormat[]>;
    };
  }
}

export const scanBarcode = async (
  normalizedCanvas: HTMLCanvasElement,
  fallbackImage: HTMLImageElement,
): Promise<BarcodeResult | null> => {
  const candidates = await buildBarcodeCandidates(normalizedCanvas, fallbackImage);
  const BarcodeDetectorCtor = window.BarcodeDetector;
  if (BarcodeDetectorCtor) {
    try {
      const detector = new BarcodeDetectorCtor({ formats: [...recognitionConfig.barcode.formats] });
      for (const candidate of candidates) {
        const [detected] = await detector.detect(candidate.canvas);
        if (detected?.rawValue) {
          return {
            rawValue: sanitizeBarcode(detected.rawValue),
            format: detected.format,
            source: 'barcode-detector',
          };
        }
      }
    } catch (error) {
      console.warn('BarcodeDetector failed, falling back to ZXing', error);
    }
  }

  try {
    const zxingReader = await getZxingReader();
    for (const candidate of candidates) {
      try {
        const result = await zxingReader.decodeFromImageElement(candidate.image);
        return {
          rawValue: sanitizeBarcode(result.getText()),
          format: result.getBarcodeFormat().toString(),
          source: 'zxing',
        };
      } catch {
        // Try the next image variant.
      }
    }
    return null;
  } catch {
    return null;
  }
};

export const scanPreviewBarcode = async (sourceCanvas: HTMLCanvasElement): Promise<BarcodePreviewMatch | null> => {
  try {
    const reader = await getZxingReader();
    const candidates = buildPreviewCandidates(sourceCanvas);
    for (const candidate of candidates) {
      try {
        const result = reader.decodeFromCanvas(candidate.canvas);
        const normalizedPoints = normalizePreviewPoints(result.getResultPoints?.() || [], candidate);
        if (!normalizedPoints.length) continue;
        return {
          rawValue: sanitizeBarcode(result.getText()),
          format: result.getBarcodeFormat().toString(),
          source: 'zxing',
          points: normalizedPoints,
        };
      } catch {
        // Try next preview candidate.
      }
    }
    return null;
  } catch {
    return null;
  }
};
