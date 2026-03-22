import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Catalog } from './pages/Catalog';
import { ScanFlow } from './pages/ScanFlow';
import { History } from './pages/History';
import { Locations } from './pages/Locations';

const Benchmark = lazy(async () => {
  const module = await import('./pages/Benchmark');
  return { default: module.Benchmark };
});

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="catalog" element={<Catalog />} />
          <Route path="scan/*" element={<ScanFlow />} />
          <Route path="history" element={<History />} />
          <Route path="locations" element={<Locations />} />
          <Route
            path="benchmark"
            element={
              <Suspense fallback={<div className="py-10 text-center text-sm text-muted">Загружаю benchmark...</div>}>
                <Benchmark />
              </Suspense>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
