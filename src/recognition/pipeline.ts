import type { Product, RecognitionRoiProfile } from '../types';
import { recognitionConfig } from '../config/recognition';
import { scanBarcode } from './barcode';
import { appendDiagnostics } from './diagnostics';
import type { CandidateScore, RecognitionRunResult } from './types';
import {
  buildRecognitionProfile,
  calculateDHash,
  evaluateFrameQuality,
  extractBarcodeHints,
  getHammingDistance,
  isSyntheticBarcodeProduct,
  loadImage,
  normalizeLabelRegion,
  sanitizeBarcode,
  scoreTextOverlap,
} from './utils';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const getCandidatePool = (products: Product[], barcode: string | null) => {
  const normalizedBarcode = sanitizeBarcode(barcode);
  if (!normalizedBarcode) return products;
  const matches = products.filter((product) => extractBarcodeHints(product).includes(normalizedBarcode));
  return matches.length > 0 ? matches : products;
};

const getExactBarcodeMatches = (products: Product[], barcode: string | null) => {
  const normalizedBarcode = sanitizeBarcode(barcode);
  if (!normalizedBarcode) return [];
  return products.filter(
    (product) => extractBarcodeHints(product).includes(normalizedBarcode) && !isSyntheticBarcodeProduct(product),
  );
};

const scoreCandidate = (args: {
  product: Product;
  barcode: string | null;
  visualHash: string;
  roiHashes: RecognitionRoiProfile[];
  roiTexts: string[];
  qualityPenalty: number;
}): CandidateScore => {
  const barcodeHints = extractBarcodeHints(args.product);
  const barcodeScore = !args.barcode
    ? 0
    : barcodeHints.includes(args.barcode)
      ? recognitionConfig.scoring.barcodeExactBoost
      : barcodeHints.some((hint) => hint.endsWith(args.barcode ?? '') || (args.barcode ?? '').endsWith(hint))
        ? recognitionConfig.scoring.barcodeHintBoost
        : 0;

  const productVisualHash = args.product.recognitionProfile?.visualHash || args.product.labelSignature;
  const visualDistance = getHammingDistance(args.visualHash, productVisualHash);
  const visualScore = (1 - visualDistance) * recognitionConfig.scoring.visualWeight;

  const productRois = new Map((args.product.recognitionProfile?.roiProfiles || []).map((roi) => [roi.id, roi]));
  let roiScore = 0;
  args.roiHashes.forEach((roi) => {
    const candidateRegion = productRois.get(roi.id);
    if (!candidateRegion) return;
    roiScore += (1 - getHammingDistance(roi.hash, candidateRegion.hash)) * roi.weight;
  });
  roiScore = clamp01(roiScore) * recognitionConfig.scoring.roiHashWeight;

  const candidateText = [
    args.product.name,
    args.product.description,
    ...Object.values(args.product.metadata || {}),
  ].join(' ');
  const textOverlap =
    args.roiTexts.reduce((acc, text) => acc + scoreTextOverlap(text, candidateText), 0) /
    Math.max(args.roiTexts.length, 1);
  const textScore = textOverlap * recognitionConfig.scoring.ocrTextWeight;

  const total = clamp01(barcodeScore + visualScore + roiScore + textScore - args.qualityPenalty);
  const reasons = [
    barcodeScore > 0 ? `barcode:${barcodeScore.toFixed(2)}` : null,
    `visual:${visualScore.toFixed(2)}`,
    roiScore > 0 ? `roi:${roiScore.toFixed(2)}` : null,
    textScore > 0 ? `text:${textScore.toFixed(2)}` : null,
    args.qualityPenalty > 0 ? `quality-penalty:${args.qualityPenalty.toFixed(2)}` : null,
  ].filter(Boolean) as string[];

  return {
    product: args.product,
    total,
    barcodeScore,
    visualScore,
    roiScore,
    textScore,
    qualityPenalty: args.qualityPenalty,
    reasons,
  };
};

export const runRecognitionPipeline = async (
  imageSrc: string,
  products: Product[],
  options?: { persistDiagnostics?: boolean; barcodeImageSrc?: string; ocrMode?: 'fast' | 'full' },
): Promise<RecognitionRunResult> => {
  const sourceImage = await loadImage(imageSrc);
  const quality = evaluateFrameQuality(sourceImage);
  const normalized = await normalizeLabelRegion(imageSrc);
  const barcodeSourceImage = options?.barcodeImageSrc ? await loadImage(options.barcodeImageSrc) : sourceImage;
  const barcode = await scanBarcode(normalized.canvas, barcodeSourceImage);
  const visualHash = calculateDHash(normalized.canvas);
  const candidatePool = getCandidatePool(products, barcode?.rawValue || null);
  const exactBarcodeMatches = getExactBarcodeMatches(products, barcode?.rawValue || null);
  const qualityPenalty = clamp01(
    (quality.reasons.length / 4) * recognitionConfig.scoring.qualityPenaltyWeight +
      Math.max(0, 1 - quality.resolutionScore) * 0.05,
  );

  if (exactBarcodeMatches.length === 1) {
    const matchedProduct = exactBarcodeMatches[0];
    const confidence = clamp01(
      recognitionConfig.scoring.barcodeExactBoost +
        recognitionConfig.scoring.visualWeight * 0.85 -
        qualityPenalty * 0.22,
    );
    const candidate = scoreCandidate({
      product: matchedProduct,
      barcode: barcode?.rawValue || null,
      visualHash,
      roiHashes: [],
      roiTexts: [],
      qualityPenalty,
    });
    const diagnostics = {
      timestamp: new Date().toISOString(),
      quality,
      barcode,
      roiResults: [],
      candidates: [
        {
          productId: matchedProduct.id,
          productName: matchedProduct.name,
          total: Math.max(confidence, candidate.total),
          reasons: ['barcode-fast-path', ...candidate.reasons],
        },
      ],
      normalizedImage: normalized.dataUrl,
      rawImage: imageSrc,
      rescanRecommended: false,
      requiresConfirmation:
        !quality.passes && Math.max(confidence, candidate.total) < recognitionConfig.scoring.confidentThreshold,
    };

    if (options?.persistDiagnostics !== false) {
      appendDiagnostics(diagnostics);
    }

    return {
      product: matchedProduct,
      confidence: Math.max(confidence, candidate.total),
      normalizedImage: normalized.dataUrl,
      barcode,
      roiResults: [],
      candidates: [
        {
          ...candidate,
          total: Math.max(confidence, candidate.total),
          reasons: ['barcode-fast-path', ...candidate.reasons],
        },
      ],
      diagnostics,
      requiresConfirmation: diagnostics.requiresConfirmation,
      rescanRecommended: false,
      quality,
      learnedVisualHash: visualHash,
    };
  }

  const { runRoiOcr } = await import('./ocr');
  const roiResults = await runRoiOcr(normalized.canvas, options?.ocrMode || 'full');

  const roiProfiles: RecognitionRoiProfile[] = roiResults.map((roi) => ({
    id: roi.id,
    hash: roi.hash,
    weight: recognitionConfig.roiRegions.find((region) => region.id === roi.id)?.weight || 1,
  }));

  const candidates = candidatePool
    .map((product) =>
      scoreCandidate({
        product,
        barcode: barcode?.rawValue || null,
        visualHash,
        roiHashes: roiProfiles,
        roiTexts: roiResults.map((roi) => roi.text),
        qualityPenalty,
      }),
    )
    .filter((candidate) => !isSyntheticBarcodeProduct(candidate.product))
    .sort((left, right) => right.total - left.total);

  const best = candidates[0];
  const second = candidates[1];
  const ambiguityMargin = best && second ? best.total - second.total : 1;
  const rescanRecommended =
    !quality.passes ||
    (best ? best.total < recognitionConfig.scoring.rescanThreshold : true);
  const requiresConfirmation =
    rescanRecommended ||
    (best ? best.total < recognitionConfig.scoring.confidentThreshold : true) ||
    ambiguityMargin < recognitionConfig.scoring.ambiguityMargin;

  const diagnostics = {
    timestamp: new Date().toISOString(),
    quality,
    barcode,
    roiResults,
    candidates: candidates.slice(0, 5).map((candidate) => ({
      productId: candidate.product.id,
      productName: candidate.product.name,
      total: candidate.total,
      reasons: candidate.reasons,
    })),
    normalizedImage: normalized.dataUrl,
    rawImage: imageSrc,
    rescanRecommended,
    requiresConfirmation,
  };

  if (options?.persistDiagnostics !== false) {
    appendDiagnostics(diagnostics);
  }

  return {
    product: best?.product || null,
    confidence: best?.total || 0,
    normalizedImage: normalized.dataUrl,
    barcode,
    roiResults,
    candidates,
    diagnostics,
    requiresConfirmation,
    rescanRecommended,
    quality,
    learnedVisualHash: visualHash,
  };
};

export const buildProductRecognitionProfile = (args: {
  product: Product;
  learnedVisualHash: string;
  barcode: string;
  roiResults: RecognitionRunResult['roiResults'];
}) =>
  buildRecognitionProfile({
    visualHash: args.learnedVisualHash,
    barcodeHints: args.barcode ? [args.barcode] : [],
    previous: args.product.recognitionProfile,
    roiProfiles: args.roiResults.map((roi) => ({
      id: roi.id,
      hash: roi.hash,
      weight: recognitionConfig.roiRegions.find((region) => region.id === roi.id)?.weight || 1,
    })),
  });
