export type SystemType = 'VRF' | 'Package' | 'DuctableSplit';

export interface IDUSelection {
  modelId: string;
  brand: string;
  modelSeries: string;
  subType: string;
  trCapacity: number;
  cfmRated: number;
}

export interface ODUSelection {
  modelId: string;
  brand: string;
  modelSeries: string;
  trCapacity: number;
  dischargeType?: 'top' | 'side';
  compressorType?: 'heat-pump' | 'cooling-only';
}

export interface SingleUnitSelection {
  modelId: string;
  brand: string;
  modelSeries: string;
  subType?: string;
  trCapacity: number;
  cfmRated: number;
}

export interface EquipmentSystem {
  id: string;
  name: string;
  type: SystemType;
  packageSubType?: 'air-cooled' | 'water-cooled';
  brand: string | null;
  brandLocked: boolean;
  diversityFactor: number;
  assignedRoomIds: string[];
  iduSelections: Record<string, IDUSelection>;
  oduSelection: ODUSelection | null;
  unitSelection: SingleUnitSelection | null;
  notes?: string;
  createdAt?: any;
  updatedAt?: any;
}
