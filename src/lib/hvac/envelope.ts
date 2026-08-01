/**
 * Envelope (Wall, Glass, Roof) Gain Calculations
 * CLTD, SHGF, and Solar Gain calculations based on ASHRAE standards
 * ASHRAE Fundamentals 2017, Chapters 17-18
 */

import { EnvelopeElement, EnvelopeBreakdown, SolarGainResult, DesignConditions, CLTD_OFFSETS, SHGF_FACTORS, CLTD_COLOR_CORRECTION, CLTD_LM, WallColor } from './constants';
import { calculateSolarGain } from './solar';

/**
 * Ratio of 24-hour-mean to peak incident solar radiation, used as the heavy-mass limit
 * of the CLTD solar term. A fully damped assembly is driven by the DAILY MEAN sol-air
 * temperature, so its solar contribution is the daily mean irradiance, not the noon peak.
 * ≈ 79 / 301 BTU/h·ft² for a horizontal surface at low-to-mid latitude in midsummer.
 */
const SOLAR_MEAN_FRACTION = 0.26;

/**
 * Calculate Cooling Load Temperature Difference (CLTD) with full ASHRAE corrections
 * ASHRAE Fundamentals 1997, Chapter 26 / 2017, Chapter 17
 *
 * Corrections applied:
 *  1. Altitude correction (k_alt) — pressure-based solar radiation scaling
 *  2. Temperature base correction — adjusts for deviation from ASHRAE baseline
 *     (T_room=78°F, T_mean=85°F): CLTD += (78 - T_room) + (T_mean - 85)
 *  3. Color correction — Dark=0, Medium=−3, Light=−6 °F
 *  4. Latitude/Month (LM) correction — ASHRAE Table 26.4
 *  5. Mass damping — decrement factor from the assembly's dynamic response
 *
 * @param orientation - Surface orientation
 * @param type - Surface type
 * @param deltaT - T_outdoor_max − T_indoor (°F)
 * @param altitude - Altitude in feet
 * @param options - Optional correction parameters
 * @returns Corrected CLTD value in °F
 */
export const getCLTD = (
  orientation: EnvelopeElement['orientation'],
  type: EnvelopeElement['type'],
  deltaT: number,
  altitude: number = 0,
  options?: {
    indoorTemp?: number;       // actual indoor setpoint (°F), default 78
    outdoorMax?: number;       // outdoor design dry-bulb max (°F), default 95
    dailyRange?: number;       // outdoor daily temperature range (°F), default 20
    color?: WallColor;         // surface color, default 'Dark'
    designMonth?: number;      // 1=Jan … 12=Dec, default 7 (July)
    decrementFactor?: number | null; // 0..1 assembly dynamic response; null/absent = light construction
  }
): number => {
  const dT = Math.max(0, deltaT);
  const elevFt = Math.max(0, altitude || 0);
  const P = 14.696 * Math.pow(1 - 6.8754e-6 * elevFt, 5.2559);
  const radAltCorr = Math.min(1.25, Math.max(1, Math.pow(14.696 / P, 0.5)));

  if (type === 'Partition') return Math.max(0, dT * 0.6);
  if (type === 'Floor')     return Math.max(0, dT * 0.5);

  const offset = CLTD_OFFSETS[orientation] || 0;

  // 1. Base CLTD (orientation + altitude)
  let cltd: number;
  if (type === 'Roof') {
    cltd = (dT + 8) + offset * 0.35 * radAltCorr;
  } else {
    // Wall
    cltd = (dT + offset) * radAltCorr;
  }

  // 2. Temperature base correction
  // ASHRAE baseline: T_room=78°F, T_mean=85°F (outdoor max − DR/2)
  const tRoom    = options?.indoorTemp   ?? 78;
  const tOutMax  = options?.outdoorMax   ?? 95;
  const dr       = options?.dailyRange   ?? 20;
  const tMean    = tOutMax - dr / 2;
  const tempCorr = (78 - tRoom) + (tMean - 85);

  // 3. Color correction
  const colorCorr = CLTD_COLOR_CORRECTION[options?.color ?? 'Dark'] ?? 0;

  // 4. Latitude/Month correction (LM)
  const month = Math.min(12, Math.max(1, options?.designMonth ?? 7));
  const lmRow = CLTD_LM[orientation];
  const lmCorr = lmRow ? lmRow[month - 1] : 0;

  cltd = cltd + tempCorr + colorCorr + lmCorr;

  // 5. Mass damping (decrement factor)
  //
  // Everything above is the LIGHT-construction CLTD: it charges the surface the full
  // sol-air peak. A heavy assembly flattens that wave — at the limit the room sees only
  // the DAILY MEAN sol-air temperature, because the swing is absorbed and re-radiated
  // hours later, out of phase with the cooling peak.
  //
  // So split the CLTD into the two limits and interpolate on the decrement factor f:
  //
  //   heavy limit : air term at the daily MEAN (deltaT − DR/2)
  //                 + solar term at its 24-h mean (SOLAR_MEAN_FRACTION × peak)
  //   light limit : the value computed above (f = 1 reproduces it exactly)
  //
  // Glass is excluded — it is thermally massless and driven by transmitted solar, which
  // getSHGF handles separately. Partition and Floor already returned above; neither
  // carries a solar term, so damping a swing they do not have would be meaningless.
  // `typeof` guard, not `!= null` — switching an element back to a catalog type writes
  // null here (Firestore rejects undefined), and `null >= 0` is true in JS, which would
  // silently read as a fully damped assembly.
  const f = options?.decrementFactor;
  if (typeof f === 'number' && Number.isFinite(f) && f >= 0 && f < 1 && type !== 'Glass') {
    // Solar-driven portion of the light CLTD: the +8 roof / orientation offset, plus the
    // corrections that scale with absorbed radiation (color, latitude-month).
    const solarPeak = cltd - dT - tempCorr;
    const cltdHeavy = (dT - dr / 2) + SOLAR_MEAN_FRACTION * solarPeak + tempCorr;
    cltd = cltdHeavy + f * (cltd - cltdHeavy);
  }

  return Math.max(0, cltd);
};

/**
 * Get Solar Heat Gain Factor (SHGF) for glass surfaces
 * ASHRAE Fundamentals Table 17.3
 * @param orientation - Surface orientation
 * @param altitude - Altitude in feet
 * @returns SHGF value in BTU/h·ft²
 */
export const getSHGF = (
  orientation: EnvelopeElement['orientation'],
  altitude: number = 0
): number => {
  const baseSHGF = SHGF_FACTORS[orientation] || 40;

  const elevFt = Math.max(0, altitude || 0);
  const P = 14.696 * Math.pow(1 - 6.8754e-6 * elevFt, 5.2559);

  // SHGF increases with elevation due to reduced atmospheric attenuation.
  const altCorr = Math.min(1.25, Math.max(1, Math.pow(14.696 / P, 0.5)));

  return baseSHGF * altCorr;
};

/**
 * Calculate heat gain through a single envelope element
 * @param element - Envelope element (wall, glass, etc.)
 * @param design - Design conditions
 * @returns Gain breakdown (conduction, radiation, total)
 */
export const calculateSingleElementGain = (
  element: EnvelopeElement,
  design: DesignConditions
): SolarGainResult => {
  const deltaT = design.outdoorTemp - design.indoorTemp;

  if (element.type === 'Glass') {
    const conduction = element.uValue * element.area * deltaT;
    let radiation = 0;

    if (design.latitude !== undefined && design.designMonth !== undefined && design.designHour !== undefined) {
      const dayOfYear = (design.designMonth - 1) * 30 + 15;
      radiation = calculateSolarGain(
        design.latitude,
        design.longitude || 0,
        dayOfYear,
        design.designHour,
        element.orientation as any,
        element.area,
        element.shgc || 0.7,
        design.altitude || 0
      );
    } else {
      const autoSHGF = getSHGF(element.orientation, design.altitude || 0);
      const effectiveSHGF = element.isOverride ? element.solarFactor : autoSHGF;
      // SHGF table is calibrated for reference DSA glass (SC = 1.0, SHGC ≈ 0.87).
      // Convert SHGC → SC before applying: SC = SHGC / 0.87
      const sc = (element.shgc || 0.7) / 0.87;
      radiation = element.area * effectiveSHGF * sc;
    }

    return { conduction, radiation, total: conduction + radiation };
  } else {
    const autoCLTD = getCLTD(element.orientation, element.type, deltaT, design.altitude || 0, {
      indoorTemp:  design.indoorTemp,
      outdoorMax:  design.outdoorTemp,
      dailyRange:  design.dailyRange,
      color:       (element as any).color,
      designMonth: design.designMonth,
      // Denormalised from the assigned U Builder assembly. Omitting it here silently
      // reverted every heavy surface to the light-construction CLTD — the UI read-out
      // damped correctly while the load behind it did not.
      decrementFactor: element.decrementFactor,
    });
    const effectiveDeltaT = element.isOverride ? element.solarFactor : autoCLTD;
    const gain = element.uValue * element.area * effectiveDeltaT;
    return { conduction: gain, radiation: 0, total: gain };
  }
};

/**
 * Calculate total envelope gain through all elements (walls, roof, glass, etc.)
 * @param elements - Array of envelope elements
 * @param design - Design conditions
 * @returns Total sensible gain with breakdown by type
 */
export const calculateEnvelopeGain = (
  elements: EnvelopeElement[],
  design: DesignConditions
): EnvelopeBreakdown => {
  let sensible = 0;
  const breakdown = {
    walls: 0,
    roof: 0,
    glassTransmission: 0,
    glassSolar: 0,
    partitions: 0,
    floor: 0,
  };

  elements.forEach((el) => {
    const gain = calculateSingleElementGain(el, design);
    sensible += gain.total;

    if (el.type === 'Glass') {
      breakdown.glassTransmission += gain.conduction;
      breakdown.glassSolar += gain.radiation;
    } else if (el.type === 'Wall') {
      breakdown.walls += gain.total;
    } else if (el.type === 'Roof') {
      breakdown.roof += gain.total;
    } else if (el.type === 'Partition') {
      breakdown.partitions += gain.total;
    } else if (el.type === 'Floor') {
      breakdown.floor += gain.total;
    }
  });

  return { sensible, latent: 0, breakdown };
};
