/**
 * Ventilation and Heating Load Calculations
 * ASHRAE Fundamentals 2017, Chapters 6, 18, and 25
 */

import { RoomDetails, DesignConditions, VentilationLoadResult, HeatingLoadResult, ASHRAE_CONSTANTS } from './constants';
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
