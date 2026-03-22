import { aggregateRecognitionFrames } from '../src/recognition/aggregation';
import type { BufferedRecognitionFrame, RecognitionDiagnostics } from '../src/recognition/types';
import type { Product } from '../src/types';

const MOCK_PRODUCT_A: Product = {
  id: 'A',
  name: 'Product A',
  barcode: '111111',
  description: '',
  photoUrl: '',
  labelSignature: '',
  recognitionProfile: { visualHash: '1111', roiProfiles: [], barcodeHints: ['111111'], learnedAt: '', referenceCount: 1 }
};

const MOCK_PRODUCT_B: Product = {
  id: 'B',
  name: 'Product B',
  barcode: '222222',
  description: '',
  photoUrl: '',
  labelSignature: '',
  recognitionProfile: { visualHash: '2222', roiProfiles: [], barcodeHints: ['222222'], learnedAt: '', referenceCount: 1 }
};

const createMockFrame = (id: string, product: Product | null, barcode: string | null, accepted: boolean): BufferedRecognitionFrame => ({
  id,
  capturedAt: Date.now(),
  accepted,
  result: {
    product,
    confidence: 0.8,
    barcode: barcode ? { rawValue: barcode, format: 'ean_13', source: 'zxing' } : null,
    roiResults: [{ id: 'title', text: product ? product.name : '', confidence: 0.9, hash: 'hash' }],
    candidates: [],
    diagnostics: {
      timestamp: '',
      quality: { brightness: 128, contrast: 50, sharpness: 30, resolutionScore: 1, passes: true, reasons: [] },
      barcode: barcode ? { rawValue: barcode, format: 'ean_13', source: 'zxing' } : null,
      roiResults: [{ id: 'title', text: product ? product.name : '', confidence: 0.9, hash: 'hash' }],
      candidates: [],
      normalizedImage: '',
      rawImage: '',
      rescanRecommended: false,
      requiresConfirmation: false,
    } satisfies RecognitionDiagnostics,
    requiresConfirmation: false,
    rescanRecommended: false,
    quality: { brightness: 128, contrast: 50, sharpness: 30, resolutionScore: 1, passes: true, reasons: [] },
    normalizedImage: '',
    learnedVisualHash: 'hash'
  }
});

function testStability() {
  console.log('Testing Stability (All A)...');
  const frames = [
    createMockFrame('1', MOCK_PRODUCT_A, '111111', true),
    createMockFrame('2', MOCK_PRODUCT_A, '111111', true),
    createMockFrame('3', MOCK_PRODUCT_A, '111111', true),
    createMockFrame('4', MOCK_PRODUCT_A, '111111', true),
  ];
  const aggregated = aggregateRecognitionFrames(frames, false, { persistDiagnostics: false });
  console.log('Stable result product:', aggregated?.product?.name);
  console.log('Final Score:', aggregated?.confidence);
  console.log('Aggregation Summary:', JSON.stringify(aggregated?.aggregation, null, 2));
}

function testNoise() {
  console.log('\nTesting Noise (A mixed with invalid frames)...');
  const frames = [
    createMockFrame('1', MOCK_PRODUCT_A, '111111', true),
    createMockFrame('2', null, null, false), // rejected
    createMockFrame('3', MOCK_PRODUCT_B, '222222', true), // valid but wrong
    createMockFrame('4', MOCK_PRODUCT_A, '111111', true),
    createMockFrame('5', MOCK_PRODUCT_A, '111111', true),
  ];
  const aggregated = aggregateRecognitionFrames(frames, false, { persistDiagnostics: false });
  console.log('Result product:', aggregated?.product?.name);
  console.log('Accepted frames:', aggregated?.aggregation?.acceptedFrames);
  console.log('Candidate Stability:', aggregated?.aggregation?.candidateStability);
  console.log('Final Score:', aggregated?.confidence);
}

function testBarcodePersistence() {
  console.log('\nTesting Barcode Persistence (Barcode missing in 50% frames)...');
  const frames = [
    createMockFrame('1', MOCK_PRODUCT_A, '111111', true),
    createMockFrame('2', MOCK_PRODUCT_A, null, true),
    createMockFrame('3', MOCK_PRODUCT_A, '111111', true),
    createMockFrame('4', MOCK_PRODUCT_A, null, true),
  ];
  const aggregated = aggregateRecognitionFrames(frames, false, { persistDiagnostics: false });
  console.log('Result product:', aggregated?.product?.name);
  console.log('Barcode:', aggregated?.barcode?.rawValue);
  console.log('Barcode Stability:', aggregated?.aggregation?.barcodeStability);
}

function testOcrNoise() {
  console.log('\nTesting OCR Noise (Slightly different title text)...');
  const frames = [
    createMockFrame('1', MOCK_PRODUCT_A, '111111', true),
    createMockFrame('2', MOCK_PRODUCT_A, '111111', true),
    createMockFrame('3', MOCK_PRODUCT_A, '111111', true),
    createMockFrame('4', MOCK_PRODUCT_A, '111111', true),
  ];
  // Inject noise into one frame
  frames[2].result.roiResults[0].text = 'Pr0duct A'; 
  const aggregated = aggregateRecognitionFrames(frames, false, { persistDiagnostics: false });
  console.log('Result product:', aggregated?.product?.name);
  console.log('OCR Stability:', aggregated?.aggregation?.ocrStability);
  console.log('Final Score:', aggregated?.confidence);
}

function testQualityFilter() {
  console.log('\nTesting Quality Filter (Low quality frames rejected)...');
  const frames = [
    createMockFrame('1', MOCK_PRODUCT_A, '111111', true),
    createMockFrame('2', MOCK_PRODUCT_A, '111111', false), // Rejected
    createMockFrame('3', MOCK_PRODUCT_A, '111111', false), // Rejected
    createMockFrame('4', MOCK_PRODUCT_A, '111111', true),
  ];
  const aggregated = aggregateRecognitionFrames(frames, false, { persistDiagnostics: false });
  console.log('Accepted frames:', aggregated?.aggregation?.acceptedFrames);
  console.log('Stable:', aggregated?.aggregation?.stable);
}

testStability();
testNoise();
testBarcodePersistence();
testOcrNoise();
testQualityFilter();
