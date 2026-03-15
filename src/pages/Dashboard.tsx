import { useStore } from '../store';
import { Package, MapPin, ArrowDownRight, ArrowUpRight, BarChart3 } from 'lucide-react';

export const Dashboard = () => {
  const { products, locations, inventory, operations } = useStore();

  const totalProducts = products.length;
  const totalItems = inventory.reduce((acc, curr) => acc + curr.quantity, 0);
  const occupiedLocations = locations.filter(l => l.isOccupied).length;
  
  const recentOperations = operations.slice(0, 5);

  return (
    <div className="space-y-6 pb-20">
      <header className="mb-6">
        <h2 className="text-2xl font-bold">Сводка</h2>
        <p className="text-muted text-sm">Ключевые показатели склада</p>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <div className="card flex flex-col items-center justify-center p-6 bg-gradient-to-br from-slate-800 to-slate-900">
          <Package className="text-primary-500 mb-2" size={32} />
          <span className="text-3xl font-bold">{totalItems}</span>
          <span className="text-xs text-muted uppercase tracking-wider mt-1">Всего единиц</span>
        </div>
        <div className="card flex flex-col items-center justify-center p-6 bg-gradient-to-br from-slate-800 to-slate-900">
          <BarChart3 className="text-blue-500 mb-2" size={32} />
          <span className="text-3xl font-bold">{totalProducts}</span>
          <span className="text-xs text-muted uppercase tracking-wider mt-1">Видов товаров</span>
        </div>
        <div className="card flex flex-col items-center justify-center p-6 bg-gradient-to-br from-slate-800 to-slate-900">
          <MapPin className="text-orange-500 mb-2" size={32} />
          <span className="text-3xl font-bold">{occupiedLocations} / {locations.length}</span>
          <span className="text-xs text-muted uppercase tracking-wider mt-1">Занято мест</span>
        </div>
        <div className="card flex flex-col items-center justify-center p-6 bg-gradient-to-br from-slate-800 to-slate-900">
          <ArrowDownRight className="text-primary-500 mb-2" size={32} />
          <span className="text-3xl font-bold">{operations.filter(o => o.type === 'incoming').length}</span>
          <span className="text-xs text-muted uppercase tracking-wider mt-1">Приемок</span>
        </div>
      </div>

      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-4">Последние операции</h3>
        <div className="space-y-3">
          {recentOperations.length === 0 ? (
            <p className="text-muted text-center py-8">Операций пока нет</p>
          ) : (
            recentOperations.map(op => {
              const product = products.find(p => p.id === op.productId);
              const location = locations.find(l => l.id === op.locationId);
              const isIncoming = op.type === 'incoming';
              
              return (
                <div key={op.id} className="card p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-full ${isIncoming ? 'bg-primary-500/20 text-primary-500' : 'bg-red-500/20 text-red-500'}`}>
                      {isIncoming ? <ArrowDownRight size={20} /> : <ArrowUpRight size={20} />}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{product?.name || 'Неизвестный товар'}</p>
                      <p className="text-xs text-muted">{location?.code}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-bold ${isIncoming ? 'text-primary-500' : 'text-red-500'}`}>
                      {isIncoming ? '+' : '-'}{op.quantity}
                    </p>
                    <p className="text-[10px] text-muted">{new Date(op.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
