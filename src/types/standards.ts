/**
 * Design Standards Types
 * Interfaces for IS Code and ASHRAE design conditions
 */

/**
 * Base design condition interface
 */
export interface DesignCondition {
  standard: 'IS_CODE' | 'ASHRAE';
  country: string;
  region: string;
  
  // Summer (peak cooling)
  summer: {
    db_celsius: number;
    db_fahrenheit: number;
    wb_celsius: number;
    rh_percent: number;
  };
  
  // Monsoon (monsoon season - typically humid)
  monsoon?: {
    db_celsius: number;
    wb_celsius: number;
    rh_percent: number;
  };
  
  // Winter (heating)
  winter?: {
    db_celsius: number;
    rh_percent: number;
  };
  
  // Regional factors
  altitude_ft: number;
  climate_zone: string;
  
  // Safety & adjustment
  sensible_safety_percent: number;
  latent_safety_percent: number;
  diversity_factor: number;
  altitude_derating: number;
}

/**
 * Project-level design condition storage
 * Stored at: projects/{projectId}/config/designConditions
 */
export interface ProjectDesignConditions {
  // Primary condition (locked for region)
  primary: DesignCondition;
  
  // Secondary condition (optional comparison)
  secondary?: DesignCondition;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  lockedStandard: boolean;
  appliedToAllRooms: boolean;
}

/**
 * Room-level design condition override
 * Stored at: projects/{projectId}/rooms/{roomId}/designCondition
 */
export interface RoomDesignConditionOverride {
  overrideProjectDefault: boolean;
  
  // If overriding, specify custom condition
  custom?: DesignCondition;
  
  // Metadata
  reason?: string;
  approvedBy?: string;
  approvalDate?: string;
}

/**
 * Load calculation request with design conditions
 */
export interface LoadCalculationRequest {
  projectId: string;
  roomId: string;
  
  // Envelope data
  envelope: {
    elements: Array<{
      type: 'wall' | 'roof' | 'window' | 'door' | 'floor';
      area: number;
      uValue: number;
      shgc?: number;
      color?: 'dark' | 'medium' | 'light';
    }>;
  };
  
  // Internal gains
  occupancy: number;
  lighting_watts: number;
  equipment_kw: number;
  
  // Design condition to use for calculation
  designCondition: DesignCondition;
  season: 'summer' | 'monsoon' | 'winter';
}

/**
 * Load calculation result with standard reference
 */
export interface LoadCalculationResult {
  roomId: string;
  standard: 'IS_CODE' | 'ASHRAE';
  season: 'summer' | 'monsoon' | 'winter';
  
  // Load components (BTU/h)
  sensibleLoad: number;
  latentLoad: number;
  totalLoad: number;
  
  // With safety factors
  sensibleWithSafety: number;
  latentWithSafety: number;
  totalWithSafety: number;
  
  // CFM requirement
  designCFM: number;
  
  // Governing capacity
  requiredCapacity_TR: number;
  requiredCapacity_BTUh: number;
  
  // Metadata
  designCondition: DesignCondition;
  calculationMethod: string;
  timestamp: string;
  notes?: string;
}

/**
 * Equipment selection context
 */
export interface EquipmentSelectionContext {
  requiredTR: number;
  requiredCFM: number;
  standard: 'IS_CODE' | 'ASHRAE';
  region: string;
  season: 'summer' | 'monsoon' | 'winter';
  
  // Equipment must handle these conditions
  designDB: number; // °C
  designWB: number; // °C
  designRH: number; // %
  
  // Special requirements by region
  dehumidificationRequired?: boolean;
  altitudeDerating?: number;
}

/**
 * Comparison between standards
 */
export interface StandardComparison {
  ashrae: LoadCalculationResult;
  isCode: LoadCalculationResult;
  
  comparison: {
    sensible_diff_percent: number;
    latent_diff_percent: number;
    total_diff_percent: number;
    governs: 'IS_CODE' | 'ASHRAE' | 'Equal';
  };
}
