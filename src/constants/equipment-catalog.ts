
export interface EquipmentModel {
  id: string;
  brand: 'Blue Star' | 'Voltas' | 'Samsung' | 'Fujitsu';
  type: 'Chiller' | 'VRF' | 'Package' | 'Split' | 'FCU' | 'Pump';
  subType?: string;
  modelSeries: string;
  capacityTR: number;
  capacityBTU: number;
  ratedAirflowCFM?: number;
  refrigerant?: string;
  powerInputKW?: number;
  eer?: number;
  cop?: number;
  description?: string;
}

export const EQUIPMENT_CATALOG: EquipmentModel[] = [
  // BLUE STAR - CHILLERS
  { id: 'bs-ch-1', brand: 'Blue Star', type: 'Chiller', subType: 'Air Cooled Scroll', modelSeries: 'LC Series', capacityTR: 10, ratedAirflowCFM: 4000, capacityBTU: 120000, refrigerant: 'R410A' },
  { id: 'bs-ch-2', brand: 'Blue Star', type: 'Chiller', subType: 'Air Cooled Scroll', modelSeries: 'LC Series', capacityTR: 20, ratedAirflowCFM: 8000, capacityBTU: 240000, refrigerant: 'R410A' },
  { id: 'bs-ch-3', brand: 'Blue Star', type: 'Chiller', subType: 'Air Cooled Screw', modelSeries: 'NS Series', capacityTR: 50, ratedAirflowCFM: 20000, capacityBTU: 600000, refrigerant: 'R134a' },
  { id: 'bs-ch-4', brand: 'Blue Star', type: 'Chiller', subType: 'Water Cooled Screw', modelSeries: 'WW Series', capacityTR: 100, ratedAirflowCFM: 40000, capacityBTU: 1200000, refrigerant: 'R134a' },

  // BLUE STAR - VRF
  { id: 'bs-vrf-1', brand: 'Blue Star', type: 'VRF', subType: 'Outdoor Unit', modelSeries: 'VRF V Plus', capacityTR: 8, ratedAirflowCFM: 3200, capacityBTU: 96000 },
  { id: 'bs-vrf-2', brand: 'Blue Star', type: 'VRF', subType: 'Outdoor Unit', modelSeries: 'VRF V Plus', capacityTR: 12, ratedAirflowCFM: 4800, capacityBTU: 144000 },
  { id: 'bs-vrf-3', brand: 'Blue Star', type: 'VRF', subType: 'Indoor Unit', modelSeries: 'Hi-Wall Inverter', capacityTR: 1.5, ratedAirflowCFM: 600, capacityBTU: 18000 },
  { id: 'bs-vrf-4', brand: 'Blue Star', type: 'VRF', subType: 'Indoor Unit', modelSeries: '4-Way Cassette', capacityTR: 2.0, ratedAirflowCFM: 800, capacityBTU: 24000 },

  // VOLTAS - CHILLERS
  { id: 'vo-ch-1', brand: 'Voltas', type: 'Chiller', subType: 'Air Cooled Scroll', modelSeries: 'V-Scroll', capacityTR: 15, ratedAirflowCFM: 6000, capacityBTU: 180000 },
  { id: 'vo-ch-2', brand: 'Voltas', type: 'Chiller', subType: 'Air Cooled Screw', modelSeries: 'V-Screw', capacityTR: 60, ratedAirflowCFM: 24000, capacityBTU: 720000 },

  // VOLTAS - PACKAGE
  { id: 'vo-pkg-1', brand: 'Voltas', type: 'Package', subType: 'Ducted Split', modelSeries: 'V-Duct', capacityTR: 5.5, ratedAirflowCFM: 2200, capacityBTU: 66000 },
  { id: 'vo-pkg-2', brand: 'Voltas', type: 'Package', subType: 'Packaged AC', modelSeries: 'V-Pack', capacityTR: 8.5, ratedAirflowCFM: 3400, capacityBTU: 102000 },

  // SAMSUNG - VRF
  { id: 'sa-vrf-1', brand: 'Samsung', type: 'VRF', subType: 'Outdoor Unit', modelSeries: 'DVM S2', capacityTR: 10, ratedAirflowCFM: 4000, capacityBTU: 120000 },
  { id: 'sa-vrf-2', brand: 'Samsung', type: 'VRF', subType: 'Outdoor Unit', modelSeries: 'DVM S2', capacityTR: 14, ratedAirflowCFM: 5600, capacityBTU: 168000 },
  { id: 'sa-vrf-3', brand: 'Samsung', type: 'VRF', subType: 'Indoor Unit', modelSeries: 'WindFree 4-Way Cassette', capacityTR: 1.5, ratedAirflowCFM: 600, capacityBTU: 18000 },
  { id: 'sa-vrf-4', brand: 'Samsung', type: 'VRF', subType: 'Indoor Unit', modelSeries: '360 Cassette', capacityTR: 3.0, ratedAirflowCFM: 1200, capacityBTU: 36000 },

  // FUJITSU - VRF
  { id: 'fu-vrf-1', brand: 'Fujitsu', type: 'VRF', subType: 'Outdoor Unit', modelSeries: 'Airstage V-III', capacityTR: 8, ratedAirflowCFM: 3200, capacityBTU: 96000 },
  { id: 'fu-vrf-2', brand: 'Fujitsu', type: 'VRF', subType: 'Outdoor Unit', modelSeries: 'Airstage V-III', capacityTR: 16, ratedAirflowCFM: 6400, capacityBTU: 192000 },
  { id: 'fu-vrf-3', brand: 'Fujitsu', type: 'VRF', subType: 'Indoor Unit', modelSeries: 'Compact Cassette', capacityTR: 1.0, ratedAirflowCFM: 400, capacityBTU: 12000 },
  { id: 'fu-vrf-4', brand: 'Fujitsu', type: 'VRF', subType: 'Indoor Unit', modelSeries: 'Slim Duct', capacityTR: 2.0, ratedAirflowCFM: 800, capacityBTU: 24000 },

  // SPLITS (Common across brands)
  { id: 'bs-sp-1', brand: 'Blue Star', type: 'Split', subType: 'Inverter Split', modelSeries: 'IA Series', capacityTR: 1.5, ratedAirflowCFM: 600, capacityBTU: 18000 },
  { id: 'vo-sp-1', brand: 'Voltas', type: 'Split', subType: 'Inverter Split', modelSeries: 'Maha Adjustable', capacityTR: 1.5, ratedAirflowCFM: 600, capacityBTU: 18000 },
  { id: 'sa-sp-1', brand: 'Samsung', type: 'Split', subType: 'WindFree Split', modelSeries: 'AR Series', capacityTR: 1.5, ratedAirflowCFM: 600, capacityBTU: 18000 },
  { id: 'fu-sp-1', brand: 'Fujitsu', type: 'Split', subType: 'Inverter Split', modelSeries: 'AS Series', capacityTR: 1.5, ratedAirflowCFM: 600, capacityBTU: 18000 },
];
