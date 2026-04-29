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
  // Use winter design conditions (fallback if not specified)
  const heatingOutdoorTemp = design.winterOutdoorTemp ?? (design.outdoorTemp - 50);
  const heatingIndoorTemp = design.winterIndoorTemp ?? design.indoorTemp;
  const deltaT = Math.max(0, heatingIndoorTemp - heatingOutdoorTemp);

  // 1. Transmission Losses through envelope
  let transmissionLoss = 0;
  elements.forEach((el) => {
    // For heating, use simple U × A × ΔT (no CLTD corrections)
    transmissionLoss += el.uValue * el.area * deltaT;
  });

  // 2. Infiltration/Ventilation Heating Load
  const volume = calculateRoomVolume(room);
  const cfm = (volume * room.facph) / ASHRAE_CONSTANTS.CFM_TO_VOLUME_CORRECTION;

  // Q_heating = 1.08 × CFM × ΔT
  const ventilationHeating = ASHRAE_CONSTANTS.SENSIBLE_COOLING_CONSTANT * cfm * deltaT;

  const totalHeatingLoad = transmissionLoss + ventilationHeating;

  return {
    transmissionLoss,
    ventilationHeating,
    totalHeatingLoad,
    cfm,
  };
};
