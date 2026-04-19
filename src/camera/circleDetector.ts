export type CircleBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const clampBox = (box: CircleBox): CircleBox => {
  const width = Math.max(0.12, Math.min(1, box.width));
  const height = Math.max(0.12, Math.min(1, box.height));
  const x = Math.max(0, Math.min(1 - width, box.x));
  const y = Math.max(0, Math.min(1 - height, box.y));
  return { x, y, width, height };
};

const fitCircleToPoints = (points: Array<{ x: number; y: number }>) => {
  if (points.length < 3) return null;

  let sumX = 0;
  let sumY = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }

  const centerX = sumX / points.length;
  const centerY = sumY / points.length;

  let sumRadius = 0;
  for (const point of points) {
    sumRadius += Math.hypot(point.x - centerX, point.y - centerY);
  }

  const radius = sumRadius / points.length;
  if (!Number.isFinite(radius) || radius <= 0) return null;

  return { centerX, centerY, radius };
};

const sampleLocalAverage = (
  grayscale: Uint8Array,
  chroma: Uint8Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
) => {
  let graySum = 0;
  let chromaSum = 0;
  let samples = 0;

  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = Math.round(centerX + dx);
      const y = Math.round(centerY + dy);
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      const index = y * width + x;
      graySum += grayscale[index];
      chromaSum += chroma[index];
      samples += 1;
    }
  }

  return {
    gray: graySum / Math.max(samples, 1),
    chroma: chromaSum / Math.max(samples, 1),
  };
};

const refineCircleRadius = (
  grayscale: Uint8Array,
  chroma: Uint8Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  baseRadius: number,
  brightThreshold: number,
) => {
  const radii: number[] = [];
  const minRadius = Math.max(6, baseRadius * 0.62);
  const maxRadius = Math.min(Math.min(width, height) / 2, baseRadius * 1.9);
  const localRadius = Math.max(4, Math.round(baseRadius * 0.055));

  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 48) {
    let previousGray = 255;
    let previousChroma = 0;
    let bestRadius = minRadius;
    let bestEdgeScore = Number.NEGATIVE_INFINITY;

    for (let radius = minRadius; radius <= maxRadius; radius += 2) {
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      const local = sampleLocalAverage(grayscale, chroma, width, height, x, y, localRadius);
      const grayDrop = previousGray - local.gray;
      const chromaRise = local.chroma - previousChroma;
      const edgeScore =
        grayDrop * 1.25 +
        chromaRise * 0.45 +
        (previousGray >= brightThreshold - 12 ? 22 : 0) +
        (local.gray <= brightThreshold - 18 ? 14 : 0);

      if (edgeScore > bestEdgeScore) {
        bestEdgeScore = edgeScore;
        bestRadius = radius;
      }

      previousGray = local.gray;
      previousChroma = local.chroma;
    }

    radii.push(bestRadius);
  }

  if (radii.length < 8) return baseRadius;
  radii.sort((left, right) => left - right);
  return radii[Math.min(radii.length - 1, Math.floor(radii.length * 0.58))] || baseRadius;
};

export const smoothCircleBox = (previous: CircleBox | null, next: CircleBox, alpha: number) => {
  if (!previous) return clampBox(next);
  return clampBox({
    x: previous.x + (next.x - previous.x) * alpha,
    y: previous.y + (next.y - previous.y) * alpha,
    width: previous.width + (next.width - previous.width) * alpha,
    height: previous.height + (next.height - previous.height) * alpha,
  });
};

export const getFallbackBox = (): CircleBox => ({
  x: 0.18,
  y: 0.16,
  width: 0.64,
  height: 0.64,
});

export const detectCircleBox = (video: HTMLVideoElement): CircleBox | null => {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;

  const cellSize = Math.max(6, Math.round(Math.min(width, height) / 42));
  const gridWidth = Math.max(8, Math.floor(width / cellSize));
  const gridHeight = Math.max(8, Math.floor(height / cellSize));
  const mask = new Uint8Array(gridWidth * gridHeight);
  const seedMask = new Uint8Array(gridWidth * gridHeight);

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
      const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
      grayscale[index] = gray;
      chroma[index] = spread;
      brightnessSum += gray;
      chromaSum += spread;
    }
  }

  const meanBrightness = brightnessSum / Math.max(grayscale.length, 1);
  const meanChroma = chromaSum / Math.max(chroma.length, 1);
  const brightThreshold = Math.max(148, Math.min(238, meanBrightness + 14));
  const chromaThreshold = Math.max(22, Math.min(54, meanChroma + 6));
  const seedBrightThreshold = Math.min(245, brightThreshold + 16);
  const seedChromaThreshold = Math.max(14, chromaThreshold - 8);

  for (let gy = 0; gy < gridHeight; gy += 1) {
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const startX = gx * cellSize;
      const endX = Math.min(width, startX + cellSize);
      const startY = gy * cellSize;
      const endY = Math.min(height, startY + cellSize);
      let brightPixels = 0;
      let seedPixels = 0;
      let samples = 0;

      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const index = y * width + x;
          if (grayscale[index] >= brightThreshold && chroma[index] <= chromaThreshold) {
            brightPixels += 1;
          }
          if (grayscale[index] >= seedBrightThreshold && chroma[index] <= seedChromaThreshold) {
            seedPixels += 1;
          }
          samples += 1;
        }
      }

      if (brightPixels / Math.max(samples, 1) >= 0.22) {
        mask[gy * gridWidth + gx] = 1;
      }
      if (seedPixels / Math.max(samples, 1) >= 0.18) {
        seedMask[gy * gridWidth + gx] = 1;
      }
    }
  }

  const findSeedCircle = () => {
    const visited = new Uint8Array(seedMask.length);
    const frameCenterX = gridWidth / 2;
    const frameCenterY = gridHeight / 2;
    let bestSeed:
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
        if (!seedMask[seed] || visited[seed]) continue;

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
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);

          const neighbors = [index - 1, index + 1, index - gridWidth, index + gridWidth];
          for (const next of neighbors) {
            if (next < 0 || next >= seedMask.length || !seedMask[next] || visited[next]) continue;
            visited[next] = 1;
            queue.push(next);
          }
        }

        if (points.length < 8) continue;
        const boxWidth = maxX - minX + 1;
        const boxHeight = maxY - minY + 1;
        const aspect = Math.min(boxWidth, boxHeight) / Math.max(boxWidth, boxHeight, 1);
        if (aspect < 0.74) continue;

        const circle = fitCircleToPoints(points);
        if (!circle) continue;

        const area = boxWidth * boxHeight;
        const fillRatio = points.length / Math.max(area, 1);
        const centerDistance =
          Math.hypot(circle.centerX - frameCenterX, circle.centerY - frameCenterY) / Math.max(gridWidth, gridHeight, 1);
        const score =
          Math.max(0, 1 - Math.abs(fillRatio - 0.72) * 4.5) * 2.6 +
          Math.max(0, 1 - (1 - aspect) * 4.2) * 2.2 +
          Math.max(0, 1 - centerDistance * 1.8) * 1.8 +
          Math.min(points.length / 24, 1.6);

        if (!bestSeed || score > bestSeed.score) {
          bestSeed = {
            centerX: circle.centerX,
            centerY: circle.centerY,
            radius: Math.max(boxWidth, boxHeight) * 0.5,
            score,
          };
        }
      }
    }

    return bestSeed;
  };

  const seeded = findSeedCircle();
  if (seeded) {
    const centerX = (seeded.centerX + 0.5) * cellSize;
    const centerY = (seeded.centerY + 0.5) * cellSize;
    const radius = refineCircleRadius(
      grayscale,
      chroma,
      width,
      height,
      centerX,
      centerY,
      Math.max(seeded.radius * cellSize * 1.28, 32),
      brightThreshold,
    );
    const size = radius * 2.22;
    const padding = size * 0.025;

    return clampBox({
      x: clamp01((centerX - size / 2 - padding) / width),
      y: clamp01((centerY - size / 2 - padding) / height),
      width: Math.min(1, (size + padding * 2) / width),
      height: Math.min(1, (size + padding * 2) / height),
    });
  }

  const visited = new Uint8Array(mask.length);
  const frameCenterX = gridWidth / 2;
  const frameCenterY = gridHeight / 2;
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
      if (!mask[seed] || visited[seed]) continue;

      const queue = [seed];
      visited[seed] = 1;
      let cursor = 0;
      const points: Array<{ x: number; y: number }> = [];
      const boundaryPoints: Array<{ x: number; y: number }> = [];
      let minX = gx;
      let maxX = gx;
      let minY = gy;
      let maxY = gy;

      while (cursor < queue.length) {
        const index = queue[cursor++];
        const x = index % gridWidth;
        const y = Math.floor(index / gridWidth);
        points.push({ x, y });

        const left = x > 0 ? mask[index - 1] : 0;
        const right = x < gridWidth - 1 ? mask[index + 1] : 0;
        const up = y > 0 ? mask[index - gridWidth] : 0;
        const down = y < gridHeight - 1 ? mask[index + gridWidth] : 0;
        if (!left || !right || !up || !down) {
          boundaryPoints.push({ x, y });
        }

        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);

        const neighbors = [index - 1, index + 1, index - gridWidth, index + gridWidth];
        for (const next of neighbors) {
          if (next < 0 || next >= mask.length || !mask[next] || visited[next]) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }

      if (points.length < 24) continue;

      const fitPoints = boundaryPoints.length >= 12 ? boundaryPoints : points;
      const circle = fitCircleToPoints(fitPoints);
      if (!circle) continue;

      const areaRatio = points.length / Math.max(gridWidth * gridHeight, 1);
      if (circle.radius < 4 || areaRatio < 0.04 || areaRatio > 0.58) continue;

      const componentWidth = maxX - minX + 1;
      const componentHeight = maxY - minY + 1;
      const componentAspect = Math.min(componentWidth, componentHeight) / Math.max(componentWidth, componentHeight, 1);
      if (componentAspect < 0.72) continue;

      const enclosingArea = componentWidth * componentHeight;
      const fillRatio = points.length / Math.max(enclosingArea, 1);
      const fillPenalty = Math.abs(fillRatio - 0.78);

      const avgDistance =
        fitPoints.reduce((sum, point) => sum + Math.hypot(point.x - circle.centerX, point.y - circle.centerY), 0) /
        fitPoints.length;
      const variance =
        fitPoints.reduce((sum, point) => {
          const distance = Math.hypot(point.x - circle.centerX, point.y - circle.centerY);
          return sum + (distance - avgDistance) ** 2;
        }, 0) / fitPoints.length;
      const radiusStd = Math.sqrt(variance);
      const circularityPenalty = radiusStd / Math.max(circle.radius, 1);
      const centerDistance =
        Math.hypot(circle.centerX - frameCenterX, circle.centerY - frameCenterY) / Math.max(gridWidth, gridHeight, 1);

      const score =
        Math.max(0, 1 - circularityPenalty * 6.2) * 3.2 +
        Math.max(0, 1 - (1 - componentAspect) * 3.8) * 2.6 +
        Math.max(0, 1 - fillPenalty * 4.5) * 2.4 +
        Math.max(0, 1 - centerDistance * 1.3) * 0.9 +
        areaRatio * 0.6;

      if (!best || score > best.score) {
        best = { centerX: circle.centerX, centerY: circle.centerY, radius: circle.radius, score };
      }
    }
  }

  if (!best) return null;

  const centerX = (best.centerX + 0.5) * cellSize;
  const centerY = (best.centerY + 0.5) * cellSize;
  const radius = refineCircleRadius(
    grayscale,
    chroma,
    width,
    height,
    centerX,
    centerY,
    best.radius * cellSize,
    brightThreshold,
  );
  const size = radius * 2.32;
  const padding = size * 0.032;

  return clampBox({
    x: clamp01((centerX - size / 2 - padding) / width),
    y: clamp01((centerY - size / 2 - padding) / height),
    width: Math.min(1, (size + padding * 2) / width),
    height: Math.min(1, (size + padding * 2) / height),
  });
};
