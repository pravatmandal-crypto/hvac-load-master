import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Loader2, ArrowRight } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import RoomTable from './RoomTable';
import { toast } from 'sonner';
import {
  calculateRoomVolume,
  calculateEnvelopeGain,
  calculateInternalGains,
  calculateVentilationLoad,
  calculateTFALoad,
  resolveRoomTfa,
  calculateCoilParameters,
  calculateParasiticGains,
  calculateHeatingLoad,
  getRecommendedAch,
  resolveSupplyCfm,
  getMinAdp,
  type DesignConditions,
  type RoomDetails,
  type EnvelopeElement,
} from '../../lib/hvac';

const BF = 0.15;
const ZONE_OVERRIDE_FIELDS = ['indoorTemp', 'indoorHumidity', 'winterIndoorTemp', 'winterIndoorHumidity'] as const;
type ZoneOverrideField = typeof ZONE_OVERRIDE_FIELDS[number];

function ZoneDropContainer({ zoneId, children }: { zoneId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone-${zoneId}` });

  return (
    <div
      ref={setNodeRef}
      className={isOver ? 'ring-2 ring-blue-300 ring-inset bg-blue-50/40 dark:bg-blue-900/20' : ''}
    >
      {children}
    </div>
  );
}

// ─── Safe compute zone totals ──────────────────────────────────────────────────

function computeZoneTotals(
  zoneRooms: any[],
  envelopeElements: Record<string, any[]>,
  dc: DesignConditions,
  isChiller: boolean,
  equipSystems: any[] = [],
) {
  // DOAS/TFA awareness via the shared resolver (room.tfaMode-driven, legacy link
  // fallback) so the zone strip shows the REDUCED post-TFA space coil, consistent
  // with the LC project summary and SD.

  let totalCooling = 0;
  let totalTfaCoil = 0; // Σ TFA coil load (BTU/h) for this dc/season — shown separately
  let totalTfaWinterHeating = 0; // Σ TFA/DOAS fresh-air winter heating coil (BTU/h)
  let totalHeating = 0;
  let totalDehumCfm = 0;
  let totalOaCfm = 0;
  let totalSupplyCfm = 0;
  let totalDesignCfm = 0;
  let totalArea = 0;
  // Per-room required TR (post overall-safety, governed by max of load TR and CFM TR) summed
  // across rooms. Mirrors EquipmentSelection.computeRoomReqs so the LC zone-strip "Equipment"
  // tile matches the SD "Required TR" for the same zone.
  let totalRequiredTR = 0;

  for (const room of zoneRooms) {
    try {
      const rd: RoomDetails = {
        id: room.id,
        name: room.name ?? '',
        floor: room.floor ?? 'Ground',
        length: Number(room.length) || 0,
        width: Number(room.width) || 0,
        height: Number(room.height) || 0,
        hasFalseCeiling: room.hasFalseCeiling ?? false,
        falseCeilingHeight: Number(room.falseCeilingHeight) || 8,
        facph: Number(room.facph) || 0,
        peopleCount: Number(room.peopleCount) || 0,
        activityType: room.activityType ?? 'office',
        lightsWattsPerSqft: Number(room.lightsWattsPerSqft) || 0,
        equipmentKW: Number(room.equipmentKW) || 0,
        othersKW: Number(room.othersKW) || 0,
      };

      const elements = (envelopeElements[room.id] || []) as EnvelopeElement[];

      // TFA-aware design conditions — when this room is DOAS-served, the OA goes to
      // the TFA unit (zeroed on the primary) and the cold-DOAS supply credits the
      // space coil. Mirrors the persist path + LC project summary exactly.
      const { doas, mode: effectiveMode } = resolveRoomTfa(room, equipSystems);
      const isTFA = !!doas;
      const isTfaOnly = effectiveMode === 'tfa-only';
      const dcEff: any = isTFA
        ? {
            ...dc,
            ventilationStrategy: 'tfa-cold',
            tfaSupplyTemp: doas.tfaSupplyTemp,
            tfaSupplyHumidity: doas.tfaSupplyHumidity,
            ervSensibleEffectiveness: doas.ervSensibleEffectiveness,
            ervLatentEffectiveness: doas.ervLatentEffectiveness,
            tfaWinterSupplyTemp: doas.tfaWinterSupplyTemp,
          }
        : dc;

      const envelope = calculateEnvelopeGain(elements, dcEff);
      const internal = calculateInternalGains(rd);
      const vent = calculateVentilationLoad(rd, dcEff);
      const heating = calculateHeatingLoad(rd, elements, dcEff);
      const tfa = isTFA ? calculateTFALoad(rd, dcEff) : null;

      const erVentSen = isTFA ? 0 : vent.sensible * BF;
      const erVentLat = isTFA ? 0 : vent.latent * BF;
      const erSensible = envelope.sensible + internal.sensible + erVentSen;
      const erLatent = internal.latent + erVentLat;
      const ductPct = Number(room.ductGainPct) || 2;
      const fanPct = Number(room.fanGainPct) || 3;
      const sensibleSafetyPct = Number(room.sensibleSafetyPercent ?? room.sensibleSafetyFactor ?? 10);
      const latentSafetyPct = Number(room.latentSafetyPercent ?? room.latentSafetyFactor ?? 5);
      const overallSafetyPct = Number(room.overallSafetyPercent ?? room.grandTotalSafetyFactor ?? 3);
      const parasitic = calculateParasiticGains(erSensible, erSensible, ductPct, fanPct);

      const ersh = (erSensible + parasitic.ductGain + parasitic.fanGain) * (1 + sensibleSafetyPct / 100);
      const erlh = erLatent * (1 + latentSafetyPct / 100);
      const oaSensible = isTFA ? 0 : vent.sensible * (1 - BF);
      const oaLatent = isTFA ? 0 : vent.latent * (1 - BF);
      const tfaOffSen = tfa ? tfa.spaceSensibleOffset : 0;
      const tfaOffLat = tfa ? tfa.spaceLatentOffset : 0;
      const coilSensible = isTfaOnly ? 0 : (isTFA ? Math.max(0, ersh - tfaOffSen) : ersh + oaSensible);
      const coilLatent = isTfaOnly ? 0 : (isTFA ? Math.max(0, erlh - tfaOffLat) : erlh + oaLatent);
      if (tfa) totalTfaCoil += tfa.coilSensible + tfa.coilLatent;
      if (tfa) totalTfaWinterHeating += (tfa.winterCoilSensible || 0) * (1 + overallSafetyPct / 100);
      // Pass derived system type to centralized helper. Preserves the previous
      // 44/42 split for chiller vs VRF; non-chiller types now use the canonical
      // 42°F per getMinAdp (matches old isChiller=false behavior).
      const minAdp = getMinAdp(isChiller ? 'chiller' : 'vrf');
      const coil = calculateCoilParameters(
        coilSensible,
        coilLatent,
        dc.indoorTemp,
        dc.indoorHumidity,
        dc.altitude || 0,
        BF,
        35,
        65,
        minAdp,
      );
      const grandTotal = coilSensible + coilLatent;

      const presetTotalACH = getRecommendedAch(room.achProfile ?? room.activityType);
      const effectiveTotalACH = Math.max(presetTotalACH, rd.facph);
      const totalSupplyCFM = (calculateRoomVolume(rd) * effectiveTotalACH) / 60;
      const freshAirCFM = (calculateRoomVolume(rd) * rd.facph) / 60;
      // Supply-air basis: 'dscfm' (DEFAULT, dehumidified-air) vs 'ach' (legacy ACH-preset).
      // DSCFM is the default — only an explicit 'ach' opts out. The DOAS is independent — it
      // always sizes off the OA FACPH. See lib/hvac/supplyCfm.
      const designCFM = resolveSupplyCfm({
        basis: room.supplyCfmBasis === 'ach' ? 'ach' : 'dscfm',
        isTFA, isTfaOnly,
        dehumidifiedCFM: coil.dehumidifiedCFM,
        minAdpSensibleCFM: coil.minAdpSensibleCFM,
        totalSupplyCFM, freshAirCFM,
        tfaCfm: tfa?.cfm ?? 0,
      }).designSupplyCFM;

      // Per-room required TR: load TR × (1 + overall safety %). Plant TR is LOAD-ONLY
      // (2026-05-20 decision, confirmed) — CFM/TR is a sanity ratio, never a governor.
      // Same formula as EquipmentSelection.computeRoomReqs so LC zone-strip and SD agree.
      const roomLoadTR = grandTotal / 12000;
      const roomRequiredTR = roomLoadTR * (1 + overallSafetyPct / 100);

      if (isFinite(grandTotal)) totalCooling += grandTotal;
      // Apply overall safety to heating — mirrors the per-room persisted
      // _calcWinterHeatingBTUH and the LC project-summary card, so the zone /
      // system strips reconcile with the project Heating Load total.
      const roomHeating = heating.totalHeatingLoad * (1 + overallSafetyPct / 100);
      if (isFinite(roomHeating)) totalHeating += roomHeating;
      if (isFinite(coil.dehumidifiedCFM)) totalDehumCfm += coil.dehumidifiedCFM;
      if (isFinite(vent.cfm)) totalOaCfm += vent.cfm;
      if (isFinite(totalSupplyCFM)) totalSupplyCfm += totalSupplyCFM;
      if (isFinite(designCFM)) totalDesignCfm += designCFM;
      if (isFinite(roomRequiredTR)) totalRequiredTR += roomRequiredTR;
      totalArea += rd.length * rd.width;
    } catch {
      // skip room if calculation fails — don't crash the whole component
    }
  }

  return {
    totalCooling,
    totalTR: totalCooling / 12000,
    totalTfaCoil,
    totalTfaCoilTR: totalTfaCoil / 12000,
    totalTfaWinterHeating,
    totalHeating,
    totalDehumCfm,
    totalOaCfm,
    totalSupplyCfm,
    totalDesignCfm,
    totalArea,
    totalRequiredTR,
  };
}

function computeGoverningRoom(
  zoneRooms: any[],
  envelopeElements: Record<string, any[]>,
  dc: DesignConditions,
  isChiller: boolean,
): { name: string; loadTR: number } | null {
  let maxLoad = -Infinity;
  let result: { name: string; loadTR: number } | null = null;
  for (const room of zoneRooms) {
    try {
      const rd: RoomDetails = {
        id: room.id,
        name: room.name ?? '',
        floor: room.floor ?? 'Ground',
        length: Number(room.length) || 0,
        width: Number(room.width) || 0,
        height: Number(room.height) || 0,
        hasFalseCeiling: room.hasFalseCeiling ?? false,
        falseCeilingHeight: Number(room.falseCeilingHeight) || 8,
        facph: Number(room.facph) || 0,
        peopleCount: Number(room.peopleCount) || 0,
        activityType: room.activityType ?? 'office',
        lightsWattsPerSqft: Number(room.lightsWattsPerSqft) || 0,
        equipmentKW: Number(room.equipmentKW) || 0,
        othersKW: Number(room.othersKW) || 0,
      };
      const elements = (envelopeElements[room.id] || []) as EnvelopeElement[];
      const envelope = calculateEnvelopeGain(elements, dc);
      const internal = calculateInternalGains(rd);
      const vent = calculateVentilationLoad(rd, dc);
      const erSensible = envelope.sensible + internal.sensible + vent.sensible * BF;
      const erLatent = internal.latent + vent.latent * BF;
      const ductPct = Number(room.ductGainPct) || 2;
      const fanPct = Number(room.fanGainPct) || 3;
      const sensibleSafetyPct = Number(room.sensibleSafetyPercent ?? room.sensibleSafetyFactor ?? 10);
      const latentSafetyPct = Number(room.latentSafetyPercent ?? room.latentSafetyFactor ?? 5);
      const parasitic = calculateParasiticGains(erSensible, erSensible, ductPct, fanPct);
      const ersh = (erSensible + parasitic.ductGain + parasitic.fanGain) * (1 + sensibleSafetyPct / 100);
      const erlh = erLatent * (1 + latentSafetyPct / 100);
      const oaSensible = vent.sensible * (1 - BF);
      const oaLatent = vent.latent * (1 - BF);
      const coilSensible = ersh + oaSensible;
      const coilLatent = erlh + oaLatent;
      const grandTotal = coilSensible + coilLatent;
      if (isFinite(grandTotal) && grandTotal > maxLoad) {
        maxLoad = grandTotal;
        result = { name: room.name ?? 'Unnamed', loadTR: grandTotal / 12000 };
      }
    } catch {
      // skip
    }
  }
  return result;
}

// ─── Zone summary bar (rendered after room list) ───────────────────────────────

function ZoneSummaryBar({
  zoneRooms,
  envelopeElements,
  dc,
  isChiller,
  project,
  zoneId,
  zoneName,
  equipSystems,
}: {
  zoneRooms: any[];
  envelopeElements: Record<string, any[]>;
  dc: DesignConditions;
  isChiller: boolean;
  project?: any;
  zoneId?: string;
  zoneName?: string;
  equipSystems?: any[];
}) {
  const includeMonsoon = !!(project?.includeMonsoon ?? project?.data?.includeMonsoon);
  const monsoonDc = useMemo<DesignConditions>(() => ({
    ...dc,
    outdoorTemp: project?.monsoonDesignTemp ?? project?.data?.monsoonDesignTemp ?? 85,
    outdoorHumidity: project?.monsoonDesignHumidity ?? project?.data?.monsoonDesignHumidity ?? 85,
    // Zone strip rule: monsoon indoor follows summer/zone override.
    indoorTemp: dc.indoorTemp,
    indoorHumidity: dc.indoorHumidity,
  }), [dc, project]);

  const summerTotals = useMemo(
    () => computeZoneTotals(zoneRooms, envelopeElements, dc, isChiller, equipSystems),
    [zoneRooms, envelopeElements, dc, isChiller, equipSystems],
  );
  const monsoonTotals = useMemo(
    () => (includeMonsoon ? computeZoneTotals(zoneRooms, envelopeElements, monsoonDc, isChiller, equipSystems) : null),
    [zoneRooms, envelopeElements, monsoonDc, isChiller, includeMonsoon, equipSystems],
  );
  const summerGoverningRoom = useMemo(
    () => computeGoverningRoom(zoneRooms, envelopeElements, dc, isChiller),
    [zoneRooms, envelopeElements, dc, isChiller],
  );
  const monsoonGoverningRoom = useMemo(
    () => (includeMonsoon ? computeGoverningRoom(zoneRooms, envelopeElements, monsoonDc, isChiller) : null),
    [zoneRooms, envelopeElements, monsoonDc, isChiller, includeMonsoon],
  );

  if (zoneRooms.length === 0) return (
    <div className="border-t border-slate-100 dark:border-slate-700/50 px-4 py-3 text-xs text-slate-400 dark:text-slate-500 italic">
      No rooms in this zone yet — add rooms using the &ldquo;Add Room&rdquo; button above.
    </div>
  );
  const n = (v: number) => Math.round(v).toLocaleString();
  const summerCfmTR = summerTotals.totalDesignCfm > 0 ? summerTotals.totalDesignCfm / 400 : 0;
  const monsoonCfmTR = monsoonTotals && monsoonTotals.totalDesignCfm > 0 ? monsoonTotals.totalDesignCfm / 400 : 0;
  // Plant TR = load-only (2026-05-20). cfmTR retained as sanity ratio.
  const summerGoverningTR = summerTotals.totalTR;
  const monsoonGoverningTR = monsoonTotals ? monsoonTotals.totalTR : 0;
  const governingLoadSeason = includeMonsoon && monsoonTotals && monsoonTotals.totalTR > summerTotals.totalTR ? 'Monsoon' : 'Summer';
  const governingAirflowSeason = includeMonsoon && monsoonTotals && monsoonCfmTR > summerCfmTR ? 'Monsoon' : 'Summer';
  const governingLoadTR = includeMonsoon && monsoonTotals ? Math.max(summerTotals.totalTR, monsoonTotals.totalTR) : summerTotals.totalTR;
  const governingCfmTR = includeMonsoon && monsoonTotals ? Math.max(summerCfmTR, monsoonCfmTR) : summerCfmTR;
  const governingTR = governingLoadTR;
  const peakSeason = governingLoadSeason;
  const t = peakSeason === 'Monsoon' && monsoonTotals ? monsoonTotals : summerTotals;
  const governingDesignCfm = includeMonsoon && monsoonTotals
    ? Math.max(summerTotals.totalDesignCfm, monsoonTotals.totalDesignCfm)
    : summerTotals.totalDesignCfm;
  // Equipment-sizing required TR: sum of per-room required TR (load TR × safety; load-only),
  // governed by the higher of summer / monsoon. Matches EquipmentSelection.computeRoomReqs.
  const requiredTR = includeMonsoon && monsoonTotals
    ? Math.max(summerTotals.totalRequiredTR, monsoonTotals.totalRequiredTR)
    : summerTotals.totalRequiredTR;
  const achGovernsAirflow = governingCfmTR >= governingLoadTR;
  const governingRoomInfo = peakSeason === 'Monsoon' && monsoonGoverningRoom ? monsoonGoverningRoom : summerGoverningRoom;

  const zoneRoomIdSet = new Set(zoneRooms.map((r: any) => r.id));
  // Some equipment zones have empty roomIds (e.g. created via the new SD flow where
  // rooms are inferred via room.zoneId). Also allow matching when the equipment zone's
  // own id matches this LC zone's id, or when any room in this LC zone points to the
  // equipment zone via room.zoneId.
  const roomZoneIds = new Set(zoneRooms.map((r: any) => r.zoneId).filter(Boolean));
  if (zoneId) roomZoneIds.add(zoneId);
  const installedForZone = (equipSystems ?? []).reduce<{ tr: number; cfm: number }>(
    (acc, sys) => {
      // Zone-level IDU selections: match by room membership OR by zone-id, so equipment
      // selections survive even when eqZone.roomIds is stale/empty.
      for (const eqZone of (sys.zones ?? []) as any[]) {
        const overlaps = (eqZone.roomIds ?? []).some((rid: string) => zoneRoomIdSet.has(rid));
        const idMatch  = roomZoneIds.has(eqZone.id);
        if (!overlaps && !idMatch) continue;
        if (eqZone.unitSelections?.length) {
          acc.tr  += (eqZone.unitSelections as any[]).reduce((s: number, u: any) => s + (u.trCapacity ?? 0) * (u.quantity ?? 1), 0);
          acc.cfm += (eqZone.unitSelections as any[]).reduce((s: number, u: any) => s + (u.cfmRated  ?? 0) * (u.quantity ?? 1), 0);
        } else if (eqZone.selection) {
          acc.tr  += (eqZone.selection.trCapacity ?? 0) * (eqZone.selection.quantity ?? 1);
          acc.cfm += (eqZone.selection.cfmRated  ?? 0) * (eqZone.selection.quantity ?? 1);
        }
      }
      // Room-level selections (Split / per-room modes)
      for (const room of zoneRooms) {
        const roomSel = (sys.roomSelections?.[room.id] ?? []) as any[];
        acc.tr  += roomSel.reduce((s: number, u: any) => s + (u.trCapacity ?? 0) * (u.quantity ?? 1), 0);
        acc.cfm += roomSel.reduce((s: number, u: any) => s + (u.cfmRated  ?? 0) * (u.quantity ?? 1), 0);
        // iduSelections (legacy per-room record)
        const iduSel = sys.iduSelections?.[room.id];
        if (iduSel) {
          const units = Array.isArray(iduSel) ? iduSel : [iduSel];
          acc.tr  += (units as any[]).reduce((s: number, u: any) => s + (u.trCapacity ?? 0) * (u.quantity ?? 1), 0);
          acc.cfm += (units as any[]).reduce((s: number, u: any) => s + (u.cfmRated  ?? 0) * (u.quantity ?? 1), 0);
        }
      }
      return acc;
    },
    { tr: 0, cfm: 0 },
  );
  const instFit = installedForZone.tr > 0
    ? installedForZone.tr >= requiredTR * 0.97 ? 'ok' : 'low'
    : 'none';

  return (
    <>
      <div className="border-t border-orange-100 dark:border-orange-900/40 bg-gradient-to-r from-white via-orange-50/50 to-amber-50/70 dark:from-slate-800 dark:via-orange-950/20 dark:to-amber-950/20 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-orange-200 dark:border-orange-800 bg-white dark:bg-slate-800 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:text-orange-400">{zoneRooms.length} room{zoneRooms.length !== 1 ? 's' : ''}</span>
              <span className="rounded-full border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:text-slate-300">Peak season: {peakSeason}</span>
              <span className="rounded-full border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:text-indigo-400" title="Sanity ratio — typical 350–450 CFM/TR">{governingTR > 0 ? Math.round(governingDesignCfm / governingTR) : 0} CFM/TR</span>
              {governingRoomInfo && zoneRooms.length > 1 && (
                <span className="rounded-full border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400" title={`Highest load room: ${governingRoomInfo.loadTR.toFixed(2)} TR`}>
                  Peak: {governingRoomInfo.name}
                </span>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-white dark:bg-slate-800 px-3 py-2">
                <p className="text-xs font-bold uppercase tracking-wide text-orange-700 dark:text-orange-400">Summer Cooling</p>
                <p className="mt-1 font-mono text-lg font-bold text-orange-900 dark:text-orange-200">{summerGoverningTR.toFixed(2)} <span className="text-[11px] font-semibold text-orange-600 dark:text-orange-400">TR</span></p>
                <p className="text-[10px] text-orange-600 dark:text-orange-400">{n(summerTotals.totalCooling)} BTU/h</p>
              </div>
              <div className={`rounded-lg border bg-white dark:bg-slate-800 px-3 py-2 ${includeMonsoon ? 'border-teal-200 dark:border-teal-800' : 'border-slate-200 dark:border-slate-700'}`}>
                <p className={`text-xs font-bold uppercase tracking-wide ${includeMonsoon ? 'text-teal-700 dark:text-teal-400' : 'text-slate-500 dark:text-slate-400'}`}>Monsoon Cooling</p>
                <p className={`mt-1 font-mono text-lg font-bold ${includeMonsoon ? 'text-teal-900 dark:text-teal-200' : 'text-slate-500 dark:text-slate-400'}`}>
                  {includeMonsoon && monsoonTotals ? monsoonGoverningTR.toFixed(2) : '--'}
                  <span className={`text-[11px] font-semibold ml-1 ${includeMonsoon ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400 dark:text-slate-500'}`}>TR</span>
                </p>
                <p className={`text-[10px] ${includeMonsoon ? 'text-teal-600 dark:text-teal-400' : 'text-slate-500 dark:text-slate-400'}`}>
                  {includeMonsoon && monsoonTotals ? `${n(monsoonTotals.totalCooling)} BTU/h` : 'Blank (Monsoon OFF)'}
                </p>
              </div>
              <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-800 px-3 py-2">
                <p className="text-xs font-bold uppercase tracking-wide text-blue-700 dark:text-blue-400">Heating</p>
                <p className="mt-1 font-mono text-lg font-bold text-blue-900 dark:text-blue-200">{n(summerTotals.totalHeating)}</p>
                <p className="text-[10px] text-blue-600 dark:text-blue-400">BTU/h winter load (space)</p>
                {summerTotals.totalTfaWinterHeating > 0 && (
                  <p className="mt-0.5 text-[10px] font-semibold text-teal-700 dark:text-teal-400" title="TFA/DOAS fresh-air winter heating coil — sized on the DOAS unit">
                    + {n(summerTotals.totalTfaWinterHeating)} TFA heat
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-800 px-3 py-2">
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Design CFM</p>
                <p className="mt-1 font-mono text-lg font-bold text-emerald-900 dark:text-emerald-200">{Math.round(governingDesignCfm)}</p>
                <p className="text-[10px] text-emerald-600 dark:text-emerald-400">w/o Reheat · OA {Math.round(t.totalOaCfm)} CFM</p>
              </div>
              <div className="rounded-lg border border-violet-200 dark:border-violet-800 bg-white dark:bg-slate-800 px-3 py-2">
                <p className="text-xs font-bold uppercase tracking-wide text-violet-700 dark:text-violet-400">Area</p>
                <p className="mt-1 font-mono text-lg font-bold text-violet-900 dark:text-violet-200">{Math.round(t.totalArea)}</p>
                <p className="text-[10px] text-violet-600 dark:text-violet-400">ft² conditioned</p>
              </div>
              <div className={`rounded-lg border bg-white dark:bg-slate-800 px-3 py-2 ${instFit === 'ok' ? 'border-green-300 dark:border-green-700' : instFit === 'low' ? 'border-red-300 dark:border-red-700' : 'border-slate-200 dark:border-slate-700'}`}>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">Equipment</p>
                <p className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-slate-100">{requiredTR.toFixed(2)} <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">TR req'd</span></p>
                {instFit === 'none' ? (
                  <p className="text-[10px] text-slate-400">No equipment selected</p>
                ) : instFit === 'ok' ? (
                  <>
                    <p className="text-[10px] font-semibold text-green-600">{installedForZone.tr.toFixed(2)} TR selected ✓</p>
                    <p className="text-[10px] font-semibold text-green-600">{Math.round(installedForZone.cfm).toLocaleString()} CFM selected</p>
                  </>
                ) : (
                  <>
                    <p className="text-[10px] font-semibold text-red-500">{installedForZone.tr.toFixed(2)} TR selected ⚠ Under</p>
                    <p className="text-[10px] font-semibold text-red-500">{Math.round(installedForZone.cfm).toLocaleString()} CFM selected</p>
                  </>
                )}
              </div>
            </div>

            {includeMonsoon && monsoonTotals ? (
              <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-3">
                <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 px-3 py-2 text-[11px]">
                  <p className="uppercase tracking-wider font-semibold text-blue-600 dark:text-blue-400 text-[10px]">Load Governor</p>
                  <p className="mt-1 text-blue-800 dark:text-blue-200 font-semibold">{governingLoadSeason} <span className="font-mono">{governingLoadTR.toFixed(2)} TR</span></p>
                </div>
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2 text-[11px]">
                  <p className="uppercase tracking-wider font-semibold text-emerald-600 dark:text-emerald-400 text-[10px]">Airflow Governor (w/o Reheat)</p>
                  <p className="mt-1 text-emerald-800 dark:text-emerald-200 font-semibold">{governingAirflowSeason} <span className="font-mono">{governingCfmTR.toFixed(2)} TR</span></p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-[11px]">
                  <p className="uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 text-[10px]">Season Delta</p>
                  <p className="mt-1 text-slate-800 dark:text-slate-200 font-semibold"><span className="font-mono">{Math.abs(monsoonGoverningTR - summerGoverningTR).toFixed(2)} TR</span></p>
                </div>
              </div>
            ) : (
              <div className="mt-3 text-[11px] text-slate-500">Monsoon comparison is blank because Include Monsoon Calculation is OFF for this project.</div>
            )}
          </div>

        </div>
      </div>

    </>
  );
}

// ─── Collapsed zone badge (TR + CFM summary chip) ─────────────────────────────

function ZoneCollapsedBadge({
  zoneRooms,
  envelopeElements,
  dc,
  isChiller,
  equipSystems,
  project,
}: {
  zoneRooms: any[];
  envelopeElements: Record<string, any[]>;
  dc: DesignConditions;
  isChiller: boolean;
  equipSystems?: any[];
  project?: any;
}) {
  const includeMonsoon = !!(project?.includeMonsoon ?? project?.data?.includeMonsoon);
  const monsoonDc = useMemo<DesignConditions>(() => ({
    ...dc,
    outdoorTemp: project?.monsoonDesignTemp ?? project?.data?.monsoonDesignTemp ?? 85,
    outdoorHumidity: project?.monsoonDesignHumidity ?? project?.data?.monsoonDesignHumidity ?? 85,
    indoorTemp: dc.indoorTemp,
    indoorHumidity: dc.indoorHumidity,
  }), [dc, project]);

  const summer = useMemo(
    () => computeZoneTotals(zoneRooms, envelopeElements, dc, isChiller, equipSystems),
    [zoneRooms, envelopeElements, dc, isChiller, equipSystems],
  );
  const monsoon = useMemo(
    () => (includeMonsoon ? computeZoneTotals(zoneRooms, envelopeElements, monsoonDc, isChiller, equipSystems) : null),
    [zoneRooms, envelopeElements, monsoonDc, isChiller, includeMonsoon, equipSystems],
  );

  if (zoneRooms.length === 0) return null;

  // Governing (max summer/monsoon) — matches the project card's peak / TFA-capacity basis.
  const govTR    = monsoon ? Math.max(summer.totalTR, monsoon.totalTR) : summer.totalTR;
  const govTfaTR = monsoon ? Math.max(summer.totalTfaCoilTR, monsoon.totalTfaCoilTR) : summer.totalTfaCoilTR;
  const govCfm   = monsoon ? Math.max(summer.totalDesignCfm, monsoon.totalDesignCfm) : summer.totalDesignCfm;
  const t = summer;

  return (
    <span className="hidden md:flex items-center gap-2 rounded-full border border-orange-200 dark:border-orange-800 bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 px-2.5 py-1 text-xs font-semibold text-orange-700 dark:text-orange-400 flex-shrink-0 shadow-sm">
      <span title="Space (primary coil) TR — governing season">{govTR.toFixed(2)} TR</span>
      {govTfaTR > 0 && (
        <>
          <span className="h-3 w-px bg-orange-200" />
          <span className="text-teal-700 dark:text-teal-400" title="TFA/DOAS coil TR (fresh-air conditioning) — governing season">+{govTfaTR.toFixed(1)} TFA</span>
        </>
      )}
      <span className="h-3 w-px bg-orange-200" />
      <span>{Math.round(govCfm)} CFM</span>
      {t.totalHeating > 0 && (
        <>
          <span className="h-3 w-px bg-orange-200" />
          <span className="text-sky-700 dark:text-sky-400" title="Winter heating load (space)">
            {Math.round(t.totalHeating).toLocaleString()} BTU/h <span className="opacity-70">heat</span>
          </span>
        </>
      )}
      {t.totalTfaWinterHeating > 0 && (
        <>
          <span className="h-3 w-px bg-orange-200" />
          <span className="text-teal-700 dark:text-teal-400" title="TFA/DOAS fresh-air winter heating coil (DOAS duty)">
            +{Math.round(t.totalTfaWinterHeating).toLocaleString()} BTU/h <span className="opacity-70">TFA heat</span>
          </span>
        </>
      )}
    </span>
  );
}

// ─── Main ZoneList component ───────────────────────────────────────────────────

const ZoneList = ({
  systems,
  zones,
  rooms,
  liveRooms,
  envelopeElements,
  expandedZone,
  setExpandedZone,
  expandedSystem,
  setExpandedSystem,
  expandedRoom,
  setExpandedRoom,
  addZone,
  addRoom,
  updateZone,
  updateSystem,
  deleteZone,
  deleteSystem,
  updateRoom,
  deleteRoom,
  addEnvelopeElement,
  updateEnvelopeElement,
  deleteEnvelopeElement,
  saveEnvelopeChanges,
  onRoomDraftChange,
  onEnvelopeDraftChange,
  onZoneConditionDraftsChange,
  project,
  defaultDesignConditions,
  canEdit,
  roomSaveStates,
  userProfile,
  moveRoom,
  equipSystems,
  setRoomFreshAir,
  setZoneFreshAir,
}: any) => {
  const isChiller = String(project?.systemType || '').toLowerCase().includes('chiller');
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, string>>({});
  const [savingZoneOverrideId, setSavingZoneOverrideId] = useState<string | null>(null);
  const [zoneUIExpanded, setZoneUIExpanded] = useState<Record<string, { overrides: boolean; summary: boolean }>>({});
  const getZoneUI = (id: string) => zoneUIExpanded[id] ?? { overrides: false, summary: false };
  const toggleZoneUI = (id: string, key: 'overrides' | 'summary') =>
    setZoneUIExpanded(prev => ({ ...prev, [id]: { ...getZoneUI(id), [key]: !getZoneUI(id)[key] } }));

  // ── Bulk move state ──────────────────────────────────────────────────────────
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkSourceZoneId, setBulkSourceZoneId] = useState<string | null>(null);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkTargetZoneId, setBulkTargetZoneId] = useState<string>('');
  const [bulkMoving, setBulkMoving] = useState(false);
  const bulkDialogRef = useRef<HTMLDivElement>(null);

  const openBulkMove = (zoneId: string) => {
    setBulkSourceZoneId(zoneId);
    setBulkSelected(new Set());
    setBulkTargetZoneId('');
    setBulkOpen(true);
  };
  const setBulkOpen = (v: boolean) => { setBulkMoveOpen(v); if (!v) { setBulkSourceZoneId(null); setBulkSelected(new Set()); setBulkTargetZoneId(''); } };

  const handleBulkMove = async () => {
    if (!bulkSourceZoneId || bulkSelected.size === 0 || !bulkTargetZoneId) return;
    if (!moveRoom) { toast.error('Move not available'); return; }
    setBulkMoving(true);
    const sourceRooms = (rooms[bulkSourceZoneId] || []).filter((r: any) => bulkSelected.has(r.id));
    let ok = 0;
    let fail = 0;
    for (const room of sourceRooms) {
      try {
        await moveRoom(room, bulkSourceZoneId, bulkTargetZoneId);
        ok++;
      } catch {
        fail++;
      }
    }
    setBulkMoving(false);
    setBulkOpen(false);
    if (ok > 0) toast.success(`Moved ${ok} room${ok > 1 ? 's' : ''} successfully`);
    if (fail > 0) toast.error(`${fail} room${fail > 1 ? 's' : ''} failed to move`);
  };

  // All zones + systems for the target dropdown (exclude source)
  const allZonesForMove = useMemo(() => {
    const list: { id: string; name: string }[] = [];
    (systems || []).forEach((s: any) => list.push({ id: s.id, name: s.name }));
    (zones || []).filter((z: any) => !z.systemId).forEach((z: any) => list.push({ id: z.id, name: z.name }));
    return list;
  }, [systems, zones]);

  const dc: DesignConditions = defaultDesignConditions ?? {
    outdoorTemp: 95,
    indoorTemp: 75,
    outdoorHumidity: 50,
    indoorHumidity: 50,
    altitude: 0,
    winterOutdoorTemp: 40,
    winterOutdoorHumidity: 30,
    winterIndoorTemp: project?.insideWinterTemp ?? project?.data?.insideWinterTemp ?? 72,
    winterIndoorHumidity: project?.insideWinterHumidity ?? project?.data?.insideWinterHumidity ?? 40,
  };

  const overrideKey = (zoneId: string, field: string) => `${zoneId}:${field}`;
  const systemIds = useMemo(() => new Set((systems || []).map((system: any) => system.id)), [systems]);
  const dirtyZoneIds = useMemo(() => {
    const ids = new Set<string>();
    Object.keys(overrideDrafts).forEach((key) => {
      const [zoneId] = key.split(':');
      if (zoneId) ids.add(zoneId);
    });
    return ids;
  }, [overrideDrafts]);
  const hasDirtyZoneOverrides = dirtyZoneIds.size > 0;

  const zoneConditionDrafts = useMemo(() => {
    const zoneDraftMap: Record<string, Record<string, number | undefined>> = {};
    const systemDraftMap: Record<string, Record<string, number | undefined>> = {};

    for (const [key, rawValue] of Object.entries(overrideDrafts)) {
      const [recordId, field] = key.split(':');
      if (!ZONE_OVERRIDE_FIELDS.includes(field as ZoneOverrideField)) continue;

      const trimmed = rawValue.trim();
      if (trimmed !== '' && !Number.isFinite(Number(trimmed))) continue;

      const target = systemIds.has(recordId) ? systemDraftMap : zoneDraftMap;
      target[recordId] = {
        ...(target[recordId] || {}),
        [field]: trimmed === '' ? undefined : Number(trimmed),
      };
    }

    return {
      zoneDraftMap,
      systemDraftMap,
    };
  }, [overrideDrafts, systemIds]);

  useEffect(() => {
    onZoneConditionDraftsChange?.(zoneConditionDrafts.zoneDraftMap, zoneConditionDrafts.systemDraftMap);
  }, [onZoneConditionDraftsChange, zoneConditionDrafts]);

  useEffect(() => {
    return () => {
      onZoneConditionDraftsChange?.({}, {});
    };
  }, [onZoneConditionDraftsChange]);

  useEffect(() => {
    if (!hasDirtyZoneOverrides) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasDirtyZoneOverrides]);

  const getOverrideInputValue = (zone: any, zoneId: string, field: string, fallback: number) => {
    const key = overrideKey(zoneId, field);
    if (Object.prototype.hasOwnProperty.call(overrideDrafts, key)) {
      return overrideDrafts[key];
    }
    const value = zone?.[field];
    return value === undefined || value === null ? String(fallback) : String(value);
  };

  const setOverrideDraft = (zoneId: string, field: string, value: string) => {
    const key = overrideKey(zoneId, field);
    setOverrideDrafts((prev) => ({ ...prev, [key]: value }));
  };

  const clearOverrideDraft = (zoneId: string, field: string) => {
    const key = overrideKey(zoneId, field);
    setOverrideDrafts((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, key)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const clearZoneOverrideDrafts = (zoneId: string) => {
    setOverrideDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const field of ZONE_OVERRIDE_FIELDS) {
        const key = overrideKey(zoneId, field);
        if (Object.prototype.hasOwnProperty.call(next, key)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  };

  const applyOverrideUpdate = (zoneId: string, isSystem: boolean, data: Record<string, any>, systemId?: string) => {
    if (isSystem) {
      return updateSystem(zoneId, data);
    }
    return updateZone(zoneId, data, systemId);
  };

  const queueZoneDefaultsReset = (zoneId: string) => {
    setOverrideDrafts((prev) => {
      const next = { ...prev };
      for (const field of ZONE_OVERRIDE_FIELDS) {
        next[overrideKey(zoneId, field)] = '';
      }
      return next;
    });
  };

  const getZoneDraftPayload = (zoneId: string) => {
    const payload: Record<string, number | undefined> = {};
    for (const field of ZONE_OVERRIDE_FIELDS) {
      const key = overrideKey(zoneId, field);
      if (!Object.prototype.hasOwnProperty.call(overrideDrafts, key)) continue;

      const trimmed = overrideDrafts[key].trim();
      if (trimmed === '') {
        payload[field] = undefined;
        continue;
      }

      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        return { valid: false, invalidField: field, payload: null };
      }

      payload[field] = parsed;
    }

    return { valid: true, invalidField: null, payload };
  };

  const handleUpdateZoneOverrides = async (zoneId: string, isSystem: boolean, systemId?: string) => {
    const result = getZoneDraftPayload(zoneId);
    if (!result.valid || !result.payload) {
      toast.error(`Enter a valid number for ${result.invalidField}.`);
      return;
    }

    if (Object.keys(result.payload).length === 0) {
      clearZoneOverrideDrafts(zoneId);
      return;
    }

    setSavingZoneOverrideId(zoneId);
    try {
      await applyOverrideUpdate(zoneId, isSystem, result.payload, systemId);
      clearZoneOverrideDrafts(zoneId);
    } finally {
      setSavingZoneOverrideId((prev) => (prev === zoneId ? null : prev));
    }
  };

  const blockDirtyZoneNavigation = (nextZoneId?: string | null) => {
    if (!hasDirtyZoneOverrides) return false;
    if (nextZoneId && dirtyZoneIds.size === 1 && dirtyZoneIds.has(nextZoneId)) return false;
    toast.error('Update or cancel the zone override changes before leaving this zone.');
    return true;
  };

  const renderZone = (zone: any, systemId?: string, overrideRooms?: any[], forceRoomTable?: boolean) => {
    const isSystem = zone.description !== undefined;
    const zoneId = zone.id;
    const isOpen = expandedZone === zoneId;
    // For system rows, callers pass aggregated rooms from all sub-zones so the count reflects the total.
    const zoneRooms: any[] = overrideRooms ?? (rooms[zoneId] || []);
    const liveZoneRooms: any[] = liveRooms?.[zoneId] || zoneRooms;
    const effectiveZone = {
      ...zone,
      ...((isSystem ? zoneConditionDrafts.systemDraftMap[zoneId] : zoneConditionDrafts.zoneDraftMap[zoneId]) || {}),
    };
    const zoneOverrideDirty = ZONE_OVERRIDE_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(overrideDrafts, overrideKey(zoneId, field)));
    const isSavingZoneOverride = savingZoneOverrideId === zoneId;

    // Per-zone DC: override indoor conditions when the zone has explicit values
    const zoneDc: DesignConditions = {
      ...dc,
      indoorTemp:     effectiveZone.indoorTemp     ?? dc.indoorTemp,
      indoorHumidity: effectiveZone.indoorHumidity ?? dc.indoorHumidity,
      winterIndoorTemp: effectiveZone.winterIndoorTemp ?? dc.winterIndoorTemp,
      winterIndoorHumidity: effectiveZone.winterIndoorHumidity ?? dc.winterIndoorHumidity,
      altitude:       dc.altitude,
    };
    const hasZoneIndoorOverride =
      effectiveZone.indoorTemp !== undefined ||
      effectiveZone.indoorHumidity !== undefined ||
      effectiveZone.winterIndoorTemp !== undefined ||
      effectiveZone.winterIndoorHumidity !== undefined;

    const { overrides: showOverrides, summary: showSummary } = getZoneUI(zoneId);

    const lcZoneRoomIds = new Set(zoneRooms.map((r: any) => r.id));
    const zoneHasEquipment = (equipSystems ?? []).some((sys: any) => {
      // Zone-level IDU selections matched by room membership
      if ((sys.zones ?? []).some((eqZone: any) =>
        (eqZone.roomIds ?? []).some((rid: string) => lcZoneRoomIds.has(rid)) &&
        ((eqZone.unitSelections?.length ?? 0) > 0 || !!eqZone.selection)
      )) return true;
      // Room-level selections (Split)
      if (zoneRooms.some((r: any) => (sys.roomSelections?.[r.id]?.length ?? 0) > 0)) return true;
      // iduSelections (legacy per-room)
      return zoneRooms.some((r: any) => {
        const sel = sys.iduSelections?.[r.id];
        return sel && (Array.isArray(sel) ? sel.length > 0 : !!sel);
      });
    });

    // For system rows: detect whether the plant/ODU has been selected at the system level.
    // Uses type-specific data shape on the ES system doc.
    const systemPlantInfo = isSystem ? (() => {
      const sys = (equipSystems ?? []).find((s: any) => s.id === zoneId);
      if (!sys) return { has: false, label: 'ODU/Plant' };
      const t = String(sys.type ?? '');
      if (t === 'VRF')     return { has: !!sys.oduSelection, label: 'ODU' };
      if (t === 'Chiller') return { has: (sys.chillerUnits?.length ?? 0) > 0 || !!sys.unitSelection, label: 'Plant' };
      if (t === 'AHU')     return { has: (sys.ahuUnits?.length ?? 0) > 0 || !!sys.unitSelection, label: 'Condensing Unit' };
      if (t === 'Package' || t === 'DuctableSplit') return { has: !!sys.unitSelection, label: 'Unit' };
      if (t === 'DOAS')    return { has: !!sys.unitSelection, label: 'TFA/DOAS Unit' };
      if (t === 'Split') {
        const sels = sys.roomSelections ?? {};
        return { has: Object.values(sels).some((v: any) => (Array.isArray(v) ? v.length > 0 : !!v)), label: 'Per-Room ODU' };
      }
      return { has: false, label: 'ODU/Plant' };
    })() : { has: false, label: 'ODU/Plant' };

    return (
      <ZoneDropContainer key={zoneId} zoneId={zoneId}>
        {/* Zone header row */}
        <div
          className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none transition-colors border-l-2 ${
            isOpen ? 'bg-orange-50 dark:bg-orange-950/20 border-l-orange-500' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50 border-l-transparent'
          }`}
          onClick={() => {
            if (blockDirtyZoneNavigation(isOpen ? null : zoneId)) return;
            setExpandedZone(isOpen ? null : zoneId);
          }}
        >
          {/* Expand icon */}
          <span className="text-gray-400 dark:text-slate-500 flex-shrink-0">
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </span>

          {/* Zone name */}
          <input
            value={zone.name}
            title="Zone name"
            aria-label="Zone name"
            className="flex-1 min-w-0 font-semibold text-sm text-slate-900 dark:text-slate-100 bg-transparent border-none outline-none focus:ring-0 p-0 placeholder:text-slate-400"
            onClick={e => e.stopPropagation()}
            onChange={e =>
              isSystem
                ? updateSystem(zoneId, { name: e.target.value })
                : updateZone(zoneId, { name: e.target.value }, systemId)
            }
          />

          {/* System type badge — legacy VRF system or SD equipment system */}
          {isSystem && (() => {
            const sysType: string = String(zone.type ?? 'VRF');
            const badgeCls =
              sysType === 'Chiller'        ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400' :
              sysType === 'AHU'            ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400' :
              sysType === 'Package' || sysType === 'DuctableSplit' ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400' :
              sysType === 'Split'          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
              sysType === 'DOAS'           ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400' :
              'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400';
            return (
              <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0 ${badgeCls}`}>
                {sysType} System
              </span>
            );
          })()}
          {!isSystem && zone.type && (
            <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0 ${
              zone.type === 'VRF'     ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
              zone.type === 'Chiller' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400' :
              zone.type === 'AHU'    ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400' :
              zone.type === 'Package' || zone.type === 'DuctableSplit' ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400' :
              zone.type === 'Split'  ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
              'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
            }`}>
              {zone.type}
            </span>
          )}

          {/* Expanded: inline toggle buttons + equipment status.
              Zone-only controls (overrides, summary, IDU status) are hidden on system rows.
              System rows show ODU / Plant selection status instead. */}
          {isOpen && !isSystem && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleZoneUI(zoneId, 'overrides'); }}
                className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex-shrink-0 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
              >
                {showOverrides ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
                Inside Design Override
                {hasZoneIndoorOverride && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" />}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleZoneUI(zoneId, 'summary'); }}
                className="flex items-center gap-1 text-[11px] text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 flex-shrink-0 border border-orange-200 dark:border-orange-700 rounded px-1.5 py-0.5 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"
              >
                {showSummary ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
                Zone Summary
              </button>
              {zoneHasEquipment ? (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-green-600 dark:text-green-400 flex-shrink-0 border border-green-200 dark:border-green-800 rounded px-1.5 py-0.5 bg-green-50 dark:bg-green-900/20">
                  ✓ IDU Selected
                </span>
              ) : (
                <span className="text-[11px] text-slate-400 dark:text-slate-500 flex-shrink-0 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5">
                  No IDU
                </span>
              )}
            </>
          )}
          {isOpen && isSystem && (
            systemPlantInfo.has ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-green-600 dark:text-green-400 flex-shrink-0 border border-green-200 dark:border-green-800 rounded px-1.5 py-0.5 bg-green-50 dark:bg-green-900/20">
                ✓ {systemPlantInfo.label} Selected
              </span>
            ) : (
              <span className="text-[11px] text-slate-400 dark:text-slate-500 flex-shrink-0 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5">
                No {systemPlantInfo.label}
              </span>
            )
          )}

          {/* Room count */}
          <span className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0 rounded bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 font-medium">
            {zoneRooms.length} room{zoneRooms.length !== 1 ? 's' : ''}
          </span>

          {/* Collapsed summary badge */}
          {!isOpen && (
            <ZoneCollapsedBadge
              zoneRooms={liveZoneRooms}
              envelopeElements={envelopeElements}
              dc={zoneDc}
              isChiller={isChiller}
              equipSystems={equipSystems}
              project={project}
            />
          )}

          {/* Actions */}
          {canEdit && (
            <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => addRoom(zoneId, systemId)}
                className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 px-2 py-1 rounded font-medium transition-colors border border-blue-100 dark:border-blue-800"
              >
                <Plus className="w-3 h-3" /> Add Room
              </button>
              {zoneRooms.length > 0 && moveRoom && (
                <button
                  type="button"
                  onClick={() => openBulkMove(zoneId)}
                  className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-violet-700 dark:hover:text-violet-400 bg-slate-50 dark:bg-slate-700/50 hover:bg-violet-50 dark:hover:bg-violet-900/20 px-2 py-1 rounded font-medium transition-colors border border-slate-200 dark:border-slate-600 hover:border-violet-200 dark:hover:border-violet-700"
                  title="Move rooms to another zone"
                >
                  <ArrowRight className="w-3 h-3" /> Move
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (blockDirtyZoneNavigation(null)) return;
                  isSystem ? deleteSystem(zoneId) : deleteZone(zoneId, systemId);
                }}
                className="p-1.5 text-gray-300 hover:text-red-500 rounded transition-colors"
                title="Delete zone"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Expanded: zone inside-design override + room table + zone summary */}
        {isOpen && (
          <>
            {/* Inside design conditions — shown when toggled from zone header */}
            {showOverrides && (
            <div className="border-t border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80 px-4 py-3">
              {(zoneOverrideDirty || hasZoneIndoorOverride) && (
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Inside Design Overrides</span>
                  {zoneOverrideDirty ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-amber-700">Unsaved override changes are applied live to calculations.</span>
                      <button
                        type="button"
                        onClick={() => clearZoneOverrideDrafts(zoneId)}
                        className="h-7 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUpdateZoneOverrides(zoneId, isSystem, systemId)}
                        disabled={isSavingZoneOverride}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-blue-300 bg-blue-600 px-2.5 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSavingZoneOverride && <Loader2 className="h-3 w-3 animate-spin" />}
                        Update
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => queueZoneDefaultsReset(zoneId)}
                      className="text-[10px] text-red-500 hover:text-red-600 underline"
                    >
                      Reset to project defaults
                    </button>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50/70 dark:bg-orange-950/20 px-3 py-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-400">Summer / Monsoon</span>
                    <span className="text-[10px] text-orange-500 dark:text-orange-400">Monsoon follows summer override</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">Temp (°F)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        title="Indoor design temperature for this zone"
                        value={getOverrideInputValue(zone, zoneId, 'indoorTemp', dc.indoorTemp ?? 75)}
                        onChange={e => setOverrideDraft(zoneId, 'indoorTemp', e.target.value)}
                        className="h-8 w-full text-xs border border-orange-200 dark:border-orange-800 rounded px-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-orange-400"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">RH (%)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        title="Indoor relative humidity for this zone"
                        value={getOverrideInputValue(zone, zoneId, 'indoorHumidity', dc.indoorHumidity ?? 50)}
                        onChange={e => setOverrideDraft(zoneId, 'indoorHumidity', e.target.value)}
                        className="h-8 w-full text-xs border border-orange-200 dark:border-orange-800 rounded px-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-orange-400"
                      />
                    </label>
                  </div>
                </div>

                <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/20 px-3 py-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">Winter</span>
                    <span className="text-[10px] text-blue-500 dark:text-blue-400">Used for heating analysis</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">Temp (°F)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        title="Winter indoor design temperature for this zone"
                        value={getOverrideInputValue(zone, zoneId, 'winterIndoorTemp', zoneDc.winterIndoorTemp ?? dc.winterIndoorTemp ?? 72)}
                        onChange={e => setOverrideDraft(zoneId, 'winterIndoorTemp', e.target.value)}
                        className="h-8 w-full text-xs border border-blue-200 dark:border-blue-800 rounded px-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">RH (%)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        title="Winter indoor relative humidity for this zone"
                        value={getOverrideInputValue(zone, zoneId, 'winterIndoorHumidity', zoneDc.winterIndoorHumidity ?? dc.winterIndoorHumidity ?? 40)}
                        onChange={e => setOverrideDraft(zoneId, 'winterIndoorHumidity', e.target.value)}
                        className="h-8 w-full text-xs border border-blue-200 dark:border-blue-800 rounded px-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>
            )}

            {/* For VRF/Chiller/etc system rows, child zones are rendered below the card —
                don't repeat the room table here. For Split/DOAS systems, the caller passes
                forceRoomTable=true since those systems list rooms directly (no zone layer). */}
            {(forceRoomTable || !isSystem) && (
              <div className="border-t border-gray-100 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50">
                {setZoneFreshAir && zoneRooms.length > 0 && (
                  <div className="px-4 py-2 flex items-center gap-2 text-xs border-b border-gray-100 dark:border-slate-700/50">
                    <span className="text-slate-500 dark:text-slate-400">Set all rooms&rsquo; fresh air:</span>
                    <select
                      className="h-7 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-200 px-2 cursor-pointer"
                      value=""
                      title="Apply one fresh-air mode to every room in this zone"
                      onChange={(e) => { const v = e.target.value; if (v) { void setZoneFreshAir(liveZoneRooms, v); e.currentTarget.value = ''; } }}
                    >
                      <option value="">— choose —</option>
                      <option value="no-tfa">On the room unit</option>
                      <option value="tfa-served">Central cold TFA</option>
                      <option value="tfa-only">TFA-only (corridor)</option>
                    </select>
                  </div>
                )}
                <RoomTable
                  rooms={zoneRooms}
                  liveRooms={liveZoneRooms}
                  zoneId={zoneId}
                  systemId={systemId}
                  expandedRoom={expandedRoom}
                  setExpandedRoom={setExpandedRoom}
                  updateRoom={updateRoom}
                  deleteRoom={deleteRoom}
                  addEnvelopeElement={addEnvelopeElement}
                  updateEnvelopeElement={updateEnvelopeElement}
                  deleteEnvelopeElement={deleteEnvelopeElement}
                  saveEnvelopeChanges={saveEnvelopeChanges}
                  envelopeElements={envelopeElements}
                  project={project}
                  designConditions={zoneDc}
                  roomSaveStates={roomSaveStates}
                  onRoomDraftChange={onRoomDraftChange}
                  onEnvelopeDraftChange={onEnvelopeDraftChange}
                  userId={userProfile?.uid}
                  equipSystems={equipSystems}
                  setRoomFreshAir={setRoomFreshAir}
                />
              </div>
            )}
            {showSummary && (
              <ZoneSummaryBar
                zoneRooms={liveZoneRooms}
                envelopeElements={envelopeElements}
                dc={zoneDc}
                isChiller={isChiller}
                project={project}
                zoneId={zoneId}
                zoneName={zone.name}
                equipSystems={equipSystems}
              />
            )}
          </>
        )}
      </ZoneDropContainer>
    );
  };

  // Group zones into a System > Zone > Room tree:
  //  • System rows (description present) render at the top level
  //  • Sub-zones (zone.systemId set) render indented under their parent system
  //  • Orphan zones (no description, no systemId) render at the top level
  const isSystemRow = (z: any) => z.description !== undefined;
  const systemRows = zones.filter(isSystemRow);
  const childZonesBySystem: Record<string, any[]> = {};
  const orphanZones: any[] = [];
  for (const z of zones) {
    if (isSystemRow(z)) continue;
    if (z.systemId) {
      (childZonesBySystem[z.systemId] ||= []).push(z);
    } else {
      orphanZones.push(z);
    }
  }
  // Sub-zones whose parent system isn't in `zones` get rendered flat too (defensive)
  const knownSystemIds = new Set(systemRows.map((s: any) => s.id));
  for (const sysId of Object.keys(childZonesBySystem)) {
    if (!knownSystemIds.has(sysId)) {
      orphanZones.push(...childZonesBySystem[sysId]);
      delete childZonesBySystem[sysId];
    }
  }

  return (
    <div className="space-y-3">
      {systemRows.map((sys: any) => {
        // Split & DOAS: rooms live directly under the system (no zone layer). Render
        // the system card with a flat room table inline; skip the child-zone wrapper.
        const isFlatSystem = sys.type === 'Split' || sys.type === 'DOAS';
        if (isFlatSystem) {
          const flatRooms = rooms[sys.id] ?? [];
          return (
            <div
              key={sys.id}
              className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/15 overflow-hidden shadow-sm"
            >
              {renderZone(sys, undefined, flatRooms, true /* forceRoomTable */)}
              {flatRooms.length === 0 && (
                <div className="bg-white dark:bg-slate-800 border-t border-blue-200 dark:border-blue-800 px-4 py-3 text-xs italic text-slate-400 dark:text-slate-500">
                  No rooms yet — assign rooms to this system from the Equipment Selection page.
                </div>
              )}
            </div>
          );
        }

        const childZones = childZonesBySystem[sys.id] ?? [];
        // Aggregate rooms across all sub-zones so the system header room count reflects the total
        const aggregatedRooms = childZones.flatMap((z: any) => rooms[z.id] ?? []);
        return (
          <div
            key={sys.id}
            className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/15 overflow-hidden shadow-sm"
          >
            {renderZone(sys, undefined, aggregatedRooms)}
            {childZones.length > 0 && (
              <div className="bg-white dark:bg-slate-800 border-t border-blue-200 dark:border-blue-800 pl-6 ml-3 my-1 border-l-2 border-blue-300 dark:border-blue-700 divide-y divide-gray-100 dark:divide-slate-700">
                {childZones.map((z: any) => renderZone(z, sys.id))}
              </div>
            )}
            {childZones.length === 0 && (
              <div className="bg-white dark:bg-slate-800 border-t border-blue-200 dark:border-blue-800 pl-6 ml-3 my-1 border-l-2 border-blue-300 dark:border-blue-700 px-4 py-3 text-xs italic text-slate-400 dark:text-slate-500">
                No zones yet — click &ldquo;+ Add Zone&rdquo; below to create the first one.
              </div>
            )}
            {canEdit && addZone && (
              <div className="bg-white dark:bg-slate-800 border-t border-blue-200 dark:border-blue-800 px-4 py-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => void addZone(sys.id)}
                  className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 px-2.5 py-1 rounded border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors flex items-center gap-1"
                  title={`Add a new zone to ${sys.name}`}
                >
                  <Plus className="w-3 h-3" /> Add Zone to {sys.name}
                </button>
              </div>
            )}
          </div>
        );
      })}
      {orphanZones.length > 0 && (
        <div className="rounded-lg border border-gray-100 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-700 overflow-hidden">
          {orphanZones.map((zone: any) => renderZone(zone, undefined))}
        </div>
      )}

      {/* ── Bulk Move Dialog ─────────────────────────────────────────────────── */}
      {bulkMoveOpen && bulkSourceZoneId && (() => {
        const sourceRooms: any[] = rooms[bulkSourceZoneId] || [];
        const sourceName = allZonesForMove.find(z => z.id === bulkSourceZoneId)?.name ?? 'Zone';
        const targets = allZonesForMove.filter(z => z.id !== bulkSourceZoneId);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div ref={bulkDialogRef} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b dark:border-slate-700">
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Move Rooms</h3>
                  <p className="text-xs text-slate-400 dark:text-slate-400 mt-0.5">From: <span className="font-semibold text-slate-600 dark:text-slate-300">{sourceName}</span></p>
                </div>
                <button onClick={() => setBulkOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg font-bold leading-none">×</button>
              </div>

              {/* Room checkboxes */}
              <div className="overflow-y-auto flex-1 px-5 py-3 space-y-1">
                {sourceRooms.length === 0 && <p className="text-xs text-slate-400 italic">No rooms in this zone.</p>}
                {/* Select all */}
                {sourceRooms.length > 1 && (
                  <label className="flex items-center gap-2.5 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 cursor-pointer select-none border-b dark:border-slate-700 mb-1 pb-2">
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5 rounded accent-violet-600"
                      checked={bulkSelected.size === sourceRooms.length}
                      onChange={e => setBulkSelected(e.target.checked ? new Set(sourceRooms.map((r: any) => r.id)) : new Set())}
                    />
                    Select all ({sourceRooms.length})
                  </label>
                )}
                {sourceRooms.map((r: any) => (
                  <label key={r.id} className="flex items-center gap-2.5 py-1.5 text-sm text-slate-700 dark:text-slate-300 cursor-pointer select-none hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded px-1">
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5 rounded accent-violet-600"
                      checked={bulkSelected.has(r.id)}
                      onChange={e => setBulkSelected(prev => {
                        const next = new Set(prev);
                        e.target.checked ? next.add(r.id) : next.delete(r.id);
                        return next;
                      })}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="truncate block">{r.name || r.id}</span>
                      {r.floor && <span className="text-[10px] text-slate-400">{r.floor} Floor</span>}
                    </span>
                    {r._calcRequiredTR > 0 && (
                      <span className="text-[10px] text-slate-400 font-mono shrink-0">{Number(r._calcRequiredTR).toFixed(2)} TR</span>
                    )}
                  </label>
                ))}
              </div>

              {/* Target zone + action */}
              <div className="px-5 py-4 border-t dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 rounded-b-2xl space-y-3">
                <div className="flex items-center gap-2">
                  <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">Move to:</label>
                  <select
                    className="flex-1 text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-violet-400 outline-none"
                    value={bulkTargetZoneId}
                    onChange={e => setBulkTargetZoneId(e.target.value)}
                  >
                    <option value="">— select zone —</option>
                    {targets.map(z => (
                      <option key={z.id} value={z.id}>{z.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setBulkOpen(false)}
                    className="px-4 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleBulkMove}
                    disabled={bulkSelected.size === 0 || !bulkTargetZoneId || bulkMoving}
                    className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {bulkMoving ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
                    {bulkMoving ? 'Moving…' : `Move ${bulkSelected.size > 0 ? bulkSelected.size : ''} Room${bulkSelected.size !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default ZoneList;
