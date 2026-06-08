/**
 * loadCalculationService — pure calculation + Firestore persistence.
 *
 * Extracted from LoadCalculator.persistRoomAnalysisSnapshot so that the new
 * unified HvacSystems component (Phase 2) and the existing LoadCalculator can
 * both call it without duplicating logic.
 *
 * No React state — callers update local state from the returned RoomCalcResult.
 */

import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  calculateEnvelopeGain,
  calculateInternalGains,
  calculateVentilationLoad,
  calculateParasiticGains,
  calculateHeatingLoad,
  calculatePsychrometrics,
  calculateCoilParameters,
  calculateRoomVolume,
  calculateReheat,
  calculateTFALoad,
  getRecommendedAch,
  getMinAdp,
  resolveSupplyCfm,
  type SupplyCfmBasis,
  type RoomDetails,
} from '../lib/hvac';
import { EnvelopeElement } from '../lib/hvac/constants';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface RoomCalcDesignConditions {
  outdoorTemp: number;
  indoorTemp: number;
  outdoorHumidity: number;
  indoorHumidity: number;
  altitude: number;
  latitude?: number;
  longitude?: number;
  winterOutdoorTemp: number;
  winterOutdoorHumidity: number;
  winterIndoorTemp?: number;
  winterIndoorHumidity?: number;
  winterInfiltrationACH?: number;
  includeWinter?: boolean;
  monsoonOutdoorTemp?: number;
  monsoonOutdoorHumidity?: number;
  // TFA / DOAS — undefined or 'primary' = current behavior (bit-identical).
  ventilationStrategy?: 'primary' | 'tfa-cold';
  tfaSupplyTemp?: number;
  tfaSupplyHumidity?: number;
  ervSensibleEffectiveness?: number;
  ervLatentEffectiveness?: number;
}

export interface RoomCalcResult {
  // Firestore fields written to the room doc
  analysis: any;
  totalLoadBTUH: number;
  totalLoadTR: number;
  dehumidifiedCFM: number;
  designSupplyCFM: number;
  _calcLoadTR: number;
  _calcCfmTR: number;
  _calcGoverningTR: number;
  _calcRequiredTR: number;
  _calcDesignCFM: number;
  _calcSensibleBTUH: number;
  _calcLatentBTUH: number;
  _calcMonsoonLoadTR: number;
  _calcMonsoonCfmTR: number;
  _calcMonsoonGoverningTR: number;
  _calcMonsoonRequiredTR: number;
  _calcMonsoonDesignCFM: number;
  _calcOverallGoverningTR: number;
  _calcOverallRequiredTR: number;
  _calcOverallDesignCFM: number;
  // Supply-air basis read-out
  _calcSupplyCfmBasis: SupplyCfmBasis;
  _calcDscfmBasisCFM: number;
  _calcAchBasisCFM: number;
  _calcFreshAirCFM: number;
  // TFA / DOAS — populated only when ventilationStrategy === 'tfa-cold'.
  // Primary numbers above reflect the post-offset primary load. These fields
  // are sized off the separate TFA/DOAS coil.
  _calcTfaCoilBTUH?: number;
  _calcTfaCoilTR?: number;
  _calcTfaCfm?: number;
  _calcMonsoonTfaCoilBTUH?: number;
  _calcMonsoonTfaCoilTR?: number;
  _calcTfaWinterHeatingBTUH?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────


// ─── Main exported function ───────────────────────────────────────────────────

/**
 * Calculates all load metrics for a single room and persists them to Firestore.
 *
 * @param projectId  Firestore project document ID
 * @param roomId     Firestore room document ID
 * @param room       Room parameter object (dimensions, occupancy, etc.)
 * @param elements   Envelope elements for this room
 * @param dc         Resolved design conditions (summer + winter + optional monsoon)
 * @param systemType System type string used for ADP selection ('Chiller', 'VRF', etc.)
 * @returns          All computed metrics — caller merges into local state as needed
 */
export async function calculateAndPersistRoom(
  projectId: string,
  roomId: string,
  room: any,
  elements: EnvelopeElement[],
  dc: RoomCalcDesignConditions,
  systemType?: string,
): Promise<RoomCalcResult> {
  const rd: RoomDetails = {
    id: room.id,
    name: room.name ?? '',
    floor: room.floor ?? 'Ground',
    length: Number(room.length) || 0,
    width: Number(room.width) || 0,
    height: Number(room.height) || 0,
    hasFalseCeiling: room.hasFalseCeiling ?? false,
    falseCeilingHeight: Number(room.falseCeilingHeight) || 0,
    facph: Number(room.facph) || 0,
    peopleCount: Number(room.peopleCount) || 0,
    activityType: room.activityType ?? 'office',
    lightsWattsPerSqft: Number(room.lightsWattsPerSqft) || 0,
    equipmentKW: Number(room.equipmentKW) || 0,
    othersKW: Number(room.othersKW) || 0,
    isGroundFloor: !!room.isGroundFloor,
    slabPerimeter: Number(room.slabPerimeter) || 0,
    ...(Number(room.slabFFactor) > 0 ? { slabFFactor: Number(room.slabFFactor) } : {}),
  };

  const bf = 0.15;
  const ductPct = Number(room.ductGainPct) || 2;
  const fanPct = Number(room.fanGainPct) || 3;
  const sensibleSafetyPct = Number(room.sensibleSafetyPercent ?? room.sensibleSafetyFactor ?? 10);
  const latentSafetyPct = Number(room.latentSafetyPercent ?? room.latentSafetyFactor ?? 5);
  const overallSafetyPct = Number(room.overallSafetyPercent ?? room.grandTotalSafetyFactor ?? 3);
  const minAdp = getMinAdp(systemType);

  // ── Strategy: primary (default, current behavior) vs tfa-cold ────────────
  // When TFA/DOAS is active, OA is conditioned by a separate unit. The
  // primary coil sees no raw OA; instead the cold dry supply offsets a
  // portion of the room load.
  const isTFA = dc.ventilationStrategy === 'tfa-cold';

  // ── Summer calc ───────────────────────────────────────────────────────────
  const envelope = calculateEnvelopeGain(elements, dc);
  const internal = calculateInternalGains(rd);
  const vent = calculateVentilationLoad(rd, dc);
  const tfa = isTFA ? calculateTFALoad(rd, dc) : null;
  const heating = dc.includeWinter ? calculateHeatingLoad(rd, elements, dc) : null;
  // Apply same overall safety factor that cooling pipeline uses, so heating output
  // mirrors the cooling-side margin. Stored alongside the raw value for transparency.
  const heatingTotalWithSafety = heating
    ? heating.totalHeatingLoad * (1 + overallSafetyPct / 100)
    : 0;

  // Bypass-OA model only applies when OA enters the primary coil.
  // TFA mode: OA bypasses the primary entirely → zero ventilation in ER and OA legs.
  const erVentSensible = isTFA ? 0 : vent.sensible * bf;
  const erVentLatent = isTFA ? 0 : vent.latent * bf;
  const erSensible = envelope.sensible + internal.sensible + erVentSensible;
  const erLatent = internal.latent + erVentLatent;
  const parasitic = calculateParasiticGains(erSensible, erSensible, ductPct, fanPct);

  const ershRaw = erSensible + parasitic.ductGain + parasitic.fanGain;
  const erlhRaw = erLatent;
  const ersh = ershRaw * (1 + sensibleSafetyPct / 100);
  const erlh = erlhRaw * (1 + latentSafetyPct / 100);
  const erh = ersh + erlh;
  const oaSensible = isTFA ? 0 : vent.sensible * (1 - bf);
  const oaLatent = isTFA ? 0 : vent.latent * (1 - bf);
  const oaTotal = oaSensible + oaLatent;
  // Cold-DOAS credit (engineering-correct, per locked decision 5).
  const tfaOffsetSensible = tfa ? tfa.spaceSensibleOffset : 0;
  const tfaOffsetLatent = tfa ? tfa.spaceLatentOffset : 0;
  const coilSensible = isTFA
    ? Math.max(0, ersh - tfaOffsetSensible)
    : ersh + oaSensible;
  const coilLatent = isTFA
    ? Math.max(0, erlh - tfaOffsetLatent)
    : erlh + oaLatent;
  const grandTotal = isTFA ? coilSensible + coilLatent : erh + oaTotal;
  const grandTotalTR = grandTotal / 12000;
  const rshf = coilSensible > 0 ? coilSensible / Math.max(1, coilSensible + coilLatent) : 1;

  const coil = calculateCoilParameters(
    coilSensible, coilLatent,
    dc.indoorTemp, dc.indoorHumidity, dc.altitude || 0,
    bf, 35, 65, minAdp,
  );

  const presetTotalACH = getRecommendedAch(room.achProfile ?? room.activityType);
  const totalSupplyACH = Math.max(presetTotalACH, rd.facph);
  const totalSupplyCFM = (calculateRoomVolume(rd) * totalSupplyACH) / 60;
  // Fresh-air (OA) the room introduces — used to floor the space AHU under the DSCFM basis.
  const freshAirCFM = (calculateRoomVolume(rd) * rd.facph) / 60;
  // Supply-air basis: 'dscfm' (default, Carrier/ASHRAE dehumidified-air) vs 'ach' (legacy
  // ACH-preset). The DOAS is independent of this — it always sizes off the OA FACPH.
  const supplyCfmBasis: SupplyCfmBasis = room.supplyCfmBasis === 'dscfm' ? 'dscfm' : 'ach';
  const supply = resolveSupplyCfm({
    basis: supplyCfmBasis,
    isTFA,
    isTfaOnly: false,
    dehumidifiedCFM: coil.dehumidifiedCFM,
    minAdpSensibleCFM: coil.minAdpSensibleCFM,
    totalSupplyCFM,
    freshAirCFM,
    tfaCfm: tfa?.cfm ?? 0,
  });
  const designSupplyCFM = supply.designSupplyCFM;
  // cfmTR is a SANITY RATIO only — kept for display/warning. It does NOT
  // govern plant sizing. The 400 CFM/TR rule is rule-of-thumb air-system
  // sizing; OEM unit ratings already enforce the TR↔CFM coupling, and
  // chiller plants are sized by coil load only. (Decision: 2026-05-20.)
  const cfmTR = designSupplyCFM / 400;
  const governingTR = grandTotalTR;
  const requiredTR = grandTotalTR * (1 + overallSafetyPct / 100);

  // ── Monsoon calc ─────────────────────────────────────────────────────────
  const hasMonsoon = !!(dc.monsoonOutdoorTemp && dc.monsoonOutdoorHumidity);
  const monsoonDc = {
    ...dc,
    outdoorTemp: dc.monsoonOutdoorTemp ?? dc.outdoorTemp,
    outdoorHumidity: dc.monsoonOutdoorHumidity ?? dc.outdoorHumidity,
  };
  const monsoonEnvelope = calculateEnvelopeGain(elements, monsoonDc);
  const monsoonVent = calculateVentilationLoad(rd, monsoonDc);
  const monsoonTfa = isTFA ? calculateTFALoad(rd, monsoonDc) : null;
  const monsoonErVentSensible = isTFA ? 0 : monsoonVent.sensible * bf;
  const monsoonErVentLatent = isTFA ? 0 : monsoonVent.latent * bf;
  const monsoonErSensible = monsoonEnvelope.sensible + internal.sensible + monsoonErVentSensible;
  const monsoonErLatent = internal.latent + monsoonErVentLatent;
  const monsoonParasitic = calculateParasiticGains(monsoonErSensible, monsoonErSensible, ductPct, fanPct);
  const monsoonErshRaw = monsoonErSensible + monsoonParasitic.ductGain + monsoonParasitic.fanGain;
  const monsoonErsh = monsoonErshRaw * (1 + sensibleSafetyPct / 100);
  const monsoonErlh = monsoonErLatent * (1 + latentSafetyPct / 100);
  const monsoonOaSensible = isTFA ? 0 : monsoonVent.sensible * (1 - bf);
  const monsoonOaLatent = isTFA ? 0 : monsoonVent.latent * (1 - bf);
  const monsoonTfaOffsetSen = monsoonTfa ? monsoonTfa.spaceSensibleOffset : 0;
  const monsoonTfaOffsetLat = monsoonTfa ? monsoonTfa.spaceLatentOffset : 0;
  const monsoonCoilSen = isTFA
    ? Math.max(0, monsoonErsh - monsoonTfaOffsetSen)
    : monsoonErsh + monsoonOaSensible;
  const monsoonCoilLat = isTFA
    ? Math.max(0, monsoonErlh - monsoonTfaOffsetLat)
    : monsoonErlh + monsoonOaLatent;
  const monsoonGrandTotal = monsoonCoilSen + monsoonCoilLat;
  const monsoonGrandTotalTR = monsoonGrandTotal / 12000;
  const monsoonCoilParams = calculateCoilParameters(
    monsoonCoilSen, monsoonCoilLat,
    dc.indoorTemp, dc.indoorHumidity, dc.altitude || 0,
    bf, 35, 65, minAdp,
  );
  const monsoonSupply = resolveSupplyCfm({
    basis: supplyCfmBasis,
    isTFA,
    isTfaOnly: false,
    dehumidifiedCFM: monsoonCoilParams.dehumidifiedCFM,
    minAdpSensibleCFM: monsoonCoilParams.minAdpSensibleCFM,
    totalSupplyCFM,
    freshAirCFM,
    tfaCfm: monsoonTfa?.cfm ?? 0,
  });
  const monsoonDesignCFM = monsoonSupply.designSupplyCFM;
  const monsoonCfmTR = monsoonDesignCFM / 400;
  const monsoonGoverningTR = monsoonGrandTotalTR;
  const monsoonRequiredTR = monsoonGrandTotalTR * (1 + overallSafetyPct / 100);

  const overallGoverningTR = hasMonsoon ? Math.max(governingTR, monsoonGoverningTR) : governingTR;
  const overallRequiredTR = hasMonsoon ? Math.max(requiredTR, monsoonRequiredTR) : requiredTR;
  const overallDesignCFM = hasMonsoon ? Math.max(designSupplyCFM, monsoonDesignCFM) : designSupplyCFM;
  // Governing candidates for each basis (max across cooling seasons) — feed the UI read-out.
  const dscfmBasisCFM = hasMonsoon
    ? Math.max(supply.dscfmBasisCFM, monsoonSupply.dscfmBasisCFM)
    : supply.dscfmBasisCFM;
  const achBasisCFM = hasMonsoon
    ? Math.max(supply.achBasisCFM, monsoonSupply.achBasisCFM)
    : supply.achBasisCFM;

  // ── Analysis snapshot ────────────────────────────────────────────────────
  const outdoorPsych = calculatePsychrometrics(dc.outdoorTemp, dc.outdoorHumidity, dc.altitude || 0);
  const indoorPsych = calculatePsychrometrics(dc.indoorTemp, dc.indoorHumidity, dc.altitude || 0);
  // Reheat sized against ROOM SHF (ersh / erlh) — see lib/hvac/reheat.ts and
  // src/services/reportService.ts for the engineering rationale. Using coil
  // totals (which include OA) produces unrealistically large reheat numbers
  // (10-15x) for over-ventilated low-RSHF rooms.
  const reheat = calculateReheat(ersh, erlh);

  const analysis = {
    updatedAt: Date.now(),
    designConditions: dc,
    roomInputs: {
      ...rd,
      sensibleSafetyPercent: sensibleSafetyPct,
      latentSafetyPercent: latentSafetyPct,
      overallSafetyPercent: overallSafetyPct,
      ductGainPct: ductPct,
      fanGainPct: fanPct,
    },
    envelope,
    internal,
    ventilation: vent,
    heating: heating
      ? {
          ...heating,
          safetyAppliedBTUH: heatingTotalWithSafety,
          safetyPercent: overallSafetyPct,
        }
      : null,
    psychrometrics: { outdoor: outdoorPsych, indoor: indoorPsych },
    // TFA / DOAS block — null when strategy is 'primary' / undefined.
    // Holds the separate DOAS coil load (summer + monsoon) and the space
    // offsets credited to the primary system.
    tfa: isTFA && tfa
      ? {
          strategy: 'tfa-cold' as const,
          summer: tfa,
          monsoon: monsoonTfa,
          // Governing TFA load for DOAS sizing — max of summer/monsoon.
          governingCoilBTUH: Math.max(
            tfa.coilSensible + tfa.coilLatent,
            monsoonTfa ? monsoonTfa.coilSensible + monsoonTfa.coilLatent : 0,
          ),
          governs: (monsoonTfa && monsoonTfa.coilSensible + monsoonTfa.coilLatent > tfa.coilSensible + tfa.coilLatent
            ? 'monsoon'
            : 'summer') as 'summer' | 'monsoon',
          // Summer dehumidification reheat (cool-to-ADP then reheat to supply temp).
          // Season-independent — depends only on the supply setpoint — so the summer
          // value covers monsoon too. ADP reported for traceability on the spec sheet.
          coilADP: tfa.coilADP,
          reheatCoilBTUH: tfa.reheatCoilSensible,
        }
      : null,
    coil,
    // Moisture analysis at the cooling coil. For climates with a separate monsoon
    // design condition, monsoon latent typically exceeds summer (high outdoor W) —
    // we report the GOVERNING season for equipment / humidifier-dehumidifier sizing
    // and keep summer/monsoon breakdown for the PDF and UI.
    moisture: (() => {
      const summerLbHr   = Math.abs(coilLatent) / 1050;
      const monsoonLbHr  = hasMonsoon ? Math.abs(monsoonCoilLat) / 1050 : 0;
      const monsoonGoverns = hasMonsoon && monsoonLbHr > summerLbHr;
      const govLatent = monsoonGoverns ? monsoonCoilLat : coilLatent;
      const govLbHr   = monsoonGoverns ? monsoonLbHr   : summerLbHr;
      return {
        rate: govLbHr,
        action: govLatent > 0 ? 'Dehumidify' : govLatent < 0 ? 'Humidify' : 'None',
        unit: 'lbs/hr',
        loadBTU: govLatent,
        summerRate: parseFloat(summerLbHr.toFixed(2)),
        monsoonRate: parseFloat(monsoonLbHr.toFixed(2)),
        governs: monsoonGoverns ? 'monsoon' : 'summer',
      };
    })(),
    reheat,
    totals: { ersh, erlh, erh, coilSensible, coilLatent, oaSensible, oaLatent, oaTotal, grandTotal, grandTotalTR, rshf },
  };

  const result: RoomCalcResult = {
    analysis,
    totalLoadBTUH: grandTotal,
    totalLoadTR: grandTotalTR,
    dehumidifiedCFM: coil.dehumidifiedCFM,
    designSupplyCFM,
    _calcLoadTR: parseFloat(grandTotalTR.toFixed(3)),
    _calcCfmTR: parseFloat(cfmTR.toFixed(3)),
    _calcGoverningTR: parseFloat(governingTR.toFixed(3)),
    _calcRequiredTR: parseFloat(requiredTR.toFixed(3)),
    _calcDesignCFM: parseFloat(designSupplyCFM.toFixed(0)),
    _calcSensibleBTUH: parseFloat(ersh.toFixed(0)),
    _calcLatentBTUH: parseFloat(erlh.toFixed(0)),
    _calcMonsoonLoadTR: parseFloat(monsoonGrandTotalTR.toFixed(3)),
    _calcMonsoonCfmTR: parseFloat(monsoonCfmTR.toFixed(3)),
    _calcMonsoonGoverningTR: parseFloat(monsoonGoverningTR.toFixed(3)),
    _calcMonsoonRequiredTR: parseFloat(monsoonRequiredTR.toFixed(3)),
    _calcMonsoonDesignCFM: parseFloat(monsoonDesignCFM.toFixed(0)),
    _calcOverallGoverningTR: parseFloat(overallGoverningTR.toFixed(3)),
    _calcOverallRequiredTR: parseFloat(overallRequiredTR.toFixed(3)),
    _calcOverallDesignCFM: parseFloat(overallDesignCFM.toFixed(0)),
    // Supply-air basis read-out (Basis selector UI): the selected basis + both candidate
    // CFMs (governing across cooling seasons) + the fresh-air floor.
    _calcSupplyCfmBasis: supplyCfmBasis,
    _calcDscfmBasisCFM: parseFloat(dscfmBasisCFM.toFixed(0)),
    _calcAchBasisCFM: parseFloat(achBasisCFM.toFixed(0)),
    _calcFreshAirCFM: parseFloat(freshAirCFM.toFixed(0)),
    ...(isTFA && tfa
      ? {
          _calcTfaCoilBTUH: parseFloat((tfa.coilSensible + tfa.coilLatent).toFixed(0)),
          _calcTfaCoilTR: parseFloat(((tfa.coilSensible + tfa.coilLatent) / 12000).toFixed(3)),
          _calcTfaCfm: parseFloat(tfa.cfm.toFixed(0)),
          // TFA/DOAS fresh-air winter heating coil (tempers OA to neutral supply).
          // Overall safety applied to mirror _calcWinterHeatingBTUH / the LC path.
          _calcTfaWinterHeatingBTUH: parseFloat(
            ((tfa.winterCoilSensible || 0) * (1 + overallSafetyPct / 100)).toFixed(0),
          ),
          // Summer dehumidification reheat coil (cool-to-ADP then reheat to supply).
          // Persisted RAW (no overall safety) to match its sibling _calcTfaCoilBTUH —
          // both are DOAS cooling-season duties sized off the same coil process.
          _calcTfaReheatBTUH: parseFloat((tfa.reheatCoilSensible || 0).toFixed(0)),
          ...(monsoonTfa
            ? {
                _calcMonsoonTfaCoilBTUH: parseFloat(
                  (monsoonTfa.coilSensible + monsoonTfa.coilLatent).toFixed(0),
                ),
                _calcMonsoonTfaCoilTR: parseFloat(
                  ((monsoonTfa.coilSensible + monsoonTfa.coilLatent) / 12000).toFixed(3),
                ),
              }
            : {}),
        }
      : {}),
  };

  // ── Persist to Firestore ─────────────────────────────────────────────────
  await updateDoc(doc(db, 'projects', projectId, 'rooms', roomId), {
    ...result,
    analysisUpdatedAt: new Date(),
    updatedAt: new Date(),
  });

  return result;
}
