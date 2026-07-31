/**
 * Supply-air CFM basis resolver — shared by the persist service
 * (loadCalculationService) and the LoadCalculator live calc so the two never drift.
 *
 * Two selectable bases (either/or — NOT a max floor between them):
 *
 *  • 'dscfm' (DEFAULT, industry-recommended Carrier/ASHRAE) — size the space AHU on the
 *    Dehumidified-air (SENSIBLE) quantity = ERSH / (1.08 × (1−BF) × (t_room − t_adp)) at the
 *    selected ADP, floored ONLY at the fresh-air (OA) the room introduces so supply ≥ outdoor air.
 *    The ACH preset is a reference here, not a floor — the dehumidified figure governs even when it
 *    is below the air-change number. (Decision 2026-06-10, per Pravat: duct to the required thermal
 *    airflow; the latent excess is surfaced as reheat/DOAS, never folded into the airflow.)
 *
 *  • 'ach' — the legacy behaviour, unchanged: max(thermal-at-fixed-ADP, ACH-preset CFM).
 *
 * TFA/DOAS is independent of this toggle — the DOAS always sizes off the engineer-fixed
 * OA FACPH (see ventilation.ts:calculateTFALoad). The toggle only governs the SPACE AHU:
 *  • When a DOAS serves the room (subtractTfaCfm), the DOAS delivers the OA air change, so
 *    the ACH basis sizes the *recirculation balance* (totalSupplyCFM − tfaCfm) and the DSCFM
 *    basis sizes the post-credit residual load (dehumidifiedCFM) with no extra OA floor.
 *  • A tfa-only room (no own coil) is fed entirely by the DOAS — it always uses the ACH
 *    basis (totalSupplyCFM) regardless of the toggle, since there is no space load to size on.
 */
export type SupplyCfmBasis = 'dscfm' | 'ach';

/**
 * Project "Design Mode" — ONE selector that bundles the coil ADP floor and the default
 * room supply-air basis (decision 2026-06-10, per Pravat). Replaces the two scattered
 * controls (ADP basis + supply basis). A room may still override its supply basis.
 *  • 'comfort'          → ADP floor 54°F (comfort), rooms default to DSCFM
 *  • 'dehumidification' → ADP floor 44/42°F (physical), rooms default to DSCFM
 *  • 'air-change'       → ADP floor 54°F (comfort coil), rooms default to ACH
 *  • undefined (legacy) → physical ADP floor, rooms default to DSCFM (existing projects unchanged)
 */
export type DesignMode = 'comfort' | 'dehumidification' | 'air-change';

export interface DesignModeResolved {
  adpBasis: 'comfort' | 'dehumidification' | undefined;
  supplyBasis: SupplyCfmBasis;
}

/** Map a project Design Mode to its coil ADP basis + default supply basis (denormalized onto the project). */
export function resolveDesignMode(mode?: string): DesignModeResolved {
  switch (mode) {
    case 'dehumidification': return { adpBasis: 'dehumidification', supplyBasis: 'dscfm' };
    case 'air-change':       return { adpBasis: 'comfort',          supplyBasis: 'ach'   };
    case 'comfort':          return { adpBasis: 'comfort',          supplyBasis: 'dscfm' };
    default:                 return { adpBasis: undefined,          supplyBasis: 'dscfm' }; // legacy/unset
  }
}

/**
 * Total supply-air ACH — the air-change / ventilation floor for the design airflow.
 *
 * When a recirculation % is specified (the client's design basis, e.g. "2 ACH fresh with 75%
 * recirculation"), the total supply = fresh ÷ (1 − recirc): 2 ÷ (1 − 0.75) = 8 ACH. The fresh-air
 * (OA) rate stays absolute at `facph`; recirculation floats UP automatically when the cooling load
 * drives the design airflow above this floor (so the actual recirc % exceeds the nominal in
 * high-load rooms — physically correct). An explicit recirc % SUPERSEDES the generic space-type
 * preset, since the client has stated the air-change basis directly.
 *
 * When recircPct is unset (0 / undefined), falls back to the legacy max(space-type preset, facph).
 */
export function resolveTotalSupplyACH(presetACH: number, facph: number, recircPct?: number): number {
  const r = Number(recircPct) || 0;
  if (r > 0 && r < 100) return facph / (1 - r / 100); // fresh ÷ fresh-fraction
  return Math.max(presetACH, facph);
}

/** Resolve a room's effective supply basis: explicit room override wins, else the project default. */
export function resolveRoomSupplyBasis(roomBasis?: string, projectSupplyBasis?: string): SupplyCfmBasis {
  if (roomBasis === 'ach') return 'ach';
  if (roomBasis === 'dscfm') return 'dscfm';
  return projectSupplyBasis === 'ach' ? 'ach' : 'dscfm';
}

export interface SupplyCfmInputs {
  /** Selected basis. Undefined/anything-but-'dscfm' is treated as 'ach' (legacy default). */
  basis?: SupplyCfmBasis;
  /** True when a cold-DOAS/TFA conditions this room's outdoor air. */
  isTFA: boolean;
  /** True when the room is fed entirely by the DOAS (no own space coil). */
  isTfaOnly?: boolean;
  /** coil.dehumidifiedCFM — Carrier/ASHRAE sensible dehumidified-air = ERSH/(1.08×(1−BF)×(t_room−t_adp)). */
  dehumidifiedCFM: number;
  /** coil.minAdpSensibleCFM — sensible-only CFM at the fixed system ADP. */
  minAdpSensibleCFM: number;
  /** ACH-preset airflow: max(presetACH, facph) × volume / 60. */
  totalSupplyCFM: number;
  /** Fresh-air (OA) the room introduces: facph × volume / 60. */
  freshAirCFM: number;
  /** DOAS outdoor-air CFM (0 when not TFA). */
  tfaCfm: number;
}

export interface SupplyCfmResult {
  /** The CFM to use for AHU/fan/duct sizing under the selected basis. */
  designSupplyCFM: number;
  /** Candidate under the ACH-preset basis (for the read-out). */
  achBasisCFM: number;
  /** Candidate under the Dehumidified (DSCFM) basis (for the read-out). */
  dscfmBasisCFM: number;
  /** The basis that actually governed (tfa-only is forced to 'ach'). */
  governedBy: SupplyCfmBasis;
}

/**
 * Airflow split for air-terminal / duct layout — the practical breakdown a designer needs
 * per room (and rolled up per zone): total air the room receives, the fresh-air (FACFM)
 * portion, and the recirculated remainder. Recirc is defined as Total supply − FACFM, so
 * Supply = Recirc + Fresh always balances (decision 2026-07-03, per Pravat).
 *
 *  • non-TFA ("fresh air on unit"): supply = space Design CFM; FACFM = the OA the unit
 *    introduces (facph); recirc = Design CFM − FACFM.
 *  • TFA-served: the DOAS delivers the OA, the space coil recirculates — supply =
 *    Design CFM + DOAS CFM; FACFM = DOAS CFM; recirc = Design CFM.
 *  • tfa-only (corridor): fed entirely by the DOAS — supply = FACFM = DOAS CFM; recirc = 0.
 */
export interface AirflowSplitInputs {
  /** Governing (cross-season) space-coil supply CFM — resolveSupplyCfm().designSupplyCFM. */
  designSupplyCFM: number;
  /** Outdoor air the space unit introduces itself (facph × vol / 60) — used when NOT TFA. */
  freshAirCFM: number;
  /** DOAS outdoor-air CFM (0 when not TFA). */
  tfaCfm: number;
  isTFA: boolean;
  isTfaOnly?: boolean;
}

export interface AirflowSplit {
  /** Total air the room receives (sizes the supply diffusers / main supply duct). */
  totalSupplyCFM: number;
  /** Fresh-air CFM (FACFM) — sizes the OA intake / DOAS branch. */
  freshAirCFM: number;
  /** Recirculated CFM = total − fresh (sizes the return / recirc path). */
  recircCFM: number;
}

export function computeAirflowSplit(i: AirflowSplitInputs): AirflowSplit {
  const facfm = i.isTFA ? i.tfaCfm : i.freshAirCFM;
  const totalSupplyCFM = i.isTfaOnly
    ? i.tfaCfm
    : i.isTFA
      ? i.designSupplyCFM + i.tfaCfm
      : i.designSupplyCFM;
  const recircCFM = Math.max(0, totalSupplyCFM - facfm);
  return { totalSupplyCFM, freshAirCFM: facfm, recircCFM };
}

export function resolveSupplyCfm(i: SupplyCfmInputs): SupplyCfmResult {
  // The DOAS supplies the OA only when it serves a room that still has its own coil.
  const subtractTfaCfm = i.isTFA && !i.isTfaOnly;

  // Air-change (ventilation/distribution) airflow — governs only when the ACH basis is selected.
  const airChangeFloor = i.totalSupplyCFM - (subtractTfaCfm ? i.tfaCfm : 0);

  // Floor the air-change preset at the THERMAL requirement — the dehumidified air
  // quantity at the SELECTED ADP. This used to floor on `minAdpSensibleCFM`, which is
  // the airflow at the system's *minimum* ADP (44 °F chiller): a reference quantity for
  // the 400 CFM/TR sanity ratio, never a design airflow. Because the selected ADP is
  // almost always well above the floor ADP, that under-sized every room whose ACH preset
  // did not already govern — Tezpur Zone B printed 4,541 CFM (266 CFM/TR) against a real
  // 7,444 (436 CFM/TR). (Fixed 2026-07-31.)
  const achBasisCFM = Math.max(i.dehumidifiedCFM, airChangeFloor);

  // DSCFM = dehumidified-air (sensible) THERMAL requirement, floored ONLY at the fresh-air (OA) the
  // room introduces so supply ≥ outdoor air. Either/or with the ACH basis (decision 2026-06-10, per
  // Pravat): the ACH preset is a reference, NOT a floor — when DSCFM is selected the dehumidified
  // figure governs even if it is below the air-change number. The latent excess (if the ADP is
  // forced off the ESHF line) is reported as reheat/DOAS, never folded into the airflow.
  const dscfmBasisCFM = subtractTfaCfm
    ? i.dehumidifiedCFM // DOAS delivers the OA; size the space AHU on the residual dehumidified load
    : Math.max(i.dehumidifiedCFM, i.freshAirCFM);

  // A tfa-only room has no space coil to size on — keep it on the ACH (full air-change) basis.
  const governedBy: SupplyCfmBasis = i.isTfaOnly ? 'ach' : i.basis === 'dscfm' ? 'dscfm' : 'ach';
  const designSupplyCFM = governedBy === 'dscfm' ? dscfmBasisCFM : achBasisCFM;

  return { designSupplyCFM, achBasisCFM, dscfmBasisCFM, governedBy };
}
