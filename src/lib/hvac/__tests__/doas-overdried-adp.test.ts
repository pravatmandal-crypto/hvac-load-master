/**
 * DOAS-over-dried room: the ADP must ride the room's ACTUAL humidity (2026-08-02).
 *
 * A TFA-served room that still has its own space coil can end up with the cold DOAS supply
 * removing MORE moisture than the room generates. `coilLatent` then floors at 0, the space
 * coil is purely sensible, and the room settles below design RH — computeRoomLoad already
 * computed and reported that floated humidity.
 *
 * But the float was never fed back into the ADP solver: `calculateCoilParameters` was still
 * anchored at `dc.indoorHumidity`. On a purely sensible coil (RSHF = 1) the ESHF line is
 * horizontal, so the ADP lands exactly on the room DEWPOINT — which means anchoring at the
 * wrong humidity moves the ADP degree-for-degree, and the airflow with it.
 *
 * TEZPUR GURT / Missile Testing was the anchor case: settles at 45.5 % RH (dewpoint 52.6 °F)
 * against a 60 % RH design (dewpoint 60.2 °F). ADP printed 60 °F where 53 °F is correct, and
 * the airflow riding it printed 7,159 CFM against 4,881 — a 47 % over-supply on the largest
 * room in the project, and the reason it showed 846 CFM/TR against a 350–450 norm.
 *
 * These are physics/algebra checks, not program echoes:
 *   • the sensible closure 1.08·(1−BF)·CFM·(Troom − ADP) = ERSH is pure arithmetic;
 *   • the regression guard re-solves the SAME coil at design RH and requires the two to
 *     differ, so reverting the plumbing fails here even though the ADP value itself is
 *     produced by the psychrometric search.
 *
 * Asserting the ADP alone would NOT be enough — the same omission class as
 * `calculateSingleElementGain` not forwarding `decrementFactor`: the read-out can move while
 * the sizing silently does not. So the airflow is asserted too.
 */
import { describe, it, expect } from 'vitest';
import { computeRoomLoad, calculateCoilParameters, getMinAdp, ROOM_LOAD_BF } from '@/lib/hvac';
import { computeAirflowSplit } from '@/lib/hvac/supplyCfm';
import type { DesignConditions, EnvelopeElement } from '@/lib/hvac';

const dc: DesignConditions = {
  outdoorTemp: 94, indoorTemp: 75, outdoorHumidity: 59, indoorHumidity: 60,
  altitude: 259, latitude: 26.6, longitude: 92.8,
  winterOutdoorTemp: 57, winterOutdoorHumidity: 80, winterIndoorTemp: 72, winterIndoorHumidity: 50,
  includeWinter: false,
} as unknown as DesignConditions;

const equipSystems = [{
  id: 'doas-1', type: 'DOAS', tfaSupplyTemp: 55, tfaSupplyHumidity: 90,
  ervSensibleEffectiveness: 0, ervLatentEffectiveness: 0,
}];
const project = { systemType: 'Chiller', adpBasis: undefined, supplyBasis: undefined };

/**
 * Envelope shaped like the anchor case. It has to be REAL: with no envelope the room's whole
 * sensible load is smaller than the cold-DOAS supply credit (1.08 × 3,833 × 20 = 82,800 BTU/h),
 * `coilSensible` floors at 0 and there is no coil left to size — the regime under test only
 * exists once the envelope pushes ERSH clear of that credit.
 */
const el = (
  id: string, type: string, orientation: string, area: number, uValue: number, shgc?: number,
): EnvelopeElement => ({
  id, type, orientation, area, uValue, solarFactor: 0, isOverride: false, color: 'Dark',
  ...(shgc === undefined ? {} : { shgc }),
} as unknown as EnvelopeElement);

const envelope: EnvelopeElement[] = [
  el('roof', 'Roof', 'H', 5750, 0.3),
  el('floor', 'Floor', 'H', 5750, 0.3),
  el('w-ne', 'Wall', 'NE', 2048, 0.35),
  el('w-sw', 'Wall', 'SW', 2048, 0.35),
  el('w-se', 'Wall', 'SE', 500, 0.35),
];

/**
 * Large hall on a central DOAS, shaped like Missile Testing: big volume drives a large FACFM
 * at 2 ACPH, while only a handful of occupants generate latent — so the DOAS dry-air surplus
 * swamps the room latent gain and the space coil carries none.
 * `recircPct: 50` is the TEZPUR GURT client rule (FA fixed at 2 ACPH, recirc ≥ 50 % a floor).
 */
const hall: any = {
  id: 'hall-1', name: 'Test Hall', floor: 'Ground',
  length: 115, width: 50, height: 20,
  facph: 2, recircPct: 50, peopleCount: 5, activityType: 'factory_light',
  lightsWattsPerSqft: 1, equipmentKW: 0.25, othersKW: 0,
  sensibleSafetyPercent: 10, latentSafetyPercent: 5, overallSafetyPercent: 3,
  ductGainPct: 2, fanGainPct: 3,
  tfaMode: 'tfa-served', doasId: 'doas-1',
};

describe('DOAS-over-dried room — ADP rides the floated humidity', () => {
  const res = computeRoomLoad(hall, envelope, dc, { equipSystems, project });

  it('is the regime under test: TFA-served, own coil, zero coil latent', () => {
    expect(res.isTFA).toBe(true);
    expect(res.isTfaOnly).toBe(false);
    expect(res.tfaCfm).toBeGreaterThan(0);
    expect(res.coilLatent).toBe(0);           // DOAS removes more moisture than the room makes
    expect(res.coilSensible).toBeGreaterThan(0);
  });

  it('floats the room BELOW design humidity', () => {
    expect(res.floatIndoorRH).not.toBeNull();
    expect(res.floatIndoorRH!).toBeLessThan(dc.indoorHumidity);
    expect(res.floatIndoorTemp).toBeNull();   // the space coil still holds temperature
  });

  it('float humidity closes the latent balance: 0.68·TFACFM·ΔW·7000 ≈ ERLH', () => {
    // W_room = W_doas + ERLH / (0.68 · TFACFM · 7000)
    const dWGrains = res.erlh / (0.68 * res.tfaCfm);
    expect(dWGrains).toBeGreaterThan(0);
    expect(dWGrains).toBeLessThan(5);         // a small surplus — the room is barely above supply
  });

  // ── The regression guard ────────────────────────────────────────────────────────────
  // Re-solve the identical coil anchored at DESIGN humidity. If the float ever stops
  // reaching calculateCoilParameters, `res.coil` collapses onto `atDesignRH` and this fails.
  const adpSensible = Math.max(0, res.ersh - res.tfaOffSen);
  const adpLatent = Math.max(0, res.erlh - res.tfaOffLat);
  const atDesignRH = calculateCoilParameters(
    adpSensible, adpLatent, dc.indoorTemp, dc.indoorHumidity, dc.altitude,
    ROOM_LOAD_BF, 35, 65, getMinAdp(project.systemType, project.adpBasis),
  );

  it('solves the ADP at the FLOATED state, not the design state', () => {
    expect(res.coil.selectedADP).toBeLessThan(atDesignRH.selectedADP);
    // Drier room ⇒ lower dewpoint ⇒ colder ADP. Several °F, not a rounding wobble.
    expect(atDesignRH.selectedADP - res.coil.selectedADP).toBeGreaterThanOrEqual(3);
  });

  it('the AIRFLOW moves with it — asserting the ADP alone would pass while sizing is stale', () => {
    expect(res.designCfm).toBeLessThan(atDesignRH.dehumidifiedCFM);
    expect(res.designCfm / atDesignRH.dehumidifiedCFM).toBeLessThan(0.85); // >15 % less air
  });

  it('sensible closure holds at the selected ADP: 1.08·(1−BF)·CFM·(Troom − ADP) = ERSH', () => {
    const closure = 1.08 * (1 - ROOM_LOAD_BF) * res.designCfm * (dc.indoorTemp - res.coil.selectedADP);
    expect(closure).toBeCloseTo(adpSensible, 0);
  });

  it('leaves TR untouched — the ADP moves air, never load', () => {
    expect(res.loadTr).toBeCloseTo((res.coilSensible + res.coilLatent) / 12000, 10);
    expect(res.loadTr).toBeCloseTo(res.coilSensible / 12000, 10); // coilLatent === 0 here
  });

  // TEZPUR GURT client rule: FA fixed at 2 ACPH, recirculation ≥ 50 % is a FLOOR. Cutting the
  // airflow must not breach it — on the real project this lands at 56 %, so the floor is slack,
  // but a further ADP change could push it and that must fail loudly rather than ship.
  it('keeps recirculation at or above the 50 % floor', () => {
    const split = computeAirflowSplit({
      designSupplyCFM: res.designCfm, freshAirCFM: res.freshAirCFM,
      tfaCfm: res.tfaCfm, isTFA: res.isTFA, isTfaOnly: res.isTfaOnly,
    });
    const recircShare = split.recircCFM / split.totalSupplyCFM;
    expect(recircShare).toBeGreaterThanOrEqual(0.5);
  });

  it('does NOT disturb a TFA room whose space coil still carries latent', () => {
    // Crowd the same hall: people latent now exceeds the DOAS dry-air surplus, so the room
    // holds design RH and must anchor there exactly as before.
    const crowded = computeRoomLoad({ ...hall, peopleCount: 400 }, envelope, dc, { equipSystems, project });
    expect(crowded.coilLatent).toBeGreaterThan(0);
    expect(crowded.floatIndoorRH).toBeNull();
    const asDesigned = calculateCoilParameters(
      Math.max(0, crowded.ersh - crowded.tfaOffSen), Math.max(0, crowded.erlh - crowded.tfaOffLat),
      dc.indoorTemp, dc.indoorHumidity, dc.altitude,
      ROOM_LOAD_BF, 35, 65, getMinAdp(project.systemType, project.adpBasis),
    );
    expect(crowded.coil.selectedADP).toBe(asDesigned.selectedADP);
  });

  it('does NOT disturb a room with no DOAS at all', () => {
    const plain = computeRoomLoad({ ...hall, tfaMode: 'no-tfa', doasId: undefined }, envelope, dc, { equipSystems, project });
    expect(plain.floatIndoorRH).toBeNull();
    const asDesigned = calculateCoilParameters(
      plain.ersh, plain.erlh, dc.indoorTemp, dc.indoorHumidity, dc.altitude,
      ROOM_LOAD_BF, 35, 65, getMinAdp(project.systemType, project.adpBasis),
    );
    expect(plain.coil.selectedADP).toBe(asDesigned.selectedADP);
  });
});
