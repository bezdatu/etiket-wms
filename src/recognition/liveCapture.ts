import { recognitionConfig } from '../config/recognition';

export type PreviewMetrics = {
  brightness: number;
  contrast: number;
  sharpness: number;
  motion: number;
  coverage: number;
  centeredness: number;
  aspectRatio: number;
  contentWidthRatio: number;
  contentHeightRatio: number;
  objectBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  ready: boolean;
  reasons: string[];
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const createGrayscale = (data: Uint8ClampedArray) => {
  const grayscale = new Uint8Array(data.length / 4);
  for (let i = 0; i < data.length; i += 4) {
    grayscale[i / 4] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
  }
  return grayscale;
};

type ConnectedComponent = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  active: number;
  activeRatio: number;
  score: number;
};

const findBestComponent = (
  mask: Uint8Array,
  width: number,
  height: number,
  minPixels: number,
  scoring: (component: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    active: number;
    density: number;
    centerDistance: number;
    edgeTouches: boolean;
  }) => number,
) => {
  const visited = new Uint8Array(width * height);
  let totalActive = 0;
  let best: ConnectedComponent | null = null;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const seedIndex = y * width + x;
      if (!mask[seedIndex] || visited[seedIndex]) continue;

      const queue = [seedIndex];
      visited[seedIndex] = 1;
      let cursor = 0;
      let active = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;

      while (cursor < queue.length) {
        const current = queue[cursor++];
        const cx = current % width;
        const cy = Math.floor(current / width);

        active += 1;
        sumX += cx;
        sumY += cy;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        const neighbors = [current - 1, current + 1, current - width, current + width];
        for (const next of neighbors) {
          if (next < 0 || next >= mask.length || !mask[next] || visited[next]) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }

      totalActive += active;
      if (active < minPixels) continue;

      const boxWidth = maxX - minX + 1;
      const boxHeight = maxY - minY + 1;
      const boxArea = boxWidth * boxHeight;
      const density = active / Math.max(boxArea, 1);
      const centerX = sumX / Math.max(active, 1);
      const centerY = sumY / Math.max(active, 1);
      const centerDistance =
        Math.sqrt((centerX - width / 2) ** 2 + (centerY - height / 2) ** 2) / Math.max(width, height);
      const edgeTouches = minX <= 2 || minY <= 2 || maxX >= width - 3 || maxY >= height - 3;
      const score = scoring({
        minX,
        maxX,
        minY,
        maxY,
        active,
        density,
        centerDistance,
        edgeTouches,
      });

      if (!best || score > best.score) {
        best = {
          minX,
          maxX,
          minY,
          maxY,
          active,
          activeRatio: active / Math.max(width * height, 1),
          score,
        };
      }
    }
  }

  return totalActive > 0 ? best : null;
};

const getComponentBoxMetrics = (component: ConnectedComponent | null, width: number, height: number) => {
  if (!component) return null;
  const boxWidth = component.maxX - component.minX + 1;
  const boxHeight = component.maxY - component.minY + 1;
  const areaRatio = (boxWidth * boxHeight) / Math.max(width * height, 1);
  const edgeTouches =
    Number(component.minX <= 2) +
    Number(component.minY <= 2) +
    Number(component.maxX >= width - 3) +
    Number(component.maxY >= height - 3);

  return {
    boxWidth,
    boxHeight,
    areaRatio,
    edgeTouches,
  };
};

const dilateMask = (mask: Uint8Array, width: number, height: number, radius: number) => {
  const dilated = new Uint8Array(mask.length);
  for (let y = radius; y < height - radius; y += 1) {
    for (let x = radius; x < width - radius; x += 1) {
      let active = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (mask[(y + dy) * width + (x + dx)]) {
            active += 1;
          }
        }
      }
      if (active >= Math.max(2, radius * 2 + 1)) {
        dilated[y * width + x] = 1;
      }
    }
  }
  return dilated;
};

const estimateContentBounds = (
  grayscale: Uint8Array,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
) => {
  const centerBrightness = grayscale.reduce((sum, value) => sum + value, 0) / Math.max(grayscale.length, 1);
  let contrastAcc = 0;
  grayscale.forEach((value) => {
    contrastAcc += (value - centerBrightness) ** 2;
  });
  const contrast = Math.sqrt(contrastAcc / Math.max(grayscale.length, 1));
  const threshold = Math.max(10, Math.min(42, centerBrightness * 0.14));
  const edgeMask = new Uint8Array(width * height);
  const brightMask = new Uint8Array(width * height);
  const neutralBrightMask = new Uint8Array(width * height);
  const brightThreshold = Math.max(140, Math.min(225, centerBrightness + Math.max(14, contrast * 0.42)));

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const rgbaIndex = index * 4;
      const gradient =
        Math.abs(grayscale[index] - grayscale[index + 1]) +
        Math.abs(grayscale[index] - grayscale[index + width]);
      if (gradient >= threshold) {
        edgeMask[index] = 1;
      }
      if (grayscale[index] >= brightThreshold) {
        brightMask[index] = 1;
      }
      const red = rgba[rgbaIndex];
      const green = rgba[rgbaIndex + 1];
      const blue = rgba[rgbaIndex + 2];
      const maxChannel = Math.max(red, green, blue);
      const minChannel = Math.min(red, green, blue);
      const chroma = maxChannel - minChannel;
      if (grayscale[index] >= brightThreshold - 20 && chroma <= 28) {
        neutralBrightMask[index] = 1;
      }
    }
  }

  const connectedNeutralBrightMask = dilateMask(neutralBrightMask, width, height, 2);
  const connectedBrightMask = dilateMask(brightMask, width, height, 2);

  const minPixels = Math.max(40, Math.round(width * height * 0.003));
  const neutralBrightBest = findBestComponent(
    connectedNeutralBrightMask,
    width,
    height,
    Math.max(Math.round(width * height * 0.002), 24),
    ({ minX, maxX, minY, maxY, active, density, centerDistance, edgeTouches }) => {
      const boxWidth = maxX - minX + 1;
      const boxHeight = maxY - minY + 1;
      const aspect = boxWidth / Math.max(boxHeight, 1);
      const aspectPenalty = Math.abs(1 - Math.min(1.6, Math.max(0.65, aspect)));
      const edgePenalty = edgeTouches ? 0.45 : 1;
      return active * density * (1 - centerDistance * 0.8) * (1 - aspectPenalty * 0.5) * edgePenalty;
    },
  );
  const brightBest = findBestComponent(connectedBrightMask, width, height, Math.max(minPixels, Math.round(width * height * 0.008)), ({
    minX,
    maxX,
    minY,
    maxY,
    active,
    density,
    centerDistance,
    edgeTouches,
  }) => {
    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const aspect = boxWidth / Math.max(boxHeight, 1);
    const aspectPenalty = Math.abs(1 - Math.min(1.8, Math.max(0.55, aspect)));
    const edgePenalty = edgeTouches ? 0.6 : 1;
    return active * density * (1 - centerDistance * 0.9) * (1 - aspectPenalty * 0.45) * edgePenalty;
  });
  const edgeBest = findBestComponent(edgeMask, width, height, minPixels, ({
    active,
    density,
    centerDistance,
    edgeTouches,
  }) => active * density * (1 - centerDistance * 1.1) * (edgeTouches ? 0.72 : 1));
  const neutralMetrics = getComponentBoxMetrics(neutralBrightBest, width, height);
  const brightMetrics = getComponentBoxMetrics(brightBest, width, height);
  const edgeMetrics = getComponentBoxMetrics(edgeBest, width, height);

  const neutralCandidate =
    neutralBrightBest &&
    neutralMetrics &&
    neutralMetrics.areaRatio >= 0.04 &&
    neutralMetrics.areaRatio <= 0.58 &&
    neutralMetrics.edgeTouches <= 1
      ? neutralBrightBest
      : null;
  const edgeCandidate =
    edgeBest &&
    edgeMetrics &&
    edgeMetrics.areaRatio >= 0.01 &&
    edgeMetrics.areaRatio <= 0.38 &&
    edgeMetrics.edgeTouches <= 1
      ? edgeBest
      : null;
  const brightCandidate =
    brightBest &&
    brightMetrics &&
    brightMetrics.areaRatio >= 0.03 &&
    brightMetrics.areaRatio <= 0.6 &&
    brightMetrics.edgeTouches <= 1
      ? brightBest
      : null;

  const best = neutralCandidate || edgeCandidate || brightCandidate || neutralBrightBest || brightBest || edgeBest;

  if (!best || best.minX >= best.maxX || best.minY >= best.maxY) {
    return null;
  }

  let minX = best.minX;
  let maxX = best.maxX;
  let minY = best.minY;
  let maxY = best.maxY;
  let boxWidth = maxX - minX + 1;
  let boxHeight = maxY - minY + 1;

  const maxDimension = Math.max(boxWidth, boxHeight);
  const padX = Math.max(10, Math.round(Math.max(boxWidth * 0.16, maxDimension * 0.08)));
  const padY = Math.max(10, Math.round(Math.max(boxHeight * 0.26, maxDimension * 0.12)));
  minX = Math.max(0, minX - padX);
  maxX = Math.min(width - 1, maxX + padX);
  minY = Math.max(0, minY - padY);
  maxY = Math.min(height - 1, maxY + padY);

  boxWidth = maxX - minX + 1;
  boxHeight = maxY - minY + 1;
  const aspectRatio = boxWidth / Math.max(boxHeight, 1);

  if (aspectRatio > 1.6) {
    const targetHeight = Math.min(height, Math.round(boxWidth / 1.15));
    const currentCenterY = (minY + maxY) / 2;
    minY = Math.max(0, Math.round(currentCenterY - targetHeight / 2));
    maxY = Math.min(height - 1, minY + targetHeight - 1);
    if (maxY === height - 1) {
      minY = Math.max(0, maxY - targetHeight + 1);
    }
  }

  if (aspectRatio < 0.55) {
    const targetWidth = Math.min(width, Math.round(boxHeight * 0.95));
    const currentCenterX = (minX + maxX) / 2;
    minX = Math.max(0, Math.round(currentCenterX - targetWidth / 2));
    maxX = Math.min(width - 1, minX + targetWidth - 1);
    if (maxX === width - 1) {
      minX = Math.max(0, maxX - targetWidth + 1);
    }
  }

  boxWidth = maxX - minX + 1;
  boxHeight = maxY - minY + 1;
  const dominantDimension = Math.max(boxWidth, boxHeight);
  const framingScale = aspectRatio > 1.45 || aspectRatio < 0.7 ? 1.24 : 1.48;
  const targetWidth = Math.min(width, Math.round(Math.max(boxWidth, dominantDimension * framingScale)));
  const targetHeight = Math.min(height, Math.round(Math.max(boxHeight, dominantDimension * framingScale)));
  const rawCenterX = (minX + maxX) / 2;
  const rawCenterY = (minY + maxY) / 2;
  const frameCenterX = width / 2;
  const frameCenterY = height / 2;
  const centerDistance =
    Math.sqrt((rawCenterX - frameCenterX) ** 2 + (rawCenterY - frameCenterY) ** 2) / Math.max(width, height, 1);
  const centerBias = clamp01(1 - centerDistance * 2.2) * 0.38;
  const centerX = rawCenterX * (1 - centerBias) + frameCenterX * centerBias;
  const centerY = rawCenterY * (1 - centerBias) + frameCenterY * centerBias;

  minX = Math.max(0, Math.round(centerX - targetWidth / 2));
  maxX = Math.min(width - 1, minX + targetWidth - 1);
  if (maxX === width - 1) {
    minX = Math.max(0, maxX - targetWidth + 1);
  }

  minY = Math.max(0, Math.round(centerY - targetHeight / 2));
  maxY = Math.min(height - 1, minY + targetHeight - 1);
  if (maxY === height - 1) {
    minY = Math.max(0, maxY - targetHeight + 1);
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    activeRatio: best.activeRatio,
  };
};

export const analyzePreviewFrame = (
  video: HTMLVideoElement,
  _roi: { x: number; y: number; width: number; height: number },
  previousFrame: Uint8Array | null,
  tuning?: Partial<{
    minBrightness: number;
    maxBrightness: number;
    minContrast: number;
    minSharpness: number;
    maxMotion: number;
    minCoverage: number;
    maxCoverage: number;
    minCenteredness: number;
    minAspectRatio: number;
  }>,
): { metrics: PreviewMetrics; grayscale: Uint8Array } | null => {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const cropWidth = sourceWidth;
  const cropHeight = sourceHeight;
  const cropX = 0;
  const cropY = 0;
  const canvas = createCanvas(cropWidth, cropHeight);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  const { data, width, height } = ctx.getImageData(0, 0, cropWidth, cropHeight);
  const grayscale = createGrayscale(data);

  let brightnessSum = 0;
  grayscale.forEach((value) => {
    brightnessSum += value;
  });
  const brightness = brightnessSum / Math.max(grayscale.length, 1);

  let contrastAcc = 0;
  grayscale.forEach((value) => {
    contrastAcc += (value - brightness) ** 2;
  });
  const contrast = Math.sqrt(contrastAcc / Math.max(grayscale.length, 1));

  let sharpnessAcc = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
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

  let motion = 1;
  if (previousFrame && previousFrame.length === grayscale.length) {
    let diff = 0;
    for (let index = 0; index < grayscale.length; index += 1) {
      diff += Math.abs(grayscale[index] - previousFrame[index]);
    }
    motion = diff / (grayscale.length * 255);
  }

  const bounds = estimateContentBounds(grayscale, data, width, height);
  const aspectRatio = bounds ? (bounds.maxX - bounds.minX + 1) / Math.max(bounds.maxY - bounds.minY + 1, 1) : 0;
  const contentWidthRatio = bounds ? (bounds.maxX - bounds.minX + 1) / Math.max(width, 1) : 0;
  const contentHeightRatio = bounds ? (bounds.maxY - bounds.minY + 1) / Math.max(height, 1) : 0;
  const objectBox = bounds
    ? {
        x: bounds.minX / Math.max(width, 1),
        y: bounds.minY / Math.max(height, 1),
        width: (bounds.maxX - bounds.minX + 1) / Math.max(width, 1),
        height: (bounds.maxY - bounds.minY + 1) / Math.max(height, 1),
      }
    : null;
  const coverage = clamp01(
    Math.max(
      bounds?.activeRatio ? bounds.activeRatio * 5.5 : 0,
      objectBox ? objectBox.width * objectBox.height * 0.95 : 0,
    ),
  );
  const centeredness = bounds
    ? clamp01(
        1 -
          Math.sqrt(
            ((bounds.minX + bounds.maxX) / 2 - width / 2) ** 2 +
              ((bounds.minY + bounds.maxY) / 2 - height / 2) ** 2,
          ) /
            Math.max(width, height),
      )
    : 0;

  const thresholds = {
    minBrightness: tuning?.minBrightness ?? recognitionConfig.livePreview.minBrightness,
    maxBrightness: tuning?.maxBrightness ?? recognitionConfig.livePreview.maxBrightness,
    minContrast: tuning?.minContrast ?? recognitionConfig.livePreview.minContrast,
    minSharpness: tuning?.minSharpness ?? recognitionConfig.livePreview.minSharpness,
    maxMotion: tuning?.maxMotion ?? recognitionConfig.livePreview.maxMotion,
    minCoverage: tuning?.minCoverage ?? recognitionConfig.livePreview.minCoverage,
    maxCoverage: tuning?.maxCoverage ?? recognitionConfig.livePreview.maxCoverage,
    minCenteredness: tuning?.minCenteredness ?? recognitionConfig.livePreview.minCenteredness,
    minAspectRatio: tuning?.minAspectRatio ?? recognitionConfig.livePreview.minAspectRatio,
  };

  const reasons: string[] = [];
  if (brightness < thresholds.minBrightness) reasons.push('too-dark');
  if (brightness > thresholds.maxBrightness) reasons.push('too-bright');
  if (contrast < thresholds.minContrast) reasons.push('low-contrast');
  if (sharpness < thresholds.minSharpness) reasons.push('blurry');
  if (motion > thresholds.maxMotion) reasons.push('motion');
  if (coverage < thresholds.minCoverage) reasons.push('too-far');
  if (coverage > thresholds.maxCoverage) reasons.push('too-close');
  if (centeredness < thresholds.minCenteredness) reasons.push('off-center');
  if (aspectRatio > 0 && aspectRatio < thresholds.minAspectRatio) reasons.push('tilted');

  return {
    metrics: {
      brightness,
      contrast,
      sharpness,
      motion,
      coverage,
      centeredness,
      aspectRatio,
      contentWidthRatio,
      contentHeightRatio,
      objectBox,
      ready: reasons.length === 0,
      reasons,
    },
    grayscale,
  };
};

export const getPreviewFeedback = (metrics: PreviewMetrics | null) => {
  if (!metrics) {
    return ['Ищу поток камеры'];
  }

  if (metrics.ready) {
    return ['Объект зафиксирован', 'Держите камеру неподвижно'];
  }

  const messages: string[] = [];
  if (metrics.reasons.includes('too-dark')) messages.push('Добавьте свет');
  if (metrics.reasons.includes('too-bright')) messages.push('Уберите пересвет и блики');
  if (metrics.reasons.includes('blurry')) messages.push('Нужно резче, не двигайте ноутбук');
  if (metrics.reasons.includes('motion')) messages.push('Зафиксируйте камеру и объект');
  if (metrics.reasons.includes('too-far')) messages.push('Поднесите этикетку ближе к камере');
  if (metrics.reasons.includes('too-close')) messages.push('Немного отведите этикетку назад');
  if (metrics.reasons.includes('off-center')) messages.push('Верните этикетку в центр рамки');
  if (metrics.reasons.includes('low-contrast')) messages.push('Сделайте фон спокойнее, уберите лишнее');
  if (metrics.reasons.includes('tilted')) messages.push('Выровняйте этикетку ровнее');

  return messages.slice(0, 3);
};

export const captureVideoFrame = (
  video: HTMLVideoElement,
  options?: {
    mimeType?: string;
    quality?: number;
    roi?: { x: number; y: number; width: number; height: number };
    padding?: number;
  },
) => {
  const width = video.videoWidth;
  const height = video.videoHeight;
  const padding = options?.padding ?? 0;
  const crop = options?.roi
    ? {
        x: Math.max(0, options.roi.x - padding),
        y: Math.max(0, options.roi.y - padding),
        width: Math.min(1, options.roi.width + padding * 2),
        height: Math.min(1, options.roi.height + padding * 2),
      }
    : { x: 0, y: 0, width: 1, height: 1 };
  const sx = Math.round(width * crop.x);
  const sy = Math.round(height * crop.y);
  const sw = Math.min(width - sx, Math.max(1, Math.round(width * crop.width)));
  const sh = Math.min(height - sy, Math.max(1, Math.round(height * crop.height)));
  const canvas = createCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL(options?.mimeType || 'image/jpeg', options?.quality ?? 0.95);
};
