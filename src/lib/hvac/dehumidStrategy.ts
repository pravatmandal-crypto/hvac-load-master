/**
 * Dehumidification Strategy Comparison
 * ──────────────────────────────────────────────────────────────────────────
 * Indicative, per-room comparison of two ways to meet a cooling/dehumidification
 * load that is latent / outdoor-air dominated:
 *
 *   A. Single mixed-air AHU (subcool + reheat) — the whole supply airflow is
 *      cooled deep enough to dehumidify, then reheated so it doesn't overcool
 *      a low-sensible space.
 *   B. DOAS / TFA split — only the fresh-air stream is dehumidified by a
 *      dedicated unit; a recirculation AHU trims the (small) space sensible.
 *
 * Both schemes reject the SAME real load (space + OA, sensible + latent). The
 * difference is the REHEAT caused by overcooling, which scales with how much
 * airflow must be deep-cooled. Scheme A overcools the entire supply flow;
 * Scheme B overcools only the OA stream. On a normal comfort room (high RSHF,
 * cold supply naturally) there is no overcooling, the two schemes converge, and
 * `flagged` is false.
 *
 * ASHRAE Fundamentals 2017, Ch.6 (psychrometrics). Reuses the standard
 * 1.08 / 0.68 / 7000 sensible/latent/grain constants and the saturation-curve
 * search idiom from psychrometrics.ts (ADP solver).
 */

import { ASHRAE_CONSTANTS } from './constants';
import { calculatePsychrometrics } from './psychrometrics';

// Surface the comparison only when it actually matters — keeps the panel hidden
// on ordinary comfort projects. Tunable in one place.
const FLAG_RSHF_MAX = 0.6;       // latent-dominated coils sit below this
const FLAG_MIN_SAVING_TR = 1;    // ignore sub-1-TR differences (noise)

export interface DehumidStrategyInput {
  spaceSensible: number;   // BTU/h — room-only sensible (envelope + internal + parasitic + safety)
  spaceLatent: number;     // BTU/h — room-only latent
  oaSensible: number;      // BTU/h — outdoor-air sensible (OA cooled to room state)
  oaLatent: number;        // BTU/h — outdoor-air latent
  totalSupplyCFM: number;  // full supply airflow (e.g. ACH-governed)
  oaCFM: number;           // fresh-air (ventilation) CFM
  indoorTemp: number;      // °F
  indoorRH: number;        // %
  altitude?: number;       // ft
}

export interface DehumidStrategyComparison {
  rshf: number;            // grand sensible heat factor of the combined load
  oaFraction: number;      // oaCFM / totalSupplyCFM
  schemeA: { coolingTR: number; reheatTR: number };
  schemeB: { doasCoolingTR: number; recircCoolingTR: number; reheatTR: number; totalCoolingTR: number };
  coolingSavingTR: number; // schemeA cooling − schemeB cooling
  reheatSavingTR: number;  // schemeA reheat − schemeB reheat
  flagged: boolean;        // true → worth showing the comparison
}

const TR = (btuh: number) => btuh / 12000;

/**
 * Temperature (°F) whose SATURATED humidity ratio equals Wtarget (lb/lb).
 * Mirrors the incremental saturation-curve search used for ADP in
 * psychrometrics.ts. Clamped to a physical 35–80 °F window.
 */
export function saturationTempFromW(Wtarget: number, altitude = 0): number {
  const lo = 35;
  const hi = 80;
  if (!Number.isFinite(Wtarget)) return lo;
  let best = lo;
  let bestDiff = Infinity;
  for (let t = lo; t <= hi; t += 0.1) {
    const w = calculatePsychrometrics(t, 100, altitude).humidityRatio;
    const diff = Math.abs(w - Wtarget);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = t;
    }
  }
  return best;
}

/**
 * Compare single-AHU (subcool+reheat) vs DOAS/TFA dehumidification for one room.
 * Returns indicative cooling and reheat tonnage for each strategy. Safe on
 * zero/degenerate input (returns flagged:false, zeros).
 */
export function compareDehumidStrategies(input: DehumidStrategyInput): DehumidStrategyComparison {
  const {
    spaceSensible, spaceLatent, oaSensible, oaLatent,
    totalSupplyCFM, oaCFM, indoorTemp, indoorRH, altitude = 0,
  } = input;

  const SENS = ASHRAE_CONSTANTS.SENSIBLE_COOLING_CONSTANT; // 1.08
  const LAT = ASHRAE_CONSTANTS.LATENT_COOLING_CONSTANT;    // 0.68
  const GR = ASHRAE_CONSTANTS.GRAINS_PER_LB;               // 7000

  const realSensible = Math.max(0, spaceSensible) + Math.max(0, oaSensible);
  const realLatent = Math.max(0, spaceLatent) + Math.max(0, oaLatent);
  const realLoad = realSensible + realLatent;

  const empty: DehumidStrategyComparison = {
    rshf: 1, oaFraction: 0,
    schemeA: { coolingTR: 0, reheatTR: 0 },
    schemeB: { doasCoolingTR: 0, recircCoolingTR: 0, reheatTR: 0, totalCoolingTR: 0 },
    coolingSavingTR: 0, reheatSavingTR: 0, flagged: false,
  };

  if (!(totalSupplyCFM > 0) || !Number.isFinite(realLoad) || realLoad <= 0) return empty;

  const rshf = realLoad > 0 ? realSensible / realLoad : 1;
  const oaFraction = totalSupplyCFM > 0 ? oaCFM / totalSupplyCFM : 0;

  const roomW_gr = calculatePsychrometrics(indoorTemp, indoorRH, altitude).humidityRatio * GR;

  // ── Scheme A: single mixed AHU, dehumidify the FULL flow then reheat ──
  const deltaW_gr_A = realLatent / (LAT * totalSupplyCFM);          // grains removed across whole flow
  const tDehumA = saturationTempFromW(Math.max(0, roomW_gr - deltaW_gr_A) / GR, altitude);
  const tBalanceA = indoorTemp - spaceSensible / (SENS * totalSupplyCFM); // supply temp that just meets space sensible
  const reheatA = SENS * totalSupplyCFM * Math.max(0, tBalanceA - tDehumA);
  const coolingA = realLoad + reheatA;

  // ── Scheme B: DOAS dries only the OA stream; recirc AHU trims space sensible ──
  const tDehumB = saturationTempFromW(roomW_gr / GR, altitude);     // dry OA to room dewpoint (neutral)
  const overcoolB = oaCFM > 0 ? SENS * oaCFM * Math.max(0, indoorTemp - tDehumB) : 0;
  const doasCooling = Math.max(0, oaSensible) + Math.max(0, oaLatent) + overcoolB;
  const reheatB = Math.max(0, overcoolB - Math.max(0, spaceSensible));
  const recircCooling = Math.max(0, Math.max(0, spaceSensible) - overcoolB) + Math.max(0, spaceLatent);
  const coolingB = doasCooling + recircCooling;

  const coolingSavingTR = TR(coolingA - coolingB);
  const reheatSavingTR = TR(reheatA - reheatB);

  const flagged = rshf < FLAG_RSHF_MAX && coolingSavingTR >= FLAG_MIN_SAVING_TR;

  return {
    rshf,
    oaFraction,
    schemeA: { coolingTR: TR(coolingA), reheatTR: TR(reheatA) },
    schemeB: {
      doasCoolingTR: TR(doasCooling),
      recircCoolingTR: TR(recircCooling),
      reheatTR: TR(reheatB),
      totalCoolingTR: TR(coolingB),
    },
    coolingSavingTR,
    reheatSavingTR,
    flagged,
  };
}
