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
        <span className="text-2xl font-bold">Принять товар</span>
      </button>

      <button 
        onClick={() => navigate('camera', { state: { type: 'outgoing' } })}
        className="w-full card p-8 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-red-900/50 to-red-800/20 border-red-500/30 hover:border-red-500 transition-colors"
      >
        <div className="bg-red-500 text-white p-4 rounded-full">
          <ArrowRight className="transform -rotate-90" size={32} />
        </div>
        <span className="text-2xl font-bold">Выдать товар</span>
      </button>
    </div>
  );
};

// 2. CAMERA CAPTURE
const CameraCapture = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const opType = location.state?.type || 'incoming';
  const { products } = useStore();
  
  const [isScanning, setIsScanning] = useState(false);
  const webcamRef = useRef<Webcam>(null);

  const handleScan = useCallback(async () => {
    setIsScanning(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const randomProduct = products[Math.floor(Math.random() * products.length)];
    const confidence = Math.random() > 0.3 ? (0.95 + Math.random() * 0.04) : (0.4 + Math.random() * 0.3);
    const imageSrc = webcamRef.current?.getScreenshot();
    
    navigate('/scan/result', { 
      state: { 
        type: opType, 
        prediction: randomProduct, 
        confidence,
        capturedPhoto: imageSrc
      } 
    });
  }, [navigate, opType, products]);

  return (
    <div className="h-[80vh] flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">{opType === 'incoming' ? 'Приёмка' : 'Выдача'}</h2>
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

// numeric sort helper
const numSort = (a: string, b: string) => {
  const na = parseInt(a.replace(/\D/g, '')) || 0;
  const nb = parseInt(b.replace(/\D/g, '')) || 0;
  return na - nb;
};

// 3. SCAN RESULT & CONFIRMATION
const ScanResult = () => {
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const locationState = routerLocation.state;
  const { locations, inventory, recordOperation, updateProduct } = useStore();
  
  if (!locationState) {
    navigate('/scan');
    return null;
  }

  const { type, prediction, confidence, capturedPhoto } = locationState;
  const product: Product = prediction;
  const isHighConfidence = confidence >= 0.95;
  const totalBalance = inventory.filter(i => i.productId === product.id).reduce((a, c) => a + c.quantity, 0);
  const isOutOfStock = type === 'outgoing' && totalBalance === 0;

  const [quantity, setQuantity] = useState(1);
  const [manualMode, setManualMode] = useState(false);
  const [rack, setRack] = useState('');
  const [sector, setSector] = useState('');
  const [floor, setFloor] = useState('');
  const [pos, setPos] = useState('');

  // Auto-suggest best location
  useEffect(() => {
    let targetLocId = '';
    const productInv = inventory.filter(i => i.productId === product.id && i.quantity > 0);
    if (productInv.length > 0) {
      // For outgoing, pick the location with this product
      targetLocId = productInv[0].locationId;
    } else if (type === 'incoming') {
      // For incoming, pick the first completely empty location
      const freeLoc = locations.find(l => {
        return !inventory.some(i => i.locationId === l.id && i.quantity > 0);
      });
      if (freeLoc) targetLocId = freeLoc.id;
    }

    if (targetLocId) {
      const tLoc = locations.find(l => l.id === targetLocId);
      if (tLoc) {
        setRack(tLoc.rack);
        setSector(tLoc.sector);
        setFloor(tLoc.floor);
        setPos(tLoc.position);
      }
    }
  }, [product.id, inventory, locations, type]);

  const selectedLoc = locations.find(l => l.rack === rack && l.sector === sector && l.floor === floor && l.position === pos);
  const selectedLocId = selectedLoc?.id || '';
  const selectedLocCode = selectedLoc?.code || '';

  const handleConfirm = () => {
    if (!selectedLocId || quantity <= 0) return;

    // Save photo to product template on first incoming scan
    if (type === 'incoming' && !product.photoUrl && capturedPhoto) {
      updateProduct(product.id, { photoUrl: capturedPhoto });
    }

    recordOperation({
      id: `op_${Date.now()}`,
      type,
      productId: product.id,
      locationId: selectedLocId,
      quantity,
      confidenceScore: confidence,
      isUserConfirmed: true,
      timestamp: new Date().toISOString()
    });
    navigate('/history');
  };

  const allRacks = Array.from(new Set(locations.map(l => l.rack))).sort(numSort);
  const sectorsForRack = Array.from(new Set(locations.filter(l => l.rack === rack).map(l => l.sector))).sort(numSort);
  const floorsForSector = Array.from(new Set(locations.filter(l => l.rack === rack && l.sector === sector).map(l => l.floor))).sort(numSort);
  const positionsForFloor = locations.filter(l => l.rack === rack && l.sector === sector && l.floor === floor).sort((a, b) => numSort(a.position, b.position));

  return (
    <div className="space-y-6 pb-20">
      <header className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Подтверждение</h2>
        <button
          onClick={() => navigate('/scan/camera', { state: { type } })}
          className="text-primary-500 flex items-center text-sm font-semibold"
        >
          <ScanLine size={16} className="mr-1" /> Пересканировать
        </button>
      </header>

      {/* Confidence badge */}
      <div className={`p-4 rounded-xl flex items-start gap-3 ${isHighConfidence ? 'bg-primary-500/10 border border-primary-500/30' : 'bg-orange-500/10 border border-orange-500/30'}`}>
        {isHighConfidence ? <CheckCircle2 className="text-primary-500 mt-0.5" /> : <AlertTriangle className="text-orange-500 mt-0.5" />}
        <div>
          <p className={`font-bold ${isHighConfidence ? 'text-primary-500' : 'text-orange-400'}`}>
            {isHighConfidence ? 'Распознано успешно' : 'Низкая уверенность'} ({(confidence * 100).toFixed(0)}%)
          </p>
          {!isHighConfidence && (
            <p className="text-xs text-muted mt-1">Проверьте результат — этикетки могут быть очень похожи.</p>
          )}
        </div>
      </div>

      {/* Product card */}
      <div className="card p-4">
        <div className="flex gap-4 mb-4">
          <div className="w-24 h-24 bg-slate-800 rounded-lg overflow-hidden flex-shrink-0">
            {product.photoUrl ? (
              <img src={product.photoUrl} alt="" className="w-full h-full object-cover" />
            ) : capturedPhoto ? (
              <img src={capturedPhoto} alt="Скан" className="w-full h-full object-cover" />
            ) : <Package className="m-auto mt-6 text-slate-600" size={40} />}
          </div>
          <div>
            <h3 className="text-xl font-bold leading-tight">{product.name}</h3>
            <p className="text-sm text-muted mt-1">{product.description}</p>
            {product.barcode && (
              <p className="text-xs font-mono bg-slate-800 px-2 py-1 mt-2 rounded inline-block">B/C: {product.barcode}</p>
            )}
          </div>
        </div>
        
        <div className="border-t border-slate-700/50 pt-4 mt-4 space-y-4">
          {isOutOfStock ? (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-center">
              <p className="text-red-500 font-bold">Данного товара нет на складе</p>
            </div>
          ) : (
            <>
              {/* Quantity */}
              <div>
                <label className="text-xs text-muted font-bold uppercase tracking-wider block mb-2">
                  Количество ({type === 'incoming' ? 'Принять' : 'Выдать'})
                </label>
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

              {/* Location */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs text-muted font-bold uppercase tracking-wider">Локация</label>
                  <button
                    className="text-xs text-primary-400 hover:text-primary-300 font-medium transition"
                    onClick={() => setManualMode(m => !m)}
                  >
                    {manualMode ? '← Авто-подбор' : '✎ Выбрать вручную'}
                  </button>
                </div>

                {!manualMode ? (
                  /* AUTO: show suggested location as badge */
                  <div className="p-3 bg-slate-800 rounded-xl border border-slate-600 flex items-center justify-between min-h-[52px]">
                    {selectedLocCode ? (
                      <>
                        <span className="font-mono text-lg font-bold text-primary-400">{selectedLocCode}</span>
                        <span className="text-xs bg-primary-500/20 text-primary-400 px-2 py-0.5 rounded-full">
                          {totalBalance > 0 ? (type === 'incoming' ? 'Текущий склад' : 'Забрать отсюда') : 'Свободная ячейка'}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted text-sm italic">Нет свободных ячеек</span>
                    )}
                  </div>
                ) : (
                  /* MANUAL: cascading 4-level picker */
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      className="input-field appearance-none py-2 px-3 text-sm"
                      value={rack}
                      onChange={e => { setRack(e.target.value); setSector(''); setFloor(''); setPos(''); }}
                    >
                      <option value="" disabled>Регал (R)</option>
                      {allRacks.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>

                    <select
                      className="input-field appearance-none py-2 px-3 text-sm"
                      value={sector}
                      onChange={e => { setSector(e.target.value); setFloor(''); setPos(''); }}
                      disabled={!rack}
                    >
                      <option value="" disabled>Секция (S)</option>
                      {sectorsForRack.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>

                    <select
                      className="input-field appearance-none py-2 px-3 text-sm"
                      value={floor}
                      onChange={e => { setFloor(e.target.value); setPos(''); }}
                      disabled={!sector}
                    >
                      <option value="" disabled>Этаж (F)</option>
                      {floorsForSector.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>

                    <select
                      className="input-field appearance-none py-2 px-3 text-sm"
                      value={pos}
                      onChange={e => setPos(e.target.value)}
                      disabled={!floor}
                    >
                      <option value="" disabled>Место (P)</option>
                      {positionsForFloor.map(p => {
                        const locInv = inventory.filter(i => i.locationId === p.id && i.quantity > 0);
                        const isCurrent = locInv.some(i => i.productId === product.id);
                        const isOther = locInv.some(i => i.productId !== product.id);
                        const isDisabled = type === 'incoming' && isOther;
                        return (
                          <option key={p.id} value={p.position} disabled={isDisabled}>
                            {p.position}{isCurrent ? ' ✓' : isOther ? ' ✗' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}

                {type === 'outgoing' && (
                  <div className="mt-2 text-xs text-muted">
                    Текущий баланс: {totalBalance} шт.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <button
        onClick={handleConfirm}
        disabled={isOutOfStock || !selectedLocId || quantity <= 0 || !isHighConfidence}
        className={`btn-primary w-full py-4 text-lg mt-6 ${
          type === 'incoming' ? 'bg-primary-600 hover:bg-primary-500' : 'bg-red-600 hover:bg-red-500'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        Подтвердить {type === 'incoming' ? 'Приёмку' : 'Выдачу'}
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
