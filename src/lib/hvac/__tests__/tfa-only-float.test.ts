/**
 * TFA-only indoor-float correction (2026-07-09).
 *
 * A tfa-only room (corridor) has no space coil — it is fed ONLY its FACFM at the DOAS
 * supply condition, which can't hold the design DB/RH. computeRoomLoad solves the
 * equilibrium where the fresh air balances the space load and reports the ACTUAL
 * maintained DB/RH (per Pravat: accepted for a corridor, but reported honestly).
 *
 * These assertions are physics checks (the sensible balance must close), not program
 * echoes — so a future edit that breaks the float fails loudly.
 */
import { describe, it, expect } from 'vitest';
import { computeRoomLoad } from '@/lib/hvac';
import type { DesignConditions } from '@/lib/hvac';

const dc: DesignConditions = {
  outdoorTemp: 94, indoorTemp: 72, outdoorHumidity: 59, indoorHumidity: 50,
  altitude: 259, latitude: 26.6, longitude: 92.8,
  winterOutdoorTemp: 40, winterOutdoorHumidity: 30, winterIndoorTemp: 70, winterIndoorHumidity: 30,
  includeWinter: false,
} as unknown as DesignConditions;

// A corridor whose people/lighting load is well above what the ventilation air can carry,
// so it floats above design. No envelope elements — load comes from internal gains.
const baseRoom: any = {
  id: 'corridor-1', name: 'Test Corridor', floor: 'Ground',
  length: 120, width: 8, height: 10,
  facph: 1.5, peopleCount: 20, activityType: 'office',
  lightsWattsPerSqft: 1.2, equipmentKW: 2, othersKW: 0,
};
const equipSystems = [{
  id: 'doas-1', type: 'DOAS', tfaSupplyTemp: 55, tfaSupplyHumidity: 90,
  ervSensibleEffectiveness: 0, ervLatentEffectiveness: 0,
}];

describe('computeRoomLoad — TFA-only indoor float', () => {
  const res = computeRoomLoad({ ...baseRoom, tfaMode: 'tfa-only' }, [], dc, { equipSystems, project: { systemType: 'Chiller' } });

  it('resolves as TFA-only with a DOAS fresh-air supply', () => {
    expect(res.isTfaOnly).toBe(true);
    expect(res.tfaCfm).toBeGreaterThan(0);
  });

  it('floats ABOVE the design dry-bulb (FACFM alone cannot hold it)', () => {
    expect(res.floatIndoorTemp).not.toBeNull();
    expect(res.floatIndoorTemp!).toBeGreaterThan(dc.indoorTemp);
  });

  it('float dry-bulb closes the sensible balance: 1.08·FACFM·(Tfloat − Tsupply) ≈ ERSH', () => {
    const carrying = 1.08 * res.tfaCfm * (res.floatIndoorTemp! - 55);
    expect(carrying).toBeCloseTo(res.ersh, 0);            // within ~1 BTU/h
    expect(Math.abs(carrying - res.ersh) / res.ersh).toBeLessThan(0.005); // <0.5%
  });

  it('reports a physically valid float RH', () => {
    expect(res.floatIndoorRH).not.toBeNull();
    expect(res.floatIndoorRH!).toBeGreaterThan(0);
    expect(res.floatIndoorRH!).toBeLessThanOrEqual(100);
  });

  it('leaves a non-TFA-only room at design (no float)', () => {
    const noTfa = computeRoomLoad({ ...baseRoom, tfaMode: 'no-tfa' }, [], dc, { equipSystems, project: { systemType: 'Chiller' } });
    expect(noTfa.floatIndoorTemp).toBeNull();
    expect(noTfa.floatIndoorRH).toBeNull();
  });

  // Low FACPH shrinks the fresh-air flow relative to the envelope conductance — the regime
  // where the old fixed-point solver oscillated and stopped short of the true float. With a
  // real corridor (envelope elements + low facph) the balance must still close to ~0%.
  it('converges the float even when FACFM is small vs the envelope (bisection)', () => {
    const bigCorridor: any = {
      ...baseRoom, tfaMode: 'tfa-only',
      length: 580, width: 10.8, height: 20.5, facph: 1.0, peopleCount: 40,
      elements: undefined,
    };
    const elements: any = [
      { id: 'p1', type: 'Partition', orientation: 'N', area: 1462, uValue: 0.35, solarFactor: 13.2, color: 'Dark' },
      { id: 'f1', type: 'Floor', orientation: 'H', area: 6273.7, uValue: 0.4, solarFactor: 11, color: 'Dark' },
    ];
    const r = computeRoomLoad(bigCorridor, elements, dc, { equipSystems, project: { systemType: 'Chiller' } });
    expect(r.floatIndoorTemp).not.toBeNull();
    const carrying = 1.08 * r.tfaCfm * (r.floatIndoorTemp! - 55);
    expect(Math.abs(carrying - r.ersh) / r.ersh).toBeLessThan(0.005); // <0.5% — old solver was ~2.8% off
  });
});
