// U-value calculation engine
// Above-ground walls/roofs/floors: ISO 6946 (1D steady-state)
// Below-ground / earth-contact walls: ISO 13370 (depth-dependent, strip method for slopes)

import type { AssemblyLayer, GroundParams, WallCategory } from '../../data/ubuilder-seed';
import { SURFACE_RESISTANCES, MATERIALS, SPECIFIC_HEAT_BY_CATEGORY, DEFAULT_SPECIFIC_HEAT } from '../../data/ubuilder-seed';

export interface LayerResult {
  materialName: string;
  thicknessMm: number;
  lambda: number;
  r: number; // m²K/W
}

export interface UValueResult {
  rsi: number;
  rse: number;
  layerResults: LayerResult[];
  rWall: number; // sum of layer resistances
  rTotal: number; // rsi + rWall + rse
  uValue: number; // 1 / rTotal (W/m²K)
  method: 'ISO_6946' | 'ISO_13370';
  // ISO 13370 extras
  strips?: DepthStrip[];
  weightedU?: number;
}

export interface DepthStrip {
  depthMidpoint: number; // m
  stripHeight: number; // m
  uAtDepth: number; // W/m²K
  area: number; // m² (per unit width = 1m)
}

// ─── Dynamic thermal response (areal mass / decrement factor / time lag) ─────
//
// The CLTD method as tabulated assumes a roof or wall of light-to-medium mass: the
// sol-air peak reaches the inside surface largely intact. A heavy assembly does not
// behave that way. The daily temperature wave decays exponentially with depth and
// arrives late, so what the room actually sees approaches the DAILY MEAN sol-air
// temperature rather than its peak.
//
// For a sinusoidal daily cycle the amplitude surviving a layer of thickness t is
// exp(−t/d), where d = sqrt(2α/ω) is the damping depth, α = λ/(ρ·c) the thermal
// diffusivity and ω = 2π/86400 the diurnal angular frequency. Layers compound, so
// the assembly decrement factor is exp(−Σ tᵢ/dᵢ) and the lag is Σ(tᵢ/dᵢ) in radians.
//
// This is what `getCLTD` needs to damp the solar term — without it a 885 kg/m²
// earth-covered slab is charged the same CLTD as a bare metal deck. (Tezpur GURT:
// roof CLTD 33.98 against a physically defensible ~15.)
export interface ThermalDynamics {
  arealMass: number;        // kg/m² — Σ(thickness × density)
  decrementFactor: number;  // 0..1 — surviving amplitude of the daily sol-air swing (governing)
  timeLagHours: number;     // h — delay of the peak at the inside face
  waveDecrement: number;    // exp(−Σ tᵢ/dᵢ) alone, before the storage limit
  massDecrement: number;    // storage limit alone
}

const OMEGA_DIURNAL = (2 * Math.PI) / 86400; // rad/s

// Areal mass at which stored heat damps the daily swing to 1/e, kg/m². Calibrated so a
// 150 mm dense concrete slab (375 kg/m²) returns ≈0.45, the ISO 13786 decrement factor
// for that construction.
const MASS_DAMPING_SCALE = 470;

/** Density + specific heat for a layer, resolved from the material library. */
const layerProps = (l: AssemblyLayer): { rho: number; c: number } => {
  const m = MATERIALS.find((mat) => mat.id === l.materialId);
  return {
    rho: m?.density ?? 0,
    c: (m && SPECIFIC_HEAT_BY_CATEGORY[m.category]) ?? DEFAULT_SPECIFIC_HEAT,
  };
};

/**
 * Diurnal dynamic response of a layered assembly.
 *
 * Layers with no density in the library (air gaps, membranes) contribute no mass and
 * no damping — conservative, they are thermally thin anyway. An assembly with no
 * usable data returns decrementFactor 1, i.e. the existing light-construction CLTD.
 *
 * TWO limits, and the LESS damped one governs:
 *
 *  • wave  — exp(−Σ tᵢ/dᵢ), the semi-infinite-solid attenuation above.
 *  • mass  — exp(−arealMass/MASS_DAMPING_SCALE).
 *
 * The wave term alone over-damps low-density insulation. Rigid foam has a diffusivity
 * close to concrete's (λ and ρc both fall together), so 100 mm of EPS scores f ≈ 0.59 —
 * yet it stores almost nothing and cannot flatten a daily swing. Damping a wave requires
 * somewhere to put the heat, so the storage term caps how far the wave term may go, and
 * a metal-deck roof stays at its light-construction CLTD where it belongs.
 *
 * Erring toward the lesser damping keeps the error on the safe side: a slightly
 * over-stated cooling load rather than an under-sized coil.
 */
export function calcThermalDynamics(layers: AssemblyLayer[]): ThermalDynamics {
  let arealMass = 0;
  let phase = 0; // Σ tᵢ/dᵢ  (radians)

  for (const l of layers) {
    const t = (l.thickness ?? 0) / 1000; // m
    const { rho, c } = layerProps(l);
    if (t <= 0 || rho <= 0 || !(l.lambda > 0)) continue;

    arealMass += t * rho;
    const alpha = l.lambda / (rho * c);              // m²/s
    const d = Math.sqrt((2 * alpha) / OMEGA_DIURNAL); // m
    if (d > 0) phase += t / d;
  }

  const waveDecrement = Math.exp(-phase);
  const massDecrement = Math.exp(-arealMass / MASS_DAMPING_SCALE);
  const governing = Math.max(waveDecrement, massDecrement);

  return {
    arealMass: parseFloat(arealMass.toFixed(1)),
    decrementFactor: parseFloat(governing.toFixed(4)),
    // Lag is reported from the wave term — it is a phase, not an amplitude, so the
    // storage cap does not apply. Display only; the CLTD blend does not use it.
    timeLagHours: parseFloat((phase * (24 / (2 * Math.PI))).toFixed(2)),
    waveDecrement: parseFloat(waveDecrement.toFixed(4)),
    massDecrement: parseFloat(massDecrement.toFixed(4)),
  };
}

// ─── ISO 6946 — Above-Ground ─────────────────────────────────────────────────

export function calcISO6946(
  layers: AssemblyLayer[],
  wallCategory: WallCategory,
): UValueResult {
  const { rsi, rse } =
    wallCategory === 'roof'
      ? SURFACE_RESISTANCES.roof
      : wallCategory === 'floor'
      ? SURFACE_RESISTANCES.floor
      : SURFACE_RESISTANCES.wall;

  const layerResults: LayerResult[] = layers.map((l) => ({
    materialName: l.materialName,
    thicknessMm: l.thickness,
    lambda: l.lambda,
    r: parseFloat((l.thickness / 1000 / l.lambda).toFixed(4)),
  }));

  const rWall = layerResults.reduce((sum, lr) => sum + lr.r, 0);
  const rTotal = rsi + rWall + rse;
  const uValue = parseFloat((1 / rTotal).toFixed(3));

  return { rsi, rse, layerResults, rWall: parseFloat(rWall.toFixed(4)), rTotal: parseFloat(rTotal.toFixed(4)), uValue, method: 'ISO_6946' };
}

// ─── ISO 13370 — Below-Ground (with strip method for sloped backfill) ─────────
// Formula for below-grade wall at depth z (m):
//   dt  = wallThickness + λ_soil × (Rsi + Rf + Rse)
//   U(z) = (2λ_soil / π) × (1 / (z + dt)) × ln(z/dt + 1)
// where Rf = sum of all wall layer resistances (excluding surface resistances)

export function calcISO13370(
  layers: AssemblyLayer[],
  ground: GroundParams,
  wallHeightForReport = 1.0, // m — used only for strip area reporting
): UValueResult {
  const { rsi, rse } = SURFACE_RESISTANCES.wall;
  const λ_soil = ground.soilLambda;

  const layerResults: LayerResult[] = layers.map((l) => ({
    materialName: l.materialName,
    thicknessMm: l.thickness,
    lambda: l.lambda,
    r: parseFloat((l.thickness / 1000 / l.lambda).toFixed(4)),
  }));

  const rWall = layerResults.reduce((sum, lr) => sum + lr.r, 0);
  // Total wall thickness (m)
  const wallThickness = layers.reduce((sum, l) => sum + l.thickness / 1000, 0);
  // dt: equivalent thickness per ISO 13370 §9.3.2
  const dt = wallThickness + λ_soil * (rsi + rWall + rse);

  // For sloped backfill: depth varies from depthTop (at top of wall) to depthBottom (at bottom).
  // For vertical face (slopeAngle = 0), depth is uniform — simplify to single strip.
  // For sloped, we divide the wall into strips every 0.1 m of depth.

  const STRIP_HEIGHT = 0.1; // m

  function uAtDepth(z: number): number {
    if (z <= 0) return 0; // above ground — not applicable
    return (2 * λ_soil) / Math.PI / (z + dt) * Math.log(z / dt + 1);
  }

  const strips: DepthStrip[] = [];

  const totalDepthRange = ground.depthBottom - ground.depthTop;

  if (totalDepthRange <= 0) {
    // Degenerate: treat as single strip at depthTop
    const z = Math.max(ground.depthTop, 0.01);
    const u = uAtDepth(z);
    strips.push({ depthMidpoint: z, stripHeight: 1.0, uAtDepth: parseFloat(u.toFixed(3)), area: 1.0 });
    const uValue = parseFloat(u.toFixed(3));
    return { rsi, rse, layerResults, rWall: parseFloat(rWall.toFixed(4)), rTotal: parseFloat((1 / uValue).toFixed(4)), uValue, method: 'ISO_13370', strips, weightedU: uValue };
  }

  // Build strips from depthTop to depthBottom
  let currentDepth = ground.depthTop;
  while (currentDepth < ground.depthBottom - 1e-6) {
    const nextDepth = Math.min(currentDepth + STRIP_HEIGHT, ground.depthBottom);
    const midZ = (currentDepth + nextDepth) / 2;
    const stripH = nextDepth - currentDepth;
    const u = uAtDepth(Math.max(midZ, 0.01));
    strips.push({
      depthMidpoint: parseFloat(midZ.toFixed(3)),
      stripHeight: parseFloat(stripH.toFixed(3)),
      uAtDepth: parseFloat(u.toFixed(3)),
      area: parseFloat(stripH.toFixed(3)), // per unit width (1 m)
    });
    currentDepth = nextDepth;
  }

  // Area-weighted average U-value
  const totalArea = strips.reduce((s, st) => s + st.area, 0);
  const weightedU =
    totalArea > 0
      ? strips.reduce((s, st) => s + st.uAtDepth * st.area, 0) / totalArea
      : 0;

  const uValue = parseFloat(weightedU.toFixed(3));
  const rTotal = uValue > 0 ? parseFloat((1 / uValue).toFixed(4)) : 0;

  return {
    rsi,
    rse,
    layerResults,
    rWall: parseFloat(rWall.toFixed(4)),
    rTotal,
    uValue,
    method: 'ISO_13370',
    strips,
    weightedU: uValue,
  };
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export function calculateUValue(
  layers: AssemblyLayer[],
  wallCategory: WallCategory,
  groundParams?: GroundParams,
): UValueResult {
  if (wallCategory === 'below_ground' && groundParams) {
    return calcISO13370(layers, groundParams);
  }
  return calcISO6946(layers, wallCategory);
}
