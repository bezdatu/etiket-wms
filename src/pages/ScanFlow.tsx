import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, Routes, Route, useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { Camera, CheckCircle2, AlertTriangle, ArrowRight, X, Package, ScanLine } from 'lucide-react';
import { Product } from '../types';
import Webcam from 'react-webcam';

export const ScanFlow = () => {
  return (
    <Routes>
      <Route path="/" element={<ScanModeSelect />} />
      <Route path="camera" element={<CameraCapture />} />
      <Route path="result" element={<ScanResult />} />
    </Routes>
  );
};

// 1. SELECT MODE
const ScanModeSelect = () => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-[70vh] items-center justify-center space-y-6">
      <div className="text-center space-y-2 mb-8">
        <h2 className="text-3xl font-bold">Сканирование</h2>
        <p className="text-muted">Выберите тип операции</p>
      </div>
      
      <button 
        onClick={() => navigate('camera', { state: { type: 'incoming' } })}
        className="w-full card p-8 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-primary-900/50 to-primary-800/20 border-primary-500/30 hover:border-primary-500 transition-colors"
      >
        <div className="bg-primary-500 text-white p-4 rounded-full">
          <ArrowRight className="transform rotate-90" size={32} />
        </div>
        <span className="text-2xl font-bold">Принять towar</span>
      </button>

      <button 
        onClick={() => navigate('camera', { state: { type: 'outgoing' } })}
        className="w-full card p-8 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-red-900/50 to-red-800/20 border-red-500/30 hover:border-red-500 transition-colors"
      >
        <div className="bg-red-500 text-white p-4 rounded-full">
          <ArrowRight className="transform -rotate-90" size={32} />
        </div>
        <span className="text-2xl font-bold">Выдать towar</span>
      </button>
    </div>
  );
};

// 2. CAMERA CAPTURE (MOCK OCR/CV)
const CameraCapture = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const opType = location.state?.type || 'incoming';
  const { products } = useStore();
  
  const [isScanning, setIsScanning] = useState(false);
  const webcamRef = useRef<Webcam>(null);

  const handleScan = useCallback(async () => {
    setIsScanning(true);
    // Simulate API delay for CV/OCR processing
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // MOCK LOGIC: Randomly select a product and assign a confidence score
    const randomProduct = products[Math.floor(Math.random() * products.length)];
    const confidence = Math.random() > 0.3 ? (0.85 + Math.random() * 0.14) : (0.4 + Math.random() * 0.3); // High confidence 70% of time
    
    navigate('/scan/result', { 
      state: { 
        type: opType, 
        prediction: randomProduct, 
        confidence,
        // photoBase64: imageSrc
      } 
    });
  }, [navigate, opType, products]);

  return (
    <div className="h-[80vh] flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">{opType === 'incoming' ? 'Приемка' : 'Выдача'}</h2>
        <button onClick={() => navigate('/scan')} className="p-2 bg-slate-800 rounded-full text-muted">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 relative bg-black rounded-3xl overflow-hidden border-2 border-slate-700">
        <Webcam
          audio={false}
          ref={webcamRef}
          screenshotFormat="image/jpeg"
          videoConstraints={{ facingMode: "environment" }}
          className="w-full h-full object-cover"
        />
        
        {/* Scanner Overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="w-64 h-64 border-2 border-primary-500/50 rounded-2xl relative">
            <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary-500 rounded-tl-xl"></div>
            <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary-500 rounded-tr-xl"></div>
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary-500 rounded-bl-xl"></div>
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary-500 rounded-br-xl"></div>
            
            {isScanning && (
              <div className="absolute inset-0 bg-primary-500/20 animate-pulse rounded-xl"></div>
            )}
            {isScanning && (
              <div className="absolute top-0 left-0 w-full h-1 bg-primary-400 shadow-[0_0_15px_#22c55e] animate-[scan_2s_ease-in-out_infinite]"></div>
            )}
          </div>
          <p className="mt-8 text-white bg-black/50 px-4 py-2 rounded-full backdrop-blur-md">
            Наведите камеру на этикетку
          </p>
        </div>
      </div>

      <div className="mt-6 flex justify-center pb-8">
        <button 
          onClick={handleScan}
          disabled={isScanning}
          className="w-20 h-20 bg-primary-600 rounded-full flex items-center justify-center shadow-lg shadow-primary-500/30 border-4 border-slate-800 ring-4 ring-primary-500/50 active:scale-95 transition-all disabled:opacity-50"
        >
          <Camera size={32} className="text-white" />
        </button>
      </div>
    </div>
  );
};

// 3. SCAN RESULT & CONFIRMATION
const ScanResult = () => {
  const navigate = useNavigate();
  const locationState = useLocation().state;
  const { locations, inventory, recordOperation } = useStore();
  
  if (!locationState) {
    navigate('/scan');
    return null;
  }

  const { type, prediction, confidence } = locationState;
  const product: Product = prediction;
  const isHighConfidence = confidence >= 0.8;

  const [quantity, setQuantity] = useState(1);
  const [selectedLocId, setSelectedLocId] = useState('');

  // Auto-select location logic
  useEffect(() => {
    const productInv = inventory.filter(i => i.productId === product.id && i.quantity > 0);
    if (productInv.length > 0) {
      setSelectedLocId(productInv[0].locationId);
    } else if (type === 'incoming') {
      const freeLoc = locations.find(l => !l.isOccupied);
      if (freeLoc) setSelectedLocId(freeLoc.id);
    }
  }, [product.id, inventory, locations, type]);

  const handleConfirm = () => {
    if (!selectedLocId || quantity <= 0) return;
    recordOperation({
      id: `op_${Date.now()}`,
      type: type,
      productId: product.id,
      locationId: selectedLocId,
      quantity,
      confidenceScore: confidence,
      isUserConfirmed: true,
      timestamp: new Date().toISOString()
    });
    navigate('/history');
  };

  return (
    <div className="space-y-6 pb-20">
      <header className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Подтверждение</h2>
        <button onClick={() => navigate('/scan/camera', { state: { type } })} className="text-primary-500 flex items-center text-sm font-semibold">
          <ScanLine size={16} className="mr-1" /> Пересканировать
        </button>
      </header>

      {/* Confidence Alert */}
      <div className={`p-4 rounded-xl flex items-start gap-3 ${isHighConfidence ? 'bg-primary-500/10 border border-primary-500/30' : 'bg-orange-500/10 border border-orange-500/30'}`}>
        {isHighConfidence ? <CheckCircle2 className="text-primary-500 mt-0.5" /> : <AlertTriangle className="text-orange-500 mt-0.5" />}
        <div>
          <p className={`font-bold ${isHighConfidence ? 'text-primary-500' : 'text-orange-400'}`}>
            {isHighConfidence ? 'Распознано успешно' : 'Низкая уверенность'} ({(confidence * 100).toFixed(0)}%)
          </p>
          {!isHighConfidence && <p className="text-xs text-muted mt-1">Пожалуйста, внимательно проверьте результат распознавания, так как этикетки могут быть очень похожи.</p>}
        </div>
      </div>

      {/* Product Details */}
      <div className="card p-4">
        <div className="flex gap-4 mb-4">
          <div className="w-24 h-24 bg-slate-800 rounded-lg overflow-hidden flex-shrink-0">
            {product.photoUrl ? (
              <img src={product.photoUrl} alt="" className="w-full h-full object-cover" />
            ) : <Package className="m-auto mt-6 text-slate-600" size={40} />}
          </div>
          <div>
            <h3 className="text-xl font-bold leading-tight">{product.name}</h3>
            <p className="text-sm text-muted mt-1">{product.description}</p>
            {product.barcode && <p className="text-xs font-mono bg-slate-800 px-2 py-1 mt-2 rounded inline-block">B/C: {product.barcode}</p>}
          </div>
        </div>
        
        <div className="border-t border-slate-700/50 pt-4 mt-4 space-y-4">
          <div>
            <label className="text-xs text-muted font-bold uppercase tracking-wider block mb-2">Количество ({type === 'incoming' ? 'Принять' : 'Выдать'})</label>
            <div className="flex items-center">
              <button 
                className="bg-slate-700 hover:bg-slate-600 w-12 h-12 rounded-l-xl text-xl font-bold flex items-center justify-center transition"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
              >-</button>
              <input 
                type="number" 
                className="bg-slate-800 w-full h-12 text-center text-xl font-bold focus:outline-none"
                value={quantity}
                onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              />
              <button 
                className="bg-slate-700 hover:bg-slate-600 w-12 h-12 rounded-r-xl text-xl font-bold flex items-center justify-center transition"
                onClick={() => setQuantity(quantity + 1)}
              >+</button>
            </div>
          </div>

          <div>
            <label className="text-xs text-muted font-bold uppercase tracking-wider block mb-2">Локация</label>
            <select 
              className="input-field appearance-none"
              value={selectedLocId}
              onChange={e => setSelectedLocId(e.target.value)}
            >
              <option value="" disabled>Выберите локацию</option>
              {locations.map(loc => {
                const isCurrentProductHere = inventory.some(i => i.locationId === loc.id && i.productId === product.id);
                return (
                  <option key={loc.id} value={loc.id}>
                    {loc.code} {loc.isOccupied ? (isCurrentProductHere ? '(Текущая)' : '(Занято)') : '(Свободно)'}
                  </option>
                );
              })}
            </select>
            {type === 'outgoing' && (
              <div className="mt-2 text-xs text-muted">
                Текущий баланс: {inventory.filter(i => i.productId === product.id).reduce((a,c)=>a+c.quantity,0)} шт.
              </div>
            )}
          </div>
        </div>
      </div>

      <button onClick={handleConfirm} disabled={!selectedLocId || quantity <= 0} className={`btn-primary w-full py-4 text-lg mt-6 ${type === 'incoming' ? 'bg-primary-600 hover:bg-primary-500' : 'bg-red-600 hover:bg-red-500'}`}>
        Подтвердить {type === 'incoming' ? 'Приемку' : 'Выдачу'}
      </button>

      <style>{`
        @keyframes scan {
          0% { top: 0; }
          50% { top: 100%; }
          100% { top: 0; }
        }
      `}</style>
    </div>
  );
};
