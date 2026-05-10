// U-value calculation engine
// Above-ground walls/roofs/floors: ISO 6946 (1D steady-state)
// Below-ground / earth-contact walls: ISO 13370 (depth-dependent, strip method for slopes)

import type { AssemblyLayer, GroundParams, WallCategory } from '../../data/ubuilder-seed';
import { SURFACE_RESISTANCES } from '../../data/ubuilder-seed';

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
