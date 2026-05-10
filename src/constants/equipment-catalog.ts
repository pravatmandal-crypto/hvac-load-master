
export type EquipmentType =
  | 'VRF-ODU' | 'VRF-IDU'
  | 'Chiller' | 'ChillerIDU'
  | 'Package' | 'DuctableSplit'
  | 'AHU' | 'FCU'
  | 'Humidifier' | 'Dehumidifier'
  | 'CoolingTower'
  | 'Boiler'
  | 'VRF' | 'Split' | 'Pump'; // legacy

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
  'AHU-DX':         'AHU with DX Coil (VRF)',
  'TFA':            'Fresh Air (TFA)',
  'AHU':            'AHU',
};

export interface EquipmentModel {
  id: string;
  brand: string;
  type: EquipmentType | string;  // string allows user-defined custom types
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
  // Modular ODU — multiple identical units linked on one refrigerant circuit
  isModular?: boolean;
  maxModules?: number;
  // Ductable IDU / DuctableSplit
  staticPressurePa?: number;
  // Humidifier / Dehumidifier
  capacityLPH?: number;        // moisture rate in litres per hour
  // Boiler / heating coil
  heatOutputKW?: number;       // useful thermal heating output kW
  // Catalog entry quality
  // 'placeholder' = indicative specs only — verify and update with real manufacturer data before use
  source?: 'catalog' | 'placeholder';
}

export const EQUIPMENT_CATALOG: EquipmentModel[] = [
  // ── BLUE STAR VRF OUTDOOR UNITS ──────────────────────────────────────────
  // WS Series HP — Side Discharge, NON-MODULAR (single unit)
  { id: 'bs-vrf-odu-7',  brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'WS Series HP', capacityTR: 8,  capacityBTU: 96000,  ratedAirflowCFM: 3600,  refrigerant: 'R32', powerInputKW: 7.4,  eer: 11.6, dischargeType: 'side', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-odu-7b', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'WS Series HP', capacityTR: 10, capacityBTU: 120000, ratedAirflowCFM: 4400,  refrigerant: 'R32', powerInputKW: 9.2,  eer: 11.7, dischargeType: 'side', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-odu-8',  brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'WS Series HP', capacityTR: 12, capacityBTU: 144000, ratedAirflowCFM: 5400,  refrigerant: 'R32', powerInputKW: 11.0, eer: 11.8, dischargeType: 'side', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-odu-8b', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'WS Series HP', capacityTR: 16, capacityBTU: 192000, ratedAirflowCFM: 7000,  refrigerant: 'R32', powerInputKW: 14.6, eer: 11.8, dischargeType: 'side', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-odu-8c', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'WS Series HP', capacityTR: 20, capacityBTU: 240000, ratedAirflowCFM: 8700,  refrigerant: 'R32', powerInputKW: 18.2, eer: 11.9, dischargeType: 'side', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-odu-8d', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'WS Series HP', capacityTR: 24, capacityBTU: 288000, ratedAirflowCFM: 10300, refrigerant: 'R32', powerInputKW: 21.8, eer: 11.9, dischargeType: 'side', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-odu-8e', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'WS Series HP', capacityTR: 28, capacityBTU: 336000, ratedAirflowCFM: 11800, refrigerant: 'R32', powerInputKW: 25.2, eer: 11.9, dischargeType: 'side', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-odu-8f', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'WS Series HP', capacityTR: 32, capacityBTU: 384000, ratedAirflowCFM: 13500, refrigerant: 'R32', powerInputKW: 28.8, eer: 12.0, dischargeType: 'side', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  // IVRFB Series TH — Heat Pump, Top Discharge, R410A (VRF V Plus brochure, page 8)
  { id: 'bs-vrf-v-odu-th-07', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TH Heat Pump', capacityTR: 7,  capacityBTU:  84000, ratedAirflowCFM:  7000, refrigerant: 'R410A', powerInputKW:  6.3, eer: 11.5, dischargeType: 'top', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-th-08', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TH Heat Pump', capacityTR: 8,  capacityBTU:  96000, ratedAirflowCFM:  7000, refrigerant: 'R410A', powerInputKW:  7.2, eer: 11.5, dischargeType: 'top', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-th-10', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TH Heat Pump', capacityTR: 10, capacityBTU: 120000, ratedAirflowCFM:  7000, refrigerant: 'R410A', powerInputKW:  9.0, eer: 11.6, dischargeType: 'top', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-th-12', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TH Heat Pump', capacityTR: 12, capacityBTU: 144000, ratedAirflowCFM:  7000, refrigerant: 'R410A', powerInputKW: 10.8, eer: 11.6, dischargeType: 'top', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-th-14', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TH Heat Pump', capacityTR: 14, capacityBTU: 168000, ratedAirflowCFM:  9000, refrigerant: 'R410A', powerInputKW: 12.5, eer: 11.7, dischargeType: 'top', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-th-16', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TH Heat Pump', capacityTR: 16, capacityBTU: 192000, ratedAirflowCFM: 10200, refrigerant: 'R410A', powerInputKW: 14.4, eer: 11.7, dischargeType: 'top', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-th-18', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TH Heat Pump', capacityTR: 18, capacityBTU: 216000, ratedAirflowCFM: 10800, refrigerant: 'R410A', powerInputKW: 16.2, eer: 11.8, dischargeType: 'top', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-th-20', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TH Heat Pump', capacityTR: 20, capacityBTU: 240000, ratedAirflowCFM: 11400, refrigerant: 'R410A', powerInputKW: 18.0, eer: 11.8, dischargeType: 'top', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-th-22', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TH Heat Pump', capacityTR: 22, capacityBTU: 264000, ratedAirflowCFM: 12000, refrigerant: 'R410A', powerInputKW: 19.8, eer: 11.8, dischargeType: 'top', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-th-24', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TH Heat Pump', capacityTR: 24, capacityBTU: 288000, ratedAirflowCFM: 12600, refrigerant: 'R410A', powerInputKW: 21.6, eer: 11.9, dischargeType: 'top', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-th-26', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TH Heat Pump', capacityTR: 26, capacityBTU: 312000, ratedAirflowCFM: 13200, refrigerant: 'R410A', powerInputKW: 23.4, eer: 11.9, dischargeType: 'top', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-th-28', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TH Heat Pump', capacityTR: 28, capacityBTU: 336000, ratedAirflowCFM: 13800, refrigerant: 'R410A', powerInputKW: 25.2, eer: 11.9, dischargeType: 'top', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  // IVRFB Series TC — Cooling Only, Top Discharge, R410A (VRF V Plus brochure, page 8)
  { id: 'bs-vrf-v-odu-tc-07', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TC Cooling Only', capacityTR: 7,  capacityBTU:  84000, ratedAirflowCFM:  7000, refrigerant: 'R410A', powerInputKW:  6.1, eer: 11.6, dischargeType: 'top', compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-tc-08', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TC Cooling Only', capacityTR: 8,  capacityBTU:  96000, ratedAirflowCFM:  7000, refrigerant: 'R410A', powerInputKW:  7.0, eer: 11.6, dischargeType: 'top', compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-tc-10', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TC Cooling Only', capacityTR: 10, capacityBTU: 120000, ratedAirflowCFM:  7000, refrigerant: 'R410A', powerInputKW:  8.8, eer: 11.7, dischargeType: 'top', compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-tc-12', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TC Cooling Only', capacityTR: 12, capacityBTU: 144000, ratedAirflowCFM:  7000, refrigerant: 'R410A', powerInputKW: 10.5, eer: 11.7, dischargeType: 'top', compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-tc-14', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TC Cooling Only', capacityTR: 14, capacityBTU: 168000, ratedAirflowCFM:  9000, refrigerant: 'R410A', powerInputKW: 12.2, eer: 11.8, dischargeType: 'top', compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-tc-16', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TC Cooling Only', capacityTR: 16, capacityBTU: 192000, ratedAirflowCFM: 10200, refrigerant: 'R410A', powerInputKW: 14.0, eer: 11.8, dischargeType: 'top', compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-tc-18', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TC Cooling Only', capacityTR: 18, capacityBTU: 216000, ratedAirflowCFM: 10800, refrigerant: 'R410A', powerInputKW: 15.8, eer: 11.8, dischargeType: 'top', compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-tc-20', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TC Cooling Only', capacityTR: 20, capacityBTU: 240000, ratedAirflowCFM: 11400, refrigerant: 'R410A', powerInputKW: 17.5, eer: 11.9, dischargeType: 'top', compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-tc-22', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TC Cooling Only', capacityTR: 22, capacityBTU: 264000, ratedAirflowCFM: 12000, refrigerant: 'R410A', powerInputKW: 19.3, eer: 11.9, dischargeType: 'top', compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-tc-24', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TC Cooling Only', capacityTR: 24, capacityBTU: 288000, ratedAirflowCFM: 12600, refrigerant: 'R410A', powerInputKW: 21.0, eer: 12.0, dischargeType: 'top', compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-tc-26', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TC Cooling Only', capacityTR: 26, capacityBTU: 312000, ratedAirflowCFM: 13200, refrigerant: 'R410A', powerInputKW: 22.8, eer: 12.0, dischargeType: 'top', compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'bs-vrf-v-odu-tc-28', brand: 'Blue Star', type: 'VRF-ODU', modelSeries: 'IVRFB TC Cooling Only', capacityTR: 28, capacityBTU: 336000, ratedAirflowCFM: 13800, refrigerant: 'R410A', powerInputKW: 24.5, eer: 12.0, dischargeType: 'top', compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },

  // ── BLUE STAR VRF INDOOR UNITS — VRF V Plus (from official brochure) ──────
  // Hi-Wall (VHW series) — actual CFM from brochure hi-speed
  { id: 'bs-vrf-idu-hw1',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'VHW Hi-Wall',      capacityTR: 0.8,  capacityBTU: 9600,  ratedAirflowCFM: 318,  powerInputKW: 0.055 },
  { id: 'bs-vrf-idu-hw2',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'VHW Hi-Wall',      capacityTR: 1.0,  capacityBTU: 12000, ratedAirflowCFM: 371,  powerInputKW: 0.055 },
  { id: 'bs-vrf-idu-hw3',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'VHW Hi-Wall',      capacityTR: 1.3,  capacityBTU: 15600, ratedAirflowCFM: 448,  powerInputKW: 0.070 },
  { id: 'bs-vrf-idu-hw4',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'VHW Hi-Wall',      capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM: 500,  powerInputKW: 0.070 },
  { id: 'bs-vrf-idu-hw5',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'VHW Hi-Wall',      capacityTR: 1.7,  capacityBTU: 20400, ratedAirflowCFM: 582,  powerInputKW: 0.095 },
  { id: 'bs-vrf-idu-hw6',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'VHW Hi-Wall',      capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 647,  powerInputKW: 0.095 },
  { id: 'bs-vrf-idu-hw7',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'VHW Hi-Wall',      capacityTR: 2.5,  capacityBTU: 30000, ratedAirflowCFM: 875,  powerInputKW: 0.105 },
  { id: 'bs-vrf-idu-hw8',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'VHW Hi-Wall',      capacityTR: 2.8,  capacityBTU: 33600, ratedAirflowCFM: 945,  powerInputKW: 0.105 },
  // 4-Way Cassette (VLC series)
  { id: 'bs-vrf-idu-lc1',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'VLC 4-Way Cassette', capacityTR: 1.0,  capacityBTU: 12000, ratedAirflowCFM: 470,  powerInputKW: 0.048 },
  { id: 'bs-vrf-idu-lc2',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'VLC 4-Way Cassette', capacityTR: 1.3,  capacityBTU: 15600, ratedAirflowCFM: 470,  powerInputKW: 0.048 },
  { id: 'bs-vrf-idu-lc3',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'VLC 4-Way Cassette', capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM: 490,  powerInputKW: 0.048 },
  { id: 'bs-vrf-idu-lc4',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'VLC 4-Way Cassette', capacityTR: 1.7,  capacityBTU: 20400, ratedAirflowCFM: 650,  powerInputKW: 0.059 },
  { id: 'bs-vrf-idu-lc5',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'VLC 4-Way Cassette', capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 695,  powerInputKW: 0.059 },
  { id: 'bs-vrf-idu-lc6',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'VLC 4-Way Cassette', capacityTR: 2.3,  capacityBTU: 27600, ratedAirflowCFM: 695,  powerInputKW: 0.059 },
  { id: 'bs-vrf-idu-lc7',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'VLC 4-Way Cassette', capacityTR: 2.8,  capacityBTU: 33600, ratedAirflowCFM: 945,  powerInputKW: 0.098 },
  { id: 'bs-vrf-idu-lc8',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'VLC 4-Way Cassette', capacityTR: 3.2,  capacityBTU: 38400, ratedAirflowCFM: 1095, powerInputKW: 0.098 },
  { id: 'bs-vrf-idu-lc9',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'VLC 4-Way Cassette', capacityTR: 4.0,  capacityBTU: 48000, ratedAirflowCFM: 1095, powerInputKW: 0.098 },
  { id: 'bs-vrf-idu-lc10', brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'VLC 4-Way Cassette', capacityTR: 5.0,  capacityBTU: 60000, ratedAirflowCFM: 1295, powerInputKW: 0.120 },
  // Compact Cassette (VCC series) — slim 596×596mm ceiling cassette
  { id: 'bs-vrf-idu-cc1',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'VCC Compact Cassette', capacityTR: 0.6,  capacityBTU: 7200,  ratedAirflowCFM: 385,  powerInputKW: 0.035 },
  { id: 'bs-vrf-idu-cc2',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'VCC Compact Cassette', capacityTR: 0.8,  capacityBTU: 9600,  ratedAirflowCFM: 385,  powerInputKW: 0.035 },
  { id: 'bs-vrf-idu-cc3',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'VCC Compact Cassette', capacityTR: 1.0,  capacityBTU: 12000, ratedAirflowCFM: 385,  powerInputKW: 0.035 },
  { id: 'bs-vrf-idu-cc4',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'VCC Compact Cassette', capacityTR: 1.3,  capacityBTU: 15600, ratedAirflowCFM: 412,  powerInputKW: 0.040 },
  { id: 'bs-vrf-idu-cc5',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'VCC Compact Cassette', capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM: 412,  powerInputKW: 0.040 },
  // 1-Way Cassette (VOC series)
  { id: 'bs-vrf-idu-oc1',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-1way', modelSeries: 'VOC 1-Way Cassette', capacityTR: 0.6,  capacityBTU: 7200,  ratedAirflowCFM: 340,  powerInputKW: 0.030 },
  { id: 'bs-vrf-idu-oc2',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-1way', modelSeries: 'VOC 1-Way Cassette', capacityTR: 0.8,  capacityBTU: 9600,  ratedAirflowCFM: 340,  powerInputKW: 0.031 },
  { id: 'bs-vrf-idu-oc3',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-1way', modelSeries: 'VOC 1-Way Cassette', capacityTR: 1.0,  capacityBTU: 12000, ratedAirflowCFM: 340,  powerInputKW: 0.031 },
  { id: 'bs-vrf-idu-oc4',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-1way', modelSeries: 'VOC 1-Way Cassette', capacityTR: 1.3,  capacityBTU: 15600, ratedAirflowCFM: 465,  powerInputKW: 0.040 },
  { id: 'bs-vrf-idu-oc5',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-1way', modelSeries: 'VOC 1-Way Cassette', capacityTR: 1.6,  capacityBTU: 19200, ratedAirflowCFM: 465,  powerInputKW: 0.041 },
  { id: 'bs-vrf-idu-oc6',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-1way', modelSeries: 'VOC 1-Way Cassette', capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 550,  powerInputKW: 0.056 },
  // 2-Way Cassette (VTC series)
  { id: 'bs-vrf-idu-tc1',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-2way', modelSeries: 'VTC 2-Way Cassette', capacityTR: 0.6,  capacityBTU: 7200,  ratedAirflowCFM: 430,  powerInputKW: 0.067 },
  { id: 'bs-vrf-idu-tc2',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-2way', modelSeries: 'VTC 2-Way Cassette', capacityTR: 0.8,  capacityBTU: 9600,  ratedAirflowCFM: 430,  powerInputKW: 0.067 },
  { id: 'bs-vrf-idu-tc3',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-2way', modelSeries: 'VTC 2-Way Cassette', capacityTR: 1.0,  capacityBTU: 12000, ratedAirflowCFM: 430,  powerInputKW: 0.067 },
  { id: 'bs-vrf-idu-tc4',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-2way', modelSeries: 'VTC 2-Way Cassette', capacityTR: 1.3,  capacityBTU: 15600, ratedAirflowCFM: 580,  powerInputKW: 0.128 },
  { id: 'bs-vrf-idu-tc5',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-2way', modelSeries: 'VTC 2-Way Cassette', capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM: 580,  powerInputKW: 0.128 },
  { id: 'bs-vrf-idu-tc6',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-2way', modelSeries: 'VTC 2-Way Cassette', capacityTR: 1.7,  capacityBTU: 20400, ratedAirflowCFM: 580,  powerInputKW: 0.128 },
  { id: 'bs-vrf-idu-tc7',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'cassette-2way', modelSeries: 'VTC 2-Way Cassette', capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 710,  powerInputKW: 0.162 },
  // Concealed / Low-Static Ductable (DCS series) — 10–30 Pa
  { id: 'bs-vrf-idu-cs1',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-low',  modelSeries: 'DCS Concealed',    capacityTR: 0.8,  capacityBTU: 9600,  ratedAirflowCFM: 350,  staticPressurePa: 20,  powerInputKW: 0.062 },
  { id: 'bs-vrf-idu-cs2',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-low',  modelSeries: 'DCS Concealed',    capacityTR: 1.0,  capacityBTU: 12000, ratedAirflowCFM: 350,  staticPressurePa: 20,  powerInputKW: 0.062 },
  { id: 'bs-vrf-idu-cs3',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-low',  modelSeries: 'DCS Concealed',    capacityTR: 1.3,  capacityBTU: 15600, ratedAirflowCFM: 450,  staticPressurePa: 22,  powerInputKW: 0.062 },
  { id: 'bs-vrf-idu-cs4',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-low',  modelSeries: 'DCS Concealed',    capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM: 500,  staticPressurePa: 22,  powerInputKW: 0.062 },
  { id: 'bs-vrf-idu-cs5',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-low',  modelSeries: 'DCS Concealed',    capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 650,  staticPressurePa: 28,  powerInputKW: 0.075 },
  // Ductable IDU Mid-Static (DSD series) — 25–70 Pa
  { id: 'bs-vrf-idu-sd1',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-mid',  modelSeries: 'DSD Ductable IDU', capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM: 600,  staticPressurePa: 40,  powerInputKW: 0.134 },
  { id: 'bs-vrf-idu-sd2',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-mid',  modelSeries: 'DSD Ductable IDU', capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 800,  staticPressurePa: 40,  powerInputKW: 0.134 },
  { id: 'bs-vrf-idu-sd3',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-mid',  modelSeries: 'DSD Ductable IDU', capacityTR: 2.5,  capacityBTU: 30000, ratedAirflowCFM: 1000, staticPressurePa: 50,  powerInputKW: 0.134 },
  { id: 'bs-vrf-idu-sd4',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-mid',  modelSeries: 'DSD Ductable IDU', capacityTR: 3.0,  capacityBTU: 36000, ratedAirflowCFM: 1200, staticPressurePa: 50,  powerInputKW: 0.134 },
  // Ductable IDU High-Static (DSD series) — 40–120 Pa
  { id: 'bs-vrf-idu-sd5',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-hi',   modelSeries: 'DSD Ductable IDU', capacityTR: 4.0,  capacityBTU: 48000, ratedAirflowCFM: 1600, staticPressurePa: 60,  powerInputKW: 0.335 },
  { id: 'bs-vrf-idu-sd6',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-hi',   modelSeries: 'DSD Ductable IDU', capacityTR: 5.0,  capacityBTU: 60000, ratedAirflowCFM: 1800, staticPressurePa: 75,  powerInputKW: 0.335 },
  { id: 'bs-vrf-idu-sd7',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-hi',   modelSeries: 'DSD Ductable IDU', capacityTR: 6.0,  capacityBTU: 72000, ratedAirflowCFM: 2300, staticPressurePa: 85,  powerInputKW: 0.670 },
  { id: 'bs-vrf-idu-sd8',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'ductable-hi',   modelSeries: 'DSD Ductable IDU', capacityTR: 8.0,  capacityBTU: 96000, ratedAirflowCFM: 3100, staticPressurePa: 85,  powerInputKW: 0.670 },
  // AHU-DX Type — Ceiling Ductable (VSD) & Floor (VFM)
  { id: 'bs-vrf-idu-vsd1', brand: 'Blue Star', type: 'VRF-IDU', subType: 'AHU-DX',        modelSeries: 'VSD Ceiling AHU',  capacityTR: 11,   capacityBTU: 132000, ratedAirflowCFM: 4400, staticPressurePa: 60,  powerInputKW: 0.37 },
  { id: 'bs-vrf-idu-vsd2', brand: 'Blue Star', type: 'VRF-IDU', subType: 'AHU-DX',        modelSeries: 'VSD Ceiling AHU',  capacityTR: 18,   capacityBTU: 216000, ratedAirflowCFM: 6800, staticPressurePa: 60,  powerInputKW: 0.37 },
  { id: 'bs-vrf-idu-vsd3', brand: 'Blue Star', type: 'VRF-IDU', subType: 'AHU-DX',        modelSeries: 'VSD Ceiling AHU',  capacityTR: 20,   capacityBTU: 240000, ratedAirflowCFM: 8800, staticPressurePa: 80,  powerInputKW: 0.75 },
  { id: 'bs-vrf-idu-vfm1', brand: 'Blue Star', type: 'VRF-IDU', subType: 'AHU-DX',        modelSeries: 'VFM Floor AHU',    capacityTR: 18,   capacityBTU: 216000, ratedAirflowCFM: 7200, staticPressurePa: 120, powerInputKW: 2.24 },
  { id: 'bs-vrf-idu-vfm2', brand: 'Blue Star', type: 'VRF-IDU', subType: 'AHU-DX',        modelSeries: 'VFM Floor AHU',    capacityTR: 22,   capacityBTU: 264000, ratedAirflowCFM: 8800, staticPressurePa: 120, powerInputKW: 3.00 },
  // Treated Fresh Air (DTFA) & Heat Recovery (DHRV)
  { id: 'bs-vrf-idu-fa1',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'TFA',           modelSeries: 'DTFA Fresh Air',   capacityTR: 3.5,  capacityBTU: 42000, ratedAirflowCFM: 500,  staticPressurePa: 80,  powerInputKW: 0.245 },
  { id: 'bs-vrf-idu-fa2',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'TFA',           modelSeries: 'DTFA Fresh Air',   capacityTR: 5.5,  capacityBTU: 66000, ratedAirflowCFM: 800,  staticPressurePa: 80,  powerInputKW: 0.245 },
  { id: 'bs-vrf-idu-fa3',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'TFA',           modelSeries: 'DTFA Fresh Air',   capacityTR: 6.8,  capacityBTU: 81600, ratedAirflowCFM: 1000, staticPressurePa: 80,  powerInputKW: 0.366 },
  { id: 'bs-vrf-idu-hr1',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'TFA',           modelSeries: 'DHRV Heat Recovery',capacityTR: 0.75, capacityBTU: 9000,  ratedAirflowCFM: 170,  staticPressurePa: 0,   powerInputKW: 0.170 },
  { id: 'bs-vrf-idu-hr2',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'TFA',           modelSeries: 'DHRV Heat Recovery',capacityTR: 1.3,  capacityBTU: 15600, ratedAirflowCFM: 320,  staticPressurePa: 0,   powerInputKW: 0.207 },
  { id: 'bs-vrf-idu-hr3',  brand: 'Blue Star', type: 'VRF-IDU', subType: 'TFA',           modelSeries: 'DHRV Heat Recovery',capacityTR: 2.2,  capacityBTU: 26400, ratedAirflowCFM: 530,  staticPressurePa: 80,  powerInputKW: 0.350 },

  // ── SAMSUNG VRF OUTDOOR UNITS ─────────────────────────────────────────────
  // DVM S2 HP — Top Discharge, Heat Pump (non-modular)
  { id: 'sa-vrf-odu-1',   brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 HP',       capacityTR: 8,  capacityBTU: 96000,  ratedAirflowCFM: 3600, refrigerant: 'R410A', powerInputKW: 7.4,  eer: 11.7, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'sa-vrf-odu-2',   brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 HP',       capacityTR: 10, capacityBTU: 120000, ratedAirflowCFM: 4400, refrigerant: 'R410A', powerInputKW: 9.2,  eer: 11.7, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'sa-vrf-odu-3',   brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 HP',       capacityTR: 12, capacityBTU: 144000, ratedAirflowCFM: 5300, refrigerant: 'R410A', powerInputKW: 11.0, eer: 11.8, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'sa-vrf-odu-4',   brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 HP',       capacityTR: 14, capacityBTU: 168000, ratedAirflowCFM: 6200, refrigerant: 'R410A', powerInputKW: 12.8, eer: 11.9, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'sa-vrf-odu-5',   brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 HP',       capacityTR: 16, capacityBTU: 192000, ratedAirflowCFM: 7100, refrigerant: 'R410A', powerInputKW: 15.0, eer: 11.9, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'sa-vrf-odu-6',   brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 HP',       capacityTR: 20, capacityBTU: 240000, ratedAirflowCFM: 8600, refrigerant: 'R410A', powerInputKW: 18.2, eer: 12.0, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'sa-vrf-odu-7',   brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 HP',       capacityTR: 24, capacityBTU: 288000, ratedAirflowCFM: 10200,refrigerant: 'R410A', powerInputKW: 21.8, eer: 12.0, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  // DVM S2 Eco Pro — Side Discharge, Heat Pump, MODULAR (up to 3 modules)
  { id: 'sa-vrf-odu-ep1', brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 Eco Pro HP', capacityTR: 10, capacityBTU: 120000, ratedAirflowCFM: 4400, refrigerant: 'R410A', powerInputKW: 9.4,  eer: 11.6, dischargeType: 'side', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130, isModular: true, maxModules: 3 },
  { id: 'sa-vrf-odu-ep2', brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 Eco Pro HP', capacityTR: 14, capacityBTU: 168000, ratedAirflowCFM: 6200, refrigerant: 'R410A', powerInputKW: 13.0, eer: 11.7, dischargeType: 'side', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130, isModular: true, maxModules: 3 },
  { id: 'sa-vrf-odu-ep3', brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 Eco Pro HP', capacityTR: 20, capacityBTU: 240000, ratedAirflowCFM: 8600, refrigerant: 'R410A', powerInputKW: 18.5, eer: 11.8, dischargeType: 'side', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130, isModular: true, maxModules: 3 },
  { id: 'sa-vrf-odu-ep4', brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 Eco Pro HP', capacityTR: 24, capacityBTU: 288000, ratedAirflowCFM: 10200,refrigerant: 'R410A', powerInputKW: 22.0, eer: 11.8, dischargeType: 'side', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130, isModular: true, maxModules: 3 },
  // DVM S2 CO — Side Discharge, Cooling Only (non-modular)
  { id: 'sa-vrf-odu-co1', brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 CO',       capacityTR: 10, capacityBTU: 120000, ratedAirflowCFM: 4400, refrigerant: 'R410A', powerInputKW: 9.5,  eer: 11.4, dischargeType: 'side', compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'sa-vrf-odu-co2', brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 CO',       capacityTR: 14, capacityBTU: 168000, ratedAirflowCFM: 6200, refrigerant: 'R410A', powerInputKW: 13.2, eer: 11.5, dischargeType: 'side', compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'sa-vrf-odu-co3', brand: 'Samsung', type: 'VRF-ODU', modelSeries: 'DVM S2 CO',       capacityTR: 20, capacityBTU: 240000, ratedAirflowCFM: 8600, refrigerant: 'R410A', powerInputKW: 18.8, eer: 11.5, dischargeType: 'side', compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },

  // ── SAMSUNG VRF INDOOR UNITS ──────────────────────────────────────────────
  { id: 'sa-vrf-idu-1',  brand: 'Samsung', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'WindFree Hi-Wall',  capacityTR: 0.75, capacityBTU: 9000,  ratedAirflowCFM: 360,  powerInputKW: 0.03 },
  { id: 'sa-vrf-idu-2',  brand: 'Samsung', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'WindFree Hi-Wall',  capacityTR: 1.0,  capacityBTU: 12000, ratedAirflowCFM: 450,  powerInputKW: 0.04 },
  { id: 'sa-vrf-idu-3',  brand: 'Samsung', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'WindFree Hi-Wall',  capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM: 600,  powerInputKW: 0.05 },
  { id: 'sa-vrf-idu-4',  brand: 'Samsung', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'WindFree Hi-Wall',  capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 800,  powerInputKW: 0.06 },
  { id: 'sa-vrf-idu-5',  brand: 'Samsung', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'WindFree Cassette', capacityTR: 1.0,  capacityBTU: 12000, ratedAirflowCFM: 500,  powerInputKW: 0.04 },
  { id: 'sa-vrf-idu-6',  brand: 'Samsung', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'WindFree Cassette', capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM: 700,  powerInputKW: 0.05 },
  { id: 'sa-vrf-idu-7',  brand: 'Samsung', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'WindFree Cassette', capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 900,  powerInputKW: 0.07 },
  { id: 'sa-vrf-idu-8',  brand: 'Samsung', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: 'WindFree Cassette', capacityTR: 3.0,  capacityBTU: 36000, ratedAirflowCFM: 1200, powerInputKW: 0.10 },
  { id: 'sa-vrf-idu-9',  brand: 'Samsung', type: 'VRF-IDU', subType: 'cassette-360',  modelSeries: '360 Flow Cassette', capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM: 650,  powerInputKW: 0.05 },
  { id: 'sa-vrf-idu-10', brand: 'Samsung', type: 'VRF-IDU', subType: 'cassette-360',  modelSeries: '360 Flow Cassette', capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 900,  powerInputKW: 0.07 },
  { id: 'sa-vrf-idu-11', brand: 'Samsung', type: 'VRF-IDU', subType: 'cassette-360',  modelSeries: '360 Flow Cassette', capacityTR: 3.0,  capacityBTU: 36000, ratedAirflowCFM: 1200, powerInputKW: 0.10 },
  { id: 'sa-vrf-idu-12', brand: 'Samsung', type: 'VRF-IDU', subType: 'cassette-2way', modelSeries: '2-Way Cassette',    capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM: 650,  powerInputKW: 0.05 },
  { id: 'sa-vrf-idu-13', brand: 'Samsung', type: 'VRF-IDU', subType: 'ductable-low',  modelSeries: 'DVM Duct Low',      capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM: 650,  staticPressurePa: 20, powerInputKW: 0.05 },
  { id: 'sa-vrf-idu-14', brand: 'Samsung', type: 'VRF-IDU', subType: 'ductable-mid',  modelSeries: 'DVM Duct Mid',      capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 900,  staticPressurePa: 60, powerInputKW: 0.08 },
  { id: 'sa-vrf-idu-15', brand: 'Samsung', type: 'VRF-IDU', subType: 'ductable-mid',  modelSeries: 'DVM Duct Mid',      capacityTR: 3.0,  capacityBTU: 36000, ratedAirflowCFM: 1300, staticPressurePa: 60, powerInputKW: 0.11 },
  { id: 'sa-vrf-idu-16', brand: 'Samsung', type: 'VRF-IDU', subType: 'ductable-mid',  modelSeries: 'DVM Duct Mid',      capacityTR: 4.0,  capacityBTU: 48000, ratedAirflowCFM: 1700, staticPressurePa: 60, powerInputKW: 0.14 },
  { id: 'sa-vrf-idu-17', brand: 'Samsung', type: 'VRF-IDU', subType: 'ductable-hi',   modelSeries: 'DVM Duct High',     capacityTR: 4.0,  capacityBTU: 48000, ratedAirflowCFM: 1700, staticPressurePa: 120, powerInputKW: 0.18 },
  { id: 'sa-vrf-idu-18', brand: 'Samsung', type: 'VRF-IDU', subType: 'ductable-hi',   modelSeries: 'DVM Duct High',     capacityTR: 5.0,  capacityBTU: 60000, ratedAirflowCFM: 2100, staticPressurePa: 120, powerInputKW: 0.22 },
  { id: 'sa-vrf-idu-19', brand: 'Samsung', type: 'VRF-IDU', subType: 'ductable-hi',   modelSeries: 'DVM Duct High',     capacityTR: 7.5,  capacityBTU: 90000, ratedAirflowCFM: 3200, staticPressurePa: 150, powerInputKW: 0.32 },
  { id: 'sa-vrf-idu-20', brand: 'Samsung', type: 'VRF-IDU', subType: 'TFA',           modelSeries: 'Fresh Air',         capacityTR: 1.0,  capacityBTU: 12000, ratedAirflowCFM: 450,  powerInputKW: 0.14 },

  // ── VOLTAS VRF OUTDOOR UNITS ──────────────────────────────────────────────
  // Flexicool Plus HP — Top Discharge, Heat Pump (non-modular)
  { id: 'vo-vrf-odu-1',  brand: 'Voltas', type: 'VRF-ODU', modelSeries: 'Flexicool Plus HP', capacityTR: 8,  capacityBTU: 96000,  ratedAirflowCFM: 3600,  refrigerant: 'R410A', powerInputKW: 7.5,  eer: 11.5, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'vo-vrf-odu-2',  brand: 'Voltas', type: 'VRF-ODU', modelSeries: 'Flexicool Plus HP', capacityTR: 10, capacityBTU: 120000, ratedAirflowCFM: 4400,  refrigerant: 'R410A', powerInputKW: 9.3,  eer: 11.6, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'vo-vrf-odu-3',  brand: 'Voltas', type: 'VRF-ODU', modelSeries: 'Flexicool Plus HP', capacityTR: 12, capacityBTU: 144000, ratedAirflowCFM: 5300,  refrigerant: 'R410A', powerInputKW: 11.2, eer: 11.6, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'vo-vrf-odu-4',  brand: 'Voltas', type: 'VRF-ODU', modelSeries: 'Flexicool Plus HP', capacityTR: 16, capacityBTU: 192000, ratedAirflowCFM: 7200,  refrigerant: 'R410A', powerInputKW: 14.8, eer: 11.7, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'vo-vrf-odu-5',  brand: 'Voltas', type: 'VRF-ODU', modelSeries: 'Flexicool Plus HP', capacityTR: 20, capacityBTU: 240000, ratedAirflowCFM: 8900,  refrigerant: 'R410A', powerInputKW: 18.6, eer: 11.7, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'vo-vrf-odu-6',  brand: 'Voltas', type: 'VRF-ODU', modelSeries: 'Flexicool Plus HP', capacityTR: 24, capacityBTU: 288000, ratedAirflowCFM: 10500, refrigerant: 'R410A', powerInputKW: 22.2, eer: 11.8, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  // Flexicool CO — Top Discharge, Cooling Only (non-modular)
  { id: 'vo-vrf-odu-7',  brand: 'Voltas', type: 'VRF-ODU', modelSeries: 'Flexicool CO',      capacityTR: 10, capacityBTU: 120000, ratedAirflowCFM: 4400,  refrigerant: 'R410A', powerInputKW: 9.6,  eer: 11.2, dischargeType: 'top',  compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'vo-vrf-odu-8',  brand: 'Voltas', type: 'VRF-ODU', modelSeries: 'Flexicool CO',      capacityTR: 16, capacityBTU: 192000, ratedAirflowCFM: 7200,  refrigerant: 'R410A', powerInputKW: 15.2, eer: 11.3, dischargeType: 'top',  compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'vo-vrf-odu-9',  brand: 'Voltas', type: 'VRF-ODU', modelSeries: 'Flexicool CO',      capacityTR: 20, capacityBTU: 240000, ratedAirflowCFM: 8900,  refrigerant: 'R410A', powerInputKW: 19.0, eer: 11.3, dischargeType: 'top',  compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  // Flexicool Plus HP-SD — Side Discharge, MODULAR (up to 3 modules)
  { id: 'vo-vrf-odu-sd1', brand: 'Voltas', type: 'VRF-ODU', modelSeries: 'Flexicool HP-SD',  capacityTR: 10, capacityBTU: 120000, ratedAirflowCFM: 4400,  refrigerant: 'R410A', powerInputKW: 9.5,  eer: 11.5, dischargeType: 'side', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130, isModular: true, maxModules: 3 },
  { id: 'vo-vrf-odu-sd2', brand: 'Voltas', type: 'VRF-ODU', modelSeries: 'Flexicool HP-SD',  capacityTR: 16, capacityBTU: 192000, ratedAirflowCFM: 7200,  refrigerant: 'R410A', powerInputKW: 15.0, eer: 11.6, dischargeType: 'side', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130, isModular: true, maxModules: 3 },
  { id: 'vo-vrf-odu-sd3', brand: 'Voltas', type: 'VRF-ODU', modelSeries: 'Flexicool HP-SD',  capacityTR: 20, capacityBTU: 240000, ratedAirflowCFM: 8900,  refrigerant: 'R410A', powerInputKW: 18.8, eer: 11.6, dischargeType: 'side', compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130, isModular: true, maxModules: 3 },

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

  // ── BLUE STAR SCROLL CHILLERS (from official brochure) ───────────────────
  // Air Cooled Scroll — R407C (XAC series, 35°C ambient, CHW 6.7°C leaving)
  { id: 'bs-scroll-ac-r407c-10',  brand: 'Blue Star', type: 'Chiller', subType: 'Air Cooled Scroll', modelSeries: 'XAC R407C Scroll', capacityTR:  9.5, capacityBTU:  114000, ratedAirflowCFM:  3800, refrigerant: 'R407C', powerInputKW:  11.4, cop: 2.93 },
  { id: 'bs-scroll-ac-r407c-24',  brand: 'Blue Star', type: 'Chiller', subType: 'Air Cooled Scroll', modelSeries: 'XAC R407C Scroll', capacityTR: 23.0, capacityBTU:  276000, ratedAirflowCFM:  9200, refrigerant: 'R407C', powerInputKW:  26.6, cop: 3.04 },
  { id: 'bs-scroll-ac-r407c-36',  brand: 'Blue Star', type: 'Chiller', subType: 'Air Cooled Scroll', modelSeries: 'XAC R407C Scroll', capacityTR: 34.0, capacityBTU:  408000, ratedAirflowCFM: 13600, refrigerant: 'R407C', powerInputKW:  40.0, cop: 2.99 },
  { id: 'bs-scroll-ac-r407c-48',  brand: 'Blue Star', type: 'Chiller', subType: 'Air Cooled Scroll', modelSeries: 'XAC R407C Scroll', capacityTR: 46.0, capacityBTU:  552000, ratedAirflowCFM: 18400, refrigerant: 'R407C', powerInputKW:  55.6, cop: 2.91 },
  { id: 'bs-scroll-ac-r407c-60',  brand: 'Blue Star', type: 'Chiller', subType: 'Air Cooled Scroll', modelSeries: 'XAC R407C Scroll', capacityTR: 56.0, capacityBTU:  672000, ratedAirflowCFM: 22400, refrigerant: 'R407C', powerInputKW:  71.4, cop: 2.76 },
  { id: 'bs-scroll-ac-r407c-80',  brand: 'Blue Star', type: 'Chiller', subType: 'Air Cooled Scroll', modelSeries: 'XAC R407C Scroll', capacityTR: 74.0, capacityBTU:  888000, ratedAirflowCFM: 29600, refrigerant: 'R407C', powerInputKW:  95.2, cop: 2.73 },
  // Air Cooled Scroll — R410A (XAC2YS-100R3 / 120R3)
  { id: 'bs-scroll-ac-r410a-100', brand: 'Blue Star', type: 'Chiller', subType: 'Air Cooled Scroll', modelSeries: 'XAC R410A Scroll', capacityTR: 97.0, capacityBTU: 1164000, ratedAirflowCFM: 38800, refrigerant: 'R410A', powerInputKW: 118.0, cop: 2.89 },
  { id: 'bs-scroll-ac-r410a-120', brand: 'Blue Star', type: 'Chiller', subType: 'Air Cooled Scroll', modelSeries: 'XAC R410A Scroll', capacityTR: 117.0,capacityBTU: 1404000, ratedAirflowCFM: 46800, refrigerant: 'R410A', powerInputKW: 142.0, cop: 2.90 },
  // Air Cooled Scroll Modular — R407C (independent refrigerant circuits per module)
  { id: 'bs-scroll-ac-mod-46',    brand: 'Blue Star', type: 'Chiller', subType: 'Air Cooled Scroll Modular', modelSeries: 'XAC Modular R407C', capacityTR: 46.0, capacityBTU:  552000, ratedAirflowCFM: 18400, refrigerant: 'R407C', powerInputKW:  55.6, cop: 2.91 },
  { id: 'bs-scroll-ac-mod-56',    brand: 'Blue Star', type: 'Chiller', subType: 'Air Cooled Scroll Modular', modelSeries: 'XAC Modular R407C', capacityTR: 56.0, capacityBTU:  672000, ratedAirflowCFM: 22400, refrigerant: 'R407C', powerInputKW:  71.4, cop: 2.76 },
  { id: 'bs-scroll-ac-mod-68',    brand: 'Blue Star', type: 'Chiller', subType: 'Air Cooled Scroll Modular', modelSeries: 'XAC Modular R407C', capacityTR: 68.0, capacityBTU:  816000, ratedAirflowCFM: 27200, refrigerant: 'R407C', powerInputKW:  83.0, cop: 2.88 },
  // Water Cooled Scroll — Eco-friendly range (R407C / R410A, 29.4°C condenser entering water)
  { id: 'bs-scroll-wc-11',        brand: 'Blue Star', type: 'Chiller', subType: 'Water Cooled Scroll', modelSeries: 'XWC Eco Scroll', capacityTR:  11.0, capacityBTU:  132000, ratedAirflowCFM:  4400, refrigerant: 'R407C', powerInputKW:   9.2, cop: 4.20 },
  { id: 'bs-scroll-wc-26',        brand: 'Blue Star', type: 'Chiller', subType: 'Water Cooled Scroll', modelSeries: 'XWC Eco Scroll', capacityTR:  25.5, capacityBTU:  306000, ratedAirflowCFM: 10200, refrigerant: 'R407C', powerInputKW:  20.9, cop: 4.29 },
  { id: 'bs-scroll-wc-39',        brand: 'Blue Star', type: 'Chiller', subType: 'Water Cooled Scroll', modelSeries: 'XWC Eco Scroll', capacityTR:  38.0, capacityBTU:  456000, ratedAirflowCFM: 15200, refrigerant: 'R407C', powerInputKW:  31.1, cop: 4.30 },
  { id: 'bs-scroll-wc-52',        brand: 'Blue Star', type: 'Chiller', subType: 'Water Cooled Scroll', modelSeries: 'XWC Eco Scroll', capacityTR:  51.0, capacityBTU:  612000, ratedAirflowCFM: 20400, refrigerant: 'R407C', powerInputKW:  41.7, cop: 4.30 },
  { id: 'bs-scroll-wc-70',        brand: 'Blue Star', type: 'Chiller', subType: 'Water Cooled Scroll', modelSeries: 'XWC Eco Scroll', capacityTR:  70.0, capacityBTU:  840000, ratedAirflowCFM: 28000, refrigerant: 'R410A', powerInputKW:  54.7, cop: 4.50 },
  { id: 'bs-scroll-wc-85',        brand: 'Blue Star', type: 'Chiller', subType: 'Water Cooled Scroll', modelSeries: 'XWC Eco Scroll', capacityTR:  84.0, capacityBTU: 1008000, ratedAirflowCFM: 33600, refrigerant: 'R407C', powerInputKW:  68.7, cop: 4.30 },

  // ── LEGACY ENTRIES (backward compat) ─────────────────────────────────────
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

  // ── TRANE VRF OUTDOOR UNITS ──────────────────────────────────────────────────
  { id: 'tr-vrf-odu-1', brand: 'Trane', type: 'VRF-ODU', modelSeries: 'Sintesis HP', capacityTR: 8,  capacityBTU: 96000,  ratedAirflowCFM: 3500,  refrigerant: 'R410A', powerInputKW: 7.5,  eer: 11.6, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'tr-vrf-odu-2', brand: 'Trane', type: 'VRF-ODU', modelSeries: 'Sintesis HP', capacityTR: 10, capacityBTU: 120000, ratedAirflowCFM: 4300,  refrigerant: 'R410A', powerInputKW: 9.3,  eer: 11.7, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'tr-vrf-odu-3', brand: 'Trane', type: 'VRF-ODU', modelSeries: 'Sintesis HP', capacityTR: 12, capacityBTU: 144000, ratedAirflowCFM: 5100,  refrigerant: 'R410A', powerInputKW: 11.0, eer: 11.8, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'tr-vrf-odu-4', brand: 'Trane', type: 'VRF-ODU', modelSeries: 'Sintesis HP', capacityTR: 16, capacityBTU: 192000, ratedAirflowCFM: 6900,  refrigerant: 'R410A', powerInputKW: 14.8, eer: 11.8, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'tr-vrf-odu-5', brand: 'Trane', type: 'VRF-ODU', modelSeries: 'Sintesis HP', capacityTR: 20, capacityBTU: 240000, ratedAirflowCFM: 8500,  refrigerant: 'R410A', powerInputKW: 18.5, eer: 11.9, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'tr-vrf-odu-6', brand: 'Trane', type: 'VRF-ODU', modelSeries: 'Sintesis HP', capacityTR: 24, capacityBTU: 288000, ratedAirflowCFM: 10000, refrigerant: 'R410A', powerInputKW: 22.0, eer: 11.9, dischargeType: 'top',  compressorType: 'heat-pump',    minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'tr-vrf-odu-7', brand: 'Trane', type: 'VRF-ODU', modelSeries: 'Sintesis CO', capacityTR: 10, capacityBTU: 120000, ratedAirflowCFM: 4300,  refrigerant: 'R410A', powerInputKW: 9.8,  eer: 11.0, dischargeType: 'top',  compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  { id: 'tr-vrf-odu-8', brand: 'Trane', type: 'VRF-ODU', modelSeries: 'Sintesis CO', capacityTR: 16, capacityBTU: 192000, ratedAirflowCFM: 6900,  refrigerant: 'R410A', powerInputKW: 15.5, eer: 11.2, dischargeType: 'top',  compressorType: 'cooling-only', minConnectionPct: 50, maxConnectionPct: 130 },
  // Sintesis HP-SD — Side Discharge, MODULAR (up to 3 units on one refrigerant circuit)
  { id: 'tr-vrf-odu-sd-1', brand: 'Trane', type: 'VRF-ODU', modelSeries: 'Sintesis HP-SD', capacityTR: 10, capacityBTU: 120000, ratedAirflowCFM: 4300,  refrigerant: 'R410A', powerInputKW: 9.5,  eer: 11.6, dischargeType: 'side', compressorType: 'heat-pump', minConnectionPct: 50, maxConnectionPct: 130, isModular: true, maxModules: 3 },
  { id: 'tr-vrf-odu-sd-2', brand: 'Trane', type: 'VRF-ODU', modelSeries: 'Sintesis HP-SD', capacityTR: 12, capacityBTU: 144000, ratedAirflowCFM: 5200,  refrigerant: 'R410A', powerInputKW: 11.2, eer: 11.7, dischargeType: 'side', compressorType: 'heat-pump', minConnectionPct: 50, maxConnectionPct: 130, isModular: true, maxModules: 3 },
  { id: 'tr-vrf-odu-sd-3', brand: 'Trane', type: 'VRF-ODU', modelSeries: 'Sintesis HP-SD', capacityTR: 16, capacityBTU: 192000, ratedAirflowCFM: 7000,  refrigerant: 'R410A', powerInputKW: 15.0, eer: 11.8, dischargeType: 'side', compressorType: 'heat-pump', minConnectionPct: 50, maxConnectionPct: 130, isModular: true, maxModules: 3 },
  { id: 'tr-vrf-odu-sd-4', brand: 'Trane', type: 'VRF-ODU', modelSeries: 'Sintesis HP-SD', capacityTR: 20, capacityBTU: 240000, ratedAirflowCFM: 8600,  refrigerant: 'R410A', powerInputKW: 18.8, eer: 11.8, dischargeType: 'side', compressorType: 'heat-pump', minConnectionPct: 50, maxConnectionPct: 130, isModular: true, maxModules: 3 },
  { id: 'tr-vrf-odu-sd-5', brand: 'Trane', type: 'VRF-ODU', modelSeries: 'Sintesis HP-SD', capacityTR: 24, capacityBTU: 288000, ratedAirflowCFM: 10200, refrigerant: 'R410A', powerInputKW: 22.5, eer: 11.9, dischargeType: 'side', compressorType: 'heat-pump', minConnectionPct: 50, maxConnectionPct: 130, isModular: true, maxModules: 3 },

  // ── TRANE VRF INDOOR UNITS ────────────────────────────────────────────────────
  { id: 'tr-vrf-idu-1',  brand: 'Trane', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'Hi-Wall',        capacityTR: 0.75, capacityBTU: 9000,  ratedAirflowCFM: 360,  powerInputKW: 0.03 },
  { id: 'tr-vrf-idu-2',  brand: 'Trane', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'Hi-Wall',        capacityTR: 1.0,  capacityBTU: 12000, ratedAirflowCFM: 460,  powerInputKW: 0.04 },
  { id: 'tr-vrf-idu-3',  brand: 'Trane', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'Hi-Wall',        capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM: 620,  powerInputKW: 0.05 },
  { id: 'tr-vrf-idu-4',  brand: 'Trane', type: 'VRF-IDU', subType: 'hi-wall',       modelSeries: 'Hi-Wall',        capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 820,  powerInputKW: 0.06 },
  { id: 'tr-vrf-idu-5',  brand: 'Trane', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: '4-Way Cassette', capacityTR: 1.0,  capacityBTU: 12000, ratedAirflowCFM: 510,  powerInputKW: 0.04 },
  { id: 'tr-vrf-idu-6',  brand: 'Trane', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: '4-Way Cassette', capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM: 720,  powerInputKW: 0.05 },
  { id: 'tr-vrf-idu-7',  brand: 'Trane', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: '4-Way Cassette', capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 920,  powerInputKW: 0.07 },
  { id: 'tr-vrf-idu-8',  brand: 'Trane', type: 'VRF-IDU', subType: 'cassette-4way', modelSeries: '4-Way Cassette', capacityTR: 3.0,  capacityBTU: 36000, ratedAirflowCFM: 1250, powerInputKW: 0.10 },
  { id: 'tr-vrf-idu-9',  brand: 'Trane', type: 'VRF-IDU', subType: 'ductable-mid',  modelSeries: 'Ductable IDU',   capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM: 900,  staticPressurePa: 50,  powerInputKW: 0.06 },
  { id: 'tr-vrf-idu-10', brand: 'Trane', type: 'VRF-IDU', subType: 'ductable-mid',  modelSeries: 'Ductable IDU',   capacityTR: 3.0,  capacityBTU: 36000, ratedAirflowCFM: 1300, staticPressurePa: 50,  powerInputKW: 0.09 },
  { id: 'tr-vrf-idu-11', brand: 'Trane', type: 'VRF-IDU', subType: 'ductable-hi',   modelSeries: 'Ductable IDU',   capacityTR: 4.0,  capacityBTU: 48000, ratedAirflowCFM: 1700, staticPressurePa: 100, powerInputKW: 0.12 },

  // ── ZECO VRF-IDU (AHU-DX) ────────────────────────────────────────────────
  // Zeco CAHU units with DX coil — connect to any VRF ODU refrigerant circuit
  { id: 'ze-vrf-idu-1',  brand: 'Zeco', type: 'VRF-IDU', subType: 'AHU-DX', modelSeries: 'CAHU DX',  capacityTR: 2.0,  capacityBTU: 24000,  ratedAirflowCFM: 900,   staticPressurePa: 80,  powerInputKW: 0.37 },
  { id: 'ze-vrf-idu-2',  brand: 'Zeco', type: 'VRF-IDU', subType: 'AHU-DX', modelSeries: 'CAHU DX',  capacityTR: 3.0,  capacityBTU: 36000,  ratedAirflowCFM: 1350,  staticPressurePa: 100, powerInputKW: 0.55 },
  { id: 'ze-vrf-idu-3',  brand: 'Zeco', type: 'VRF-IDU', subType: 'AHU-DX', modelSeries: 'CAHU DX',  capacityTR: 4.0,  capacityBTU: 48000,  ratedAirflowCFM: 1800,  staticPressurePa: 100, powerInputKW: 0.75 },
  { id: 'ze-vrf-idu-4',  brand: 'Zeco', type: 'VRF-IDU', subType: 'AHU-DX', modelSeries: 'CAHU DX',  capacityTR: 5.0,  capacityBTU: 60000,  ratedAirflowCFM: 2250,  staticPressurePa: 125, powerInputKW: 1.10 },
  { id: 'ze-vrf-idu-5',  brand: 'Zeco', type: 'VRF-IDU', subType: 'AHU-DX', modelSeries: 'CAHU DX',  capacityTR: 6.0,  capacityBTU: 72000,  ratedAirflowCFM: 2700,  staticPressurePa: 125, powerInputKW: 1.50 },
  { id: 'ze-vrf-idu-6',  brand: 'Zeco', type: 'VRF-IDU', subType: 'AHU-DX', modelSeries: 'CAHU DX',  capacityTR: 8.0,  capacityBTU: 96000,  ratedAirflowCFM: 3600,  staticPressurePa: 150, powerInputKW: 1.85 },
  { id: 'ze-vrf-idu-7',  brand: 'Zeco', type: 'VRF-IDU', subType: 'AHU-DX', modelSeries: 'CAHU DX',  capacityTR: 10.0, capacityBTU: 120000, ratedAirflowCFM: 4500,  staticPressurePa: 150, powerInputKW: 2.20 },
  { id: 'ze-vrf-idu-8',  brand: 'Zeco', type: 'VRF-IDU', subType: 'AHU-DX', modelSeries: 'CAHU DX',  capacityTR: 12.0, capacityBTU: 144000, ratedAirflowCFM: 5400,  staticPressurePa: 175, powerInputKW: 3.00 },

  // ── ZECO FCU (Hydronic) ───────────────────────────────────────────────────
  { id: 'ze-fcu-1',  brand: 'Zeco', type: 'FCU', subType: 'Chilled Water', modelSeries: 'CFCU 2P',  capacityTR: 0.5,  capacityBTU: 6000,   ratedAirflowCFM: 230,   staticPressurePa: 20,  powerInputKW: 0.06 },
  { id: 'ze-fcu-2',  brand: 'Zeco', type: 'FCU', subType: 'Chilled Water', modelSeries: 'CFCU 2P',  capacityTR: 0.75, capacityBTU: 9000,   ratedAirflowCFM: 340,   staticPressurePa: 20,  powerInputKW: 0.08 },
  { id: 'ze-fcu-3',  brand: 'Zeco', type: 'FCU', subType: 'Chilled Water', modelSeries: 'CFCU 4P',  capacityTR: 1.0,  capacityBTU: 12000,  ratedAirflowCFM: 450,   staticPressurePa: 25,  powerInputKW: 0.10 },
  { id: 'ze-fcu-4',  brand: 'Zeco', type: 'FCU', subType: 'Chilled Water', modelSeries: 'CFCU 4P',  capacityTR: 1.5,  capacityBTU: 18000,  ratedAirflowCFM: 680,   staticPressurePa: 30,  powerInputKW: 0.14 },
  { id: 'ze-fcu-5',  brand: 'Zeco', type: 'FCU', subType: 'Chilled Water', modelSeries: 'CFCU 4P',  capacityTR: 2.0,  capacityBTU: 24000,  ratedAirflowCFM: 900,   staticPressurePa: 35,  powerInputKW: 0.18 },
  { id: 'ze-cass-1', brand: 'Zeco', type: 'FCU', subType: 'Cassette HW',   modelSeries: 'Cassette', capacityTR: 1.0,  capacityBTU: 12000,  ratedAirflowCFM: 480,   staticPressurePa: 15,  powerInputKW: 0.08 },
  { id: 'ze-cass-2', brand: 'Zeco', type: 'FCU', subType: 'Cassette HW',   modelSeries: 'Cassette', capacityTR: 1.5,  capacityBTU: 18000,  ratedAirflowCFM: 700,   staticPressurePa: 15,  powerInputKW: 0.12 },
  { id: 'ze-cass-3', brand: 'Zeco', type: 'FCU', subType: 'Cassette HW',   modelSeries: 'Cassette', capacityTR: 2.0,  capacityBTU: 24000,  ratedAirflowCFM: 950,   staticPressurePa: 15,  powerInputKW: 0.15 },

  // ── ZECO AHU (Hydronic) ───────────────────────────────────────────────────
  { id: 'ze-ahu-1',  brand: 'Zeco', type: 'AHU', subType: 'Chilled Water', modelSeries: 'CAHU HW',  capacityTR: 5,    capacityBTU: 60000,  ratedAirflowCFM: 2000,  staticPressurePa: 125, powerInputKW: 1.10 },
  { id: 'ze-ahu-2',  brand: 'Zeco', type: 'AHU', subType: 'Chilled Water', modelSeries: 'CAHU HW',  capacityTR: 7.5,  capacityBTU: 90000,  ratedAirflowCFM: 3000,  staticPressurePa: 150, powerInputKW: 1.50 },
  { id: 'ze-ahu-3',  brand: 'Zeco', type: 'AHU', subType: 'Chilled Water', modelSeries: 'CAHU HW',  capacityTR: 10,   capacityBTU: 120000, ratedAirflowCFM: 4000,  staticPressurePa: 150, powerInputKW: 2.20 },
  { id: 'ze-ahu-4',  brand: 'Zeco', type: 'AHU', subType: 'Chilled Water', modelSeries: 'CAHU HW',  capacityTR: 15,   capacityBTU: 180000, ratedAirflowCFM: 6000,  staticPressurePa: 175, powerInputKW: 3.70 },
  { id: 'ze-ahu-5',  brand: 'Zeco', type: 'AHU', subType: 'Chilled Water', modelSeries: 'CAHU HW',  capacityTR: 20,   capacityBTU: 240000, ratedAirflowCFM: 8000,  staticPressurePa: 200, powerInputKW: 5.50 },

  // ── VTS VRF-IDU (AHU-DX) ─────────────────────────────────────────────────
  // VTS WING/VENTUS AHU units with DX coil — hospitality-grade, connect to VRF
  { id: 'vt-vrf-idu-1', brand: 'VTS', type: 'VRF-IDU', subType: 'AHU-DX', modelSeries: 'WING DX',   capacityTR: 2.0,  capacityBTU: 24000,  ratedAirflowCFM: 900,   staticPressurePa: 80,  powerInputKW: 0.40 },
  { id: 'vt-vrf-idu-2', brand: 'VTS', type: 'VRF-IDU', subType: 'AHU-DX', modelSeries: 'WING DX',   capacityTR: 3.0,  capacityBTU: 36000,  ratedAirflowCFM: 1350,  staticPressurePa: 100, powerInputKW: 0.60 },
  { id: 'vt-vrf-idu-3', brand: 'VTS', type: 'VRF-IDU', subType: 'AHU-DX', modelSeries: 'WING DX',   capacityTR: 4.0,  capacityBTU: 48000,  ratedAirflowCFM: 1800,  staticPressurePa: 100, powerInputKW: 0.75 },
  { id: 'vt-vrf-idu-4', brand: 'VTS', type: 'VRF-IDU', subType: 'AHU-DX', modelSeries: 'WING DX',   capacityTR: 5.0,  capacityBTU: 60000,  ratedAirflowCFM: 2250,  staticPressurePa: 125, powerInputKW: 1.10 },
  { id: 'vt-vrf-idu-5', brand: 'VTS', type: 'VRF-IDU', subType: 'AHU-DX', modelSeries: 'VENTUS DX', capacityTR: 6.0,  capacityBTU: 72000,  ratedAirflowCFM: 2700,  staticPressurePa: 150, powerInputKW: 1.50 },
  { id: 'vt-vrf-idu-6', brand: 'VTS', type: 'VRF-IDU', subType: 'AHU-DX', modelSeries: 'VENTUS DX', capacityTR: 8.0,  capacityBTU: 96000,  ratedAirflowCFM: 3600,  staticPressurePa: 150, powerInputKW: 1.85 },
  { id: 'vt-vrf-idu-7', brand: 'VTS', type: 'VRF-IDU', subType: 'AHU-DX', modelSeries: 'VENTUS DX', capacityTR: 10.0, capacityBTU: 120000, ratedAirflowCFM: 4500,  staticPressurePa: 175, powerInputKW: 2.20 },

  // ── VTS AHU (Hydronic) ────────────────────────────────────────────────────
  { id: 'vt-ahu-1',  brand: 'VTS', type: 'AHU', subType: 'Chilled Water', modelSeries: 'VENTUS HW', capacityTR: 5,    capacityBTU: 60000,  ratedAirflowCFM: 2000,  staticPressurePa: 125, powerInputKW: 1.10 },
  { id: 'vt-ahu-2',  brand: 'VTS', type: 'AHU', subType: 'Chilled Water', modelSeries: 'VENTUS HW', capacityTR: 7.5,  capacityBTU: 90000,  ratedAirflowCFM: 3000,  staticPressurePa: 150, powerInputKW: 1.50 },
  { id: 'vt-ahu-3',  brand: 'VTS', type: 'AHU', subType: 'Chilled Water', modelSeries: 'VENTUS HW', capacityTR: 10,   capacityBTU: 120000, ratedAirflowCFM: 4000,  staticPressurePa: 150, powerInputKW: 2.20 },
  { id: 'vt-ahu-4',  brand: 'VTS', type: 'AHU', subType: 'Chilled Water', modelSeries: 'VENTUS HW', capacityTR: 15,   capacityBTU: 180000, ratedAirflowCFM: 6000,  staticPressurePa: 175, powerInputKW: 3.70 },
  { id: 'vt-ahu-5',  brand: 'VTS', type: 'AHU', subType: 'Chilled Water', modelSeries: 'VENTUS HW', capacityTR: 20,   capacityBTU: 240000, ratedAirflowCFM: 8000,  staticPressurePa: 200, powerInputKW: 5.50 },

  // ── AIR HANDLING UNITS (Chilled Water) ───────────────────────────────────
  // Typical CHW AHU: ~400 CFM/TR, ESP 100–200 Pa.  Airflow and static are indicative —
  // always verify against manufacturer selection software for final sizing.
  { id: 'bs-ahu-1',  brand: 'Blue Star', type: 'AHU', subType: 'Chilled Water', modelSeries: 'FAHU',       capacityTR: 3,    capacityBTU: 36000,  ratedAirflowCFM: 1200,  staticPressurePa: 100, powerInputKW: 0.75 },
  { id: 'bs-ahu-2',  brand: 'Blue Star', type: 'AHU', subType: 'Chilled Water', modelSeries: 'FAHU',       capacityTR: 5,    capacityBTU: 60000,  ratedAirflowCFM: 2000,  staticPressurePa: 125, powerInputKW: 1.1  },
  { id: 'bs-ahu-3',  brand: 'Blue Star', type: 'AHU', subType: 'Chilled Water', modelSeries: 'FAHU',       capacityTR: 7.5,  capacityBTU: 90000,  ratedAirflowCFM: 3000,  staticPressurePa: 150, powerInputKW: 1.5  },
  { id: 'bs-ahu-4',  brand: 'Blue Star', type: 'AHU', subType: 'Chilled Water', modelSeries: 'FAHU',       capacityTR: 10,   capacityBTU: 120000, ratedAirflowCFM: 4000,  staticPressurePa: 150, powerInputKW: 2.2  },
  { id: 'bs-ahu-5',  brand: 'Blue Star', type: 'AHU', subType: 'Chilled Water', modelSeries: 'FAHU',       capacityTR: 15,   capacityBTU: 180000, ratedAirflowCFM: 6000,  staticPressurePa: 175, powerInputKW: 3.7  },
  { id: 'bs-ahu-6',  brand: 'Blue Star', type: 'AHU', subType: 'Chilled Water', modelSeries: 'FAHU',       capacityTR: 20,   capacityBTU: 240000, ratedAirflowCFM: 8000,  staticPressurePa: 200, powerInputKW: 5.5  },
  { id: 'vo-ahu-1',  brand: 'Voltas',    type: 'AHU', subType: 'Chilled Water', modelSeries: 'V-AHU',      capacityTR: 5,    capacityBTU: 60000,  ratedAirflowCFM: 2000,  staticPressurePa: 125, powerInputKW: 1.1  },
  { id: 'vo-ahu-2',  brand: 'Voltas',    type: 'AHU', subType: 'Chilled Water', modelSeries: 'V-AHU',      capacityTR: 7.5,  capacityBTU: 90000,  ratedAirflowCFM: 3000,  staticPressurePa: 150, powerInputKW: 1.5  },
  { id: 'vo-ahu-3',  brand: 'Voltas',    type: 'AHU', subType: 'Chilled Water', modelSeries: 'V-AHU',      capacityTR: 10,   capacityBTU: 120000, ratedAirflowCFM: 4000,  staticPressurePa: 150, powerInputKW: 2.2  },
  { id: 'vo-ahu-4',  brand: 'Voltas',    type: 'AHU', subType: 'Chilled Water', modelSeries: 'V-AHU',      capacityTR: 15,   capacityBTU: 180000, ratedAirflowCFM: 6000,  staticPressurePa: 175, powerInputKW: 3.7  },
  { id: 'cr-ahu-1',  brand: 'Carrier',   type: 'AHU', subType: 'Chilled Water', modelSeries: 'AHU 39M',    capacityTR: 5,    capacityBTU: 60000,  ratedAirflowCFM: 2000,  staticPressurePa: 150, powerInputKW: 1.1  },
  { id: 'cr-ahu-2',  brand: 'Carrier',   type: 'AHU', subType: 'Chilled Water', modelSeries: 'AHU 39M',    capacityTR: 10,   capacityBTU: 120000, ratedAirflowCFM: 4000,  staticPressurePa: 175, powerInputKW: 2.2  },
  { id: 'cr-ahu-3',  brand: 'Carrier',   type: 'AHU', subType: 'Chilled Water', modelSeries: 'AHU 39M',    capacityTR: 20,   capacityBTU: 240000, ratedAirflowCFM: 8000,  staticPressurePa: 200, powerInputKW: 5.5  },
  { id: 'dk-ahu-1',  brand: 'Daikin',    type: 'AHU', subType: 'Chilled Water', modelSeries: 'AHU DAIKU',  capacityTR: 5,    capacityBTU: 60000,  ratedAirflowCFM: 2000,  staticPressurePa: 125, powerInputKW: 1.1  },
  { id: 'dk-ahu-2',  brand: 'Daikin',    type: 'AHU', subType: 'Chilled Water', modelSeries: 'AHU DAIKU',  capacityTR: 10,   capacityBTU: 120000, ratedAirflowCFM: 4000,  staticPressurePa: 150, powerInputKW: 2.2  },
  { id: 'dk-ahu-3',  brand: 'Daikin',    type: 'AHU', subType: 'Chilled Water', modelSeries: 'AHU DAIKU',  capacityTR: 20,   capacityBTU: 240000, ratedAirflowCFM: 8000,  staticPressurePa: 200, powerInputKW: 5.5  },
  { id: 'bs-ahu-7',  brand: 'Blue Star', type: 'AHU', subType: 'Chilled Water', modelSeries: 'FAHU',       capacityTR: 25,   capacityBTU: 300000, ratedAirflowCFM: 10000, staticPressurePa: 200, powerInputKW: 7.5  },
  { id: 'bs-ahu-8',  brand: 'Blue Star', type: 'AHU', subType: 'Chilled Water', modelSeries: 'FAHU',       capacityTR: 30,   capacityBTU: 360000, ratedAirflowCFM: 12000, staticPressurePa: 225, powerInputKW: 9.3  },
  { id: 'bs-ahu-9',  brand: 'Blue Star', type: 'AHU', subType: 'Chilled Water', modelSeries: 'FAHU',       capacityTR: 40,   capacityBTU: 480000, ratedAirflowCFM: 16000, staticPressurePa: 250, powerInputKW: 11.0 },
  { id: 'bs-ahu-10', brand: 'Blue Star', type: 'AHU', subType: 'Chilled Water', modelSeries: 'FAHU',       capacityTR: 50,   capacityBTU: 600000, ratedAirflowCFM: 20000, staticPressurePa: 250, powerInputKW: 15.0 },
  { id: 'bs-ahu-11', brand: 'Blue Star', type: 'AHU', subType: 'Chilled Water', modelSeries: 'FAHU',       capacityTR: 60,   capacityBTU: 720000, ratedAirflowCFM: 24000, staticPressurePa: 275, powerInputKW: 18.5 },
  { id: 'bs-ahu-12', brand: 'Blue Star', type: 'AHU', subType: 'Chilled Water', modelSeries: 'FAHU',       capacityTR: 80,   capacityBTU: 960000, ratedAirflowCFM: 32000, staticPressurePa: 300, powerInputKW: 22.0 },
  { id: 'bs-ahu-13', brand: 'Blue Star', type: 'AHU', subType: 'Chilled Water', modelSeries: 'FAHU',       capacityTR: 100,  capacityBTU: 1200000,ratedAirflowCFM: 40000, staticPressurePa: 300, powerInputKW: 30.0 },
  { id: 'vo-ahu-5',  brand: 'Voltas',    type: 'AHU', subType: 'Chilled Water', modelSeries: 'V-AHU',      capacityTR: 25,   capacityBTU: 300000, ratedAirflowCFM: 10000, staticPressurePa: 200, powerInputKW: 7.5  },
  { id: 'vo-ahu-6',  brand: 'Voltas',    type: 'AHU', subType: 'Chilled Water', modelSeries: 'V-AHU',      capacityTR: 30,   capacityBTU: 360000, ratedAirflowCFM: 12000, staticPressurePa: 225, powerInputKW: 9.3  },
  { id: 'vo-ahu-7',  brand: 'Voltas',    type: 'AHU', subType: 'Chilled Water', modelSeries: 'V-AHU',      capacityTR: 40,   capacityBTU: 480000, ratedAirflowCFM: 16000, staticPressurePa: 250, powerInputKW: 11.0 },
  { id: 'vo-ahu-8',  brand: 'Voltas',    type: 'AHU', subType: 'Chilled Water', modelSeries: 'V-AHU',      capacityTR: 50,   capacityBTU: 600000, ratedAirflowCFM: 20000, staticPressurePa: 250, powerInputKW: 15.0 },
  { id: 'cr-ahu-4',  brand: 'Carrier',   type: 'AHU', subType: 'Chilled Water', modelSeries: 'AHU 39M',    capacityTR: 25,   capacityBTU: 300000, ratedAirflowCFM: 10000, staticPressurePa: 225, powerInputKW: 7.5  },
  { id: 'cr-ahu-5',  brand: 'Carrier',   type: 'AHU', subType: 'Chilled Water', modelSeries: 'AHU 39M',    capacityTR: 30,   capacityBTU: 360000, ratedAirflowCFM: 12000, staticPressurePa: 225, powerInputKW: 9.3  },
  { id: 'cr-ahu-6',  brand: 'Carrier',   type: 'AHU', subType: 'Chilled Water', modelSeries: 'AHU 39M',    capacityTR: 40,   capacityBTU: 480000, ratedAirflowCFM: 16000, staticPressurePa: 250, powerInputKW: 11.0 },
  { id: 'cr-ahu-7',  brand: 'Carrier',   type: 'AHU', subType: 'Chilled Water', modelSeries: 'AHU 39M',    capacityTR: 50,   capacityBTU: 600000, ratedAirflowCFM: 20000, staticPressurePa: 250, powerInputKW: 15.0 },
  { id: 'dk-ahu-4',  brand: 'Daikin',    type: 'AHU', subType: 'Chilled Water', modelSeries: 'AHU DAIKU',  capacityTR: 25,   capacityBTU: 300000, ratedAirflowCFM: 10000, staticPressurePa: 200, powerInputKW: 7.5  },
  { id: 'dk-ahu-5',  brand: 'Daikin',    type: 'AHU', subType: 'Chilled Water', modelSeries: 'AHU DAIKU',  capacityTR: 30,   capacityBTU: 360000, ratedAirflowCFM: 12000, staticPressurePa: 225, powerInputKW: 9.3  },
  { id: 'dk-ahu-6',  brand: 'Daikin',    type: 'AHU', subType: 'Chilled Water', modelSeries: 'AHU DAIKU',  capacityTR: 40,   capacityBTU: 480000, ratedAirflowCFM: 16000, staticPressurePa: 250, powerInputKW: 11.0 },
  { id: 'dk-ahu-7',  brand: 'Daikin',    type: 'AHU', subType: 'Chilled Water', modelSeries: 'AHU DAIKU',  capacityTR: 50,   capacityBTU: 600000, ratedAirflowCFM: 20000, staticPressurePa: 250, powerInputKW: 15.0 },

  // ── FAN COIL UNITS (Chilled Water) ────────────────────────────────────────
  // Typical CHW FCU: ~450–500 CFM/TR, low static 15–50 Pa.
  { id: 'bs-fcu-1',  brand: 'Blue Star', type: 'FCU', subType: 'Chilled Water', modelSeries: '4-Pipe FCU',  capacityTR: 0.5,  capacityBTU: 6000,   ratedAirflowCFM: 230,   staticPressurePa: 20,  powerInputKW: 0.06 },
  { id: 'bs-fcu-2',  brand: 'Blue Star', type: 'FCU', subType: 'Chilled Water', modelSeries: '4-Pipe FCU',  capacityTR: 0.75, capacityBTU: 9000,   ratedAirflowCFM: 340,   staticPressurePa: 20,  powerInputKW: 0.08 },
  { id: 'bs-fcu-3',  brand: 'Blue Star', type: 'FCU', subType: 'Chilled Water', modelSeries: '4-Pipe FCU',  capacityTR: 1.0,  capacityBTU: 12000,  ratedAirflowCFM: 450,   staticPressurePa: 25,  powerInputKW: 0.10 },
  { id: 'bs-fcu-4',  brand: 'Blue Star', type: 'FCU', subType: 'Chilled Water', modelSeries: '4-Pipe FCU',  capacityTR: 1.5,  capacityBTU: 18000,  ratedAirflowCFM: 680,   staticPressurePa: 30,  powerInputKW: 0.14 },
  { id: 'bs-fcu-5',  brand: 'Blue Star', type: 'FCU', subType: 'Chilled Water', modelSeries: '4-Pipe FCU',  capacityTR: 2.0,  capacityBTU: 24000,  ratedAirflowCFM: 900,   staticPressurePa: 35,  powerInputKW: 0.18 },
  { id: 'cr-fcu-1',  brand: 'Carrier',   type: 'FCU', subType: 'Chilled Water', modelSeries: '42GW FCU',    capacityTR: 0.75, capacityBTU: 9000,   ratedAirflowCFM: 340,   staticPressurePa: 25,  powerInputKW: 0.08 },
  { id: 'cr-fcu-2',  brand: 'Carrier',   type: 'FCU', subType: 'Chilled Water', modelSeries: '42GW FCU',    capacityTR: 1.0,  capacityBTU: 12000,  ratedAirflowCFM: 450,   staticPressurePa: 25,  powerInputKW: 0.10 },
  { id: 'cr-fcu-3',  brand: 'Carrier',   type: 'FCU', subType: 'Chilled Water', modelSeries: '42GW FCU',    capacityTR: 1.5,  capacityBTU: 18000,  ratedAirflowCFM: 680,   staticPressurePa: 30,  powerInputKW: 0.14 },
  { id: 'cr-fcu-4',  brand: 'Carrier',   type: 'FCU', subType: 'Chilled Water', modelSeries: '42GW FCU',    capacityTR: 2.0,  capacityBTU: 24000,  ratedAirflowCFM: 900,   staticPressurePa: 35,  powerInputKW: 0.18 },
  // Daikin — Chilled Water FCU
  { id: 'dk-fcu-1',  brand: 'Daikin', type: 'FCU', subType: 'Chilled Water', modelSeries: 'FWF FCU', capacityTR: 0.5,  capacityBTU:  6000, ratedAirflowCFM:  230, staticPressurePa: 20, powerInputKW: 0.06, source: 'placeholder' },
  { id: 'dk-fcu-2',  brand: 'Daikin', type: 'FCU', subType: 'Chilled Water', modelSeries: 'FWF FCU', capacityTR: 0.75, capacityBTU:  9000, ratedAirflowCFM:  340, staticPressurePa: 20, powerInputKW: 0.08, source: 'placeholder' },
  { id: 'dk-fcu-3',  brand: 'Daikin', type: 'FCU', subType: 'Chilled Water', modelSeries: 'FWF FCU', capacityTR: 1.0,  capacityBTU: 12000, ratedAirflowCFM:  450, staticPressurePa: 25, powerInputKW: 0.10, source: 'placeholder' },
  { id: 'dk-fcu-4',  brand: 'Daikin', type: 'FCU', subType: 'Chilled Water', modelSeries: 'FWF FCU', capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM:  680, staticPressurePa: 30, powerInputKW: 0.14, source: 'placeholder' },
  { id: 'dk-fcu-5',  brand: 'Daikin', type: 'FCU', subType: 'Chilled Water', modelSeries: 'FWF FCU', capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM:  900, staticPressurePa: 35, powerInputKW: 0.18, source: 'placeholder' },
  { id: 'dk-fcu-6',  brand: 'Daikin', type: 'FCU', subType: 'Chilled Water', modelSeries: 'FWF FCU', capacityTR: 2.5,  capacityBTU: 30000, ratedAirflowCFM: 1100, staticPressurePa: 38, powerInputKW: 0.22, source: 'placeholder' },
  { id: 'dk-fcu-7',  brand: 'Daikin', type: 'FCU', subType: 'Chilled Water', modelSeries: 'FWF FCU', capacityTR: 3.0,  capacityBTU: 36000, ratedAirflowCFM: 1350, staticPressurePa: 40, powerInputKW: 0.28, source: 'placeholder' },
  // Voltas — Chilled Water FCU
  { id: 'vo-fcu-1',  brand: 'Voltas', type: 'FCU', subType: 'Chilled Water', modelSeries: 'V-FCU', capacityTR: 0.75, capacityBTU:  9000, ratedAirflowCFM:  340, staticPressurePa: 20, powerInputKW: 0.08, source: 'placeholder' },
  { id: 'vo-fcu-2',  brand: 'Voltas', type: 'FCU', subType: 'Chilled Water', modelSeries: 'V-FCU', capacityTR: 1.0,  capacityBTU: 12000, ratedAirflowCFM:  450, staticPressurePa: 25, powerInputKW: 0.10, source: 'placeholder' },
  { id: 'vo-fcu-3',  brand: 'Voltas', type: 'FCU', subType: 'Chilled Water', modelSeries: 'V-FCU', capacityTR: 1.5,  capacityBTU: 18000, ratedAirflowCFM:  680, staticPressurePa: 30, powerInputKW: 0.14, source: 'placeholder' },
  { id: 'vo-fcu-4',  brand: 'Voltas', type: 'FCU', subType: 'Chilled Water', modelSeries: 'V-FCU', capacityTR: 2.0,  capacityBTU: 24000, ratedAirflowCFM:  900, staticPressurePa: 35, powerInputKW: 0.18, source: 'placeholder' },
  { id: 'vo-fcu-5',  brand: 'Voltas', type: 'FCU', subType: 'Chilled Water', modelSeries: 'V-FCU', capacityTR: 2.5,  capacityBTU: 30000, ratedAirflowCFM: 1100, staticPressurePa: 38, powerInputKW: 0.22, source: 'placeholder' },
  // Blue Star + Carrier — extended FCU range (2.5–3 TR)
  { id: 'bs-fcu-6',  brand: 'Blue Star', type: 'FCU', subType: 'Chilled Water', modelSeries: '4-Pipe FCU', capacityTR: 2.5, capacityBTU: 30000, ratedAirflowCFM: 1100, staticPressurePa: 38, powerInputKW: 0.22, source: 'placeholder' },
  { id: 'bs-fcu-7',  brand: 'Blue Star', type: 'FCU', subType: 'Chilled Water', modelSeries: '4-Pipe FCU', capacityTR: 3.0, capacityBTU: 36000, ratedAirflowCFM: 1350, staticPressurePa: 40, powerInputKW: 0.28, source: 'placeholder' },
  { id: 'cr-fcu-5',  brand: 'Carrier',   type: 'FCU', subType: 'Chilled Water', modelSeries: '42GW FCU',   capacityTR: 2.5, capacityBTU: 30000, ratedAirflowCFM: 1100, staticPressurePa: 38, powerInputKW: 0.22, source: 'placeholder' },
  { id: 'cr-fcu-6',  brand: 'Carrier',   type: 'FCU', subType: 'Chilled Water', modelSeries: '42GW FCU',   capacityTR: 3.0, capacityBTU: 36000, ratedAirflowCFM: 1350, staticPressurePa: 40, powerInputKW: 0.28, source: 'placeholder' },

  // ── RAPIDCOOL RAPID MIST HUMIDIFIERS ─────────────────────────────────────
  // Ultrasonic type — low power, cool mist
  { id: 'rc-hum-us-02', brand: 'Rapidcool', type: 'Humidifier', subType: 'Ultrasonic', modelSeries: 'Rapid Mist RM', capacityTR: 0, capacityBTU: 0, capacityLPH:  2, powerInputKW: 0.14, description: 'RM-2 Ultrasonic Humidifier' },
  { id: 'rc-hum-us-05', brand: 'Rapidcool', type: 'Humidifier', subType: 'Ultrasonic', modelSeries: 'Rapid Mist RM', capacityTR: 0, capacityBTU: 0, capacityLPH:  5, powerInputKW: 0.31, description: 'RM-5 Ultrasonic Humidifier' },
  { id: 'rc-hum-us-10', brand: 'Rapidcool', type: 'Humidifier', subType: 'Ultrasonic', modelSeries: 'Rapid Mist RM', capacityTR: 0, capacityBTU: 0, capacityLPH: 10, powerInputKW: 0.55, description: 'RM-10 Ultrasonic Humidifier' },
  { id: 'rc-hum-us-15', brand: 'Rapidcool', type: 'Humidifier', subType: 'Ultrasonic', modelSeries: 'Rapid Mist RM', capacityTR: 0, capacityBTU: 0, capacityLPH: 15, powerInputKW: 0.85, description: 'RM-15 Ultrasonic Humidifier' },
  { id: 'rc-hum-us-20', brand: 'Rapidcool', type: 'Humidifier', subType: 'Ultrasonic', modelSeries: 'Rapid Mist RM', capacityTR: 0, capacityBTU: 0, capacityLPH: 20, powerInputKW: 1.10, description: 'RM-20 Ultrasonic Humidifier' },
  { id: 'rc-hum-us-25', brand: 'Rapidcool', type: 'Humidifier', subType: 'Ultrasonic', modelSeries: 'Rapid Mist RM', capacityTR: 0, capacityBTU: 0, capacityLPH: 25, powerInputKW: 1.36, description: 'RM-25 Ultrasonic Humidifier' },
  { id: 'rc-hum-us-30', brand: 'Rapidcool', type: 'Humidifier', subType: 'Ultrasonic', modelSeries: 'Rapid Mist RM', capacityTR: 0, capacityBTU: 0, capacityLPH: 30, powerInputKW: 2.28, description: 'RM-30 Ultrasonic Humidifier' },
  // Heater-based type — steam humidifier, higher power
  { id: 'rc-hum-hb-02', brand: 'Rapidcool', type: 'Humidifier', subType: 'Heater-Based', modelSeries: 'Rapid Mist HB', capacityTR: 0, capacityBTU: 0, capacityLPH:  2, powerInputKW:  2.40, description: 'HB-2 Heater-Based Humidifier' },
  { id: 'rc-hum-hb-05', brand: 'Rapidcool', type: 'Humidifier', subType: 'Heater-Based', modelSeries: 'Rapid Mist HB', capacityTR: 0, capacityBTU: 0, capacityLPH:  5, powerInputKW:  4.75, description: 'HB-5 Heater-Based Humidifier' },
  { id: 'rc-hum-hb-10', brand: 'Rapidcool', type: 'Humidifier', subType: 'Heater-Based', modelSeries: 'Rapid Mist HB', capacityTR: 0, capacityBTU: 0, capacityLPH: 10, powerInputKW:  8.00, description: 'HB-10 Heater-Based Humidifier' },
  { id: 'rc-hum-hb-15', brand: 'Rapidcool', type: 'Humidifier', subType: 'Heater-Based', modelSeries: 'Rapid Mist HB', capacityTR: 0, capacityBTU: 0, capacityLPH: 15, powerInputKW: 11.75, description: 'HB-15 Heater-Based Humidifier' },
  { id: 'rc-hum-hb-20', brand: 'Rapidcool', type: 'Humidifier', subType: 'Heater-Based', modelSeries: 'Rapid Mist HB', capacityTR: 0, capacityBTU: 0, capacityLPH: 20, powerInputKW: 15.50, description: 'HB-20 Heater-Based Humidifier' },
  { id: 'rc-hum-hb-25', brand: 'Rapidcool', type: 'Humidifier', subType: 'Heater-Based', modelSeries: 'Rapid Mist HB', capacityTR: 0, capacityBTU: 0, capacityLPH: 25, powerInputKW: 19.25, description: 'HB-25 Heater-Based Humidifier' },
  { id: 'rc-hum-hb-30', brand: 'Rapidcool', type: 'Humidifier', subType: 'Heater-Based', modelSeries: 'Rapid Mist HB', capacityTR: 0, capacityBTU: 0, capacityLPH: 30, powerInputKW: 23.00, description: 'HB-30 Heater-Based Humidifier' },

  // ── STANDALONE DEHUMIDIFIERS ─────────────────────────────────────────────
  // For spaces where latent loads cannot be managed by the cooling system alone.
  // capacityLPH = moisture removal rate (litres/hr) at 27 °C / 60 % RH standard conditions.
  // Convert from psychrometric output: 1 lb/hr ≈ 0.45 LPH.
  // source: placeholder — update model codes and exact specs from manufacturer datasheet.
  // Bry-Air — rotary desiccant (India's leading dehumidifier brand; suited for low-humidity / process areas)
  { id: 'bry-dh-2',  brand: 'Bry-Air', type: 'Dehumidifier', subType: 'Desiccant',       modelSeries: 'PAD-S', capacityTR: 0, capacityBTU: 0, capacityLPH:  2, powerInputKW:  1.5, source: 'placeholder', description: '2 LPH Rotary Desiccant' },
  { id: 'bry-dh-5',  brand: 'Bry-Air', type: 'Dehumidifier', subType: 'Desiccant',       modelSeries: 'PAD-S', capacityTR: 0, capacityBTU: 0, capacityLPH:  5, powerInputKW:  3.0, source: 'placeholder', description: '5 LPH Rotary Desiccant' },
  { id: 'bry-dh-10', brand: 'Bry-Air', type: 'Dehumidifier', subType: 'Desiccant',       modelSeries: 'PAD-M', capacityTR: 0, capacityBTU: 0, capacityLPH: 10, powerInputKW:  5.5, source: 'placeholder', description: '10 LPH Rotary Desiccant' },
  { id: 'bry-dh-20', brand: 'Bry-Air', type: 'Dehumidifier', subType: 'Desiccant',       modelSeries: 'PAD-M', capacityTR: 0, capacityBTU: 0, capacityLPH: 20, powerInputKW: 10.0, source: 'placeholder', description: '20 LPH Rotary Desiccant' },
  { id: 'bry-dh-30', brand: 'Bry-Air', type: 'Dehumidifier', subType: 'Desiccant',       modelSeries: 'PAD-L', capacityTR: 0, capacityBTU: 0, capacityLPH: 30, powerInputKW: 14.0, source: 'placeholder', description: '30 LPH Rotary Desiccant' },
  // DX refrigerant dehumidifier — condensation type (suited for occupied HVAC spaces)
  { id: 'gen-dh-2',  brand: 'Generic',  type: 'Dehumidifier', subType: 'DX-Refrigerant', modelSeries: 'DX Dehumidifier', capacityTR: 0, capacityBTU: 0, capacityLPH:  2, powerInputKW:  0.5, source: 'placeholder', description: '2 LPH DX Refrigerant Dehumidifier' },
  { id: 'gen-dh-5',  brand: 'Generic',  type: 'Dehumidifier', subType: 'DX-Refrigerant', modelSeries: 'DX Dehumidifier', capacityTR: 0, capacityBTU: 0, capacityLPH:  5, powerInputKW:  1.2, source: 'placeholder', description: '5 LPH DX Refrigerant Dehumidifier' },
  { id: 'gen-dh-10', brand: 'Generic',  type: 'Dehumidifier', subType: 'DX-Refrigerant', modelSeries: 'DX Dehumidifier', capacityTR: 0, capacityBTU: 0, capacityLPH: 10, powerInputKW:  2.5, source: 'placeholder', description: '10 LPH DX Refrigerant Dehumidifier' },
  { id: 'gen-dh-20', brand: 'Generic',  type: 'Dehumidifier', subType: 'DX-Refrigerant', modelSeries: 'DX Dehumidifier', capacityTR: 0, capacityBTU: 0, capacityLPH: 20, powerInputKW:  5.0, source: 'placeholder', description: '20 LPH DX Refrigerant Dehumidifier' },
  { id: 'gen-dh-30', brand: 'Generic',  type: 'Dehumidifier', subType: 'DX-Refrigerant', modelSeries: 'DX Dehumidifier', capacityTR: 0, capacityBTU: 0, capacityLPH: 30, powerInputKW:  7.5, source: 'placeholder', description: '30 LPH DX Refrigerant Dehumidifier' },

  // ── TREATED FRESH AIR UNITS — Chilled Water (TFA / FAHU) ─────────────────
  // Handles 100 % outside air only; used alongside main AHU or as dedicated pre-conditioned
  // fresh air supply in chiller systems. Cool + dehumidify outside air before mixing.
  // Capacity rule of thumb (hot & humid India climate): ~1 TR per 170 CFM of outside air.
  // source: placeholder — sizes indicative; confirm with AHU manufacturer selection program.
  { id: 'bs-tfa-chw-1', brand: 'Blue Star', type: 'AHU', subType: 'Fresh Air HW', modelSeries: 'FAHU-OA', capacityTR:  3, capacityBTU:  36000, ratedAirflowCFM:  500, staticPressurePa: 100, powerInputKW: 0.75, source: 'placeholder', description: 'TFA 500 CFM OA · CHW coil' },
  { id: 'bs-tfa-chw-2', brand: 'Blue Star', type: 'AHU', subType: 'Fresh Air HW', modelSeries: 'FAHU-OA', capacityTR:  6, capacityBTU:  72000, ratedAirflowCFM: 1000, staticPressurePa: 100, powerInputKW: 1.10, source: 'placeholder', description: 'TFA 1000 CFM OA · CHW coil' },
  { id: 'bs-tfa-chw-3', brand: 'Blue Star', type: 'AHU', subType: 'Fresh Air HW', modelSeries: 'FAHU-OA', capacityTR:  9, capacityBTU: 108000, ratedAirflowCFM: 1500, staticPressurePa: 125, powerInputKW: 1.50, source: 'placeholder', description: 'TFA 1500 CFM OA · CHW coil' },
  { id: 'bs-tfa-chw-4', brand: 'Blue Star', type: 'AHU', subType: 'Fresh Air HW', modelSeries: 'FAHU-OA', capacityTR: 12, capacityBTU: 144000, ratedAirflowCFM: 2000, staticPressurePa: 125, powerInputKW: 2.20, source: 'placeholder', description: 'TFA 2000 CFM OA · CHW coil' },
  { id: 'bs-tfa-chw-5', brand: 'Blue Star', type: 'AHU', subType: 'Fresh Air HW', modelSeries: 'FAHU-OA', capacityTR: 18, capacityBTU: 216000, ratedAirflowCFM: 3000, staticPressurePa: 150, powerInputKW: 3.00, source: 'placeholder', description: 'TFA 3000 CFM OA · CHW coil' },
  { id: 'bs-tfa-chw-6', brand: 'Blue Star', type: 'AHU', subType: 'Fresh Air HW', modelSeries: 'FAHU-OA', capacityTR: 24, capacityBTU: 288000, ratedAirflowCFM: 4000, staticPressurePa: 150, powerInputKW: 4.00, source: 'placeholder', description: 'TFA 4000 CFM OA · CHW coil' },
  { id: 'cr-tfa-chw-1',  brand: 'Carrier',   type: 'AHU', subType: 'Fresh Air HW', modelSeries: 'FAHU 39MQ', capacityTR:  5, capacityBTU:  60000, ratedAirflowCFM:  800, staticPressurePa: 100, powerInputKW: 0.90, source: 'placeholder', description: 'TFA 800 CFM OA · CHW coil' },
  { id: 'cr-tfa-chw-2',  brand: 'Carrier',   type: 'AHU', subType: 'Fresh Air HW', modelSeries: 'FAHU 39MQ', capacityTR: 10, capacityBTU: 120000, ratedAirflowCFM: 1700, staticPressurePa: 125, powerInputKW: 1.80, source: 'placeholder', description: 'TFA 1700 CFM OA · CHW coil' },
  { id: 'cr-tfa-chw-3',  brand: 'Carrier',   type: 'AHU', subType: 'Fresh Air HW', modelSeries: 'FAHU 39MQ', capacityTR: 15, capacityBTU: 180000, ratedAirflowCFM: 2500, staticPressurePa: 150, powerInputKW: 2.50, source: 'placeholder', description: 'TFA 2500 CFM OA · CHW coil' },
  { id: 'dk-tfa-chw-1',  brand: 'Daikin',    type: 'AHU', subType: 'Fresh Air HW', modelSeries: 'FAHU DAIKU-OA', capacityTR:  6, capacityBTU:  72000, ratedAirflowCFM: 1000, staticPressurePa: 100, powerInputKW: 1.10, source: 'placeholder', description: 'TFA 1000 CFM OA · CHW coil' },
  { id: 'dk-tfa-chw-2',  brand: 'Daikin',    type: 'AHU', subType: 'Fresh Air HW', modelSeries: 'FAHU DAIKU-OA', capacityTR: 12, capacityBTU: 144000, ratedAirflowCFM: 2000, staticPressurePa: 125, powerInputKW: 2.20, source: 'placeholder', description: 'TFA 2000 CFM OA · CHW coil' },
  { id: 'dk-tfa-chw-3',  brand: 'Daikin',    type: 'AHU', subType: 'Fresh Air HW', modelSeries: 'FAHU DAIKU-OA', capacityTR: 18, capacityBTU: 216000, ratedAirflowCFM: 3000, staticPressurePa: 150, powerInputKW: 3.00, source: 'placeholder', description: 'TFA 3000 CFM OA · CHW coil' },

  // ── COOLING TOWERS ───────────────────────────────────────────────────────
  // Required for every Chiller WC system.
  // Size rule: cooling tower nominal TR ≥ chiller TR × 1.25 (covers condenser heat rejection).
  // capacityTR here = nominal CT tons at AHRI standard (95 °F in / 85 °F out / 78 °F WB).
  // powerInputKW = fan motor only (excludes condenser water pump).
  // source: placeholder — Paharpur & SPX Marley are real brands; confirm exact model & specs.
  // Paharpur PFC Series — FRP induced-draft counterflow (India market leader)
  { id: 'pahp-ct-20',  brand: 'Paharpur',   type: 'CoolingTower', subType: 'Induced Draft', modelSeries: 'PFC Series', capacityTR:  20, capacityBTU:  240000, powerInputKW: 0.37, source: 'placeholder', description: '20 TR · FRP Induced-Draft Counterflow' },
  { id: 'pahp-ct-30',  brand: 'Paharpur',   type: 'CoolingTower', subType: 'Induced Draft', modelSeries: 'PFC Series', capacityTR:  30, capacityBTU:  360000, powerInputKW: 0.55, source: 'placeholder', description: '30 TR · FRP Induced-Draft Counterflow' },
  { id: 'pahp-ct-50',  brand: 'Paharpur',   type: 'CoolingTower', subType: 'Induced Draft', modelSeries: 'PFC Series', capacityTR:  50, capacityBTU:  600000, powerInputKW: 0.75, source: 'placeholder', description: '50 TR · FRP Induced-Draft Counterflow' },
  { id: 'pahp-ct-75',  brand: 'Paharpur',   type: 'CoolingTower', subType: 'Induced Draft', modelSeries: 'PFC Series', capacityTR:  75, capacityBTU:  900000, powerInputKW: 1.10, source: 'placeholder', description: '75 TR · FRP Induced-Draft Counterflow' },
  { id: 'pahp-ct-100', brand: 'Paharpur',   type: 'CoolingTower', subType: 'Induced Draft', modelSeries: 'PFC Series', capacityTR: 100, capacityBTU: 1200000, powerInputKW: 1.50, source: 'placeholder', description: '100 TR · FRP Induced-Draft Counterflow' },
  { id: 'pahp-ct-150', brand: 'Paharpur',   type: 'CoolingTower', subType: 'Induced Draft', modelSeries: 'PFC Series', capacityTR: 150, capacityBTU: 1800000, powerInputKW: 2.20, source: 'placeholder', description: '150 TR · FRP Induced-Draft Counterflow' },
  { id: 'pahp-ct-200', brand: 'Paharpur',   type: 'CoolingTower', subType: 'Induced Draft', modelSeries: 'PFC Series', capacityTR: 200, capacityBTU: 2400000, powerInputKW: 3.00, source: 'placeholder', description: '200 TR · FRP Induced-Draft Counterflow' },
  // SPX Marley NC Series — international benchmark (widely specified in commercial projects)
  { id: 'spx-ct-50',   brand: 'SPX Marley', type: 'CoolingTower', subType: 'Induced Draft', modelSeries: 'NC Series', capacityTR:  50, capacityBTU:  600000, powerInputKW: 0.75, source: 'placeholder', description: '50 TR · Induced-Draft Counterflow' },
  { id: 'spx-ct-100',  brand: 'SPX Marley', type: 'CoolingTower', subType: 'Induced Draft', modelSeries: 'NC Series', capacityTR: 100, capacityBTU: 1200000, powerInputKW: 1.50, source: 'placeholder', description: '100 TR · Induced-Draft Counterflow' },
  { id: 'spx-ct-150',  brand: 'SPX Marley', type: 'CoolingTower', subType: 'Induced Draft', modelSeries: 'NC Series', capacityTR: 150, capacityBTU: 1800000, powerInputKW: 2.20, source: 'placeholder', description: '150 TR · Induced-Draft Counterflow' },
  { id: 'spx-ct-200',  brand: 'SPX Marley', type: 'CoolingTower', subType: 'Induced Draft', modelSeries: 'NC Series', capacityTR: 200, capacityBTU: 2400000, powerInputKW: 3.00, source: 'placeholder', description: '200 TR · Induced-Draft Counterflow' },

  // ── HOT WATER BOILERS / HEATING UNITS ────────────────────────────────────
  // Supply hot water (50–80 °C) to AHU heating coils, FCU heating coils, and reheat coils.
  // heatOutputKW = thermal output; powerInputKW = electrical input (electric boiler) or
  //   auxiliary power only (gas-fired — gas heat input is not modelled in powerInputKW).
  // source: placeholder — sizes and brands indicative; verify with actual project requirements.
  // Electric Hot Water Boilers (Chromalox CES Series — efficiency ~98 %)
  { id: 'elec-boil-6',   brand: 'Chromalox', type: 'Boiler', subType: 'Electric HW', modelSeries: 'CES', capacityTR: 0, capacityBTU:  20480, powerInputKW:  6.0, heatOutputKW:  6.0, source: 'placeholder', description: '6 kW Electric HW Boiler' },
  { id: 'elec-boil-12',  brand: 'Chromalox', type: 'Boiler', subType: 'Electric HW', modelSeries: 'CES', capacityTR: 0, capacityBTU:  40960, powerInputKW: 12.0, heatOutputKW: 12.0, source: 'placeholder', description: '12 kW Electric HW Boiler' },
  { id: 'elec-boil-18',  brand: 'Chromalox', type: 'Boiler', subType: 'Electric HW', modelSeries: 'CES', capacityTR: 0, capacityBTU:  61440, powerInputKW: 18.0, heatOutputKW: 18.0, source: 'placeholder', description: '18 kW Electric HW Boiler' },
  { id: 'elec-boil-24',  brand: 'Chromalox', type: 'Boiler', subType: 'Electric HW', modelSeries: 'CES', capacityTR: 0, capacityBTU:  81920, powerInputKW: 24.0, heatOutputKW: 24.0, source: 'placeholder', description: '24 kW Electric HW Boiler' },
  { id: 'elec-boil-36',  brand: 'Chromalox', type: 'Boiler', subType: 'Electric HW', modelSeries: 'CES', capacityTR: 0, capacityBTU: 122880, powerInputKW: 36.0, heatOutputKW: 36.0, source: 'placeholder', description: '36 kW Electric HW Boiler' },
  { id: 'elec-boil-60',  brand: 'Chromalox', type: 'Boiler', subType: 'Electric HW', modelSeries: 'CES', capacityTR: 0, capacityBTU: 204800, powerInputKW: 60.0, heatOutputKW: 60.0, source: 'placeholder', description: '60 kW Electric HW Boiler' },
  // Gas-Fired Hot Water Boilers (Thermax Thermion — widely used in India commercial/industrial)
  { id: 'thrm-boil-50',  brand: 'Thermax', type: 'Boiler', subType: 'Gas-Fired HW', modelSeries: 'Thermion', capacityTR: 0, capacityBTU: 170670, powerInputKW:  3.0, heatOutputKW:  50.0, source: 'placeholder', description: '50 kW Gas-Fired HW Boiler' },
  { id: 'thrm-boil-100', brand: 'Thermax', type: 'Boiler', subType: 'Gas-Fired HW', modelSeries: 'Thermion', capacityTR: 0, capacityBTU: 341340, powerInputKW:  5.0, heatOutputKW: 100.0, source: 'placeholder', description: '100 kW Gas-Fired HW Boiler' },
  { id: 'thrm-boil-150', brand: 'Thermax', type: 'Boiler', subType: 'Gas-Fired HW', modelSeries: 'Thermion', capacityTR: 0, capacityBTU: 512010, powerInputKW:  7.5, heatOutputKW: 150.0, source: 'placeholder', description: '150 kW Gas-Fired HW Boiler' },
  { id: 'thrm-boil-200', brand: 'Thermax', type: 'Boiler', subType: 'Gas-Fired HW', modelSeries: 'Thermion', capacityTR: 0, capacityBTU: 682680, powerInputKW: 10.0, heatOutputKW: 200.0, source: 'placeholder', description: '200 kW Gas-Fired HW Boiler' },

  // ── EXPANDED CHILLERS — Larger Sizes + More Brands ───────────────────────
  // source: placeholder — specs are indicative typical values for the capacity class.
  // Blue Star XAC — Air-Cooled Screw (>120 TR, extending existing scroll range)
  { id: 'bs-chil-xac-150', brand: 'Blue Star', type: 'Chiller', subType: 'Air-Cooled Screw',  modelSeries: 'XAC Screw',  capacityTR: 150, capacityBTU: 1800000, refrigerant: 'R134a', cop: 2.80, powerInputKW: 160, ratedAirflowCFM: 60000, source: 'placeholder' },
  { id: 'bs-chil-xac-200', brand: 'Blue Star', type: 'Chiller', subType: 'Air-Cooled Screw',  modelSeries: 'XAC Screw',  capacityTR: 200, capacityBTU: 2400000, refrigerant: 'R134a', cop: 2.85, powerInputKW: 210, ratedAirflowCFM: 80000, source: 'placeholder' },
  // Blue Star XWC — Water-Cooled Screw (>84 TR, extending existing scroll range)
  { id: 'bs-chil-xwc-100', brand: 'Blue Star', type: 'Chiller', subType: 'Water-Cooled Screw', modelSeries: 'XWC Screw',  capacityTR: 100, capacityBTU: 1200000, refrigerant: 'R134a', cop: 5.20, powerInputKW:  69, source: 'placeholder' },
  { id: 'bs-chil-xwc-150', brand: 'Blue Star', type: 'Chiller', subType: 'Water-Cooled Screw', modelSeries: 'XWC Screw',  capacityTR: 150, capacityBTU: 1800000, refrigerant: 'R134a', cop: 5.30, powerInputKW: 101, source: 'placeholder' },
  { id: 'bs-chil-xwc-200', brand: 'Blue Star', type: 'Chiller', subType: 'Water-Cooled Screw', modelSeries: 'XWC Screw',  capacityTR: 200, capacityBTU: 2400000, refrigerant: 'R134a', cop: 5.40, powerInputKW: 132, source: 'placeholder' },
  // Carrier 30XA — Air-Cooled Screw
  { id: 'cr-chil-30xa-80',  brand: 'Carrier', type: 'Chiller', subType: 'Air-Cooled Screw',   modelSeries: '30XA',  capacityTR:  80, capacityBTU:  960000, refrigerant: 'R410A', cop: 2.78, powerInputKW: 103, ratedAirflowCFM: 32000, source: 'placeholder' },
  { id: 'cr-chil-30xa-120', brand: 'Carrier', type: 'Chiller', subType: 'Air-Cooled Screw',   modelSeries: '30XA',  capacityTR: 120, capacityBTU: 1440000, refrigerant: 'R410A', cop: 2.82, powerInputKW: 152, ratedAirflowCFM: 48000, source: 'placeholder' },
  { id: 'cr-chil-30xa-160', brand: 'Carrier', type: 'Chiller', subType: 'Air-Cooled Screw',   modelSeries: '30XA',  capacityTR: 160, capacityBTU: 1920000, refrigerant: 'R410A', cop: 2.85, powerInputKW: 200, ratedAirflowCFM: 64000, source: 'placeholder' },
  { id: 'cr-chil-30xa-200', brand: 'Carrier', type: 'Chiller', subType: 'Air-Cooled Screw',   modelSeries: '30XA',  capacityTR: 200, capacityBTU: 2400000, refrigerant: 'R410A', cop: 2.88, powerInputKW: 250, ratedAirflowCFM: 80000, source: 'placeholder' },
  // Carrier 30HXC — Water-Cooled Screw
  { id: 'cr-chil-30hxc-100', brand: 'Carrier', type: 'Chiller', subType: 'Water-Cooled Screw', modelSeries: '30HXC', capacityTR: 100, capacityBTU: 1200000, refrigerant: 'R134a', cop: 5.10, powerInputKW:  70, source: 'placeholder' },
  { id: 'cr-chil-30hxc-150', brand: 'Carrier', type: 'Chiller', subType: 'Water-Cooled Screw', modelSeries: '30HXC', capacityTR: 150, capacityBTU: 1800000, refrigerant: 'R134a', cop: 5.20, powerInputKW: 103, source: 'placeholder' },
  { id: 'cr-chil-30hxc-200', brand: 'Carrier', type: 'Chiller', subType: 'Water-Cooled Screw', modelSeries: '30HXC', capacityTR: 200, capacityBTU: 2400000, refrigerant: 'R134a', cop: 5.30, powerInputKW: 135, source: 'placeholder' },
  { id: 'cr-chil-30hxc-250', brand: 'Carrier', type: 'Chiller', subType: 'Water-Cooled Screw', modelSeries: '30HXC', capacityTR: 250, capacityBTU: 3000000, refrigerant: 'R134a', cop: 5.40, powerInputKW: 165, source: 'placeholder' },
  // Daikin EWAD — Air-Cooled Inverter Screw
  { id: 'dk-chil-ewad-100', brand: 'Daikin', type: 'Chiller', subType: 'Air-Cooled Screw',    modelSeries: 'EWAD',  capacityTR: 100, capacityBTU: 1200000, refrigerant: 'R410A', cop: 3.00, powerInputKW: 120, ratedAirflowCFM: 40000, source: 'placeholder' },
  { id: 'dk-chil-ewad-150', brand: 'Daikin', type: 'Chiller', subType: 'Air-Cooled Screw',    modelSeries: 'EWAD',  capacityTR: 150, capacityBTU: 1800000, refrigerant: 'R410A', cop: 3.00, powerInputKW: 175, ratedAirflowCFM: 60000, source: 'placeholder' },
  { id: 'dk-chil-ewad-200', brand: 'Daikin', type: 'Chiller', subType: 'Air-Cooled Screw',    modelSeries: 'EWAD',  capacityTR: 200, capacityBTU: 2400000, refrigerant: 'R410A', cop: 3.05, powerInputKW: 235, ratedAirflowCFM: 80000, source: 'placeholder' },
  // Daikin EWWQ — Water-Cooled Inverter Screw
  { id: 'dk-chil-ewwq-100', brand: 'Daikin', type: 'Chiller', subType: 'Water-Cooled Screw',  modelSeries: 'EWWQ',  capacityTR: 100, capacityBTU: 1200000, refrigerant: 'R134a', cop: 5.50, powerInputKW:  65, source: 'placeholder' },
  { id: 'dk-chil-ewwq-200', brand: 'Daikin', type: 'Chiller', subType: 'Water-Cooled Screw',  modelSeries: 'EWWQ',  capacityTR: 200, capacityBTU: 2400000, refrigerant: 'R134a', cop: 5.60, powerInputKW: 128, source: 'placeholder' },

  // ── EXPANDED PACKAGE UNITS — Larger Sizes + More Brands ─────────────────
  // source: placeholder — confirm model codes and exact specs with manufacturer.
  // Blue Star — Air-Cooled (extended range 12–30 TR)
  { id: 'bs-pac-12', brand: 'Blue Star', type: 'Package', subType: 'air-cooled', modelSeries: 'Packaged Unit', capacityTR: 12, capacityBTU: 144000, refrigerant: 'R410A', eer: 11.5, powerInputKW: 14.0, source: 'placeholder' },
  { id: 'bs-pac-15', brand: 'Blue Star', type: 'Package', subType: 'air-cooled', modelSeries: 'Packaged Unit', capacityTR: 15, capacityBTU: 180000, refrigerant: 'R410A', eer: 11.5, powerInputKW: 17.5, source: 'placeholder' },
  { id: 'bs-pac-20', brand: 'Blue Star', type: 'Package', subType: 'air-cooled', modelSeries: 'Packaged Unit', capacityTR: 20, capacityBTU: 240000, refrigerant: 'R410A', eer: 11.4, powerInputKW: 23.0, source: 'placeholder' },
  { id: 'bs-pac-25', brand: 'Blue Star', type: 'Package', subType: 'air-cooled', modelSeries: 'Packaged Unit', capacityTR: 25, capacityBTU: 300000, refrigerant: 'R410A', eer: 11.3, powerInputKW: 29.0, source: 'placeholder' },
  { id: 'bs-pac-30', brand: 'Blue Star', type: 'Package', subType: 'air-cooled', modelSeries: 'Packaged Unit', capacityTR: 30, capacityBTU: 360000, refrigerant: 'R410A', eer: 11.2, powerInputKW: 34.0, source: 'placeholder' },
  // Carrier 50GX — Air-Cooled Rooftop Package
  { id: 'cr-pac-10', brand: 'Carrier', type: 'Package', subType: 'air-cooled', modelSeries: '50GX Rooftop', capacityTR: 10, capacityBTU: 120000, refrigerant: 'R410A', eer: 11.6, powerInputKW: 11.5, source: 'placeholder' },
  { id: 'cr-pac-15', brand: 'Carrier', type: 'Package', subType: 'air-cooled', modelSeries: '50GX Rooftop', capacityTR: 15, capacityBTU: 180000, refrigerant: 'R410A', eer: 11.5, powerInputKW: 17.5, source: 'placeholder' },
  { id: 'cr-pac-20', brand: 'Carrier', type: 'Package', subType: 'air-cooled', modelSeries: '50GX Rooftop', capacityTR: 20, capacityBTU: 240000, refrigerant: 'R410A', eer: 11.5, powerInputKW: 23.0, source: 'placeholder' },
  { id: 'cr-pac-25', brand: 'Carrier', type: 'Package', subType: 'air-cooled', modelSeries: '50GX Rooftop', capacityTR: 25, capacityBTU: 300000, refrigerant: 'R410A', eer: 11.4, powerInputKW: 28.5, source: 'placeholder' },
  { id: 'cr-pac-30', brand: 'Carrier', type: 'Package', subType: 'air-cooled', modelSeries: '50GX Rooftop', capacityTR: 30, capacityBTU: 360000, refrigerant: 'R410A', eer: 11.4, powerInputKW: 34.0, source: 'placeholder' },
  // Daikin RQ — Air-Cooled Rooftop Package
  { id: 'dk-pac-10', brand: 'Daikin', type: 'Package', subType: 'air-cooled', modelSeries: 'RQ Rooftop', capacityTR: 10, capacityBTU: 120000, refrigerant: 'R410A', eer: 11.5, powerInputKW: 11.7, source: 'placeholder' },
  { id: 'dk-pac-15', brand: 'Daikin', type: 'Package', subType: 'air-cooled', modelSeries: 'RQ Rooftop', capacityTR: 15, capacityBTU: 180000, refrigerant: 'R410A', eer: 11.5, powerInputKW: 17.5, source: 'placeholder' },
  { id: 'dk-pac-20', brand: 'Daikin', type: 'Package', subType: 'air-cooled', modelSeries: 'RQ Rooftop', capacityTR: 20, capacityBTU: 240000, refrigerant: 'R410A', eer: 11.4, powerInputKW: 23.5, source: 'placeholder' },
  // Water-Cooled Package — Blue Star
  { id: 'bs-wcp-10', brand: 'Blue Star', type: 'Package', subType: 'water-cooled', modelSeries: 'WCP Series', capacityTR: 10, capacityBTU: 120000, refrigerant: 'R410A', cop: 3.60, powerInputKW: 10.0, source: 'placeholder' },
  { id: 'bs-wcp-15', brand: 'Blue Star', type: 'Package', subType: 'water-cooled', modelSeries: 'WCP Series', capacityTR: 15, capacityBTU: 180000, refrigerant: 'R410A', cop: 3.70, powerInputKW: 14.5, source: 'placeholder' },
  { id: 'bs-wcp-20', brand: 'Blue Star', type: 'Package', subType: 'water-cooled', modelSeries: 'WCP Series', capacityTR: 20, capacityBTU: 240000, refrigerant: 'R410A', cop: 3.75, powerInputKW: 19.0, source: 'placeholder' },

  // ── EXPANDED DUCTABLE SPLIT — Larger Sizes + More Brands ────────────────
  // source: placeholder — confirm model codes; Blue Star DBHW and Daikin FDQ are real series.
  // Blue Star DBHW Hi-ESP — larger sizes
  { id: 'bs-ds-6',  brand: 'Blue Star', type: 'DuctableSplit', subType: 'inverter', modelSeries: 'DBHW Hi-ESP', capacityTR:  6, capacityBTU:  72000, refrigerant: 'R32', eer: 13.0, powerInputKW:  6.2, staticPressurePa:  60, source: 'placeholder' },
  { id: 'bs-ds-8',  brand: 'Blue Star', type: 'DuctableSplit', subType: 'inverter', modelSeries: 'DBHW Hi-ESP', capacityTR:  8, capacityBTU:  96000, refrigerant: 'R32', eer: 13.0, powerInputKW:  8.3, staticPressurePa:  80, source: 'placeholder' },
  { id: 'bs-ds-10', brand: 'Blue Star', type: 'DuctableSplit', subType: 'inverter', modelSeries: 'DBHW Hi-ESP', capacityTR: 10, capacityBTU: 120000, refrigerant: 'R32', eer: 12.8, powerInputKW: 10.5, staticPressurePa: 100, source: 'placeholder' },
  // Daikin FDQ Series — full range
  { id: 'dk-ds-2',  brand: 'Daikin', type: 'DuctableSplit', subType: 'inverter', modelSeries: 'FDQ Series', capacityTR:  2, capacityBTU:  24000, refrigerant: 'R32', eer: 13.5, powerInputKW:  2.0, staticPressurePa:  40, source: 'placeholder' },
  { id: 'dk-ds-3',  brand: 'Daikin', type: 'DuctableSplit', subType: 'inverter', modelSeries: 'FDQ Series', capacityTR:  3, capacityBTU:  36000, refrigerant: 'R32', eer: 13.5, powerInputKW:  3.0, staticPressurePa:  50, source: 'placeholder' },
  { id: 'dk-ds-4',  brand: 'Daikin', type: 'DuctableSplit', subType: 'inverter', modelSeries: 'FDQ Series', capacityTR:  4, capacityBTU:  48000, refrigerant: 'R32', eer: 13.2, powerInputKW:  4.1, staticPressurePa:  50, source: 'placeholder' },
  { id: 'dk-ds-5',  brand: 'Daikin', type: 'DuctableSplit', subType: 'inverter', modelSeries: 'FDQ Series', capacityTR:  5, capacityBTU:  60000, refrigerant: 'R32', eer: 13.0, powerInputKW:  5.2, staticPressurePa:  60, source: 'placeholder' },
  { id: 'dk-ds-6',  brand: 'Daikin', type: 'DuctableSplit', subType: 'inverter', modelSeries: 'FDQ Series', capacityTR:  6, capacityBTU:  72000, refrigerant: 'R32', eer: 13.0, powerInputKW:  6.2, staticPressurePa:  60, source: 'placeholder' },
  { id: 'dk-ds-8',  brand: 'Daikin', type: 'DuctableSplit', subType: 'inverter', modelSeries: 'FDQ Series', capacityTR:  8, capacityBTU:  96000, refrigerant: 'R32', eer: 12.8, powerInputKW:  8.4, staticPressurePa:  80, source: 'placeholder' },
  { id: 'dk-ds-10', brand: 'Daikin', type: 'DuctableSplit', subType: 'inverter', modelSeries: 'FDQ Series', capacityTR: 10, capacityBTU: 120000, refrigerant: 'R32', eer: 12.5, powerInputKW: 10.8, staticPressurePa: 100, source: 'placeholder' },

  // ── EXPANDED SPLIT UNITS — Full Capacity Range, Multiple Brands ──────────
  // Inverter wall-mounted split AC for room-by-room installations.
  // Blue Star IA Plus
  { id: 'bs-split-0.75', brand: 'Blue Star', type: 'Split', subType: 'Inverter', modelSeries: 'IA Plus', capacityTR: 0.75, capacityBTU:  9000, refrigerant: 'R32', eer: 14.5, powerInputKW: 0.75 },
  { id: 'bs-split-1.0',  brand: 'Blue Star', type: 'Split', subType: 'Inverter', modelSeries: 'IA Plus', capacityTR: 1.0,  capacityBTU: 12000, refrigerant: 'R32', eer: 14.0, powerInputKW: 1.00 },
  { id: 'bs-split-1.5',  brand: 'Blue Star', type: 'Split', subType: 'Inverter', modelSeries: 'IA Plus', capacityTR: 1.5,  capacityBTU: 18000, refrigerant: 'R32', eer: 13.8, powerInputKW: 1.45 },
  { id: 'bs-split-2.0',  brand: 'Blue Star', type: 'Split', subType: 'Inverter', modelSeries: 'IA Plus', capacityTR: 2.0,  capacityBTU: 24000, refrigerant: 'R32', eer: 13.5, powerInputKW: 1.90 },
  // Daikin FTKM Inverter
  { id: 'dk-split-0.75', brand: 'Daikin', type: 'Split', subType: 'Inverter', modelSeries: 'FTKM', capacityTR: 0.75, capacityBTU:  9000, refrigerant: 'R32', eer: 15.0, powerInputKW: 0.72, source: 'placeholder' },
  { id: 'dk-split-1.0',  brand: 'Daikin', type: 'Split', subType: 'Inverter', modelSeries: 'FTKM', capacityTR: 1.0,  capacityBTU: 12000, refrigerant: 'R32', eer: 14.8, powerInputKW: 0.95, source: 'placeholder' },
  { id: 'dk-split-1.5',  brand: 'Daikin', type: 'Split', subType: 'Inverter', modelSeries: 'FTKM', capacityTR: 1.5,  capacityBTU: 18000, refrigerant: 'R32', eer: 14.5, powerInputKW: 1.40, source: 'placeholder' },
  { id: 'dk-split-2.0',  brand: 'Daikin', type: 'Split', subType: 'Inverter', modelSeries: 'FTKM', capacityTR: 2.0,  capacityBTU: 24000, refrigerant: 'R32', eer: 14.2, powerInputKW: 1.85, source: 'placeholder' },
  // Samsung AR WindFree Inverter
  { id: 'sm-split-0.75', brand: 'Samsung', type: 'Split', subType: 'Inverter', modelSeries: 'AR WindFree', capacityTR: 0.75, capacityBTU:  9000, refrigerant: 'R32', eer: 14.5, powerInputKW: 0.74, source: 'placeholder' },
  { id: 'sm-split-1.0',  brand: 'Samsung', type: 'Split', subType: 'Inverter', modelSeries: 'AR WindFree', capacityTR: 1.0,  capacityBTU: 12000, refrigerant: 'R32', eer: 14.3, powerInputKW: 0.99, source: 'placeholder' },
  { id: 'sm-split-1.5',  brand: 'Samsung', type: 'Split', subType: 'Inverter', modelSeries: 'AR WindFree', capacityTR: 1.5,  capacityBTU: 18000, refrigerant: 'R32', eer: 14.0, powerInputKW: 1.44, source: 'placeholder' },
  { id: 'sm-split-2.0',  brand: 'Samsung', type: 'Split', subType: 'Inverter', modelSeries: 'AR WindFree', capacityTR: 2.0,  capacityBTU: 24000, refrigerant: 'R32', eer: 13.8, powerInputKW: 1.90, source: 'placeholder' },
  // LG Dual Inverter
  { id: 'lg-split-0.75', brand: 'LG', type: 'Split', subType: 'Inverter', modelSeries: 'Dual Inverter', capacityTR: 0.75, capacityBTU:  9000, refrigerant: 'R32', eer: 14.5, powerInputKW: 0.74, source: 'placeholder' },
  { id: 'lg-split-1.0',  brand: 'LG', type: 'Split', subType: 'Inverter', modelSeries: 'Dual Inverter', capacityTR: 1.0,  capacityBTU: 12000, refrigerant: 'R32', eer: 14.5, powerInputKW: 0.97, source: 'placeholder' },
  { id: 'lg-split-1.5',  brand: 'LG', type: 'Split', subType: 'Inverter', modelSeries: 'Dual Inverter', capacityTR: 1.5,  capacityBTU: 18000, refrigerant: 'R32', eer: 14.2, powerInputKW: 1.42, source: 'placeholder' },
  { id: 'lg-split-2.0',  brand: 'LG', type: 'Split', subType: 'Inverter', modelSeries: 'Dual Inverter', capacityTR: 2.0,  capacityBTU: 24000, refrigerant: 'R32', eer: 14.0, powerInputKW: 1.88, source: 'placeholder' },
  // Mitsubishi MSZ-AP Inverter
  { id: 'mt-split-0.75', brand: 'Mitsubishi', type: 'Split', subType: 'Inverter', modelSeries: 'MSZ-AP', capacityTR: 0.75, capacityBTU:  9000, refrigerant: 'R32', eer: 15.5, powerInputKW: 0.70, source: 'placeholder' },
  { id: 'mt-split-1.0',  brand: 'Mitsubishi', type: 'Split', subType: 'Inverter', modelSeries: 'MSZ-AP', capacityTR: 1.0,  capacityBTU: 12000, refrigerant: 'R32', eer: 15.5, powerInputKW: 0.92, source: 'placeholder' },
  { id: 'mt-split-1.5',  brand: 'Mitsubishi', type: 'Split', subType: 'Inverter', modelSeries: 'MSZ-AP', capacityTR: 1.5,  capacityBTU: 18000, refrigerant: 'R32', eer: 15.0, powerInputKW: 1.42, source: 'placeholder' },
  { id: 'mt-split-2.0',  brand: 'Mitsubishi', type: 'Split', subType: 'Inverter', modelSeries: 'MSZ-AP', capacityTR: 2.0,  capacityBTU: 24000, refrigerant: 'R32', eer: 14.5, powerInputKW: 1.85, source: 'placeholder' },
  // Voltas Maha Adjustable Inverter
  { id: 'vo-split-0.75', brand: 'Voltas', type: 'Split', subType: 'Inverter', modelSeries: 'Maha Adjustable', capacityTR: 0.75, capacityBTU:  9000, refrigerant: 'R32', eer: 13.5, powerInputKW: 0.80, source: 'placeholder' },
  { id: 'vo-split-1.0',  brand: 'Voltas', type: 'Split', subType: 'Inverter', modelSeries: 'Maha Adjustable', capacityTR: 1.0,  capacityBTU: 12000, refrigerant: 'R32', eer: 13.5, powerInputKW: 1.05, source: 'placeholder' },
  { id: 'vo-split-1.5',  brand: 'Voltas', type: 'Split', subType: 'Inverter', modelSeries: 'Maha Adjustable', capacityTR: 1.5,  capacityBTU: 18000, refrigerant: 'R32', eer: 13.2, powerInputKW: 1.55, source: 'placeholder' },
  { id: 'vo-split-2.0',  brand: 'Voltas', type: 'Split', subType: 'Inverter', modelSeries: 'Maha Adjustable', capacityTR: 2.0,  capacityBTU: 24000, refrigerant: 'R32', eer: 13.0, powerInputKW: 2.05, source: 'placeholder' },
];
