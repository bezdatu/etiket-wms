import type { Product, RecognitionProfile, RecognitionRoiProfile } from '../types';
import type { NormalizedCanvas, QualityMetrics } from './types';
import { recognitionConfig } from '../config/recognition';

type Bounds = { x: number; y: number; size: number };

const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

export const loadImage = (imageSrc: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image'));
    image.src = imageSrc;
  });

export const sanitizeBarcode = (value?: string | null) =>
  (value || '').replace(/[^\dA-Z]/gi, '').trim();

export const isSyntheticBarcodeProduct = (product: Product) => {
  const normalizedBarcode = sanitizeBarcode(product.barcode || product.barcodes?.[0] || '');
  if (!normalizedBarcode) return false;

  const normalizedName = (product.name || '').trim();
  return (
    normalizedName === `Новый товар ${normalizedBarcode}` ||
    normalizedName === `Новый товар по штрихкоду ${normalizedBarcode}`
  );
};

export const isValidBarcodeChecksum = (value?: string | null) => {
  const normalized = sanitizeBarcode(value);
  if (!normalized) return false;

  if (/^\d{13}$/.test(normalized)) {
    const digits = normalized.split('').map(Number);
    const checksum =
      (10 -
        (digits
          .slice(0, 12)
          .reduce((sum, digit, index) => sum + digit * (index % 2 === 0 ? 1 : 3), 0) %
          10)) %
      10;
    return checksum === digits[12];
  }

  if (/^\d{8}$/.test(normalized)) {
    const digits = normalized.split('').map(Number);
    const checksum =
      (10 -
        (digits
          .slice(0, 7)
          .reduce((sum, digit, index) => sum + digit * (index % 2 === 0 ? 3 : 1), 0) %
          10)) %
      10;
    return checksum === digits[7];
  }

  return normalized.length >= 6;
};

export const sanitizeOcrText = (value?: string | null) =>
  (value || '')
    .toUpperCase()
    .replace(/[^A-ZА-Я0-9]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const extractBarcodeHints = (product: Product) => {
  const hints = new Set<string>();
  if (product.barcode) {
    hints.add(sanitizeBarcode(product.barcode));
  }
  (product.barcodes || []).forEach((code) => hints.add(sanitizeBarcode(code)));
  (product.recognitionProfile?.barcodeHints || []).forEach((code) => hints.add(sanitizeBarcode(code)));
  return Array.from(hints).filter(Boolean);
};

const createGrayscale = (data: Uint8ClampedArray) => {
  const grayscale = new Uint8Array(data.length / 4);
  for (let i = 0; i < data.length; i += 4) {
    grayscale[i / 4] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
  }
  return grayscale;
};

export const calculateDHash = (canvas: HTMLCanvasElement) => {
  const width = 33;
  const height = 32;
  const hashCanvas = createCanvas(width, height);
  const ctx = hashCanvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(canvas, 0, 0, width, height);
  const grayscale = createGrayscale(ctx.getImageData(0, 0, width, height).data);

  let hash = '';
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width - 1; col++) {
      const left = grayscale[row * width + col];
      const right = grayscale[row * width + col + 1];
      hash += left > right ? '1' : '0';
    }
  }
  return hash;
};

export const getHammingDistance = (left: string, right: string) => {
  if (!left || !right || left.length !== right.length) return 1;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) distance += 1;
  }
  return distance / left.length;
};

export const scoreTextOverlap = (probe: string, candidate: string) => {
  const probeTokens = new Set(sanitizeOcrText(probe).split(' ').filter(Boolean));
  const candidateTokens = new Set(sanitizeOcrText(candidate).split(' ').filter(Boolean));
  if (probeTokens.size === 0 || candidateTokens.size === 0) return 0;
  let matches = 0;
  probeTokens.forEach((token) => {
    if (candidateTokens.has(token)) matches += 1;
  });
  return matches / Math.max(probeTokens.size, candidateTokens.size);
};

export const evaluateFrameQuality = (image: HTMLImageElement): QualityMetrics => {
  const minSide = Math.min(image.width, image.height);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      brightness: 0,
      contrast: 0,
      sharpness: 0,
      glareScore: 0,
      resolutionScore: 0,
      passes: false,
      reasons: ['no-context'],
    };
  }

  ctx.drawImage(image, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, image.width, image.height);
  const grayscale = createGrayscale(data);

  let sum = 0;
  grayscale.forEach((value) => {
    sum += value;
  });
  const brightness = sum / grayscale.length;

  let contrastAcc = 0;
  grayscale.forEach((value) => {
    contrastAcc += (value - brightness) ** 2;
  });
  const contrast = Math.sqrt(contrastAcc / grayscale.length);

  let sharpnessAcc = 0;
  let glarePixels = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (grayscale[index] >= 245) {
        glarePixels += 1;
      }
      const laplace =
        4 * grayscale[index] -
        grayscale[index - 1] -
        grayscale[index + 1] -
        grayscale[index - width] -
        grayscale[index + width];
      sharpnessAcc += Math.abs(laplace);
    }
  }
  const sharpness = sharpnessAcc / Math.max((width - 2) * (height - 2), 1);
  const glareScore = glarePixels / Math.max((width - 2) * (height - 2), 1);

  const resolutionScore = minSide / recognitionConfig.quality.minResolution;
  const reasons: string[] = [];
  if (brightness < recognitionConfig.quality.minBrightness) reasons.push('too-dark');
  if (brightness > recognitionConfig.quality.maxBrightness) reasons.push('too-bright');
  if (glareScore > 0.015) reasons.push('glare');
  if (contrast < recognitionConfig.quality.minContrast) reasons.push('low-contrast');
  if (sharpness < recognitionConfig.quality.minSharpness) reasons.push('blurry');
  if (minSide < recognitionConfig.quality.minResolution) reasons.push('low-resolution');

  return {
    brightness,
    contrast,
    sharpness,
    glareScore,
    resolutionScore,
    passes: reasons.length === 0,
    reasons,
  };
};

const detectCropBounds = (image: HTMLImageElement): Bounds => {
  const procSize = recognitionConfig.detection.normalizedSize;
  const sampleSize = Math.min(image.width, image.height) * recognitionConfig.detection.sampleCropRatio;
  const sx = (image.width - sampleSize) / 2;
  const sy = (image.height - sampleSize) / 2;

  const canvas = createCanvas(procSize, procSize);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { x: sx, y: sy, size: sampleSize };
  }
  ctx.drawImage(image, sx, sy, sampleSize, sampleSize, 0, 0, procSize, procSize);
  const grayscale = createGrayscale(ctx.getImageData(0, 0, procSize, procSize).data);

  const windowSize = Math.round(procSize * recognitionConfig.detection.searchWindowRatio);
  const step = recognitionConfig.detection.searchStep;
  let best = { score: -1, x: (procSize - windowSize) / 2, y: (procSize - windowSize) / 2 };

  for (let y = 0; y <= procSize - windowSize; y += step) {
    for (let x = 0; x <= procSize - windowSize; x += step) {
      let energy = 0;
      for (let row = 2; row < windowSize - 2; row += 4) {
        for (let col = 2; col < windowSize - 2; col += 4) {
          const index = (y + row) * procSize + (x + col);
          energy += Math.abs(grayscale[index] - grayscale[index + 1]);
          energy += Math.abs(grayscale[index] - grayscale[index + procSize]);
        }
      }

      const center = (procSize - windowSize) / 2;
      const dx = x - center;
      const dy = y - center;
      const distancePenalty = Math.sqrt(dx * dx + dy * dy) / procSize;
      const score = energy * (1 - distancePenalty * 0.9);
      if (score > best.score) {
        best = { score, x, y };
      }
    }
  }

  const scale = sampleSize / procSize;
  return {
    x: sx + best.x * scale,
    y: sy + best.y * scale,
    size: windowSize * scale,
  };
};

export const normalizeLabelRegion = async (imageSrc: string): Promise<NormalizedCanvas> => {
  const image = await loadImage(imageSrc);
  const bounds = detectCropBounds(image);
  const size = recognitionConfig.detection.normalizedSize;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { canvas, dataUrl: imageSrc, width: size, height: size };
  }

  const expandedSize = Math.min(
    Math.min(image.width, image.height),
    bounds.size * (1 + recognitionConfig.detection.cropPaddingRatio * 2),
  );
  const expandedX = Math.max(0, Math.min(image.width - expandedSize, bounds.x - (expandedSize - bounds.size) / 2));
  const expandedY = Math.max(0, Math.min(image.height - expandedSize, bounds.y - (expandedSize - bounds.size) / 2));

  ctx.filter = 'grayscale(1) contrast(1.18) brightness(1.03)';
  ctx.drawImage(image, expandedX, expandedY, expandedSize, expandedSize, 0, 0, size, size);
  ctx.filter = 'none';
  return {
    canvas,
    dataUrl: canvas.toDataURL('image/jpeg', 0.92),
    width: size,
    height: size,
  };
};

export const cropRegion = (
  source: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  const canvas = createCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
};

export const buildRecognitionProfile = (args: {
  visualHash: string;
  roiProfiles: RecognitionRoiProfile[];
  barcodeHints: string[];
  previous?: RecognitionProfile;
}): RecognitionProfile => {
  const barcodeHints = new Set([...(args.previous?.barcodeHints || []), ...args.barcodeHints].map(sanitizeBarcode));
  const roiMap = new Map<string, RecognitionRoiProfile>();
  (args.previous?.roiProfiles || []).forEach((profile) => roiMap.set(profile.id, profile));
  args.roiProfiles.forEach((profile) => roiMap.set(profile.id, profile));

  return {
    visualHash: args.visualHash || args.previous?.visualHash || '',
    roiProfiles: Array.from(roiMap.values()),
    barcodeHints: Array.from(barcodeHints).filter(Boolean),
    learnedAt: new Date().toISOString(),
    referenceCount: (args.previous?.referenceCount || 0) + 1,
  };
};
