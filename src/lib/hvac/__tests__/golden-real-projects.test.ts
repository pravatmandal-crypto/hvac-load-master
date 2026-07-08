/**
 * Whole-project golden / characterization net.
 *
 * Three representative REAL rooms — one per system archetype — captured from the
 * 2026-07-03 production backup, each with the load breakdown the app persisted at
 * that time (`analysis.envelope / internal / ventilation`). We feed the same room +
 * envelope + design conditions back through the pure calc engine and assert it
 * reproduces those numbers to the cent.
 *
 * Purpose: this is the safety net for the planned Step-2 consolidation of the
 * duplicated calc glue (reportService / excelService / loadCalculationService /
 * airflowSchedule). If that refactor shifts ANY of these engine outputs, these
 * tests fail loudly against real client data instead of the drift reaching a PDF.
 *
 * The expected values are NOT hand-derived — they are what the shipping app actually
 * produced for these projects, so the test locks real behavior, not a re-derivation.
 *
 * Archetypes covered: single-AHU chiller (no DOAS) · DOAS/TFA chiller (tfa-cold) · VRF.
 */
import { describe, it, expect } from 'vitest';
import {
  calculateEnvelopeGain,
  calculateInternalGains,
  calculateVentilationLoad,
  type EnvelopeElement,
  type DesignConditions,
  type RoomDetails,
} from '@/lib/hvac';
import fixtures from './fixtures/real-project-rooms.json';

interface Fixture {
  project: string;
  archetype: string;
  label: string;
  systemType: string;
  room: RoomDetails;
  envelopeElements: EnvelopeElement[];
  designConditions: DesignConditions;
  expected: {
    envelope: { sensible: number; breakdown: Record<string, number> };
    internal: { sensible: number; latent: number } | null;
    ventilation: { sensible: number; latent: number } | null;
  };
}

// Real Firestore rooms carry a few extra keys (envelope elements use `_id`, string
// enums) the calc functions don't read — cast through `unknown` rather than reshape.
const cases = fixtures as unknown as Fixture[];

// Persisted analysis is rounded to 2 dp, so match to the cent.
const near = (got: number, exp: number) => expect(got).toBeCloseTo(exp, 2);

describe('golden: pure engine reproduces real persisted project loads', () => {
  it('has all three system archetypes', () => {
    const kinds = cases.map((f) => f.archetype);
    expect(kinds).toContain('single-ahu-chiller');
    expect(kinds).toContain('doas-tfa-chiller');
    expect(kinds).toContain('vrf');
  });

  for (const f of cases) {
    describe(`${f.archetype} — ${f.project} / ${f.room.name}`, () => {
      it('reproduces the envelope sensible gain and full breakdown', () => {
        const env = calculateEnvelopeGain(f.envelopeElements, f.designConditions);
        near(env.sensible, f.expected.envelope.sensible);
        for (const k of Object.keys(f.expected.envelope.breakdown)) {
          near((env.breakdown as Record<string, number>)[k], f.expected.envelope.breakdown[k]);
        }
      });

      it('reproduces the internal gains', () => {
        if (!f.expected.internal) return;
        const ig = calculateInternalGains(f.room);
        near(ig.sensible, f.expected.internal.sensible);
        near(ig.latent, f.expected.internal.latent);
      });

      it('reproduces the ventilation (outdoor-air) load', () => {
        if (!f.expected.ventilation) return;
        const v = calculateVentilationLoad(f.room, f.designConditions);
        near(v.sensible, f.expected.ventilation.sensible);
        near(v.latent, f.expected.ventilation.latent);
      });
    });
  }
});
