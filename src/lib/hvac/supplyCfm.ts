/**
 * Supply-air CFM basis resolver — shared by the persist service
 * (loadCalculationService) and the LoadCalculator live calc so the two never drift.
 *
 * Two selectable bases (either/or, NOT a max floor between them):
 *
 *  • 'dscfm' (DEFAULT, industry-recommended Carrier/ASHRAE) — size the space AHU on
 *    the Dehumidified-air quantity = max(sensibleCFM, latentCFM) at the selected ADP.
 *    Floored at the fresh-air (OA) the room introduces so supply ≥ outdoor air.
 *
 *  • 'ach' — the legacy behaviour, unchanged: max(thermal-at-ADP, ACH-preset CFM).
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

export interface SupplyCfmInputs {
  /** Selected basis. Undefined/anything-but-'dscfm' is treated as 'ach' (legacy default). */
  basis?: SupplyCfmBasis;
  /** True when a cold-DOAS/TFA conditions this room's outdoor air. */
  isTFA: boolean;
  /** True when the room is fed entirely by the DOAS (no own space coil). */
  isTfaOnly?: boolean;
  /** coil.dehumidifiedCFM — max(sensibleCFM, latentCFM) at the selected ADP. */
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

export function resolveSupplyCfm(i: SupplyCfmInputs): SupplyCfmResult {
  // The DOAS supplies the OA only when it serves a room that still has its own coil.
  const subtractTfaCfm = i.isTFA && !i.isTfaOnly;

  const achBasisCFM = Math.max(
    i.minAdpSensibleCFM,
    i.totalSupplyCFM - (subtractTfaCfm ? i.tfaCfm : 0),
  );

  const dscfmBasisCFM = subtractTfaCfm
    ? i.dehumidifiedCFM // DOAS delivers the OA; size the space AHU on the residual load
    : Math.max(i.dehumidifiedCFM, i.freshAirCFM); // floor at the OA the room introduces

  // A tfa-only room has no space coil to size on — keep it on the ACH (full air-change) basis.
  const governedBy: SupplyCfmBasis = i.isTfaOnly ? 'ach' : i.basis === 'dscfm' ? 'dscfm' : 'ach';
  const designSupplyCFM = governedBy === 'dscfm' ? dscfmBasisCFM : achBasisCFM;

  return { designSupplyCFM, achBasisCFM, dscfmBasisCFM, governedBy };
}
