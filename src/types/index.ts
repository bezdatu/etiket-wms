export type Location = {
  id: string;
  code: string; // e.g., R1-S2-F4-P3
  rack: string;
  sector: string;
  floor: string;
  position: string;
  isActive: boolean;
  isOccupied: boolean;
};

export type Product = {
  id: string;
  name: string;
  description: string;
  photoUrl: string;
  labelSignature: string; // Used for CV matching simulation
  barcode?: string;
  barcodes?: string[];
  ambiguityGroup?: string;
  metadata?: Record<string, string>;
  recognitionProfile?: RecognitionProfile;
};

export type InventoryBalance = {
  id: string;
  productId: string;
  locationId: string;
  quantity: number;
};

export type StockOperationType = 'incoming' | 'outgoing';

export type StockOperation = {
  id: string;
  type: StockOperationType;
  productId: string;
  locationId: string;
  quantity: number;
  confidenceScore: number;
  isUserConfirmed: boolean;
  timestamp: string;
};

export type ScanSession = {
  id: string;
  timestamp: string;
  confidenceScore: number;
  imageRef: string;
};

export type RecognitionRoiProfile = {
  id: string;
  hash: string;
  weight: number;
};

export type RecognitionProfile = {
  visualHash: string;
  roiProfiles: RecognitionRoiProfile[];
  barcodeHints: string[];
  learnedAt: string;
  referenceCount: number;
};
