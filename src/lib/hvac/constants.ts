/**
 * HVAC Constants and Interfaces
 * Shared types, interfaces, and constants used across all HVAC calculations
 */

export interface DesignConditions {
  outdoorTemp: number; // °F (Summer)
  indoorTemp: number; // °F
  outdoorHumidity: number; // % (Summer)
  indoorHumidity: number; // %
  winterOutdoorTemp?: number; // °F
  winterOutdoorHumidity?: number; // %
  winterIndoorTemp?: number; // °F
  winterIndoorHumidity?: number; // %
  altitude?: number; // ft
  latitude?: number;
  longitude?: number;
  designMonth?: number;
  designHour?: number;
  dailyRange?: number; // °F outdoor daily temperature range (for CLTD correction)
}

export interface WallType {
  id: string;
  name: string;
  uValue: number;
  description: string;
  /** Default SHGC for glass types (undefined for opaque elements) */
  defaultShgc?: number;
}

export const DEFAULT_WALL_TYPES: WallType[] = [
  // ─── Opaque Exterior Walls (U-Value per ASHRAE 90.1) ───────────────
  // ASHRAE Fundamentals 2017 - Table: Thermal Transmittance (U-Factor)
  
  // Brick/Masonry Walls
  { id: 'w1', name: 'Brick Wall (9")',        uValue: 0.35, description: 'Standard 9" brick wall with plaster' },
  { id: 'w2', name: 'Brick Wall (13.5")',     uValue: 0.25, description: 'Thick 13.5" brick wall' },
  { id: 'w3', name: 'Brick + R-5 Insulation', uValue: 0.12, description: '9" brick with R-5 rigid insulation' },
  { id: 'w9', name: 'Brick + R-10 Insulation', uValue: 0.08, description: '9" brick with R-10 rigid insulation' },
  { id: 'w10', name: 'Brick + R-15 Insulation', uValue: 0.06, description: '9" brick with R-15 rigid insulation' },
  
  // Concrete Walls
  { id: 'w4', name: 'Concrete Wall (6")',     uValue: 0.45, description: 'Standard 6" concrete wall' },
  { id: 'w11', name: 'Concrete Wall (8")',     uValue: 0.40, description: '8" concrete wall uninsulated' },
  { id: 'w12', name: 'Concrete + R-7 Insulation', uValue: 0.15, description: 'Concrete with R-7 insulation' },
  { id: 'w13', name: 'Concrete + R-15 Insulation', uValue: 0.08, description: 'Concrete with R-15 insulation' },
  
  // Stud Walls with Insulation (per ASHRAE 90.1-2019)
  { id: 'w5', name: 'Insulated Stud Wall (R-13)', uValue: 0.082, description: 'Timber stud with R-13 fiberglass' },
  { id: 'w14', name: 'Insulated Stud Wall (R-19)', uValue: 0.061, description: 'Timber stud with R-19 fiberglass' },
  { id: 'w15', name: 'Insulated Stud Wall (R-21)', uValue: 0.052, description: 'Timber stud with R-21 insulation' },
  { id: 'w16', name: 'Insulated Stud Wall (R-30)', uValue: 0.035, description: 'Timber stud with R-30 insulation' },
  
  // AAC & Lightweight Concrete
  { id: 'w6', name: 'AAC Block (8")',         uValue: 0.20, description: 'Autoclaved aerated concrete block' },
  { id: 'w17', name: 'AAC Block + R-5 Insulation', uValue: 0.11, description: 'AAC with R-5 rigid insulation' },
  { id: 'w18', name: 'Lightweight Concrete (4")', uValue: 0.35, description: 'Lightweight concrete block' },
  
  // Metal/Industrial Panels
  { id: 'w7', name: 'Metal Sandwich Panel (1")', uValue: 0.13, description: 'Insulated metal panel 1" polyurethane' },
  { id: 'w19', name: 'Metal Sandwich Panel (1.5")', uValue: 0.09, description: 'Insulated metal panel 1.5" polyurethane' },
  { id: 'w20', name: 'Metal Sandwich Panel (2")', uValue: 0.07, description: 'Insulated metal panel 2" polyurethane' },
  
  // Interior Walls/Partitions
  { id: 'w8', name: 'Drywall Partition',      uValue: 0.22, description: '5/8" drywall stud partition' },
  { id: 'w21', name: 'Double Drywall Partition', uValue: 0.18, description: 'Double 5/8" drywall stud partition' },
  { id: 'w22', name: 'Drywall + R-3.5 Insulation', uValue: 0.10, description: 'Drywall with cavity insulation' },
  
  // ─── Glass / Fenestration (per ASHRAE 2017) ────────────────────────
  // U-Value and SHGC values per NFRC ratings
  
  // Single Pane Glass
  { id: 'g1', name: 'Single Pane Clear',       uValue: 1.10, description: 'Standard clear single pane glass',          defaultShgc: 0.86 },
  { id: 'g7', name: 'Single Pane Reflective',  uValue: 1.05, description: 'Heat-reflecting single pane',                defaultShgc: 0.40 },
  
  // Double Pane (Standard Air)
  { id: 'g2', name: 'Double Pane (Air Gap)',   uValue: 0.50, description: 'Double pane with 1/2" air gap',             defaultShgc: 0.70 },
  { id: 'g8', name: 'Double Pane (Argon)',     uValue: 0.48, description: 'Double pane with argon fill',               defaultShgc: 0.68 },
  
  // Double Pane Low-E
  { id: 'g3', name: 'Double Pane Low-E (Soft)', uValue: 0.32, description: 'Double pane soft-coat Low-E',              defaultShgc: 0.42 },
  { id: 'g9', name: 'Double Pane Low-E (Hard)', uValue: 0.35, description: 'Double pane hard-coat Low-E',              defaultShgc: 0.38 },
  { id: 'g10', name: 'Double Pane Low-E (Argon)', uValue: 0.30, description: 'Double pane Low-E with argon',            defaultShgc: 0.40 },
  
  // Triple Pane
  { id: 'g4', name: 'Triple Pane Low-E',       uValue: 0.22, description: 'Triple pane with Low-E coating',            defaultShgc: 0.25 },
  { id: 'g11', name: 'Triple Pane Low-E (Argon)', uValue: 0.20, description: 'Triple pane Low-E with argon fill',      defaultShgc: 0.23 },
  
  // Tinted Glass
  { id: 'g5', name: 'Tinted Single Pane',      uValue: 0.95, description: 'Heat-absorbing tinted single pane',        defaultShgc: 0.45 },
  { id: 'g12', name: 'Tinted Double Pane',     uValue: 0.45, description: 'Tinted/reflective double pane',             defaultShgc: 0.40 },
  { id: 'g13', name: 'Tinted Double Low-E',    uValue: 0.32, description: 'Tinted double pane with Low-E',             defaultShgc: 0.28 },
  
  // Solar Control Glass
  { id: 'g6', name: 'Solar Control Low-E',     uValue: 0.28, description: 'Low-E with high solar control',             defaultShgc: 0.15 },
  { id: 'g14', name: 'Solar Control (Reflective)', uValue: 0.30, description: 'Highly reflective solar control',         defaultShgc: 0.12 },
  
  // ─── Roof Assemblies (per ASHRAE 90.1) ─────────────────────────────
  // Typical U-values for different roof constructions
  
  { id: 'r1', name: 'Metal Deck + R-20 Insulation', uValue: 0.08, description: 'Metal deck roof with R-20' },
  { id: 'r2', name: 'Metal Deck + R-30 Insulation', uValue: 0.05, description: 'Metal deck roof with R-30' },
  { id: 'r3', name: 'Built-up Roof + R-15', uValue: 0.10, description: 'Built-up roofing with R-15 insulation' },
  { id: 'r4', name: 'Concrete Deck + R-20', uValue: 0.08, description: 'Concrete deck with R-20 insulation' },
  
  // ─── Floors (per ASHRAE 90.1) ──────────────────────────────────────
  
  { id: 'f1', name: 'Concrete Slab-on-Grade', uValue: 0.40, description: 'Uninsulated concrete slab' },
  { id: 'f2', name: 'Concrete + R-10 Edge Insulation', uValue: 0.25, description: 'Concrete with perimeter insulation' },
  { id: 'f3', name: 'Wood Joist Floor + R-19', uValue: 0.06, description: 'Wood joist with R-19 insulation' },
  { id: 'f4', name: 'Concrete Deck + R-20', uValue: 0.08, description: 'Suspended concrete with R-20' },
];

export interface RoomDetails {
  id: string;
  name: string;
  floor: string;
  length: number;
  width: number;
  height: number;
  hasFalseCeiling?: boolean;
  falseCeilingHeight?: number;
  facph: number;
  peopleCount: number;
  activityType?: string;   // ASHRAE Table 18-2 activity category
  lightsWattsPerSqft: number;
  equipmentKW: number;
  othersKW: number;
}

export type WallColor = 'Dark' | 'Medium' | 'Light';

export interface EnvelopeElement {
  id: string;
  type: 'Wall' | 'Glass' | 'Partition' | 'Floor' | 'Roof';
  orientation: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'H';
  area: number;
  uValue: number;
  solarFactor: number;
  shgc?: number;
  wallTypeId?: string;
  description?: string;
  isOverride?: boolean;
  color?: WallColor; // surface color for CLTD color correction
}

export interface EnvelopeBreakdown {
  sensible: number;
  latent: number;
  breakdown: {
    walls: number;
    roof: number;
    glassTransmission: number;
    glassSolar: number;
    partitions: number;
    floor: number;
  };
}

export interface PsychrometricProperties {
  humidityRatio: number;
  enthalpy: number;
  saturationPressure: number;
}

export interface CoilParameters {
  rshf: number;
  indicatedADP: number;
  selectedADP: number;
  dehumidifiedCFM: number;
  bypassFactor: number;
}

export interface VentilationLoadResult {
  sensible: number;
  latent: number;
  cfm: number;
  outdoor: PsychrometricProperties;
  indoor: PsychrometricProperties;
  deltaT: number;
  deltaW: number;
}

export interface HeatingLoadResult {
  transmissionLoss: number;
  ventilationHeating: number;
  totalHeatingLoad: number;
  cfm: number;
}

export interface DuctSizingResult {
  diameter: number;
  velocity: number;
}

export interface PipeSizingResult {
  diameter: number;
}

export interface MoistureResult {
  rate: number;
  action: 'Humidify' | 'Dehumidify' | 'None';
  unit: string;
  loadBTU: number;
}

export interface ReheatResult {
  reheatBTU: number;
  currentSHR: number;
  targetSHR: number;
  needed: boolean;
}

export interface ParasiticGainsResult {
  ductGain: number;
  fanGain: number;
}

export interface SolarGainResult {
  conduction: number;
  radiation: number;
  total: number;
}

// ─── ASHRAE Table 18-2: People Heat Gain by Activity (at 75°F room temp) ──────
// Source: ASHRAE Fundamentals 2017, Chapter 18, Table 2
// sensible and latent in BTU/h per person
export const ACTIVITY_TYPES: { id: string; label: string; sensible: number; latent: number }[] = [
  // ─── Sedentary Activities ────────────────────────────────────────────
  { id: 'seated_rest',   label: 'Seated at Rest (Theatre, Lobby)',         sensible: 245, latent: 155 },
  { id: 'office',        label: 'Office / Seated Light Work',               sensible: 245, latent: 205 },
  { id: 'typing',        label: 'Typing / Data Entry',                      sensible: 245, latent: 195 },
  { id: 'study',         label: 'Study / Reading',                          sensible: 240, latent: 160 },
  { id: 'seated_drafting', label: 'Seated - Drafting/CAD',                 sensible: 250, latent: 200 },
  
  // ─── Standing/Light Activity ─────────────────────────────────────────
  { id: 'retail',        label: 'Retail / Bank (Standing, Light Work)',     sensible: 250, latent: 260 },
  { id: 'restaurant',    label: 'Restaurant / Cafeteria (Seated, Eating)',  sensible: 245, latent: 255 },
  { id: 'standing_office', label: 'Standing - Office/Reception',           sensible: 265, latent: 285 },
  { id: 'school',        label: 'School / Classroom',                       sensible: 245, latent: 195 },
  { id: 'laboratory',    label: 'Laboratory / Technical Work',              sensible: 270, latent: 230 },
  
  // ─── Service & Sales ─────────────────────────────────────────────────
  { id: 'hotel',         label: 'Hotel / Apartment (Resting)',              sensible: 230, latent: 200 },
  { id: 'hospital',      label: 'Hospital / Healthcare (Seated)',           sensible: 245, latent: 205 },
  { id: 'surgical_suite', label: 'Surgical Suite / Operating Room',        sensible: 260, latent: 240 },
  { id: 'hospital_staff', label: 'Hospital Staff (Standing)',              sensible: 290, latent: 310 },
  { id: 'kitchen_light', label: 'Kitchen / Food Service (Light)',           sensible: 280, latent: 320 },
  
  // ─── Moderate Activity ───────────────────────────────────────────────
  { id: 'factory_light', label: 'Factory – Light Bench Work',               sensible: 275, latent: 475 },
  { id: 'assembly',      label: 'Assembly Work',                            sensible: 290, latent: 420 },
  { id: 'walking',       label: 'Walking (3 mph)',                          sensible: 330, latent: 380 },
  { id: 'dancing',       label: 'Dancing / Aerobics (Light)',               sensible: 450, latent: 620 },
  { id: 'retail_stocking', label: 'Retail - Stocking Shelves',             sensible: 310, latent: 440 },
  
  // ─── Active Work ─────────────────────────────────────────────────────
  { id: 'factory_heavy', label: 'Factory – Heavy Work',                     sensible: 580, latent: 870 },
  { id: 'sports',        label: 'Sports / Recreation',                      sensible: 590, latent: 1030 },
  { id: 'gym',           label: 'Gymnasium / Athletics',                    sensible: 710, latent: 1270 },
  { id: 'heavy_work',    label: 'Heavy Manual Labor',                       sensible: 850, latent: 1450 },
  { id: 'kitchen_heavy', label: 'Kitchen / Food Service (Heavy)',           sensible: 440, latent: 760 },
];

export const ACTIVITY_ACH_RECOMMENDATIONS: { id: string; label: string; ach: number }[] = [
  // ─── Per ASHRAE 62.1 (Ventilation for Acceptable Indoor Air Quality) ─
  // Outdoor Air (OA) rates in CFM per person + CFM per sq ft
  
  // Low Occupancy / Sedentary
  { id: 'seated_rest',   label: 'Theatre / Lobby / Auditorium', ach: 4 },
  { id: 'study',         label: 'Library / Study Room', ach: 4 },
  { id: 'hotel',         label: 'Hotel / Apartment', ach: 4 },
  
  // Standard Office/School
  { id: 'office',        label: 'Office / Open Plan', ach: 6 },
  { id: 'school',        label: 'Classroom / School', ach: 6 },
  { id: 'typing',        label: 'Data Entry / Computer Work', ach: 6 },
  { id: 'seated_drafting', label: 'Drafting Room / CAD', ach: 6 },
  
  // Healthcare
  { id: 'hospital',      label: 'Hospital Room / General', ach: 6 },
  { id: 'surgical_suite', label: 'Operating Room / Surgical', ach: 20 },
  { id: 'hospital_staff', label: 'Hospital Staff Areas', ach: 8 },
  
  // Retail / Commercial
  { id: 'retail',        label: 'Retail / Shopping Center', ach: 6 },
  { id: 'laboratory',    label: 'Laboratory / Technical', ach: 8 },
  { id: 'standing_office', label: 'Bank / Reception Area', ach: 6 },
  
  // Food Service
  { id: 'restaurant',    label: 'Restaurant / Dining Area', ach: 10 },
  { id: 'kitchen_light', label: 'Kitchen / Food Prep (Light)', ach: 12 },
  { id: 'kitchen_heavy', label: 'Kitchen / Food Prep (Heavy)', ach: 15 },
  
  // Assembly/Active
  { id: 'assembly',      label: 'Assembly / Manufacturing', ach: 8 },
  { id: 'factory_light', label: 'Factory (Light Work)', ach: 8 },
  { id: 'factory_heavy', label: 'Factory (Heavy Work)', ach: 10 },
  { id: 'walking',       label: 'Corridor / Hallway', ach: 5 },
  
  // High Activity/Moisture
  { id: 'dancing',       label: 'Dance Studio / Aerobics', ach: 12 },
  { id: 'gym',           label: 'Gymnasium / Fitness', ach: 10 },
  { id: 'sports',        label: 'Sports / Recreation', ach: 12 },
  { id: 'retail_stocking', label: 'Warehouse / Storage', ach: 6 },
  { id: 'heavy_work',    label: 'Heavy Labor / Workshop', ach: 12 },
];

const DEFAULT_ACTIVITY_ACH = 6;

export const getRecommendedAch = (activityType?: string): number => {
  const preset = ACTIVITY_ACH_RECOMMENDATIONS.find((item) => item.id === activityType);
  return preset?.ach ?? DEFAULT_ACTIVITY_ACH;
};

// constants for ASHRAE calculations
export const ASHRAE_CONSTANTS = {
  // Conversion factors
  W_TO_BTU_H: 3.412,
  KW_TO_BTU_H: 3412,
  CFM_TO_VOLUME_CORRECTION: 60, // CFM = Volume (cu ft) × ACH / 60

  // Psychrometric constants
  GAS_CONSTANT_AIR: 53.35, // ft·lbf/(lbm·°R)
  STANDARD_AIR_DENSITY: 0.075, // lb/ft³ at 70°F, 50% RH
  MOISTURE_CONST: 4.5, // CFM × moisture correction

  // Coil parameters
  SENSIBLE_COOLING_CONSTANT: 1.08, // BTU/(h·ft³·°F)
  LATENT_COOLING_CONSTANT: 0.68, // BTU/(h·ft³·grain)
  LATENT_HEAT_VAPORIZATION: 1050, // BTU/lb at typical coil temps
  GRAINS_PER_LB: 7000,

  // ASHRAE standard assumptions
  PEOPLE_SENSIBLE_LOAD: 245, // BTU/h per person (office work)
  PEOPLE_LATENT_LOAD: 205, // BTU/h per person (office work)
  DEFAULT_BYPASS_FACTOR: 0.15,
};

// ASHRAE CLTD offsets for different orientations
export const CLTD_OFFSETS: Record<string, number> = {
  'N': 4,
  'NE': 10,
  'E': 18,
  'SE': 18,
  'S': 16,
  'SW': 14,
  'W': 12,
  'NW': 6,
  'H': 17,
};

// Solar Heat Gain Factors (ASHRAE Table 17.3)
export const SHGF_FACTORS: Record<string, number> = {
  'N': 26,
  'NE': 48,
  'E': 68,
  'SE': 58,
  'S': 42,
  'SW': 58,
  'W': 68,
  'NW': 48,
  'H': 82,
};

// ASHRAE CLTD Color Correction (relative to Dark baseline)
// Dark = 0, Medium = -3, Light = -6 (°F)
export const CLTD_COLOR_CORRECTION: Record<string, number> = {
  'Dark': 0,
  'Medium': -3,
  'Light': -6,
};

// ASHRAE CLTD Latitude-Month (LM) correction factors (°F)
// Source: ASHRAE Fundamentals 1997 Table 26.4
// Rows: orientation N/NE/E/SE/S/SW/W/NW
// Cols: months Jan–Dec
// Positive = add to CLTD, Negative = subtract
export const CLTD_LM: Record<string, number[]> = {
  //           Jan   Feb   Mar   Apr   May   Jun   Jul   Aug   Sep   Oct   Nov   Dec
  'N':  [  -2,  -2,  -1,   0,   1,   2,   2,   1,   0,  -1,  -2,  -2 ],
  'NE': [  -3,  -2,  -1,   0,   2,   3,   3,   2,   0,  -1,  -2,  -3 ],
  'E':  [  -3,  -2,  -1,   1,   2,   3,   3,   2,   1,  -1,  -2,  -3 ],
  'SE': [  -2,  -1,   0,   1,   2,   2,   2,   2,   1,   0,  -1,  -2 ],
  'S':  [   3,   2,   1,   0,  -1,  -2,  -2,  -1,   0,   1,   2,   3 ],
  'SW': [   2,   1,   0,  -1,  -2,  -2,  -2,  -1,   0,   1,   2,   2 ],
  'W':  [   2,   1,   0,  -1,  -2,  -3,  -3,  -2,  -1,   0,   1,   2 ],
  'NW': [   1,   1,   0,  -1,  -1,  -2,  -2,  -1,  -1,   0,   1,   1 ],
  'H':  [  -3,  -2,  -1,   0,   1,   2,   2,   1,   0,  -1,  -2,  -3 ],
};

// ASHRAE Clear Sky Model coefficients (monthly)
export const SOLAR_INTENSITY_COEFFICIENTS = {
  A: [390, 385, 376, 360, 350, 345, 344, 351, 365, 378, 387, 391],
  B: [0.14, 0.14, 0.15, 0.17, 0.18, 0.19, 0.19, 0.18, 0.17, 0.15, 0.14, 0.14],
  C: [0.06, 0.06, 0.07, 0.09, 0.11, 0.13, 0.13, 0.12, 0.10, 0.08, 0.06, 0.06],
};

// Validation constants
export const VALIDATION_RULES = {
  TEMP_MIN: -60,
  TEMP_MAX: 130,
  HUMIDITY_MIN: 0,
  HUMIDITY_MAX: 100,
  DIMENSION_MIN: 1,
  DIMENSION_MAX: 1000,
  ACH_MIN: 0,
  ACH_MAX: 50,
  U_VALUE_MIN: 0.01,
  U_VALUE_MAX: 2.0,
};
