import { useState } from 'react';
import { useStore } from '../store';
import { MapPin, Search, Plus, Trash2 } from 'lucide-react';
import { Location } from '../types';

export const Locations = () => {
  const { locations, addLocation } = useStore();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newLoc, setNewLoc] = useState({ rack: '', sector: '', floor: '', position: '' });

  const filteredLocations = locations.filter(l => l.code.toLowerCase().includes(search.toLowerCase()));

  const handleCreate = () => {
    if (!newLoc.rack || !newLoc.sector || !newLoc.floor || !newLoc.position) return;
    const code = `R${newLoc.rack}-S${newLoc.sector}-F${newLoc.floor}-P${newLoc.position}`;
    const location: Location = {
      id: `loc_${Date.now()}`,
      code,
      rack: newLoc.rack,
      sector: newLoc.sector,
      floor: newLoc.floor,
      position: newLoc.position,
      isActive: true,
      isOccupied: false
    };
    addLocation(location);
    setNewLoc({ rack: '', sector: '', floor: '', position: '' });
    setShowAdd(false);
  };

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Локации</h2>
        <button 
          onClick={() => setShowAdd(!showAdd)}
          className="bg-primary-600 hover:bg-primary-500 text-white p-2 rounded-xl transition-colors"
        >
          <Plus size={24} />
        </button>
      </header>

      {showAdd && (
        <div className="card space-y-4">
          <h3 className="font-semibold text-lg border-b border-slate-700/50 pb-2">Новая локация (R-S-F-P)</h3>
          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className="text-xs text-muted mb-1 block">Rack (R)</label>
              <input type="text" className="input-field py-2" value={newLoc.rack} onChange={e => setNewLoc({...newLoc, rack: e.target.value})} placeholder="1" />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">Sector (S)</label>
              <input type="text" className="input-field py-2" value={newLoc.sector} onChange={e => setNewLoc({...newLoc, sector: e.target.value})} placeholder="2" />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">Floor (F)</label>
              <input type="text" className="input-field py-2" value={newLoc.floor} onChange={e => setNewLoc({...newLoc, floor: e.target.value})} placeholder="4" />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">Pos (P)</label>
              <input type="text" className="input-field py-2" value={newLoc.position} onChange={e => setNewLoc({...newLoc, position: e.target.value})} placeholder="3" />
            </div>
          </div>
          <button onClick={handleCreate} className="btn-primary w-full py-2">
            Добавить
          </button>
        </div>
      )}

      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-muted" />
        </div>
        <input
          type="text"
          className="input-field pl-10"
          placeholder="Поиск по коду (напр. R1-S2)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-3">
        {filteredLocations.map(loc => (
          <div key={loc.id} className="card p-4 flex justify-between items-center">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-full ${loc.isOccupied ? 'bg-orange-500/20 text-orange-500' : 'bg-primary-500/20 text-primary-500'}`}>
                <MapPin size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold font-mono tracking-wider">{loc.code}</h3>
                <span className={`text-xs font-semibold uppercase tracking-wider ${loc.isOccupied ? 'text-orange-400' : 'text-primary-400'}`}>
                  {loc.isOccupied ? 'Занято' : 'Свободно'}
                </span>
              </div>
            </div>
            <button className="text-muted hover:text-red-500 p-2">
              <Trash2 size={20} />
            </button>
          </div>
        ))}
        {filteredLocations.length === 0 && (
          <div className="text-center py-12 text-muted">Не найдено</div>
        )}
      </div>
    </div>
  );
};
