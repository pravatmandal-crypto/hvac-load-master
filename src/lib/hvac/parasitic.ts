/**
 * Parasitic Gains Calculation
 * Duct and fan heat gains that must be added to room loads
 * ASHRAE Fundamentals 2017, Chapter 21
 */

import { ParasiticGainsResult } from './constants';

/**
 * Calculate parasitic heat gains from duct and fan
 * Duct Gain: Heat conducted through duct walls (typically 2-5% of Room Sensible Heat)
 * Fan Gain: Heat added by fan motor and drive (typically 1-3% of Total Sensible Heat)
 * 
 * @param roomSensible - Room sensible load in BTU/h
 * @param totalSensible - Total system sensible load in BTU/h
 * @param ductGainPct - Duct gain percentage (default 2%)
 * @param fanGainPct - Fan gain percentage (default 3%)
 * @returns Duct and fan gain values in BTU/h
 */
export const calculateParasiticGains = (
  roomSensible: number,
  totalSensible: number,
  ductGainPct: number = 2,
  fanGainPct: number = 3
): ParasiticGainsResult => {
  const ductGain = (roomSensible * ductGainPct) / 100;
  const fanGain = (totalSensible * fanGainPct) / 100;
  
  return { ductGain, fanGain };
};
