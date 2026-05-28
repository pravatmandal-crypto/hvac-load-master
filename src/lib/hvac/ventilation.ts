/**
 * Ventilation and Heating Load Calculations
 * ASHRAE Fundamentals 2017, Chapters 6, 18, and 25
 */

import { RoomDetails, DesignConditions, VentilationLoadResult, HeatingLoadResult, TFALoadResult, ASHRAE_CONSTANTS } from './constants';
import { calculateRoomVolume } from './geometry';
import { calculatePsychrometrics } from './psychrometrics';
import { EnvelopeElement } from './constants';

/**
 * Calculate ventilation load (sensible and latent)
 * Ventilation is the conditioning of outdoor air brought into the space
 * ASHRAE Equations 25.1 and 26.1-26.2
 * 
 * @param room - Room details
 * @param design - Design conditions
 * @returns Ventilation load breakdown
 */
export const calculateVentilationLoad = (
  room: RoomDetails,
  design: DesignConditions
): VentilationLoadResult => {
  const volume = calculateRoomVolume(room);
  const cfm = (volume * room.facph) / ASHRAE_CONSTANTS.CFM_TO_VOLUME_CORRECTION; // Convert ACH to CFM

  const outdoor = calculatePsychrometrics(design.outdoorTemp, design.outdoorHumidity, design.altitude || 0);
  const indoor = calculatePsychrometrics(design.indoorTemp, design.indoorHumidity, design.altitude || 0);

  const deltaT = Math.abs(design.outdoorTemp - design.indoorTemp);
  const deltaW = Math.abs(outdoor.humidityRatio - indoor.humidityRatio);

  // Sensible ventilation load: Qs = 1.08 × CFM × ΔT
  const sensible = ASHRAE_CONSTANTS.SENSIBLE_COOLING_CONSTANT * cfm * deltaT;

  // Latent ventilation load: Ql = 0.68 × CFM × ΔW × 7000
  const latent = ASHRAE_CONSTANTS.LATENT_COOLING_CONSTANT * cfm * (deltaW * ASHRAE_CONSTANTS.GRAINS_PER_LB);

  return { sensible, latent, cfm, outdoor, indoor, deltaT, deltaW };
};

/**
 * Calculate heating load (design condition outdoor air heating)
 * Heating load typically uses winter design conditions and ignores internal gains
 * ASHRAE Fundamentals Chapter 25
 * 
 * @param room - Room details
 * @param elements - Envelope elements
 * @param design - Design conditions
 * @returns Heating load breakdown
 */
export const calculateHeatingLoad = (
  room: RoomDetails,
  elements: EnvelopeElement[],
  design: DesignConditions
): HeatingLoadResult => {
  // Winter temps MUST be explicitly set — no engineering-bogus fallback from summer.
  const hasWinterOutdoor = typeof design.winterOutdoorTemp === 'number';
  const hasWinterIndoor = typeof design.winterIndoorTemp === 'number';

  if (!hasWinterOutdoor || !hasWinterIndoor) {
    return {
      transmissionLoss: 0,
      ventilationHeating: 0,
      slabLoss: 0,
      totalHeatingLoad: 0,
      cfm: 0,
      warning:
        'Winter design temperatures missing. Set winter outdoor and indoor temps in project design conditions to compute heating load.',
    };
  }

  const heatingOutdoorTemp = design.winterOutdoorTemp!;
  const heatingIndoorTemp = design.winterIndoorTemp!;
  const deltaT = Math.max(0, heatingIndoorTemp - heatingOutdoorTemp);

  // 1. Transmission Losses through envelope (simple steady-state U × A × ΔT — no CLTD for heating)
  let transmissionLoss = 0;
  elements.forEach((el) => {
    transmissionLoss += el.uValue * el.area * deltaT;
  });

  // 2. Infiltration Heating Load — use winter infiltration ACH, NOT facph (designed fresh air).
  //    facph is sized for ventilation/IAQ (5-10 ACH for offices) and grossly oversizes heating.
  //    Real building infiltration is typically 0.3-1.0 ACH. Default 0.5 (moderate construction).
  const infiltrationACH = design.winterInfiltrationACH ?? 0.5;
  const volume = calculateRoomVolume(room);
  const cfm = (volume * infiltrationACH) / ASHRAE_CONSTANTS.CFM_TO_VOLUME_CORRECTION;
  const ventilationHeating = ASHRAE_CONSTANTS.SENSIBLE_COOLING_CONSTANT * cfm * deltaT;

  // 3. Slab-edge perimeter loss (ASHRAE Ch.18 F-factor method) — only if room is on grade.
  let slabLoss = 0;
  if (room.isGroundFloor && room.slabPerimeter && room.slabPerimeter > 0) {
    const fFactor = room.slabFFactor ?? 0.73; // uninsulated slab default
    slabLoss = fFactor * room.slabPerimeter * deltaT;
  }

  const totalHeatingLoad = transmissionLoss + ventilationHeating + slabLoss;

  return {
    transmissionLoss,
    ventilationHeating,
    slabLoss,
    totalHeatingLoad,
    cfm,
  };
};

/**
 * Calculate TFA / DOAS load (separate outdoor-air conditioning unit).
 *
 * When `design.ventilationStrategy === 'tfa-cold'`, outdoor air is conditioned
 * by a DOAS unit to a user-defined supply state (default 55°F / 90% RH) — cold
 * and dry. The TFA coil handles the full OA load (sensible + latent), and the
 * cold dry supply delivered to the space offsets a portion of the primary
 * system's room load.
 *
 * Returns zero loads when strategy is not TFA — caller should branch on the
 * strategy before subtracting offsets from primary coil load.
 *
 * ASHRAE Fundamentals 2017, Chapters 6 and 25.
 */
export const calculateTFALoad = (
  room: RoomDetails,
  design: DesignConditions
): TFALoadResult => {
  // Use the same designed-OA CFM as ventilation (room.facph drives both).
  const volume = calculateRoomVolume(room);
  const cfm = (volume * room.facph) / ASHRAE_CONSTANTS.CFM_TO_VOLUME_CORRECTION;

  // Defaults match the locked engineering decision: cold-DOAS at 55°F / 90% RH.
  const supplyTemp = typeof design.tfaSupplyTemp === 'number' ? design.tfaSupplyTemp : 55;
  const supplyRH = typeof design.tfaSupplyHumidity === 'number' ? design.tfaSupplyHumidity : 90;
  const altitude = design.altitude || 0;

  const outdoor = calculatePsychrometrics(design.outdoorTemp, design.outdoorHumidity, altitude);
  const indoor = calculatePsychrometrics(design.indoorTemp, design.indoorHumidity, altitude);
  const supply = calculatePsychrometrics(supplyTemp, supplyRH, altitude);

  // ── TFA coil load (DOAS sizes off this) ──
  // Sensible: cool OA from outdoor to supply temp.
  // Latent: remove moisture from OA W to supply W.
  const deltaT_OAtoSupply = design.outdoorTemp - supplyTemp;
  const deltaW_OAtoSupply = outdoor.humidityRatio - supply.humidityRatio;
  let coilSensible = ASHRAE_CONSTANTS.SENSIBLE_COOLING_CONSTANT * cfm * deltaT_OAtoSupply;
  let coilLatent =
    ASHRAE_CONSTANTS.LATENT_COOLING_CONSTANT * cfm * (deltaW_OAtoSupply * ASHRAE_CONSTANTS.GRAINS_PER_LB);

  // ── ERV / HRV pre-conditioning ──
  // Recovers energy between exhaust (≈ indoor) and incoming OA streams.
  // Reduces TFA coil load.
  const epsS = Math.max(0, Math.min(1, design.ervSensibleEffectiveness ?? 0));
  const epsL = Math.max(0, Math.min(1, design.ervLatentEffectiveness ?? 0));
  const ervSensibleRecovered =
    epsS * ASHRAE_CONSTANTS.SENSIBLE_COOLING_CONSTANT * cfm * (design.outdoorTemp - design.indoorTemp);
  const ervLatentRecovered =
    epsL *
    ASHRAE_CONSTANTS.LATENT_COOLING_CONSTANT *
    cfm *
    ((outdoor.humidityRatio - indoor.humidityRatio) * ASHRAE_CONSTANTS.GRAINS_PER_LB);
  coilSensible = Math.max(0, coilSensible - ervSensibleRecovered);
  coilLatent = Math.max(0, coilLatent - ervLatentRecovered);

  // ── Space offsets (cold-DOAS credit to primary) ──
  // Cold dry supply cools and dehumidifies the room as it mixes in. Clamp at
  // zero so a warm or humid supply does not produce a negative offset (which
  // would inflate primary sizing in an unexpected way for Phase 1).
  const spaceSensibleOffset = Math.max(
    0,
    ASHRAE_CONSTANTS.SENSIBLE_COOLING_CONSTANT * cfm * (design.indoorTemp - supplyTemp),
  );
  const spaceLatentOffset = Math.max(
    0,
    ASHRAE_CONSTANTS.LATENT_COOLING_CONSTANT *
      cfm *
      ((indoor.humidityRatio - supply.humidityRatio) * ASHRAE_CONSTANTS.GRAINS_PER_LB),
  );

  // ── Winter heating on TFA (heats OA from winter outdoor to supply temp) ──
  let winterCoilSensible = 0;
  let warning: string | undefined;
  if (typeof design.winterOutdoorTemp === 'number') {
    const winterDeltaT = supplyTemp - design.winterOutdoorTemp;
    if (winterDeltaT > 0) {
      winterCoilSensible = ASHRAE_CONSTANTS.SENSIBLE_COOLING_CONSTANT * cfm * winterDeltaT;
      // ERV sensible recovery applies in winter too — exhaust at indoor temp
      // pre-heats incoming OA.
      const winterIndoorTemp = design.winterIndoorTemp ?? design.indoorTemp;
      const winterErvRecovered =
        epsS *
        ASHRAE_CONSTANTS.SENSIBLE_COOLING_CONSTANT *
        cfm *
        (winterIndoorTemp - design.winterOutdoorTemp);
      winterCoilSensible = Math.max(0, winterCoilSensible - winterErvRecovered);
    }
  } else {
    warning = 'Winter outdoor temperature missing — TFA winter heating not computed.';
  }

  return {
    coilSensible,
    coilLatent,
    coilTotal: coilSensible + coilLatent,
    spaceSensibleOffset,
    spaceLatentOffset,
    ervSensibleRecovered,
    ervLatentRecovered,
    cfm,
    supplyTemp,
    supplyHumidity: supplyRH,
    supplyHumidityRatio: supply.humidityRatio,
    winterCoilSensible,
    warning,
  };
};
