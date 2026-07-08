/**
 * computeRoomLoad — the single, pure per-room cooling/coil/CFM orchestrator.
 *
 * BACKGROUND. The same envelope→internal→vent→TFA-credit→coil→resolveSupplyCfm
 * sequence had been hand-copied into four places: reportService.computeDetailed,
 * airflowSchedule.roomDesignCfm, excelService and loadCalculationService. Those copies
 * drifted, and that drift caused the R85 report bugs (the "mirrors the app" comments were
 * manual-sync reminders). This module is the single source of truth those callers delegate
 * to, so the physics lives in exactly one place.
 *
 * It is a faithful extraction of reportService.computeDetailed's canonical (multi-DOAS,
 * tfa-only aware) core — same formulas, same constants, same order — parameterised so the
 * DOAS/equipment context is passed in rather than read from a module global. It returns the
 * shared intermediate + final quantities; each caller derives its own extra fields (the
 * report adds humidification + heating-safety; the airflow schedule takes designCfm) from
 * this result.
 *
 * ONE season per call (pass the season's resolved DesignConditions) — callers loop seasons
 * exactly as they do today.
 */
import { getMinAdp, getRecommendedAch, type DesignConditions, type EnvelopeElement, type RoomDetails, type CoilParameters, type HeatingLoadResult, type TFALoadResult, type EnvelopeBreakdown } from './constants';
import { calculateRoomVolume } from './geometry';
import { calculateInternalGains, type InternalGains } from './internalGains';
import { calculateEnvelopeGain } from './envelope';
import { calculateVentilationLoad, calculateHeatingLoad, calculateTFALoad } from './ventilation';
import { calculatePsychrometrics, calculateCoilParameters } from './psychrometrics';
import { calculateParasiticGains } from './parasitic';
import { resolveRoomTfa } from './tfa';
import { resolveSupplyCfm, resolveRoomSupplyBasis, resolveTotalSupplyACH } from './supplyCfm';

const asNum = (v: any, fb: number) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };

/** Bypass factor used across the whole engine (Carrier coil BF). */
export const ROOM_LOAD_BF = 0.15;

export interface RoomLoadOptions {
  /** Equipment systems (DOAS/Chiller/VRF…) for this project — drives TFA resolution. */
  equipSystems?: any[] | null;
  /** Project doc — read for systemType, adpBasis, supplyBasis. */
  project?: any;
  /** Zone docs — legacy tfaDefaultMode fallback for rooms whose tfaMode is unset. */
  zoneDocs?: any[];
}

export interface RoomLoadResult {
  // ── TFA / DOAS resolution ──
  isTFA: boolean;
  isTfaOnly: boolean;
  /** The effective design conditions actually fed to the calc (TFA-adjusted when DOAS-served). */
  dcEff: DesignConditions;

  // ── Raw sub-results ──
  envelope: EnvelopeBreakdown;
  internal: InternalGains;
  vent: ReturnType<typeof calculateVentilationLoad>;
  heating: HeatingLoadResult;
  tfa: TFALoadResult | null;

  // ── Geometry ──
  area: number;
  freshAirCFM: number;

  // ── Effective-room (ER) & coil build ──
  erVentSenBF: number;
  erVentLatBF: number;
  erSensibleRaw: number;
  erLatentRaw: number;
  parasitic: { ductGain: number; fanGain: number };
  ersh: number;
  erlh: number;
  erh: number;
  oaSensible: number;
  oaLatent: number;
  tfaOffSen: number;
  tfaOffLat: number;
  coilSensible: number;
  coilLatent: number;
  grandTotal: number;
  loadTr: number;

  // ── Coil / psychrometrics ──
  coil: CoilParameters;

  // ── Airflow ──
  totalAch: number;
  totalSupplyCfm: number;
  designCfm: number;
  cfmTr: number;

  // ── TR (load-only governing) ──
  governingTr: number;
  requiredTr: number;

  // ── DOAS coil (outdoor-air conditioning handled by the DOAS unit) ──
  tfaCoilSensible: number;
  tfaCoilLatent: number;
  tfaCoilTr: number;
  tfaCfm: number;
  tfaReheat: number;
  tfaCoilADP: number;

  // ── Echoed knobs (so callers don't re-read the room) ──
  bf: number;
  sSafetyPct: number;
  lSafetyPct: number;
  oSafetyPct: number;
  ductPct: number;
  fanPct: number;
}

/**
 * Compute one room's cooling load, coil parameters and design CFM for a single season.
 * Faithful to reportService.computeDetailed (canonical). TFA/DOAS is resolved from
 * `opts.equipSystems` via the shared resolveRoomTfa — no module globals.
 */
export const computeRoomLoad = (
  room: any,
  elements: EnvelopeElement[],
  dc: DesignConditions,
  opts: RoomLoadOptions = {},
): RoomLoadResult => {
  const { equipSystems, project, zoneDocs } = opts;
  const BF = ROOM_LOAD_BF;
  const sSafetyPct = asNum(room?.sensibleSafetyPercent ?? room?.sensibleSafetyFactor, 10);
  const lSafetyPct = asNum(room?.latentSafetyPercent   ?? room?.latentSafetyFactor,   5);
  const oSafetyPct = asNum(room?.overallSafetyPercent  ?? room?.grandTotalSafetyFactor, 3);
  const ductPct   = asNum(room?.ductGainPct, 2);
  const fanPct    = asNum(room?.fanGainPct,  3);

  // TFA/DOAS: when this room is DOAS-served, the outdoor air is conditioned by the TFA unit,
  // NOT the primary coil. Recompute with the cold-DOAS branch so the primary coil loads —
  // and therefore ADP, RSHF, supply-air state, dehumidified CFM and reheat — reflect the
  // reduced (sensible-leaning) coil.
  const { doas, mode: effTfaMode } = resolveRoomTfa(room, equipSystems, zoneDocs ?? []);
  const isTFA = !!doas;
  const isTfaOnly = effTfaMode === 'tfa-only';
  const dcEff: any = isTFA
    ? { ...dc, ventilationStrategy: 'tfa-cold', tfaSupplyTemp: doas.tfaSupplyTemp, tfaSupplyHumidity: doas.tfaSupplyHumidity, ervSensibleEffectiveness: doas.ervSensibleEffectiveness, ervLatentEffectiveness: doas.ervLatentEffectiveness }
    : dc;

  const envelope  = calculateEnvelopeGain(elements, dcEff);
  const internal  = calculateInternalGains(room);
  const vent      = calculateVentilationLoad(room, dcEff);
  // Winter heating must use the TFA-aware DC: for DOAS-served rooms the mechanical fresh air
  // is heated by the DOAS coil, so the space unit covers ONLY genuine infiltration
  // (winterInfiltrationACH), not the full FACPH. (R85 fix #6.)
  const heating   = calculateHeatingLoad(room, elements, dcEff);
  const tfa       = isTFA ? calculateTFALoad(room, dcEff) : null;

  const area = asNum(room?.length, 0) * asNum(room?.width, 0);
  const faCfm = (calculateRoomVolume(room) * asNum(room?.facph, 0)) / 60;

  // In TFA mode the bypass-OA terms go to the DOAS unit, not the primary coil.
  const erVentSenBF   = isTFA ? 0 : vent.sensible * BF;
  const erVentLatBF   = isTFA ? 0 : vent.latent   * BF;
  const erSensibleRaw = envelope.sensible + internal.sensible + erVentSenBF;
  const erLatentRaw   = internal.latent   + erVentLatBF;
  const parasitic     = calculateParasiticGains(erSensibleRaw, erSensibleRaw, ductPct, fanPct);
  const ersh          = (erSensibleRaw + parasitic.ductGain + parasitic.fanGain) * (1 + sSafetyPct / 100);
  const erlh          = erLatentRaw * (1 + lSafetyPct / 100);
  const erh           = ersh + erlh;
  const oaSensible    = isTFA ? 0 : vent.sensible * (1 - BF);
  const oaLatent      = isTFA ? 0 : vent.latent   * (1 - BF);
  // Cold-DOAS supply offsets a portion of the space coil load (engineering credit).
  const tfaOffSen     = tfa ? tfa.spaceSensibleOffset : 0;
  const tfaOffLat     = tfa ? tfa.spaceLatentOffset   : 0;
  const coilSensible  = isTfaOnly ? 0 : (isTFA ? Math.max(0, ersh - tfaOffSen) : ersh + oaSensible);
  const coilLatent    = isTfaOnly ? 0 : (isTFA ? Math.max(0, erlh - tfaOffLat) : erlh + oaLatent);
  const grandTotal    = coilSensible + coilLatent;
  const loadTr        = grandTotal / 12000;

  // Coil recomputed from the (TFA-reduced) loads — drives ADP / RSHF / supply air.
  const coil = calculateCoilParameters(coilSensible, coilLatent, dcEff.indoorTemp, dcEff.indoorHumidity, dcEff.altitude, BF, 35, 65, getMinAdp(project?.systemType, project?.adpBasis));

  const totalAch     = resolveTotalSupplyACH(getRecommendedAch(room?.achProfile ?? room?.activityType), asNum(room?.facph, 0), asNum(room?.recircPct, 0));
  const totalSupplyCfm = (calculateRoomVolume(room) * totalAch) / 60;
  // Supply-air basis: 'dscfm' (DEFAULT, dehumidified-air) vs 'ach' (legacy ACH-preset).
  const designCfm    = resolveSupplyCfm({
    basis: resolveRoomSupplyBasis(room?.supplyCfmBasis, project?.supplyBasis),
    isTFA, isTfaOnly,
    dehumidifiedCFM: coil.dehumidifiedCFM,
    minAdpSensibleCFM: coil.minAdpSensibleCFM,
    totalSupplyCFM: totalSupplyCfm,
    freshAirCFM: faCfm,
    tfaCfm: tfa?.cfm ?? 0,
  }).designSupplyCFM;
  const cfmTr        = designCfm / 400;
  // Plant TR is LOAD-ONLY (locked policy 2026-05-20). cfmTr is a sanity ratio only.
  const governingTr  = loadTr;
  const requiredTr   = governingTr * (1 + oSafetyPct / 100);

  // TFA/DOAS coil duty (outdoor-air conditioning) handled by the DOAS unit.
  const tfaCoilSensible = tfa ? tfa.coilSensible : 0;
  const tfaCoilLatent   = tfa ? tfa.coilLatent   : 0;
  const tfaCoilTr       = (tfaCoilSensible + tfaCoilLatent) / 12000;
  const tfaCfm          = tfa ? tfa.cfm : 0;
  const tfaReheat       = tfa ? (tfa.reheatCoilSensible || 0) : 0;
  const tfaCoilADP      = tfa ? tfa.coilADP : 0;

  return {
    isTFA, isTfaOnly, dcEff,
    envelope, internal, vent, heating, tfa,
    area, freshAirCFM: faCfm,
    erVentSenBF, erVentLatBF, erSensibleRaw, erLatentRaw, parasitic,
    ersh, erlh, erh, oaSensible, oaLatent, tfaOffSen, tfaOffLat,
    coilSensible, coilLatent, grandTotal, loadTr,
    coil,
    totalAch, totalSupplyCfm, designCfm, cfmTr,
    governingTr, requiredTr,
    tfaCoilSensible, tfaCoilLatent, tfaCoilTr, tfaCfm, tfaReheat, tfaCoilADP,
    bf: BF, sSafetyPct, lSafetyPct, oSafetyPct, ductPct, fanPct,
  };
};
