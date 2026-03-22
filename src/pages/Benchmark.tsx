import { useEffect, useState } from 'react';
import { runRecognitionPipeline } from '../recognition/pipeline';
import type { Product } from '../types';

type BenchmarkStateItem = Record<string, unknown>;

const MOCK_PRODUCTS: Product[] = [
  { id: '1', name: 'Product 1', barcode: '123456', description: 'Test', photoUrl: '', labelSignature: '', recognitionProfile: {
    visualHash: '11111111111111111111111111111111',
    roiProfiles: [],
    barcodeHints: [],
    learnedAt: new Date().toISOString(),
    referenceCount: 1,
  } },
  { id: '2', name: 'Product 2', barcode: '654321', description: 'Test 2', photoUrl: '', labelSignature: '', recognitionProfile: {
    visualHash: '00000000000000000000000000000000',
    roiProfiles: [],
    barcodeHints: [],
    learnedAt: new Date().toISOString(),
    referenceCount: 1,
  } },
];

export const Benchmark = () => {
  const [results, setResults] = useState<BenchmarkStateItem[]>([]);

  useEffect(() => {
    const run = async () => {
      try {
        const res1 = await runRecognitionPipeline('/test1.jpg', MOCK_PRODUCTS);
        const res2 = await runRecognitionPipeline('/test2.jpg', MOCK_PRODUCTS);
        const res3 = await runRecognitionPipeline('/test3.jpg', MOCK_PRODUCTS);
        setResults([res1, res2, res3].map(r => ({ ...r, normalizedImage: undefined })));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        setResults([{ error: message, stack }]);
      }
    };
    run();
  }, []);

  return (
    <div className="p-4" id="benchmark-results">
      <h1 className="text-2xl font-bold mb-4">Benchmark Results</h1>
      <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm">
        {JSON.stringify(results, null, 2)}
      </pre>
    </div>
  );
};
