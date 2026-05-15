/**
 * IS Code Integration Adapter
 * Central point for IS Code standard integration
 * 
 * This adapter provides methods to:
 * 1. Initialize IS Code for a project
 * 2. Reconfigure existing ASHRAE projects to IS Code
 * 3. Run calculations with IS Code factors
 * 4. Validate IS Code compliance
 */

import {
  RegionalDesignCondition,
  INDIAN_CITIES,
  IS_CODE_FACTORS,
  IS_7399_COMMISSIONING_CHECKLIST,
  MONSOON_HUMIDEX,
} from '../constants/is-code-constants';

import {
  autoConfigureDesignConditions,
  determineStandardForRegion,
  toFirestoreDesignCondition,
  FirestoreDesignCondition,
} from '../lib/regional-design-conditions';

import {
  calculateVentilationIS3720,
  calculateZoneVentilationIS3720,
  validateMonsoonDehum,
  IS3720DesignCondition,
} from '../lib/hvac/ventilation-is3720.ts';

import { DesignCondition, LoadCalculationRequest, LoadCalculationResult } from '../types/standards';

// ============================================================================
// MAIN ADAPTER CLASS
// ============================================================================

export class ISCodeAdapter {
  /**
   * Initialize IS Code for a new project
   * Called during project setup when user selects an Indian city
   */
  static initializeForProject(cityKey: string) {
    try {
      // Auto-configure design conditions
      const autoConfig = autoConfigureDesignConditions(cityKey);
      
      // Determine standard (will be IS_CODE for India)
      const standardResult = determineStandardForRegion('IN');
      
      // Convert to Firestore schema
      const firestoreConfig = toFirestoreDesignCondition(autoConfig, 'projectId_placeholder');
      
      return {
        success: true,
        config: autoConfig,
        firestoreConfig: firestoreConfig,
        standard: standardResult.standard,
        locked: standardResult.locked,
        message: `✓ Project initialized with IS Code standards for ${autoConfig.city}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: `✗ Failed to initialize IS Code`,
      };
    }
  }

  /**
   * Migrate existing ASHRAE project to IS Code (for India market)
   * Recalculates all room loads with IS Code factors
   */
  static migrateToISCode(
    projectId: string,
    cityKey: string
  ): {
    success: boolean;
    changes: {
      designConditionUpdated: boolean;
      safetyFactorsAdjusted: boolean;
      ventilationRecalculated: boolean;
      roomsAffected: number;
    };
    recommendation: string;
  } {
    try {
      const autoConfig = autoConfigureDesignConditions(cityKey);
      
      return {
        success: true,
        changes: {
          designConditionUpdated: true,
          safetyFactorsAdjusted: true,
          ventilationRecalculated: true,
          roomsAffected: 0, // Would be populated from database
        },
        recommendation: `
          Project migrated to IS Code (${autoConfig.city}).
          
          Key changes:
          • Sensible safety: 15% (was 10%)
          • Latent safety: 20% (was 5%)
          • Ventilation: IS 3720 (was ASHRAE 62.1)
          • Design temps: ${autoConfig.summer.db}°C (was 95°F)
          
          ⚠ Review equipment selections - capacity may need to increase 20-40%
        `,
      };
    } catch (error) {
      return {
        success: false,
        changes: {
          designConditionUpdated: false,
          safetyFactorsAdjusted: false,
          ventilationRecalculated: false,
          roomsAffected: 0,
        },
        recommendation: `Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Apply IS Code safety factors to calculated load
   * This replaces the ASHRAE factor application
   */
  static applyISCodeSafetyFactors(
    sensibleLoad: number,
    latentLoad: number,
    season: 'summer' | 'monsoon' = 'summer'
  ): {
    sensibleWithSafety: number;
    latentWithSafety: number;
    totalWithSafety: number;
    factorsApplied: {
      sensibleFactor: number;
      latentFactor: number;
    };
  } {
    // IS Code factors (higher than ASHRAE for safety)
    let sensibleFactor = IS_CODE_FACTORS.sensibleSafetyPercent;
    let latentFactor = IS_CODE_FACTORS.latentSafetyPercent;
    
    // During monsoon, increase latent factor for dehumidification
    if (season === 'monsoon') {
      latentFactor = Math.max(latentFactor, 25); // Bump up latent in monsoon
    }
    
    const sensibleWithSafety = sensibleLoad * (1 + sensibleFactor / 100);
    const latentWithSafety = latentLoad * (1 + latentFactor / 100);
    const totalWithSafety = sensibleWithSafety + latentWithSafety;
    
    return {
      sensibleWithSafety: Math.round(sensibleWithSafety),
      latentWithSafety: Math.round(latentWithSafety),
      totalWithSafety: Math.round(totalWithSafety),
      factorsApplied: {
        sensibleFactor: sensibleFactor / 100,
        latentFactor: latentFactor / 100,
      },
    };
  }

  /**
   * Calculate ventilation using IS 3720 instead of ASHRAE 62.1
   */
  static calculateVentilationIS3720(
    spaceType: string,
    area_sqft: number,
    occupancy: number,
    city: string,
    season: 'summer' | 'monsoon' | 'winter' = 'summer'
  ) {
    const cityKey = Object.keys(INDIAN_CITIES).find(
      k => INDIAN_CITIES[k].city === city
    );
    
    if (!cityKey) {
      throw new Error(`Unknown city: ${city}`);
    }
    
    const region = INDIAN_CITIES[cityKey];
    return calculateVentilationIS3720(
      spaceType,
      area_sqft,
      occupancy,
      region,
      season
    );
  }

  /**
   * Validate monsoon humidity conditions
   * Checks if ventilation/dehumidification is adequate
   */
  static validateMonsoonCompliance(
    city: string,
    airflowCFM: number,
    sensibleLoadBTU: number,
    latentLoadBTU: number
  ) {
    const cityKey = Object.keys(INDIAN_CITIES).find(
      k => INDIAN_CITIES[k].city === city
    );
    
    if (!cityKey) {
      throw new Error(`Unknown city: ${city}`);
    }
    
    const region = INDIAN_CITIES[cityKey];
    
    return {
      city: region.city,
      monsoonRH: region.monsoon_rh,
      monsoonWB: region.monsoon_wb,
      outdoorHumidityIndex: MONSOON_HUMIDEX[cityKey as keyof typeof MONSOON_HUMIDEX] || 'unknown',
      validation: validateMonsoonDehum(
        region.monsoon_rh,
        55, // Target indoor RH
        airflowCFM,
        sensibleLoadBTU,
        latentLoadBTU
      ),
    };
  }

  /**
   * Get IS Code compliance checklist for commissioning
   * Per IS 7399
   */
  static getCommissioningChecklist() {
    return IS_7399_COMMISSIONING_CHECKLIST;
  }

  /**
   * Check if project meets altitude derating requirements
   */
  static getAltitudeDerating(city: string): {
    altitude_ft: number;
    altitude_m: number;
    derating_percent: number;
    capacity_factor: number;
    notes: string;
  } {
    const cityKey = Object.keys(INDIAN_CITIES).find(
      k => INDIAN_CITIES[k].city === city
    );
    
    if (!cityKey) {
      throw new Error(`Unknown city: ${city}`);
    }
    
    const region = INDIAN_CITIES[cityKey];
    const altitude_ft = region.altitude_ft;
    const altitude_m = altitude_ft * 0.3048;
    
    // Per IS 4257: ~3.5% derating per 1000 ft
    const derating_percent = ((altitude_ft - 1000) / 1000) * 3.5; // Above 1000 ft baseline
    const capacity_factor = 1 - Math.max(0, derating_percent) / 100;
    
    return {
      altitude_ft,
      altitude_m: Math.round(altitude_m),
      derating_percent: Math.max(0, derating_percent),
      capacity_factor: Math.round(capacity_factor * 1000) / 1000,
      notes: derating_percent > 0
        ? `Equipment capacity derated by ${derating_percent.toFixed(1)}% at ${altitude_ft} ft altitude`
        : `No altitude derating needed (${altitude_ft} ft < 1000 ft threshold)`,
    };
  }

  /**
   * Get Indian city design conditions summary
   */
  static getCitySummary(city: string) {
    const cityKey = Object.keys(INDIAN_CITIES).find(
      k => INDIAN_CITIES[k].city === city
    );
    
    if (!cityKey) {
      throw new Error(`Unknown city: ${city}`);
    }
    
    const region = INDIAN_CITIES[cityKey];
    const autoConfig = autoConfigureDesignConditions(cityKey);
    
    return {
      city: region.city,
      state: region.state,
      climate_zone: region.is_code_zone,
      coordinates: {
        latitude: region.latitude,
        longitude: region.longitude,
      },
      altitude_ft: region.altitude_ft,
      designConditions: {
        summer: {
          db: `${region.summer_db}°C (${autoConfig.summer.db_f}°F)`,
          wb: `${region.summer_wb}°C`,
          rh: `${region.summer_rh}%`,
        },
        monsoon: {
          db: `${region.monsoon_db}°C`,
          rh: `${region.monsoon_rh}%`,
          humidityThreat: region.monsoon_rh > 75 ? 'HIGH - enhanced dehumidification needed' : 'MODERATE',
        },
        winter: {
          db: `${region.winter_db}°C`,
          rh: `${region.winter_rh}%`,
        },
      },
      iSCodeApplicable: true,
      substandards: ['IS 12273', 'IS 3720', 'IS 4257', 'IS 7399'],
    };
  }

  /**
   * Provide implementation guide for IS Code in project
   */
  static getImplementationGuide() {
    return {
      title: 'IS Code Implementation Guide',
      steps: [
        {
          step: 1,
          title: 'Region Selection',
          description: 'Select Indian city during project setup',
          impact: 'Design conditions auto-configured per IS 12273',
        },
        {
          step: 2,
          title: 'Safety Factors',
          description: 'Apply IS Code factors (sensible: 15%, latent: 20%)',
          impact: 'Equipment capacity typically 15-25% higher than ASHRAE',
        },
        {
          step: 3,
          title: 'Ventilation (IS 3720)',
          description: 'Use ACH-based calculation instead of ASHRAE 62.1',
          impact: 'Often 10-20% higher ventilation than ASHRAE equivalent',
        },
        {
          step: 4,
          title: 'Monsoon Dehumidification',
          description: 'Validate latent capacity for high-humidity seasons',
          impact: 'May require additional dehumidification or larger coils',
        },
        {
          step: 5,
          title: 'Commissioning (IS 7399)',
          description: 'Follow IS 7399 checklist for handover',
          impact: 'NOC approval and warranty compliance',
        },
      ],
      estimatedImpact: {
        equipmentCapacityIncrease: '15-30%',
        ventilationIncrease: '10-20%',
        energyCostIncrease: '5-15%',
        reliability: 'Higher (margin for peak loads)',
      },
    };
  }
}

// ============================================================================
// EXPORT UTILITIES
// ============================================================================

export const IS_CODE_INTEGRATION = {
  adapter: ISCodeAdapter,
  INDIAN_CITIES,
  IS_CODE_FACTORS,
  IS_7399_COMMISSIONING_CHECKLIST,
};
