import { recognitionConfig } from '../config/recognition';
import { appendDiagnostics } from './diagnostics';
import type {
  AggregationSummary,
  BufferedRecognitionFrame,
  RecognitionRunResult,
} from './types';
import { extractBarcodeHints, isSyntheticBarcodeProduct, isValidBarcodeChecksum, scoreTextOverlap } from './utils';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const qualityToScore = (result: RecognitionRunResult) => {
  const reasonsPenalty = result.quality.reasons.length * 0.12;
  const base =
    (result.quality.brightness >= 45 && result.quality.brightness <= 225 ? 0.25 : 0.1) +
    Math.min(result.quality.contrast / 40, 0.25) +
    Math.min(result.quality.sharpness / 25, 0.35) +
    Math.min(result.quality.resolutionScore, 1) * 0.15;
  return clamp01(base - reasonsPenalty);
};

export const shouldAccumulateFrame = (result: RecognitionRunResult) =>
  qualityToScore(result) >= recognitionConfig.aggregation.minQualityScore;

const getDominantCandidate = (frames: BufferedRecognitionFrame[]) => {
  const buckets = new Map<
    string,
    { count: number; latest: BufferedRecognitionFrame; name: string; ids: string[] }
  >();

  frames.forEach((frame) => {
    const product = frame.result.product;
    if (!product) return;
    const existing = buckets.get(product.id);
    if (existing) {
      existing.count += 1;
      existing.latest = frame;
      existing.ids.push(frame.id);
      return;
    }
    buckets.set(product.id, {
      count: 1,
      latest: frame,
      name: product.name,
      ids: [frame.id],
    });
  });

  return Array.from(buckets.entries())
    .sort((left, right) => {
      if (right[1].count !== left[1].count) return right[1].count - left[1].count;
      return right[1].latest.result.confidence - left[1].latest.result.confidence;
    })[0];
};

const getDominantBarcode = (frames: BufferedRecognitionFrame[]) => {
  const buckets = new Map<string, number>();
  frames.forEach((frame) => {
    const barcode = frame.result.barcode?.rawValue;
    if (!barcode) return;
    buckets.set(barcode, (buckets.get(barcode) || 0) + 1);
  });
  return Array.from(buckets.entries()).sort((left, right) => right[1] - left[1]);
};

const getOcrStability = (frames: BufferedRecognitionFrame[]) => {
  const titleTexts = frames
    .map((frame) => frame.result.roiResults.find((roi) => roi.id === 'title')?.text || '')
    .filter(Boolean);
  if (titleTexts.length <= 1) return titleTexts.length === 1 ? 0.7 : 0;

  const dominantText = [...titleTexts].sort((left, right) => right.length - left.length)[0];
  const overlap =
    titleTexts.reduce((acc, text) => acc + scoreTextOverlap(text, dominantText), 0) / titleTexts.length;
  return clamp01(overlap);
};

const buildSummary = (
  frames: BufferedRecognitionFrame[],
  bestFrame: BufferedRecognitionFrame | undefined,
  timedOut: boolean,
): AggregationSummary => {
  const acceptedFrames = frames.filter((frame) => frame.accepted);
  const rejectedFrames = frames.length - acceptedFrames.length;
  const dominantCandidate = getDominantCandidate(acceptedFrames);
  const barcodeRanking = getDominantBarcode(acceptedFrames);
  const dominantBarcode = barcodeRanking[0];
  const runnerUpBarcode = barcodeRanking[1];
  const candidateStability =
    dominantCandidate && !isSyntheticBarcodeProduct(dominantCandidate[1].latest.result.product!)
      ? dominantCandidate[1].count / Math.max(acceptedFrames.length, 1)
      : 0;
  const barcodeStability = dominantBarcode ? dominantBarcode[1] / Math.max(acceptedFrames.length, 1) : 0;
  const barcodeConsensusMargin =
    dominantBarcode && runnerUpBarcode
      ? (dominantBarcode[1] - runnerUpBarcode[1]) / Math.max(acceptedFrames.length, 1)
      : dominantBarcode
        ? barcodeStability
        : 0;
  const barcodeChecksumValid = Boolean(dominantBarcode?.[0] && isValidBarcodeChecksum(dominantBarcode[0]));
  const ocrStability = getOcrStability(acceptedFrames);
  const signalAgreement =
    dominantCandidate && dominantBarcode && !isSyntheticBarcodeProduct(dominantCandidate[1].latest.result.product!)
      ? extractBarcodeHints(dominantCandidate[1].latest.result.product!).includes(dominantBarcode[0])
        ? 1
        : 0.35
      : 0.5;
  const baseConfidence = bestFrame?.result.confidence || 0;
  const barcodeRescueBoost = dominantBarcode
    ? barcodeChecksumValid && barcodeStability >= 0.95 && barcodeConsensusMargin >= 0.5
      ? 0.28
      : barcodeChecksumValid && barcodeStability >= 0.75 && barcodeConsensusMargin >= 0.34
        ? 0.18
        : 0
    : 0;
  const finalScore = clamp01(
    candidateStability * 0.45 +
      barcodeStability * 0.24 +
      ocrStability * 0.15 +
      baseConfidence * 0.15 +
      signalAgreement * 0.05 +
      barcodeRescueBoost,
  );
  const stabilizedScore =
    dominantBarcode && barcodeChecksumValid && barcodeStability >= 0.95 && barcodeConsensusMargin >= 0.5
      ? Math.max(finalScore, 0.72)
      : finalScore;
  const stable =
    acceptedFrames.length >= recognitionConfig.aggregation.minAcceptedFrames &&
    (
      (stabilizedScore >= recognitionConfig.aggregation.stableThreshold && candidateStability >= 0.55) ||
      (barcodeChecksumValid && barcodeStability >= 0.95 && barcodeConsensusMargin >= 0.5)
    );

  return {
    framesSeen: frames.length,
    acceptedFrames: acceptedFrames.length,
    rejectedFrames,
    stable,
    timedOut,
    finalScore: stabilizedScore,
    candidateStability,
    barcodeStability,
    barcodeConsensusMargin,
    barcodeChecksumValid,
    ocrStability,
    dominantCandidateName: dominantCandidate?.[1].name,
    dominantBarcode: dominantBarcode?.[0],
  };
};

export const aggregateRecognitionFrames = (
  frames: BufferedRecognitionFrame[],
  timedOut = false,
  options?: { persistDiagnostics?: boolean },
): RecognitionRunResult | null => {
  if (frames.length === 0) return null;
  const acceptedFrames = frames.filter((frame) => frame.accepted);
  const barcodeFirstFrame = [...acceptedFrames]
    .filter((frame) => frame.result.barcode?.rawValue)
    .sort((left, right) => {
      const ocrPresenceDelta = right.result.roiResults.length - left.result.roiResults.length;
      if (ocrPresenceDelta !== 0) return ocrPresenceDelta;
      const barcodeConfidenceDelta = (right.result.confidence || 0) - (left.result.confidence || 0);
      if (barcodeConfidenceDelta !== 0) return barcodeConfidenceDelta;
      return (right.result.quality.sharpness || 0) - (left.result.quality.sharpness || 0);
    })[0];
  const bestFrame =
    getDominantCandidate(acceptedFrames)?.[1].latest ||
    barcodeFirstFrame ||
    [...acceptedFrames].sort((left, right) => {
      const confidenceDelta = right.result.confidence - left.result.confidence;
      if (confidenceDelta !== 0) return confidenceDelta;
      return right.result.quality.sharpness - left.result.quality.sharpness;
    })[0] ||
    [...frames].sort((left, right) => {
      const barcodePresence = Number(Boolean(right.result.barcode?.rawValue)) - Number(Boolean(left.result.barcode?.rawValue));
      if (barcodePresence !== 0) return barcodePresence;
      return right.result.quality.sharpness - left.result.quality.sharpness;
    })[0];

  const summary = buildSummary(frames, bestFrame, timedOut);
  const aggregated: RecognitionRunResult = {
    ...bestFrame.result,
    barcode: summary.dominantBarcode
      ? {
          rawValue: summary.dominantBarcode,
          format: bestFrame.result.barcode?.format || 'ean_13',
          source: bestFrame.result.barcode?.source || 'zxing',
        }
      : bestFrame.result.barcode,
    confidence: summary.finalScore,
    requiresConfirmation:
      !summary.stable &&
      !(summary.barcodeChecksumValid && summary.barcodeStability >= 0.95 && summary.barcodeConsensusMargin >= 0.5),
    rescanRecommended:
      timedOut &&
      !(summary.barcodeChecksumValid && summary.barcodeStability >= 0.95 && summary.barcodeConsensusMargin >= 0.5) &&
      (!summary.dominantCandidateName || summary.finalScore < recognitionConfig.aggregation.reviewThreshold),
    diagnostics: {
      ...bestFrame.result.diagnostics,
      aggregation: summary,
      requiresConfirmation:
        !summary.stable &&
        !(summary.barcodeChecksumValid && summary.barcodeStability >= 0.95 && summary.barcodeConsensusMargin >= 0.5),
      rescanRecommended:
        timedOut &&
        !(summary.barcodeChecksumValid && summary.barcodeStability >= 0.95 && summary.barcodeConsensusMargin >= 0.5) &&
        (!summary.dominantCandidateName || summary.finalScore < recognitionConfig.aggregation.reviewThreshold),
    },
    aggregation: summary,
  };

  if (options?.persistDiagnostics !== false) {
    appendDiagnostics(aggregated.diagnostics);
  }
  return aggregated;
};
