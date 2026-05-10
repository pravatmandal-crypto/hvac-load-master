// Static reference data for U Builder — materials from ASHRAE Fundamentals Ch.26,
// soils from ISO 13370, and pre-built ASHRAE 90.1 standard assemblies.

export interface UMaterial {
  id: string;
  name: string;
  category: string;
  lambda: number; // W/mK — thermal conductivity
  density?: number; // kg/m³
  source: string;
}

export interface SoilType {
  id: string;
  name: string;
  lambda: number; // W/mK
  density: number; // kg/m³
  moisture: string;
}

export interface AssemblyLayer {
  materialId: string;
  materialName: string;
  thickness: number; // mm
  lambda: number; // W/mK
  r: number; // m²K/W (computed)
}

export interface GroundParams {
  soilId: string;
  soilName: string;
  soilLambda: number;
  depthTop: number; // m — depth of top of wall below ground
  depthBottom: number; // m — depth of bottom of wall below ground
  slopeAngle: number; // degrees — 0 = vertical backfill face
}

export type WallCategory = 'above_ground' | 'below_ground' | 'roof' | 'floor';
export type AssemblyType = 'standard' | 'custom';
export type CalcMethod = 'ISO_6946' | 'ISO_13370';

export const WALL_CATEGORY_LABELS: Record<WallCategory, string> = {
  above_ground: 'Above Ground Wall',
  below_ground: 'Below Ground Wall',
  roof: 'Roof',
  floor: 'Floor',
};

export interface UAssembly {
  id: string;
  name: string;
  type: AssemblyType;
  wallCategory: WallCategory;
  uValue: number; // W/m²K — pre-calculated
  method: CalcMethod;
  ashraeReference?: string;
  climateZone?: string;
  description?: string;
  layers: AssemblyLayer[];
  groundParams?: GroundParams;
}

// ─── Surface Resistances (ISO 6946) ──────────────────────────────────────────
export const SURFACE_RESISTANCES = {
  wall:  { rsi: 0.13, rse: 0.04 }, // horizontal heat flow
  roof:  { rsi: 0.10, rse: 0.04 }, // upward heat flow
  floor: { rsi: 0.17, rse: 0.04 }, // downward heat flow (ground floor)
} as const;

// ─── Materials Library ────────────────────────────────────────────────────────
// Source: ASHRAE Handbook of Fundamentals 2021, Chapter 26
export const MATERIALS: UMaterial[] = [
  // Masonry
  { id: 'm-001', name: 'Brick — Common', category: 'Masonry', lambda: 0.72, density: 1920, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-002', name: 'Brick — Facing', category: 'Masonry', lambda: 0.89, density: 2000, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-003', name: 'Brick — Hollow', category: 'Masonry', lambda: 0.52, density: 1300, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-004', name: 'Concrete Block — Normal Weight 100mm', category: 'Masonry', lambda: 0.58, density: 1800, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-005', name: 'Concrete Block — Normal Weight 200mm', category: 'Masonry', lambda: 0.67, density: 1800, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-006', name: 'Concrete Block — Lightweight 100mm', category: 'Masonry', lambda: 0.19, density: 800, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-007', name: 'Concrete Block — Lightweight 200mm', category: 'Masonry', lambda: 0.22, density: 800, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-008', name: 'Stone — Granite', category: 'Masonry', lambda: 2.90, density: 2700, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-009', name: 'Stone — Limestone', category: 'Masonry', lambda: 1.50, density: 2500, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-010', name: 'Stone — Sandstone', category: 'Masonry', lambda: 1.83, density: 2200, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-011', name: 'Slate', category: 'Masonry', lambda: 2.00, density: 2800, source: 'ASHRAE HoF Ch.26' },

  // Concrete
  { id: 'm-020', name: 'Concrete — Dense (2400 kg/m³)', category: 'Concrete', lambda: 1.73, density: 2400, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-021', name: 'Concrete — Medium (1800 kg/m³)', category: 'Concrete', lambda: 0.84, density: 1800, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-022', name: 'Concrete — Lightweight (1200 kg/m³)', category: 'Concrete', lambda: 0.38, density: 1200, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-023', name: 'AAC — Autoclaved Aerated (600 kg/m³)', category: 'Concrete', lambda: 0.17, density: 600, source: 'EN 1745 / ASHRAE' },
  { id: 'm-024', name: 'AAC — Autoclaved Aerated (400 kg/m³)', category: 'Concrete', lambda: 0.12, density: 400, source: 'EN 1745 / ASHRAE' },
  { id: 'm-025', name: 'Reinforced Concrete', category: 'Concrete', lambda: 2.00, density: 2500, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-026', name: 'Screed — Cement Sand', category: 'Concrete', lambda: 0.72, density: 2000, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-027', name: 'Screed — Anhydrite', category: 'Concrete', lambda: 1.80, density: 2100, source: 'EN ISO 10456' },

  // Insulation — Batt / Blanket
  { id: 'm-030', name: 'Mineral Wool — Glass Wool Batt', category: 'Insulation — Batt', lambda: 0.038, density: 16, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-031', name: 'Mineral Wool — Stone Wool (Rockwool)', category: 'Insulation — Batt', lambda: 0.036, density: 30, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-032', name: 'Cellulose — Loose Fill', category: 'Insulation — Batt', lambda: 0.040, density: 56, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-033', name: 'Mineral Wool — High Density (Cavity)', category: 'Insulation — Batt', lambda: 0.034, density: 80, source: 'ASHRAE HoF Ch.26' },

  // Insulation — Rigid
  { id: 'm-040', name: 'EPS — Expanded Polystyrene', category: 'Insulation — Rigid', lambda: 0.036, density: 20, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-041', name: 'XPS — Extruded Polystyrene', category: 'Insulation — Rigid', lambda: 0.029, density: 35, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-042', name: 'PUR/PIR — Polyurethane Foam', category: 'Insulation — Rigid', lambda: 0.023, density: 32, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-043', name: 'Phenolic Foam Board', category: 'Insulation — Rigid', lambda: 0.020, density: 40, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-044', name: 'Cellular Glass', category: 'Insulation — Rigid', lambda: 0.042, density: 120, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-045', name: 'Perlite Board', category: 'Insulation — Rigid', lambda: 0.045, density: 200, source: 'ASHRAE HoF Ch.26' },

  // Timber & Wood
  { id: 'm-050', name: 'Timber — Softwood (Pine/Fir)', category: 'Timber', lambda: 0.13, density: 500, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-051', name: 'Timber — Hardwood (Oak)', category: 'Timber', lambda: 0.18, density: 700, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-052', name: 'Plywood', category: 'Timber', lambda: 0.13, density: 540, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-053', name: 'OSB — Oriented Strand Board', category: 'Timber', lambda: 0.13, density: 650, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-054', name: 'MDF — Medium Density Fibreboard', category: 'Timber', lambda: 0.12, density: 750, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-055', name: 'Chipboard / Particleboard', category: 'Timber', lambda: 0.12, density: 650, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-056', name: 'Hardwood Floor Board', category: 'Timber', lambda: 0.16, density: 700, source: 'ASHRAE HoF Ch.26' },

  // Plaster & Render
  { id: 'm-060', name: 'Plaster — Gypsum', category: 'Plaster', lambda: 0.40, density: 1200, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-061', name: 'Plaster — Cement', category: 'Plaster', lambda: 0.72, density: 1800, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-062', name: 'Render — Cement Sand', category: 'Plaster', lambda: 0.87, density: 1900, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-063', name: 'Plaster — Lime', category: 'Plaster', lambda: 0.57, density: 1600, source: 'ASHRAE HoF Ch.26' },

  // Gypsum Board
  { id: 'm-070', name: 'Gypsum Board — Standard 12.5mm', category: 'Gypsum Board', lambda: 0.25, density: 900, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-071', name: 'Gypsum Board — Fire Rated', category: 'Gypsum Board', lambda: 0.25, density: 1000, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-072', name: 'Gypsum Board — Moisture Resistant', category: 'Gypsum Board', lambda: 0.25, density: 900, source: 'ASHRAE HoF Ch.26' },

  // Metal
  { id: 'm-080', name: 'Steel', category: 'Metal', lambda: 50.0, density: 7800, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-081', name: 'Aluminium', category: 'Metal', lambda: 160.0, density: 2700, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-082', name: 'Copper', category: 'Metal', lambda: 380.0, density: 8900, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-083', name: 'Zinc Sheet', category: 'Metal', lambda: 110.0, density: 7130, source: 'ASHRAE HoF Ch.26' },

  // Roofing
  { id: 'm-090', name: 'Bituminous Felt / Roofing Membrane', category: 'Roofing', lambda: 0.19, density: 1100, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-091', name: 'Single-Ply Membrane (TPO/EPDM)', category: 'Roofing', lambda: 0.25, density: 1200, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-092', name: 'Clay Roof Tile', category: 'Roofing', lambda: 1.00, density: 1900, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-093', name: 'Concrete Roof Tile', category: 'Roofing', lambda: 1.50, density: 2100, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-094', name: 'Asphalt — Mastic', category: 'Roofing', lambda: 0.70, density: 2100, source: 'ASHRAE HoF Ch.26' },

  // Flooring
  { id: 'm-100', name: 'Ceramic / Porcelain Tile', category: 'Flooring', lambda: 1.30, density: 2000, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-101', name: 'Carpet (with underlay)', category: 'Flooring', lambda: 0.06, density: 200, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-102', name: 'Vinyl / Linoleum', category: 'Flooring', lambda: 0.17, density: 1200, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-103', name: 'Raised Access Floor Panel', category: 'Flooring', lambda: 0.23, density: 750, source: 'ASHRAE HoF Ch.26' },

  // Glazing (whole-unit approximate — use with caution)
  { id: 'm-110', name: 'Single Glazing (approx)', category: 'Glazing', lambda: 1.00, density: 2500, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-111', name: 'Double Glazing — Air Fill (approx)', category: 'Glazing', lambda: 0.45, density: 2500, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-112', name: 'Double Glazing — Argon Fill (approx)', category: 'Glazing', lambda: 0.35, density: 2500, source: 'ASHRAE HoF Ch.26' },

  // Membranes & Vapour Barriers
  { id: 'm-120', name: 'Polyethylene Sheet (VCL)', category: 'Membrane', lambda: 0.33, density: 960, source: 'ASHRAE HoF Ch.26' },
  { id: 'm-121', name: 'Breather Membrane', category: 'Membrane', lambda: 0.33, density: 500, source: 'General' },
  { id: 'm-122', name: 'Damp Proof Membrane', category: 'Membrane', lambda: 0.33, density: 960, source: 'General' },

  // Earth & Fill — ISO 10456 / EN 1745 (use as layers in earth-covered assemblies)
  // For below-ground walls the soil is the external medium (Ground Params), not a layer.
  // These are for earth fill used as a structural/insulating layer, e.g. earth-covered roofs.
  { id: 'm-130', name: 'Earth Fill — Compacted (General)',   category: 'Earth & Fill', lambda: 0.60, density: 1700, source: 'ISO 10456 / EN 1745' },
  { id: 'm-131', name: 'Earth Fill — Moist Clay',            category: 'Earth & Fill', lambda: 1.50, density: 1800, source: 'ISO 10456 / EN 1745' },
  { id: 'm-132', name: 'Earth Fill — Dry Clay/Loam',         category: 'Earth & Fill', lambda: 0.85, density: 1500, source: 'ISO 10456 / EN 1745' },
  { id: 'm-133', name: 'Earth Fill — Moist Sand',            category: 'Earth & Fill', lambda: 1.00, density: 1700, source: 'ISO 10456 / EN 1745' },
  { id: 'm-134', name: 'Earth Fill — Dry Sand',              category: 'Earth & Fill', lambda: 0.50, density: 1500, source: 'ISO 10456 / EN 1745' },
  { id: 'm-135', name: 'Earth Fill — Sand & Gravel (Moist)', category: 'Earth & Fill', lambda: 2.00, density: 2000, source: 'ISO 10456 / EN 1745' },
  { id: 'm-136', name: 'Earth Fill — Peat / Organic',        category: 'Earth & Fill', lambda: 0.40, density: 800,  source: 'ISO 10456 / EN 1745' },
  { id: 'm-137', name: 'Growing Medium — Green Roof (Dry)',  category: 'Earth & Fill', lambda: 0.35, density: 700,  source: 'FLL Green Roof Guidelines' },
  { id: 'm-138', name: 'Growing Medium — Green Roof (Wet)',  category: 'Earth & Fill', lambda: 0.80, density: 1000, source: 'FLL Green Roof Guidelines' },
  { id: 'm-139', name: 'Gravel / Crushed Stone (Dry)',       category: 'Earth & Fill', lambda: 0.40, density: 1500, source: 'ISO 10456 / EN 1745' },
  { id: 'm-140', name: 'Gravel / Crushed Stone (Moist)',     category: 'Earth & Fill', lambda: 1.50, density: 1800, source: 'ISO 10456 / EN 1745' },
];

export const MATERIAL_CATEGORIES = [...new Set(MATERIALS.map(m => m.category))].sort();

// ─── Soil Types (ISO 13370 / EN ISO 10456) ────────────────────────────────────
export const SOIL_TYPES: SoilType[] = [
  { id: 's-001', name: 'Clay — Moist', lambda: 1.50, density: 1800, moisture: 'Moist' },
  { id: 's-002', name: 'Clay — Dry', lambda: 0.85, density: 1500, moisture: 'Dry' },
  { id: 's-003', name: 'Silt — Moist', lambda: 1.70, density: 1800, moisture: 'Moist' },
  { id: 's-004', name: 'Sand — Dry', lambda: 0.50, density: 1500, moisture: 'Dry' },
  { id: 's-005', name: 'Sand — Moist', lambda: 1.00, density: 1700, moisture: 'Moist' },
  { id: 's-006', name: 'Sand & Gravel — Moist', lambda: 2.00, density: 2000, moisture: 'Moist' },
  { id: 's-007', name: 'Sand & Gravel — Dry', lambda: 1.50, density: 1800, moisture: 'Dry' },
  { id: 's-008', name: 'Rock — Granite', lambda: 2.90, density: 2700, moisture: 'N/A' },
  { id: 's-009', name: 'Rock — Limestone', lambda: 1.50, density: 2500, moisture: 'N/A' },
  { id: 's-010', name: 'Chalk', lambda: 0.70, density: 1600, moisture: 'Dry' },
  { id: 's-011', name: 'Made Ground (typical)', lambda: 1.20, density: 1600, moisture: 'Mixed' },
  { id: 's-012', name: 'Peat / Organic Soil', lambda: 0.40, density: 800, moisture: 'Moist' },
];

// ─── ASHRAE Standard Assemblies ───────────────────────────────────────────────
// Pre-calculated U-values using ISO 6946 / ISO 13370
// Reference: ASHRAE 90.1-2022 and ASHRAE HoF typical assemblies

function makeLayer(mat: UMaterial, thicknessMm: number): AssemblyLayer {
  const t = thicknessMm / 1000;
  return {
    materialId: mat.id,
    materialName: mat.name,
    thickness: thicknessMm,
    lambda: mat.lambda,
    r: parseFloat((t / mat.lambda).toFixed(4)),
  };
}

const brick   = MATERIALS.find(m => m.id === 'm-001')!;
const faceBrick = MATERIALS.find(m => m.id === 'm-002')!;
const cBlockNW200 = MATERIALS.find(m => m.id === 'm-005')!;
const cBlockLW200 = MATERIALS.find(m => m.id === 'm-007')!;
const dConcrete = MATERIALS.find(m => m.id === 'm-020')!;
const aac600   = MATERIALS.find(m => m.id === 'm-023')!;
const mineralWool = MATERIALS.find(m => m.id === 'm-030')!;
const mineralWoolHD = MATERIALS.find(m => m.id === 'm-033')!;
const eps     = MATERIALS.find(m => m.id === 'm-040')!;
const xps     = MATERIALS.find(m => m.id === 'm-041')!;
const pir     = MATERIALS.find(m => m.id === 'm-042')!;
const softwood = MATERIALS.find(m => m.id === 'm-050')!;
const plywood = MATERIALS.find(m => m.id === 'm-052')!;
const osb     = MATERIALS.find(m => m.id === 'm-053')!;
const gypsumPlaster = MATERIALS.find(m => m.id === 'm-060')!;
const cementPlaster = MATERIALS.find(m => m.id === 'm-061')!;
const gypsumBoard = MATERIALS.find(m => m.id === 'm-070')!;
const bitFelt = MATERIALS.find(m => m.id === 'm-090')!;
const ceramicTile = MATERIALS.find(m => m.id === 'm-100')!;
const screed  = MATERIALS.find(m => m.id === 'm-026')!;
const rcSlab  = MATERIALS.find(m => m.id === 'm-025')!;

export const ASHRAE_ASSEMBLIES: UAssembly[] = [
  // ── WALLS ────────────────────────────────────────────────────────────────
  {
    id: 'as-w001',
    name: 'Brick Cavity Wall — Insulated (75mm MW)',
    type: 'standard',
    wallCategory: 'above_ground',
    uValue: 0.41,
    method: 'ISO_6946',
    ashraeReference: 'ASHRAE HoF — Typical Cavity Wall',
    description: '102mm brick / 75mm mineral wool / 102mm brick / 13mm plaster',
    layers: [
      makeLayer(faceBrick, 102),
      makeLayer(mineralWoolHD, 75),
      makeLayer(brick, 102),
      makeLayer(gypsumPlaster, 13),
    ],
  },
  {
    id: 'as-w002',
    name: 'Brick Cavity Wall — Uninsulated',
    type: 'standard',
    wallCategory: 'above_ground',
    uValue: 1.44,
    method: 'ISO_6946',
    ashraeReference: 'ASHRAE HoF — Typical Cavity Wall',
    description: '102mm brick / 50mm air gap / 102mm brick / 13mm plaster',
    layers: [
      makeLayer(faceBrick, 102),
      // Air gap represented as mineral wool zero — approximate with still air R=0.18
      { materialId: 'air-gap', materialName: 'Still Air Gap (50mm)', thickness: 50, lambda: 0.28, r: 0.18 },
      makeLayer(brick, 102),
      makeLayer(gypsumPlaster, 13),
    ],
  },
  {
    id: 'as-w003',
    name: 'Concrete Block — External EPS Insulation',
    type: 'standard',
    wallCategory: 'above_ground',
    uValue: 0.37,
    method: 'ISO_6946',
    ashraeReference: 'ASHRAE 90.1 — Typical EIFS',
    description: '80mm EPS / 200mm normal weight block / 13mm plaster',
    layers: [
      makeLayer(eps, 80),
      makeLayer(cBlockNW200, 200),
      makeLayer(gypsumPlaster, 13),
    ],
  },
  {
    id: 'as-w004',
    name: 'Concrete Block — Lightweight, Uninsulated',
    type: 'standard',
    wallCategory: 'above_ground',
    uValue: 0.87,
    method: 'ISO_6946',
    ashraeReference: 'ASHRAE HoF — Typical Masonry',
    description: '15mm render / 200mm lightweight block / 13mm plaster',
    layers: [
      makeLayer(cementPlaster, 15),
      makeLayer(cBlockLW200, 200),
      makeLayer(gypsumPlaster, 13),
    ],
  },
  {
    id: 'as-w005',
    name: 'Timber Frame Wall — Insulated',
    type: 'standard',
    wallCategory: 'above_ground',
    uValue: 0.24,
    method: 'ISO_6946',
    ashraeReference: 'ASHRAE 90.1 — Wood Frame',
    description: '25mm softwood cladding / 12mm OSB / 140mm mineral wool / 13mm gypsum board',
    layers: [
      makeLayer(softwood, 25),
      makeLayer(osb, 12),
      makeLayer(mineralWool, 140),
      makeLayer(gypsumBoard, 13),
    ],
  },
  {
    id: 'as-w006',
    name: 'AAC Block Wall — 200mm',
    type: 'standard',
    wallCategory: 'above_ground',
    uValue: 0.52,
    method: 'ISO_6946',
    ashraeReference: 'ASHRAE HoF — AAC Masonry',
    description: '15mm cement render / 200mm AAC (600 kg/m³) / 13mm gypsum plaster',
    layers: [
      makeLayer(cementPlaster, 15),
      makeLayer(aac600, 200),
      makeLayer(gypsumPlaster, 13),
    ],
  },
  {
    id: 'as-w007',
    name: 'Dense Concrete Wall — Internal PIR Insulation',
    type: 'standard',
    wallCategory: 'above_ground',
    uValue: 0.37,
    method: 'ISO_6946',
    ashraeReference: 'ASHRAE 90.1 — Cast-in-Place Concrete',
    description: '200mm dense concrete / 60mm PIR board / 13mm gypsum board',
    layers: [
      makeLayer(dConcrete, 200),
      makeLayer(pir, 60),
      makeLayer(gypsumBoard, 13),
    ],
  },

  // ── ROOFS ─────────────────────────────────────────────────────────────────
  {
    id: 'as-r001',
    name: 'Flat Roof — Inverted (PIR Insulation)',
    type: 'standard',
    wallCategory: 'roof',
    uValue: 0.18,
    method: 'ISO_6946',
    ashraeReference: 'ASHRAE 90.1 — Insulation Above Deck',
    description: 'Bituminous felt / 120mm PIR / 150mm RC slab / 13mm gypsum board',
    layers: [
      makeLayer(bitFelt, 5),
      makeLayer(pir, 120),
      makeLayer(rcSlab, 150),
      makeLayer(gypsumBoard, 13),
    ],
  },
  {
    id: 'as-r002',
    name: 'Flat Roof — Warm Deck (Mineral Wool)',
    type: 'standard',
    wallCategory: 'roof',
    uValue: 0.22,
    method: 'ISO_6946',
    ashraeReference: 'ASHRAE 90.1 — Insulation Above Deck',
    description: 'Felt / 150mm stone wool / RC slab / 13mm gypsum board',
    layers: [
      makeLayer(bitFelt, 5),
      makeLayer(MATERIALS.find(m => m.id === 'm-031')!, 150),
      makeLayer(rcSlab, 150),
      makeLayer(gypsumBoard, 13),
    ],
  },
  {
    id: 'as-r003',
    name: 'Pitched Roof — Mineral Wool at Ceiling',
    type: 'standard',
    wallCategory: 'roof',
    uValue: 0.18,
    method: 'ISO_6946',
    ashraeReference: 'ASHRAE 90.1 — Attic Roof',
    description: '200mm mineral wool between joists / 13mm gypsum board ceiling',
    layers: [
      makeLayer(mineralWool, 200),
      makeLayer(gypsumBoard, 13),
    ],
  },

  // ── FLOORS ────────────────────────────────────────────────────────────────
  {
    id: 'as-f001',
    name: 'Ground Floor Slab — EPS Underfloor Insulation',
    type: 'standard',
    wallCategory: 'floor',
    uValue: 0.27,
    method: 'ISO_6946',
    ashraeReference: 'ASHRAE HoF — Slab-on-Grade',
    description: 'Ceramic tile / 65mm screed / 100mm EPS / 150mm RC slab',
    layers: [
      makeLayer(ceramicTile, 10),
      makeLayer(screed, 65),
      makeLayer(eps, 100),
      makeLayer(rcSlab, 150),
    ],
  },
  {
    id: 'as-f002',
    name: 'Suspended Timber Floor — Insulated',
    type: 'standard',
    wallCategory: 'floor',
    uValue: 0.22,
    method: 'ISO_6946',
    ashraeReference: 'ASHRAE HoF — Suspended Floor',
    description: 'Hardwood board / 18mm plywood / 100mm mineral wool between joists',
    layers: [
      makeLayer(MATERIALS.find(m => m.id === 'm-056')!, 22),
      makeLayer(plywood, 18),
      makeLayer(mineralWool, 100),
    ],
  },

  // ── BELOW GROUND ─────────────────────────────────────────────────────────
  {
    id: 'as-bg001',
    name: 'Basement Wall — Dense Concrete + XPS',
    type: 'standard',
    wallCategory: 'below_ground',
    uValue: 0.29,
    method: 'ISO_13370',
    ashraeReference: 'ISO 13370 — Below-Grade Wall',
    description: '200mm RC wall / 60mm XPS / plaster — moist clay backfill, 0–2m depth',
    layers: [
      makeLayer(dConcrete, 200),
      makeLayer(xps, 60),
      makeLayer(gypsumPlaster, 13),
    ],
    groundParams: {
      soilId: 's-001',
      soilName: 'Clay — Moist',
      soilLambda: 1.5,
      depthTop: 0,
      depthBottom: 2.0,
      slopeAngle: 0,
    },
  },
  {
    id: 'as-bg002',
    name: 'Retaining Wall — Concrete Block + EPS (Sloped Backfill)',
    type: 'standard',
    wallCategory: 'below_ground',
    uValue: 0.31,
    method: 'ISO_13370',
    ashraeReference: 'ISO 13370 — Below-Grade Sloped',
    description: '200mm normal-weight block / 80mm EPS / plaster — sandy soil, 0.5–3m sloped backfill',
    layers: [
      makeLayer(cBlockNW200, 200),
      makeLayer(eps, 80),
      makeLayer(gypsumPlaster, 13),
    ],
    groundParams: {
      soilId: 's-005',
      soilName: 'Sand — Moist',
      soilLambda: 1.0,
      depthTop: 0.5,
      depthBottom: 3.0,
      slopeAngle: 30,
    },
  },
];
