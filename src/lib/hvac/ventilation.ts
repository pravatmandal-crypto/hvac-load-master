/**
 * Ventilation and Heating Load Calculations
 * ASHRAE Fundamentals 2017, Chapters 6, 18, and 25
 */

import { RoomDetails, DesignConditions, VentilationLoadResult, HeatingLoadResult, TFALoadResult, ASHRAE_CONSTANTS } from './constants';
import { calculateRoomVolume } from './geometry';
import { calculatePsychrometrics, dewPointFromHumidityRatio } from './psychrometrics';
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
  //
  // Partitions and floors face a NEIGHBOURING space, not outdoors, and cooling already says so:
  // getCLTD charges a partition 0.6 × ΔT and a floor 0.5 × ΔT, i.e. the far side sits partway
  // between indoors and outdoors. Heating used the full ΔT for them, which asserts the opposite
  // — that the same neighbouring space is at outdoor temperature. Both cannot be true, and the
  // full-ΔT version silently inflates the winter load: on TEZPUR GURT's CO Room the partition
  // and floor were 51 % of a 6,734 BTU/h transmission loss, and applying the cooling factors
  // consistently drops that transmission ~22 %.
  //
  // Kept as the SAME fractions the cooling side uses, so the two seasons state one physical
  // assumption rather than two. Walls, roof and glass keep the full ΔT — they do face outdoors.
  // (2026-08-02)
  const HEATING_NEIGHBOUR_FRACTION: Record<string, number> = { Partition: 0.6, Floor: 0.5 };
  let transmissionLoss = 0;
  elements.forEach((el) => {
    const fraction = HEATING_NEIGHBOUR_FRACTION[el.type as string] ?? 1;
    transmissionLoss += el.uValue * el.area * deltaT * fraction;
  });

  // 2. Ventilation / Infiltration Heating Load.
  //    • DOAS (ventilationStrategy='tfa-cold'): the DOAS pre-tempers the mechanical fresh air, so
  //      the space unit only covers INFILTRATION (winterInfiltrationACH, default 0.5 ACH).
  //    • No DOAS: the space unit must heat the full mechanical fresh air (FACPH) it introduces —
  //      use the greater of the OA airflow vs infiltration (mechanical OA pressurizes out most
  //      infiltration). Mirrors how summer cooling already counts the full OA. (Decision 2026-06-10.)
  const infiltrationACH = design.winterInfiltrationACH ?? 0.5;
  const volume = calculateRoomVolume(room);
  const infiltrationCFM = (volume * infiltrationACH) / ASHRAE_CONSTANTS.CFM_TO_VOLUME_CORRECTION;
  const isTFA = design.ventilationStrategy === 'tfa-cold';
  const facphCFM = (volume * (room.facph || 0)) / ASHRAE_CONSTANTS.CFM_TO_VOLUME_CORRECTION;
  const cfm = isTFA ? infiltrationCFM : Math.max(facphCFM, infiltrationCFM);
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

  // ── Apparatus dew point + reheat split ──
  // To strip OA moisture down to the supply humidity ratio, the coil must cool the
  // air to its apparatus dew point (saturation temp whose Wsat = supply W). If the
  // delivered supply is WARMER than that ADP (a neutral/warm-dry supply), the coil
  // over-cools to the ADP and a reheat coil sensibly warms it back to the supply
  // temp. If the supply is at/below the ADP (a cold supply), no overcool/reheat is
  // needed and the coil simply leaves at the supply temp.
  //   • Cold supply (e.g. 55°F/90%): ADP ≈ supply temp → reheat ≈ 0, coil → supply.
  //   • Neutral/warm-dry supply (e.g. 79°F/60%): ADP ≈ 64°F → coil cools to 64°F,
  //     then reheats 64→79°F. Sizing the coil only to the supply temp would understate
  //     it by exactly the reheat (the moisture can't be removed without reaching ADP).
  // Reheat is season-independent — it depends only on the supply setpoint. A small
  // deadband absorbs the few °F a real coil's bypass factor delivers above its ADP.
  const REHEAT_DEADBAND_F = 5;
  const coilADP = dewPointFromHumidityRatio(supply.humidityRatio, altitude);
  const needsReheat = supplyTemp - coilADP >= REHEAT_DEADBAND_F;
  const coilLeavingTemp = needsReheat ? coilADP : supplyTemp;
  const reheatCoilSensible = needsReheat
    ? ASHRAE_CONSTANTS.SENSIBLE_COOLING_CONSTANT * cfm * (supplyTemp - coilADP)
    : 0;

  // ── TFA coil load (DOAS sizes off this) ──
  // Sensible: cool OA from outdoor down to the coil LEAVING temp (ADP when reheat is
  // required, else the supply temp). Latent: remove moisture from OA W to supply W
  // (which is the saturated W at the ADP — same value either way).
  const deltaT_OAtoLeaving = design.outdoorTemp - coilLeavingTemp;
  const deltaW_OAtoSupply = outdoor.humidityRatio - supply.humidityRatio;
  let coilSensible = ASHRAE_CONSTANTS.SENSIBLE_COOLING_CONSTANT * cfm * deltaT_OAtoLeaving;
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

  // ── Winter heating on TFA (heats cold OA up to the winter supply setpoint) ──
  // In heating season the DOAS tempers incoming OA. Default supply is NEUTRAL
  // (= winter indoor temp): the DOAS carries the entire fresh-air heating duty
  // so the space heating system only covers envelope + infiltration losses
  // (calculateHeatingLoad uses winterInfiltrationACH, not facph, to match this).
  // Using the cold summer supplyTemp (55°F) here would wrongly under-heat the OA.
  let winterCoilSensible = 0;
  let warning: string | undefined;
  if (typeof design.winterOutdoorTemp === 'number') {
    const winterIndoorTemp = design.winterIndoorTemp ?? design.indoorTemp;
    const winterSupplyTemp =
      typeof design.tfaWinterSupplyTemp === 'number' ? design.tfaWinterSupplyTemp : winterIndoorTemp;
    const winterDeltaT = winterSupplyTemp - design.winterOutdoorTemp;
    if (winterDeltaT > 0) {
      winterCoilSensible = ASHRAE_CONSTANTS.SENSIBLE_COOLING_CONSTANT * cfm * winterDeltaT;
      // ERV sensible recovery applies in winter too — exhaust at indoor temp
      // pre-heats incoming OA.
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
    coilADP,
    reheatCoilSensible,
    winterCoilSensible,
    warning,
  };
};
