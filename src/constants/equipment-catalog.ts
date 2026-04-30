
export type EquipmentType =
  | 'VRF-ODU' | 'VRF-IDU'
  | 'Chiller' | 'ChillerIDU'
  | 'Package' | 'DuctableSplit'
  | 'VRF' | 'Split' | 'FCU' | 'Pump'; // legacy

export type IDUSubType =
  | 'hi-wall'
  | 'ductable-low' | 'ductable-mid' | 'ductable-hi'
  | 'cassette-1way' | 'cassette-2way' | 'cassette-4way' | 'cassette-360'
  | 'TFA' | 'AHU';

export const IDU_SUBTYPE_LABELS: Record<string, string> = {
  'hi-wall':        'Hi-Wall',
  'ductable-low':   'Ductable (Low Static)',
  'ductable-mid':   'Ductable (Mid Static)',
  'ductable-hi':    'Ductable (High Static)',
  'cassette-1way':  '1-Way Cassette',
  'cassette-2way':  '2-Way Cassette',
  'cassette-4way':  '4-Way Cassette',
  'cassette-360':   '360° Cassette',
  'TFA':            'Fresh Air (TFA)',
  'AHU':            'AHU',
};

export interface EquipmentModel {
  id: string;
  brand: string;
  type: EquipmentType;
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
  // VRF-ODU specific
  dischargeType?: 'top' | 'side';
  compressorType?: 'heat-pump' | 'cooling-only';
  minConnectionPct?: number;
  maxConnectionPct?: number;
  // Ductable IDU / DuctableSplit
  staticPressurePa?: number;
}

export const EQUIPMENT_CATALOG: EquipmentModel[] = [
  // ── BLUE STAR VRF OUTDOOR UNITS ──────────────────────────────────────────
  { id: 'bs-vrf-odu-1',  brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'W Series HP',  capacityTR: 8,  capacityBTU: 96000,  ratedAirflowCFM: 3600,  refrigerant: 'R32', powerInputKW: 7.2,  eer: 11.8, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-odu-2',  brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'W Series HP',  capacityTR: 10, capacityBTU: 120000, ratedAirflowCFM: 4400,  refrigerant: 'R32', powerInputKW: 9.0,  eer: 11.9, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-odu-3',  brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'W Series HP',  capacityTR: 12, capacityBTU: 144000, ratedAirflowCFM: 5200,  refrigerant: 'R32', powerInputKW: 10.8, eer: 12.0, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-odu-4',  brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'W Series HP',  capacityTR: 16, capacityBTU: 192000, ratedAirflowCFM: 7000,  refrigerant: 'R32', powerInputKW: 14.4, eer: 12.0, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-odu-5',  brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'W Series HP',  capacityTR: 20, capacityBTU: 240000, ratedAirflowCFM: 8600,  refrigerant: 'R32', powerInputKW: 18.0, eer: 12.1, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-odu-6',  brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'W Series HP',  capacityTR: 24, capacityBTU: 288000, ratedAirflowCFM: 10200, refrigerant: 'R32', powerInputKW: 21.6, eer: 12.1, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-odu-7',  brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'WS Series HP', capacityTR: 8,  capacityBTU: 96000,  ratedAirflowCFM: 3600,  refrigerant: 'R32', powerInputKW: 7.4,  eer: 11.6, dischargeType: 'side', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-odu-8',  brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'WS Series HP', capacityTR: 12, capacityBTU: 144000, ratedAirflowCFM: 5400,  refrigerant: 'R32', powerInputKW: 11.0, eer: 11.8, dischargeType: 'side', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-odu-9',  brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'WC Series CO', capacityTR: 10, capacityBTU: 120000, ratedAirflowCFM: 4400,  refrigerant: 'R32', powerInputKW: 9.5,  eer: 11.4, dischargeType: 'top',  compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-odu-10', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'WC Series CO', capacityTR: 14, capacityBTU: 168000, ratedAirflowCFM: 6200,  refrigerant: 'R32', powerInputKW: 13.0, eer: 11.6, dischargeType: 'top',  compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },

  // ── BLUE STAR VRF INDOOR UNITS ────────────────────────────────────────────
  { id: 'bs-vrf-idu-1',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'Hi-Wall',          capacityTR: 0.75, capacityBTU: 9000,  ratedAirflowCFM: 350,  powerInputKW: 0.03 },
  { id: 'bs-vrf-idu-2',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'Hi-Wall',          capacityTR: 1.0,  capacityBTU: 12000, ratedAirflowCFM: 450,  powerInputKW: 0.04 },
  { id: 'bs-vrf-idu-3',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'Hi-Wall',          capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM: 600,  powerInputKW: 0.05 },
  { id: 'bs-vrf-idu-4',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'Hi-Wall',          capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 800,  powerInputKW: 0.06 },
  { id: 'bs-vrf-idu-5',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: '4-Way Cassette',   capacityTR: 1.0,  capacityBTU: 12000, ratedAirflowCFM: 500,  powerInputKW: 0.04 },
  { id: 'bs-vrf-idu-6',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: '4-Way Cassette',   capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM: 700,  powerInputKW: 0.05 },
  { id: 'bs-vrf-idu-7',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: '4-Way Cassette',   capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 900,  powerInputKW: 0.07 },
  { id: 'bs-vrf-idu-8',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: '4-Way Cassette',   capacityTR: 3.0,  capacityBTU: 36000, ratedAirflowCFM: 1200, powerInputKW: 0.10 },
  { id: 'bs-vrf-idu-9',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-2way', modelSeries: '2-Way Cassette',   capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM: 650,  powerInputKW: 0.05 },
  { id: 'bs-vrf-idu-10', brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-2way', modelSeries: '2-Way Cassette',   capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 850,  powerInputKW: 0.06 },
  { id: 'bs-vrf-idu-11', brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-360',  modelSeries: '360 Cassette',     capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 900,  powerInputKW: 0.07 },
  { id: 'bs-vrf-idu-12', brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-360',  modelSeries: '360 Cassette',     capacityTR: 3.0,  capacityBTU: 36000, ratedAirflowCFM: 1300, powerInputKW: 0.10 },
  { id: 'bs-vrf-idu-13', brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-low',  modelSeries: 'Slim Duct Low',    capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 900,  staticPressurePa: 25, powerInputKW: 0.06 },
  { id: 'bs-vrf-idu-14', brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-low',  modelSeries: 'Slim Duct Low',    capacityTR: 3.0,  capacityBTU: 36000, ratedAirflowCFM: 1300, staticPressurePa: 25, powerInputKW: 0.09 },
  { id: 'bs-vrf-idu-15', brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-mid',  modelSeries: 'Slim Duct Mid',    capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 900,  staticPressurePa: 60, powerInputKW: 0.08 },
  { id: 'bs-vrf-idu-16', brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-mid',  modelSeries: 'Slim Duct Mid',    capacityTR: 3.0,  capacityBTU: 36000, ratedAirflowCFM: 1300, staticPressurePa: 60, powerInputKW: 0.11 },
  { id: 'bs-vrf-idu-17', brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-mid',  modelSeries: 'Slim Duct Mid',    capacityTR: 4.0,  capacityBTU: 48000, ratedAirflowCFM: 1700, staticPressurePa: 60, powerInputKW: 0.14 },
  { id: 'bs-vrf-idu-18', brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-hi',   modelSeries: 'Hi-Static Duct',   capacityTR: 4.0,  capacityBTU: 48000, ratedAirflowCFM: 1700, staticPressurePa: 120, powerInputKW: 0.18 },
  { id: 'bs-vrf-idu-19', brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-hi',   modelSeries: 'Hi-Static Duct',   capacityTR: 5.0,  capacityBTU: 60000, ratedAirflowCFM: 2100, staticPressurePa: 120, powerInputKW: 0.22 },
  { id: 'bs-vrf-idu-20', brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-hi',   modelSeries: 'Hi-Static Duct',   capacityTR: 7.5,  capacityBTU: 90000, ratedAirflowCFM: 3200, staticPressurePa: 150, powerInputKW: 0.32 },
  { id: 'bs-vrf-idu-21', brand: 'Blue Star', type: 'VRF-IDU', subType: 'TFA',           modelSeries: 'Fresh Air Unit',   capacityTR: 0.75, capacityBTU: 9000,  ratedAirflowCFM: 350,  powerInputKW: 0.10 },
  { id: 'bs-vrf-idu-22', brand: 'Blue Star', type: 'VRF-IDU', subType: 'TFA',           modelSeries: 'Fresh Air Unit',   capacityTR: 1.0,  capacityBTU: 12000, ratedAirflowCFM: 450,  powerInputKW: 0.13 },

  // ── SAMSUNG VRF OUTDOOR UNITS ─────────────────────────────────────────────
  { id: 'sa-vrf-odu-1', brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 HP',  capacityTR: 10, capacityBTU: 120000, ratedAirflowCFM: 4400, refrigerant: 'R410A', powerInputKW: 9.2,  eer: 11.7, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'sa-vrf-odu-2', brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 HP',  capacityTR: 14, capacityBTU: 168000, ratedAirflowCFM: 6200, refrigerant: 'R410A', powerInputKW: 12.8, eer: 11.9, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'sa-vrf-odu-3', brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 HP',  capacityTR: 20, capacityBTU: 240000, ratedAirflowCFM: 8600, refrigerant: 'R410A', powerInputKW: 18.2, eer: 12.0, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'sa-vrf-odu-4', brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 CO',  capacityTR: 10, capacityBTU: 120000, ratedAirflowCFM: 4400, refrigerant: 'R410A', powerInputKW: 9.5,  eer: 11.4, dischargeType: 'side', compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'sa-vrf-odu-5', brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 CO',  capacityTR: 14, capacityBTU: 168000, ratedAirflowCFM: 6200, refrigerant: 'R410A', powerInputKW: 13.2, eer: 11.5, dischargeType: 'side', compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },

  // ── SAMSUNG VRF INDOOR UNITS ──────────────────────────────────────────────
  { id: 'sa-vrf-idu-1',  brand: 'Samsung', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'WindFree Hi-Wall',  capacityTR: 1.0,  capacityBTU: 12000, ratedAirflowCFM: 450,  powerInputKW: 0.04 },
  { id: 'sa-vrf-idu-2',  brand: 'Samsung', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'WindFree Hi-Wall',  capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM: 600,  powerInputKW: 0.05 },
  { id: 'sa-vrf-idu-3',  brand: 'Samsung', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'WindFree Hi-Wall',  capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 800,  powerInputKW: 0.06 },
  { id: 'sa-vrf-idu-4',  brand: 'Samsung', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'WindFree Cassette', capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM: 700,  powerInputKW: 0.05 },
  { id: 'sa-vrf-idu-5',  brand: 'Samsung', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'WindFree Cassette', capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 900,  powerInputKW: 0.07 },
  { id: 'sa-vrf-idu-6',  brand: 'Samsung', type: 'VRF-IDU', subType: 'cassette-360',  modelSeries: '360 Cassette',      capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 900,  powerInputKW: 0.07 },
  { id: 'sa-vrf-idu-7',  brand: 'Samsung', type: 'VRF-IDU', subType: 'cassette-360',  modelSeries: '360 Cassette',      capacityTR: 3.0,  capacityBTU: 36000, ratedAirflowCFM: 1200, powerInputKW: 0.10 },
  { id: 'sa-vrf-idu-8',  brand: 'Samsung', type: 'VRF-IDU', subType: 'ductable-mid',  modelSeries: 'DVM Duct Mid',      capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 900,  staticPressurePa: 60, powerInputKW: 0.08 },
  { id: 'sa-vrf-idu-9',  brand: 'Samsung', type: 'VRF-IDU', subType: 'ductable-mid',  modelSeries: 'DVM Duct Mid',      capacityTR: 3.0,  capacityBTU: 36000, ratedAirflowCFM: 1300, staticPressurePa: 60, powerInputKW: 0.11 },
  { id: 'sa-vrf-idu-10', brand: 'Samsung', type: 'VRF-IDU', subType: 'ductable-hi',   modelSeries: 'DVM Duct High',     capacityTR: 4.0,  capacityBTU: 48000, ratedAirflowCFM: 1700, staticPressurePa: 120, powerInputKW: 0.18 },

  // ── VOLTAS VRF OUTDOOR UNITS ──────────────────────────────────────────────
  { id: 'vo-vrf-odu-1', brand: 'Voltas', type: 'VRF-ODU', modelSeries: 'Flexicool Plus', capacityTR: 8,  capacityBTU: 96000,  ratedAirflowCFM: 3600, refrigerant: 'R410A', powerInputKW: 7.5,  eer: 11.5, dischargeType: 'top', compressorType: 'heat-pump', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'vo-vrf-odu-2', brand: 'Voltas', type: 'VRF-ODU', modelSeries: 'Flexicool Plus', capacityTR: 12, capacityBTU: 144000, ratedAirflowCFM: 5300, refrigerant: 'R410A', powerInputKW: 11.2, eer: 11.6, dischargeType: 'top', compressorType: 'heat-pump', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'vo-vrf-odu-3', brand: 'Voltas', type: 'VRF-ODU', modelSeries: 'Flexicool Plus', capacityTR: 16, capacityBTU: 192000, ratedAirflowCFM: 7200, refrigerant: 'R410A', powerInputKW: 14.8, eer: 11.7, dischargeType: 'top', compressorType: 'heat-pump', minConnectionPct: 50, maxConnectionPct: 130 },

  // ── VOLTAS VRF INDOOR UNITS ───────────────────────────────────────────────
  { id: 'vo-vrf-idu-1', brand: 'Voltas', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'Hi-Wall',    capacityTR: 1.0, capacityBTU: 12000, ratedAirflowCFM: 450,  powerInputKW: 0.04 },
  { id: 'vo-vrf-idu-2', brand: 'Voltas', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'Hi-Wall',    capacityTR: 1.5, capacityBTU: 18000, ratedAirflowCFM: 600,  powerInputKW: 0.05 },
  { id: 'vo-vrf-idu-3', brand: 'Voltas', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'Cassette',   capacityTR: 1.5, capacityBTU: 18000, ratedAirflowCFM: 700,  powerInputKW: 0.05 },
  { id: 'vo-vrf-idu-4', brand: 'Voltas', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'Cassette',   capacityTR: 2.0, capacityBTU: 24000, ratedAirflowCFM: 900,  powerInputKW: 0.07 },
  { id: 'vo-vrf-idu-5', brand: 'Voltas', type: 'VRF-IDU', subType: 'ductable-mid',  modelSeries: 'Slim Duct',  capacityTR: 2.0, capacityBTU: 24000, ratedAirflowCFM: 900,  staticPressurePa: 60, powerInputKW: 0.08 },
  { id: 'vo-vrf-idu-6', brand: 'Voltas', type: 'VRF-IDU', subType: 'ductable-mid',  modelSeries: 'Slim Duct',  capacityTR: 3.0, capacityBTU: 36000, ratedAirflowCFM: 1300, staticPressurePa: 60, powerInputKW: 0.11 },

  // ── FUJITSU VRF OUTDOOR UNITS ─────────────────────────────────────────────
  { id: 'fu-vrf-odu-1', brand: 'Fujitsu', type: 'VRF-ODU', modelSeries: 'Airstage V-III HP', capacityTR: 8,  capacityBTU: 96000,  ratedAirflowCFM: 3600, refrigerant: 'R410A', powerInputKW: 7.0,  eer: 12.0, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'fu-vrf-odu-2', brand: 'Fujitsu', type: 'VRF-ODU', modelSeries: 'Airstage V-III HP', capacityTR: 16, capacityBTU: 192000, ratedAirflowCFM: 7000, refrigerant: 'R410A', powerInputKW: 14.2, eer: 12.1, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'fu-vrf-odu-3', brand: 'Fujitsu', type: 'VRF-ODU', modelSeries: 'Airstage V-III CO', capacityTR: 12, capacityBTU: 144000, ratedAirflowCFM: 5200, refrigerant: 'R410A', powerInputKW: 11.5, eer: 11.3, dischargeType: 'side', compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },

  // ── FUJITSU VRF INDOOR UNITS ──────────────────────────────────────────────
  { id: 'fu-vrf-idu-1', brand: 'Fujitsu', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'Hi-Wall',         capacityTR: 1.0, capacityBTU: 12000, ratedAirflowCFM: 450,  powerInputKW: 0.04 },
  { id: 'fu-vrf-idu-2', brand: 'Fujitsu', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'Hi-Wall',         capacityTR: 1.5, capacityBTU: 18000, ratedAirflowCFM: 600,  powerInputKW: 0.05 },
  { id: 'fu-vrf-idu-3', brand: 'Fujitsu', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'Compact Cassette',capacityTR: 1.0, capacityBTU: 12000, ratedAirflowCFM: 500,  powerInputKW: 0.04 },
  { id: 'fu-vrf-idu-4', brand: 'Fujitsu', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'Compact Cassette',capacityTR: 2.0, capacityBTU: 24000, ratedAirflowCFM: 900,  powerInputKW: 0.07 },
  { id: 'fu-vrf-idu-5', brand: 'Fujitsu', type: 'VRF-IDU', subType: 'ductable-mid',  modelSeries: 'Slim Duct',       capacityTR: 2.0, capacityBTU: 24000, ratedAirflowCFM: 900,  staticPressurePa: 60, powerInputKW: 0.08 },

  // ── PACKAGE UNITS ─────────────────────────────────────────────────────────
  { id: 'bs-pkg-1', brand: 'Blue Star', type: 'Package', subType: 'air-cooled',   modelSeries: 'Packaged Unit',  capacityTR: 5,   capacityBTU: 60000,  ratedAirflowCFM: 2200, refrigerant: 'R410A', powerInputKW: 5.2,  eer: 11.5 },
  { id: 'bs-pkg-2', brand: 'Blue Star', type: 'Package', subType: 'air-cooled',   modelSeries: 'Packaged Unit',  capacityTR: 7.5, capacityBTU: 90000,  ratedAirflowCFM: 3200, refrigerant: 'R410A', powerInputKW: 7.8,  eer: 11.5 },
  { id: 'bs-pkg-3', brand: 'Blue Star', type: 'Package', subType: 'air-cooled',   modelSeries: 'Packaged Unit',  capacityTR: 10,  capacityBTU: 120000, ratedAirflowCFM: 4200, refrigerant: 'R410A', powerInputKW: 10.2, eer: 11.8 },
  { id: 'vo-pkg-3', brand: 'Voltas',    type: 'Package', subType: 'air-cooled',   modelSeries: 'V-Pack AC',      capacityTR: 5,   capacityBTU: 60000,  ratedAirflowCFM: 2200, powerInputKW: 5.3,  eer: 11.3 },
  { id: 'vo-pkg-4', brand: 'Voltas',    type: 'Package', subType: 'air-cooled',   modelSeries: 'V-Pack AC',      capacityTR: 7.5, capacityBTU: 90000,  ratedAirflowCFM: 3200, powerInputKW: 8.0,  eer: 11.3 },
  { id: 'vo-pkg-5', brand: 'Voltas',    type: 'Package', subType: 'air-cooled',   modelSeries: 'V-Pack AC',      capacityTR: 10,  capacityBTU: 120000, ratedAirflowCFM: 4200, powerInputKW: 10.5, eer: 11.4 },
  { id: 'vo-pkg-6', brand: 'Voltas',    type: 'Package', subType: 'water-cooled', modelSeries: 'V-Pack WC',      capacityTR: 7.5, capacityBTU: 90000,  ratedAirflowCFM: 3400, powerInputKW: 7.2,  cop: 3.5 },
  { id: 'vo-pkg-7', brand: 'Voltas',    type: 'Package', subType: 'water-cooled', modelSeries: 'V-Pack WC',      capacityTR: 10,  capacityBTU: 120000, ratedAirflowCFM: 4500, powerInputKW: 9.6,  cop: 3.5 },
  { id: 'vo-pkg-8', brand: 'Voltas',    type: 'Package', subType: 'water-cooled', modelSeries: 'V-Pack WC',      capacityTR: 15,  capacityBTU: 180000, ratedAirflowCFM: 6500, powerInputKW: 14.2, cop: 3.6 },

  // ── DUCTABLE SPLIT ────────────────────────────────────────────────────────
  { id: 'bs-ds-1', brand: 'Blue Star', type: 'DuctableSplit', subType: 'inverter', modelSeries: 'DBHW Ductable', capacityTR: 2.0, capacityBTU: 24000,  ratedAirflowCFM: 900,  staticPressurePa: 30, powerInputKW: 2.0 },
  { id: 'bs-ds-2', brand: 'Blue Star', type: 'DuctableSplit', subType: 'inverter', modelSeries: 'DBHW Ductable', capacityTR: 3.0, capacityBTU: 36000,  ratedAirflowCFM: 1300, staticPressurePa: 30, powerInputKW: 2.9 },
  { id: 'bs-ds-3', brand: 'Blue Star', type: 'DuctableSplit', subType: 'inverter', modelSeries: 'DBHW Ductable', capacityTR: 4.0, capacityBTU: 48000,  ratedAirflowCFM: 1700, staticPressurePa: 50, powerInputKW: 3.8 },
  { id: 'bs-ds-4', brand: 'Blue Star', type: 'DuctableSplit', subType: 'inverter', modelSeries: 'DBHW Ductable', capacityTR: 5.0, capacityBTU: 60000,  ratedAirflowCFM: 2100, staticPressurePa: 50, powerInputKW: 4.7 },
  { id: 'vo-ds-1', brand: 'Voltas',    type: 'DuctableSplit', subType: 'inverter', modelSeries: 'V-Duct Inv',    capacityTR: 2.0, capacityBTU: 24000,  ratedAirflowCFM: 900,  staticPressurePa: 30, powerInputKW: 2.1 },
  { id: 'vo-ds-2', brand: 'Voltas',    type: 'DuctableSplit', subType: 'inverter', modelSeries: 'V-Duct Inv',    capacityTR: 3.0, capacityBTU: 36000,  ratedAirflowCFM: 1300, staticPressurePa: 30, powerInputKW: 3.0 },
  { id: 'vo-ds-3', brand: 'Voltas',    type: 'DuctableSplit', subType: 'inverter', modelSeries: 'V-Duct Inv',    capacityTR: 4.0, capacityBTU: 48000,  ratedAirflowCFM: 1700, staticPressurePa: 50, powerInputKW: 3.9 },
  { id: 'vo-ds-4', brand: 'Voltas',    type: 'DuctableSplit', subType: 'inverter', modelSeries: 'V-Duct Inv',    capacityTR: 5.0, capacityBTU: 60000,  ratedAirflowCFM: 2100, staticPressurePa: 50, powerInputKW: 4.8 },

  // ── LEGACY ENTRIES (backward compat) ─────────────────────────────────────
  { id: 'bs-ch-1', brand: 'Blue Star', type: 'Chiller', subType: 'Air Cooled Scroll',  modelSeries: 'LC Series', capacityTR: 10,  capacityBTU: 120000,  ratedAirflowCFM: 4000,  refrigerant: 'R410A' },
  { id: 'bs-ch-2', brand: 'Blue Star', type: 'Chiller', subType: 'Air Cooled Scroll',  modelSeries: 'LC Series', capacityTR: 20,  capacityBTU: 240000,  ratedAirflowCFM: 8000,  refrigerant: 'R410A' },
  { id: 'bs-ch-3', brand: 'Blue Star', type: 'Chiller', subType: 'Air Cooled Screw',   modelSeries: 'NS Series', capacityTR: 50,  capacityBTU: 600000,  ratedAirflowCFM: 20000, refrigerant: 'R134a' },
  { id: 'bs-ch-4', brand: 'Blue Star', type: 'Chiller', subType: 'Water Cooled Screw', modelSeries: 'WW Series', capacityTR: 100, capacityBTU: 1200000, ratedAirflowCFM: 40000, refrigerant: 'R134a' },
  { id: 'vo-ch-1', brand: 'Voltas',    type: 'Chiller', subType: 'Air Cooled Scroll',  modelSeries: 'V-Scroll',  capacityTR: 15,  capacityBTU: 180000,  ratedAirflowCFM: 6000 },
  { id: 'vo-ch-2', brand: 'Voltas',    type: 'Chiller', subType: 'Air Cooled Screw',   modelSeries: 'V-Screw',   capacityTR: 60,  capacityBTU: 720000,  ratedAirflowCFM: 24000 },
  { id: 'bs-vrf-1', brand: 'Blue Star', type: 'VRF', subType: 'Outdoor Unit', modelSeries: 'VRF V Plus', capacityTR: 8,  ratedAirflowCFM: 3200,  capacityBTU: 96000 },
  { id: 'bs-vrf-2', brand: 'Blue Star', type: 'VRF', subType: 'Outdoor Unit', modelSeries: 'VRF V Plus', capacityTR: 12, ratedAirflowCFM: 4800,  capacityBTU: 144000 },
  { id: 'bs-vrf-3', brand: 'Blue Star', type: 'VRF', subType: 'Indoor Unit',  modelSeries: 'Hi-Wall Inverter', capacityTR: 1.5, ratedAirflowCFM: 600, capacityBTU: 18000 },
  { id: 'bs-vrf-4', brand: 'Blue Star', type: 'VRF', subType: 'Indoor Unit',  modelSeries: '4-Way Cassette',   capacityTR: 2.0, ratedAirflowCFM: 800, capacityBTU: 24000 },
  { id: 'sa-vrf-1', brand: 'Samsung',   type: 'VRF', subType: 'Outdoor Unit', modelSeries: 'DVM S2', capacityTR: 10, ratedAirflowCFM: 4000, capacityBTU: 120000 },
  { id: 'sa-vrf-2', brand: 'Samsung',   type: 'VRF', subType: 'Outdoor Unit', modelSeries: 'DVM S2', capacityTR: 14, ratedAirflowCFM: 5600, capacityBTU: 168000 },
  { id: 'sa-vrf-3', brand: 'Samsung',   type: 'VRF', subType: 'Indoor Unit',  modelSeries: 'WindFree 4-Way Cassette', capacityTR: 1.5, ratedAirflowCFM: 600,  capacityBTU: 18000 },
  { id: 'sa-vrf-4', brand: 'Samsung',   type: 'VRF', subType: 'Indoor Unit',  modelSeries: '360 Cassette',            capacityTR: 3.0, ratedAirflowCFM: 1200, capacityBTU: 36000 },
  { id: 'fu-vrf-1', brand: 'Fujitsu',   type: 'VRF', subType: 'Outdoor Unit', modelSeries: 'Airstage V-III', capacityTR: 8,  ratedAirflowCFM: 3200, capacityBTU: 96000 },
  { id: 'fu-vrf-2', brand: 'Fujitsu',   type: 'VRF', subType: 'Outdoor Unit', modelSeries: 'Airstage V-III', capacityTR: 16, ratedAirflowCFM: 6400, capacityBTU: 192000 },
  { id: 'fu-vrf-3', brand: 'Fujitsu',   type: 'VRF', subType: 'Indoor Unit',  modelSeries: 'Compact Cassette', capacityTR: 1.0, ratedAirflowCFM: 400, capacityBTU: 12000 },
  { id: 'fu-vrf-4', brand: 'Fujitsu',   type: 'VRF', subType: 'Indoor Unit',  modelSeries: 'Slim Duct',        capacityTR: 2.0, ratedAirflowCFM: 800, capacityBTU: 24000 },
  { id: 'bs-sp-1',  brand: 'Blue Star', type: 'Split', subType: 'Inverter Split', modelSeries: 'IA Series',        capacityTR: 1.5, ratedAirflowCFM: 600, capacityBTU: 18000 },
  { id: 'vo-sp-1',  brand: 'Voltas',    type: 'Split', subType: 'Inverter Split', modelSeries: 'Maha Adjustable',  capacityTR: 1.5, ratedAirflowCFM: 600, capacityBTU: 18000 },
  { id: 'sa-sp-1',  brand: 'Samsung',   type: 'Split', subType: 'WindFree Split', modelSeries: 'AR Series',        capacityTR: 1.5, ratedAirflowCFM: 600, capacityBTU: 18000 },
  { id: 'fu-sp-1',  brand: 'Fujitsu',   type: 'Split', subType: 'Inverter Split', modelSeries: 'AS Series',        capacityTR: 1.5, ratedAirflowCFM: 600, capacityBTU: 18000 },
  { id: 'vo-pkg-1', brand: 'Voltas',    type: 'Package', subType: 'Ducted Split', modelSeries: 'V-Duct',  capacityTR: 5.5, ratedAirflowCFM: 2200, capacityBTU: 66000 },
  { id: 'vo-pkg-2', brand: 'Voltas',    type: 'Package', subType: 'Packaged AC',  modelSeries: 'V-Pack',  capacityTR: 8.5, ratedAirflowCFM: 3400, capacityBTU: 102000 },
];
