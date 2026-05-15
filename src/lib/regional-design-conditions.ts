/**
 * Regional Design Conditions Configuration
 * Provides smart selection and auto-configuration based on user's region choice
 * 
 * Implements IS 12273 design conditions
 * Used during project setup to lock standard to IS Code for India
 */

import { RegionalDesignCondition, INDIAN_CITIES, IS_CODE_FACTORS } from '../constants/is-code-constants';

// ============================================================================
// INTERFACES
// ============================================================================

export interface RegionOption {
  label: string;
  region: 'India' | 'USA' | 'International';
  cities: RegionalDesignCondition[];
}

export interface AutoConfiguredDesignCondition {
  city: string;
  country: string;
  standard: 'IS_CODE' | 'ASHRAE' | 'BOTH';
  
  // Design condition (varies by season)
  summer: {
    db: number;      // Dry Bulb (°C)
    wb: number;      // Wet Bulb (°C)
    rh: number;      // Relative Humidity (%)
    db_f: number;    // Dry Bulb (°F)
  };
  
  monsoon?: {
    db: number;
    wb: number;
    rh: number;
  };
  
  winter?: {
    db: number;
    rh: number;
  };
  
  // Region characteristics
  climate_zone: string;
  altitude_ft: number;
  
  // Safety factors per IS Code
  sensible_safety_percent: number;
  latent_safety_percent: number;
  
  // Notes
  notes: string;
}

// ============================================================================
// REGIONAL CONFIGURATION
// ============================================================================

/**
 * Get all available regions for selection
 */
export function getRegionOptions(): RegionOption[] {
  return [
    {
      label: 'India (IS Code Compliance)',
      region: 'India',
      cities: Object.values(INDIAN_CITIES),
    },
    {
      label: 'USA (ASHRAE Compliance)',
      region: 'USA',
      cities: [], // Would be populated with US cities
    },
    {
      label: 'International (ASHRAE Compliance)',
      region: 'International',
      cities: [],
    },
  ];
}

/**
 * Get all Indian cities for project setup selector
 */
export function getIndianCities(): Array<{ name: string; state: string; key: string }> {
  return Object.entries(INDIAN_CITIES).map(([key, city]) => ({
    name: city.city,
    state: city.state,
    key: key,
  }));
}

/**
 * Auto-configure design conditions based on selected city
 * This is called during project setup
 */
export function autoConfigureDesignConditions(
  cityKey: string
): AutoConfiguredDesignCondition {
  
  const city = INDIAN_CITIES[cityKey];
  if (!city) {
    throw new Error(`Unknown city: ${cityKey}`);
  }
  
  // Convert Celsius to Fahrenheit: F = C × 9/5 + 32
  const db_f = Math.round((city.summer_db * 9) / 5 + 32);
  
  const config: AutoConfiguredDesignCondition = {
    city: city.city,
    country: 'India',
    standard: 'IS_CODE',
    
    summer: {
      db: city.summer_db,
      wb: city.summer_wb,
      rh: city.summer_rh,
      db_f: db_f,
    },
    
    monsoon: {
      db: city.monsoon_db,
      wb: city.monsoon_wb,
      rh: city.monsoon_rh,
    },
    
    winter: {
      db: city.winter_db,
      rh: city.winter_rh,
    },
    
    climate_zone: city.is_code_zone,
    altitude_ft: city.altitude_ft,
    
    // IS Code safety factors (higher than ASHRAE)
    sensible_safety_percent: IS_CODE_FACTORS.sensibleSafetyPercent,
    latent_safety_percent: IS_CODE_FACTORS.latentSafetyPercent,
    
    notes: generateConfigNotes(city),
  };
  
  return config;
}

/**
 * Generate informative notes about the selected region
 */
function generateConfigNotes(city: RegionalDesignCondition): string {
  const notes: string[] = [
    `✓ Region: ${city.is_code_zone} climate`,
    `✓ Summer design: ${city.summer_db}°C (${Math.round(city.summer_db * 9/5 + 32)}°F) DB, ${city.summer_wb}°C WB`,
    `✓ Monsoon peak humidity: ${city.monsoon_rh}% RH`,
    `✓ Winter design: ${city.winter_db}°C DB`,
    `✓ Altitude: ${city.altitude_ft} ft (altitude derating: ${(100 - city.altitude_correction_factor * 100).toFixed(1)}%)`,
    `✓ Standard: IS Code (IS 12273, IS 3720, IS 4257)`,
  ];
  
  // Add climate-specific recommendations
  if (city.is_code_zone === 'Hot Dry') {
    notes.push(`⚠ Hot Dry Climate: Focus on sensible cooling, lower latent load`);
    notes.push(`⚠ Infiltration critical: Design tight ductwork, seal all gaps`);
  } else if (city.is_code_zone === 'Hot Humid') {
    notes.push(`⚠ Hot Humid Climate: High latent load, enhanced dehumidification critical`);
    notes.push(`⚠ Monsoon season very humid: RH may exceed 85%, maintain indoor RH <60%`);
  } else if (city.is_code_zone === 'Warm Humid') {
    notes.push(`⚠ Warm Humid Climate: Moderate sensible + latent load year-round`);
    notes.push(`⚠ Monsoon RH peak: Design for >75% outdoor RH`);
  } else if (city.is_code_zone === 'Temperate') {
    notes.push(`✓ Temperate Climate: Moderate design, balanced sensible/latent`);
    notes.push(`✓ Altitude cool: Lower outdoor temperature reduces load`);
  }
  
  if (city.altitude_ft > 3000) {
    notes.push(`⚠ High Altitude: Equipment capacity derated by ${((1 - city.altitude_correction_factor) * 100).toFixed(1)}%`);
  }
  
  return notes.join('\n');
}

// ============================================================================
// REGION-BASED STANDARD LOCKING
// ============================================================================

/**
 * Determine which standard to use based on selected region
 * This ensures compliance by default
 */
export function determineStandardForRegion(
  countryCode: string
): {
  standard: 'IS_CODE' | 'ASHRAE';
  locked: boolean;
  reason: string;
} {
  
  switch (countryCode.toUpperCase()) {
    case 'IN': // India
      return {
        standard: 'IS_CODE',
        locked: true,
        reason: 'Indian building codes require IS Code compliance',
      };
    
    case 'US': // USA
      return {
        standard: 'ASHRAE',
        locked: true,
        reason: 'US codes require ASHRAE compliance',
      };
    
    case 'CA': // Canada
    case 'AU': // Australia
    case 'NZ': // New Zealand
    case 'SG': // Singapore
    case 'MY': // Malaysia
      return {
        standard: 'ASHRAE',
        locked: true,
        reason: 'International code compliance (ASHRAE-based)',
      };
    
    default:
      return {
        standard: 'ASHRAE',
        locked: false,
        reason: 'ASHRAE as international default (user can override)',
      };
  }
}

// ============================================================================
// FIREBASE SCHEMA FOR REGIONAL CONFIG
// ============================================================================

/**
 * This interface represents how regional configuration is stored in Firestore
 * It's stored at: projects/{projectId}/config/designConditions
 */
export interface FirestoreDesignCondition {
  // Region selection
  country: string;
  city: string;
  cityKey: string;
  
  // Standard configuration
  standard: 'IS_CODE' | 'ASHRAE';
  standardLocked: boolean;
  
  // Design conditions (by season)
  summer: {
    db_celsius: number;
    db_fahrenheit: number;
    wb_celsius: number;
    rh_percent: number;
  };
  
  monsoon?: {
    db_celsius: number;
    wb_celsius: number;
    rh_percent: number;
  };
  
  winter?: {
    db_celsius: number;
    rh_percent: number;
  };
  
  // Safety & adjustment factors
  factors: {
    sensibleSafetyPercent: number;
    latentSafetyPercent: number;
    diversityFactor: number;
    altitudeDerating: number;
  };
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  appliedToRooms: boolean;
}

/**
 * Convert AutoConfiguredDesignCondition to Firestore schema
 */
export function toFirestoreDesignCondition(
  autoConfig: AutoConfiguredDesignCondition,
  projectId: string
): FirestoreDesignCondition {
  
  const city = INDIAN_CITIES[Object.keys(INDIAN_CITIES).find(
    k => INDIAN_CITIES[k].city === autoConfig.city
  ) || ''];
  
  return {
    country: autoConfig.country,
    city: autoConfig.city,
    cityKey: Object.keys(INDIAN_CITIES).find(k => INDIAN_CITIES[k].city === autoConfig.city) || '',
    
    // FirestoreDesignCondition records the LOCKED standard for the project, so
    // 'BOTH' (a comparison-only mode) is collapsed to 'IS_CODE' here — picking
    // IS_CODE makes sense since this conversion is only called for Indian cities.
    standard: autoConfig.standard === 'BOTH' ? 'IS_CODE' : autoConfig.standard,
    standardLocked: true,
    
    summer: {
      db_celsius: autoConfig.summer.db,
      db_fahrenheit: autoConfig.summer.db_f,
      wb_celsius: autoConfig.summer.wb,
      rh_percent: autoConfig.summer.rh,
    },
    
    monsoon: autoConfig.monsoon ? {
      db_celsius: autoConfig.monsoon.db,
      wb_celsius: autoConfig.monsoon.wb,
      rh_percent: autoConfig.monsoon.rh,
    } : undefined,
    
    winter: autoConfig.winter ? {
      db_celsius: autoConfig.winter.db,
      rh_percent: autoConfig.winter.rh,
    } : undefined,
    
    factors: {
      sensibleSafetyPercent: autoConfig.sensible_safety_percent,
      latentSafetyPercent: autoConfig.latent_safety_percent,
      diversityFactor: IS_CODE_FACTORS.diversityFactor,
      altitudeDerating: IS_CODE_FACTORS.altitudeDerating,
    },
    
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    appliedToRooms: false,
  };
}

// ============================================================================
// UTILITY: Compare Regions
// ============================================================================

export function compareRegionDesignConditions(
  city1Key: string,
  city2Key: string
): {
  city1: string;
  city2: string;
  summer_db_diff: number;
  summer_wb_diff: number;
  monsoon_rh_diff: number;
  recommendation: string;
} {
  
  const c1 = INDIAN_CITIES[city1Key];
  const c2 = INDIAN_CITIES[city2Key];
  
  if (!c1 || !c2) {
    throw new Error('Invalid city keys');
  }
  
  const db_diff = c2.summer_db - c1.summer_db;
  const wb_diff = c2.summer_wb - c1.summer_wb;
  const rh_diff = c2.monsoon_rh - c1.monsoon_rh;
  
  let recommendation = '';
  if (Math.abs(db_diff) > 5) {
    recommendation = `Large temperature difference (${db_diff > 0 ? '+' : ''}${db_diff}°C): Equipment capacity will differ`;
  } else if (Math.abs(rh_diff) > 15) {
    recommendation = `Monsoon humidity varies significantly: Dehumidification requirements differ`;
  } else {
    recommendation = 'Design conditions relatively similar';
  }
  
  return {
    city1: c1.city,
    city2: c2.city,
    summer_db_diff: db_diff,
    summer_wb_diff: wb_diff,
    monsoon_rh_diff: rh_diff,
    recommendation,
  };
}

// ============================================================================
// EXPORT SUMMARY
// ============================================================================

export const REGIONAL_CONFIG_INFO = {
  total_cities: Object.keys(INDIAN_CITIES).length,
  supported_countries: ['India', 'USA', 'International'],
  primary_standard_by_region: {
    India: 'IS Code (IS 12273, IS 3720, IS 4257)',
    USA: 'ASHRAE 2017',
    International: 'ASHRAE 2017',
  },
};
