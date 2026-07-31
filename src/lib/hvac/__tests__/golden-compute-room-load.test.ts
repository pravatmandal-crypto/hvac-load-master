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
 *
 * ── ADP/CFM expectations re-derived by hand 2026-07-31 ──────────────────────────────
 * The ESHF fix (ADP + dehumidified air quantity now ride the EFFECTIVE ROOM loads, not the
 * coil totals — see psychrometrics.calculateCoilParameters) moved three values. They were
 * re-derived from the ASHRAE constants, NOT re-baselined to program output:
 *
 *   UWO Office — 20×18×10.5 = 3780 ft³, facph 1.5 → 94.5 CFM OA, ΔT = 94−72 = 22 °F, BF 0.15
 *     OA sensible (unbypassed) = 1.08 · 94.5 · 22 · 0.85              = 1908.52
 *     ERSH  = coilSensible 18016.474 − 1908.52                        = 16107.95
 *     minAdpSensibleCFM = 16107.95 / (1.08 · 18 · 0.85)               =  974.8216  [was 1090.32]
 *     (the 18 °F = 72 − 54 independently confirms comfort ADP 54 and BF 0.15)
 *
 *   Bar Area — 18×12×17 = 3672 ft³, 91.8 CFM OA, ΔT = 86−75 = 11 °F, P = 13.395 psia @ 2543 ft
 *     ERSH = 9445.32 − (1.08 · 91.8 · 11 · 0.85)    = 9445.32 − 927.0   = 8518.32
 *     ERLH = 4373.64 − (0.68 · 91.8 · 57.16 · 0.85) = 4373.64 − 3033.0  = 1340.6
 *     ESHF = 8518.32 / 9858.92                                          = 0.864
 *     ESHF line from (75 °F, W 0.011184) meets saturation at 56.06 °F → selectedADP 56 [was 51]
 *     minAdpSensibleCFM = 8518.32 / (1.08 · 33 · 0.85)                  = 281.1885  [was 311.79]
 *     Cross-check: the OLD GSHF 0.684 reproduces 51.36 → 51, confirming the construction.
 *
 *   COO ORD (DOAS/TFA) is unchanged at ADP 51 — on a TFA room the space-coil load already
 *   EQUALS the effective room load (OA is on the DOAS), so the fix is a mathematical no-op
 *   there. That it did NOT move is itself a check on the fix.
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
