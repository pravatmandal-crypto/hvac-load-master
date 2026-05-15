// AHU is legacy — use as terminal equipment under Chiller, not as a standalone system type
export type SystemType = 'VRF' | 'Package' | 'DuctableSplit' | 'AHU' | 'Chiller' | 'Split' | 'DOAS';

export interface AHUConfig {
  hasHeatingCoil: boolean;
  fanCurve: 'forward-curved' | 'backward-curved';
  fanDrive: 'belt-driven' | 'plug-fan';
  extStaticPa: number;
  hasMixingBox: boolean;
  coolingCoilRows: 4 | 6 | 8;
  heatingCoilRows: 1 | 2;
  filters: { pre: boolean; fine: boolean; hepa: boolean };
  preFilterGrade: string;
  fineFilterGrade: string;
  hepaFilterGrade: string;
}

export interface IDUSelection {
  modelId: string;
  brand: string;
  modelSeries: string;
  subType: string;
  trCapacity: number;
  cfmRated: number;
  staticPressurePa?: number;
  quantity?: number;
  isCustom?: boolean;
  // AHU / FCU (Chiller terminal) — mounting and coil options
  mountingType?: 'floor-standing' | 'ceiling-hung';
  coilType?: 'cooling-only' | 'cooling-heating';
  // AHU-DX type only: indoor AHU paired to a specific condensing unit on system.ahuUnits[].
  // Identifies the CDU by its modelId; engineering schedules / PDFs use this to print pairings.
  pairedCDUId?: string;
}

export interface ODUCombinationUnit {
  modelId: string;
  brand: string;
  modelSeries: string;
  // trCapacity = Nominal TR — OEM catalog rating at AHRI 550/590 standard conditions
  // (44 °F LWT chilled water, 85 °F EWT condenser water for WC, 95 °F ambient for AC).
  trCapacity: number;
  // actualTR = the designer's MINIMUM REQUIRED capacity at this project's site conditions
  // (entering CW/air temp, LCW temp, altitude, fouling). Issued to the OEM as the duty
  // point — OEM must confirm in their technical proposal that the model can meet it.
  // Plant sizing uses this when entered; leave blank to fall back to trCapacity.
  actualTR?: number;
  quantity: number;
  role?: 'working' | 'standby';
  dischargeType?: 'top' | 'side';
  compressorType?: 'heat-pump' | 'cooling-only';
}

export interface ODUSelection {
  modelId: string;
  brand: string;
  modelSeries: string;
  trCapacity: number;
  dischargeType?: 'top' | 'side';
  compressorType?: 'heat-pump' | 'cooling-only';
  isCustom?: boolean;
  modules?: number;
  effectiveTR?: number;
  combination?: ODUCombinationUnit[];
}

export interface SingleUnitSelection {
  modelId: string;
  brand: string;
  modelSeries: string;
  subType?: string;
  trCapacity: number;
  cfmRated: number;
  staticPressurePa?: number;
  quantity?: number;
  isCustom?: boolean;
}

export interface EquipmentZone {
  id: string;
  name: string;
  roomIds: string[];
  selection?: IDUSelection;
  // 'single' = one IDU/AHU covers entire zone (default); 'per-room' = individual IDU per room
  roomMode?: 'single' | 'per-room';
  // FAHU accessories — only for VRF ductable/AHU zones
  fahu?: {
    hasElectricHeater: boolean;
    electricHeaterKW: number;
    hasHumidifier: boolean;
    humidifierKgHr: number;
    humidifierModel?: string;   // "Brand ModelSeries" when picked from catalog
    humidifierSubType?: string; // Ultrasonic / Heater-Based
  };
  // AHU configuration per zone — applies to Chiller, AHU-DX, and VRF zones with AHU-type IDUs
  ahuConfig?: AHUConfig;
  // For Package / DuctableSplit — multiple different-model units per zone
  unitSelections?: IDUSelection[];
  // ASHRAE 62.1 zone air distribution effectiveness id (EzOption.id)
  ezId?: string;
}

export interface EquipmentSystem {
  id: string;
  name: string;
  type: SystemType;
  packageSubType?: 'air-cooled' | 'water-cooled';
  condenserType?: 'water-cooled' | 'air-cooled';
  brand: string | null;
  brandLocked: boolean;
  diversityFactor: number;
  assignedRoomIds: string[];
  iduSelections: Record<string, IDUSelection | IDUSelection[]>;
  zones?: EquipmentZone[];
  zoneSelections?: Record<string, IDUSelection>;
  oduSelection: ODUSelection | null;
  unitSelection: SingleUnitSelection | null;
  ctSelection?: SingleUnitSelection | null;
  // Multiple cooling tower units (any model mix) — supersedes ctSelection for new data
  ctUnits?: ODUCombinationUnit[];
  // For Chiller — multiple different-model chiller units in the plant
  chillerUnits?: ODUCombinationUnit[];
  // For Split — array of units per room (flat: no zone level)
  roomSelections?: Record<string, IDUSelection[]>;
  notes?: string;
  ahuConfig?: AHUConfig;
  customSpec?: any;
  createdAt?: any;
  updatedAt?: any;
}

// ─── Unified hierarchy types (Phase 0 — new System → Zone → Room structure) ──

/**
 * HvacSystemDoc lives at /projects/{id}/hvacSystems/{systemId}.
 * Extends EquipmentSystem with DOAS linking and migration markers.
 */
export interface HvacSystemDoc extends EquipmentSystem {
  // DOAS systems link to primary system IDs they serve (no rooms assigned directly)
  doasLinkedSystemIds?: string[];
  // Migration bookkeeping
  migratedFromEquipmentSystem?: boolean;
  migratedAt?: any;
}

/**
 * HvacZoneDoc lives at /projects/{id}/hvacSystems/{systemId}/zones/{zoneId}.
 * Extends EquipmentZone with design-condition overrides (previously only on LC zone docs)
 * and a systemId back-reference for convenience.
 */
export interface HvacZoneDoc extends EquipmentZone {
  systemId: string;
  // Design-condition overrides — same fields as the legacy /zones collection
  indoorTemp?: number;
  indoorHumidity?: number;
  outdoorTemp?: number;
  outdoorHumidity?: number;
  winterIndoorTemp?: number;
  winterIndoorHumidity?: number;
  createdAt?: any;
  updatedAt?: any;
}

/**
 * Fields added to room docs during the unified-hierarchy migration.
 * Old fields (zoneId, systemId, ahuGroupId) are preserved for backward compat.
 */
export interface HvacRoomFields {
  hvacSystemId?: string;   // points to /hvacSystems/{id}
  hvacZoneId?: string;     // points to /hvacSystems/{sysId}/zones/{id}
  hvacSystemName?: string; // denormalised for display
  hvacZoneName?: string;   // denormalised for display
}

/**
 * Returns the IDU / AHU units configured for a zone, unifying the legacy single-unit
 * field (`zone.selection`) with the newer multi-unit list (`zone.unitSelections[]`).
 *
 * Priority:
 *  1. If `unitSelections[]` has any entries, return it (primary multi-unit shape)
 *  2. Else if `selection` is present, return `[selection]` (legacy single-unit fallback)
 *  3. Else return `[]` (no equipment selected)
 *
 * Use this everywhere on the read path so multi-AHU zones and legacy single-AHU zones
 * are rendered, costed, and reported through one code path.
 */
export function getZoneUnits(zone: EquipmentZone | undefined | null): IDUSelection[] {
  if (!zone) return [];
  if (zone.unitSelections && zone.unitSelections.length > 0) return zone.unitSelections;
  return zone.selection ? [zone.selection] : [];
}
