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
import { calculatePsychrometrics, calculateCoilParameters, effectiveRoomLoadsForAdp } from './psychrometrics';
import { calculateParasiticGains } from './parasitic';
import { resolveRoomTfa } from './tfa';
import { resolveSupplyCfm, resolveRoomSupplyBasis, resolveTotalSupplyACH, type SupplyCfmBasis } from './supplyCfm';

const asNum = (v: any, fb: number) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };

/** Bypass factor used across the whole engine (Carrier coil BF). */
export const ROOM_LOAD_BF = 0.15;

/**
 * Winter design heating load from the raw total: heating safety margin, then the warm-up /
 * pickup allowance on the subtotal.
 *
 * Centralised because it had drifted into four different formulas across the app — the PDF on
 * 1.10 × 1.15 = 1.265 while the persisted field, the zone strip and the project-summary card
 * all used `overallSafetyPct` (the COOLING margin, 1.03). Every non-PDF surface was therefore
 * 18.6 % low and they disagreed with the report and each other. Heating has its own factor
 * stack; never reach for the cooling margin here. (2026-08-02)
 */
export const designHeatingLoadFrom = (rawTotal: number, room: any): number =>
  (Number(rawTotal) || 0)
  * (1 + Number(room?.heatingSafetyPercent ?? 10) / 100)
  * (1 + Number(room?.heatingPickupPercent ?? 15) / 100);

/**
 * TFA/DOAS fresh-air winter heating coil: heating SAFETY only, no warm-up allowance.
 * Pickup brings a cold BUILDING up after setback; a DOAS coil tempering outdoor air runs
 * continuously and never has cold structure to recover, so charging it the space allowance
 * would inflate a duty that cannot occur.
 */
export const tfaWinterHeatingFrom = (rawTotal: number, room: any): number =>
  (Number(rawTotal) || 0) * (1 + Number(room?.heatingSafetyPercent ?? 10) / 100);

/** Relative humidity (%) from dry-bulb + humidity ratio — inverse of calculatePsychrometrics. */
const rhFromHumidityRatio = (tempF: number, W: number, altitude: number): number => {
  const P = 14.696 * Math.pow(1 - 6.8754e-6 * altitude, 5.2559);
  const Pw = (W * P) / (0.62198 + W);
  const Pws = calculatePsychrometrics(tempF, 50, altitude).saturationPressure; // Pws is RH-independent
  if (!(Pws > 0)) return 0;
  return Math.max(0, Math.min(100, (Pw / Pws) * 100));
};

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
  /**
   * TFA-only float: a DOAS-only room (no space coil) is fed only its FACFM at the DOAS
   * supply condition, which can't hold the design DB/RH, so it floats to the equilibrium
   * where the fresh air balances the space load. These are the ACTUAL maintained indoor
   * DB/RH (null when the room holds design — non-TFA-only, or FACFM over-delivers).
   * When set, the reported envelope/room load below is recomputed at this floated condition.
   */
  floatIndoorTemp: number | null;
  floatIndoorRH: number | null;

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
  /**
   * Grand sensible heat factor = coilSensible / (coilSensible + coilLatent).
   * Display + reheat-reporting only. `coil.rshf` is the ROOM factor (ESHF) that
   * locates the ADP — the two are different numbers and must not be interchanged
   * (Tezpur CO Room: RSHF 0.87 vs GSHF 0.73).
   */
  gshf: number;

  // ── Airflow ──
  totalAch: number;
  totalSupplyCfm: number;
  designCfm: number;
  cfmTr: number;
  /** Resolved supply-air basis actually used ('dscfm' | 'ach'). */
  supplyCfmBasis: SupplyCfmBasis;
  /** Candidate CFM under each basis + the fresh-air floor (for the Basis read-out). */
  dscfmBasisCFM: number;
  achBasisCFM: number;

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

  let envelope    = calculateEnvelopeGain(elements, dcEff);
  const internal  = calculateInternalGains(room);
  const vent      = calculateVentilationLoad(room, dcEff);
  // Winter heating must use the TFA-aware DC: for DOAS-served rooms the mechanical fresh air
  // is heated by the DOAS coil, so the space unit covers ONLY genuine infiltration
  // (winterInfiltrationACH), not the full FACPH. (R85 fix #6.)
  const heating   = calculateHeatingLoad(room, elements, dcEff);
  const tfa       = isTFA ? calculateTFALoad(room, dcEff) : null;

  const area = asNum(room?.length, 0) * asNum(room?.width, 0);
  const faCfm = (calculateRoomVolume(room) * asNum(room?.facph, 0)) / 60;

  // ── TFA-only indoor float correction ──
  // A tfa-only room has no space coil — it is fed ONLY its FACFM at the DOAS supply
  // condition. That ventilation quantity can't hold the design DB/RH, so the room floats
  // to the equilibrium where the fresh air balances the space load:
  //   T_room = T_supply + ERSH(T_room) / (1.08 · FACFM)   (iterated: conduction ∝ T_room)
  // Only a WARM float is a correction (FACFM under-delivers). When FACFM over-delivers the
  // room holds design and we keep the design condition. The reported envelope/room load is
  // then recomputed at the floated indoor temp (conduction drops as the room warms).
  let floatIndoorTemp: number | null = null;
  let floatIndoorRH: number | null = null;
  if (isTfaOnly && tfa && tfa.cfm > 0) {
    const SENS = 1.08;
    const facfm = tfa.cfm;
    // Space sensible carried by the room at indoor temp `t` (envelope conduction shrinks
    // as the room warms toward outdoor; internal + parasitic + safety are temp-independent).
    const ershAt = (t: number): number => {
      const env = calculateEnvelopeGain(elements, { ...dcEff, indoorTemp: t });
      const senRaw = env.sensible + internal.sensible; // erVentSenBF = 0 for TFA
      const par = calculateParasiticGains(senRaw, senRaw, ductPct, fanPct);
      return (senRaw + par.ductGain + par.fanGain) * (1 + sSafetyPct / 100);
    };
    // Sensible balance residual: what the fresh air removes minus what the room produces.
    //   g(t) = ERSH(t) − 1.08·FACFM·(t − Tsupply)
    // ERSH decreases with t and the carried term increases with t, so g is STRICTLY
    // decreasing → a unique root. Solve by bisection (robust for any FACFM); the old
    // fixed-point iteration oscillated/diverged when FACFM was small vs the envelope
    // conductance (|dERSH/dt| > 1.08·FACFM), under-delivering the float by several °F.
    const g = (t: number): number => ershAt(t) - SENS * facfm * (t - tfa.supplyTemp);
    const tDesign = dcEff.indoorTemp;
    // Root above design only when the room can't hold design (FACFM under-delivers).
    if (g(tDesign) > 0) {
      let lo = tDesign, hi = tDesign + 200; // 200°F headroom brackets any physical float
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (g(mid) > 0) lo = mid; else hi = mid;
      }
      const tRoom = (lo + hi) / 2;
      if (tRoom > tDesign + 0.1) {
        floatIndoorTemp = tRoom;
        // Recompute the reported envelope at the float so the corridor's load is honest.
        envelope = calculateEnvelopeGain(elements, { ...dcEff, indoorTemp: tRoom });
      }
    }
  }

  // In TFA mode the bypass-OA terms go to the DOAS unit, not the primary coil.
  const erVentSenBF   = isTFA ? 0 : vent.sensible * BF;
  const erVentLatBF   = isTFA ? 0 : vent.latent   * BF;
  const erSensibleRaw = envelope.sensible + internal.sensible + erVentSenBF;
  const erLatentRaw   = internal.latent   + erVentLatBF;
  const parasitic     = calculateParasiticGains(erSensibleRaw, erSensibleRaw, ductPct, fanPct);
  const ersh          = (erSensibleRaw + parasitic.ductGain + parasitic.fanGain) * (1 + sSafetyPct / 100);
  const erlh          = erLatentRaw * (1 + lSafetyPct / 100);
  const erh           = ersh + erlh;
  // TFA-only latent float: internal (people) latent is temp-independent and the DOAS
  // handles the OA latent, so ERLH is fixed — the room's humidity floats to where the
  // FACFM balances it: W_room = W_supply + ERLH / (0.68 · FACFM · 7000 grains).
  if (floatIndoorTemp !== null && tfa && tfa.cfm > 0) {
    const floatW = tfa.supplyHumidityRatio + erlh / (0.68 * tfa.cfm * 7000);
    floatIndoorRH = rhFromHumidityRatio(floatIndoorTemp, floatW, asNum(dcEff.altitude, 0));
  }
  const oaSensible    = isTFA ? 0 : vent.sensible * (1 - BF);
  const oaLatent      = isTFA ? 0 : vent.latent   * (1 - BF);
  // Cold-DOAS supply offsets a portion of the space coil load (engineering credit).
  const tfaOffSen     = tfa ? tfa.spaceSensibleOffset : 0;
  const tfaOffLat     = tfa ? tfa.spaceLatentOffset   : 0;
  const coilSensible  = isTfaOnly ? 0 : (isTFA ? Math.max(0, ersh - tfaOffSen) : ersh + oaSensible);
  const coilLatent    = isTfaOnly ? 0 : (isTFA ? Math.max(0, erlh - tfaOffLat) : erlh + oaLatent);
  // TFA-served room whose space coil carries NO latent — the cold DOAS supply already removes
  // more moisture than the room generates (coilLatent floored at 0). The room then CANNOT hold
  // the design humidity: it settles where the DOAS airflow balances the room latent gain,
  // W_room = W_doas + ERLH / (0.68 · TFACFM · 7000). Temperature is still held by the space
  // coil, so only RH floats. Previously only tfa-only rooms floated, so these rooms reported
  // the design RH — a value they physically cannot reach. (2026-08-01)
  if (floatIndoorRH === null && isTFA && !isTfaOnly && tfa && tfa.cfm > 0 && coilLatent <= 0) {
    const floatW = tfa.supplyHumidityRatio + erlh / (0.68 * tfa.cfm * 7000);
    floatIndoorRH = rhFromHumidityRatio(asNum(dcEff.indoorTemp, 75), floatW, asNum(dcEff.altitude, 0));
  }
  const grandTotal    = coilSensible + coilLatent;
  const loadTr        = grandTotal / 12000;

  // ADP + dehumidified air quantity ride the ESHF line from the ROOM state, so this
  // takes the EFFECTIVE ROOM loads (ersh/erlh), NOT the coil totals. Passing coil
  // loads here anchored the GSHF slope at the room point and drove the ADP several °F
  // too cold — the airflow then closed on sensible but over-delivered latent by >150%.
  // (Fixed 2026-07-31; see the contract note in psychrometrics.calculateCoilParameters.)
  // TFA-served rooms: ersh is already net of the cold-DOAS credit, which is correct —
  // the space coil only has to carry the residual.
  const { adpSensible, adpLatent } = effectiveRoomLoadsForAdp(ersh, erlh, { isTFA, isTfaOnly, tfaOffSen, tfaOffLat });
  // The ESHF line is drawn FROM THE ROOM STATE, so it must be anchored at the state the room
  // ACTUALLY holds — not the design setpoint it cannot reach. Where the humidity floats (above),
  // that floated state IS the room state.
  //
  // Until now the float was computed, persisted and printed but never fed back here, so a
  // DOAS-over-dried room was reported at its true humidity in prose while its ADP was still
  // solved at design RH. On a space coil carrying zero latent (RSHF = 1) the ADP lands on the
  // room DEWPOINT, so anchoring at the wrong humidity moves it degree-for-degree:
  // TEZPUR GURT Missile Testing settles at 45 % RH (dewpoint 52.6 °F) against a 60 % RH design
  // (dewpoint 60.2 °F) — ADP 60 → 53 °F, and the airflow that rides it 7,159 → 4,881 CFM.
  // The coil never had to reach 60.2 °F; the room was already drier than that.
  //
  // TR is unaffected — coilSensible/coilLatent are set above and do not depend on the ADP.
  // Rooms that do not float (every non-TFA room) pass design conditions exactly as before.
  const adpRoomTemp = floatIndoorTemp ?? dcEff.indoorTemp;
  const adpRoomRH   = floatIndoorRH   ?? dcEff.indoorHumidity;
  const coil = calculateCoilParameters(adpSensible, adpLatent, adpRoomTemp, adpRoomRH, dcEff.altitude, BF, 35, 65, getMinAdp(project?.systemType, project?.adpBasis));
  // Grand SHF — display + reheat reporting only, never the ADP (see RoomLoadResult.gshf).
  const gshf = grandTotal > 0 ? coilSensible / grandTotal : 1;

  const totalAch     = resolveTotalSupplyACH(getRecommendedAch(room?.achProfile ?? room?.activityType), asNum(room?.facph, 0), asNum(room?.recircPct, 0));
  const totalSupplyCfm = (calculateRoomVolume(room) * totalAch) / 60;
  // Supply-air basis: 'dscfm' (DEFAULT, dehumidified-air) vs 'ach' (legacy ACH-preset).
  const supplyCfmBasis = resolveRoomSupplyBasis(room?.supplyCfmBasis, project?.supplyBasis);
  const supply       = resolveSupplyCfm({
    basis: supplyCfmBasis,
    isTFA, isTfaOnly,
    dehumidifiedCFM: coil.dehumidifiedCFM,
    minAdpSensibleCFM: coil.minAdpSensibleCFM,
    totalSupplyCFM: totalSupplyCfm,
    freshAirCFM: faCfm,
    tfaCfm: tfa?.cfm ?? 0,
  });
  const designCfm    = supply.designSupplyCFM;
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
    floatIndoorTemp, floatIndoorRH,
    envelope, internal, vent, heating, tfa,
    area, freshAirCFM: faCfm,
    erVentSenBF, erVentLatBF, erSensibleRaw, erLatentRaw, parasitic,
    ersh, erlh, erh, oaSensible, oaLatent, tfaOffSen, tfaOffLat,
    coilSensible, coilLatent, grandTotal, loadTr,
    coil, gshf,
    totalAch, totalSupplyCfm, designCfm, cfmTr,
    supplyCfmBasis, dscfmBasisCFM: supply.dscfmBasisCFM, achBasisCFM: supply.achBasisCFM,
    governingTr, requiredTr,
    tfaCoilSensible, tfaCoilLatent, tfaCoilTr, tfaCfm, tfaReheat, tfaCoilADP,
    bf: BF, sSafetyPct, lSafetyPct, oSafetyPct, ductPct, fanPct,
  };
};
