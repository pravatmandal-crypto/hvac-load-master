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
  // TFA/DOAS systems link to primary system IDs (LEGACY — coarse, all zones in system are TFA-served).
  // Kept for backward compatibility; the engine treats a system-link as "every zone in that system".
  doasLinkedSystemIds?: string[];
  // TFA/DOAS systems link to ZONE IDs (PREFERRED — matches real-world deployment where TFA serves
  // selected zones, not whole systems). When both are populated, the union is used.
  doasLinkedZoneIds?: string[];
  // TFA supply conditions and ERV effectiveness — only meaningful on TFA/DOAS systems.
  // Engine defaults to 55 °F / 90 % RH and zero ERV when these are unset.
  tfaSupplyTemp?: number;            // °F
  tfaSupplyHumidity?: number;        // % RH at supply temp
  ervSensibleEffectiveness?: number; // 0..1
  ervLatentEffectiveness?: number;   // 0..1
  // Where the TFA/DOAS COIL gets its cooling from:
  //   'own-unit'      — self-contained DX / packaged conditioner (default). The TFA
  //                     coil load is NOT added to the primary chiller plant duty.
  //   'chiller-plant' — chilled-water Fresh-Air-HW coil fed by the SAME chiller plant
  //                     that serves the linked rooms. The TFA coil load IS added to
  //                     that chiller plant's required capacity.
  // Undefined is treated as 'own-unit' so existing projects are unchanged.
  tfaCoolingSource?: 'own-unit' | 'chiller-plant';
  // Migration bookkeeping
  migratedFromEquipmentSystem?: boolean;
  migratedAt?: any;
}

/**
 * Per-room TFA mode override. Stored on the room document at
 * /projects/{id}/rooms/{roomId}.tfaMode. Default is 'inherit' (follow zone).
 *
 * - 'no-tfa'      Room sees full OA on primary even if zone is TFA-linked
 *                 (e.g. hi-wall split that can't take ducted TFA supply)
 * - 'tfa-served'  Cold/neutral TFA handles OA; primary handles space sensible
 * - 'tfa-only'    Corridor case — TFA is sole conditioning; primary contribution = 0.
 *                 Engine must validate 1.08 × CFM_tfa × (T_room − T_supply) ≥ room_sensible
 * - 'inherit'     Follow the zone's tfaDefaultMode (default = tfa-served when zone TFA-linked)
 */
export type RoomTfaMode = 'inherit' | 'tfa-served' | 'tfa-only' | 'no-tfa';

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
  // Default TFA mode for rooms in this zone (when zone is TFA-linked). Lets a
  // whole corridor zone be marked tfa-only without per-room edits. Default is
  // 'tfa-served' for zones with a TFA link, and ignored otherwise.
  tfaDefaultMode?: 'tfa-served' | 'tfa-only';
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
