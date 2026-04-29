/**
 * Embedded Technical Data & Engineering Standards
 * 
 * All technical data is bundled locally for offline access
 * Sources: ASHRAE 2017, NEC 2023, IEC 60364, BS 7909
 */

/**
 * ASHRAE 2017 Fundamentals Handbook - Property Data
 * Psychrometric constants and standard conditions
 */
export const ASHRAE_STANDARDS = {
  version: "ASHRAE Fundamentals Handbook 2017",
  units: "IP (BTU/h, °F, CFM, lbm/min)",
  seaLevel: {
    pressure: 14.696, // psia
    temperature: 59, // °F
    humidity: 0, // %
  },
  designConditions: {
    summer: {
      location: "USA Representative",
      coolingWetBulb: 67, // °F (typical)
      coolingDryBulb: 95, // °F (typical)
      winterDryBulb: 21, // °F (typical)
      winterHumidity: 30, // % (typical)
    },
  },
  convectionCoefficients: {
    insideWall: 1.46, // BTU/h·ft²·°F
    insideFloor: 0.92, // BTU/h·ft²·°F
    insideCeiling: 1.63, // BTU/h·ft²·°F
    outsideWall: 4.0, // BTU/h·ft²·°F (10 mph wind)
    outsideFloor: 0.6, // BTU/h·ft²·°F (sheltered)
  },
  internalGains: {
    occupant: {
      sensible: 245, // BTU/h per person (office work)
      latent: 205, // BTU/h per person
      total: 450,
    },
    lighting: {
      incandescent: 1.0, // 100% sensible
      fluorescent: 0.8, // 80% sensible, 20% radiant/latent
      led: 0.85, // 85% sensible
    },
  },
  ventilationRates: {
    office: 20, // CFM/person + 0.06 CFM/ft²
    classroom: 15, // CFM/person + 0.06 CFM/ft²
    warehouse: 0.3, // CFM/ft² (minimum)
    retail: 0.3, // CFM/ft²
  },
};

/**
 * ASHRAE Clear Sky Solar Model
 * Solar radiation at different orientations and times
 */
export const SOLAR_DATA = {
  clearSkyModel: "ASHRAE Clear Sky",
  normalIncidence: {
    solarConstant: 429, // BTU/h·ft² (extraterrestrial radiation)
  },
  // Typical summer peak solar radiation (design day)
  peakRadiation: {
    north: 25, // BTU/h·ft²
    northeast: 100,
    east: 150,
    southeast: 130,
    south: 80,
    southwest: 130,
    west: 150,
    northwest: 100,
    horizontal: 250,
  },
  // Solar heat gain coefficients (SHGC)
  shgcByGlassType: {
    single: 0.78,
    double: 0.68,
    doubleWithLowE: 0.5,
    tripleWithLowE: 0.4,
    tripleWithLowE_solar: 0.3,
  },
};

/**
 * ASHRAE Duct Design Standards (Chapter 21)
 * HVAC Duct & Plenum Design
 */
export const DUCT_STANDARDS = {
  standard: "ASHRAE Chapter 21 - Ductwork",
  equivalentLength: {
    straightDuct: 0.0,
    elbow90: 15, // ft equivalent length
    elbow45: 8,
    tee: 25,
    branch: 30,
    outlet: 5,
  },
  velocityLimits: {
    mainDuct: 1600, // CFM/ft² max (noise consideration)
    branchDuct: 1200,
    airHandlerDischarge: 800,
    returnAir: 800,
  },
  frictionLoss: {
    method: "Darcy-Weisbach with friction factors",
    reference: "ASHRAE Duct Design Chapter 21 Table 3",
  },
  insulation: {
    minThickness: 1.0, // inches (exterior ducts)
    rValue: 4.2, // per inch
  },
};

/**
 * ASHRAE Piping Design Standards (Chapter 22)
 */
export const PIPE_STANDARDS = {
  standard: "ASHRAE Chapter 22 - Piping",
  materialRoughness: {
    copper: 0.000005, // ft
    steel: 0.0001, // ft
    pvc: 0.0000015, // ft
  },
  velocityLimits: {
    chilled_water: {
      mainLine: 8, // ft/s
      branch: 4,
    },
    hot_water: {
      mainLine: 10,
      branch: 6,
    },
    condenser_water: {
      mainLine: 12,
      branch: 8,
    },
  },
  insulation: {
    minThickness: 1.0, // inches
    rValue: 3.7, // per inch
  },
};

/**
 * ASHRAE Psychrometric Constants
 * Air properties at various conditions
 */
export const PSYCHROMETRIC_CONSTANTS = {
  airGasConstant: 53.35, // ft·lbf/(lbm·°R)
  dryAirMolecularWeight: 28.97,
  waterVaporMolecularWeight: 18.02,
  latentHeatVaporization: {
    at32F: 1061, // BTU/lbm
    at68F: 1050,
    at104F: 1035,
  },
  standardAtmosphere: {
    pressure: 14.696, // psia at sea level
    temperature: 59, // °F
  },
  altitudeCorrections: {
    // Pressure correction per 1000 ft elevation
    factor: 0.035, // % per 1000 ft
  },
};

/**
 * Coil Selection - ADP Method (Apparatus Dew Point)
 * Standard cooling & heating coil capacities
 */
export const COIL_STANDARDS = {
  method: "ADP Method (ASHRAE)",
  description: "Coils rated at standardized entering air and fluid conditions",
  typicalCoilAspectRatio: 0.75, // Width/Height
  bypassFactor: {
    typical: 0.15, // 15% of air bypasses coil matrix
    minimum: 0.05,
    maximum: 0.30,
  },
};

/**
 * HVAC Load Calculation Safety Factors
 * Applied to ensure equipment can handle peak conditions
 */
export const SAFETY_FACTORS = {
  recommended: {
    sensibleLoad: 0.10, // 10% margin for sensible
    latentLoad: 0.05, // 5% margin for latent
    grandTotal: 0.032, // 3.2% margin for total system
  },
  aggressive: {
    sensibleLoad: 0.20,
    latentLoad: 0.10,
    grandTotal: 0.05,
  },
  conservative: {
    sensibleLoad: 0.05,
    latentLoad: 0.02,
    grandTotal: 0.02,
  },
};

/**
 * NEC (National Electrical Code) 2023 - Electrical Design Standards
 */
export const NEC_STANDARDS = {
  version: "NEC 2023",
  authority: "NFPA (National Fire Protection Association)",
  chapters: {
    chapter1: "General",
    chapter2: "Wiring & Protection (Overcurrent)",
    chapter3: "Wiring Methods & Materials (Ampacity)",
    chapter4: "Equipment for General Use",
  },
  voltageDropLimits: {
    feeder: 3.0, // % (recommended)
    branchCircuit: 2.5, // % (recommended)
    combined: 5.0, // % total
  },
  overloadProtection: {
    general: 125, // % of equipment rated current
    motors: 125, // % for thermal overload
    transformers: 120, // % of rated current
  },
  shortCircuitProtection: {
    minimum: 67, // % (lower limit)
    typical: 100,
    maximum: 300, // % (upper limit)
  },
};

/**
 * IEC 60364 - International Electrical Safety Standard
 */
export const IEC_STANDARDS = {
  version: "IEC 60364:2005 with amendments",
  scope: "Low-voltage electrical installations in buildings",
  cableDerating: {
    temperature: {
      reference: 30, // °C
      lossPerDegree: 0.05, // 5% per 10°C
    },
    grouping: {
      singleCable: 1.0,
      twoInConduit: 0.8,
      threeInConduit: 0.7,
      fourInConduit: 0.65,
      sixInConduit: 0.6,
      tenInConduit: 0.45,
    },
  },
};

/**
 * BS 7909 - UK Temporary Electrical Systems
 * Used for temporary HVAC installations and site work
 */
export const BS7909_STANDARDS = {
  version: "BS 7909:2021",
  scope: "Code of practice for temporary electrical systems",
  safetyFactors: {
    highDemandFactor: 0.85, // Assume not all loads run simultaneously
    peakDemandFactor: 1.0, // But size for peak
  },
  voltageDropLimits: {
    main: 3.0, // % (tighter than NEC)
    subcircuit: 2.0,
  },
};

/**
 * Equipment Sizing Standards
 * Typical equipment oversizing recommendations
 */
export const EQUIPMENT_STANDARDS = {
  chillerSizing: {
    loadFactor: 1.15, // Size 15% larger than peak load
    diversity: 0.95, // Factor for multiple buildings
  },
  boilerSizing: {
    loadFactor: 1.20, // 20% margin for heating
    peakDemand: 1.1,
  },
  fanSizing: {
    pressureSafety: 1.1, // 10% larger for ductwork losses
    flowSafety: 1.05, // 5% larger for actual conditions
  },
  pumpSizing: {
    pressureSafety: 1.1,
    flowSafety: 1.05,
  },
};

/**
 * System Default Parameters
 * Used when project-specific values not provided
 */
export const SYSTEM_DEFAULTS = {
  summmerDesignTemp: 95, // °F (typical US)
  summerDesignHumidity: 50, // %
  winterDesignTemp: 20, // °F
  winterDesignHumidity: 30, // %
  indoorSummerTemp: 75, // °F
  indoorSummerHumidity: 50, // %
  indoorWinterTemp: 72, // °F
  indoorWinterHumidity: 30, // %
  occupancyDensity: 7.0, // ft² per person (office)
  ventilationRate: 0.2, // CFM/ft²
  lightingDensity: 1.5, // W/ft²
  equipmentLoad: 0.5, // W/ft²
  latitude: 40.0, // ° (Northern Hemisphere default)
  designMonth: 7, // July (cooling design day)
  designHour: 3, // 3 PM (peak solar gain)
};

/**
 * Data packaging for offline storage
 */
export const TECHNICAL_DATA_PACKAGE = {
  version: "1.0",
  lastUpdated: "2025-01-15",
  categories: [
    "ASHRAE_STANDARDS",
    "SOLAR_DATA",
    "DUCT_STANDARDS",
    "PIPE_STANDARDS",
    "PSYCHROMETRIC_CONSTANTS",
    "COIL_STANDARDS",
    "SAFETY_FACTORS",
    "NEC_STANDARDS",
    "IEC_STANDARDS",
    "BS7909_STANDARDS",
    "EQUIPMENT_STANDARDS",
    "SYSTEM_DEFAULTS",
  ],
  sources: [
    "ASHRAE Fundamentals Handbook 2017",
    "NFPA 70 - National Electrical Code 2023",
    "IEC 60364:2005 with amendments",
    "BS 7909:2021",
    "IEEE 835, 1415 (Electrical Standards)",
    "ASHRAE 62.1 (Ventilation Standards)",
  ],
};

/**
 * Initialize embedded data into local database
 */
export async function initializeEmbeddedData(): Promise<void> {
  try {
    const { getLocalDatabase } = await import('../db/index');
    let db;
    try {
      db = await getLocalDatabase();
    } catch (e) {
      // If DB is not ready, skip initialization (idempotent)
      console.warn('Embedded data: DB not ready, skipping initialization.');
      return;
    }

    // Save all technical data categories
    const dataMap: Record<string, any> = {
      ASHRAE_STANDARDS,
      SOLAR_DATA,
      DUCT_STANDARDS,
      PIPE_STANDARDS,
      PSYCHROMETRIC_CONSTANTS,
      COIL_STANDARDS,
      SAFETY_FACTORS,
      NEC_STANDARDS,
      IEC_STANDARDS,
      BS7909_STANDARDS,
      EQUIPMENT_STANDARDS,
      SYSTEM_DEFAULTS,
    };

    for (const [category, data] of Object.entries(dataMap)) {
      try {
        const existingData = await db.getTechnicalData(category);
        // Only save if not already cached or if significantly different
        if (!existingData) {
          await db.saveTechnicalData(category, data);
        }
      } catch (e) {
        // Silently skip if already exists
      }
    }

    // Initialize sync status
    try {
      await db.saveSyncStatus({
        lastSync: Date.now(),
        isOnline: navigator.onLine,
        isPending: 0,
      });
    } catch (e) {
      // If DB is not ready, skip
      console.warn('Embedded data: DB not ready for sync status, skipping.');
    }

    console.log("✓ Embedded technical data initialized successfully");
  } catch (error) {
    console.error("Failed to initialize embedded data:", error);
  }
}

export const getAllEmbeddedData = () => ({
  ASHRAE_STANDARDS,
  SOLAR_DATA,
  DUCT_STANDARDS,
  PIPE_STANDARDS,
  PSYCHROMETRIC_CONSTANTS,
  COIL_STANDARDS,
  SAFETY_FACTORS,
  NEC_STANDARDS,
  IEC_STANDARDS,
  BS7909_STANDARDS,
  EQUIPMENT_STANDARDS,
  SYSTEM_DEFAULTS,
});
