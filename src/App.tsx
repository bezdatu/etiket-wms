import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Catalog } from './pages/Catalog';
import { ScanFlow } from './pages/ScanFlow';
import { History } from './pages/History';
import { Locations } from './pages/Locations';

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
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
