/**
 *  Duct and Pipe Sizing Calculations
 * ASHRAE Fundamentals 2017, Chapters 21 (Duct Design) and 22 (Pipe Design)
 */

import { DuctSizingResult, PipeSizingResult } from './constants';

/**
 * Size round duct using Equal Friction Method
 * ASHRAE Fundamentals Chapter 21
 * 
 * @param cfm - Airflow in CFM
 * @param friction - Friction loss in in. wg/100 ft (typical: 0.10)
 * @returns Duct diameter in inches and velocity in ft/s
 */
export const sizeDuct = (cfm: number, friction: number = 0.1): DuctSizingResult => {
  // Equal friction method — ASHRAE Fundamentals 2017, Chapter 21
  // D (in) = 0.537 × Q^0.4 / ΔP_f^0.2
  // Calibrated to match ASHRAE / SMACNA duct sizing tables for galvanized steel,
  // standard air (ρ = 0.075 lb/ft³), ε = 0.0005 ft roughness.
  // Example: 1000 CFM @ 0.1 in.wg/100 ft → 13.5" diameter, ~1000 FPM
  const diaInches = 0.537 * Math.pow(cfm, 0.4) / Math.pow(friction, 0.2);

  // Velocity (FPM): V = Q / A, where A (ft²) = π × (D_in/24)²  [radius = D_in/24 ft]
  const velocity = cfm / (Math.PI * Math.pow(diaInches / 24, 2));

  return { diameter: diaInches, velocity };
};

/**
 * Size rectangular duct using Equal Friction Method
 * For a given CFM and aspect ratio, calculate dimensions
 * 
 * @param cfm - Airflow in CFM
 * @param aspectRatio - Width/Height ratio (typical: 1.5-4.0)
 * @param friction - Friction loss in in. wg/100 ft
 * @returns Width and height in inches, and velocity in ft/s
 */
export const sizeRectangularDuct = (
  cfm: number,
  aspectRatio: number = 2.0,
  friction: number = 0.1
): { width: number; height: number; velocity: number } => {
  // Find equivalent round duct diameter using same Equal Friction formula as sizeDuct
  const diameter = 0.537 * Math.pow(cfm, 0.4) / Math.pow(friction, 0.2);
  const area = Math.PI * Math.pow(diameter / 24, 2); // Area in sq ft

  // For rectangular duct: Area = (W × H) / 144, W = AR × H
  // So: (AR × H²) / 144 = Area
  // H = sqrt(Area × 144 / AR)
  const height = Math.sqrt((area * 144) / aspectRatio);
  const width = height * aspectRatio;

  const velocity = cfm / area;

  return {
    width: Math.round(width * 10) / 10, // Round to nearest 0.1 inch
    height: Math.round(height * 10) / 10,
    velocity,
  };
};

/**
 * Size pipe for water flow using Hazen-Williams equation
 * Common for hydronic HVAC systems (chilled water, hot water)
 * 
 * @param gpm - Water flow in gallons per minute
 * @param maxVelocity - Maximum water velocity in ft/s (typical: 6-8)
 * @returns Pipe diameter in inches
 */
export const sizePipe = (gpm: number, maxVelocity: number = 8): PipeSizingResult => {
  // Continuity equation: GPM = 2.45 × D² × V
  // Where D is in inches, V is in ft/s
  // Solving for D: D = sqrt(GPM / (2.45 × V))
  const diameter = Math.sqrt(gpm / (2.45 * maxVelocity));
  
  return { diameter };
};

/**
 * Calculate velocity in a pipe given flow and diameter
 * 
 * @param gpm - Water flow in gallons per minute
 * @param diameterInches - Pipe diameter in inches
 * @returns Velocity in ft/s
 */
export const getPipeVelocity = (gpm: number, diameterInches: number): number => {
  // D² × V = GPM / 2.45
  return (gpm / 2.45) / Math.pow(diameterInches, 2);
};

/**
 * Calculate friction loss in pipe (Hazen-Williams equation simplified)
 * 
 * @param gpm - Water flow in gallons per minute
 * @param diameterInches - Pipe diameter in inches
 * @param lengthFt - Pipe length in feet
 * @param material - Pipe material (Copper, Steel, PVC, etc.)
 * @returns Friction loss in psi per 100 feet and total loss
 */
export const calculatePipeFrictionLoss = (
  gpm: number,
  diameterInches: number,
  lengthFt: number,
  material: string = 'Copper'
): { lossPerHundred: number; totalLoss: number } => {
  // Hazen-Williams C factors by material
  const cFactors: Record<string, number> = {
    Copper: 150,
    Steel: 140,
    PVC: 150,
    'Cast Iron': 100,
  };

  const C = cFactors[material] || 150;

  // Hazen-Williams: hf (ft) = 10.44 × L × Q^1.85 / (C^1.85 × d^4.87)
  // For loss per 100 ft in psi: set L=100, convert ft H₂O → psi (÷ 2.31)
  // → 10.44 × 100 / 2.31 = 452.0
  const lossPerHundred =
    452.0 * Math.pow(gpm, 1.85) / (Math.pow(C, 1.85) * Math.pow(diameterInches, 4.87));

  // Total loss accounting for length
  const totalLoss = (lossPerHundred * lengthFt) / 100;

  return { lossPerHundred, totalLoss };
};
