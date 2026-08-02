/**
 * Partitions and floors must state the SAME assumption in both seasons (2026-08-02).
 *
 * A partition or a floor faces a neighbouring space, not outdoors. Cooling has always said
 * so — getCLTD charges a partition 0.6 × ΔT and a floor 0.5 × ΔT, i.e. the far side sits
 * partway between indoors and outdoors. Heating charged them the FULL ΔT, which asserts the
 * opposite: that the same neighbouring space is at outdoor temperature.
 *
 * Both cannot be true, and the full-ΔT version silently inflated every winter load — on
 * TEZPUR GURT's CO Room the partition and floor were 51 % of a 6,734 BTU/h transmission loss.
 *
 * The load net covered `ventilationHeating` and never `transmissionLoss`, so this whole path
 * was unasserted: all 76 tests passed both before and after the fix. These are hand-derived
 * from U × A × ΔT, and the last test is the one that matters — it ties the heating fraction
 * to the cooling one by construction, so changing either alone fails here rather than
 * quietly re-opening the asymmetry.
 */
import { describe, it, expect } from 'vitest';
import { calculateHeatingLoad, getCLTD } from '@/lib/hvac';
import type { DesignConditions, EnvelopeElement, RoomDetails } from '@/lib/hvac';

const T_IN = 72, T_OUT = 42;
const DT = T_IN - T_OUT;   // 30 °F

const dc = {
  outdoorTemp: 95, indoorTemp: 75, outdoorHumidity: 50, indoorHumidity: 50, altitude: 0,
  winterOutdoorTemp: T_OUT, winterIndoorTemp: T_IN,
  winterOutdoorHumidity: 30, winterIndoorHumidity: 40,
  // No DOAS, and facph 0 below, so ventilation heating rides infiltration only — this test
  // is about transmission, and pinning the other term keeps the arithmetic readable.
  winterInfiltrationACH: 0,
} as unknown as DesignConditions;

const room: RoomDetails = {
  id: 'r1', name: 'Test', floor: 'Ground',
  length: 20, width: 10, height: 10,
  hasFalseCeiling: false, falseCeilingHeight: 0,
  facph: 0, peopleCount: 0, activityType: 'office',
  lightsWattsPerSqft: 0, equipmentKW: 0, othersKW: 0,
} as unknown as RoomDetails;

const el = (id: string, type: string, area: number, uValue: number): EnvelopeElement =>
  ({ id, type, orientation: type === 'Roof' || type === 'Floor' ? 'H' : 'N',
     area, uValue, solarFactor: 0, isOverride: false, color: 'Dark' } as unknown as EnvelopeElement);

describe('heating transmission — partitions and floors face a neighbour, not outdoors', () => {
  it('charges walls, roof and glass the FULL ΔT (they do face outdoors)', () => {
    const r = calculateHeatingLoad(room, [el('w', 'Wall', 100, 0.3)], dc);
    expect(r.transmissionLoss).toBeCloseTo(100 * 0.3 * DT, 6);   // 900
  });

  it('charges a partition 0.6 × ΔT', () => {
    const r = calculateHeatingLoad(room, [el('p', 'Partition', 100, 0.3)], dc);
    expect(r.transmissionLoss).toBeCloseTo(100 * 0.3 * DT * 0.6, 6);   // 540
  });

  it('charges a floor 0.5 × ΔT', () => {
    const r = calculateHeatingLoad(room, [el('f', 'Floor', 100, 0.3)], dc);
    expect(r.transmissionLoss).toBeCloseTo(100 * 0.3 * DT * 0.5, 6);   // 450
  });

  it('sums a mixed envelope correctly', () => {
    const r = calculateHeatingLoad(room, [
      el('w', 'Wall', 200, 0.35),
      el('rf', 'Roof', 200, 0.25),
      el('p', 'Partition', 400, 0.35),
      el('f', 'Floor', 200, 0.30),
    ], dc);
    const expected =
        200 * 0.35 * DT            // wall,  full
      + 200 * 0.25 * DT            // roof,  full
      + 400 * 0.35 * DT * 0.6      // partition
      + 200 * 0.30 * DT * 0.5;     // floor
    expect(r.transmissionLoss).toBeCloseTo(expected, 6);
  });

  // ── The invariant ────────────────────────────────────────────────────────────────────
  // Derive the fraction each season actually applies and require them to agree. Cooling's
  // comes straight out of getCLTD (Partition -> 0.6·ΔT, Floor -> 0.5·ΔT); heating's is
  // recovered by dividing the loss by U·A·ΔT. If someone tunes one side, this fails.
  it.each([
    ['Partition', 0.6],
    ['Floor', 0.5],
  ])('%s uses the same fraction in heating as in cooling', (type, expectedFraction) => {
    const coolingDT = 20;
    const coolingFraction = getCLTD('N' as any, type as any, coolingDT, 0) / coolingDT;
    expect(coolingFraction).toBeCloseTo(expectedFraction, 6);

    const r = calculateHeatingLoad(room, [el('x', type, 100, 0.3)], dc);
    const heatingFraction = r.transmissionLoss / (100 * 0.3 * DT);
    expect(heatingFraction).toBeCloseTo(coolingFraction, 6);
  });
});
