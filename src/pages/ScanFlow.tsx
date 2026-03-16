import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, Routes, Route, useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { Camera, CheckCircle2, ArrowRight, X, Package, ScanLine } from 'lucide-react';
import { Product } from '../types';
import Webcam from 'react-webcam';

// --- Visual Identification Utilities ---

/**
 * Generates a Difference Hash (dHash) from a canvas/image.
 * Robust to lighting and contrast changes.
 * 1. Precision crop to recognition zone (center square).
 * 2. Resize to 9x8.
 * 3. Grayscale.
 * 4. Compare horizontally (adjacent pixels).
 */
const getVisualHash = (imageSrc: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // 1. CROP: The scanner guide is a 64x64px box centered in a (~80vh) container.
      // We take the center 50% square of the image to be safe.
      const cropSize = Math.min(img.width, img.height) * 0.5;
      const x = (img.width - cropSize) / 2;
      const y = (img.height - cropSize) / 2;

      const sizeW = 9;
      const sizeH = 8;
      const canvas = document.createElement('canvas');
      canvas.width = sizeW;
      canvas.height = sizeH;
      const ctx = canvas.getContext('2d')!;
      
      // Draw cropped and resized
      ctx.drawImage(img, x, y, cropSize, cropSize, 0, 0, sizeW, sizeH);
      const data = ctx.getImageData(0, 0, sizeW, sizeH).data;
      
      const grayscale = new Uint8Array(sizeW * sizeH);
      for (let i = 0; i < data.length; i += 4) {
        grayscale[i/4] = (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114);
      }
      
      let hash = "";
      for (let row = 0; row < sizeH; row++) {
        for (let col = 0; col < sizeW - 1; col++) {
          const left = grayscale[row * sizeW + col];
          const right = grayscale[row * sizeW + col + 1];
          hash += left > right ? "1" : "0";
        }
      }
      resolve(hash);
    };
    img.src = imageSrc;
  });
};

/**
 * Calculates Hamming distance between two binary hash strings.
 */
const getHammingDistance = (h1: string, h2: string): number => {
  if (!h1 || !h2 || h1.length !== h2.length) return 1.0;
  let dist = 0;
  for (let i = 0; i < h1.length; i++) {
    if (h1[i] !== h2[i]) dist++;
  }
  return dist / h1.length;
};

// --- Components ---

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
  
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const webcamRef = useRef<Webcam>(null);

  const { products } = useStore();

  const handleScan = useCallback(async () => {
    setIsScanning(true);
    setScanStatus('Захват изображения...');

    const imageSrc = webcamRef.current?.getScreenshot();
    if (!imageSrc) {
      setIsScanning(false);
      setScanStatus('');
      return;
    }

    setScanStatus('Распознавание...');

    try {
      // Precision hash using center crop
      const currentHash = await getVisualHash(imageSrc);
      console.log('Generated hash:', currentHash);
      
      let bestMatch = null;
      let minDistance = 1.0;
      const THRESHOLD = 0.22; // ~22% difference allowed for dHash (more flexible)

      for (const p of products) {
        if (!p.labelSignature) continue;
        const dist = getHammingDistance(currentHash, p.labelSignature);
        console.log(`Checking match for ${p.name}: dist=${dist.toFixed(3)}`);
        if (dist < minDistance) {
          minDistance = dist;
          bestMatch = p;
        }
      }

      const isMatch = bestMatch && minDistance < THRESHOLD;
      const confidence = isMatch ? (1 - (minDistance / THRESHOLD)) * 0.5 + 0.5 : 0.5;

      const resultProduct: Product = isMatch ? bestMatch : {
        id: `prod_${Date.now()}`,
        name: '',
        description: '',
        photoUrl: '',
        labelSignature: currentHash
      };

      navigate('/scan/result', {
        state: {
          type: opType,
          prediction: resultProduct,
          confidence,
          capturedPhoto: imageSrc,
          isNewProduct: !isMatch
        }
      } as any);
    } catch (err) {
      console.error('Scan error:', err);
      setIsScanning(false);
      setScanStatus('Ошибка');
    }
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

      <div className="mt-6 flex flex-col items-center pb-8 gap-3">
        <button 
          onClick={handleScan}
          disabled={isScanning}
          className="w-20 h-20 bg-primary-600 rounded-full flex items-center justify-center shadow-lg shadow-primary-500/30 border-4 border-slate-800 ring-4 ring-primary-500/50 active:scale-95 transition-all disabled:opacity-50"
        >
          <Camera size={32} className="text-white" />
        </button>
        {scanStatus && (
          <p className="text-sm text-primary-400 animate-pulse font-medium">{scanStatus}</p>
        )}
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
  const { locations, inventory, recordOperation, updateProduct, addProduct } = useStore();
  
  if (!locationState) {
    navigate('/scan');
    return null;
  }

  const { type, prediction, confidence, capturedPhoto, isNewProduct } = locationState;
  const product: Product = prediction;
  const totalBalance = inventory.filter(i => i.productId === product.id).reduce((a, c) => a + c.quantity, 0);
  const isOutOfStock = type === 'outgoing' && totalBalance === 0;

  const [quantity, setQuantity] = useState(1);
  const [manualMode, setManualMode] = useState(false);
  const [editName, setEditName] = useState(product.name);
  const [editDesc, setEditDesc] = useState(product.description);
  const [rack, setRack] = useState('');
  const [sector, setSector] = useState('');
  const [floor, setFloor] = useState('');
  const [pos, setPos] = useState('');

  // Auto-suggest best location
  useEffect(() => {
    let targetLocId = '';
    const productInv = inventory.filter(i => i.productId === product.id && i.quantity > 0);
    
    if (type === 'outgoing') {
      // For outgoing, pick the location with this product
      if (productInv.length > 0) {
        targetLocId = productInv[0].locationId;
      }
    } else if (type === 'incoming') {
      // For incoming: 
      // 1. If we already have this product in stock, suggest SAME location to group them
      if (productInv.length > 0) {
        targetLocId = productInv[0].locationId;
      } else {
        // 2. If new product or not in stock, pick first COMPLETELY empty location
        const freeLoc = locations.find(l => {
          return !inventory.some(i => i.locationId === l.id && i.quantity > 0);
        });
        if (freeLoc) targetLocId = freeLoc.id;
      }
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

  const [barcode, setBarcode] = useState(product.barcode || '');

  const canConfirm = editName.trim().length > 0 && selectedLocId && quantity > 0;

  const handleConfirm = () => {
    if (!canConfirm) return;

    if (isNewProduct) {
      addProduct({ ...product, name: editName, description: editDesc, barcode });
    }

    // Update product info on incoming scan
    if (type === 'incoming') {
      updateProduct(product.id, { 
        name: editName,
        description: editDesc,
        barcode,
        photoUrl: capturedPhoto || product.photoUrl 
      });
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

      {/* Verification status */}
      <div className={`p-4 rounded-xl flex items-start gap-3 bg-primary-500/10 border border-primary-500/30`}>
        <CheckCircle2 className="text-primary-500 mt-0.5" />
        <div>
          <p className={`font-bold text-primary-500`}>
            Захват фото выполнен
          </p>
          <p className="text-xs text-muted mt-1">Введите данные товара вручную ниже.</p>
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
          <div className="flex-1 space-y-4">
            <div>
              <label className="text-[10px] text-primary-400 font-bold uppercase tracking-widest mb-1.5 block">Название товара *</label>
              <input 
                placeholder="Напр: Oreo Original 228g"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full bg-slate-900/50 border border-slate-700/50 rounded-lg px-3 py-2 text-base font-bold focus:border-primary-500 focus:bg-slate-900 outline-none transition-all placeholder:text-slate-600"
              />
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="text-[10px] text-muted font-bold uppercase tracking-widest mb-1.5 block">Штрих-код / Артикул</label>
                <input 
                  placeholder="000000000000"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  className="w-full bg-slate-900/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm font-mono focus:border-primary-500 focus:bg-slate-900 outline-none transition-all placeholder:text-slate-600"
                />
              </div>
              
              <div>
                <label className="text-[10px] text-muted font-bold uppercase tracking-widest mb-1.5 block">Описание</label>
                <textarea 
                  placeholder="Дополнительная информация..."
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={2}
                  className="w-full bg-slate-900/50 border border-slate-700/50 rounded-lg px-3 py-2 text-xs text-muted focus:border-primary-500 focus:bg-slate-900 outline-none transition-all placeholder:text-slate-600 resize-none"
                />
              </div>
            </div>
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

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-slate-900/80 backdrop-blur-lg border-t border-slate-800 safe-bottom">
        <button
          onClick={handleConfirm}
          disabled={isOutOfStock || !canConfirm}
          className={`w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95 ${
            canConfirm && !isOutOfStock
            ? (type === 'incoming' ? 'bg-gradient-to-r from-primary-600 to-primary-500' : 'bg-gradient-to-r from-red-600 to-red-500') + ' text-white shadow-primary-500/20' 
            : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-50'
          }`}
        >
          {type === 'incoming' ? <ArrowRight size={24} /> : <ArrowRight className="transform -rotate-180" size={24} />}
          Подтвердить {type === 'incoming' ? 'Приёмку' : 'Выдачу'}
        </button>
      </div>

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
