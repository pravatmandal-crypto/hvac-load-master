/**
 * Regression net for the R85 → R86 report fixes shipped 2026-07-04 (commit d0f999b).
 *
 * These lock the ROOT-CAUSE behavior of three client-facing bugs so a future refactor
 * (the planned Step-2 consolidation of the duplicated calc glue) cannot silently
 * re-introduce them. Each test cites the fix it guards.
 *
 * Ground rules for these numbers: they are derived by hand from the ASHRAE constants
 * (1.08 sensible, 0.68 latent, 60 CFM/ACH, 7000 grains/lb) — not copied from program
 * output — so they are an independent check, not a tautology.
 */
import { describe, it, expect } from 'vitest';
import {
  calculateHeatingLoad,
  calculateSingleElementGain,
  getCLTD,
  type RoomDetails,
  type DesignConditions,
  type EnvelopeElement,
} from '@/lib/hvac';
import { computePlantRequiredTR } from '@/services/reportService';

// A plain 20 ft × 10 ft × 10 ft room = 2000 ft³. facph = 2 ACH designed fresh air.
const room = (over: Partial<RoomDetails> = {}): RoomDetails => ({
  id: 'r1',
  name: 'Test Room',
  floor: 'GF',
  length: 20,
  width: 10,
  height: 10,
  facph: 2,
  peopleCount: 0,
  lightsWattsPerSqft: 0,
  equipmentKW: 0,
  othersKW: 0,
  ...over,
});

describe('R85 fix #6 — DOAS winter heating uses infiltration ACH, not facph', () => {
  // Volume 2000 ft³, ΔT = 70 − 40 = 30 °F.
  //   facph 2 ACH        → 2000·2/60      = 66.667 CFM → 1.08·66.667·30 = 2160 BTU/h
  //   infiltration 0.5   → 2000·0.5/60    = 16.667 CFM → 1.08·16.667·30 =  540 BTU/h
  const design: DesignConditions = {
    outdoorTemp: 95,
    indoorTemp: 75,
    outdoorHumidity: 55,
    indoorHumidity: 50,
    winterOutdoorTemp: 40,
    winterIndoorTemp: 70,
  };

  it('a non-DOAS space heats the FULL designed fresh air (facph)', () => {
    const r = calculateHeatingLoad(room(), [], { ...design, ventilationStrategy: 'primary' });
    expect(r.ventilationHeating).toBeCloseTo(2160, 2);
  });

  it('a DOAS/TFA space heats only infiltration (0.5 ACH) — the DOAS tempers the OA', () => {
    const r = calculateHeatingLoad(room(), [], { ...design, ventilationStrategy: 'tfa-cold' });
    expect(r.ventilationHeating).toBeCloseTo(540, 2);
  });

  it('the DOAS space heating is exactly the infiltration share, NOT the facph share', () => {
    const doas = calculateHeatingLoad(room(), [], { ...design, ventilationStrategy: 'tfa-cold' });
    const nonDoas = calculateHeatingLoad(room(), [], { ...design, ventilationStrategy: 'primary' });
    // The bug double-counted the full 2 ACH on the DOAS space; the fix uses 0.5 ACH.
    expect(doas.ventilationHeating).toBeLessThan(nonDoas.ventilationHeating);
    expect(doas.ventilationHeating / nonDoas.ventilationHeating).toBeCloseTo(0.5 / 2, 4);
  });

  it('honours an explicit winterInfiltrationACH override', () => {
    // 1.0 ACH → 2000·1/60 = 33.333 CFM → 1.08·33.333·30 = 1080 BTU/h
    const r = calculateHeatingLoad(room(), [], {
      ...design,
      ventilationStrategy: 'tfa-cold',
      winterInfiltrationACH: 1.0,
    });
    expect(r.ventilationHeating).toBeCloseTo(1080, 2);
  });
});

describe('R85 fix #4 — opaque CLTD display reconciles with conduction (U·A·CLTD == Cond)', () => {
  const design: DesignConditions = {
    outdoorTemp: 95,
    indoorTemp: 78,
    outdoorHumidity: 55,
    indoorHumidity: 50,
    dailyRange: 20,
    designMonth: 7,
  };

  it('an auto (non-override) opaque wall uses the ASHRAE-corrected CLTD, ignoring the stale solarFactor', () => {
    // solarFactor is deliberately a garbage value; the engine must NOT use it for an auto element.
    const el: EnvelopeElement = {
      id: 'w1',
      type: 'Wall',
      orientation: 'W',
      area: 100,
      uValue: 0.35,
      solarFactor: 999, // stale/uncorrected — the R85 bug printed THIS in the CLTD column
      isOverride: false,
    };
    const autoCLTD = getCLTD('W', 'Wall', design.outdoorTemp - design.indoorTemp, 0, {
      indoorTemp: design.indoorTemp,
      outdoorMax: design.outdoorTemp,
      dailyRange: design.dailyRange,
      designMonth: design.designMonth,
    });
    const gain = calculateSingleElementGain(el, design);

    // The report's "effective CLTD" = conduction / (U·A). It MUST equal the CLTD the
    // conduction was actually computed from — that is the whole point of fix #4.
    const effectiveCLTD = gain.conduction / (el.uValue * el.area);
    expect(effectiveCLTD).toBeCloseTo(autoCLTD, 6);
    // And it must NOT be the stale 999 that the buggy display column showed.
    expect(effectiveCLTD).not.toBeCloseTo(999, 0);
  });

  it('an override opaque element reconciles to its overridden ΔT', () => {
    const el: EnvelopeElement = {
      id: 'w2',
      type: 'Wall',
      orientation: 'W',
      area: 100,
      uValue: 0.35,
      solarFactor: 25, // engineer override — conduction should use exactly this
      isOverride: true,
    };
    const gain = calculateSingleElementGain(el, design);
    expect(gain.conduction).toBeCloseTo(0.35 * 100 * 25, 6);
    expect(gain.conduction / (el.uValue * el.area)).toBeCloseTo(25, 6);
  });
});

describe('R85 fix #2 — plant TR with a chiller-fed TFA coil (the "47.84 TR" artifact)', () => {
  // Reproduces the exact GURT scenario: a Chiller with a 32 TR space AHU selected, a room
  // carrying 47.84 TR of un-diversified OA of which 42.05 TR is a SEPARATE chiller-fed DOAS
  // coil. The old code did indoorBasis = connected − oa (incl. TFA) → basis clamped to 0 →
  // plant = 47.84. The fix subtracts only the on-unit OA (oa − tfa = 5.79).
  const systems = [
    { id: 'sys1', type: 'Chiller', diversityFactor: 0.75, zones: [{ selection: { trCapacity: 32, quantity: 1 } }] },
  ];
  const flatRooms = [{ id: 'r1', systemId: 'sys1' }];
  const roomIndoorTR = new Map([['r1', 30]]);
  const roomNonDiverseTR = new Map([['r1', 47.84]]); // total OA on the plant
  const roomChillerTfaTR = new Map([['r1', 42.05]]); // the chiller-fed DOAS coil portion

  it('does NOT collapse to the 47.84 OA-only artifact', () => {
    const plant = computePlantRequiredTR(systems, flatRooms, roomIndoorTR, roomNonDiverseTR, roomChillerTfaTR);
    expect(plant).not.toBeCloseTo(47.84, 1);
    expect(plant).toBeGreaterThan(60);
  });

  it('gives the correct diversified basis ≈ 67.5 TR', () => {
    // onUnitOa = max(0, 47.84 − 42.05) = 5.79
    // indoorBasis = max(0, 32 − 5.79) = 26.21
    // plant = 26.21·0.75 + 47.84 = 67.4975
    const plant = computePlantRequiredTR(systems, flatRooms, roomIndoorTR, roomNonDiverseTR, roomChillerTfaTR);
    expect(plant).toBeCloseTo(67.4975, 3);
  });

  it('with no TFA coil, the whole OA is on-unit and the basis is unaffected by the TFA carve-out', () => {
    const noTfa = new Map([['r1', 0]]);
    const plant = computePlantRequiredTR(systems, flatRooms, roomIndoorTR, roomNonDiverseTR, noTfa);
    // onUnitOa = 47.84, indoorBasis = max(0, 32 − 47.84) = 0, plant = 0·0.75 + 47.84 = 47.84.
    // (This IS 47.84 here — correctly — because there is genuinely no separate DOAS unit.)
    expect(plant).toBeCloseTo(47.84, 2);
  });
});
