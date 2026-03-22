import { recognitionConfig } from '../config/recognition';
import type { BenchmarkResult, RecognitionDiagnostics } from './types';

const DIAGNOSTICS_KEY = 'etiket-recognition-diagnostics';
const BENCHMARK_KEY = 'etiket-recognition-benchmarks';

const readJson = <T>(key: string): T[] => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeJson = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const appendDiagnostics = (diagnostic: RecognitionDiagnostics) => {
  const existing = readJson<RecognitionDiagnostics>(DIAGNOSTICS_KEY);
  existing.unshift(diagnostic);
  const next = existing.slice(0, recognitionConfig.diagnostics.maxStoredRuns);
  if (writeJson(DIAGNOSTICS_KEY, next)) return;

  for (let limit = Math.min(next.length, 10); limit >= 1; limit -= 1) {
    if (writeJson(DIAGNOSTICS_KEY, next.slice(0, limit))) {
      return;
    }
  }
};

export const readDiagnostics = () => readJson<RecognitionDiagnostics>(DIAGNOSTICS_KEY);

export const appendBenchmarkRun = (results: BenchmarkResult[]) => {
  const existing = readJson<{ timestamp: string; results: BenchmarkResult[] }>(BENCHMARK_KEY);
  existing.unshift({ timestamp: new Date().toISOString(), results });
  writeJson(BENCHMARK_KEY, existing.slice(0, 10));
};

export const readBenchmarkRuns = () => readJson<{ timestamp: string; results: BenchmarkResult[] }>(BENCHMARK_KEY);
