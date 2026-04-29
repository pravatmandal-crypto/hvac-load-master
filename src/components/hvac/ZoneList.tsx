import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, PackagePlus, Loader2 } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import RoomTable from './RoomTable';
import EquipmentPickerDialog from './EquipmentPickerDialog';
import { toast } from 'sonner';
import {
  calculateRoomVolume,
  calculateEnvelopeGain,
  calculateInternalGains,
  calculateVentilationLoad,
  calculateCoilParameters,
  calculateParasiticGains,
  calculateHeatingLoad,
  getRecommendedAch,
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
      className={isOver ? 'ring-2 ring-blue-300 ring-inset bg-blue-50/40' : ''}
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
) {
  let totalCooling = 0;
  let totalHeating = 0;
  let totalDehumCfm = 0;
  let totalOaCfm = 0;
  let totalSupplyCfm = 0;
  let totalDesignCfm = 0;
  let totalArea = 0;

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
      const heating = calculateHeatingLoad(rd, elements, dc);

      const erSensible = envelope.sensible + internal.sensible + vent.sensible * BF;
      const erLatent = internal.latent + vent.latent * BF;
      const ductPct = Number(room.ductGainPct) || 2;
      const fanPct = Number(room.fanGainPct) || 3;
      const sensibleSafetyPct = Number(room.sensibleSafetyPercent ?? room.sensibleSafetyFactor ?? 10);
      const latentSafetyPct = Number(room.latentSafetyPercent ?? room.latentSafetyFactor ?? 5);
      const overallSafetyPct = Number(room.overallSafetyPercent ?? room.grandTotalSafetyFactor ?? 3);
      const parasitic = calculateParasiticGains(erSensible, erSensible, ductPct, fanPct);

      const ersh = (erSensible + parasitic.ductGain + parasitic.fanGain) * (1 + sensibleSafetyPct / 100);
      const erlh = erLatent * (1 + latentSafetyPct / 100);
      const oaSensible = vent.sensible * (1 - BF);
      const oaLatent = vent.latent * (1 - BF);
      const coilSensible = ersh + oaSensible;
      const coilLatent = erlh + oaLatent;
      const coil = calculateCoilParameters(
        coilSensible,
        coilLatent,
        dc.indoorTemp,
        dc.indoorHumidity,
        dc.altitude || 0,
        BF,
        35,
        65,
        isChiller ? 50 : 54,
      );
      const grandTotal = (coilSensible + coilLatent) * (1 + overallSafetyPct / 100);

      const presetTotalACH = getRecommendedAch(room.achProfile ?? room.activityType);
      const effectiveTotalACH = Math.max(presetTotalACH, rd.facph);
      const totalSupplyCFM = (calculateRoomVolume(rd) * effectiveTotalACH) / 60;
      const designCFM = Math.max(coil.dehumidifiedCFM, totalSupplyCFM);

      if (isFinite(grandTotal)) totalCooling += grandTotal;
      if (isFinite(heating.totalHeatingLoad)) totalHeating += heating.totalHeatingLoad;
      if (isFinite(coil.dehumidifiedCFM)) totalDehumCfm += coil.dehumidifiedCFM;
      if (isFinite(vent.cfm)) totalOaCfm += vent.cfm;
      if (isFinite(totalSupplyCFM)) totalSupplyCfm += totalSupplyCFM;
      if (isFinite(designCFM)) totalDesignCfm += designCFM;
      totalArea += rd.length * rd.width;
    } catch {
      // skip room if calculation fails — don't crash the whole component
    }
  }

  return {
    totalCooling,
    totalTR: totalCooling / 12000,
    totalHeating,
    totalDehumCfm,
    totalOaCfm,
    totalSupplyCfm,
    totalDesignCfm,
    totalArea,
  };
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
}: {
  zoneRooms: any[];
  envelopeElements: Record<string, any[]>;
  dc: DesignConditions;
  isChiller: boolean;
  project?: any;
  zoneId?: string;
  zoneName?: string;
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
    () => computeZoneTotals(zoneRooms, envelopeElements, dc, isChiller),
    [zoneRooms, envelopeElements, dc, isChiller],
  );
  const monsoonTotals = useMemo(
    () => (includeMonsoon ? computeZoneTotals(zoneRooms, envelopeElements, monsoonDc, isChiller) : null),
    [zoneRooms, envelopeElements, monsoonDc, isChiller, includeMonsoon],
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  if (zoneRooms.length === 0) return null;
  const n = (v: number) => Math.round(v).toLocaleString();
  const summerCfmTR = summerTotals.totalDesignCfm > 0 ? (summerTotals.totalDesignCfm * 1.08 * 20) / 12000 : 0;
  const monsoonCfmTR = monsoonTotals && monsoonTotals.totalDesignCfm > 0 ? (monsoonTotals.totalDesignCfm * 1.08 * 20) / 12000 : 0;
  const summerGoverningTR = Math.max(summerTotals.totalTR, summerCfmTR);
  const monsoonGoverningTR = monsoonTotals ? Math.max(monsoonTotals.totalTR, monsoonCfmTR) : 0;
  const governingLoadSeason = includeMonsoon && monsoonTotals && monsoonTotals.totalTR > summerTotals.totalTR ? 'Monsoon' : 'Summer';
  const governingAirflowSeason = includeMonsoon && monsoonTotals && monsoonCfmTR > summerCfmTR ? 'Monsoon' : 'Summer';
  const governingLoadTR = includeMonsoon && monsoonTotals ? Math.max(summerTotals.totalTR, monsoonTotals.totalTR) : summerTotals.totalTR;
  const governingCfmTR = includeMonsoon && monsoonTotals ? Math.max(summerCfmTR, monsoonCfmTR) : summerCfmTR;
  const governingTR = Math.max(governingLoadTR, governingCfmTR);
  const peakSeason = governingTR === governingCfmTR ? governingAirflowSeason : governingLoadSeason;
  const t = peakSeason === 'Monsoon' && monsoonTotals ? monsoonTotals : summerTotals;
  const governingDesignCfm = includeMonsoon && monsoonTotals
    ? Math.max(summerTotals.totalDesignCfm, monsoonTotals.totalDesignCfm)
    : summerTotals.totalDesignCfm;
  const requiredTR = governingTR * 1.10;
  const achGovernsAirflow = governingCfmTR >= governingLoadTR;

  return (
    <>
      <div className="border-t border-orange-100 bg-gradient-to-r from-white via-orange-50/50 to-amber-50/70 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-700">Zone Summary</span>
              <span className="rounded-full border border-orange-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-orange-700">{zoneRooms.length} room{zoneRooms.length !== 1 ? 's' : ''}</span>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">AHU Basis: {peakSeason}</span>
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">{governingTR === governingCfmTR ? 'CFM Gov' : 'Load Gov'}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
              <div className="rounded-lg border border-orange-200 bg-white px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-700">Summer Cooling</p>
                <p className="mt-1 font-mono text-lg font-bold text-orange-900">{summerGoverningTR.toFixed(2)} <span className="text-[11px] font-semibold text-orange-600">TR</span></p>
                <p className="text-[10px] text-orange-600">{n(summerTotals.totalCooling)} BTU/h</p>
              </div>
              <div className={`rounded-lg border bg-white px-3 py-2 ${includeMonsoon ? 'border-teal-200' : 'border-slate-200'}`}>
                <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${includeMonsoon ? 'text-teal-700' : 'text-slate-500'}`}>Monsoon Cooling</p>
                <p className={`mt-1 font-mono text-lg font-bold ${includeMonsoon ? 'text-teal-900' : 'text-slate-500'}`}>
                  {includeMonsoon && monsoonTotals ? monsoonGoverningTR.toFixed(2) : '--'}
                  <span className={`text-[11px] font-semibold ml-1 ${includeMonsoon ? 'text-teal-600' : 'text-slate-400'}`}>TR</span>
                </p>
                <p className={`text-[10px] ${includeMonsoon ? 'text-teal-600' : 'text-slate-500'}`}>
                  {includeMonsoon && monsoonTotals ? `${n(monsoonTotals.totalCooling)} BTU/h` : 'Blank (Monsoon OFF)'}
                </p>
              </div>
              <div className="rounded-lg border border-blue-200 bg-white px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-700">Heating</p>
                <p className="mt-1 font-mono text-lg font-bold text-blue-900">{n(t.totalHeating)}</p>
                <p className="text-[10px] text-blue-600">BTU/h winter load</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Design CFM</p>
                <p className="mt-1 font-mono text-lg font-bold text-emerald-900">{Math.round(governingDesignCfm)}</p>
                <p className="text-[10px] text-emerald-600">OA {Math.round(t.totalOaCfm)} CFM</p>
              </div>
              <div className="rounded-lg border border-violet-200 bg-white px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-700">Area</p>
                <p className="mt-1 font-mono text-lg font-bold text-violet-900">{Math.round(t.totalArea)}</p>
                <p className="text-[10px] text-violet-600">ft² conditioned</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">Equipment Basis</p>
                <p className="mt-1 font-mono text-lg font-bold text-slate-900">{requiredTR.toFixed(2)}</p>
                <p className="text-[10px] text-slate-500">Req TR (Load: {governingLoadSeason} · CFM: {governingAirflowSeason})</p>
              </div>
            </div>

            {includeMonsoon && monsoonTotals ? (
              <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-3">
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[11px]">
                  <p className="uppercase tracking-wider font-semibold text-blue-600 text-[10px]">Load Governor</p>
                  <p className="mt-1 text-blue-800 font-semibold">{governingLoadSeason} <span className="font-mono">{governingLoadTR.toFixed(2)} TR</span></p>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px]">
                  <p className="uppercase tracking-wider font-semibold text-emerald-600 text-[10px]">Airflow Governor</p>
                  <p className="mt-1 text-emerald-800 font-semibold">{governingAirflowSeason} <span className="font-mono">{governingCfmTR.toFixed(2)} TR</span></p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px]">
                  <p className="uppercase tracking-wider font-semibold text-slate-500 text-[10px]">Season Delta</p>
                  <p className="mt-1 text-slate-800 font-semibold"><span className="font-mono">{Math.abs(monsoonGoverningTR - summerGoverningTR).toFixed(2)} TR</span></p>
                </div>
              </div>
            ) : (
              <div className="mt-3 text-[11px] text-slate-500">Monsoon comparison is blank because Include Monsoon Calculation is OFF for this project.</div>
            )}
          </div>

          {/* Add Equipment button — AHU / zone-level */}
          {project?.id && (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
            >
              <PackagePlus className="w-3.5 h-3.5" />
              Add Zone Equipment (AHU)
            </button>
          )}
        </div>
      </div>

      {/* Equipment Picker Dialog — zone level */}
      {project?.id && (
        <EquipmentPickerDialog
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          projectId={project.id}
          zoneId={zoneId}
          zoneName={zoneName}
          governingTR={governingTR}
          loadTR={governingLoadTR}
          cfmTR={governingCfmTR > 0 ? governingCfmTR : undefined}
          requiredTR={requiredTR}
          designCFM={governingDesignCfm > 0 ? governingDesignCfm : undefined}
          achGovernsAirflow={achGovernsAirflow}
        />
      )}
    </>
  );
}

// ─── Collapsed zone badge (TR + CFM summary chip) ─────────────────────────────

function ZoneCollapsedBadge({
  zoneRooms,
  envelopeElements,
  dc,
  isChiller,
}: {
  zoneRooms: any[];
  envelopeElements: Record<string, any[]>;
  dc: DesignConditions;
  isChiller: boolean;
}) {
  const t = useMemo(
    () => computeZoneTotals(zoneRooms, envelopeElements, dc, isChiller),
    [zoneRooms, envelopeElements, dc, isChiller],
  );

  if (zoneRooms.length === 0) return null;

  return (
    <span className="hidden md:flex items-center gap-2 rounded-full border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700 flex-shrink-0 shadow-sm">
      <span>{t.totalTR.toFixed(2)} TR</span>
      <span className="h-3 w-px bg-orange-200" />
      <span>{Math.round(t.totalDesignCfm)} CFM</span>
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
  isVRF,
  isHybrid,
  roomSaveStates,
}: any) => {
  const isChiller = String(project?.systemType || '').toLowerCase().includes('chiller');
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, string>>({});
  const [savingZoneOverrideId, setSavingZoneOverrideId] = useState<string | null>(null);

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

  const renderZone = (zone: any, systemId?: string) => {
    const isSystem = zone.description !== undefined;
    const zoneId = zone.id;
    const isOpen = expandedZone === zoneId;
    const zoneRooms: any[] = rooms[zoneId] || [];
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

    return (
      <ZoneDropContainer key={zoneId} zoneId={zoneId}>
        {/* Zone header row */}
        <div
          className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none transition-colors border-l-2 ${
            isOpen ? 'bg-orange-50 border-l-orange-500' : 'hover:bg-gray-50 border-l-transparent'
          }`}
          onClick={() => {
            if (blockDirtyZoneNavigation(isOpen ? null : zoneId)) return;
            setExpandedZone(isOpen ? null : zoneId);
          }}
        >
          {/* Expand icon */}
          <span className="text-gray-400 flex-shrink-0">
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </span>

          {/* Zone name */}
          <input
            value={zone.name}
            title="Zone name"
            aria-label="Zone name"
            className="flex-1 min-w-0 font-semibold text-sm text-gray-900 bg-transparent border-none outline-none focus:ring-0 p-0 placeholder:text-slate-400"
            onClick={e => e.stopPropagation()}
            onChange={e =>
              isSystem
                ? updateSystem(zoneId, { name: e.target.value })
                : updateZone(zoneId, { name: e.target.value }, systemId)
            }
          />

          {/* VRF System badge */}
          {isSystem && (
            <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded flex-shrink-0">
              VRF System
            </span>
          )}

          {/* Room count */}
          <span className="text-xs text-gray-400 flex-shrink-0 rounded bg-slate-100 px-1.5 py-0.5">
            {zoneRooms.length} room{zoneRooms.length !== 1 ? 's' : ''}
          </span>

          {/* Collapsed summary badge */}
          {!isOpen && (
            <ZoneCollapsedBadge
              zoneRooms={liveZoneRooms}
              envelopeElements={envelopeElements}
              dc={zoneDc}
              isChiller={isChiller}
            />
          )}

          {/* Actions */}
          {canEdit && (
            <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => addRoom(zoneId, systemId)}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded font-medium transition-colors border border-blue-100"
              >
                <Plus className="w-3 h-3" /> Add Room
              </button>
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
            {/* Inside design conditions for this zone */}
            <div className="border-t border-slate-100 bg-slate-50/80 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Inside Design Overrides</span>
                {zoneOverrideDirty ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-amber-700">Unsaved override changes are applied live to calculations.</span>
                    <button
                      type="button"
                      onClick={() => clearZoneOverrideDrafts(zoneId)}
                      className="h-7 rounded-md border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
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
                ) : hasZoneIndoorOverride ? (
                  <button
                    type="button"
                    onClick={() => queueZoneDefaultsReset(zoneId)}
                    className="text-[10px] text-red-500 hover:text-red-600 underline"
                  >
                    Reset to project defaults
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-400 italic">Using project defaults</span>
                )}
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-orange-200 bg-orange-50/70 px-3 py-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-orange-700">Summer / Monsoon</span>
                    <span className="text-[10px] text-orange-500">Monsoon follows summer override</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="text-[11px] text-slate-600">Temp (°F)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        title="Indoor design temperature for this zone"
                        value={getOverrideInputValue(zone, zoneId, 'indoorTemp', dc.indoorTemp ?? 75)}
                        onChange={e => setOverrideDraft(zoneId, 'indoorTemp', e.target.value)}
                        className="h-8 w-full text-xs border border-orange-200 rounded px-2 bg-white focus:outline-none focus:ring-1 focus:ring-orange-400"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-slate-600">RH (%)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        title="Indoor relative humidity for this zone"
                        value={getOverrideInputValue(zone, zoneId, 'indoorHumidity', dc.indoorHumidity ?? 50)}
                        onChange={e => setOverrideDraft(zoneId, 'indoorHumidity', e.target.value)}
                        className="h-8 w-full text-xs border border-orange-200 rounded px-2 bg-white focus:outline-none focus:ring-1 focus:ring-orange-400"
                      />
                    </label>
                  </div>
                </div>

                <div className="rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">Winter</span>
                    <span className="text-[10px] text-blue-500">Used for heating analysis</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="text-[11px] text-slate-600">Temp (°F)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        title="Winter indoor design temperature for this zone"
                        value={getOverrideInputValue(zone, zoneId, 'winterIndoorTemp', zoneDc.winterIndoorTemp ?? dc.winterIndoorTemp ?? 72)}
                        onChange={e => setOverrideDraft(zoneId, 'winterIndoorTemp', e.target.value)}
                        className="h-8 w-full text-xs border border-blue-200 rounded px-2 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-slate-600">RH (%)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        title="Winter indoor relative humidity for this zone"
                        value={getOverrideInputValue(zone, zoneId, 'winterIndoorHumidity', zoneDc.winterIndoorHumidity ?? dc.winterIndoorHumidity ?? 40)}
                        onChange={e => setOverrideDraft(zoneId, 'winterIndoorHumidity', e.target.value)}
                        className="h-8 w-full text-xs border border-blue-200 rounded px-2 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-100 bg-gray-50/50">
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
              />
            </div>
            <ZoneSummaryBar
              zoneRooms={liveZoneRooms}
              envelopeElements={envelopeElements}
              dc={zoneDc}
              isChiller={isChiller}
              project={project}
              zoneId={zoneId}
              zoneName={zone.name}
            />
          </>
        )}
      </ZoneDropContainer>
    );
  };

  return (
    <div className="divide-y divide-gray-100">
      {/* VRF / Hybrid: systems */}
      {(isVRF || isHybrid) && systems.map((system: any) => (
        <div key={system.id}>
          {isVRF ? (
            renderZone(system, system.id)
          ) : (
            <>
              {/* System header for Hybrid */}
              <div
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none transition-colors border-l-2 ${
                  expandedSystem === system.id ? 'bg-blue-50 border-l-blue-500' : 'hover:bg-gray-50 border-l-transparent'
                }`}
                onClick={() => {
                  if (blockDirtyZoneNavigation(expandedSystem === system.id ? null : system.id)) return;
                  setExpandedSystem(expandedSystem === system.id ? null : system.id);
                }}
              >
                <span className="text-blue-400 flex-shrink-0">
                  {expandedSystem === system.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </span>
                <span className="flex-1 font-semibold text-sm text-blue-900">{system.name}</span>
                <span className="text-[10px] font-bold uppercase bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">VRF System</span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); addZone(system.id); }}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded font-medium"
                  >
                    <Plus className="w-3 h-3" /> Add Zone
                  </button>
                )}
              </div>
              {expandedSystem === system.id && (
                <div className="border-t border-blue-100 divide-y divide-gray-100 pl-6 border-l-2 border-l-blue-100">
                  {zones.filter((z: any) => z.systemId === system.id).map((zone: any) => renderZone(zone, system.id))}
                  {zones.filter((z: any) => z.systemId === system.id).length === 0 && (
                    <p className="text-xs text-gray-400 italic py-3 px-4">No zones in this system yet.</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {/* CAC / Hybrid direct zones */}
      {!isVRF && zones.filter((z: any) => !z.systemId).map((zone: any) => renderZone(zone, undefined))}
    </div>
  );
};

export default ZoneList;
