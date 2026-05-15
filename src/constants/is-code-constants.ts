/**
 * IS Code Standards Constants
 * Based on: IS 12273 (Design & Installation of HVAC Systems)
 *           IS 3720 (Ventilation & Infiltration)
 *           IS 4257 (HVAC Code of Practice)
 * 
 * Regional design conditions for Indian cities per IS 12273
 */

// ============================================================================
// SECTION 1: REGIONAL DESIGN CONDITIONS (IS 12273)
// ============================================================================

export interface RegionalDesignCondition {
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  altitude_ft: number;
  
  // Summer Design (Dry Bulb & Wet Bulb)
  summer_db: number; // °C
  summer_wb: number; // °C (wet bulb)
  summer_rh: number; // % Relative Humidity
  
  // Winter Design
  winter_db: number; // °C
  winter_rh: number; // %
  
  // Monsoon (June-September)
  monsoon_db: number; // °C
  monsoon_wb: number; // °C
  monsoon_rh: number; // %
  
  // Solar radiation corrections
  altitude_correction_factor: number;
  
  // IS Code Zone (for building regulations)
  is_code_zone: string; // "Hot Dry" | "Hot Humid" | "Warm Humid" | "Temperate" | "Cold"
}

export const INDIAN_CITIES: Record<string, RegionalDesignCondition> = {
  'delhi': {
    city: 'Delhi',
    state: 'Delhi',
    latitude: 28.6,
    longitude: 77.2,
    altitude_ft: 710,
    summer_db: 45, // 113°F
    summer_wb: 28, // 82°F
    summer_rh: 25,
    winter_db: 4, // 39°F
    winter_rh: 60,
    monsoon_db: 32, // 90°F
    monsoon_wb: 26, // 79°F
    monsoon_rh: 65,
    altitude_correction_factor: 0.97,
    is_code_zone: 'Hot Dry',
  },
  
  'mumbai': {
    city: 'Mumbai',
    state: 'Maharashtra',
    latitude: 19.1,
    longitude: 72.8,
    altitude_ft: 36,
    summer_db: 40, // 104°F
    summer_wb: 27, // 81°F
    summer_rh: 65,
    winter_db: 13, // 55°F
    winter_rh: 65,
    monsoon_db: 28, // 82°F
    monsoon_wb: 25, // 77°F
    monsoon_rh: 85, // Very humid
    altitude_correction_factor: 1.0,
    is_code_zone: 'Hot Humid',
  },
  
  'chennai': {
    city: 'Chennai',
    state: 'Tamil Nadu',
    latitude: 13.0,
    longitude: 80.2,
    altitude_ft: 7,
    summer_db: 39, // 102°F
    summer_wb: 27, // 81°F
    summer_rh: 68,
    winter_db: 15, // 59°F
    winter_rh: 62,
    monsoon_db: 30, // 86°F
    monsoon_wb: 26, // 79°F
    monsoon_rh: 78,
    altitude_correction_factor: 1.0,
    is_code_zone: 'Warm Humid',
  },
  
  'bangalore': {
    city: 'Bangalore',
    state: 'Karnataka',
    latitude: 12.9,
    longitude: 77.5,
    altitude_ft: 3000,
    summer_db: 32, // 90°F - mild due to altitude
    summer_wb: 21, // 70°F
    summer_rh: 42,
    winter_db: 13, // 55°F
    winter_rh: 50,
    monsoon_db: 24, // 75°F
    monsoon_wb: 20, // 68°F
    monsoon_rh: 72,
    altitude_correction_factor: 0.91,
    is_code_zone: 'Temperate',
  },
  
  'jaipur': {
    city: 'Jaipur',
    state: 'Rajasthan',
    latitude: 26.9,
    longitude: 75.8,
    altitude_ft: 1430,
    summer_db: 47, // 116°F - hottest
    summer_wb: 25, // 77°F
    summer_rh: 15,
    winter_db: 2, // 36°F
    winter_rh: 45,
    monsoon_db: 32, // 90°F
    monsoon_wb: 24, // 75°F
    monsoon_rh: 55,
    altitude_correction_factor: 0.95,
    is_code_zone: 'Hot Dry',
  },
  
  'kolkata': {
    city: 'Kolkata',
    state: 'West Bengal',
    latitude: 22.6,
    longitude: 88.4,
    altitude_ft: 9,
    summer_db: 38, // 100°F
    summer_wb: 27, // 81°F
    summer_rh: 60,
    winter_db: 9, // 48°F
    winter_rh: 55,
    monsoon_db: 29, // 84°F
    monsoon_wb: 25, // 77°F
    monsoon_rh: 82,
    altitude_correction_factor: 1.0,
    is_code_zone: 'Warm Humid',
  },
  
  'hyderabad': {
    city: 'Hyderabad',
    state: 'Telangana',
    latitude: 17.4,
    longitude: 78.4,
    altitude_ft: 1590,
    summer_db: 40, // 104°F
    summer_wb: 23, // 73°F
    summer_rh: 32,
    winter_db: 10, // 50°F
    winter_rh: 48,
    monsoon_db: 28, // 82°F
    monsoon_wb: 23, // 73°F
    monsoon_rh: 70,
    altitude_correction_factor: 0.94,
    is_code_zone: 'Hot Dry',
  },
  
  'pune': {
    city: 'Pune',
    state: 'Maharashtra',
    latitude: 18.5,
    longitude: 73.8,
    altitude_ft: 1863,
    summer_db: 37, // 99°F
    summer_wb: 22, // 72°F
    summer_rh: 32,
    winter_db: 8, // 46°F
    winter_rh: 45,
    monsoon_db: 25, // 77°F
    monsoon_wb: 21, // 70°F
    monsoon_rh: 72,
    altitude_correction_factor: 0.93,
    is_code_zone: 'Temperate',
  },
  
  'lucknow': {
    city: 'Lucknow',
    state: 'Uttar Pradesh',
    latitude: 26.8,
    longitude: 80.9,
    altitude_ft: 380,
    summer_db: 44, // 111°F
    summer_wb: 26, // 79°F
    summer_rh: 25,
    winter_db: 3, // 37°F
    winter_rh: 62,
    monsoon_db: 32, // 90°F
    monsoon_wb: 25, // 77°F
    monsoon_rh: 68,
    altitude_correction_factor: 0.98,
    is_code_zone: 'Hot Dry',
  },
};

// ============================================================================
// SECTION 2: IS 3720 SPACE TYPES (VENTILATION REQUIREMENTS)
// ============================================================================

export interface SpaceTypeIS3720 {
  spaceType: string;
  category: string;
  
  // Ventilation rate per IS 3720
  ach_min: number; // Minimum Air Changes per Hour
  ach_max: number; // Maximum ACH
  
  // Occupancy-based
  cfm_per_person?: number;
  cfm_per_sqft?: number;
  
  // IS Code specific notes
  notes: string;
}

export const SPACE_TYPES_IS3720: Record<string, SpaceTypeIS3720> = {
  // OFFICES
  'office-reception': {
    spaceType: 'Office Reception',
    category: 'Offices',
    ach_min: 3,
    ach_max: 6,
    cfm_per_person: 25,
    cfm_per_sqft: 0.15,
    notes: 'IS 3720: Class B office, public area',
  },
  'office-general': {
    spaceType: 'Office General',
    category: 'Offices',
    ach_min: 4,
    ach_max: 6,
    cfm_per_person: 20,
    cfm_per_sqft: 0.10,
    notes: 'IS 3720: Class B office, general work area',
  },
  'office-server-room': {
    spaceType: 'Server Room',
    category: 'Offices',
    ach_min: 10,
    ach_max: 15,
    cfm_per_sqft: 1.0,
    notes: 'IS 3720: Critical equipment, high cooling + ventilation',
  },
  
  // RETAIL
  'retail-shop': {
    spaceType: 'Retail Shop',
    category: 'Retail',
    ach_min: 4,
    ach_max: 8,
    cfm_per_sqft: 0.20,
    notes: 'IS 3720: Shopping area, public circulation',
  },
  'retail-supermarket': {
    spaceType: 'Supermarket',
    category: 'Retail',
    ach_min: 5,
    ach_max: 8,
    cfm_per_sqft: 0.25,
    notes: 'IS 3720: High occupancy, food storage',
  },
  
  // RESTAURANTS & FOOD
  'restaurant-dining': {
    spaceType: 'Restaurant Dining',
    category: 'Food Service',
    ach_min: 6,
    ach_max: 8,
    cfm_per_person: 30,
    cfm_per_sqft: 0.25,
    notes: 'IS 3720: Odor control, smoke management',
  },
  'restaurant-kitchen': {
    spaceType: 'Restaurant Kitchen',
    category: 'Food Service',
    ach_min: 10,
    ach_max: 15,
    cfm_per_sqft: 1.0,
    notes: 'IS 3720: Hood exhaust, makeup air, high heat',
  },
  
  // HOSPITALITY
  'hotel-lobby': {
    spaceType: 'Hotel Lobby',
    category: 'Hospitality',
    ach_min: 4,
    ach_max: 6,
    cfm_per_sqft: 0.15,
    notes: 'IS 3720: Public area, moderate occupancy',
  },
  'hotel-guest-room': {
    spaceType: 'Hotel Guest Room',
    category: 'Hospitality',
    ach_min: 3,
    ach_max: 5,
    cfm_per_person: 15,
    cfm_per_sqft: 0.10,
    notes: 'IS 3720: Individual room, low ventilation',
  },
  
  // HEALTHCARE
  'hospital-ward': {
    spaceType: 'Hospital Ward',
    category: 'Healthcare',
    ach_min: 6,
    ach_max: 8,
    cfm_per_sqft: 0.30,
    notes: 'IS 3720: Infection control, patient safety',
  },
  'hospital-icu': {
    spaceType: 'Hospital ICU',
    category: 'Healthcare',
    ach_min: 10,
    ach_max: 12,
    cfm_per_sqft: 0.50,
    notes: 'IS 3720: Critical care, high ventilation',
  },
  'hospital-operation-theatre': {
    spaceType: 'Operation Theatre',
    category: 'Healthcare',
    ach_min: 12,
    ach_max: 15,
    cfm_per_sqft: 0.70,
    notes: 'IS 3720: Sterile environment, air filtration (HEPA)',
  },
  
  // EDUCATION
  'school-classroom': {
    spaceType: 'School Classroom',
    category: 'Education',
    ach_min: 4,
    ach_max: 6,
    cfm_per_person: 20,
    cfm_per_sqft: 0.15,
    notes: 'IS 3720: Student occupancy, moderate ventilation',
  },
  'university-lecture': {
    spaceType: 'University Lecture Hall',
    category: 'Education',
    ach_min: 4,
    ach_max: 6,
    cfm_per_person: 20,
    cfm_per_sqft: 0.10,
    notes: 'IS 3720: Larger space, lower density',
  },
  
  // RESIDENTIAL
  'residential-living': {
    spaceType: 'Residential Living Area',
    category: 'Residential',
    ach_min: 2,
    ach_max: 4,
    cfm_per_sqft: 0.08,
    notes: 'IS 3720: Minimal ventilation, stack effect',
  },
  'residential-bedroom': {
    spaceType: 'Residential Bedroom',
    category: 'Residential',
    ach_min: 1,
    ach_max: 3,
    cfm_per_sqft: 0.05,
    notes: 'IS 3720: Low occupancy, minimal ventilation',
  },
};

// ============================================================================
// SECTION 3: IS CODE SAFETY & DESIGN FACTORS
// ============================================================================

export const IS_CODE_FACTORS = {
  // Sensible Load Safety Factor (IS 4257)
  sensibleSafetyPercent: 15, // Higher than ASHRAE 2017 (10%)
  
  // Latent Load Safety Factor (for humid regions)
  latentSafetyPercent: 20, // Higher for monsoon humidity (vs ASHRAE 5%)
  
  // Overall System Diversity Factor (IS 4257)
  diversityFactor: 0.85, // For multi-zone systems, not all zones peak together
  
  // Infiltration Safety (IS 4257, for heating calculations)
  infiltrationSafetyPercent: 15,
  
  // Pickup Factor (warm-up from night setback - IS 4257)
  // Monsoon: 20%, Winter: 25% (higher in cold climates)
  pickupFactorMonsoon: 20,
  pickupFactorWinter: 25,
  
  // Compressor Cycling Factor (for part-load efficiency)
  compressorCyclingFactor: 1.08, // 8% penalty for cycling losses
  
  // Equipment Derating by Altitude (per IS 4257)
  // Derate capacity ~3.5% per 1000 ft above sea level
  altitudeDerating: 0.035, // % per 1000 ft
};

// ============================================================================
// SECTION 4: IS CODE COMMISSIONING REQUIREMENTS (IS 7399)
// ============================================================================

export const IS_7399_COMMISSIONING_CHECKLIST = [
  // Pre-Commissioning
  {
    phase: 'Pre-Commissioning',
    item: 'System Design Documentation Review',
    description: 'Verify design per IS 12273, IS 3720, IS 4257',
    checkpoints: [
      'Design conditions per IS 12273',
      'Ventilation per IS 3720',
      'Equipment selections documented',
      'Safety factors applied per IS 4257',
    ],
  },
  {
    phase: 'Pre-Commissioning',
    item: 'Equipment Inspection',
    description: 'Verify equipment ratings, datasheets, nameplate data',
    checkpoints: [
      'Equipment capacity vs design load',
      'Refrigerant type and charge per IS 4257',
      'Filter sizes and types',
      'Ductwork insulation and sealing',
    ],
  },
  
  // Functional Testing
  {
    phase: 'Functional Testing',
    item: 'Airflow Verification',
    description: 'Measure supply, return, outdoor air rates',
    checkpoints: [
      'Supply CFM ± 10% of design',
      'Return CFM balanced',
      'Outdoor air verification per IS 3720',
      'Zone temperature control',
    ],
  },
  {
    phase: 'Functional Testing',
    item: 'Thermal Performance',
    description: 'Verify cooling/heating capacity under design conditions',
    checkpoints: [
      'Sensible cooling ± 10%',
      'Latent cooling (monsoon check)',
      'Heating capacity (winter)',
      'Delta-T checks',
    ],
  },
  {
    phase: 'Functional Testing',
    item: 'Humidity Control',
    description: 'Monsoon humidity control (IS 3720 compliance)',
    checkpoints: [
      'Indoor RH maintained <60% (monsoon)',
      'Coil bypass factor verified',
      'Dehumidification capacity check',
    ],
  },
  
  // Safety & Compliance
  {
    phase: 'Safety & Compliance',
    item: 'Refrigerant Charge & Safety',
    description: 'Per IS 4257 & CFC regulations',
    checkpoints: [
      'Charge per manufacturer specs ±5%',
      'Subcooling/Superheat verified',
      'No leaks detected (bubble test)',
      'Safety valve functionality',
    ],
  },
  {
    phase: 'Safety & Compliance',
    item: 'Filter & Air Quality',
    description: 'Filter pressure drop, cleanliness',
    checkpoints: [
      'Filter pressure drop <0.3" w.c.',
      'MERV 8+ minimum (commercial)',
      'Filter change intervals scheduled',
      'Outdoor air filtration adequate',
    ],
  },
  
  // Handover
  {
    phase: 'Handover',
    item: 'Documentation & Training',
    description: 'Per IS 7399 & 4257',
    checkpoints: [
      'As-built drawings (IS 7399 required)',
      'O&M manual with IS Code references',
      'Commissioning report per IS 7399',
      'Operator training completed',
    ],
  },
];

// ============================================================================
// SECTION 5: HUMIDEX COMFORT INDEX (FOR MONSOON)
// ============================================================================

/**
 * Humidex = Dry Bulb + 5/9 × (Saturation Vapor Pressure - Partial Vapor Pressure)
 * Used in IS 3720 for monsoon comfort assessment
 * 
 * Humidex > 40: Danger zone, active cooling needed
 * Humidex 30-40: Discomfort, enhanced ventilation
 * Humidex < 30: Comfortable
 */
export function calculateHumidex(drybulb_c: number, rh: number): number {
  // Saturation vapor pressure (hPa) per Magnus formula
  const satVP = 6.1094 * Math.exp((17.625 * drybulb_c) / (243.04 + drybulb_c));
  const partialVP = (rh / 100) * satVP;
  const humidex = drybulb_c + (5 / 9) * (partialVP - 10);
  return Math.round(humidex * 10) / 10;
}

// Example monsoon Humidex values
export const MONSOON_HUMIDEX = {
  delhi: calculateHumidex(32, 65), // ~38
  mumbai: calculateHumidex(28, 85), // ~35
  chennai: calculateHumidex(30, 78), // ~36
  kolkata: calculateHumidex(29, 82), // ~35
};

// ============================================================================
// SECTION 6: IS CODE COMPLIANCE FLAGS
// ============================================================================

export const IS_CODE_FLAGS = {
  // Regional considerations
  monsoonal_region: {
    cities: ['mumbai', 'kolkata', 'chennai', 'goa'],
    requirement: 'Enhanced dehumidification capacity (RH < 60% monsoon)',
  },
  
  hot_dry_region: {
    cities: ['delhi', 'jaipur', 'lucknow', 'hyderabad'],
    requirement: 'High sensible factor, lower latent focus',
  },
  
  high_altitude: {
    cities: ['bangalore', 'pune', 'hyderabad'],
    threshold_ft: 1000,
    requirement: 'Apply altitude derating to capacity',
  },
  
  // Seasonal requirements
  winter_heating: {
    cities: ['delhi', 'jaipur', 'lucknow', 'shimla'],
    requirement: 'Design heating load + 25% pickup factor',
  },
  
  comfort_index: {
    all_regions: 'Use Humidex for monsoon comfort assessment',
  },
};

// ============================================================================
// EXPORT SUMMARY
// ============================================================================

export const IS_CODE_SUMMARY = {
  standard: 'IS Code (India)',
  substandards: ['IS 12273', 'IS 3720', 'IS 4257', 'IS 7399'],
  effective_date: 'May 2026',
  regions_supported: Object.keys(INDIAN_CITIES).length,
  space_types: Object.keys(SPACE_TYPES_IS3720).length,
};
