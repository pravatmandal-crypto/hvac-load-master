/**
 * Solar Gain Calculations
 * ASHRAE Clear Sky Model with altitude corrections
 * ASHRAE Fundamentals 2017, Chapters 14 (Solar Geometry) and 17 (Cooling Load)
 */

import { SOLAR_INTENSITY_COEFFICIENTS } from './constants';

/**
 * Calculate solar gain on a surface using ASHRAE Clear Sky method
 * Accounts for solar geometry, surface orientation, and atmospheric conditions
 * 
 * @param lat - Latitude in degrees
 * @param lon - Longitude in degrees
 * @param dayOfYear - Day number (1-365)
 * @param hourOfDay - Hour of day (0-23, solar hour)
 * @param orientation - Surface orientation (N,NE,E,SE,S,SW,W,NW,H)
 * @param area - Surface area in square feet
 * @param shgc - Solar Heat Gain Coefficient (0.5-0.9 for most glass)
 * @param altitude - Altitude in feet
 * @returns Solar heat gain in BTU/h
 */
export const calculateSolarGain = (
  lat: number,
  lon: number,
  dayOfYear: number,
  hourOfDay: number,
  orientation: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'H',
  area: number,
  shgc: number = 0.7,
  altitude: number = 0
): number => {
  // 1. Solar Geometry
  const latRad = lat * (Math.PI / 180);
  
  // Solar Declination (δ) - ASHRAE equation
  const declination = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * (Math.PI / 180));
  const decRad = declination * (Math.PI / 180);
  
  // Hour Angle (H) - 0 at solar noon, negative in morning
  const hourAngle = 15 * (hourOfDay - 12);
  const hrRad = hourAngle * (Math.PI / 180);
  
  // Solar Altitude (β) - Angle of sun above horizon
  const sinBeta = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(hrRad);
  const beta = Math.asin(Math.max(-1, Math.min(1, sinBeta)));
  
  // Sun is below horizon - no solar gain
  if (beta <= 0) return 0;

  // Solar Azimuth (Φ) - Angle from South, positive West
  const cosPhi = (Math.sin(beta) * Math.sin(latRad) - Math.sin(decRad)) / (Math.cos(beta) * Math.cos(latRad));
  let phi = Math.acos(Math.max(-1, Math.min(1, cosPhi)));
  if (hourAngle < 0) phi = -phi; // Morning is East (negative)

  // 2. Surface Orientation
  let surfaceAzimuth = 0; // Measured from SOUTH, positive West
  let surfaceTilt = Math.PI / 2; // Vertical wall (radians)
  
  switch (orientation) {
    case 'S':  surfaceAzimuth = 0; break;
    case 'SW': surfaceAzimuth = Math.PI / 4; break;
    case 'W':  surfaceAzimuth = Math.PI / 2; break;
    case 'NW': surfaceAzimuth = 3 * Math.PI / 4; break;
    case 'N':  surfaceAzimuth = Math.PI; break;
    case 'NE': surfaceAzimuth = -3 * Math.PI / 4; break;
    case 'E':  surfaceAzimuth = -Math.PI / 2; break;
    case 'SE': surfaceAzimuth = -Math.PI / 4; break;
    case 'H':  surfaceTilt = 0; surfaceAzimuth = 0; break;
  }

  // 3. Angle of Incidence (θ)
  const cosTheta = Math.cos(beta) * Math.cos(phi - surfaceAzimuth) * Math.sin(surfaceTilt) + Math.sin(beta) * Math.cos(surfaceTilt);
  
  // 4. Solar Intensity (ASHRAE Clear Sky Model)
  // Month-based coefficients A, B, C
  const month = Math.floor(dayOfYear / 30.44);
  let A = SOLAR_INTENSITY_COEFFICIENTS.A[month] || 360;
  let B = SOLAR_INTENSITY_COEFFICIENTS.B[month] || 0.17;
  let C = SOLAR_INTENSITY_COEFFICIENTS.C[month] || 0.13;

  // Altitude Correction (altitude in feet)
  A = A * (1 + 0.000023 * altitude);
  B = B * (1 - 0.000012 * altitude);
  C = C * (1 - 0.000015 * altitude);

  // Direct normal irradiance
  const I_dn = A * Math.exp(-B / Math.sin(beta));
  
  // Direct and diffuse irradiance on surface
  const I_direct = I_dn * Math.max(0, cosTheta);
  const I_diffuse = I_dn * C * (1 + Math.cos(surfaceTilt)) / 2;
  
  const totalIrradiance = I_direct + I_diffuse;
  
  // Solar heat gain accounting for SHGC
  return area * totalIrradiance * shgc;
};
