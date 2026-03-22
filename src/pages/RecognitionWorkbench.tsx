import { useMemo, useState } from 'react';
import { FlaskConical, Upload, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useStore } from '../store';
import { appendBenchmarkRun, readBenchmarkRuns, readDiagnostics } from '../recognition/diagnostics';
import type { BenchmarkCase, BenchmarkResult } from '../recognition/types';
import { runRecognitionPipeline } from '../recognition/pipeline';

const toDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });

const parseExpectedProductName = (filename: string) => {
  const [prefix] = filename.split('__');
  return prefix && prefix !== filename ? prefix.replace(/[_-]+/g, ' ').trim() : undefined;
};

export const RecognitionWorkbench = () => {
  const { products } = useStore();
  const diagnostics = useMemo(() => readDiagnostics(), []);
  const benchmarkHistory = useMemo(() => readBenchmarkRuns(), []);
  const [cases, setCases] = useState<BenchmarkCase[]>([]);
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || []);
    const nextCases = await Promise.all(
      selected.map(async (file) => ({
        name: file.name,
        imageSrc: await toDataUrl(file),
        expectedProductName: parseExpectedProductName(file.name),
      })),
    );
    setCases(nextCases);
    setResults([]);
  };

  const runBenchmark = async () => {
    setIsRunning(true);
    try {
      const nextResults: BenchmarkResult[] = [];
      for (const benchmarkCase of cases) {
        const result = await runRecognitionPipeline(benchmarkCase.imageSrc, products);
        nextResults.push({
          caseName: benchmarkCase.name,
          expectedProductName: benchmarkCase.expectedProductName,
          predictedProductName: result.product?.name,
          confidence: result.confidence,
          matched: benchmarkCase.expectedProductName
            ? benchmarkCase.expectedProductName.toLowerCase() === result.product?.name.toLowerCase()
            : null,
          rescanRecommended: result.rescanRecommended,
        });
      }
      setResults(nextResults);
      appendBenchmarkRun(nextResults);
    } finally {
      setIsRunning(false);
    }
  };

  const accuracy = results.filter((result) => result.matched !== null);
  const matchedCount = accuracy.filter((result) => result.matched).length;

  return (
    <div className="space-y-6 pb-12">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="text-primary-400" size={22} />
          <h2 className="text-2xl font-bold">Recognition Benchmark</h2>
        </div>
        <p className="text-sm text-muted">
          Локальная проверка pipeline. Для измерения accuracy называй файлы как
          <code className="ml-1">PRODUCT_NAME__case-01.jpg</code>.
        </p>
      </header>

      <div className="card p-4 space-y-4">
        <label className="flex cursor-pointer items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-600 p-6 text-sm text-muted hover:border-primary-500 hover:text-white">
          <Upload size={18} />
          <span>Загрузить benchmark images</span>
          <input className="hidden" type="file" accept="image/*" multiple onChange={handleFiles} />
        </label>

        <div className="flex items-center justify-between text-sm">
          <span>Каталог: {products.length} товаров</span>
          <span>Кейсы: {cases.length}</span>
        </div>

        <button
          onClick={runBenchmark}
          disabled={isRunning || cases.length === 0 || products.length === 0}
          className="w-full rounded-2xl bg-primary-600 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRunning ? 'Запуск pipeline...' : 'Запустить benchmark'}
        </button>

        {results.length > 0 && (
          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4 text-sm">
            <div className="flex flex-wrap gap-4">
              <span>Cases: {results.length}</span>
              <span>Avg confidence: {(results.reduce((sum, item) => sum + item.confidence, 0) / results.length).toFixed(2)}</span>
              <span>Rescan flagged: {results.filter((item) => item.rescanRecommended).length}</span>
              {accuracy.length > 0 && <span>Accuracy: {((matchedCount / accuracy.length) * 100).toFixed(0)}%</span>}
            </div>
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((result) => (
            <div key={result.caseName} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{result.caseName}</p>
                  <p className="text-xs text-muted">
                    expected: {result.expectedProductName || 'n/a'} | predicted: {result.predictedProductName || 'n/a'}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {result.matched === true && <CheckCircle2 className="text-primary-400" size={16} />}
                  {result.matched === false && <AlertTriangle className="text-orange-400" size={16} />}
                  <span>conf {result.confidence.toFixed(2)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Recent Diagnostics</h3>
        {diagnostics.length === 0 ? (
          <div className="text-sm text-muted">Локальных диагностик пока нет.</div>
        ) : (
          diagnostics.slice(0, 5).map((diagnostic) => (
            <div key={diagnostic.timestamp} className="card p-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{new Date(diagnostic.timestamp).toLocaleString()}</span>
                <span>{diagnostic.rescanRecommended ? 'rescan' : 'ok'}</span>
              </div>
              <div className="text-xs">
                quality: {diagnostic.quality.reasons.join(', ') || 'pass'} | barcode:{' '}
                {diagnostic.barcode?.rawValue || 'not-found'}
              </div>
              <div className="text-xs">
                candidates:{' '}
                {diagnostic.candidates.map((candidate) => `${candidate.productName} (${candidate.total.toFixed(2)})`).join(', ')}
              </div>
            </div>
          ))
        )}
      </section>

      {benchmarkHistory.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Benchmark History</h3>
          {benchmarkHistory.slice(0, 3).map((run) => (
            <div key={run.timestamp} className="card p-4 text-xs text-muted">
              {new Date(run.timestamp).toLocaleString()} | cases: {run.results.length}
            </div>
          ))}
        </section>
      )}
    </div>
  );
};
