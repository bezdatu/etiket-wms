import { useStore } from '../store';
import { ArrowDownRight, ArrowUpRight, Search, Calendar } from 'lucide-react';

export const History = () => {
  const { operations, products, locations } = useStore();

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-bold">История операций</h2>
      </header>
      
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-muted" />
          </div>
          <input
            type="text"
            className="input-field pl-10"
            placeholder="Поиск по товару или локации..."
          />
        </div>
        <button className="bg-slate-800 border border-slate-700 rounded-xl px-4 flex items-center text-muted hover:text-white">
          <Calendar className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-4">
        {operations.length === 0 ? (
          <div className="text-center py-12 text-muted">
            История пуста
          </div>
        ) : (
          operations.map(op => {
            const product = products.find(p => p.id === op.productId);
            const location = locations.find(l => l.id === op.locationId);
            const isIncoming = op.type === 'incoming';
            const date = new Date(op.timestamp);

            return (
              <div key={op.id} className="card p-4">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${isIncoming ? 'bg-primary-500/20 text-primary-500' : 'bg-red-500/20 text-red-500'}`}>
                      {isIncoming ? <ArrowDownRight size={24} /> : <ArrowUpRight size={24} />}
                    </div>
                    <div>
                      <h4 className="font-bold">{product?.name || 'Неизвестный товар'}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs bg-slate-800 border border-slate-700 px-2 py-0.5 rounded text-muted">
                          {location?.code || 'Неизвестно'}
                        </span>
                        {op.confidenceScore < 0.8 && (
                          <span className="text-[10px] text-orange-400 border border-orange-500/30 px-1.5 py-0.5 rounded">
                            Уверенность: {(op.confidenceScore * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-xl font-bold ${isIncoming ? 'text-primary-500' : 'text-red-500'}`}>
                      {isIncoming ? '+' : '-'}{op.quantity}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between items-center text-xs text-muted mt-4 pt-3 border-t border-slate-700/50">
                  <span>{date.toLocaleDateString()} в {date.toLocaleTimeString()}</span>
                  <span>{isIncoming ? 'Приемка' : 'Выдача'}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
