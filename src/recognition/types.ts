import type { Product } from '../types';

export type NormalizedCanvas = {
  canvas: HTMLCanvasElement;
  dataUrl: string;
  width: number;
  height: number;
};

export type QualityMetrics = {
  brightness: number;
  contrast: number;
  sharpness: number;
  glareScore: number;
  resolutionScore: number;
  passes: boolean;
  reasons: string[];
};

export type BarcodeResult = {
  rawValue: string;
  format: string;
  source: 'barcode-detector' | 'zxing';
};

export type BarcodePreviewMatch = BarcodeResult & {
  points: Array<{ x: number; y: number }>;
};

export type OcrRegionResult = {
  id: string;
  text: string;
  confidence: number;
  hash: string;
};

export type CandidateScore = {
  product: Product;
  total: number;
  barcodeScore: number;
  visualScore: number;
  roiScore: number;
  textScore: number;
  qualityPenalty: number;
  reasons: string[];
};

export type RecognitionDiagnostics = {
  timestamp: string;
  quality: QualityMetrics;
  barcode: BarcodeResult | null;
  roiResults: OcrRegionResult[];
  candidates: Array<{
    productId: string;
    productName: string;
    total: number;
    reasons: string[];
  }>;
  normalizedImage: string;
  rawImage: string;
  barcodeImage?: string;
  rescanRecommended: boolean;
  requiresConfirmation: boolean;
  aggregation?: AggregationSummary;
};

export type RecognitionRunResult = {
  product: Product | null;
  confidence: number;
  normalizedImage: string;
  barcode: BarcodeResult | null;
  roiResults: OcrRegionResult[];
  candidates: CandidateScore[];
  diagnostics: RecognitionDiagnostics;
  requiresConfirmation: boolean;
  rescanRecommended: boolean;
  quality: QualityMetrics;
  learnedVisualHash: string;
  aggregation?: AggregationSummary;
};

export type BenchmarkCase = {
  name: string;
  imageSrc: string;
  expectedProductName?: string;
};

export type BenchmarkResult = {
  caseName: string;
  expectedProductName?: string;
  predictedProductName?: string;
  confidence: number;
  matched: boolean | null;
  rescanRecommended: boolean;
};

export type BufferedRecognitionFrame = {
  id: string;
  capturedAt: number;
  accepted: boolean;
  result: RecognitionRunResult;
};

export type AggregationSummary = {
  framesSeen: number;
  acceptedFrames: number;
  rejectedFrames: number;
  stable: boolean;
  timedOut: boolean;
  finalScore: number;
  candidateStability: number;
  barcodeStability: number;
  barcodeConsensusMargin: number;
  barcodeChecksumValid: boolean;
  ocrStability: number;
  dominantCandidateName?: string;
  dominantBarcode?: string;
};

export type CameraFeedback = {
  severity: 'info' | 'warning';
  message: string;
  reason:
    | 'move-closer'
    | 'move-back'
    | 'blurry'
    | 'low-light'
    | 'too-bright'
    | 'glare'
    | 'low-contrast'
    | 'stabilizing'
    | 'locked'
    | 'motion'
    | 'off-center'
    | 'tilted'
    | 'barcode-unstable'
    | 'candidate-unstable';
};
