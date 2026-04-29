/**
 * Electrical Cable & MCB/MCCB Sizing Constants
 * Based on:
 * - NEC (National Electrical Code) Chapter 3
 * - BS 7909 (Temporary Electrical Systems)
 * - IEC 60364 (Electrical Installations)
 * - Cable manufacturer data sheets
 */

export interface CableSize {
  id: string;
  awg: number;
  metric: number; // mm²
  diameter: number; // mm
  description: string;
}

export interface AmpacityRating {
  cableId: string;
  temperature: number; // °C (typically 60, 75, or 90)
  insulation: string; // PVC, XLPE, etc.
  installationMethod: string; // In conduit, In air, Direct burial, etc.
  ampacity: number; // Maximum safe current in Amps
}

export interface MCBRating {
  id: string;
  capacity: number; // Amps (10, 16, 20, 25, 32, 40, 50, 63, 80, 100, etc.)
  type: string; // Type B, C, D (trip characteristics)
  voltage: number; // 230V, 400V, etc.
  poles: number; // 1P, 2P, 3P
  description: string;
}

export interface CableSizingResult {
  selectedCable: CableSize;
  selectedAmpacity: AmpacityRating;
  selectedMCB: MCBRating;
  voltageDrop: number; // %
  safetyMargin: number; // %
  isCompliant: boolean;
  warnings: string[];
  notes: string[];
  inrushCurrent?: number; // A
  startingMethod?: string;
  applicationType?: string;
}

export type ApplicationType = 'motor' | 'heater' | 'chiller' | 'pump' | 'lighting' | 'general' | 'other';

export interface ApplicationProfile {
  type: ApplicationType;
  label: string;
  inrushMultiplier: number; // Peak inrush current relative to rated
  inrushDuration: number; // milliseconds
  startingMethod: string; // DOL, Star-Delta, VFD, Soft-Starter
  recommendedProtection: string;
  derating: number; // Additional derating factor 0-1
  minCableLength: number; // minimum recommended length in meters
  description: string;
}

// Standard Cable Sizes (AWG to Metric Conversion)
export const CABLE_SIZES: CableSize[] = [
  // 14 AWG = 2.0 mm²
  { id: "14awg", awg: 14, metric: 2.0, diameter: 1.63, description: "14 AWG (2.0 mm²)" },
  // 12 AWG = 3.5 mm²
  { id: "12awg", awg: 12, metric: 3.5, diameter: 2.05, description: "12 AWG (3.5 mm²)" },
  // 10 AWG = 5.5 mm²
  { id: "10awg", awg: 10, metric: 5.5, diameter: 2.59, description: "10 AWG (5.5 mm²)" },
  // 8 AWG = 8.4 mm²
  { id: "8awg", awg: 8, metric: 8.4, diameter: 3.26, description: "8 AWG (8.4 mm²)" },
  // 6 AWG = 13.3 mm²
  { id: "6awg", awg: 6, metric: 13.3, diameter: 4.11, description: "6 AWG (13.3 mm²)" },
  // 4 AWG = 21.2 mm²
  { id: "4awg", awg: 4, metric: 21.2, diameter: 5.19, description: "4 AWG (21.2 mm²)" },
  // 2 AWG = 33.6 mm²
  { id: "2awg", awg: 2, metric: 33.6, diameter: 6.54, description: "2 AWG (33.6 mm²)" },
  // 1 AWG = 42.4 mm²
  { id: "1awg", awg: 1, metric: 42.4, diameter: 7.35, description: "1 AWG (42.4 mm²)" },
  // 1/0 AWG = 53.5 mm²
  { id: "1_0awg", awg: 0, metric: 53.5, diameter: 8.25, description: "1/0 AWG (53.5 mm²)" },
  // 2/0 AWG = 67.4 mm²
  { id: "2_0awg", awg: -1, metric: 67.4, diameter: 9.27, description: "2/0 AWG (67.4 mm²)" },
  // 3/0 AWG = 85.0 mm²
  { id: "3_0awg", awg: -2, metric: 85.0, diameter: 10.41, description: "3/0 AWG (85.0 mm²)" },
  // 4/0 AWG = 107.2 mm²
  { id: "4_0awg", awg: -3, metric: 107.2, diameter: 11.68, description: "4/0 AWG (107.2 mm²)" },

  // Metric sizes for IEC countries
  { id: "1mm2", awg: null as any, metric: 1.0, diameter: 1.13, description: "1.0 mm² (IEC)" },
  { id: "1.5mm2", awg: null as any, metric: 1.5, diameter: 1.38, description: "1.5 mm² (IEC)" },
  { id: "2.5mm2", awg: null as any, metric: 2.5, diameter: 1.78, description: "2.5 mm² (IEC)" },
  { id: "4mm2", awg: null as any, metric: 4.0, diameter: 2.26, description: "4.0 mm² (IEC)" },
  { id: "6mm2", awg: null as any, metric: 6.0, diameter: 2.76, description: "6.0 mm² (IEC)" },
  { id: "10mm2", awg: null as any, metric: 10.0, diameter: 3.57, description: "10.0 mm² (IEC)" },
  { id: "16mm2", awg: null as any, metric: 16.0, diameter: 4.51, description: "16.0 mm² (IEC)" },
  { id: "25mm2", awg: null as any, metric: 25.0, diameter: 5.64, description: "25.0 mm² (IEC)" },
  { id: "35mm2", awg: null as any, metric: 35.0, diameter: 6.68, description: "35.0 mm² (IEC)" },
  { id: "50mm2", awg: null as any, metric: 50.0, diameter: 7.98, description: "50.0 mm² (IEC)" },
  { id: "70mm2", awg: null as any, metric: 70.0, diameter: 9.44, description: "70.0 mm² (IEC)" },
  { id: "95mm2", awg: null as any, metric: 95.0, diameter: 11.00, description: "95.0 mm² (IEC)" },
  { id: "120mm2", awg: null as any, metric: 120.0, diameter: 12.38, description: "120 mm² (IEC)" },
  { id: "150mm2", awg: null as any, metric: 150.0, diameter: 13.82, description: "150 mm² (IEC)" },
];

// Wire Ampacity Table (60°C insulation, copper, in air)
// Source: NEC Table 310.15(B)(1)(1) - Allowable Ampacities
// Rated at 30°C ambient temperature
export const AMPACITY_TABLE: AmpacityRating[] = [
  // 14 AWG
  { cableId: "14awg", temperature: 60, insulation: "PVC (60°C)", installationMethod: "In conduit (3+ wires)", ampacity: 15 },
  { cableId: "14awg", temperature: 75, insulation: "XHHW (75°C)", installationMethod: "In conduit (3+ wires)", ampacity: 20 },
  { cableId: "14awg", temperature: 90, insulation: "XHHW-2 (90°C)", installationMethod: "In conduit (3+ wires)", ampacity: 25 },

  // 12 AWG
  { cableId: "12awg", temperature: 60, insulation: "PVC (60°C)", installationMethod: "In conduit (3+ wires)", ampacity: 20 },
  { cableId: "12awg", temperature: 75, insulation: "XHHW (75°C)", installationMethod: "In conduit (3+ wires)", ampacity: 25 },
  { cableId: "12awg", temperature: 90, insulation: "XHHW-2 (90°C)", installationMethod: "In conduit (3+ wires)", ampacity: 30 },

  // 10 AWG
  { cableId: "10awg", temperature: 60, insulation: "PVC (60°C)", installationMethod: "In conduit (3+ wires)", ampacity: 30 },
  { cableId: "10awg", temperature: 75, insulation: "XHHW (75°C)", installationMethod: "In conduit (3+ wires)", ampacity: 35 },
  { cableId: "10awg", temperature: 90, insulation: "XHHW-2 (90°C)", installationMethod: "In conduit (3+ wires)", ampacity: 40 },

  // 8 AWG
  { cableId: "8awg", temperature: 60, insulation: "PVC (60°C)", installationMethod: "In conduit (3+ wires)", ampacity: 40 },
  { cableId: "8awg", temperature: 75, insulation: "XHHW (75°C)", installationMethod: "In conduit (3+ wires)", ampacity: 50 },
  { cableId: "8awg", temperature: 90, insulation: "XHHW-2 (90°C)", installationMethod: "In conduit (3+ wires)", ampacity: 55 },

  // 6 AWG
  { cableId: "6awg", temperature: 60, insulation: "PVC (60°C)", installationMethod: "In conduit (3+ wires)", ampacity: 55 },
  { cableId: "6awg", temperature: 75, insulation: "XHHW (75°C)", installationMethod: "In conduit (3+ wires)", ampacity: 65 },
  { cableId: "6awg", temperature: 90, insulation: "XHHW-2 (90°C)", installationMethod: "In conduit (3+ wires)", ampacity: 75 },

  // 4 AWG
  { cableId: "4awg", temperature: 60, insulation: "PVC (60°C)", installationMethod: "In conduit (3+ wires)", ampacity: 70 },
  { cableId: "4awg", temperature: 75, insulation: "XHHW (75°C)", installationMethod: "In conduit (3+ wires)", ampacity: 85 },
  { cableId: "4awg", temperature: 90, insulation: "XHHW-2 (90°C)", installationMethod: "In conduit (3+ wires)", ampacity: 95 },

  // 2 AWG
  { cableId: "2awg", temperature: 60, insulation: "PVC (60°C)", installationMethod: "In conduit (3+ wires)", ampacity: 95 },
  { cableId: "2awg", temperature: 75, insulation: "XHHW (75°C)", installationMethod: "In conduit (3+ wires)", ampacity: 115 },
  { cableId: "2awg", temperature: 90, insulation: "XHHW-2 (90°C)", installationMethod: "In conduit (3+ wires)", ampacity: 130 },

  // 1 AWG
  { cableId: "1awg", temperature: 60, insulation: "PVC (60°C)", installationMethod: "In conduit (3+ wires)", ampacity: 110 },
  { cableId: "1awg", temperature: 75, insulation: "XHHW (75°C)", installationMethod: "In conduit (3+ wires)", ampacity: 130 },
  { cableId: "1awg", temperature: 90, insulation: "XHHW-2 (90°C)", installationMethod: "In conduit (3+ wires)", ampacity: 150 },

  // 1/0 AWG
  { cableId: "1_0awg", temperature: 60, insulation: "PVC (60°C)", installationMethod: "In conduit (3+ wires)", ampacity: 125 },
  { cableId: "1_0awg", temperature: 75, insulation: "XHHW (75°C)", installationMethod: "In conduit (3+ wires)", ampacity: 150 },
  { cableId: "1_0awg", temperature: 90, insulation: "XHHW-2 (90°C)", installationMethod: "In conduit (3+ wires)", ampacity: 170 },

  // 2/0 AWG
  { cableId: "2_0awg", temperature: 60, insulation: "PVC (60°C)", installationMethod: "In conduit (3+ wires)", ampacity: 145 },
  { cableId: "2_0awg", temperature: 75, insulation: "XHHW (75°C)", installationMethod: "In conduit (3+ wires)", ampacity: 175 },
  { cableId: "2_0awg", temperature: 90, insulation: "XHHW-2 (90°C)", installationMethod: "In conduit (3+ wires)", ampacity: 195 },

  // 3/0 AWG
  { cableId: "3_0awg", temperature: 60, insulation: "PVC (60°C)", installationMethod: "In conduit (3+ wires)", ampacity: 165 },
  { cableId: "3_0awg", temperature: 75, insulation: "XHHW (75°C)", installationMethod: "In conduit (3+ wires)", ampacity: 200 },
  { cableId: "3_0awg", temperature: 90, insulation: "XHHW-2 (90°C)", installationMethod: "In conduit (3+ wires)", ampacity: 225 },

  // 4/0 AWG
  { cableId: "4_0awg", temperature: 60, insulation: "PVC (60°C)", installationMethod: "In conduit (3+ wires)", ampacity: 195 },
  { cableId: "4_0awg", temperature: 75, insulation: "XHHW (75°C)", installationMethod: "In conduit (3+ wires)", ampacity: 230 },
  { cableId: "4_0awg", temperature: 90, insulation: "XHHW-2 (90°C)", installationMethod: "In conduit (3+ wires)", ampacity: 260 },

  // IEC Metric Sizes (based on BS 7909 and IEC 60364)
  { cableId: "1mm2", temperature: 70, insulation: "PVC (70°C)", installationMethod: "In conduit", ampacity: 11 },
  { cableId: "1.5mm2", temperature: 70, insulation: "PVC (70°C)", installationMethod: "In conduit", ampacity: 15 },
  { cableId: "2.5mm2", temperature: 70, insulation: "PVC (70°C)", installationMethod: "In conduit", ampacity: 21 },
  { cableId: "4mm2", temperature: 70, insulation: "PVC (70°C)", installationMethod: "In conduit", ampacity: 28 },
  { cableId: "6mm2", temperature: 70, insulation: "PVC (70°C)", installationMethod: "In conduit", ampacity: 36 },
  { cableId: "10mm2", temperature: 70, insulation: "PVC (70°C)", installationMethod: "In conduit", ampacity: 48 },
  { cableId: "16mm2", temperature: 70, insulation: "PVC (70°C)", installationMethod: "In conduit", ampacity: 63 },
  { cableId: "25mm2", temperature: 70, insulation: "PVC (70°C)", installationMethod: "In conduit", ampacity: 85 },
  { cableId: "35mm2", temperature: 70, insulation: "PVC (70°C)", installationMethod: "In conduit", ampacity: 108 },
  { cableId: "50mm2", temperature: 70, insulation: "PVC (70°C)", installationMethod: "In conduit", ampacity: 132 },
  { cableId: "70mm2", temperature: 70, insulation: "PVC (70°C)", installationMethod: "In conduit", ampacity: 170 },
  { cableId: "95mm2", temperature: 70, insulation: "PVC (70°C)", installationMethod: "In conduit", ampacity: 210 },
];

// Standard MCB/MCCB Ratings (IEC 60898 / NEC)
export const MCB_RATINGS: MCBRating[] = [
  // Type B (3-5A×In trip curve) - for general circuits
  { id: "b10", capacity: 10, type: "Type B", voltage: 230, poles: 1, description: "10A Type B (1P, 230V)" },
  { id: "b16", capacity: 16, type: "Type B", voltage: 230, poles: 1, description: "16A Type B (1P, 230V)" },
  { id: "b20", capacity: 20, type: "Type B", voltage: 230, poles: 1, description: "20A Type B (1P, 230V)" },
  { id: "b25", capacity: 25, type: "Type B", voltage: 230, poles: 1, description: "25A Type B (1P, 230V)" },
  { id: "b32", capacity: 32, type: "Type B", voltage: 230, poles: 1, description: "32A Type B (1P, 230V)" },

  // Type C (5-10A×In trip curve) - for mixed loads
  { id: "c10", capacity: 10, type: "Type C", voltage: 230, poles: 1, description: "10A Type C (1P, 230V)" },
  { id: "c16", capacity: 16, type: "Type C", voltage: 230, poles: 1, description: "16A Type C (1P, 230V)" },
  { id: "c20", capacity: 20, type: "Type C", voltage: 230, poles: 1, description: "20A Type C (1P, 230V)" },
  { id: "c25", capacity: 25, type: "Type C", voltage: 230, poles: 1, description: "25A Type C (1P, 230V)" },
  { id: "c32", capacity: 32, type: "Type C", voltage: 230, poles: 1, description: "32A Type C (1P, 230V)" },
  { id: "c40", capacity: 40, type: "Type C", voltage: 230, poles: 1, description: "40A Type C (1P, 230V)" },
  { id: "c50", capacity: 50, type: "Type C", voltage: 230, poles: 1, description: "50A Type C (1P, 230V)" },
  { id: "c63", capacity: 63, type: "Type C", voltage: 230, poles: 1, description: "63A Type C (1P, 230V)" },
  { id: "c80", capacity: 80, type: "Type C", voltage: 230, poles: 1, description: "80A Type C (1P, 230V)" },
  { id: "c100", capacity: 100, type: "Type C", voltage: 230, poles: 1, description: "100A Type C (1P, 230V)" },

  // Type D (10-20A×In trip curve) - for inductive/motor loads
  { id: "d16", capacity: 16, type: "Type D", voltage: 230, poles: 1, description: "16A Type D (1P, 230V)" },
  { id: "d20", capacity: 20, type: "Type D", voltage: 230, poles: 1, description: "20A Type D (1P, 230V)" },
  { id: "d25", capacity: 25, type: "Type D", voltage: 230, poles: 1, description: "25A Type D (1P, 230V)" },
  { id: "d32", capacity: 32, type: "Type D", voltage: 230, poles: 1, description: "32A Type D (1P, 230V)" },
  { id: "d40", capacity: 40, type: "Type D", voltage: 230, poles: 1, description: "40A Type D (1P, 230V)" },
  { id: "d50", capacity: 50, type: "Type D", voltage: 230, poles: 1, description: "50A Type D (1P, 230V)" },
  { id: "d63", capacity: 63, type: "Type D", voltage: 230, poles: 1, description: "63A Type D (1P, 230V)" },

  // Three-phase MCBs (400V)
  { id: "3p_c20", capacity: 20, type: "Type C", voltage: 400, poles: 3, description: "20A Type C (3P, 400V)" },
  { id: "3p_c25", capacity: 25, type: "Type C", voltage: 400, poles: 3, description: "25A Type C (3P, 400V)" },
  { id: "3p_c32", capacity: 32, type: "Type C", voltage: 400, poles: 3, description: "32A Type C (3P, 400V)" },
  { id: "3p_c40", capacity: 40, type: "Type C", voltage: 400, poles: 3, description: "40A Type C (3P, 400V)" },
  { id: "3p_c50", capacity: 50, type: "Type C", voltage: 400, poles: 3, description: "50A Type C (3P, 400V)" },
  { id: "3p_c63", capacity: 63, type: "Type C", voltage: 400, poles: 3, description: "63A Type C (3P, 400V)" },
  { id: "3p_c80", capacity: 80, type: "Type C", voltage: 400, poles: 3, description: "80A Type C (3P, 400V)" },
  { id: "3p_c100", capacity: 100, type: "Type C", voltage: 400, poles: 3, description: "100A Type C (3P, 400V)" },
  { id: "3p_c125", capacity: 125, type: "Type C", voltage: 400, poles: 3, description: "125A Type C (3P, 400V)" },
  { id: "3p_c160", capacity: 160, type: "Type C", voltage: 400, poles: 3, description: "160A Type C (3P, 400V)" },
];

// Electrical constants for calculations
export const ELECTRICAL_CONSTANTS = {
  // Resistivity at 20°C
  COPPER_RESISTIVITY: 0.01724, // Ω·mm²/m
  ALUMINUM_RESISTIVITY: 0.02828, // Ω·mm²/m

  // Temperature coefficient
  TEMP_COEFFICIENT_COPPER: 0.00393, // per °C
  TEMP_COEFFICIENT_ALUMINUM: 0.00403, // per °C

  // Standard voltage drops
  ACCEPTABLE_VOLTAGE_DROP: 3.0, // % (general circuits)
  MAX_VOLTAGE_DROP_FEEDER: 3.0, // %
  MAX_VOLTAGE_DROP_BRANCH: 2.0, // %

  // Safety factors
  SAFETY_FACTOR_CABLE: 1.25, // 25% safety margin
  SAFETY_FACTOR_MCB: 1.0, // MCB rated exactly at circuit load
};

export const CABLE_STANDARDS = {
  NEC: "NEC (National Electrical Code) USA",
  IEC: "IEC 60364 (International Electrotechnical Commission)",
  BS: "BS 7909 (UK Temporary Systems)",
};

/**
 * Application-specific profiles with inrush current factors
 * Based on IEEE, IEC, and HVAC industry standards
 */
export const APPLICATION_PROFILES: Record<ApplicationType, ApplicationProfile> = {
  motor: {
    type: 'motor',
    label: 'Electric Motor (3-Phase AC)',
    inrushMultiplier: 6.5, // 5-8x: DOL inrush typical
    inrushDuration: 200, // milliseconds
    startingMethod: 'DOL (Direct-On-Line)',
    recommendedProtection: 'Type D MCB (10-20×In) or Motor Contactor + Overload',
    derating: 0.85, // Motors need 15% safety margin from breaker
    minCableLength: 5,
    description: 'Three-phase AC induction motors (compressors, fans, pumps). High inrush current requires oversized cable and protective devices.',
  },
  chiller: {
    type: 'chiller',
    label: 'Chiller Unit (Compressor + Fan Motors)',
    inrushMultiplier: 5.5, // Compressor inrush dominates
    inrushDuration: 300, // milliseconds - longer due to multiple motors
    startingMethod: 'Star-Delta or Soft-Starter',
    recommendedProtection: 'Type D MCB (15×In) or Electronic Overload',
    derating: 0.80, // Extra 20% margin for coordinated motor startup
    minCableLength: 10,
    description: 'Refrigeration chillers with compressor, fan, and pump motors. Simultaneous motor inrush requires larger cables and coordinated starting.',
  },
  pump: {
    type: 'pump',
    label: 'Centrifugal Pump / Fan (Soft-Starter)',
    inrushMultiplier: 3.0, // Soft-starter reduces to 3×
    inrushDuration: 50, // milliseconds
    startingMethod: 'Soft-Starter (Recommended)',
    recommendedProtection: 'Type C MCB (5-10×In) or Electronic Overload',
    derating: 0.90, // Less aggressive - soft-start mitigates inrush
    minCableLength: 15,
    description: 'Centrifugal pumps and AHU fans. Soft-starters dramatically reduce inrush (1-3s ramp). Standard for HVAC systems.',
  },
  heater: {
    type: 'heater',
    label: 'Electric Heater / Resistance Load',
    inrushMultiplier: 1.2, // Minimal inrush - pure resistance
    inrushDuration: 10, // milliseconds
    startingMethod: 'Direct (No Starter)',
    recommendedProtection: 'Type B MCB (3-5×In) or Thermal Overload',
    derating: 0.95, // Very safe - predictable load
    minCableLength: 0,
    description: 'Electric heating elements, immersion heaters, electric reheat. Purely resistive - no inrush transients.',
  },
  lighting: {
    type: 'lighting',
    label: 'Lighting Load (LED / Ballasts)',
    inrushMultiplier: 1.8, // LED drivers, ballasts have minor inrush
    inrushDuration: 20, // milliseconds
    startingMethod: 'Direct',
    recommendedProtection: 'Type B or C MCB (3-10×In)',
    derating: 0.92, // Minor inrush from electronic ballasts
    minCableLength: 0,
    description: 'Lighting circuits with LED drivers or electronic ballasts. Low and predictable inrush.',
  },
  general: {
    type: 'general',
    label: 'General Purpose (Mixed Load)',
    inrushMultiplier: 2.5, // Average for mixed resistive + inductive
    inrushDuration: 100, // milliseconds
    startingMethod: 'Direct',
    recommendedProtection: 'Type C MCB (5-10×In)',
    derating: 0.88, // Standard safety margin
    minCableLength: 0,
    description: 'General circuits with heaters, terminal units, AHU controls. Moderate inrush from control relays and contactors.',
  },
  other: {
    type: 'other',
    label: 'Other (Manual Input Required)',
    inrushMultiplier: 1.5, // Conservative default
    inrushDuration: 100,
    startingMethod: 'TBD',
    recommendedProtection: 'Type C MCB',
    derating: 0.90,
    minCableLength: 0,
    description: 'Custom applications. Specify inrush characteristics manually.',
  },
};
