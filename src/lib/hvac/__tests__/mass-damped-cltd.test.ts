/**
 * Net for the mass-damped CLTD (added 2026-08-02).
 *
 * WHAT THIS GUARDS. `getCLTD` used to charge every opaque surface the full sol-air peak:
 *
 *     cltd = (dT + 8) + offset · 0.35 · k_alt + corrections
 *
 * — no term for construction weight at all, so a 181 lb/ft² earth-covered RCC slab and a
 * bare metal deck came out identical. The CLTD tables it approximates are tabulated BY
 * ROOF MASS precisely because that is not true: a heavy assembly flattens the daily wave
 * and delays what survives by hours, so the room sees something near the DAILY MEAN
 * sol-air temperature rather than its peak.
 *
 * WHY IT EXISTS. Report HLM-TEZ-2LAL R0 printed the Avionics Store roof (300 mm camouflage
 * earth over 150 mm RCC) at CLTD 36.98 — roughly 2× defensible — making the roof 27 % of
 * room sensible and driving the design airflow to 3.11 CFM/ft² against a ~1.5 norm. The
 * envelope elements were also unedited placeholders, but the CLTD carried ~4× the error
 * the U-value did.
 *
 * TWO DIRECTIONS MATTER HERE, and only one of them is safe to get wrong:
 *
 *   • Under-damping a heavy roof over-states load — wasteful, but the plant still works.
 *   • Over-damping a light roof under-states load — the coil is too small and the room
 *     never holds setpoint. The storage cap in calcThermalDynamics exists for this, and
 *     the metal-deck case below is what keeps it honest.
 *
 * Anchor case: TEZPUR, GURT COMPLEX - B / Avionics Store, summer.
 * Design conditions 94 °F DB max / 20 °F daily range / 75 °F room, altitude 259 ft, July.
 */

import { describe, it, expect } from 'vitest';
import { getCLTD, calculateSingleElementGain } from '../envelope';
import type { EnvelopeElement, DesignConditions } from '../constants';
import { calcThermalDynamics } from '../../ubuilder/calculations';
import type { AssemblyLayer } from '../../../data/ubuilder-seed';

const layer = (materialId: string, thickness: number, lambda: number): AssemblyLayer => ({
  materialId,
  materialName: materialId,
  thickness,
  lambda,
  r: thickness / 1000 / lambda,
});

// Tezpur summer design conditions.
const DT = 19; // 94 − 75
const ALT = 259;
const OPTS = { indoorTemp: 75, outdoorMax: 94, dailyRange: 20, designMonth: 7 } as const;

// 300 mm compacted earth over 150 mm reinforced concrete — the real Avionics Store roof.
const EARTH_ROOF = [layer('m-130', 300, 0.6), layer('m-025', 150, 2.0)];
// Steel deck + 100 mm EPS — negligible mass, the case the storage cap protects.
const METAL_DECK = [layer('m-080', 1, 50), layer('m-040', 100, 0.036)];

describe('calcThermalDynamics', () => {
  it('derives areal mass from layer thickness × density', () => {
    // 0.300 × 1700 + 0.150 × 2500 = 510 + 375
    expect(calcThermalDynamics(EARTH_ROOF).arealMass).toBeCloseTo(885, 0);
  });

  it('damps the earth-covered roof to a few percent, lagged past the design hour', () => {
    const d = calcThermalDynamics(EARTH_ROOF);
    expect(d.decrementFactor).toBeLessThan(0.2);
    expect(d.timeLagHours).toBeGreaterThan(12); // peak arrives overnight, not at 15:00
  });

  it('leaves a low-mass insulated deck essentially undamped', () => {
    // The wave term alone would say 0.59 — rigid foam has a diffusivity close to
    // concrete's. It stores nothing, so the storage cap must govern instead.
    const d = calcThermalDynamics(METAL_DECK);
    expect(d.waveDecrement).toBeLessThan(0.7);
    expect(d.decrementFactor).toBeGreaterThan(0.95);
    expect(d.decrementFactor).toBe(d.massDecrement);
  });

  it('matches the ISO 13786 decrement factor for a 150 mm dense concrete slab', () => {
    expect(calcThermalDynamics([layer('m-025', 150, 2.0)]).decrementFactor).toBeCloseTo(0.45, 1);
  });

  it('returns no damping for an assembly with no usable layer data', () => {
    expect(calcThermalDynamics([]).decrementFactor).toBe(1);
    expect(calcThermalDynamics([layer('nonexistent-id', 200, 1.0)]).decrementFactor).toBe(1);
  });
});

describe('getCLTD mass damping', () => {
  const light = getCLTD('H', 'Roof', DT, ALT, { ...OPTS, color: 'Dark' });

  it('is unchanged when no assembly is assigned', () => {
    expect(light).toBeCloseTo(36.98, 2);
  });

  it('treats null as absent — Firestore writes null, and null >= 0 is true in JS', () => {
    // A `!= null` guard here would read null as a fully damped assembly and silently
    // halve the roof load of every element switched back to a catalog type.
    expect(getCLTD('H', 'Roof', DT, ALT, { ...OPTS, color: 'Dark', decrementFactor: null }))
      .toBeCloseTo(light, 6);
  });

  it('reproduces the light-construction value exactly at f = 1', () => {
    expect(getCLTD('H', 'Roof', DT, ALT, { ...OPTS, color: 'Dark', decrementFactor: 1 }))
      .toBeCloseTo(light, 6);
  });

  it('cuts the earth-covered roof roughly in half', () => {
    const f = calcThermalDynamics(EARTH_ROOF).decrementFactor;
    const damped = getCLTD('H', 'Roof', DT, ALT, { ...OPTS, color: 'Dark', decrementFactor: f });
    expect(damped).toBeGreaterThan(15); // not the fully-damped mean — some swing survives
    expect(damped).toBeLessThan(21);
    expect(damped).toBeLessThan(light * 0.6);
  });

  it('barely moves a metal deck — the load must not be under-stated', () => {
    const f = calcThermalDynamics(METAL_DECK).decrementFactor;
    expect(getCLTD('H', 'Roof', DT, ALT, { ...OPTS, color: 'Dark', decrementFactor: f }))
      .toBeGreaterThan(light - 1);
  });

  it('never damps below the daily-mean sol-air floor', () => {
    // f = 0 is the infinite-mass limit: air term at the daily mean (dT − DR/2) plus the
    // 24-h mean solar. It must stay well above zero, or a heavy roof would read as no load.
    const floor = getCLTD('H', 'Roof', DT, ALT, { ...OPTS, color: 'Dark', decrementFactor: 0 });
    expect(floor).toBeGreaterThan(10);
    expect(floor).toBeLessThan(light);
  });

  it('is monotonic in the decrement factor', () => {
    const at = (f: number) => getCLTD('H', 'Roof', DT, ALT, { ...OPTS, color: 'Dark', decrementFactor: f });
    const series = [0, 0.15, 0.45, 0.8, 1].map(at);
    for (let i = 1; i < series.length; i++) expect(series[i]).toBeGreaterThan(series[i - 1]);
  });

  it('leaves Glass alone — it is massless and driven by transmitted solar', () => {
    const g = getCLTD('NW', 'Glass', DT, ALT, { ...OPTS, color: 'Dark' });
    expect(getCLTD('NW', 'Glass', DT, ALT, { ...OPTS, color: 'Dark', decrementFactor: 0.05 }))
      .toBeCloseTo(g, 6);
  });

  it('leaves Partition and Floor alone — neither carries a solar term', () => {
    for (const t of ['Partition', 'Floor'] as const) {
      const base = getCLTD('N', t, DT, ALT, { ...OPTS, color: 'Dark' });
      expect(getCLTD('N', t, DT, ALT, { ...OPTS, color: 'Dark', decrementFactor: 0.05 }))
        .toBeCloseTo(base, 6);
    }
  });

  // THE ONE THAT ACTUALLY MATTERED. getCLTD damping is inert unless the gain calculation
  // forwards the element's factor. It did not on first cut: the RoomTable read-out showed
  // a damped CLTD while calculateSingleElementGain silently recomputed the undamped one,
  // so the number on screen and the number in the load disagreed. Assert the GAIN, not
  // the CLTD — that is the only way this class of omission shows up.
  describe('gain calculation honours the element factor', () => {
    const design = {
      indoorTemp: 75, outdoorTemp: 94, dailyRange: 20, designMonth: 7, altitude: ALT,
    } as unknown as DesignConditions;

    const roofEl = (decrementFactor?: number): EnvelopeElement => ({
      id: 'roof-1', type: 'Roof', orientation: 'H', area: 269, uValue: 0.2463,
      solarFactor: 0, isOverride: false, color: 'Medium', decrementFactor,
    });

    it('a heavy roof gains materially less than an undamped one', () => {
      const f = calcThermalDynamics(EARTH_ROOF).decrementFactor;
      const undamped = calculateSingleElementGain(roofEl(undefined), design).total;
      const damped = calculateSingleElementGain(roofEl(f), design).total;
      expect(undamped).toBeGreaterThan(2000);   // 269 ft² × 0.2463 × 33.98
      expect(damped).toBeLessThan(undamped * 0.6);
      expect(damped).toBeGreaterThan(0);
    });

    it('a manual CLTD override still wins over the damping', () => {
      const el = { ...roofEl(calcThermalDynamics(EARTH_ROOF).decrementFactor), isOverride: true, solarFactor: 30 };
      expect(calculateSingleElementGain(el, design).total).toBeCloseTo(0.2463 * 269 * 30, 6);
    });
  });

  it('damps a heavy wall too, not just roofs', () => {
    const f = calcThermalDynamics([layer('m-001', 230, 0.72)]).decrementFactor;
    const bare = getCLTD('W', 'Wall', DT, ALT, { ...OPTS, color: 'Dark' });
    expect(getCLTD('W', 'Wall', DT, ALT, { ...OPTS, color: 'Dark', decrementFactor: f }))
      .toBeLessThan(bare);
  });
});
