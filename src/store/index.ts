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

const initialLocations: Location[] = [
  { id: 'loc_1', code: 'R1-S2-F4-P3', rack: 'R1', sector: 'S2', floor: 'F4', position: 'P3', isActive: true, isOccupied: false },
  { id: 'loc_2', code: 'R1-S2-F4-P4', rack: 'R1', sector: 'S2', floor: 'F4', position: 'P4', isActive: true, isOccupied: true },
];

const initialProducts: Product[] = [
  { 
    id: 'prod_1', 
    name: 'Industrial Widget A', 
    description: 'A heavy-duty industrial widget.', 
    photoUrl: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&q=80&w=200', 
    labelSignature: 'sig_a' 
  },
  { 
    id: 'prod_2', 
    name: 'Industrial Widget B', 
    description: 'Looks very similar to A but has different threading.', 
    photoUrl: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&q=80&w=200', 
    labelSignature: 'sig_b' 
  },
];

const initialInventory: InventoryBalance[] = [
  { id: 'inv_1', productId: 'prod_1', locationId: 'loc_2', quantity: 50 },
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

        // Update location occupancy
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
      name: 'etiket-storage',
    }
  )
);
