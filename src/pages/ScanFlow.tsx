import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  FlaskConical,
  RotateCcw,
  ScanLine,
  X,
} from 'lucide-react';
import { useStore } from '../store';
import type { Product, StockOperationType } from '../types';
import { recognitionConfig } from '../config/recognition';
import { aggregateRecognitionFrames, shouldAccumulateFrame } from '../recognition/aggregation';
import {
  applyPreferredTrackConstraints,
  describeCameraProfile,
  isContinuityCameraLabel,
  pickPreferredVideoDevice,
  type CameraProfile,
  resolveLivePreviewTuning,
} from '../recognition/cameraControls';
import { scanPreviewBarcode } from '../recognition/barcode';
import { deriveCameraFeedback } from '../recognition/feedback';
import { analyzePreviewFrame, captureVideoFrame, getPreviewFeedback } from '../recognition/liveCapture';
import { buildProductRecognitionProfile, runRecognitionPipeline } from '../recognition/pipeline';
import type {
  AggregationSummary,
  BufferedRecognitionFrame,
  CameraFeedback,
  RecognitionRunResult,
} from '../recognition/types';
import { RecognitionWorkbench } from './RecognitionWorkbench';
import type { PreviewMetrics } from '../recognition/liveCapture';

type ScanRouteState = {
  type: StockOperationType;
  recognition?: RecognitionRunResult;
};

type FrameBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const emptyRecognition: RecognitionRunResult = {
  product: null,
  confidence: 0,
  normalizedImage: '',
  barcode: null,
  roiResults: [],
  candidates: [],
  diagnostics: {
    timestamp: '',
    quality: {
      brightness: 0,
      contrast: 0,
      sharpness: 0,
      glareScore: 0,
      resolutionScore: 0,
      passes: false,
      reasons: [],
    },
    barcode: null,
    roiResults: [],
    candidates: [],
    normalizedImage: '',
    rawImage: '',
    rescanRecommended: true,
    requiresConfirmation: true,
  },
  requiresConfirmation: true,
  rescanRecommended: true,
  quality: {
    brightness: 0,
    contrast: 0,
    sharpness: 0,
    glareScore: 0,
    resolutionScore: 0,
    passes: false,
    reasons: [],
  },
  learnedVisualHash: '',
};

const numSort = (left: string, right: string) => {
  const normalizedLeft = parseInt(left.replace(/\D/g, ''), 10) || 0;
  const normalizedRight = parseInt(right.replace(/\D/g, ''), 10) || 0;
  return normalizedLeft - normalizedRight;
};

const buildAdaptiveCaptureRoi = (metrics: PreviewMetrics | null) => {
  const base = recognitionConfig.livePreview.targetRoi;
  const detected = metrics?.objectBox;
  if (!detected) return base;

  const width = Math.max(0.18, Math.min(0.92, detected.width));
  const height = Math.max(0.22, Math.min(0.95, detected.height));
  const x = Math.max(0, Math.min(1 - width, detected.x));
  const y = Math.max(0, Math.min(1 - height, detected.y));

  return {
    x,
    y,
    width,
    height,
  };
};

const buildViewfinderBox = (metrics: PreviewMetrics | null) =>
  metrics?.objectBox || recognitionConfig.livePreview.targetRoi;

const clampBox = (box: { x: number; y: number; width: number; height: number }) => {
  const width = Math.max(0.08, Math.min(1, box.width));
  const height = Math.max(0.08, Math.min(1, box.height));
  const x = Math.max(0, Math.min(1 - width, box.x));
  const y = Math.max(0, Math.min(1 - height, box.y));
  return { x, y, width, height };
};

const smoothBox = (
  previous: FrameBox | null,
  next: FrameBox,
  alpha: number,
) => {
  if (!previous) return clampBox(next);
  return clampBox({
    x: previous.x + (next.x - previous.x) * alpha,
    y: previous.y + (next.y - previous.y) * alpha,
    width: previous.width + (next.width - previous.width) * alpha,
    height: previous.height + (next.height - previous.height) * alpha,
  });
};

const buildBoxFromBarcodePoints = (
  points: Array<{ getX: () => number; getY: () => number }>,
  width: number,
  height: number,
): FrameBox | null => {
  if (!points.length || !width || !height) return null;

  const xs = points.map((point) => point.getX());
  const ys = points.map((point) => point.getY());
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const barcodeWidth = Math.max(1, maxX - minX);
  const barcodeHeight = Math.max(1, maxY - minY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const isHorizontalBarcode = barcodeWidth >= barcodeHeight;
  const baseWidth = isHorizontalBarcode
    ? Math.max(barcodeWidth * 1.85, barcodeHeight * 4.2)
    : Math.max(barcodeWidth * 4.8, barcodeHeight * 1.75);
  const baseHeight = isHorizontalBarcode
    ? Math.max(barcodeWidth * 1.95, barcodeHeight * 8.4)
    : Math.max(barcodeHeight * 1.95, barcodeWidth * 8.4);
  const targetWidth = Math.min(width, baseWidth);
  const targetHeight = Math.min(height, baseHeight);
  const shiftedCenterY = isHorizontalBarcode ? centerY + targetHeight * 0.18 : centerY;
  const shiftedCenterX = isHorizontalBarcode ? centerX : centerX + targetWidth * 0.18;

  return clampBox({
    x: (shiftedCenterX - targetWidth / 2) / width,
    y: (shiftedCenterY - targetHeight / 2) / height,
    width: targetWidth / width,
    height: targetHeight / height,
  });
};

const dilateBinaryMask = (mask: Uint8Array, width: number, height: number, radius: number) => {
  const result = new Uint8Array(mask.length);
  for (let y = radius; y < height - radius; y += 1) {
    for (let x = radius; x < width - radius; x += 1) {
      let active = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          active += mask[(y + dy) * width + (x + dx)];
        }
      }
      if (active >= Math.max(3, radius * 3)) {
        result[y * width + x] = 1;
      }
    }
  }
  return result;
};

const buildRefinedObjectBoxFromBarcode = (
  canvas: HTMLCanvasElement,
  points: Array<{ x: number; y: number }>,
): FrameBox | null => {
  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height || points.length === 0) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { data } = ctx.getImageData(0, 0, width, height);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  const barcodeWidth = Math.max(1, maxX - minX + 1);
  const barcodeCenterX = (minX + maxX) / 2;
  const barcodeCenterY = (minY + maxY) / 2;

  const searchMinX = Math.max(0, Math.floor(minX - barcodeWidth * 1.35));
  const searchMaxX = Math.min(width - 1, Math.ceil(maxX + barcodeWidth * 1.35));
  const searchMinY = Math.max(0, Math.floor(minY - barcodeWidth * 1.15));
  const searchMaxY = Math.min(height - 1, Math.ceil(maxY + barcodeWidth * 1.95));
  const searchWidth = searchMaxX - searchMinX + 1;
  const searchHeight = searchMaxY - searchMinY + 1;
  if (searchWidth < 8 || searchHeight < 8) return null;

  let brightnessSum = 0;
  let chromaSum = 0;
  const grayscale = new Uint8Array(searchWidth * searchHeight);
  const chromaValues = new Uint8Array(searchWidth * searchHeight);

  for (let y = searchMinY; y <= searchMaxY; y += 1) {
    for (let x = searchMinX; x <= searchMaxX; x += 1) {
      const sourceIndex = (y * width + x) * 4;
      const localIndex = (y - searchMinY) * searchWidth + (x - searchMinX);
      const red = data[sourceIndex];
      const green = data[sourceIndex + 1];
      const blue = data[sourceIndex + 2];
      const gray = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
      grayscale[localIndex] = gray;
      chromaValues[localIndex] = chroma;
      brightnessSum += gray;
      chromaSum += chroma;
    }
  }

  const meanBrightness = brightnessSum / Math.max(grayscale.length, 1);
  const meanChroma = chromaSum / Math.max(chromaValues.length, 1);
  const sampleGray = (x: number, y: number) => {
    const clampedX = Math.max(0, Math.min(searchWidth - 1, Math.round(x)));
    const clampedY = Math.max(0, Math.min(searchHeight - 1, Math.round(y)));
    return grayscale[clampedY * searchWidth + clampedX];
  };
  const cellSize = Math.max(6, Math.round(Math.min(searchWidth, searchHeight) / 28));
  const coarseWidth = Math.max(3, Math.ceil(searchWidth / cellSize));
  const coarseHeight = Math.max(3, Math.ceil(searchHeight / cellSize));
  const coarseMask = new Uint8Array(coarseWidth * coarseHeight);
  const brightThreshold = Math.max(146, Math.min(238, meanBrightness + 12));
  const chromaThreshold = Math.max(28, Math.min(56, meanChroma + 8));

  for (let cy = 0; cy < coarseHeight; cy += 1) {
    for (let cx = 0; cx < coarseWidth; cx += 1) {
      let brightPixels = 0;
      let samples = 0;
      const startX = cx * cellSize;
      const endX = Math.min(searchWidth, startX + cellSize);
      const startY = cy * cellSize;
      const endY = Math.min(searchHeight, startY + cellSize);

      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const localIndex = y * searchWidth + x;
          if (grayscale[localIndex] >= brightThreshold && chromaValues[localIndex] <= chromaThreshold) {
            brightPixels += 1;
          }
          samples += 1;
        }
      }

      const brightRatio = brightPixels / Math.max(samples, 1);
      if (brightRatio >= 0.22) {
        coarseMask[cy * coarseWidth + cx] = 1;
      }
    }
  }

  const expandedMask = dilateBinaryMask(coarseMask, coarseWidth, coarseHeight, 1);
  const visited = new Uint8Array(expandedMask.length);
  const anchorCellX = Math.max(0, Math.min(coarseWidth - 1, Math.floor((((minX + maxX) / 2) - searchMinX) / cellSize)));
  const anchorCellY = Math.max(0, Math.min(coarseHeight - 1, Math.floor((((minY + maxY) / 2) - searchMinY) / cellSize)));

  let best:
    | {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
        centerX: number;
        centerY: number;
        points: Array<{ x: number; y: number }>;
        score: number;
      }
    | null = null;

  for (let y = 1; y < coarseHeight - 1; y += 1) {
    for (let x = 1; x < coarseWidth - 1; x += 1) {
      const seed = y * coarseWidth + x;
      if (!expandedMask[seed] || visited[seed]) continue;
      const queue = [seed];
      visited[seed] = 1;
      let cursor = 0;
      let componentMinX = x;
      let componentMaxX = x;
      let componentMinY = y;
      let componentMaxY = y;
      let sumX = 0;
      let sumY = 0;
      let activeCells = 0;
      const componentPoints: Array<{ x: number; y: number }> = [];

      while (cursor < queue.length) {
        const index = queue[cursor++];
        const cx = index % coarseWidth;
        const cy = Math.floor(index / coarseWidth);
        activeCells += 1;
        sumX += cx;
        sumY += cy;
        componentPoints.push({ x: cx, y: cy });
        if (cx < componentMinX) componentMinX = cx;
        if (cx > componentMaxX) componentMaxX = cx;
        if (cy < componentMinY) componentMinY = cy;
        if (cy > componentMaxY) componentMaxY = cy;

        const neighbors = [index - 1, index + 1, index - coarseWidth, index + coarseWidth];
        for (const next of neighbors) {
          if (next < 0 || next >= expandedMask.length || !expandedMask[next] || visited[next]) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }

      const componentWidth = componentMaxX - componentMinX + 1;
      const componentHeight = componentMaxY - componentMinY + 1;
      const componentArea = componentWidth * componentHeight;
      if (componentArea < coarseWidth * coarseHeight * 0.05) continue;
      const containsAnchor =
        anchorCellX >= componentMinX &&
        anchorCellX <= componentMaxX &&
        anchorCellY >= componentMinY &&
        anchorCellY <= componentMaxY;
      if (!containsAnchor) continue;

      const aspect = componentWidth / Math.max(componentHeight, 1);
      const aspectPenalty = Math.abs(1 - Math.max(0.78, Math.min(1.24, aspect)));
      const density = activeCells / Math.max(componentArea, 1);
      const score =
        componentArea * 0.1 +
        density * componentArea * 1.8 -
        aspectPenalty * componentArea * 0.9;

      if (!best || score > best.score) {
        best = {
          minX: componentMinX,
          minY: componentMinY,
          maxX: componentMaxX,
          maxY: componentMaxY,
          centerX: sumX / Math.max(activeCells, 1),
          centerY: sumY / Math.max(activeCells, 1),
          points: componentPoints,
          score,
        };
      }
    }
  }

  if (!best) return null;

  const componentCenterY = searchMinY + (best.centerY + 0.5) * cellSize;
  const centerX = barcodeCenterX;
  const centerY = componentCenterY * 0.35 + (barcodeCenterY + barcodeWidth * 0.58) * 0.65;
  const distances = best.points
    .map((point) => {
      const px = searchMinX + (point.x + 0.5) * cellSize;
      const py = searchMinY + (point.y + 0.5) * cellSize;
      return Math.sqrt((px - centerX) ** 2 + (py - centerY) ** 2);
    })
    .sort((left, right) => left - right);
  const radiusIndex = Math.max(0, Math.floor(distances.length * 0.88) - 1);
  const estimatedRadius = Math.max(cellSize * 5, distances[radiusIndex] || cellSize * 8);
  const edgeRadii: number[] = [];
  const edgePoints: Array<{ x: number; y: number }> = [];

  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 18) {
    let bestRadius = 0;
    let bestDrop = 0;
    const startRadius = Math.max(cellSize * 4, estimatedRadius * 0.55);
    const endRadius = Math.min(
      Math.max(searchWidth, searchHeight),
      estimatedRadius * 1.7,
    );
    for (let radius = startRadius; radius <= endRadius; radius += 2) {
      const innerGray = sampleGray(
        centerX - searchMinX + Math.cos(angle) * Math.max(0, radius - 4),
        centerY - searchMinY + Math.sin(angle) * Math.max(0, radius - 4),
      );
      const outerGray = sampleGray(
        centerX - searchMinX + Math.cos(angle) * radius,
        centerY - searchMinY + Math.sin(angle) * radius,
      );
      const drop = innerGray - outerGray;
      if (innerGray >= meanBrightness && drop > bestDrop) {
        bestDrop = drop;
        bestRadius = radius;
      }
    }
    if (bestRadius > 0 && bestDrop >= 12) {
      edgeRadii.push(bestRadius);
      edgePoints.push({
        x: centerX + Math.cos(angle) * bestRadius,
        y: centerY + Math.sin(angle) * bestRadius,
      });
    }
  }

  const refinedRadius =
    edgeRadii.length >= 8
      ? edgeRadii.sort((left, right) => left - right)[Math.floor(edgeRadii.length * 0.5)]
      : estimatedRadius;
  const fittedCircle = fitCircleToPoints(edgePoints);
  const fittedCenterX = fittedCircle?.centerX ?? centerX;
  const fittedCenterY = fittedCircle?.centerY ?? centerY;
  const fittedRadius = fittedCircle?.radius ?? refinedRadius;
  const targetSize = Math.max(estimatedRadius * 2.22, fittedRadius * 2.14, refinedRadius * 2.22);
  const minComponentX = fittedCenterX - targetSize / 2;
  const minComponentY = fittedCenterY - targetSize / 2;
  const padding = Math.round(targetSize * 0.025);
  return clampBox({
    x: (minComponentX - padding) / width,
    y: (minComponentY - padding) / height,
    width: (targetSize + padding * 2) / width,
    height: (targetSize + padding * 2) / height,
  });
};

const buildBarcodeCaptureRoi = (roi: { x: number; y: number; width: number; height: number }) => {
  const width = Math.min(0.92, roi.width * 1.55);
  const height = Math.min(0.86, roi.height * 0.72);
  const x = Math.max(0, Math.min(1 - width, roi.x - (width - roi.width) / 2));
  const y = Math.max(0, Math.min(1 - height, roi.y + roi.height * 0.14));

  return {
    x,
    y,
    width,
    height,
  };
};

const solveLinear3x3 = (matrix: number[][], vector: number[]) => {
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let pivot = 0; pivot < 3; pivot += 1) {
    let maxRow = pivot;
    for (let row = pivot + 1; row < 3; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[maxRow][pivot])) {
        maxRow = row;
      }
    }

    if (Math.abs(augmented[maxRow][pivot]) < 1e-6) {
      return null;
    }

    if (maxRow !== pivot) {
      const tmp = augmented[pivot];
      augmented[pivot] = augmented[maxRow];
      augmented[maxRow] = tmp;
    }

    const pivotValue = augmented[pivot][pivot];
    for (let column = pivot; column < 4; column += 1) {
      augmented[pivot][column] /= pivotValue;
    }

    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column < 4; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }

  return [augmented[0][3], augmented[1][3], augmented[2][3]];
};

const fitCircleToPoints = (points: Array<{ x: number; y: number }>) => {
  if (points.length < 6) return null;

  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;
  let sumXXXYY = 0;
  let sumXXY = 0;
  let sumXYY = 0;

  for (const point of points) {
    const x = point.x;
    const y = point.y;
    const xx = x * x;
    const yy = y * y;
    sumX += x;
    sumY += y;
    sumXX += xx;
    sumYY += yy;
    sumXY += x * y;
    sumXXXYY += -(xx + yy);
    sumXXY += -(xx + yy) * x;
    sumXYY += -(xx + yy) * y;
  }

  const solution = solveLinear3x3(
    [
      [sumXX, sumXY, sumX],
      [sumXY, sumYY, sumY],
      [sumX, sumY, points.length],
    ],
    [sumXXY, sumXYY, sumXXXYY],
  );

  if (!solution) return null;
  const [a, b, c] = solution;
  const centerX = -a / 2;
  const centerY = -b / 2;
  const radiusSquared = centerX * centerX + centerY * centerY - c;
  if (!Number.isFinite(radiusSquared) || radiusSquared <= 0) return null;

  const radii = points
    .map((point) => Math.sqrt((point.x - centerX) ** 2 + (point.y - centerY) ** 2))
    .sort((left, right) => left - right);
  const radius = radii[Math.floor(radii.length * 0.6)];
  if (!Number.isFinite(radius) || radius <= 0) return null;

  return {
    centerX,
    centerY,
    radius,
  };
};

const buildShapeObjectBoxFromCanvas = (
  canvas: HTMLCanvasElement,
  anchorPoints?: Array<{ x: number; y: number }>,
): FrameBox | null => {
  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return null;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { data } = ctx.getImageData(0, 0, width, height);

  const cellSize = Math.max(6, Math.round(Math.min(width, height) / 42));
  const gridWidth = Math.max(4, Math.ceil(width / cellSize));
  const gridHeight = Math.max(4, Math.ceil(height / cellSize));
  const mask = new Uint8Array(gridWidth * gridHeight);

  let brightnessSum = 0;
  let chromaSum = 0;
  const grayscale = new Uint8Array(width * height);
  const chroma = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const gray = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
      const colorSpread = Math.max(red, green, blue) - Math.min(red, green, blue);
      grayscale[index] = gray;
      chroma[index] = colorSpread;
      brightnessSum += gray;
      chromaSum += colorSpread;
    }
  }

  const meanBrightness = brightnessSum / Math.max(grayscale.length, 1);
  const meanChroma = chromaSum / Math.max(chroma.length, 1);
  const brightThreshold = Math.max(150, Math.min(238, meanBrightness + 14));
  const chromaThreshold = Math.max(24, Math.min(60, meanChroma + 8));

  for (let gy = 0; gy < gridHeight; gy += 1) {
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const startX = gx * cellSize;
      const endX = Math.min(width, startX + cellSize);
      const startY = gy * cellSize;
      const endY = Math.min(height, startY + cellSize);
      let brightPixels = 0;
      let samples = 0;

      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const index = y * width + x;
          if (grayscale[index] >= brightThreshold && chroma[index] <= chromaThreshold) {
            brightPixels += 1;
          }
          samples += 1;
        }
      }

      if (brightPixels / Math.max(samples, 1) >= 0.2) {
        mask[gy * gridWidth + gx] = 1;
      }
    }
  }

  const expandedMask = dilateBinaryMask(mask, gridWidth, gridHeight, 1);
  const visited = new Uint8Array(expandedMask.length);
  const frameCenterX = gridWidth / 2;
  const frameCenterY = gridHeight / 2;
  const anchorCenter = anchorPoints?.length
    ? {
        x: anchorPoints.reduce((sum, point) => sum + point.x, 0) / anchorPoints.length,
        y: anchorPoints.reduce((sum, point) => sum + point.y, 0) / anchorPoints.length,
      }
    : null;
  const anchorCellX = anchorCenter ? anchorCenter.x / cellSize : null;
  const anchorCellY = anchorCenter ? anchorCenter.y / cellSize : null;

  let best:
    | {
        centerX: number;
        centerY: number;
        radius: number;
        score: number;
      }
    | null = null;

  for (let gy = 1; gy < gridHeight - 1; gy += 1) {
    for (let gx = 1; gx < gridWidth - 1; gx += 1) {
      const seed = gy * gridWidth + gx;
      if (!expandedMask[seed] || visited[seed]) continue;

      const queue = [seed];
      visited[seed] = 1;
      let cursor = 0;
      const points: Array<{ x: number; y: number }> = [];
      let minX = gx;
      let maxX = gx;
      let minY = gy;
      let maxY = gy;

      while (cursor < queue.length) {
        const index = queue[cursor++];
        const x = index % gridWidth;
        const y = Math.floor(index / gridWidth);
        points.push({ x, y });
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        const neighbors = [index - 1, index + 1, index - gridWidth, index + gridWidth];
        for (const next of neighbors) {
          if (next < 0 || next >= expandedMask.length || !expandedMask[next] || visited[next]) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }

      if (points.length < 16) continue;

      const circle = fitCircleToPoints(points);
      if (!circle) continue;

      const avgDistance =
        points.reduce((sum, point) => sum + Math.sqrt((point.x - circle.centerX) ** 2 + (point.y - circle.centerY) ** 2), 0) /
        points.length;
      const distanceVariance =
        points.reduce((sum, point) => {
          const distance = Math.sqrt((point.x - circle.centerX) ** 2 + (point.y - circle.centerY) ** 2);
          return sum + (distance - avgDistance) ** 2;
        }, 0) / points.length;
      const radiusStd = Math.sqrt(distanceVariance);
      const areaRatio = points.length / Math.max(gridWidth * gridHeight, 1);
      const centerDistance =
        Math.sqrt((circle.centerX - frameCenterX) ** 2 + (circle.centerY - frameCenterY) ** 2) /
        Math.max(gridWidth, gridHeight);
      const anchorDistance =
        anchorCellX !== null && anchorCellY !== null
          ? Math.sqrt((circle.centerX - anchorCellX) ** 2 + (circle.centerY - anchorCellY) ** 2) /
            Math.max(gridWidth, gridHeight)
          : null;
      const circularityPenalty = radiusStd / Math.max(circle.radius, 1);
      const containsAnchor =
        anchorCellX === null ||
        anchorCellY === null ||
        (anchorCellX >= minX && anchorCellX <= maxX && anchorCellY >= minY && anchorCellY <= maxY);

      if (circle.radius < 4 || areaRatio < 0.04 || areaRatio > 0.55) continue;
      if (!containsAnchor) continue;

      const score =
        areaRatio * 3.8 +
        Math.max(0, 1 - circularityPenalty * 6) * 1.9 +
        Math.max(0, 1 - centerDistance * 1.7) +
        (anchorDistance === null ? 0 : Math.max(0, 1 - anchorDistance * 2.2) * 2.4);

      if (!best || score > best.score) {
        best = {
          centerX: circle.centerX,
          centerY: circle.centerY,
          radius: circle.radius,
          score,
        };
      }
    }
  }

  if (!best) return null;

  const pixelCenterX = (best.centerX + 0.5) * cellSize;
  const pixelCenterY = (best.centerY + 0.5) * cellSize;
  const pixelRadius = best.radius * cellSize;
  const targetSize = pixelRadius * 2.28;
  const padding = targetSize * 0.03;

  return clampBox({
    x: (pixelCenterX - targetSize / 2 - padding) / width,
    y: (pixelCenterY - targetSize / 2 - padding) / height,
    width: (targetSize + padding * 2) / width,
    height: (targetSize + padding * 2) / height,
  });
};

const createPreviewSnapshot = (video: HTMLVideoElement) => {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
};

const normalizeOcrTitle = (value: string) => value.replace(/\s+/g, ' ').trim();
const buildBarcodePlaceholderName = (barcode: string) => `Новый товар по штрихкоду ${barcode}`;

const isLikelyUsefulOcrTitle = (
  value: string,
  confidence: number,
  options: { barcodeLocked: boolean; barcodePresent: boolean },
) => {
  const normalized = normalizeOcrTitle(value);
  if (normalized.length < 4) return false;

  const letters = normalized.match(/[A-Za-zА-Яа-яЁё]/g) || [];
  const digits = normalized.match(/\d/g) || [];
  const words = normalized.split(' ').filter(Boolean);
  const alphaRatio = letters.length / normalized.length;
  const singleCharWords = words.filter((word) => word.length === 1).length;
  const meaningfulWords = words.filter((word) => (word.match(/[A-Za-zА-Яа-яЁё]/g) || []).length >= 3).length;
  const averageWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;

  if (alphaRatio < 0.45) return false;
  if (digits.length > normalized.length * 0.45) return false;
  if (singleCharWords > Math.ceil(words.length / 2)) return false;
  if (averageWordLength < 2.5) return false;
  if (meaningfulWords === 0) return false;
  if (options.barcodePresent) {
    if (normalized.length > 48) return false;
    if (words.length > 6) return false;
  } else if (normalized.length > 72 || words.length > 10) {
    return false;
  }
  if (options.barcodeLocked) {
    return confidence >= 55 && normalized.length >= 6;
  }
  if (options.barcodePresent) {
    return confidence >= 45 && meaningfulWords >= 1;
  }
  return confidence >= 35 || normalized.length >= 8;
};

const isLikelyUsefulOcrSnippet = (
  value: string,
  confidence: number,
  options: { barcodeLocked: boolean; barcodePresent: boolean },
) => {
  const normalized = normalizeOcrTitle(value);
  if (normalized.length < 2) return false;

  const words = normalized.split(' ').filter(Boolean);
  const letters = normalized.match(/[A-Za-zА-Яа-яЁё]/g) || [];
  const digits = normalized.match(/\d/g) || [];
  const alphaRatio = letters.length / normalized.length;
  const meaningfulWords = words.filter((word) => (word.match(/[A-Za-zА-Яа-яЁё]/g) || []).length >= 2).length;

  if (alphaRatio < 0.35) return false;
  if (digits.length > normalized.length * 0.55) return false;
  if (options.barcodePresent && words.length > 8) return false;
  if (options.barcodeLocked) {
    return confidence >= 50 && meaningfulWords >= 1 && normalized.length <= 42;
  }
  if (options.barcodePresent) {
    return confidence >= 38 && meaningfulWords >= 1 && normalized.length <= 56;
  }
  return confidence >= 28 && meaningfulWords >= 1;
};

export const ScanFlow = () => (
  <Routes>
    <Route path="/" element={<ScanModeSelect />} />
    <Route path="camera" element={<CameraCapture />} />
    <Route path="result" element={<ScanResult />} />
    <Route path="benchmark" element={<RecognitionWorkbench />} />
  </Routes>
);

const ScanModeSelect = () => {
  const navigate = useNavigate();

  return (
    <div className="flex h-[70vh] flex-col items-center justify-center space-y-6">
      <div className="mb-8 space-y-2 text-center">
        <h2 className="text-3xl font-bold">Сканирование</h2>
        <p className="text-muted">Каскадный pipeline: barcode, ROI, confidence, diagnostics</p>
      </div>

      <button
        onClick={() => navigate('camera', { state: { type: 'incoming' } })}
        className="w-full rounded-3xl border border-primary-500/30 bg-gradient-to-br from-primary-900/50 to-primary-800/20 p-8 transition-colors hover:border-primary-500"
      >
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-full bg-primary-500 p-4 text-white">
            <ArrowRight className="rotate-90" size={32} />
          </div>
          <span className="text-2xl font-bold">Принять товар</span>
        </div>
      </button>

      <button
        onClick={() => navigate('camera', { state: { type: 'outgoing' } })}
        className="w-full rounded-3xl border border-red-500/30 bg-gradient-to-br from-red-900/50 to-red-800/20 p-8 transition-colors hover:border-red-500"
      >
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-full bg-red-500 p-4 text-white">
            <ArrowRight className="-rotate-90" size={32} />
          </div>
          <span className="text-2xl font-bold">Выдать товар</span>
        </div>
      </button>

      <button
        onClick={() => navigate('benchmark')}
        className="w-full rounded-3xl border border-slate-700 bg-slate-900/80 p-6 transition-colors hover:border-primary-500"
      >
        <div className="flex items-center justify-center gap-3">
          <FlaskConical className="text-primary-400" size={22} />
          <span className="text-lg font-semibold">Benchmark и diagnostics</span>
        </div>
      </button>
    </div>
  );
};

const CameraCapture = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const debugEnabled = useMemo(() => new URLSearchParams(location.search).has('debug'), [location.search]);
  const opType = (location.state as ScanRouteState | null)?.type || 'incoming';
  const { products } = useStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [previewStreamSize, setPreviewStreamSize] = useState({ width: 0, height: 0 });
  const [isScanning, setIsScanning] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [cameraFacingMode, setCameraFacingMode] = useState<'environment' | 'user'>('environment');
  const [availableVideoDevices, setAvailableVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [cameraProfile, setCameraProfile] = useState<CameraProfile | null>(null);
  const [aggregation, setAggregation] = useState<AggregationSummary | null>(null);
  const [feedback, setFeedback] = useState<CameraFeedback[]>([]);
  const [previewMetrics, setPreviewMetrics] = useState<PreviewMetrics | null>(null);
  const [smoothedViewfinderBox, setSmoothedViewfinderBox] = useState<FrameBox | null>(null);
  const [barcodeTrackedBox, setBarcodeTrackedBox] = useState<FrameBox | null>(null);
  const [shapeTrackedBox, setShapeTrackedBox] = useState<FrameBox | null>(null);
  const usesContinuityPreview = Boolean(cameraProfile && isContinuityCameraLabel(cameraProfile.label));
  const continuityNeedsRotation =
    usesContinuityPreview && previewStreamSize.height > 0 && previewStreamSize.height > previewStreamSize.width;
  const previewAspectRatio =
    previewStreamSize.width > 0 && previewStreamSize.height > 0
      ? continuityNeedsRotation
        ? previewStreamSize.height / previewStreamSize.width
        : previewStreamSize.width / previewStreamSize.height
      : 16 / 9;
  const continuityStageWidth =
    previewStreamSize.width > 0 && previewStreamSize.height > 0
      ? `${(previewStreamSize.width / previewStreamSize.height) * 100}%`
      : '75%';
  const continuityStageHeight =
    previewStreamSize.width > 0 && previewStreamSize.height > 0
      ? `${(previewStreamSize.height / previewStreamSize.width) * 100}%`
      : '133.333%';
  const detectedViewfinderBox = buildViewfinderBox(previewMetrics);
  const viewfinderBox = shapeTrackedBox || barcodeTrackedBox || smoothedViewfinderBox || detectedViewfinderBox;
  const adaptiveCaptureRoi = buildAdaptiveCaptureRoi(previewMetrics);
  const barcodeCaptureRoi = buildBarcodeCaptureRoi(adaptiveCaptureRoi);
  const livePreviewTuning = resolveLivePreviewTuning(
    {
      minBrightness: recognitionConfig.livePreview.minBrightness,
      maxBrightness: recognitionConfig.livePreview.maxBrightness,
      minContrast: recognitionConfig.livePreview.minContrast,
      minSharpness: recognitionConfig.livePreview.minSharpness,
      maxMotion: recognitionConfig.livePreview.maxMotion,
      minCoverage: recognitionConfig.livePreview.minCoverage,
      maxCoverage: recognitionConfig.livePreview.maxCoverage,
      minCenteredness: recognitionConfig.livePreview.minCenteredness,
      minAspectRatio: recognitionConfig.livePreview.minAspectRatio,
      requiredStableFrames: recognitionConfig.livePreview.requiredStableFrames,
      burstFrames: recognitionConfig.livePreview.burstFrames,
      burstIntervalMs: recognitionConfig.livePreview.burstIntervalMs,
      capturePadding: recognitionConfig.livePreview.capturePadding,
    },
    cameraProfile,
  );
  const sessionRef = useRef<{
    frames: BufferedRecognitionFrame[];
    framesSeen: number;
    startedAt: number;
    isProcessing: boolean;
    isResolved: boolean;
    stableFrames: number;
    previousPreviewFrame: Uint8Array | null;
    analysisTimer: number | null;
    frameCallbackId: number | null;
  }>({
    frames: [],
    framesSeen: 0,
    startedAt: 0,
    isProcessing: false,
    isResolved: false,
    stableFrames: 0,
    previousPreviewFrame: null,
    analysisTimer: null,
    frameCallbackId: null,
  });

  const resetSession = useCallback(() => {
    sessionRef.current = {
      frames: [],
      framesSeen: 0,
      startedAt: 0,
      isProcessing: false,
      isResolved: false,
      stableFrames: 0,
      previousPreviewFrame: null,
      analysisTimer: null,
      frameCallbackId: null,
    };
    setAggregation(null);
    setFeedback([]);
    setPreviewMetrics(null);
    setSmoothedViewfinderBox(null);
    setBarcodeTrackedBox(null);
    setShapeTrackedBox(null);
  }, []);

  const resolveSession = useCallback(
    (recognition: RecognitionRunResult) => {
      if (sessionRef.current.isResolved) return;
      sessionRef.current.isResolved = true;
      setIsScanning(false);
      navigate('/scan/result', {
        state: {
          type: opType,
          recognition,
        } satisfies ScanRouteState,
      });
    },
    [navigate, opType],
  );

  const buildPreviewFeedback = useCallback((messages: string[], metricsReady: boolean) => {
    const mappedReasons: CameraFeedback['reason'][] = metricsReady
      ? ['locked', 'stabilizing']
      : ['stabilizing', 'move-closer', 'off-center'];

    return messages.map((message, index) => ({
      severity: message === 'Объект зафиксирован' ? 'info' : 'warning',
      message,
      reason: mappedReasons[index] || 'stabilizing',
    })) as CameraFeedback[];
  }, []);

  const processCaptureBurst = useCallback(async () => {
    if (sessionRef.current.isResolved || sessionRef.current.isProcessing) return;

    const video = videoRef.current;
    if (!video) return;

    sessionRef.current.isProcessing = true;
    sessionRef.current.frames = [];
    sessionRef.current.framesSeen = 0;
    setScanStatus('Объект зафиксирован, снимаю серию кадров...');

    try {
      for (let index = 0; index < livePreviewTuning.burstFrames; index += 1) {
        try {
          const roiCapture = captureVideoFrame(video, {
            mimeType: 'image/jpeg',
            quality: 0.96,
            roi: adaptiveCaptureRoi,
            padding: livePreviewTuning.capturePadding,
          });
          const barcodeCapture = captureVideoFrame(video, {
            mimeType: 'image/jpeg',
            quality: 0.96,
            roi: barcodeCaptureRoi,
            padding: Math.min(0.18, livePreviewTuning.capturePadding + 0.05),
          });
          const captureSrc = roiCapture || barcodeCapture;
          if (!captureSrc) continue;

          const result = await runRecognitionPipeline(captureSrc, products, {
            persistDiagnostics: false,
            barcodeImageSrc: barcodeCapture || captureSrc,
            ocrMode: index === livePreviewTuning.burstFrames - 1 ? 'full' : 'fast',
          });
          const accepted = shouldAccumulateFrame(result);
          sessionRef.current.framesSeen += 1;
          sessionRef.current.frames = [
            ...sessionRef.current.frames,
            {
              id: `burst_${Date.now()}_${index}`,
              capturedAt: Date.now(),
              accepted,
              result,
            },
          ].slice(-recognitionConfig.aggregation.bufferSize);
          const aggregated = aggregateRecognitionFrames(sessionRef.current.frames, false, { persistDiagnostics: false });
          setAggregation(aggregated?.aggregation || null);
          setFeedback(deriveCameraFeedback(result, aggregated?.aggregation || null));
          setScanStatus(`Анализ серии кадров ${index + 1}/${livePreviewTuning.burstFrames}`);
        } catch (frameError) {
          console.warn('Recognition frame failed, continuing burst', frameError);
          setScanStatus(`Пропускаю кадр ${index + 1}, продолжаю серию...`);
        }

        if (index < livePreviewTuning.burstFrames - 1) {
          await new Promise((resolve) => window.setTimeout(resolve, livePreviewTuning.burstIntervalMs));
        }
      }

      const finalResult =
        aggregateRecognitionFrames(sessionRef.current.frames, false) ||
        aggregateRecognitionFrames(sessionRef.current.frames, true);

      if (finalResult) {
        setScanStatus(finalResult.rescanRecommended ? 'Нужна ручная проверка результата' : 'Результат стабилизирован');
        resolveSession(finalResult);
        return;
      }

      setScanStatus('Не удалось собрать пригодную серию, попробуйте снова');
      sessionRef.current.stableFrames = 0;
    } catch (error) {
      console.error('Recognition pipeline failed', error);
      setScanStatus('Ошибка распознавания');
      setIsScanning(false);
      sessionRef.current.isResolved = true;
    } finally {
      sessionRef.current.isProcessing = false;
    }
  }, [adaptiveCaptureRoi, barcodeCaptureRoi, livePreviewTuning.burstFrames, livePreviewTuning.burstIntervalMs, livePreviewTuning.capturePadding, products, resolveSession]);

  const handleScan = useCallback(async () => {
    if (isScanning) {
      setIsScanning(false);
      setScanStatus('Сканирование остановлено');
      sessionRef.current.isResolved = true;
      return;
    }

    resetSession();
    sessionRef.current.startedAt = Date.now();
    setIsScanning(true);
    setScanStatus('Наводите этикетку в рамку, ищу стабильный захват...');
  }, [isScanning, resetSession]);

  const handleCameraError = useCallback(
    (error: string | DOMException) => {
      console.error('Camera stream failed', error);
      setIsCameraReady(false);
      setCameraProfile(null);
      if (cameraFacingMode === 'environment') {
        setCameraFacingMode('user');
        setScanStatus('Задняя камера недоступна, переключаюсь на фронтальную...');
        return;
      }

      setScanStatus('Не удалось подключить камеру. Проверьте доступ браузера и разрешение камеры в macOS.');
    },
    [cameraFacingMode],
  );

  useEffect(() => {
    let cancelled = false;

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setScanStatus('Браузер не поддерживает доступ к камере');
        return;
      }

      try {
        setScanStatus('Подключаю камеру...');
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((device) => device.kind === 'videoinput');
        setAvailableVideoDevices(videoDevices);
        const hasLabeledDevices = videoDevices.some((device) => device.label.trim().length > 0);
        const preferredDevice =
          videoDevices.find((device) => device.deviceId === selectedDeviceId) ||
          pickPreferredVideoDevice(devices, cameraFacingMode);
        const continuityTarget = Boolean(
          preferredDevice && isContinuityCameraLabel(preferredDevice.label),
        );
        const shouldBootstrapSafari = isSafari && !selectedDeviceId;
        const stream = await navigator.mediaDevices.getUserMedia(
          shouldBootstrapSafari
            ? {
                audio: false,
                video: true,
              }
            : {
                audio: false,
                video: continuityTarget
                  ? {
                      deviceId: preferredDevice ? { ideal: preferredDevice.deviceId } : undefined,
                      width: { min: 960, ideal: 1440 },
                      height: { min: 720, ideal: 1080 },
                      aspectRatio: { ideal: 4 / 3 },
                      frameRate: { ideal: 30, max: 30 },
                    }
                  : {
                      deviceId: preferredDevice ? { ideal: preferredDevice.deviceId } : undefined,
                      facingMode:
                        preferredDevice || !hasLabeledDevices
                          ? undefined
                          : { ideal: cameraFacingMode },
                      width: { ideal: 1920 },
                      height: { ideal: 1080 },
                      frameRate: { ideal: 30, max: 30 },
                    },
              },
        );

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = stream;
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          await applyPreferredTrackConstraints(videoTrack);
          setCameraProfile(describeCameraProfile(videoTrack));
          const activeLabel = videoTrack.label || '';
          const activeSettings = videoTrack.getSettings?.();
          const activeDeviceId = activeSettings?.deviceId || preferredDevice?.deviceId || '';
          const refreshedDevices = await navigator.mediaDevices.enumerateDevices();
          const refreshedVideoDevices = refreshedDevices.filter((device) => device.kind === 'videoinput');
          setAvailableVideoDevices(refreshedVideoDevices);
          const refreshedPreferredDevice =
            refreshedVideoDevices.find((device) => device.deviceId === selectedDeviceId) ||
            pickPreferredVideoDevice(refreshedDevices, cameraFacingMode);
          if (
            !selectedDeviceId &&
            refreshedPreferredDevice?.deviceId &&
            isContinuityCameraLabel(refreshedPreferredDevice.label) &&
            !isContinuityCameraLabel(activeLabel) &&
            activeDeviceId &&
            refreshedPreferredDevice.deviceId !== activeDeviceId
          ) {
            setScanStatus(`Переключаюсь на предпочитаемую камеру: ${refreshedPreferredDevice.label || 'camera'}`);
            setSelectedDeviceId(refreshedPreferredDevice.deviceId);
            return;
          }
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setIsCameraReady(true);
        setScanStatus('Камера готова. Наведите этикетку в рамку.');
      } catch (error) {
        handleCameraError(error as DOMException);
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [cameraFacingMode, handleCameraError, selectedDeviceId]);

  useEffect(() => {
    if (barcodeTrackedBox) {
      return;
    }
    if (shapeTrackedBox) {
      return;
    }
    if (!previewMetrics?.objectBox) {
      if (!isScanning) {
        setSmoothedViewfinderBox(null);
      }
      return;
    }

    setSmoothedViewfinderBox((previous) =>
      smoothBox(previous, previewMetrics.objectBox!, previewMetrics.ready ? 0.18 : 0.34),
    );
  }, [barcodeTrackedBox, isScanning, previewMetrics, shapeTrackedBox]);

  useEffect(() => {
    if (!isCameraReady || !videoRef.current) return undefined;

    let cancelled = false;
    let misses = 0;

    const detectPreviewBarcode = async () => {
      const video = videoRef.current;
      if (cancelled || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

      const snapshot = createPreviewSnapshot(video);
      if (!snapshot) return;

      const match = await scanPreviewBarcode(snapshot);
      if (cancelled) return;

      const shapeBox = buildShapeObjectBoxFromCanvas(snapshot, match?.points);
      if (shapeBox) {
        setShapeTrackedBox((previous) => smoothBox(previous, shapeBox, 0.26));
      } else if (!match) {
        setShapeTrackedBox(null);
      }

      if (match?.points.length) {
        misses = 0;
        const nextBox =
          buildRefinedObjectBoxFromBarcode(snapshot, match.points) ||
          buildBoxFromBarcodePoints(
            match.points.map((point) => ({
              getX: () => point.x,
              getY: () => point.y,
            })),
            video.videoWidth,
            video.videoHeight,
          );
        if (!nextBox) return;
        setBarcodeTrackedBox((previous) => smoothBox(previous, nextBox, 0.28));
        return;
      }

      misses += 1;
      if (misses >= 3) {
        setBarcodeTrackedBox(null);
      }
    };

    void detectPreviewBarcode();
    const timer = window.setInterval(() => {
      void detectPreviewBarcode();
    }, 450);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      setBarcodeTrackedBox(null);
      setShapeTrackedBox(null);
    };
  }, [isCameraReady, selectedDeviceId]);

  useEffect(() => {
    if (!isCameraReady) return undefined;

    const scheduleNextAnalyze = () => {
      const candidate = videoRef.current as HTMLVideoElement & {
        requestVideoFrameCallback?: (callback: () => void) => number;
      };
      if (candidate?.requestVideoFrameCallback) {
        sessionRef.current.frameCallbackId = candidate.requestVideoFrameCallback(() => analyze());
      }
    };

    const analyze = () => {
      if (sessionRef.current.isResolved) return;
      if (sessionRef.current.isProcessing) {
        scheduleNextAnalyze();
        return;
      }

      const video = videoRef.current;
      if (!video) {
        scheduleNextAnalyze();
        return;
      }

      const analysis = analyzePreviewFrame(
        video,
        recognitionConfig.livePreview.targetRoi,
        sessionRef.current.previousPreviewFrame,
        livePreviewTuning,
      );
      if (!analysis) {
        scheduleNextAnalyze();
        return;
      }

      sessionRef.current.previousPreviewFrame = analysis.grayscale;
      setPreviewMetrics(analysis.metrics);
      const previewMessages = getPreviewFeedback(analysis.metrics);
      setFeedback(buildPreviewFeedback(previewMessages, analysis.metrics.ready));

      if (analysis.metrics.ready) {
        sessionRef.current.stableFrames += 1;
        if (isScanning) {
          setScanStatus(
            sessionRef.current.stableFrames >= livePreviewTuning.requiredStableFrames
              ? 'Объект зафиксирован, готовлю захват...'
              : `Фиксирую объект ${sessionRef.current.stableFrames}/${livePreviewTuning.requiredStableFrames}`,
          );
        } else {
          setScanStatus('Объект найден. Совместите его и начинайте сканирование.');
        }
      } else {
        sessionRef.current.stableFrames = 0;
        setScanStatus(
          isScanning
            ? 'Наводите этикетку в рамку, добиваюсь стабильного preview'
            : 'Камера готова. Наведите этикетку в кадр.',
        );
      }

      if (isScanning && sessionRef.current.stableFrames >= livePreviewTuning.requiredStableFrames) {
        void processCaptureBurst();
      }
      scheduleNextAnalyze();
    };

    const candidate = videoRef.current as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    if (candidate?.requestVideoFrameCallback) {
      sessionRef.current.frameCallbackId = candidate.requestVideoFrameCallback(() => analyze());
    } else {
      sessionRef.current.analysisTimer = window.setInterval(analyze, 110);
    }

    return () => {
      if (sessionRef.current.analysisTimer) {
        window.clearInterval(sessionRef.current.analysisTimer);
      }
      if (candidate?.cancelVideoFrameCallback && sessionRef.current.frameCallbackId) {
        candidate.cancelVideoFrameCallback(sessionRef.current.frameCallbackId);
      }
      sessionRef.current.analysisTimer = null;
      sessionRef.current.frameCallbackId = null;
    };
  }, [buildPreviewFeedback, isCameraReady, isScanning, livePreviewTuning, processCaptureBurst]);

  return (
    <div className="flex h-[88vh] flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold">{opType === 'incoming' ? 'Приёмка' : 'Выдача'}</h2>
        <button onClick={() => navigate('/scan')} className="rounded-full bg-slate-800 p-2 text-muted">
          <X size={20} />
        </button>
      </div>

      <div
        className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border-2 border-slate-700 bg-black shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
        style={{ aspectRatio: previewAspectRatio.toString() }}
      >
        {continuityNeedsRotation ? (
          <div
            className="absolute left-1/2 top-1/2"
            style={{
              width: continuityStageWidth,
              height: continuityStageHeight,
              transform: 'translate(-50%, -50%) rotate(-90deg)',
              transformOrigin: 'center center',
            }}
          >
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              onLoadedMetadata={(event) =>
                setPreviewStreamSize({
                  width: event.currentTarget.videoWidth,
                  height: event.currentTarget.videoHeight,
                })
              }
              className="absolute inset-0 h-full w-full object-contain"
            />
            {isCameraReady && (
              <div className="pointer-events-none absolute inset-0">
                <div
                  className={`absolute rounded-2xl border-2 transition-colors ${
                    isScanning && sessionRef.current.stableFrames > 0
                      ? 'border-emerald-400/80 shadow-[0_0_0_1px_rgba(52,211,153,0.4)]'
                      : 'border-primary-500/60'
                  }`}
                  style={{
                    left: `${viewfinderBox.x * 100}%`,
                    top: `${viewfinderBox.y * 100}%`,
                    width: `${viewfinderBox.width * 100}%`,
                    height: `${viewfinderBox.height * 100}%`,
                  }}
                >
                  <div className="absolute left-0 top-0 h-8 w-8 rounded-tl-xl border-l-4 border-t-4 border-primary-500" />
                  <div className="absolute right-0 top-0 h-8 w-8 rounded-tr-xl border-r-4 border-t-4 border-primary-500" />
                  <div className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-xl border-b-4 border-l-4 border-primary-500" />
                  <div className="absolute bottom-0 right-0 h-8 w-8 rounded-br-xl border-b-4 border-r-4 border-primary-500" />
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              onLoadedMetadata={(event) =>
                setPreviewStreamSize({
                  width: event.currentTarget.videoWidth,
                  height: event.currentTarget.videoHeight,
                })
              }
              className="absolute inset-0 h-full w-full object-contain"
            />
            {isCameraReady && (
              <div className="pointer-events-none absolute inset-0">
                <div
                  className={`absolute rounded-2xl border-2 transition-colors ${
                    isScanning && sessionRef.current.stableFrames > 0
                      ? 'border-emerald-400/80 shadow-[0_0_0_1px_rgba(52,211,153,0.4)]'
                      : 'border-primary-500/60'
                  }`}
                  style={{
                    left: `${viewfinderBox.x * 100}%`,
                    top: `${viewfinderBox.y * 100}%`,
                    width: `${viewfinderBox.width * 100}%`,
                    height: `${viewfinderBox.height * 100}%`,
                  }}
                >
                  <div className="absolute left-0 top-0 h-8 w-8 rounded-tl-xl border-l-4 border-t-4 border-primary-500" />
                  <div className="absolute right-0 top-0 h-8 w-8 rounded-tr-xl border-r-4 border-t-4 border-primary-500" />
                  <div className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-xl border-b-4 border-l-4 border-primary-500" />
                  <div className="absolute bottom-0 right-0 h-8 w-8 rounded-br-xl border-b-4 border-r-4 border-primary-500" />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-4 flex flex-col items-center gap-3 pb-6">
        <button
          onClick={handleScan}
          className={`flex h-20 w-20 items-center justify-center rounded-full border-4 border-slate-800 ring-4 ring-primary-500/50 transition-all active:scale-95 ${
            isScanning ? 'bg-orange-500' : 'bg-primary-600'
          }`}
        >
          <Camera size={32} className="text-white" />
        </button>
        {debugEnabled && (
          <input 
            type="file" 
            id="debug-upload" 
            accept="image/*" 
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setIsScanning(true);
              setScanStatus('Loading target image...');
              const reader = new FileReader();
              reader.onload = async (ev) => {
                const src = ev.target?.result as string;
                setScanStatus('Pipeline: quality -> barcode -> ROI OCR...');
                try {
                  const recognition = await runRecognitionPipeline(src, products, { persistDiagnostics: false });
                  navigate('/scan/result', { state: { type: opType, recognition } });
                } catch {
                  setScanStatus('Error: Recognition failed');
                  setIsScanning(false);
                }
              };
              reader.readAsDataURL(file);
            }}
            className="mt-2 text-xs text-slate-500"
          />
        )}
        {debugEnabled && aggregation && (
          <div className="w-full rounded-2xl border border-slate-700 bg-slate-900/70 p-3 text-xs text-muted">
            <div>frames: {aggregation.framesSeen}</div>
            <div>accepted: {aggregation.acceptedFrames}</div>
            <div>candidate stability: {(aggregation.candidateStability * 100).toFixed(0)}%</div>
            <div>barcode stability: {(aggregation.barcodeStability * 100).toFixed(0)}%</div>
            <div>score: {(aggregation.finalScore * 100).toFixed(0)}%</div>
          </div>
        )}
        {feedback.length > 0 && (
          <div className="w-full space-y-2">
            {feedback.map((item) => (
              <div
                key={item.reason}
                className={`rounded-2xl border px-3 py-2 text-sm ${
                  item.severity === 'warning'
                    ? 'border-orange-500/40 bg-orange-500/10 text-orange-200'
                    : 'border-slate-600 bg-slate-900/70 text-slate-200'
                }`}
              >
                {item.message}
              </div>
            ))}
          </div>
        )}
        {debugEnabled && cameraProfile && (
          <div className="w-full rounded-2xl border border-slate-700 bg-slate-900/70 p-3 text-xs text-muted">
            <div>camera: {cameraProfile.label}</div>
            <div>mode: {cameraProfile.facingMode} | {cameraProfile.resolution}{cameraProfile.frameRate ? ` @ ${cameraProfile.frameRate.toFixed(0)}fps` : ''}</div>
            <div>tuning: {livePreviewTuning.profileName} | stable {livePreviewTuning.requiredStableFrames} frames | burst {livePreviewTuning.burstFrames} x {livePreviewTuning.burstIntervalMs}ms | capture padding {Math.round(livePreviewTuning.capturePadding * 100)}%</div>
            <div>
              controls: focus {cameraProfile.supportsContinuousFocus ? 'continuous' : 'fixed/unknown'} | zoom{' '}
              {cameraProfile.supportsZoom ? cameraProfile.zoomRange : 'n/a'} | torch {cameraProfile.supportsTorch ? 'yes' : 'no'}
            </div>
          </div>
        )}
        {availableVideoDevices.length > 1 && (
          <div className="w-full rounded-2xl border border-slate-700 bg-slate-900/70 p-3">
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-muted">
              Активная камера
            </label>
            <select
              value={selectedDeviceId}
              onChange={(event) => setSelectedDeviceId(event.target.value)}
              className="w-full rounded-lg border border-slate-700/50 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-primary-500"
            >
              {availableVideoDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera ${device.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
          </div>
        )}
        {debugEnabled && previewMetrics && (
          <div className="w-full rounded-2xl border border-slate-700 bg-slate-900/70 p-3 text-xs text-muted">
            <div>
              preview: ready {previewMetrics.ready ? 'yes' : 'no'} | reasons {previewMetrics.reasons.join(', ') || 'pass'}
            </div>
            <div>
              sharp {previewMetrics.sharpness.toFixed(1)} | motion {previewMetrics.motion.toFixed(3)} | center {(previewMetrics.centeredness * 100).toFixed(0)}%
            </div>
            <div>
              coverage {(previewMetrics.coverage * 100).toFixed(0)}% | content w {(previewMetrics.contentWidthRatio * 100).toFixed(0)}% | content h {(previewMetrics.contentHeightRatio * 100).toFixed(0)}%
            </div>
            <div>
              brightness {previewMetrics.brightness.toFixed(0)} | contrast {previewMetrics.contrast.toFixed(0)} | aspect {previewMetrics.aspectRatio.toFixed(2)}
            </div>
            {previewMetrics.objectBox && (
              <div>
                object box x {(previewMetrics.objectBox.x * 100).toFixed(0)}% | y {(previewMetrics.objectBox.y * 100).toFixed(0)}% | w {(previewMetrics.objectBox.width * 100).toFixed(0)}% | h {(previewMetrics.objectBox.height * 100).toFixed(0)}%
              </div>
            )}
          </div>
        )}
        {scanStatus && <p className="text-center text-sm font-medium text-primary-400">{scanStatus}</p>}
      </div>
    </div>
  );
};

const ScanResult = () => {
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const locationState = routerLocation.state as ScanRouteState | null;
  const { locations, inventory, recordOperation, updateProduct, addProduct } = useStore();

  useEffect(() => {
    if (!locationState?.recognition) {
      navigate('/scan');
    }
  }, [locationState, navigate]);

  const hasRecognition = Boolean(locationState?.recognition);
  const type = locationState?.type || 'incoming';
  const recognition = locationState?.recognition || emptyRecognition;
  const recognizedProduct = recognition.product;
  const barcodeLocked = Boolean(recognition.aggregation && recognition.aggregation.barcodeStability >= 0.95);
  const barcodePresent = Boolean(recognition.barcode?.rawValue);
  const isNewBarcodeCapture = barcodePresent && !recognizedProduct;
  const resultFeedback = deriveCameraFeedback(recognition, recognition.aggregation || null);
  const displayQualityReasons =
    barcodeLocked && recognition.quality.reasons.includes('blurry')
      ? recognition.quality.reasons.filter((reason) => reason !== 'blurry')
      : recognition.quality.reasons;
  const displayFeedback = barcodeLocked
    ? resultFeedback.filter((item) => item.reason !== 'blurry')
    : resultFeedback;
  const titleRoi = recognition.roiResults.find((roi) => roi.id === 'title') || recognition.roiResults[0];
  const suggestedOcrTitle =
    titleRoi &&
    isLikelyUsefulOcrTitle(titleRoi.text, titleRoi.confidence, {
      barcodeLocked,
      barcodePresent,
    })
      ? normalizeOcrTitle(titleRoi.text)
      : '';
  const fallbackName =
    recognizedProduct?.name ||
    suggestedOcrTitle ||
    (barcodePresent ? buildBarcodePlaceholderName(recognition.barcode!.rawValue) : '');
  const displayRoiResults = recognition.roiResults.filter((roi) =>
    isLikelyUsefulOcrSnippet(roi.text, roi.confidence, {
      barcodeLocked,
      barcodePresent,
    }),
  );
  const hiddenRoiCount = recognition.roiResults.length - displayRoiResults.length;
  const fallbackProduct: Product = {
    id: `prod_${Date.now()}`,
    name: fallbackName,
    description: '',
    photoUrl: '',
    labelSignature: recognition.learnedVisualHash,
    barcode: recognition.barcode?.rawValue,
    barcodes: recognition.barcode?.rawValue ? [recognition.barcode.rawValue] : [],
    metadata: {
      roiTitle: suggestedOcrTitle,
      roiVariant: recognition.roiResults.find((roi) => roi.id === 'variant')?.text || '',
    },
  };

  const [quantity, setQuantity] = useState(1);
  const product = recognizedProduct || fallbackProduct;
  const [manualMode, setManualMode] = useState(false);
  const [editName, setEditName] = useState(fallbackName);
  const [editDesc, setEditDesc] = useState(product.description);
  const [barcode, setBarcode] = useState(product.barcode || recognition.barcode?.rawValue || '');
  const [rack, setRack] = useState('');
  const [sector, setSector] = useState('');
  const [floor, setFloor] = useState('');
  const [pos, setPos] = useState('');
  const totalBalance = inventory.filter((item) => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0);
  const isOutOfStock = type === 'outgoing' && totalBalance === 0;

  useEffect(() => {
    let targetLocId = '';
    const productInventory = inventory.filter((item) => item.productId === product.id && item.quantity > 0);

    if (type === 'outgoing') {
      targetLocId = productInventory[0]?.locationId || '';
    } else if (productInventory.length > 0) {
      targetLocId = productInventory[0].locationId;
    } else {
      const freeLocation = locations.find((entry) => !inventory.some((item) => item.locationId === entry.id && item.quantity > 0));
      targetLocId = freeLocation?.id || '';
    }

    const targetLocation = locations.find((entry) => entry.id === targetLocId);
    if (targetLocation) {
      setRack(targetLocation.rack);
      setSector(targetLocation.sector);
      setFloor(targetLocation.floor);
      setPos(targetLocation.position);
    }
  }, [inventory, locations, product.id, type]);

  const selectedLocation = locations.find(
    (entry) => entry.rack === rack && entry.sector === sector && entry.floor === floor && entry.position === pos,
  );
  const selectedLocId = selectedLocation?.id || '';
  const selectedLocCode = selectedLocation?.code || '';
  const canConfirm = editName.trim().length > 0 && selectedLocId && quantity > 0;

  const handleConfirm = () => {
    if (!canConfirm) return;

    const normalizedBarcode = barcode.trim();
    const updatedProduct: Product = recognizedProduct
      ? {
          ...recognizedProduct,
          name: editName,
          description: editDesc,
          barcode: normalizedBarcode,
          barcodes: Array.from(new Set([...(recognizedProduct.barcodes || []), normalizedBarcode].filter(Boolean))),
          photoUrl: recognition.normalizedImage,
          labelSignature: recognition.learnedVisualHash,
          metadata: {
            ...recognizedProduct.metadata,
            roiTitle: suggestedOcrTitle,
            roiVariant: recognition.roiResults.find((roi) => roi.id === 'variant')?.text || '',
          },
        }
      : {
          ...fallbackProduct,
          name: editName,
          description: editDesc,
          barcode: normalizedBarcode,
          barcodes: normalizedBarcode ? [normalizedBarcode] : [],
          photoUrl: recognition.normalizedImage,
        };

    updatedProduct.recognitionProfile = buildProductRecognitionProfile({
      product: updatedProduct,
      learnedVisualHash: recognition.learnedVisualHash,
      barcode: normalizedBarcode,
      roiResults: recognition.roiResults,
    });

    if (recognizedProduct) {
      updateProduct(recognizedProduct.id, updatedProduct);
    } else {
      addProduct(updatedProduct);
    }

    recordOperation({
      id: `op_${Date.now()}`,
      type,
      productId: updatedProduct.id,
      locationId: selectedLocId,
      quantity,
      confidenceScore: recognition.confidence,
      isUserConfirmed: true,
      timestamp: new Date().toISOString(),
    });

    navigate('/history');
  };

  const allRacks = Array.from(new Set(locations.map((entry) => entry.rack))).sort(numSort);
  const sectorsForRack = Array.from(new Set(locations.filter((entry) => entry.rack === rack).map((entry) => entry.sector))).sort(numSort);
  const floorsForSector = Array.from(
    new Set(locations.filter((entry) => entry.rack === rack && entry.sector === sector).map((entry) => entry.floor)),
  ).sort(numSort);
  const positionsForFloor = locations
    .filter((entry) => entry.rack === rack && entry.sector === sector && entry.floor === floor)
    .sort((left, right) => numSort(left.position, right.position));

  if (!hasRecognition) {
    return null;
  }

  return (
    <div className="space-y-6 pb-20">
      <header className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Подтверждение</h2>
        <button
          onClick={() => navigate('/scan/camera', { state: { type } })}
          className="flex items-center text-sm font-semibold text-primary-500"
        >
          <ScanLine size={16} className="mr-1" /> Пересканировать
        </button>
      </header>

      <div
        className={`rounded-xl border p-4 ${
          recognition.rescanRecommended
            ? 'border-orange-500/40 bg-orange-500/10'
            : recognition.requiresConfirmation
              ? 'border-primary-500/40 bg-primary-500/10'
              : 'border-primary-500 bg-primary-500/20'
        }`}
      >
        <div className="flex items-start gap-3">
          {recognition.rescanRecommended ? (
            <AlertTriangle className="mt-0.5 text-orange-400" />
          ) : recognition.requiresConfirmation ? (
            <RotateCcw className="mt-0.5 text-primary-400" />
          ) : (
            <CheckCircle2 className="mt-0.5 text-primary-500" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-bold">
              {recognition.rescanRecommended
                ? 'Нужен перескан'
                : recognition.requiresConfirmation
                  ? 'Нужна ручная проверка'
                  : 'Товар уверенно распознан'}
            </p>
            {isNewBarcodeCapture && (
              <p className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-200">
                Штрихкод считан уверенно. В каталоге совпадение не найдено, будет создан новый товар.
              </p>
            )}
            <p className="mt-1 text-xs text-muted">
              conf: {(recognition.confidence * 100).toFixed(0)}% | barcode:{' '}
              {recognition.barcode?.rawValue || 'n/a'} | q:{' '}
              {displayQualityReasons.join(',') || 'pass'}<br/>
              shrp: {recognition.quality.sharpness.toFixed(1)} | res: {recognition.quality.resolutionScore.toFixed(2)} | br: {recognition.quality.brightness.toFixed(0)}
            </p>
            {recognition.aggregation && (
              <p className="mt-1 text-xs text-muted">
                frames: {recognition.aggregation.acceptedFrames}/{recognition.aggregation.framesSeen} | candidate:{' '}
                {(recognition.aggregation.candidateStability * 100).toFixed(0)}% | barcode:{' '}
                {(recognition.aggregation.barcodeStability * 100).toFixed(0)}% | margin:{' '}
                {(recognition.aggregation.barcodeConsensusMargin * 100).toFixed(0)}% | checksum:{' '}
                {recognition.aggregation.barcodeChecksumValid ? 'ok' : 'fail'} | ocr:{' '}
                {(recognition.aggregation.ocrStability * 100).toFixed(0)}%
              </p>
            )}
            {displayFeedback.length > 0 && (
              <p className="mt-2 text-xs text-muted">
                feedback: {displayFeedback.map((item) => item.message).join(' | ')}
              </p>
            )}
            {recognition.candidates.length > 0 && (
              <p className="mt-2 text-xs text-muted">
                top candidates:{' '}
                {recognition.candidates
                  .slice(0, 3)
                  .map((candidate) => `${candidate.product.name} (${candidate.total.toFixed(2)})`)
                  .join(', ')}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-4 flex gap-4">
          <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg border border-slate-700 bg-slate-800 shadow-inner">
            <img src={recognition.normalizedImage} alt="Normalized label" className="h-full w-full object-cover" />
          </div>
          <div className="flex-1 space-y-4">
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-primary-400">Название товара *</label>
              <input
                placeholder="Напр: Oreo Original 228g"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                className="w-full rounded-lg border border-slate-700/50 bg-slate-900/50 px-3 py-2 text-base font-bold outline-none transition-all placeholder:text-slate-600 focus:border-primary-500 focus:bg-slate-900"
              />
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-muted">Штрих-код / Артикул</label>
                <input
                  placeholder="000000000000"
                  value={barcode}
                  onChange={(event) => setBarcode(event.target.value)}
                  className="w-full rounded-lg border border-slate-700/50 bg-slate-900/50 px-3 py-2 text-sm font-mono outline-none transition-all placeholder:text-slate-600 focus:border-primary-500 focus:bg-slate-900"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-muted">Описание</label>
                <textarea
                  placeholder="Дополнительная информация..."
                  value={editDesc}
                  onChange={(event) => setEditDesc(event.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-slate-700/50 bg-slate-900/50 px-3 py-2 text-xs text-muted outline-none transition-all placeholder:text-slate-600 focus:border-primary-500 focus:bg-slate-900"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-4 border-t border-slate-700/50 pt-4">
          <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-700/40 bg-slate-900/40 p-3 text-xs text-muted">
            {displayRoiResults.length > 0 ? (
              displayRoiResults.map((roi) => (
                <div key={roi.id} className="flex items-center justify-between gap-2">
                  <span>{roi.id}</span>
                  <span className="font-mono text-[11px] text-slate-300">{normalizeOcrTitle(roi.text) || '-'}</span>
                </div>
              ))
            ) : (
              <div className="text-slate-400">
                {barcodePresent
                  ? 'OCR-данные скрыты: barcode уже считан, текст пока слишком шумный'
                  : 'OCR-данные пока слишком шумные'}
              </div>
            )}
            {hiddenRoiCount > 0 && (
              <div className="border-t border-slate-700/40 pt-2 text-[11px] text-slate-500">
                скрыто OCR-полей: {hiddenRoiCount}
              </div>
            )}
          </div>

          {isOutOfStock ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center">
              <p className="font-bold text-red-500">Данного товара нет на складе</p>
            </div>
          ) : (
            <>
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted">
                  Количество ({type === 'incoming' ? 'Принять' : 'Выдать'})
                </label>
                <div className="flex items-center">
                  <button
                    className="flex h-12 w-12 items-center justify-center rounded-l-xl bg-slate-700 text-xl font-bold transition hover:bg-slate-600"
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  >
                    -
                  </button>
                  <input
                    type="number"
                    className="h-12 w-full bg-slate-800 text-center text-xl font-bold focus:outline-none"
                    value={quantity}
                    onChange={(event) => setQuantity(Math.max(1, parseInt(event.target.value, 10) || 1))}
                  />
                  <button
                    className="flex h-12 w-12 items-center justify-center rounded-r-xl bg-slate-700 text-xl font-bold transition hover:bg-slate-600"
                    onClick={() => setQuantity(quantity + 1)}
                  >
                    +
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted">Локация</label>
                  <button className="text-xs font-medium text-primary-400 transition hover:text-primary-300" onClick={() => setManualMode((value) => !value)}>
                    {manualMode ? '← Авто-подбор' : '✎ Выбрать вручную'}
                  </button>
                </div>

                {!manualMode ? (
                  <div className="flex min-h-[52px] items-center justify-between rounded-xl border border-slate-600 bg-slate-800 p-3">
                    {selectedLocCode ? (
                      <>
                        <span className="font-mono text-lg font-bold text-primary-400">{selectedLocCode}</span>
                        <span className="rounded-full bg-primary-500/20 px-2 py-0.5 text-xs text-primary-400">
                          {totalBalance > 0 ? (type === 'incoming' ? 'Текущий склад' : 'Забрать отсюда') : 'Свободная ячейка'}
                        </span>
                      </>
                    ) : (
                      <span className="text-sm italic text-muted">Нет свободных ячеек</span>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      className="input-field appearance-none px-3 py-2 text-sm"
                      value={rack}
                      onChange={(event) => {
                        setRack(event.target.value);
                        setSector('');
                        setFloor('');
                        setPos('');
                      }}
                    >
                      <option value="" disabled>
                        Регал (R)
                      </option>
                      {allRacks.map((entry) => (
                        <option key={entry} value={entry}>
                          {entry}
                        </option>
                      ))}
                    </select>

                    <select
                      className="input-field appearance-none px-3 py-2 text-sm"
                      value={sector}
                      onChange={(event) => {
                        setSector(event.target.value);
                        setFloor('');
                        setPos('');
                      }}
                      disabled={!rack}
                    >
                      <option value="" disabled>
                        Секция (S)
                      </option>
                      {sectorsForRack.map((entry) => (
                        <option key={entry} value={entry}>
                          {entry}
                        </option>
                      ))}
                    </select>

                    <select
                      className="input-field appearance-none px-3 py-2 text-sm"
                      value={floor}
                      onChange={(event) => {
                        setFloor(event.target.value);
                        setPos('');
                      }}
                      disabled={!sector}
                    >
                      <option value="" disabled>
                        Этаж (F)
                      </option>
                      {floorsForSector.map((entry) => (
                        <option key={entry} value={entry}>
                          {entry}
                        </option>
                      ))}
                    </select>

                    <select
                      className="input-field appearance-none px-3 py-2 text-sm"
                      value={pos}
                      onChange={(event) => setPos(event.target.value)}
                      disabled={!floor}
                    >
                      <option value="" disabled>
                        Место (P)
                      </option>
                      {positionsForFloor.map((entry) => {
                        const locationInventory = inventory.filter((item) => item.locationId === entry.id && item.quantity > 0);
                        const isCurrent = locationInventory.some((item) => item.productId === product.id);
                        const isOther = locationInventory.some((item) => item.productId !== product.id);
                        const isDisabled = type === 'incoming' && isOther;
                        return (
                          <option key={entry.id} value={entry.position} disabled={isDisabled}>
                            {entry.position}
                            {isCurrent ? ' ✓' : isOther ? ' ✗' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}

                {type === 'outgoing' && <div className="mt-2 text-xs text-muted">Текущий баланс: {totalBalance} шт.</div>}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-[60] safe-bottom border-t border-slate-800 bg-slate-900/80 p-4 backdrop-blur-lg">
        <button
          onClick={handleConfirm}
          disabled={isOutOfStock || !canConfirm}
          className={`flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-lg font-bold transition-all active:scale-95 ${
            canConfirm && !isOutOfStock
              ? `${type === 'incoming' ? 'bg-gradient-to-r from-primary-600 to-primary-500' : 'bg-gradient-to-r from-red-600 to-red-500'} text-white`
              : 'cursor-not-allowed bg-slate-800 text-slate-500 opacity-50'
          }`}
        >
          {type === 'incoming' ? <ArrowRight size={24} /> : <ArrowRight className="rotate-180" size={24} />}
          Подтвердить {type === 'incoming' ? 'Приёмку' : 'Выдачу'}
        </button>
      </div>
    </div>
  );
};
