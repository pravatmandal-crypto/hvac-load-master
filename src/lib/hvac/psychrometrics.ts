/**
 * Psychrometric Calculations
 * Air properties including humidity ratio, enthalpy, and dew point
 * ASHRAE Fundamentals 2017, Chapter 6 - Psychrometrics
 */

import { PsychrometricProperties, CoilParameters, ASHRAE_CONSTANTS } from './constants';

/**
 * Calculate psychrometric properties (humidity ratio, enthalpy)
 * Uses ASHRAE correlations for saturation pressure and humidity ratio
 * 
 * @param tempF - Temperature in °F
 * @param relHum - Relative humidity in %
 * @param altitude - Altitude in feet
 * @returns Psychrometric properties: humidity ratio (lb/lb), enthalpy (BTU/lb), saturation pressure (psia)
 */
export const calculatePsychrometrics = (
  tempF: number,
  relHum: number,
  altitude: number = 0
): PsychrometricProperties => {
  const T_R = tempF + 459.67; // Rankine (absolute temperature)

  // Atmospheric pressure P (psia) based on altitude - ASHRAE Standard Atmosphere
  // P = 14.696 * (1 - 6.8754e-6 * altitude)^5.2559
  const P = 14.696 * Math.pow(1 - 6.8754e-6 * altitude, 5.2559);

  // Saturation pressure Pws (psia) - ASHRAE correlation
  let lnPws;
  if (tempF >= 32) {
    // Above freezing - ASHRAE Equation 6
    const C8 = -1.0440397e4;
    const C9 = -1.1294650e1;
    const C10 = -2.7022355e-2;
    const C11 = 1.2890360e-5;
    const C12 = -2.4780681e-9;
    const C13 = 6.5459673;
    lnPws = C8 / T_R + C9 + C10 * T_R + C11 * Math.pow(T_R, 2) + C12 * Math.pow(T_R, 3) + C13 * Math.log(T_R);
  } else {
    // Below freezing - ASHRAE Equation 5
    const C1 = -1.0214144e4;
    const C2 = -4.8932428e0;
    const C3 = -5.3765831e-3;
    const C4 = 1.9202377e-7;
    const C5 = 3.5575832e-10;
    const C6 = -9.0344688e-14;
    const C7 = 4.1635019e0;
    lnPws = C1 / T_R + C2 + C3 * T_R + C4 * Math.pow(T_R, 2) + C5 * Math.pow(T_R, 3) + C6 * Math.pow(T_R, 4) + C7 * Math.log(T_R);
  }
  
  const Pws = Math.exp(lnPws);
  const Pw = (relHum / 100) * Pws;

  // Humidity ratio W (lb water / lb dry air) - ASHRAE Equation 22
  const W = 0.62198 * Pw / (P - Pw);

  // Enthalpy h (BTU/lb dry air) - ASHRAE Equation 32
  const h = 0.240 * tempF + W * (1061 + 0.444 * tempF);

  return { humidityRatio: W, enthalpy: h, saturationPressure: Pws };
};

/**
 * Saturation (dew-point) temperature whose SATURATED humidity ratio equals the
 * target W. This is the apparatus dew point a coil must reach to dry air down to
 * humidity ratio `targetW` — you cannot dehumidify below a given W without
 * cooling the air to that W's dew point (100 % RH). Mirrors the incremental
 * saturation-curve search used by the ADP solver below.
 *
 * @param targetW - target humidity ratio (lb water / lb dry air)
 * @param altitude - altitude in feet
 * @param loF - lower search bound (°F)
 * @param hiF - upper search bound (°F)
 * @returns saturation temperature in °F (clamped to [loF, hiF])
 */
export const dewPointFromHumidityRatio = (
  targetW: number,
  altitude: number = 0,
  loF: number = 32,
  hiF: number = 80,
): number => {
  if (!Number.isFinite(targetW) || targetW <= 0) return loF;
  let best = loF;
  let bestDiff = Infinity;
  for (let t = loF; t <= hiF; t += 0.1) {
    const w = calculatePsychrometrics(t, 100, altitude).humidityRatio;
    const diff = Math.abs(w - targetW);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = t;
    }
  }
  return best;
};

/**
 * The EFFECTIVE ROOM loads to hand `calculateCoilParameters` for the ADP / dehumidified
 * air quantity. Single source of the rule so the duplicated calc glue (RoomTable, ZoneList,
 * computeRoomLoad) cannot drift apart again — divergence here is what shipped the R0 ADP bug.
 *
 *  • tfa-only  — no space coil to size.
 *  • TFA/DOAS  — the DOAS carries the OA, so the space coil sees the room load net of the
 *                cold-supply credit. (Numerically equal to the space-coil load here.)
 *  • otherwise — plain ERSH/ERLH. The unbypassed OA is a COIL duty, not a room load, and
 *                must be left out: including it tilts the ESHF line and drags the ADP cold.
 */
export const effectiveRoomLoadsForAdp = (
  ersh: number,
  erlh: number,
  opts: { isTFA?: boolean; isTfaOnly?: boolean; tfaOffSen?: number; tfaOffLat?: number } = {},
): { adpSensible: number; adpLatent: number } => {
  if (opts.isTfaOnly) return { adpSensible: 0, adpLatent: 0 };
  if (opts.isTFA) {
    return {
      adpSensible: Math.max(0, ersh - (opts.tfaOffSen ?? 0)),
      adpLatent: Math.max(0, erlh - (opts.tfaOffLat ?? 0)),
    };
  }
  return { adpSensible: ersh, adpLatent: erlh };
};

/**
 * Calculate Apparatus Dew Point (ADP) and Dehumidified CFM
 * Based on Room Sensible Heat Factor (RSHF)
 * ASHRAE Fundamentals Chapter 6
 * 
 * @param roomSensible - Room sensible load in BTU/h
 * @param roomLatent - Room latent load in BTU/h
 * @param roomTemp - Room temperature in °F
 * @param roomRH - Room relative humidity in %
 * @param altitude - Altitude in feet
 * @param bypassFactor - Coil bypass factor (default 0.1)
 * @returns Coil parameters including ADP and required CFM
 */
export const calculateCoilParameters = (
  roomSensible: number,
  roomLatent: number,
  roomTemp: number,
  roomRH: number,
  altitude: number = 0,
  bypassFactor: number = ASHRAE_CONSTANTS.DEFAULT_BYPASS_FACTOR,
  minAdpF: number = 35,
  maxAdpF: number = 65,
  selectedAdpMinF: number = 54
): CoilParameters => {
  // Sensible Heat Factor for the load passed in.
  //
  // CONTRACT (corrected 2026-07-31): callers MUST pass the EFFECTIVE ROOM loads
  // (ERSH / ERLH — room gains + parasitic + the BYPASSED share of OA), never the
  // coil totals. Everything this function returns — the ADP and the dehumidified
  // air quantity — lives on the ESHF line drawn from the ROOM state, so feeding it
  // coil-level loads (GSHF) anchors the wrong slope at the room point and yields an
  // ADP that is several °F too cold. The air then closes on sensible but massively
  // over-delivers latent (Tezpur CO Room: ADP 55.9 °F vs 58.8 °F correct, latent
  // +157 %). GSHF belongs on the MIXED-AIR point, which is not what is solved here.
  //
  // Compute GSHF separately for display/reheat reporting; do not route it in here.
  const totalLoad = roomSensible + roomLatent;
  // Guard divide-by-zero — if no load, return neutral all-sensible result.
  const rshf = totalLoad > 0 ? roomSensible / totalLoad : 1;

  // Find Indicated ADP by solving for coil surface temperature
  let indicatedADP = 50; // Default fallback
  let minDiff = Infinity;

  const roomPsychro = calculatePsychrometrics(roomTemp, roomRH, altitude);

  const searchMin = Math.min(minAdpF, maxAdpF);
  const searchMax = Math.max(minAdpF, maxAdpF);

  // Search ADP range based on system constraints.
  // NOTE: sensibleDiff and latentDiff are computed WITHOUT a CFM multiplier.
  // This is intentional — CFM cancels in the RSHF ratio:
  //   RSHF = (1.08 × CFM × ΔT) / (1.08 × CFM × ΔT + 0.68 × CFM × ΔW_gr)
  //        = (1.08 × ΔT) / (1.08 × ΔT + 0.68 × ΔW_gr)     [CFM divides out]
  // This finds where the ESHF line drawn FROM THE ROOM STATE intersects the
  // saturation curve — the standard Carrier ADP construction. The anchor point
  // matters as much as the slope: the line must start at the room condition and
  // carry the EFFECTIVE ROOM heat factor (see the contract note above).
  for (let t = searchMin; t <= searchMax; t += 0.1) {
    const adpPsychro = calculatePsychrometrics(t, 100, altitude);

    // Sensible heat transfer: Qs = 1.08 × CFM × (T_room - T_adp)
    const sensibleDiff = ASHRAE_CONSTANTS.SENSIBLE_COOLING_CONSTANT * (roomTemp - t);

    // Latent heat transfer: Ql = 0.68 × CFM × (W_room - W_adp) × 7000
    const latentDiff = ASHRAE_CONSTANTS.LATENT_COOLING_CONSTANT * (roomPsychro.humidityRatio - adpPsychro.humidityRatio) * ASHRAE_CONSTANTS.GRAINS_PER_LB;

    // Calculate RSHF for this ADP
    const calculatedRSHF = sensibleDiff / (sensibleDiff + latentDiff);

    const diff = Math.abs(calculatedRSHF - rshf);
    if (diff < minDiff) {
      minDiff = diff;
      indicatedADP = t;
    }
  }

  // Selected ADP rule:
  // 1) Round indicated ADP to nearest whole number for practical selection, and
  // 2) Never allow selected ADP below configured minimum.
  // Example: Indicated 54.2F with min 54F -> Selected 54F
  const selectedADP = Math.max(selectedAdpMinF, Math.round(indicatedADP));

  // Required airflow should satisfy BOTH sensible and latent coil constraints.
  // Engineering practice: use the governing (higher) CFM.
  const selectedAdpPsychro = calculatePsychrometrics(selectedADP, 100, altitude);
  const deltaTToAdp = Math.max(0.01, roomTemp - selectedADP);
  const deltaWToAdpGrains = Math.max(
    0.01,
    (roomPsychro.humidityRatio - selectedAdpPsychro.humidityRatio) * ASHRAE_CONSTANTS.GRAINS_PER_LB,
  );
  const contactFactor = Math.max(0.01, 1 - bypassFactor);

  const sensibleCFM = roomSensible / (
    ASHRAE_CONSTANTS.SENSIBLE_COOLING_CONSTANT * deltaTToAdp * contactFactor
  );
  const latentCFM = roomLatent / (
    ASHRAE_CONSTANTS.LATENT_COOLING_CONSTANT * deltaWToAdpGrains * contactFactor
  );
  // Dehumidified-air quantity = the Carrier/ASHRAE sensible formula at the selected ADP:
  //   cfm_da = ERSH / (1.08 × (1 − BF) × (t_room − t_adp))
  // When the ADP sits ON the ESHF line, sensibleCFM and latentCFM coincide and this IS the
  // whole answer (so max() would be a no-op). When the ADP is forced off the line — a low-SHF
  // room pinned to the ADP floor — the latent-air requirement exceeds it. That gap CANNOT be met
  // by more cold air alone; it needs reheat or a decoupled latent device (DOAS / desiccant). So we
  // size on the sensible figure and surface the shortfall explicitly instead of silently inflating
  // the airflow with max(sensible, latent), which over-sizes the AHU/duct/fan and hides the reheat.
  const dehumidifiedCFM = sensibleCFM;
  const latentShortfallCFM = Math.max(0, latentCFM - sensibleCFM);
  const dehumidRise = deltaTToAdp * contactFactor; // (1 − BF)(t_room − t_adp)
  // Excess sensible cooling the latent-governed airflow would over-deliver = the reheat duty needed
  // to hold the room at setpoint while the coil keeps wringing out moisture. (= 0 on a normal coil.)
  const reheatRequiredBTU =
    latentShortfallCFM * ASHRAE_CONSTANTS.SENSIBLE_COOLING_CONSTANT * dehumidRise;

  // minAdpSensibleCFM: DSCFM computed at the FIXED system design ADP (selectedAdpMinF).
  // The 400 CFM/TR rule is calibrated for this ADP. When indicatedADP floats above
  // selectedAdpMinF (e.g. 57°F for a high-sensible lab vs 44°F Chiller minimum),
  // sensibleCFM inflates and cfmTR becomes unrealistically high. Use this field for
  // cfmTR so the 400 CFM/TR rule is always applied at the correct reference ADP.
  const minAdpDeltaT = Math.max(0.01, roomTemp - selectedAdpMinF);
  const minAdpSensibleCFM = roomSensible / (
    ASHRAE_CONSTANTS.SENSIBLE_COOLING_CONSTANT * minAdpDeltaT * contactFactor
  );

  // ADP unreachable when actual GSHF lies below the minimum SHF achievable on
  // the saturation curve in the search range. Threshold of 0.02 absorbs grid
  // resolution noise while still flagging genuinely off-curve cases (e.g. a
  // cold-storage room with GSHF=0.37 vs achievable minimum ~0.53). When true,
  // the indicated ADP is just the closest match — not a real intersection —
  // and reheat or chemical dehumidification is required at the coil level.
  const adpUnreachable = totalLoad > 0 && minDiff > 0.02;

  return {
    rshf,
    indicatedADP,
    selectedADP,
    sensibleCFM,
    minAdpSensibleCFM,
    dehumidifiedCFM,
    latentCFM,
    latentShortfallCFM,
    reheatRequiredBTU,
    bypassFactor,
    adpUnreachable,
  };
};
