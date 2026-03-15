import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Product, Location, InventoryBalance, StockOperation } from '../types';

interface AppState {
  products: Product[];
  locations: Location[];
  inventory: InventoryBalance[];
  operations: StockOperation[];
  
  // Actions
  addProduct: (product: Product) => void;
  updateProduct: (id: string, product: Partial<Product>) => void;
  addLocation: (location: Location) => void;
  updateLocation: (id: string, location: Partial<Location>) => void;
  recordOperation: (operation: StockOperation) => void;
  resetDate: () => void;
}

const generateLocations = (): Location[] => {
  const locs: Location[] = [];
  let idCounter = 1;
  for (let r = 1; r <= 10; r++) {
    for (let s = 1; s <= 10; s++) {
      for (let f = 1; f <= 5; f++) {
        for (let p = 1; p <= 3; p++) {
          const rack = `R${r}`;
          const sector = `S${s}`;
          const floor = `F${f}`;
          const position = `P${p}`;
          locs.push({
            id: `loc_${idCounter++}`,
            code: `${rack}-${sector}-${floor}-${position}`,
            rack,
            sector,
            floor,
            position,
            isActive: true,
            isOccupied: false
          });
        }
      }
    }
  }
  return locs;
};

const initialLocations: Location[] = generateLocations();

const initialProducts: Product[] = [
  { 
    id: 'prod_1', 
    name: 'Industrial Widget A', 
    description: 'A heavy-duty industrial widget.', 
    photoUrl: '', // Will be populated on first incoming scan
    labelSignature: 'sig_a' 
  },
  { 
    id: 'prod_2', 
    name: 'Industrial Widget B', 
    description: 'Looks very similar to A but has different threading.', 
    photoUrl: '', // Will be populated on first incoming scan
    labelSignature: 'sig_b' 
  },
];

// Initial demo inventory — loc_1 = R1-S1-F1-P1
const initialInventory: InventoryBalance[] = [
  { id: 'inv_1', productId: 'prod_1', locationId: 'loc_1', quantity: 50 },
];

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      products: initialProducts,
      locations: initialLocations,
      inventory: initialInventory,
      operations: [],
      
      addProduct: (product: Product) => set((state: AppState) => ({ products: [...state.products, product] })),
      updateProduct: (id: string, data: Partial<Product>) => set((state: AppState) => ({
        products: state.products.map((p: Product) => p.id === id ? { ...p, ...data } : p)
      })),
      addLocation: (location: Location) => set((state: AppState) => ({ locations: [...state.locations, location] })),
      updateLocation: (id: string, Object: Partial<Location>) => set((state: AppState) => ({
        locations: state.locations.map((l: Location) => l.id === id ? { ...l, ...Object } : l)
      })),
      recordOperation: (operation: StockOperation) => set((state: AppState) => {
        // Handle inventory math
        const newInventory = [...state.inventory];
        const existingIdx = newInventory.findIndex((i: InventoryBalance) => i.productId === operation.productId && i.locationId === operation.locationId);
        
        if (operation.type === 'incoming') {
          if (existingIdx >= 0) {
            newInventory[existingIdx].quantity += operation.quantity;
          } else {
            newInventory.push({
              id: `inv_${Date.now()}`,
              productId: operation.productId,
              locationId: operation.locationId,
              quantity: operation.quantity
            });
          }
        } else if (operation.type === 'outgoing') {
          if (existingIdx >= 0) {
            newInventory[existingIdx].quantity -= operation.quantity;
            // Remove if 0
            if (newInventory[existingIdx].quantity <= 0) {
              newInventory.splice(existingIdx, 1);
            }
          }
        }

        // Update location occupancy (no longer just boolean, we derive it from inventory in UI, but keep for compatibility)
        const newLocations = state.locations.map((loc: Location) => {
          const isLocOccupied = newInventory.some((inv: InventoryBalance) => inv.locationId === loc.id && inv.quantity > 0);
          return { ...loc, isOccupied: isLocOccupied };
        });

        return {
          inventory: newInventory,
          locations: newLocations,
          operations: [operation, ...state.operations]
        };
      }),
      resetDate: () => set({
        products: initialProducts,
        locations: initialLocations,
        inventory: initialInventory,
        operations: []
      })
    }),
    {
      name: 'etiket-storage-v2',  // bumped: forces fresh load of new 1500-location structure
    }
  )
);
