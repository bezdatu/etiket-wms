import { useState } from 'react';
import { useStore } from '../store';
import { Search, Filter, Package } from 'lucide-react';

export const Catalog = () => {
  const { products, inventory, locations } = useStore();
  const [search, setSearch] = useState('');

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    (p.barcode && p.barcode.includes(search))
  );

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-bold">Каталог и остатки</h2>
      </header>

      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-muted" />
        </div>
        <input
          type="text"
          className="input-field pl-10"
          placeholder="Поиск по названию или штрихкоду..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted hover:text-white">
          <Filter className="h-5 w-5" />
        </button>
      </div>

      <div className="grid gap-4">
        {filteredProducts.map(product => {
          const productInventory = inventory.filter(i => i.productId === product.id);
          const totalQty = productInventory.reduce((acc, curr) => acc + curr.quantity, 0);

          return (
            <div key={product.id} className="card p-0 overflow-hidden flex flex-col md:flex-row">
              <div className="h-40 md:h-auto md:w-32 bg-slate-800 flex-shrink-0 relative">
                {product.photoUrl ? (
                  <img src={product.photoUrl} alt={product.name} className="w-full h-full object-cover opacity-80" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Package className="text-slate-600" size={40} />
                  </div>
                )}
              </div>
              <div className="p-4 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start">
                    <h3 className="font-bold text-lg leading-tight">{product.name}</h3>
                    <div className="bg-primary-500/20 text-primary-400 px-2 py-1 rounded text-xs font-bold">
                      {totalQty} шт
                    </div>
                  </div>
                  <p className="text-sm text-muted mt-1 line-clamp-2">{product.description}</p>
                </div>
                
                <div className="mt-4 pt-4 border-t border-slate-700/50">
                  <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Локации:</h4>
                  {productInventory.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {productInventory.map(inv => {
                        const loc = locations.find(l => l.id === inv.locationId);
                        return (
                          <div key={inv.id} className="bg-slate-800 px-2 py-1 rounded border border-slate-700 text-xs flex gap-2">
                            <span className="text-white font-medium">{loc?.code}</span>
                            <span className="text-muted">{inv.quantity} шт</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-xs text-red-400">Нет на складе</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {filteredProducts.length === 0 && (
          <div className="text-center py-12 text-muted">
            Товары не найдены
          </div>
        )}
      </div>
    </div>
  );
};
