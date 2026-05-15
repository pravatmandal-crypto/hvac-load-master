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
  getRecommendedAch,
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
  includeWinter?: boolean;
  monsoonOutdoorTemp?: number;
  monsoonOutdoorHumidity?: number;
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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMinAdp(systemType?: string): number {
  const st = String(systemType || '').toLowerCase();
  if (st === 'chiller') return 44;
  if (st === 'vrf' || st === 'hybrid') return 42;
  return 44;
}

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
  };

  const bf = 0.15;
  const ductPct = Number(room.ductGainPct) || 2;
  const fanPct = Number(room.fanGainPct) || 3;
  const sensibleSafetyPct = Number(room.sensibleSafetyPercent ?? room.sensibleSafetyFactor ?? 10);
  const latentSafetyPct = Number(room.latentSafetyPercent ?? room.latentSafetyFactor ?? 5);
  const overallSafetyPct = Number(room.overallSafetyPercent ?? room.grandTotalSafetyFactor ?? 3);
  const minAdp = getMinAdp(systemType);

  // ── Summer calc ───────────────────────────────────────────────────────────
  const envelope = calculateEnvelopeGain(elements, dc);
  const internal = calculateInternalGains(rd);
  const vent = calculateVentilationLoad(rd, dc);
  const heating = dc.includeWinter ? calculateHeatingLoad(rd, elements, dc) : null;

  const erSensible = envelope.sensible + internal.sensible + vent.sensible * bf;
  const erLatent = internal.latent + vent.latent * bf;
  const parasitic = calculateParasiticGains(erSensible, erSensible, ductPct, fanPct);

  const ershRaw = erSensible + parasitic.ductGain + parasitic.fanGain;
  const erlhRaw = erLatent;
  const ersh = ershRaw * (1 + sensibleSafetyPct / 100);
  const erlh = erlhRaw * (1 + latentSafetyPct / 100);
  const erh = ersh + erlh;
  const oaSensible = vent.sensible * (1 - bf);
  const oaLatent = vent.latent * (1 - bf);
  const oaTotal = oaSensible + oaLatent;
  const coilSensible = ersh + oaSensible;
  const coilLatent = erlh + oaLatent;
  const grandTotal = erh + oaTotal;
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
  // Methodology: DSCFM = CSH / (1.08 × ΔT_supply) — sensible-only per Carrier Manual.
  const designSupplyCFM = Math.max(coil.minAdpSensibleCFM, totalSupplyCFM);
  const cfmTR = designSupplyCFM / 400;
  const governingTR = Math.max(grandTotalTR, cfmTR);
  const requiredTR = governingTR * (1 + overallSafetyPct / 100);

  // ── Monsoon calc ─────────────────────────────────────────────────────────
  const hasMonsoon = !!(dc.monsoonOutdoorTemp && dc.monsoonOutdoorHumidity);
  const monsoonDc = {
    ...dc,
    outdoorTemp: dc.monsoonOutdoorTemp ?? dc.outdoorTemp,
    outdoorHumidity: dc.monsoonOutdoorHumidity ?? dc.outdoorHumidity,
  };
  const monsoonEnvelope = calculateEnvelopeGain(elements, monsoonDc);
  const monsoonVent = calculateVentilationLoad(rd, monsoonDc);
  const monsoonErSensible = monsoonEnvelope.sensible + internal.sensible + monsoonVent.sensible * bf;
  const monsoonErLatent = internal.latent + monsoonVent.latent * bf;
  const monsoonParasitic = calculateParasiticGains(monsoonErSensible, monsoonErSensible, ductPct, fanPct);
  const monsoonErshRaw = monsoonErSensible + monsoonParasitic.ductGain + monsoonParasitic.fanGain;
  const monsoonCoilSen = monsoonErshRaw * (1 + sensibleSafetyPct / 100) + monsoonVent.sensible * (1 - bf);
  const monsoonCoilLat = monsoonErLatent * (1 + latentSafetyPct / 100) + monsoonVent.latent * (1 - bf);
  const monsoonGrandTotal = monsoonCoilSen + monsoonCoilLat;
  const monsoonGrandTotalTR = monsoonGrandTotal / 12000;
  const monsoonCoilParams = calculateCoilParameters(
    monsoonCoilSen, monsoonCoilLat,
    dc.indoorTemp, dc.indoorHumidity, dc.altitude || 0,
    bf, 35, 65, minAdp,
  );
  const monsoonDesignCFM = Math.max(monsoonCoilParams.minAdpSensibleCFM, totalSupplyCFM);
  const monsoonCfmTR = monsoonDesignCFM / 400;
  const monsoonGoverningTR = Math.max(monsoonGrandTotalTR, monsoonCfmTR);
  const monsoonRequiredTR = monsoonGoverningTR * (1 + overallSafetyPct / 100);

  const overallGoverningTR = hasMonsoon ? Math.max(governingTR, monsoonGoverningTR) : governingTR;
  const overallRequiredTR = hasMonsoon ? Math.max(requiredTR, monsoonRequiredTR) : requiredTR;
  const overallDesignCFM = hasMonsoon ? Math.max(designSupplyCFM, monsoonDesignCFM) : designSupplyCFM;

  // ── Analysis snapshot ────────────────────────────────────────────────────
  const outdoorPsych = calculatePsychrometrics(dc.outdoorTemp, dc.outdoorHumidity, dc.altitude || 0);
  const indoorPsych = calculatePsychrometrics(dc.indoorTemp, dc.indoorHumidity, dc.altitude || 0);
  const reheat = calculateReheat(coilSensible, coilLatent);

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
    heating,
    psychrometrics: { outdoor: outdoorPsych, indoor: indoorPsych },
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
  };

  // ── Persist to Firestore ─────────────────────────────────────────────────
  await updateDoc(doc(db, 'projects', projectId, 'rooms', roomId), {
    ...result,
    analysisUpdatedAt: new Date(),
    updatedAt: new Date(),
  });

  return result;
}
