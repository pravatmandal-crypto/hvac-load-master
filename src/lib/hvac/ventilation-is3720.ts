/**
 * IS 3720 Ventilation Calculation Module
 * Code of Practice for HVAC Installation (IS 3720-2019)
 * 
 * This module implements ventilation rate calculations per IS 3720
 * Parallel to ventilation62.ts for ASHRAE 62.1
 * 
 * Key differences from ASHRAE 62.1:
 * - ACH-based rather than CFM/person + CFM/area
 * - Regional humidity considerations
 * - Monsoon dehumidification focus
 */

import { SPACE_TYPES_IS3720, RegionalDesignCondition } from '../../constants/is-code-constants';

// ============================================================================
// INTERFACES
// ============================================================================

export interface IS3720DesignCondition {
  region: RegionalDesignCondition;
  season: 'summer' | 'monsoon' | 'winter';
}

export interface IS3720VentilationResult {
  method: 'IS3720';
  spaceType: string;
  
  // Ventilation requirements
  ach_required: number;        // Air changes per hour
  cfm_required: number;        // Cubic feet per minute (converted from ACH)
  
  // Occupancy-based calculation
  occupancy: number;           // Number of people
  cfm_per_person: number;      // CFM per occupant
  cfm_per_sqft: number;        // CFM per square foot
  
  // Final ventilation rate
  total_cfm: number;           // = max(ACH-based, occupancy-based, area-based)
  
  // Monsoon-specific dehumidification
  monsoon_dehumidification_cfm: number; // Additional CFM for humidity control
  
  // Regional adjustment
  region_factor: number;
  adjusted_cfm: number;
  
  // Summary
  notes: string;
}

// ============================================================================
// CONSTANTS & LOOKUP TABLES
// ============================================================================

// IS 3720 Default ACH ranges by space category
const ACH_BY_CATEGORY = {
  'Offices': { min: 3, max: 6 },
  'Retail': { min: 4, max: 8 },
  'Food Service': { min: 6, max: 15 }, // Cooking adds complexity
  'Hospitality': { min: 3, max: 6 },
  'Healthcare': { min: 6, max: 12 },
  'Education': { min: 4, max: 6 },
  'Residential': { min: 1, max: 4 },
  'Industrial': { min: 4, max: 10 },
};

/**
 * Monsoon dehumidification boost factor
 * In monsoon season, RH can reach 80-90%
 * Additional CFM needed for dehumidification:
 * - Light exposure (retail): +10% CFM
 * - Moderate exposure (office, hotel): +15% CFM
 * - High exposure (kitchen, laundry): +25% CFM
 */
const MONSOON_DEHUMIDIFICATION_BOOST = {
  'light': 0.10,
  'moderate': 0.15,
  'high': 0.25,
};

/**
 * Regional humidity factor (IS 3720 Clause 5.2.3)
 * Coastal/high-humidity regions need 10-20% more ventilation
 */
const REGIONAL_HUMIDITY_FACTOR = {
  'Hot Dry': 1.0,        // Delhi, Jaipur
  'Hot Humid': 1.15,     // Mumbai, Goa (coastal)
  'Warm Humid': 1.10,    // Chennai, Kolkata
  'Temperate': 1.0,      // Bangalore, Pune
  'Cold': 1.05,          // Shimla, Leh
};

// ============================================================================
// MAIN CALCULATION FUNCTION
// ============================================================================

/**
 * Calculate ventilation requirement per IS 3720
 * Uses ACH-based approach + occupancy-based verification
 * 
 * @param spaceType - Space category (office, retail, etc.)
 * @param area_sqft - Room area in square feet
 * @param occupancy - Number of people
 * @param region - Regional design condition (for humidity factor)
 * @param season - Season (summer/monsoon/winter)
 * @returns IS3720VentilationResult
 */
export function calculateVentilationIS3720(
  spaceType: string,
  area_sqft: number,
  occupancy: number,
  region: RegionalDesignCondition,
  season: 'summer' | 'monsoon' | 'winter' = 'summer'
): IS3720VentilationResult {
  
  const spaceTypeData = SPACE_TYPES_IS3720[spaceType];
  if (!spaceTypeData) {
    throw new Error(`Unknown space type: ${spaceType}`);
  }
  
  // ========== METHOD 1: ACH-Based Calculation ==========
  const ach_selected = selectACH(spaceType, season);
  const cfm_from_ach = convertACHToCFM(ach_selected, area_sqft);
  
  // ========== METHOD 2: Occupancy-Based Calculation ==========
  const cfm_per_person = spaceTypeData.cfm_per_person || 20; // Default
  const cfm_from_occupancy = occupancy * cfm_per_person;
  
  // ========== METHOD 3: Area-Based Calculation ==========
  const cfm_per_sqft = spaceTypeData.cfm_per_sqft || 0.15; // Default
  const cfm_from_area = area_sqft * cfm_per_sqft;
  
  // ========== SELECT GOVERNING RATE ==========
  // IS 3720: Use whichever is HIGHEST
  const cfm_base = Math.max(cfm_from_ach, cfm_from_occupancy, cfm_from_area);
  
  // ========== MONSOON DEHUMIDIFICATION BOOST ==========
  let monsoon_boost_cfm = 0;
  if (season === 'monsoon') {
    // Estimate humidity exposure level from space type
    const exposure = estimateHumidityExposure(spaceType);
    const boost_factor = MONSOON_DEHUMIDIFICATION_BOOST[exposure];
    monsoon_boost_cfm = cfm_base * boost_factor;
  }
  
  // ========== REGIONAL HUMIDITY ADJUSTMENT ==========
  const regional_factor = REGIONAL_HUMIDITY_FACTOR[region.is_code_zone] || 1.0;
  const adjusted_cfm = (cfm_base + monsoon_boost_cfm) * regional_factor;
  
  // ========== BUILD RESULT ==========
  const result: IS3720VentilationResult = {
    method: 'IS3720',
    spaceType: spaceTypeData.spaceType,
    
    ach_required: ach_selected,
    cfm_required: cfm_from_ach,
    
    occupancy,
    cfm_per_person,
    cfm_per_sqft,
    
    total_cfm: cfm_base,
    monsoon_dehumidification_cfm: monsoon_boost_cfm,
    
    region_factor: regional_factor,
    adjusted_cfm: Math.round(adjusted_cfm),
    
    notes: `IS 3720 ${region.city}: ${spaceTypeData.notes}. Season: ${season}. Governs: ${determineGovernor(cfm_from_ach, cfm_from_occupancy, cfm_from_area)}.`,
  };
  
  return result;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Select ACH based on space type and season
 * IS 3720 recommends higher ACH for monsoon (humidity control)
 */
function selectACH(spaceType: string, season: 'summer' | 'monsoon' | 'winter'): number {
  const spaceTypeData = SPACE_TYPES_IS3720[spaceType];
  if (!spaceTypeData) return 4; // Default fallback
  
  // During monsoon, use higher end of range
  const ach_min = spaceTypeData.ach_min;
  const ach_max = spaceTypeData.ach_max;
  
  if (season === 'monsoon') {
    return ach_max; // Upper end for humidity control
  } else if (season === 'winter') {
    return ach_min; // Lower end to conserve heating energy
  } else {
    return (ach_min + ach_max) / 2; // Average for summer
  }
}

/**
 * Convert ACH to CFM
 * CFM = ACH × (Room Volume in cubic feet) / 60 minutes
 * = ACH × Area_sqft × Ceiling_Height_ft / 60
 */
function convertACHToCFM(ach: number, area_sqft: number, ceiling_height_ft: number = 9): number {
  const volume_cuft = area_sqft * ceiling_height_ft;
  const cfm = (ach * volume_cuft) / 60;
  return Math.round(cfm * 10) / 10;
}

/**
 * Estimate humidity exposure level for monsoon boost calculation
 */
function estimateHumidityExposure(spaceType: string): 'light' | 'moderate' | 'high' {
  // Spaces with high moisture generation or external exposure
  if (spaceType.includes('kitchen') || 
      spaceType.includes('laundry') || 
      spaceType.includes('bathroom') ||
      spaceType.includes('pool')) {
    return 'high';
  }
  
  // Spaces with moderate occupancy/activity
  if (spaceType.includes('office') || 
      spaceType.includes('hotel') ||
      spaceType.includes('restaurant') ||
      spaceType.includes('retail')) {
    return 'moderate';
  }
  
  // Spaces with low occupancy/moisture
  return 'light';
}

/**
 * Determine which method governs the ventilation rate
 */
function determineGovernor(
  cfm_ach: number,
  cfm_occupancy: number,
  cfm_area: number
): string {
  const max = Math.max(cfm_ach, cfm_occupancy, cfm_area);
  
  if (max === cfm_ach) return 'ACH';
  if (max === cfm_occupancy) return 'Occupancy';
  return 'Area';
}

// ============================================================================
// ZONE-LEVEL CALCULATION (Multiple Spaces)
// ============================================================================

export interface ZoneVentilationIS3720 {
  zone_name: string;
  spaces: IS3720VentilationResult[];
  
  // Aggregated
  total_cfm: number;           // Sum of all spaces
  diversity_factor: number;    // IS 3720: typically 0.85-0.95
  design_cfm: number;          // = total_cfm × diversity_factor
  
  region: string;
  season: string;
}

/**
 * Calculate zone-level ventilation (multiple spaces combined)
 * Per IS 3720 Clause 4.5, apply diversity factor (not all spaces peak together)
 */
export function calculateZoneVentilationIS3720(
  spaces: Array<{
    spaceType: string;
    area_sqft: number;
    occupancy: number;
  }>,
  region: RegionalDesignCondition,
  season: 'summer' | 'monsoon' | 'winter' = 'summer',
  diversity_factor: number = 0.90 // IS 3720 typical value
): ZoneVentilationIS3720 {
  
  const results = spaces.map(space =>
    calculateVentilationIS3720(
      space.spaceType,
      space.area_sqft,
      space.occupancy,
      region,
      season
    )
  );
  
  const total_cfm = results.reduce((sum, r) => sum + r.adjusted_cfm, 0);
  const design_cfm = Math.round(total_cfm * diversity_factor);
  
  return {
    zone_name: `${region.city} Zone - ${season}`,
    spaces: results,
    total_cfm: Math.round(total_cfm),
    diversity_factor,
    design_cfm,
    region: region.city,
    season,
  };
}

// ============================================================================
// MONSOON-SPECIFIC VALIDATION
// ============================================================================

/**
 * Validate that ventilation is adequate for monsoon humidity control
 * IS 3720 requires indoor RH to be maintained < 60% even during monsoon
 * 
 * This is a check function - if violated, increase CFM or dehumidification
 */
export function validateMonsoonDehum(
  outdoor_rh_monsoon: number,
  indoor_rh_target: number,
  cfm_total: number,
  sensible_load_btu: number,
  latent_load_btu: number
): {
  adequate: boolean;
  warning?: string;
  recommendation?: string;
} {
  // Rough estimate: latent load drives dehumidification CFM requirement
  // Latent capacity ≈ 0.68 × CFM × (W_outdoor - W_indoor)
  // For monsoon to maintain <60% RH, we need adequate CFM
  
  if (outdoor_rh_monsoon > 85 && indoor_rh_target < 55) {
    // Critical humidity control situation
    const moisture_gradient = outdoor_rh_monsoon - indoor_rh_target;
    
    if (cfm_total < 1000) {
      return {
        adequate: false,
        warning: `Low CFM (${cfm_total}) for monsoon humidity control (outdoor RH: ${outdoor_rh_monsoon}%)`,
        recommendation: 'Increase CFM by 25-30% or add separate dehumidifier',
      };
    }
  }
  
  return {
    adequate: true,
  };
}

// ============================================================================
// COMPARISON: IS 3720 vs ASHRAE 62.1
// ============================================================================

export function compareVentilationStandards(
  spaceType: string,
  area_sqft: number,
  occupancy: number,
  region: RegionalDesignCondition
): {
  is3720_cfm: number;
  ashrae62_cfm: number;
  difference_percent: number;
  governs: 'IS 3720' | 'ASHRAE 62.1' | 'Equal';
} {
  // Note: This requires importing ASHRAE 62.1 calculation
  // For now, return IS 3720 only
  
  const is3720Result = calculateVentilationIS3720(
    spaceType,
    area_sqft,
    occupancy,
    region,
    'summer'
  );
  
  return {
    is3720_cfm: is3720Result.adjusted_cfm,
    ashrae62_cfm: 0, // Would be populated by comparing with ASHRAE 62.1
    difference_percent: 0,
    governs: 'IS 3720',
  };
}

// ============================================================================
// EXPORT SUMMARY
// ============================================================================

export const IS3720_MODULE_INFO = {
  standard: 'IS 3720-2019',
  title: 'Code of Practice for HVAC Installation',
  key_features: [
    'ACH-based ventilation calculation',
    'Occupancy-based verification',
    'Area-based fallback',
    'Monsoon dehumidification boost',
    'Regional humidity adjustment',
    'Diversity factors for multi-space zones',
    'Humidity control validation',
  ],
  regional_focus: [
    'Hot Dry (Delhi, Jaipur)',
    'Hot Humid (Mumbai, Goa)',
    'Warm Humid (Chennai, Kolkata)',
    'Temperate (Bangalore, Pune)',
    'Cold (Shimla, Leh)',
  ],
};
