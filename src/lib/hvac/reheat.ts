/**
 * Moisture Management and Reheat Calculations
 * ASHRAE Fundamentals 2017, Chapters 6 (Psychrometrics) and 18 (Cooling Load)
 */

import { MoistureResult, ReheatResult, ASHRAE_CONSTANTS } from './constants';

/**
 * Calculate moisture removal or addition rate
 * Determines if dehumidification or humidification is needed and how much
 * 
 * @param cfm - Airflow in CFM
 * @param outdoorW - Outdoor humidity ratio in lb/lb
 * @param indoorW - Indoor humidity ratio in lb/lb
 * @param isWinter - Whether it's heating season
 * @returns Moisture rate and required action
 */
export const calculateMoistureManagement = (
  cfm: number,
  outdoorW: number, // lb/lb dry air
  indoorW: number, // lb/lb dry air
  isWinter: boolean = false
): MoistureResult => {
  // Moisture rate = 4.5 × CFM × (W_out - W_in) lbs/hr
  // 4.5 = 60 min/hr × 0.075 lb/ft³ (standard air density at 70°F, 50% RH)
  const moistureRateLbsHr = ASHRAE_CONSTANTS.MOISTURE_CONST * cfm * (outdoorW - indoorW);

  // Latent heat of vaporization ≈ 1050 BTU/lb at typical coil temperatures
  const latentHeatBTU = ASHRAE_CONSTANTS.LATENT_HEAT_VAPORIZATION;

  if (isWinter) {
    // In winter, if outdoor W < indoor W, we need to add moisture (humidification)
    if (moistureRateLbsHr < 0) {
      return {
        rate: Math.abs(moistureRateLbsHr),
        action: 'Humidify',
        unit: 'lbs/hr',
        loadBTU: Math.abs(moistureRateLbsHr) * latentHeatBTU,
      };
    }
  } else {
    // In summer, if outdoor W > indoor W, we need to remove moisture (dehumidification)
    if (moistureRateLbsHr > 0) {
      return {
        rate: Math.abs(moistureRateLbsHr),
        action: 'Dehumidify',
        unit: 'lbs/hr',
        loadBTU: Math.abs(moistureRateLbsHr) * latentHeatBTU,
      };
    }
  }

  return { rate: 0, action: 'None', unit: 'lbs/hr', loadBTU: 0 };
};

/**
 * Calculate reheat requirement
 * If SHR (Sensible Heat Ratio) is too low, reheat may be needed to maintain comfort
 * while the cooling coil sufficiently removes moisture
 * ASHRAE Fundamentals Chapter 6
 * 
 * @param sensibleLoad - Room sensible load in BTU/h
 * @param latentLoad - Room latent load in BTU/h
 * @param targetSHR - Target Sensible Heat Ratio (typical: 0.75)
 * @returns Reheat requirement in BTU/h and status
 */
export const calculateReheat = (
  sensibleLoad: number,
  latentLoad: number,
  targetSHR: number = 0.75
): ReheatResult => {
  const totalLoad = sensibleLoad + latentLoad;
  if (totalLoad === 0) {
    return { reheatBTU: 0, currentSHR: 0, targetSHR, needed: false };
  }

  const currentSHR = sensibleLoad / totalLoad;

  if (currentSHR < targetSHR) {
    // Reheat required to raise SHR to target
    // Target = RequiredSensible / (RequiredSensible + LatentLoad)
    // Solving: RequiredSensible = (LatentLoad × TargetSHR) / (1 - TargetSHR)
    const requiredSensible = (latentLoad * targetSHR) / (1 - targetSHR);
    const reheatBTU = Math.max(0, requiredSensible - sensibleLoad);

    return { reheatBTU, currentSHR, targetSHR, needed: true };
  }

  return { reheatBTU: 0, currentSHR, targetSHR, needed: false };
};
