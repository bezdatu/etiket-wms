import { createWorker } from 'tesseract.js';
import { recognitionConfig } from '../config/recognition';
import type { OcrRegionResult } from './types';
import { calculateDHash, cropRegion, sanitizeOcrText } from './utils';

let workerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | null = null;
type CanvasWithBuffer = HTMLCanvasElement & {
  toBuffer?: (mimeType?: string) => Uint8Array;
};

const getWorker = () => {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      logger: () => undefined,
      workerPath: '/tesseract/worker.min.js',
      langPath: '/tesseract/lang',
      corePath: '/tesseract/core',
    });
  }
  return workerPromise;
};

const estimateConfidence = (text: string) => {
  if (!text) return 0;
  const compact = text.replace(/\s/g, '');
  if (!compact) return 0;
  return Math.min(1, 0.35 + compact.length * 0.08);
};

const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

const upscaleCanvas = (source: HTMLCanvasElement, scale: number, filter?: string) => {
  const canvas = createCanvas(source.width * scale, source.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  if (filter) ctx.filter = filter;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  ctx.filter = 'none';
  return canvas;
};

const thresholdCanvas = (source: HTMLCanvasElement, cutoff: number) => {
  const canvas = createCanvas(source.width, source.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(source, 0, 0);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < frame.data.length; i += 4) {
    const value = Math.round(frame.data[i] * 0.299 + frame.data[i + 1] * 0.587 + frame.data[i + 2] * 0.114);
    const normalized = value >= cutoff ? 255 : 0;
    frame.data[i] = normalized;
    frame.data[i + 1] = normalized;
    frame.data[i + 2] = normalized;
  }
  ctx.putImageData(frame, 0, 0);
  return canvas;
};

const buildRoiVariants = (roiCanvas: HTMLCanvasElement, regionId: string) => {
  const baseScale = regionId === 'title' ? 2.4 : 2;
  const sharpScale = regionId === 'title' ? 2.8 : 2.2;
  const variants = [
    roiCanvas,
    upscaleCanvas(roiCanvas, baseScale, 'grayscale(1) contrast(1.25) brightness(1.04)'),
    upscaleCanvas(roiCanvas, sharpScale, 'grayscale(1) contrast(1.7) brightness(1.02)'),
  ];

  if (regionId !== 'bottom') {
    variants.push(thresholdCanvas(upscaleCanvas(roiCanvas, sharpScale, 'grayscale(1) contrast(2.2)'), 168));
  }

  return variants;
};

const cropNormalizedRegion = (
  normalizedCanvas: HTMLCanvasElement,
  region: (typeof recognitionConfig.roiRegions)[number],
  overrides?: Partial<Pick<(typeof recognitionConfig.roiRegions)[number], 'x' | 'y' | 'width' | 'height'>>,
) => {
  const x = Math.max(0, Math.min(1, overrides?.x ?? region.x));
  const y = Math.max(0, Math.min(1, overrides?.y ?? region.y));
  const width = Math.max(0.05, Math.min(1 - x, overrides?.width ?? region.width));
  const height = Math.max(0.05, Math.min(1 - y, overrides?.height ?? region.height));

  return cropRegion(
    normalizedCanvas,
    normalizedCanvas.width * x,
    normalizedCanvas.height * y,
    normalizedCanvas.width * width,
    normalizedCanvas.height * height,
  );
};

const buildRegionCropVariants = (
  normalizedCanvas: HTMLCanvasElement,
  region: (typeof recognitionConfig.roiRegions)[number],
) => {
  if (region.id === 'title') {
    return [
      cropNormalizedRegion(normalizedCanvas, region),
      cropNormalizedRegion(normalizedCanvas, region, {
        y: region.y - 0.02,
        height: region.height + 0.05,
      }),
      cropNormalizedRegion(normalizedCanvas, region, {
        x: region.x - 0.03,
        width: region.width + 0.06,
        y: region.y + 0.02,
        height: region.height + 0.08,
      }),
    ];
  }

  if (region.id === 'variant') {
    return [
      cropNormalizedRegion(normalizedCanvas, region),
      cropNormalizedRegion(normalizedCanvas, region, {
        y: region.y - 0.03,
        height: region.height + 0.06,
      }),
      cropNormalizedRegion(normalizedCanvas, region, {
        x: region.x - 0.04,
        width: region.width + 0.08,
        y: region.y + 0.02,
        height: region.height + 0.08,
      }),
    ];
  }

  return [cropNormalizedRegion(normalizedCanvas, region)];
};

export const runRoiOcr = async (
  normalizedCanvas: HTMLCanvasElement,
  mode: 'fast' | 'full' = 'full',
): Promise<OcrRegionResult[]> => {
  const worker = await getWorker();
  const results: OcrRegionResult[] = [];

  for (const region of recognitionConfig.roiRegions) {
    const regionCrops =
      mode === 'full' ? buildRegionCropVariants(normalizedCanvas, region) : [cropNormalizedRegion(normalizedCanvas, region)];
    const roiVariants =
      mode === 'full'
        ? regionCrops.flatMap((crop) => buildRoiVariants(crop, region.id))
        : [buildRoiVariants(regionCrops[0], region.id)[0]];
    let bestText = '';
    let bestConfidence = 0;
    let bestHashSource = regionCrops[0];

    for (const roiVariant of roiVariants) {
      const canvasInput = roiVariant as CanvasWithBuffer;
      const recogInput = canvasInput.toBuffer ? canvasInput.toBuffer('image/png') : roiVariant;
      const response = await worker.recognize(
        recogInput,
        {},
        {
          text: true,
        },
      );
      const text = sanitizeOcrText(response.data.text);
      const confidence = estimateConfidence(text);
      if (confidence > bestConfidence) {
        bestText = text;
        bestConfidence = confidence;
        bestHashSource = roiVariant;
      }
    }

    results.push({
      id: region.id,
      text: bestText,
      confidence: bestConfidence,
      hash: calculateDHash(bestHashSource),
    });
  }

  return results;
};
