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
  calculatePsychrometrics,
  calculateReheat,
  computeRoomLoad,
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
  // Outdoor-air (fresh-air / ventilation) tonnage carried inside the room load TR.
  // Used by plant diversity: indoor = loadTR − oaTR is diversified; OA is added back
  // un-diversified (fresh air is continuous). Zero for DOAS-served (TFA) rooms.
  _calcOaTR: number;
  _calcMonsoonOaTR: number;
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
 * @param adpBasis   Project ADP-floor basis ('comfort' | 'dehumidification'); see getMinAdp.
 * @returns          All computed metrics — caller merges into local state as needed
 */
export async function calculateAndPersistRoom(
  projectId: string,
  roomId: string,
  room: any,
  elements: EnvelopeElement[],
  dc: RoomCalcDesignConditions,
  systemType?: string,
  adpBasis?: string,
  projectSupplyBasis?: string,
  equipSystems: any[] = [],
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

  const ductPct = Number(room.ductGainPct) || 2;
  const fanPct = Number(room.fanGainPct) || 3;
  const sensibleSafetyPct = Number(room.sensibleSafetyPercent ?? room.sensibleSafetyFactor ?? 10);
  const latentSafetyPct = Number(room.latentSafetyPercent ?? room.latentSafetyFactor ?? 5);
  const overallSafetyPct = Number(room.overallSafetyPercent ?? room.grandTotalSafetyFactor ?? 3);

  // ── Summer calc — single shared engine (Step-2 consolidation 2026-07-08) ─────
  // computeRoomLoad runs the canonical envelope→internal→vent→TFA-credit→coil→
  // resolveSupplyCfm sequence. TFA/DOAS is resolved from equipSystems; when the
  // caller passes none (the current HvacSystems SD-save call), resolveRoomTfa finds
  // no DOAS → bit-identical to the previous dc.ventilationStrategy path for non-DOAS
  // rooms. Wire equipSystems through the caller to make the SD-save path TFA-aware.
  const clProject = { systemType, adpBasis, supplyBasis: projectSupplyBasis };
  const s = computeRoomLoad(room, elements, dc, { equipSystems, project: clProject });
  const isTFA = s.isTFA;
  const { envelope, internal, vent, tfa, coil } = s;
  const ersh = s.ersh, erlh = s.erlh, erh = s.erh;
  const oaSensible = s.oaSensible, oaLatent = s.oaLatent, oaTotal = oaSensible + oaLatent;
  const coilSensible = s.coilSensible, coilLatent = s.coilLatent;
  const grandTotal = s.grandTotal, grandTotalTR = s.loadTr;
  // GSHF stored on the coil summary — same formula the app has always persisted.
  const rshf = coilSensible > 0 ? coilSensible / Math.max(1, coilSensible + coilLatent) : 1;
  const designSupplyCFM = s.designCfm, cfmTR = s.cfmTr;
  const governingTR = s.governingTr, requiredTR = s.requiredTr;
  const supplyCfmBasis: SupplyCfmBasis = s.supplyCfmBasis;
  const freshAirCFM = s.freshAirCFM;
  // Heating only when the winter block is requested; safety mirrors the cooling margin.
  const heating = dc.includeWinter ? s.heating : null;
  const heatingTotalWithSafety = heating
    ? heating.totalHeatingLoad * (1 + overallSafetyPct / 100)
    : 0;

  // ── Monsoon calc — same shared engine at monsoon conditions ──────────────────
  const hasMonsoon = !!(dc.monsoonOutdoorTemp && dc.monsoonOutdoorHumidity);
  const monsoonDc = {
    ...dc,
    outdoorTemp: dc.monsoonOutdoorTemp ?? dc.outdoorTemp,
    outdoorHumidity: dc.monsoonOutdoorHumidity ?? dc.outdoorHumidity,
  };
  const m = computeRoomLoad(room, elements, monsoonDc, { equipSystems, project: clProject });
  const monsoonTfa = m.tfa;
  const monsoonOaSensible = m.oaSensible, monsoonOaLatent = m.oaLatent;
  const monsoonCoilLat = m.coilLatent;
  const monsoonGrandTotalTR = m.loadTr;
  const monsoonDesignCFM = m.designCfm;
  const monsoonCfmTR = m.cfmTr;
  const monsoonGoverningTR = m.governingTr;
  const monsoonRequiredTR = m.requiredTr;

  const overallGoverningTR = hasMonsoon ? Math.max(governingTR, monsoonGoverningTR) : governingTR;
  const overallRequiredTR = hasMonsoon ? Math.max(requiredTR, monsoonRequiredTR) : requiredTR;
  const overallDesignCFM = hasMonsoon ? Math.max(designSupplyCFM, monsoonDesignCFM) : designSupplyCFM;
  // Governing candidates for each basis (max across cooling seasons) — feed the UI read-out.
  const dscfmBasisCFM = hasMonsoon ? Math.max(s.dscfmBasisCFM, m.dscfmBasisCFM) : s.dscfmBasisCFM;
  const achBasisCFM = hasMonsoon ? Math.max(s.achBasisCFM, m.achBasisCFM) : s.achBasisCFM;

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
    _calcOaTR: parseFloat((oaTotal / 12000).toFixed(3)),
    _calcMonsoonOaTR: parseFloat(((monsoonOaSensible + monsoonOaLatent) / 12000).toFixed(3)),
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
