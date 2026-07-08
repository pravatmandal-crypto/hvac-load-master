/**
 * Characterization net for the shared per-room engine `computeRoomLoad` (Step-2, 2026-07-08).
 *
 * computeRoomLoad is now the SINGLE source of the envelope→internal→vent→TFA-credit→coil→
 * design-CFM sequence that reportService.computeDetailed and airflowSchedule.roomDesignCfm
 * both delegate to. This test feeds three real rooms (one per system archetype) from the
 * 2026-07-03 backup through it and asserts it reproduces the numbers the shipping app
 * persisted — so any future edit to the shared engine that shifts a real result fails here.
 *
 * Every asserted field was verified to reconcile with the persisted `analysis` at 0.000%
 * for the single-AHU and DOAS/TFA rooms (the VRF room's persisted `dehumidifiedCFM` is from
 * an older snapshot, so we pin the sizing-governing `minAdpSensibleCFM` instead, which does
 * match). These are real-data oracles, not program-output tautologies.
 */
import { describe, it, expect } from 'vitest';
import { computeRoomLoad } from '@/lib/hvac';
import type { DesignConditions, EnvelopeElement } from '@/lib/hvac';
import fixtures from './fixtures/real-project-roomload.json';

interface RLFixture {
  project: string;
  archetype: string;
  label: string;
  wantTfa: boolean;
  room: any;
  envelopeElements: EnvelopeElement[];
  baseDc: DesignConditions;
  equipSystems: any[];
  projectParams: { systemType: string; adpBasis: string | null; supplyBasis: string | null };
  expected: {
    coilSensible: number;
    coilLatent: number;
    grandTotalTR: number;
    selectedADP: number;
    minAdpSensibleCFM: number;
    tfa: { coilSensible: number; coilLatent: number; cfm: number } | null;
  };
}

const cases = fixtures as unknown as RLFixture[];

describe('computeRoomLoad reproduces real persisted per-room loads', () => {
  for (const f of cases) {
    describe(`${f.archetype} — ${f.project} / ${f.room.name}`, () => {
      const res = computeRoomLoad(f.room, f.envelopeElements, f.baseDc, {
        equipSystems: f.equipSystems,
        project: f.projectParams,
      });

      it('resolves the TFA/DOAS mode correctly', () => {
        expect(res.isTFA).toBe(f.wantTfa);
      });

      it('reproduces the space-coil sensible/latent load and governing TR', () => {
        expect(res.coilSensible).toBeCloseTo(f.expected.coilSensible, 2);
        expect(res.coilLatent).toBeCloseTo(f.expected.coilLatent, 2);
        expect(res.loadTr).toBeCloseTo(f.expected.grandTotalTR, 4);
      });

      it('reproduces the selected coil ADP and the sizing-governing CFM', () => {
        expect(res.coil.selectedADP).toBeCloseTo(f.expected.selectedADP, 2);
        expect(res.coil.minAdpSensibleCFM).toBeCloseTo(f.expected.minAdpSensibleCFM, 2);
      });

      if (f.expected.tfa) {
        it('reproduces the DOAS coil duty (sensible / latent / CFM)', () => {
          expect(res.tfaCoilSensible).toBeCloseTo(f.expected.tfa!.coilSensible, 2);
          expect(res.tfaCoilLatent).toBeCloseTo(f.expected.tfa!.coilLatent, 2);
          expect(res.tfaCfm).toBeCloseTo(f.expected.tfa!.cfm, 2);
        });
      } else {
        it('has no DOAS coil duty', () => {
          expect(res.tfaCoilSensible).toBe(0);
          expect(res.tfaCfm).toBe(0);
        });
      }
    });
  }
});
