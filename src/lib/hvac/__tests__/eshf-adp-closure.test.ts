/**
 * Closure net for the ADP / dehumidified-airflow construction (added 2026-07-31).
 *
 * THE INVARIANT THIS GUARDS. The supply air produced by the design airflow must remove
 * the room load on BOTH axes at once:
 *
 *     1.08 · cfm · (1−BF) · (t_room − ADP)            == ERSH
 *     0.68 · cfm · (1−BF) · (W_room − W_ADP) · 7000   == ERLH
 *
 * with the SAME cfm. That can only hold when the ADP lies on the ESHF line drawn from the
 * ROOM state — which is exactly the Carrier construction. It is a physical identity, not a
 * captured number, so it stays valid no matter how the engine is refactored.
 *
 * WHY IT EXISTS. Callers used to hand `calculateCoilParameters` the COIL totals (GSHF), which
 * anchored the wrong slope at the room point and drove the ADP several °F too cold. The airflow
 * then closed on sensible and over-delivered latent by >150 % — wrong in OPPOSITE directions,
 * which is the fingerprint of an off-ESHF-line ADP. No existing test caught it because every
 * assertion pinned a single quantity rather than the relationship between them. Report
 * HLM-TEZ-2LAL R0 shipped to a client with airflows ~30 % low as a result.
 *
 * Anchor case: TEZPUR, GURT COMPLEX - B / CO Room, summer (HLM-TEZ-2LAL R0 pp. 5-7).
 */
import { describe, it, expect } from 'vitest';
import { calculateCoilParameters, calculatePsychrometrics } from '@/lib/hvac';
import { resolveSupplyCfm } from '@/lib/hvac/supplyCfm';

const T_ROOM = 75, RH_ROOM = 60, ALT = 259, BF = 0.15, MIN_ADP = 44;
const CF = 1 - BF;

// CO Room, summer. Effective room loads (post-safety) vs coil loads (= ER + unbypassed OA).
const ERSH = 15859, ERLH = 2317;
const COIL_SENSIBLE = 17892, COIL_LATENT = 6744;

const coilFor = (s: number, l: number) =>
  calculateCoilParameters(s, l, T_ROOM, RH_ROOM, ALT, BF, 35, 65, MIN_ADP);

/** Latent the dehumidified air quantity actually delivers at the indicated ADP. */
const latentDeliveredAt = (indicatedADP: number) => {
  const roomW = calculatePsychrometrics(T_ROOM, RH_ROOM, ALT).humidityRatio;
  const adpW = calculatePsychrometrics(indicatedADP, 100, ALT).humidityRatio;
  const cfm = ERSH / (1.08 * CF * (T_ROOM - indicatedADP)); // sized on sensible
  return 0.68 * cfm * CF * (roomW - adpW) * 7000;
};

describe('ADP rides the ESHF line from the room state', () => {
  it('closes on sensible AND latent with a single airflow when fed effective room loads', () => {
    const c = coilFor(ERSH, ERLH);
    const delivered = latentDeliveredAt(c.indicatedADP);
    // Residual is the 0.1 °F ADP search grid, not a modelling error.
    expect(Math.abs(delivered / ERLH - 1)).toBeLessThan(0.05);
  });

  it('puts the ADP near 58.8 °F for CO Room, not the 55.9 °F R0 printed', () => {
    // Hand-derived: ESHF = 15859/18176 = 0.8725; that line meets saturation at ~58.8 °F.
    expect(coilFor(ERSH, ERLH).indicatedADP).toBeGreaterThan(58.0);
    expect(coilFor(ERSH, ERLH).indicatedADP).toBeLessThan(59.5);
  });

  it('REGRESSION: feeding coil totals (GSHF) breaks latent closure — the shipped R0 bug', () => {
    const wrong = coilFor(COIL_SENSIBLE, COIL_LATENT);
    expect(wrong.indicatedADP).toBeLessThan(56.5); // too cold
    // Sensible still closes (airflow is sized on it) but latent runs away.
    expect(latentDeliveredAt(wrong.indicatedADP) / ERLH).toBeGreaterThan(1.5);
  });
});

describe('supply airflow is never below the thermal requirement', () => {
  const base = {
    isTFA: false,
    isTfaOnly: false,
    freshAirCFM: 117,
    tfaCfm: 0,
    minAdpSensibleCFM: 629, // the 44 °F-ADP reference quantity R0 mistakenly designed to
  };

  it('the ACH basis floors on the dehumidified quantity, not the min-ADP reference', () => {
    const c = coilFor(ERSH, ERLH);
    const r = resolveSupplyCfm({
      ...base,
      basis: 'ach',
      dehumidifiedCFM: c.dehumidifiedCFM,
      totalSupplyCFM: 233, // 4 ACPH client preset — below the thermal need
    });
    expect(r.designSupplyCFM).toBeCloseTo(c.dehumidifiedCFM, 2);
    expect(r.designSupplyCFM).toBeGreaterThan(base.minAdpSensibleCFM);
  });

  it('the air-change preset still governs when it exceeds the thermal requirement', () => {
    const r = resolveSupplyCfm({
      ...base,
      basis: 'ach',
      dehumidifiedCFM: 400,
      totalSupplyCFM: 1500, // a high-ACH space (e.g. a lab) — preset wins
    });
    expect(r.designSupplyCFM).toBeCloseTo(1500, 2);
  });
});
