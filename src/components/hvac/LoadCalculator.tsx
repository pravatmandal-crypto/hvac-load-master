
import { useState, useEffect, useMemo, useRef, useCallback, startTransition, forwardRef, useImperativeHandle } from 'react';
import {
  DndContext,
  useSensors,
  useSensor,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  closestCorners,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Plus, Download, Building, BookOpen, Pencil, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Separator } from '../ui/separator';
import { db } from '../../lib/firebase';
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, deleteField } from 'firebase/firestore';
import { toast } from 'sonner';
import {
  getCLTD,
  getSHGF,
  DEFAULT_WALL_TYPES,
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
} from '../../lib/hvac';
import { EnvelopeElement } from '../../lib/hvac/constants';

const getMinAdp = (systemType?: string): number => {
  const st = String(systemType || '').toLowerCase();
  if (st === 'chiller') return 44;
  if (st === 'vrf' || st === 'hybrid') return 42;
  return 44;
};

interface Room {
  id: string;
  name: string;
  floor: string;
  length: number;
  width: number;
  height: number;
  hasFalseCeiling: boolean;
  falseCeilingHeight: number;
  facph: number;
  peopleCount: number;
  lightsWattsPerSqft: number;
  equipmentKW: number;
  othersKW: number;
  sensibleSafetyFactor: number;
  latentSafetyFactor: number;
  grandTotalSafetyFactor: number;
  ductGainPct: number;
  fanGainPct: number;
  [key: string]: any;
}

interface Zone {
  id: string;
  name: string;
  systemId?: string;
  outdoorTemp?: number;
  indoorTemp?: number;
  outdoorHumidity?: number;
  indoorHumidity?: number;
  [key: string]: any;
}

interface HVACSystem {
  id: string;
  name: string;
  description?: string;
  [key: string]: any;
}
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import PsychrometricChart from './PsychrometricChart';
import { generatePDFReport } from '../../services/reportService';
import { generateExcelReport } from '../../services/excelService';
import ZoneList from './ZoneList';

export type LoadCalculatorHandle = {
  saveAllDirty: () => Promise<void>;
};

const LoadCalculator = forwardRef<LoadCalculatorHandle, { project: any; userProfile: any; onNavigate?: (id: string) => void; onUnsavedChangesChange?: (has: boolean) => void }>(
  function LoadCalculator({ project, userProfile, onNavigate, onUnsavedChangesChange }, ref) {
  const analysisBackfillDoneRef = useRef<Set<string>>(new Set());
  const oaFacphMigrationDoneRef = useRef<Set<string>>(new Set());
  const backfillRunningRef = useRef(false);
  const migrationRunningRef = useRef(false);
  const legacyDefaultOaFacph = Number(project?.legacyDefaultOaFacph ?? project?.data?.legacyDefaultOaFacph ?? 1.5);

  const normalizeRoom = (r: any): Room => {
    const rawFacph = r.facph ?? r.data?.facph;
    const facphMissing = rawFacph === undefined || rawFacph === null || rawFacph === '';
    const normalizedFacph = facphMissing ? legacyDefaultOaFacph : Number(rawFacph);

    return {
      id: r.id,
      name: r.name ?? '',
      floor: r.floor ?? 'Ground',
      length: r.length ?? r.data?.length ?? 0,
      width: r.width ?? r.data?.width ?? 0,
      height: r.height ?? r.data?.height ?? 0,
      hasFalseCeiling: r.hasFalseCeiling ?? r.data?.hasFalseCeiling ?? false,
      falseCeilingHeight: r.falseCeilingHeight ?? r.data?.falseCeilingHeight ?? 8,
      facph: Number.isFinite(normalizedFacph) ? normalizedFacph : legacyDefaultOaFacph,
      peopleCount: r.peopleCount ?? r.data?.peopleCount ?? 0,
      activityType: r.activityType ?? r.data?.activityType ?? 'office',
      lightsWattsPerSqft: r.lightsWattsPerSqft ?? r.data?.lightsWattsPerSqft ?? 0,
      equipmentKW: r.equipmentKW ?? r.data?.equipmentKW ?? 0,
      othersKW: r.othersKW ?? r.data?.othersKW ?? 0,
      sensibleSafetyFactor: r.sensibleSafetyFactor ?? r.data?.sensibleSafetyFactor ?? 10,
      latentSafetyFactor: r.latentSafetyFactor ?? r.data?.latentSafetyFactor ?? 5,
      grandTotalSafetyFactor: r.grandTotalSafetyFactor ?? r.data?.grandTotalSafetyFactor ?? 3,
      ductGainPct: r.ductGainPct ?? r.data?.ductGainPct ?? 2,
      fanGainPct: r.fanGainPct ?? r.data?.fanGainPct ?? 3,
      _oaFacphMigrated: r._oaFacphMigrated ?? r.data?._oaFacphMigrated ?? false,
      _oaFacphMigrationSource: r._oaFacphMigrationSource ?? r.data?._oaFacphMigrationSource,
      _oaFacphMigratedAt: r._oaFacphMigratedAt ?? r.data?._oaFacphMigratedAt,
      _oaFacphWasMissingOnLoad: facphMissing,
    };
  };

  const [systems, setSystems] = useState<HVACSystem[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [rooms, setRooms] = useState<Record<string, Room[]>>({});
  const [envelopeElements, setEnvelopeElements] = useState<Record<string, EnvelopeElement[]>>({});
  const [expandedZone, setExpandedZone] = useState<string | null>(null);
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);
  const [expandedSystem, setExpandedSystem] = useState<string | null>(null);
  
  // Edit Project Data state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editData, setEditData] = useState({
    name: '',
    location: '',
    longitude: '',
    latitude: '',
    altitude: '',
    includeMonsoon: false,
    summerDesignTemp: '',
    summerDesignHumidity: '',
    monsoonDesignTemp: '',
    monsoonDesignHumidity: '',
    winterDesignTemp: '',
    winterDesignHumidity: '',
    insideSummerTemp: '',
    insideSummerHumidity: '',
    insideMonsoonTemp: '',
    insideMonsoonHumidity: '',
    insideWinterTemp: '',
    insideWinterHumidity: '',
  });
  const [editLoading, setEditLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  // Zone Editor Dialog state
  const [zoneEditorOpen, setZoneEditorOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [editingZoneSystemId, setEditingZoneSystemId] = useState<string | undefined>();
  const [applyToAllZones, setApplyToAllZones] = useState(false);
  const [roomSaveStates, setRoomSaveStates] = useState<Record<string, 'idle' | 'saving' | 'saved'>>({});
  const [roomDraftOverrides, setRoomDraftOverrides] = useState<Record<string, Record<string, Partial<Room>>>>({});
  const [envelopeDraftsByRoom, setEnvelopeDraftsByRoom] = useState<Record<string, EnvelopeElement[]>>({});
  const [zoneConditionDraftOverrides, setZoneConditionDraftOverrides] = useState<Record<string, Partial<Zone>>>({});
  const [systemConditionDraftOverrides, setSystemConditionDraftOverrides] = useState<Record<string, Partial<HVACSystem>>>({});
  const [projectPsychroOpen, setProjectPsychroOpen] = useState(false);


  const isVRF = project.systemType === 'VRF';
  const isHybrid = project.systemType === 'Hybrid';
  const userRole = userProfile?.role;
  // Allow editing in offline/internal flows where role may be absent from profile payload.
  const canEdit = !userRole || ['Super', 'Admin A', 'Admin B', 'Design Team'].includes(userRole);

  // Use project fields for design conditions and location
  const projectAltitude = project.altitude ?? (project.data?.altitude ?? 0);
  const projectLatitude = project.latitude ?? (project.data?.latitude ?? undefined);
  const projectLongitude = project.longitude ?? (project.data?.longitude ?? undefined);
  const includeMonsoon = project.includeMonsoon ?? project.data?.includeMonsoon ?? false;
  const summerDesignTemp = project.summerDesignTemp ?? (project.data?.summerDesignTemp ?? 95);
  const summerDesignHumidity = project.summerDesignHumidity ?? (project.data?.summerDesignHumidity ?? 50);
  const monsoonDesignTemp = project.monsoonDesignTemp ?? (project.data?.monsoonDesignTemp ?? 85);
  const monsoonDesignHumidity = project.monsoonDesignHumidity ?? (project.data?.monsoonDesignHumidity ?? 85);
  const winterDesignTemp = project.winterDesignTemp ?? (project.data?.winterDesignTemp ?? 30);
  const winterDesignHumidity = project.winterDesignHumidity ?? (project.data?.winterDesignHumidity ?? 30);
  const insideSummerTemp = project.insideSummerTemp ?? (project.data?.insideSummerTemp ?? 75);
  const insideSummerHumidity = project.insideSummerHumidity ?? (project.data?.insideSummerHumidity ?? 50);
  const insideMonsoonTemp = project.insideMonsoonTemp ?? (project.data?.insideMonsoonTemp ?? insideSummerTemp);
  const insideMonsoonHumidity = project.insideMonsoonHumidity ?? (project.data?.insideMonsoonHumidity ?? 55);
  const insideWinterTemp = project.insideWinterTemp ?? (project.data?.insideWinterTemp ?? 72);
  const insideWinterHumidity = project.insideWinterHumidity ?? (project.data?.insideWinterHumidity ?? 40);

  // Default design conditions for calculations — memoised so downstream
  // useMemo/useEffect deps don't fire on every render.
  const defaultDesignConditions = useMemo(() => ({
    outdoorTemp: summerDesignTemp,
    indoorTemp: insideSummerTemp,
    outdoorHumidity: summerDesignHumidity,
    indoorHumidity: insideSummerHumidity,
    altitude: projectAltitude,
    latitude: projectLatitude,
    longitude: projectLongitude,
    winterOutdoorTemp: winterDesignTemp,
    winterOutdoorHumidity: winterDesignHumidity,
    winterIndoorTemp: insideWinterTemp,
    winterIndoorHumidity: insideWinterHumidity,
  }), [
    summerDesignTemp, insideSummerTemp, summerDesignHumidity, insideSummerHumidity,
    projectAltitude, projectLatitude, projectLongitude,
    winterDesignTemp, winterDesignHumidity, insideWinterTemp, insideWinterHumidity,
  ]);

  const getRoomRef = (zoneId: string, roomId: string, systemId?: string) => {
    if (isVRF && systemId) {
      return doc(db, 'projects', project.id, 'systems', systemId, 'rooms', roomId);
    }
    return systemId
      ? doc(db, 'projects', project.id, 'systems', systemId, 'zones', zoneId, 'rooms', roomId)
      : doc(db, 'projects', project.id, 'zones', zoneId, 'rooms', roomId);
  };

  const getDesignConditionsForZone = (zoneId: string, systemId?: string) => {
    const zone = zones.find((z) => z.id === zoneId && (systemId ? z.systemId === systemId : true));
    return {
      outdoorTemp: zone?.outdoorTemp ?? summerDesignTemp,
      indoorTemp: zone?.indoorTemp ?? (project.insideSummerTemp ?? 75),
      outdoorHumidity: zone?.outdoorHumidity ?? summerDesignHumidity,
      indoorHumidity: zone?.indoorHumidity ?? (project.insideSummerHumidity ?? 50),
      altitude: projectAltitude,
      latitude: projectLatitude,
      longitude: projectLongitude,
      winterOutdoorTemp: winterDesignTemp,
      winterOutdoorHumidity: winterDesignHumidity,
    };
  };

  const handleRoomDraftChange = useCallback((zoneId: string, roomId: string, draft: Partial<Room> | null) => {
    setRoomDraftOverrides((prev) => {
      const zoneDrafts = prev[zoneId] || {};

      if (!draft) {
        if (!zoneDrafts[roomId]) return prev;
        const nextZoneDrafts = { ...zoneDrafts };
        delete nextZoneDrafts[roomId];
        if (Object.keys(nextZoneDrafts).length === 0) {
          const next = { ...prev };
          delete next[zoneId];
          return next;
        }
        return { ...prev, [zoneId]: nextZoneDrafts };
      }

      return {
        ...prev,
        [zoneId]: {
          ...zoneDrafts,
          [roomId]: draft,
        },
      };
    });
  }, []);

  const liveRooms = useMemo(() => {
    if (Object.keys(roomDraftOverrides).length === 0) return rooms;

    const nextRooms: Record<string, Room[]> = {};
    for (const [zoneId, zoneRooms] of Object.entries(rooms)) {
      const zoneDrafts = roomDraftOverrides[zoneId];
      if (!zoneDrafts) {
        nextRooms[zoneId] = zoneRooms;
        continue;
      }

      nextRooms[zoneId] = zoneRooms.map((room) => {
        const draft = zoneDrafts[room.id];
        return draft ? ({ ...room, ...draft } as Room) : room;
      });
    }

    return nextRooms;
  }, [rooms, roomDraftOverrides]);

  const liveZones = useMemo(
    () => zones.map((zone) => zoneConditionDraftOverrides[zone.id] ? ({ ...zone, ...zoneConditionDraftOverrides[zone.id] }) : zone),
    [zones, zoneConditionDraftOverrides],
  );

  const liveSystems = useMemo(
    () => systems.map((system) => systemConditionDraftOverrides[system.id] ? ({ ...system, ...systemConditionDraftOverrides[system.id] }) : system),
    [systems, systemConditionDraftOverrides],
  );

  const liveZoneOrSystemById = useMemo(() => {
    const byId: Record<string, any> = {};
    liveZones.forEach((zone) => {
      byId[zone.id] = zone;
    });
    liveSystems.forEach((system) => {
      byId[system.id] = system;
    });
    return byId;
  }, [liveZones, liveSystems]);

  const liveEnvelopeElements = useMemo(() => {
    if (Object.keys(envelopeDraftsByRoom).length === 0) return envelopeElements;
    return { ...envelopeElements, ...envelopeDraftsByRoom };
  }, [envelopeElements, envelopeDraftsByRoom]);

  const handleEnvelopeDraftChange = useCallback((roomId: string, draft: EnvelopeElement[] | null) => {
    setEnvelopeDraftsByRoom(prev => {
      if (!draft) {
        const next = { ...prev };
        delete next[roomId];
        return next;
      }
      return { ...prev, [roomId]: draft };
    });
  }, []);

  const handleZoneConditionDraftsChange = useCallback((zoneDrafts: Record<string, Partial<Zone>>, systemDrafts: Record<string, Partial<HVACSystem>>) => {
    setZoneConditionDraftOverrides(zoneDrafts);
    setSystemConditionDraftOverrides(systemDrafts);
  }, []);

  // ── Unsaved-changes guard ─────────────────────────────────────────────────

  const hasUnsavedChanges =
    Object.keys(roomDraftOverrides).length > 0 ||
    Object.keys(envelopeDraftsByRoom).length > 0;

  useEffect(() => {
    onUnsavedChangesChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChangesChange]);

  // Always-current ref so useImperativeHandle's closure never goes stale
  const saveAllDirtyRef = useRef<() => Promise<void>>(async () => {});
  saveAllDirtyRef.current = async () => {
    // Save room parameter drafts
    for (const [zoneId, zoneDrafts] of Object.entries(roomDraftOverrides)) {
      const zone = zones.find((z) => z.id === zoneId);
      const systemId: string | undefined = zone?.systemId
        ? (zone.systemId as string)
        : systems.find((s) => s.id === zoneId)
          ? zoneId
          : undefined;
      for (const [roomId, draft] of Object.entries(zoneDrafts)) {
        await updateRoom(zoneId, roomId, draft, systemId);
      }
    }

    // Save envelope element drafts
    for (const [roomId, draftElements] of Object.entries(envelopeDraftsByRoom)) {
      let zoneId: string | undefined;
      for (const [zid, zoneRooms] of Object.entries(rooms)) {
        if ((zoneRooms as Room[]).some((r) => r.id === roomId)) { zoneId = zid; break; }
      }
      if (!zoneId) continue;

      const zone = zones.find((z) => z.id === zoneId);
      const systemId: string | undefined = zone?.systemId
        ? (zone.systemId as string)
        : systems.find((s) => s.id === zoneId)
          ? zoneId
          : undefined;

      const committed = envelopeElements[roomId] || [];
      const committedIds = new Set(committed.map((e) => e.id));
      const draftIds = new Set(draftElements.map((e) => e.id));
      const deleted = committed.filter((e) => !draftIds.has(e.id)).map((e) => e.id);
      const added = draftElements
        .filter((e) => e.id.startsWith('draft_'))
        .map(({ id: _t, ...rest }) => rest as Omit<EnvelopeElement, 'id'>);
      const updated: Array<{ id: string; data: Partial<EnvelopeElement> }> = [];
      for (const el of draftElements) {
        if (!el.id.startsWith('draft_') && committedIds.has(el.id)) {
          const base = committed.find((c) => c.id === el.id)!;
          const { id: _a, ...elData } = el;
          const { id: _b, ...baseData } = base;
          if (JSON.stringify(elData) !== JSON.stringify(baseData)) updated.push({ id: el.id, data: elData });
        }
      }
      if (deleted.length + added.length + updated.length > 0) {
        await saveEnvelopeChanges(zoneId, roomId, systemId, { deleted, added, updated });
      }
    }

    setRoomDraftOverrides({});
    setEnvelopeDraftsByRoom({});
  };

  useImperativeHandle(ref, () => ({
    saveAllDirty: () => saveAllDirtyRef.current(),
  }), []);

  const persistRoomAnalysisSnapshot = async (
    zoneId: string,
    roomId: string,
    systemId?: string,
    roomOverride?: Room,
    elementsOverride?: EnvelopeElement[],
  ) => {
    const roomSource = roomOverride ?? (rooms[zoneId] || []).find((r) => r.id === roomId);
    if (!roomSource) return;

    setRoomSaveStates(prev => ({ ...prev, [roomId]: 'saving' }));

    const dc = getDesignConditionsForZone(zoneId, systemId);
    const rd: RoomDetails = {
      id: roomSource.id,
      name: roomSource.name ?? '',
      floor: roomSource.floor ?? 'Ground',
      length: Number(roomSource.length) || 0,
      width: Number(roomSource.width) || 0,
      height: Number(roomSource.height) || 0,
      hasFalseCeiling: roomSource.hasFalseCeiling ?? false,
      falseCeilingHeight: Number(roomSource.falseCeilingHeight) || 0,
      facph: Number(roomSource.facph) || 0,
      peopleCount: Number(roomSource.peopleCount) || 0,
      activityType: roomSource.activityType ?? 'office',
      lightsWattsPerSqft: Number(roomSource.lightsWattsPerSqft) || 0,
      equipmentKW: Number(roomSource.equipmentKW) || 0,
      othersKW: Number(roomSource.othersKW) || 0,
    };

    const elements = (elementsOverride ?? envelopeElements[roomId] ?? []) as EnvelopeElement[];
    const envelope = calculateEnvelopeGain(elements, dc);
    const internal = calculateInternalGains(rd);
    const vent = calculateVentilationLoad(rd, dc);
    const heating = calculateHeatingLoad(rd, elements, dc);

    const bf = 0.15;
    const erSensible = envelope.sensible + internal.sensible + vent.sensible * bf;
    const erLatent = internal.latent + vent.latent * bf;
    const ductPct = Number(roomSource.ductGainPct) || 2;
    const fanPct = Number(roomSource.fanGainPct) || 3;
    const sensibleSafetyPct = Number(roomSource.sensibleSafetyPercent ?? roomSource.sensibleSafetyFactor ?? 10);
    const latentSafetyPct = Number(roomSource.latentSafetyPercent ?? roomSource.latentSafetyFactor ?? 5);
    const overallSafetyPct = Number(roomSource.overallSafetyPercent ?? roomSource.grandTotalSafetyFactor ?? 3);
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
    const rshf = coilSensible > 0 ? coilSensible / Math.max(1, (coilSensible + coilLatent)) : 1;

    const coil = calculateCoilParameters(
      coilSensible,
      coilLatent,
      dc.indoorTemp,
      dc.indoorHumidity,
      dc.altitude || 0,
      bf,
      35,
      65,
      getMinAdp(project?.systemType),
    );
    const presetTotalACH = getRecommendedAch(roomSource.achProfile ?? roomSource.activityType);
    const totalSupplyACH = Math.max(presetTotalACH, rd.facph);
    const totalSupplyCFM = (calculateRoomVolume(rd) * totalSupplyACH) / 60;
    const designSupplyCFM = Math.max(coil.dehumidifiedCFM, totalSupplyCFM);
    const cfmTR = designSupplyCFM / 400;
    const governingTR = Math.max(grandTotalTR, cfmTR);
    const requiredTR = governingTR * (1 + overallSafetyPct / 100);

    const outdoorPsych = calculatePsychrometrics(dc.outdoorTemp, dc.outdoorHumidity, dc.altitude || 0);
    const indoorPsych = calculatePsychrometrics(dc.indoorTemp, dc.indoorHumidity, dc.altitude || 0);
    const totalMoistureLbsHr = Math.abs(coilLatent / 1050);
    const moisture = {
      rate: totalMoistureLbsHr,
      action: coilLatent > 0 ? 'Dehumidify' : coilLatent < 0 ? 'Humidify' : 'None',
      unit: 'lbs/hr',
      loadBTU: coilLatent,
    };
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
      psychrometrics: {
        outdoor: outdoorPsych,
        indoor: indoorPsych,
      },
      coil,
      moisture,
      reheat,
      totals: {
        ersh,
        erlh,
        erh,
        coilSensible,
        coilLatent,
        oaSensible,
        oaLatent,
        oaTotal,
        grandTotal,
        grandTotalTR,
        rshf,
      },
    };

    await updateDoc(getRoomRef(zoneId, roomId, systemId), {
      analysis,
      analysisUpdatedAt: new Date(),
      totalLoadBTUH: grandTotal,
      totalLoadTR: grandTotalTR,
      dehumidifiedCFM: coil.dehumidifiedCFM,
      designSupplyCFM,
      _calcLoadTR: parseFloat(grandTotalTR.toFixed(3)),
      _calcCfmTR: parseFloat(cfmTR.toFixed(3)),
      _calcGoverningTR: parseFloat(governingTR.toFixed(3)),
      _calcRequiredTR: parseFloat(requiredTR.toFixed(3)),
      _calcDesignCFM: parseFloat(designSupplyCFM.toFixed(0)),
      updatedAt: new Date(),
    });

    // Keep in-memory room state in sync so UI can show immediate save feedback.
    setRooms((prev) => ({
      ...prev,
      [zoneId]: (prev[zoneId] || []).map((r) =>
        r.id === roomId
          ? {
              ...r,
              analysis,
              analysisUpdatedAt: Date.now(),
              totalLoadBTUH: grandTotal,
              totalLoadTR: grandTotalTR,
              dehumidifiedCFM: coil.dehumidifiedCFM,
              designSupplyCFM,
              _calcLoadTR: parseFloat(grandTotalTR.toFixed(3)),
              _calcCfmTR: parseFloat(cfmTR.toFixed(3)),
              _calcGoverningTR: parseFloat(governingTR.toFixed(3)),
              _calcRequiredTR: parseFloat(requiredTR.toFixed(3)),
              _calcDesignCFM: parseFloat(designSupplyCFM.toFixed(0)),
            }
          : r
      ),
    }));

    setRoomSaveStates(prev => ({ ...prev, [roomId]: 'saved' }));
    setTimeout(() => setRoomSaveStates(prev => {
      const next = { ...prev };
      if (next[roomId] === 'saved') next[roomId] = 'idle';
      return next;
    }), 2500);
  };

  // ── Project-level totals (computed from all rooms) ───────────────────────────
  const projectTotals = useMemo(() => {
    const BF_LOCAL = 0.15;
    let totalHeating = 0;
    let totalArea = 0;
    let summerCooling = 0;
    let summerDesignCfm = 0;
    let monsoonCooling = 0;
    let monsoonDesignCfm = 0;

    const calculateCoolingSnapshot = (room: any, elements: EnvelopeElement[], zoneDc: typeof defaultDesignConditions) => {
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

      const envelope = calculateEnvelopeGain(elements, zoneDc);
      const internal = calculateInternalGains(rd);
      const vent = calculateVentilationLoad(rd, zoneDc);

      const erSensible = envelope.sensible + internal.sensible + vent.sensible * BF_LOCAL;
      const erLatent = internal.latent + vent.latent * BF_LOCAL;
      const ductPct = Number(room.ductGainPct) || 2;
      const fanPct = Number(room.fanGainPct) || 3;
      const sensibleSafetyPct = Number(room.sensibleSafetyPercent ?? room.sensibleSafetyFactor ?? 10);
      const latentSafetyPct = Number(room.latentSafetyPercent ?? room.latentSafetyFactor ?? 5);
      const overallSafetyPct = Number(room.overallSafetyPercent ?? room.grandTotalSafetyFactor ?? 3);
      const parasitic = calculateParasiticGains(erSensible, erSensible, ductPct, fanPct);

      const ersh = (erSensible + parasitic.ductGain + parasitic.fanGain) * (1 + sensibleSafetyPct / 100);
      const erlh = erLatent * (1 + latentSafetyPct / 100);
      const oaSensible = vent.sensible * (1 - BF_LOCAL);
      const oaLatent = vent.latent * (1 - BF_LOCAL);
      const coilSensible = ersh + oaSensible;
      const coilLatent = erlh + oaLatent;
      const grandTotal = coilSensible + coilLatent;

      const coilLocal = calculateCoilParameters(
        coilSensible,
        coilLatent,
        zoneDc.indoorTemp,
        zoneDc.indoorHumidity,
        zoneDc.altitude || 0,
        BF_LOCAL,
        35,
        65,
        getMinAdp(project?.systemType),
      );
      const presetTotalACH = getRecommendedAch(room.achProfile ?? room.activityType);
      const totalSupplyACH = Math.max(presetTotalACH, rd.facph);
      const totalSupplyCFM = (calculateRoomVolume(rd) * totalSupplyACH) / 60;
      const designSupplyCFM = Math.max(coilLocal.dehumidifiedCFM, totalSupplyCFM);

      return {
        grandTotal,
        designSupplyCFM,
        heating: calculateHeatingLoad(rd, elements, zoneDc),
        area: rd.length * rd.width,
      };
    };

    for (const [zoneId, zoneRooms] of Object.entries(liveRooms)) {
      const zoneRecord = liveZoneOrSystemById[zoneId];
      const zoneSummerDc = {
        ...defaultDesignConditions,
        indoorTemp: zoneRecord?.indoorTemp ?? defaultDesignConditions.indoorTemp,
        indoorHumidity: zoneRecord?.indoorHumidity ?? defaultDesignConditions.indoorHumidity,
      };
      const zoneMonsoonDc = {
        ...zoneSummerDc,
        outdoorTemp: monsoonDesignTemp,
        outdoorHumidity: monsoonDesignHumidity,
        indoorTemp: zoneRecord?.indoorTemp ?? insideMonsoonTemp,
        indoorHumidity: zoneRecord?.indoorHumidity ?? insideMonsoonHumidity,
      };
      const zoneHeatingDc = {
        ...zoneSummerDc,
        indoorTemp: zoneRecord?.winterIndoorTemp ?? defaultDesignConditions.winterIndoorTemp ?? insideWinterTemp,
        indoorHumidity: zoneRecord?.winterIndoorHumidity ?? defaultDesignConditions.winterIndoorHumidity ?? insideWinterHumidity,
      };

      for (const room of (zoneRooms as any[])) {
        const elements = (liveEnvelopeElements[room.id] || []) as EnvelopeElement[];
        const summerSnapshot = calculateCoolingSnapshot(room, elements, zoneSummerDc);
        const heatingSnapshot = calculateCoolingSnapshot(room, elements, zoneHeatingDc);

        summerCooling += summerSnapshot.grandTotal;
        summerDesignCfm += summerSnapshot.designSupplyCFM;
        totalHeating += heatingSnapshot.heating.totalHeatingLoad;
        totalArea += summerSnapshot.area;

        if (includeMonsoon) {
          const monsoonSnapshot = calculateCoolingSnapshot(room, elements, zoneMonsoonDc);
          monsoonCooling += monsoonSnapshot.grandTotal;
          monsoonDesignCfm += monsoonSnapshot.designSupplyCFM;
        }
      }
    }

    const roomCount = Object.values(liveRooms).reduce((sum, r) => sum + (r as any[]).length, 0);
    const monsoonTR = monsoonCooling / 12000;
    const summerTR = summerCooling / 12000;
    const summerCfmTR = summerDesignCfm > 0 ? summerDesignCfm / 400 : 0;
    const monsoonCfmTR = monsoonDesignCfm > 0 ? monsoonDesignCfm / 400 : 0;
    const summerGoverningTR = Math.max(summerTR, summerCfmTR);
    const monsoonGoverningTR = Math.max(monsoonTR, monsoonCfmTR);
    const governingLoadSeason = includeMonsoon && monsoonTR > summerTR ? 'Monsoon' : 'Summer';
    const governingAirflowSeason = includeMonsoon && monsoonCfmTR > summerCfmTR ? 'Monsoon' : 'Summer';
    const governingLoadTR = includeMonsoon ? Math.max(summerTR, monsoonTR) : summerTR;
    const governingCfmTR = includeMonsoon ? Math.max(summerCfmTR, monsoonCfmTR) : summerCfmTR;
    const totalTR = Math.max(governingLoadTR, governingCfmTR);
    const peakSeason = totalTR === governingCfmTR ? governingAirflowSeason : governingLoadSeason;
    const totalCooling = governingLoadSeason === 'Monsoon' ? monsoonCooling : summerCooling;
    const totalDesignCfm = includeMonsoon ? Math.max(summerDesignCfm, monsoonDesignCfm) : summerDesignCfm;

    return {
      totalCooling,
      totalTR,
      totalHeating,
      totalDesignCfm,
      totalArea,
      roomCount,
      includeMonsoon,
      peakSeason,
      governingLoadSeason,
      governingAirflowSeason,
      governingLoadTR,
      governingCfmTR,
      summer: {
        totalCooling: summerCooling,
        totalTR: summerTR,
        cfmTR: summerCfmTR,
        governingTR: summerGoverningTR,
        totalDesignCfm: summerDesignCfm,
      },
      monsoon: {
        totalCooling: monsoonCooling,
        totalTR: monsoonTR,
        cfmTR: monsoonCfmTR,
        governingTR: monsoonGoverningTR,
        totalDesignCfm: monsoonDesignCfm,
      },
    };
  }, [
    liveRooms,
    liveEnvelopeElements,
    defaultDesignConditions,
    project?.systemType,
    liveZoneOrSystemById,
    includeMonsoon,
    monsoonDesignTemp,
    monsoonDesignHumidity,
    insideMonsoonTemp,
    insideMonsoonHumidity,
    insideWinterTemp,
    insideWinterHumidity,
  ]);

  // One-time load when project opens
  useEffect(() => {
    if (!project.id || !userProfile) return;
    analysisBackfillDoneRef.current.clear();
    oaFacphMigrationDoneRef.current.clear();

    const load = async () => {
      setDataLoading(true);
      try {
        const allZones: Zone[] = [];
        const allRooms: Record<string, Room[]> = {};
        const allElements: Record<string, EnvelopeElement[]> = {};

        if (isVRF || isHybrid) {
          const sysSnap = await getDocs(collection(db, 'projects', project.id, 'systems'));
          const sList = sysSnap.docs.map(d => ({ id: d.id, ...d.data() })) as HVACSystem[];
          setSystems(sList);

          for (const sys of sList) {
            if (isVRF) {
              // VRF: rooms directly under system
              const roomsSnap = await getDocs(collection(db, 'projects', project.id, 'systems', sys.id, 'rooms'));
              const rList = roomsSnap.docs.map(d => normalizeRoom({ id: d.id, ...d.data() }));
              allRooms[sys.id] = rList;
              for (const room of rList) {
                const elSnap = await getDocs(collection(db, 'projects', project.id, 'systems', sys.id, 'rooms', room.id, 'envelopeElements'));
                allElements[room.id] = elSnap.docs.map(d => ({ id: d.id, ...d.data() })) as EnvelopeElement[];
              }
            } else {
              // Hybrid: zones under system
              const zSnap = await getDocs(collection(db, 'projects', project.id, 'systems', sys.id, 'zones'));
              const zList = zSnap.docs.map(d => ({ id: d.id, ...d.data(), systemId: sys.id })) as Zone[];
              allZones.push(...zList);
              for (const zone of zList) {
                const roomsSnap = await getDocs(collection(db, 'projects', project.id, 'systems', sys.id, 'zones', zone.id, 'rooms'));
                const rList = roomsSnap.docs.map(d => normalizeRoom({ id: d.id, ...d.data() }));
                allRooms[zone.id] = rList;
                for (const room of rList) {
                  const elSnap = await getDocs(collection(db, 'projects', project.id, 'systems', sys.id, 'zones', zone.id, 'rooms', room.id, 'envelopeElements'));
                  allElements[room.id] = elSnap.docs.map(d => ({ id: d.id, ...d.data() })) as EnvelopeElement[];
                }
              }
            }
          }
        }

        if (!isVRF) {
          // CAC and Hybrid: direct zones
          const zSnap = await getDocs(collection(db, 'projects', project.id, 'zones'));
          const zList = zSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Zone[];
          allZones.push(...zList);
          for (const zone of zList) {
            const roomsSnap = await getDocs(collection(db, 'projects', project.id, 'zones', zone.id, 'rooms'));
            const rList = roomsSnap.docs.map(d => normalizeRoom({ id: d.id, ...d.data() }));
            allRooms[zone.id] = rList;
            for (const room of rList) {
              const elSnap = await getDocs(collection(db, 'projects', project.id, 'zones', zone.id, 'rooms', room.id, 'envelopeElements'));
              allElements[room.id] = elSnap.docs.map(d => ({ id: d.id, ...d.data() })) as EnvelopeElement[];
            }
          }
        }

        setZones(allZones);
        setRooms(allRooms);
        setEnvelopeElements(allElements);
      } catch (error) {
        console.error('[LoadCalculator] Failed to load project data:', error);
        toast.error('Failed to load project data');
      } finally {
        setDataLoading(false);
      }
    };

    load();
  }, [project.id, isVRF, isHybrid, userProfile]);

  useEffect(() => {
    if (dataLoading) return;
    if (backfillRunningRef.current) return;

    const currentRooms = rooms;
    const currentZones = zones;
    const currentElements = envelopeElements;

    const backfillAnalysis = async () => {
      backfillRunningRef.current = true;
      try {
        for (const [zoneId, zoneRooms] of Object.entries(currentRooms)) {
          const zone = currentZones.find((z) => z.id === zoneId);
          const systemId = zone?.systemId;
          for (const room of zoneRooms as Room[]) {
            const key = `${zoneId}:${room.id}`;
            if (!analysisBackfillDoneRef.current.has(key) && !room.analysis) {
              try {
                await persistRoomAnalysisSnapshot(zoneId, room.id, systemId, room, currentElements[room.id] || []);
                analysisBackfillDoneRef.current.add(key);
                await new Promise(r => setTimeout(r, 150));
              } catch (error: any) {
                const msg = String(error?.message || '');
                if (msg.includes('No document to update')) {
                  analysisBackfillDoneRef.current.add(key);
                  continue;
                }
                throw error;
              }
            }
          }
        }
      } catch (error) {
        console.error('[LoadCalculator] Failed to backfill room analysis:', error);
      } finally {
        backfillRunningRef.current = false;
      }
    };

    backfillAnalysis();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoading]);

  useEffect(() => {
    if (dataLoading) return;
    if (migrationRunningRef.current) return;

    const currentRooms = rooms;
    const currentZones = zones;
    const currentSystems = systems;

    const migrateMissingOaFacph = async () => {
      migrationRunningRef.current = true;
      try {
        for (const [zoneId, zoneRooms] of Object.entries(currentRooms)) {
          const zoneRecord = (currentZones || []).find((z: any) => z.id === zoneId)
            || (currentSystems || []).find((s: any) => s.id === zoneId);
          const systemId = zoneRecord?.systemId;

          for (const room of zoneRooms as Room[]) {
            const key = `${zoneId}:${room.id}:oa-facph`;
            if (oaFacphMigrationDoneRef.current.has(key)) continue;
            if (!room._oaFacphWasMissingOnLoad || room._oaFacphMigrated) continue;

            const migrationPayload = {
              facph: Number(room.facph) || legacyDefaultOaFacph,
              _oaFacphMigrated: true,
              _oaFacphMigrationSource: `legacy-default-${legacyDefaultOaFacph}`,
              _oaFacphMigratedAt: new Date(),
            };

            try {
              await updateDoc(getRoomRef(zoneId, room.id, systemId), migrationPayload);
              await new Promise(r => setTimeout(r, 150));
            } catch (error: any) {
              const msg = String(error?.message || '');
              if (msg.includes('No document to update')) {
                oaFacphMigrationDoneRef.current.add(key);
                continue;
              }
              throw error;
            }
            oaFacphMigrationDoneRef.current.add(key);

            setRooms((prev) => ({
              ...prev,
              [zoneId]: (prev[zoneId] || []).map((r) =>
                r.id === room.id
                  ? { ...r, ...migrationPayload, _oaFacphWasMissingOnLoad: false }
                  : r,
              ),
            }));
          }
        }
      } catch (error) {
        console.error('[LoadCalculator] Failed OA FACPH migration:', error);
      } finally {
        migrationRunningRef.current = false;
      }
    };

    migrateMissingOaFacph();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoading]);

  const addSystem = async () => {
    try {
      const systemData: any = {
        name: `System ${systems.length + 1}`,
        description: 'VRF Outdoor Unit Network',
      };
      const ref = await addDoc(collection(db, 'projects', project.id, 'systems'), systemData);
      const newSystem = { id: ref.id, ...systemData };
      setSystems(prev => [...prev, newSystem]);
      setExpandedSystem(ref.id);
      toast.success('System added');
    } catch (error) {
      toast.error('Failed to add system');
    }
  };

  const addZone = async (systemId?: string) => {
    try {
      const name = `Zone ${zones.filter(z => z.systemId === systemId).length + 1}`;
      const path = systemId
        ? collection(db, 'projects', project.id, 'systems', systemId, 'zones')
        : collection(db, 'projects', project.id, 'zones');
      const ref = await addDoc(path, { name });
      const newZone = { id: ref.id, name, ...(systemId ? { systemId } : {}) };
      setZones(prev => [...prev, newZone]);
      setExpandedZone(ref.id);
      toast.success('Zone added');
    } catch (error) {
      toast.error('Failed to add zone');
    }
  };

  const updateSystem = async (id: string, data: Partial<HVACSystem>) => {
    try {
      setSystems(prev => prev.map(s => s.id === id ? { ...s, ...data } : s));
      const cleanData: any = { ...data };
      Object.keys(cleanData).forEach(key => {
        if (cleanData[key] === undefined) cleanData[key] = deleteField();
      });
      await updateDoc(doc(db, 'projects', project.id, 'systems', id), cleanData);
    } catch (error) {
      toast.error('Failed to update system');
    }
  };

  const updateZone = async (id: string, data: Partial<Zone>, systemId?: string) => {
    try {
      setZones(prev => prev.map(z => z.id === id ? { ...z, ...data } : z));
      const zoneRef = systemId
        ? doc(db, 'projects', project.id, 'systems', systemId, 'zones', id)
        : doc(db, 'projects', project.id, 'zones', id);
      const cleanData: any = { ...data };
      Object.keys(cleanData).forEach(key => {
        if (cleanData[key] === undefined) cleanData[key] = deleteField();
      });
      await updateDoc(zoneRef, cleanData);

      const zoneRooms = rooms[id] || [];
      for (const room of zoneRooms) {
        await persistRoomAnalysisSnapshot(id, room.id, systemId, room, envelopeElements[room.id] || []);
      }
    } catch (error) {
      toast.error('Failed to update zone');
    }
  };

  const deleteSystem = async (id: string) => {
    const nestedZoneIds = zones.filter((z) => z.systemId === id).map((z) => z.id);
    try {
      setSystems((prev) => prev.filter((s) => s.id !== id));
      setZones((prev) => prev.filter((z) => z.systemId !== id));
      setRooms((prev) => {
        const next = { ...prev };
        delete next[id];
        nestedZoneIds.forEach((zoneId) => delete next[zoneId]);
        return next;
      });
      await deleteDoc(doc(db, 'projects', project.id, 'systems', id));
      toast.success('System deleted');
    } catch (error) {
      toast.error('Failed to delete system');
    }
  };

  const deleteZone = async (id: string, systemId?: string) => {
    try {
      setZones(prev => prev.filter(z => z.id !== id));
      setRooms(prev => { const next = { ...prev }; delete next[id]; return next; });
      const zoneRef = systemId
        ? doc(db, 'projects', project.id, 'systems', systemId, 'zones', id)
        : doc(db, 'projects', project.id, 'zones', id);
      await deleteDoc(zoneRef);
      toast.success('Zone deleted');
    } catch (error) {
      toast.error('Failed to delete zone');
    }
  };

  const addRoom = async (zoneId: string, systemId?: string) => {
    try {
      let path;
      if (isVRF && systemId) {
        path = collection(db, 'projects', project.id, 'systems', systemId, 'rooms');
      } else {
        path = systemId
          ? collection(db, 'projects', project.id, 'systems', systemId, 'zones', zoneId, 'rooms')
          : collection(db, 'projects', project.id, 'zones', zoneId, 'rooms');
      }
      const roomData = {
        name: `Room ${(rooms[zoneId]?.length || 0) + 1}`,
        floor: 'Ground',
        length: 0,
        width: 0,
        height: 0,
        hasFalseCeiling: false,
        falseCeilingHeight: 0,
        activityType: 'office',
        achProfile: 'office',
        facph: 1.5,
        peopleCount: 0,
        lightsWattsPerSqft: 0,
        equipmentKW: 0,
        othersKW: 0,
        sensibleSafetyFactor: 10,
        latentSafetyFactor: 5,
        grandTotalSafetyFactor: 3,
      };
      const ref = await addDoc(path, roomData);
      const newRoom = normalizeRoom({ id: ref.id, ...roomData });
      setRooms(prev => ({ ...prev, [zoneId]: [...(prev[zoneId] || []), newRoom] }));
      await persistRoomAnalysisSnapshot(zoneId, newRoom.id, systemId, newRoom, []);
      toast.success('Room added');
    } catch (error) {
      toast.error('Failed to add room');
    }
  };

  const addEnvelopeElement = async (zoneId: string, roomId: string, type: EnvelopeElement['type'], systemId?: string) => {
    try {
      const zone = isVRF && systemId
        ? systems.find(s => s.id === systemId) as unknown as Zone
        : zones.find(z => z.id === zoneId);
      const deltaT = (zone?.outdoorTemp || 95) - (zone?.indoorTemp || 75);
      const designAltitude = zone?.altitude ?? project.altitude ?? project.data?.altitude ?? 0;
      const designMonth = zone?.designMonth ?? project.designMonth ?? project.data?.designMonth ?? 7;
      const dailyRange = zone?.dailyRange ?? project.dailyRange ?? project.data?.dailyRange ?? 20;
      const defaultOrient = (type === 'Roof' || type === 'Floor') ? 'H' : 'S';
      const cltdOpts = {
        indoorTemp:  zone?.indoorTemp  || 75,
        outdoorMax:  zone?.outdoorTemp || 95,
        dailyRange,
        designMonth,
      };
      const elementData: any = {
        type,
        orientation: defaultOrient,
        area: 0,
        uValue: type === 'Glass' ? 0.5 : 0.3,
        solarFactor: getCLTD(defaultOrient as any, type, deltaT, designAltitude, cltdOpts),
        description: `New ${type}`,
        isOverride: false,
        color: 'Dark',
      };
      if (type === 'Partition') {
        elementData.orientation = 'N';
      }
      if (type === 'Glass') {
        elementData.shgc = 0.7;
        elementData.solarFactor = getSHGF(defaultOrient as any, designAltitude);
        elementData.wallTypeId = 'g2';
        const wall = DEFAULT_WALL_TYPES.find(w => w.id === 'g2');
        if (wall) elementData.uValue = wall.uValue;
      }
      if (type === 'Wall' || type === 'Partition') {
        elementData.wallTypeId = 'w1';
        const wall = DEFAULT_WALL_TYPES.find(w => w.id === 'w1');
        if (wall) elementData.uValue = wall.uValue;
      }
      let path;
      if (isVRF && systemId) {
        path = collection(db, 'projects', project.id, 'systems', systemId, 'rooms', roomId, 'envelopeElements');
      } else {
        path = systemId
          ? collection(db, 'projects', project.id, 'systems', systemId, 'zones', zoneId, 'rooms', roomId, 'envelopeElements')
          : collection(db, 'projects', project.id, 'zones', zoneId, 'rooms', roomId, 'envelopeElements');
      }
      const ref = await addDoc(path, elementData);
      const nextElements = [...(envelopeElements[roomId] || []), { id: ref.id, ...elementData }] as EnvelopeElement[];
      setEnvelopeElements(prev => ({ ...prev, [roomId]: nextElements }));
      await persistRoomAnalysisSnapshot(zoneId, roomId, systemId, undefined, nextElements);
      toast.success(`${type} element added`);
    } catch (error) {
      console.error('Error adding envelope element:', error);
      toast.error('Failed to add element');
    }
  };

  const updateEnvelopeElement = async (zoneId: string, roomId: string, elementId: string, data: Partial<EnvelopeElement>, systemId?: string) => {
    try {
      // When orientation or color changes and element is not manually overridden, auto-recalculate solarFactor
      if ((data.orientation || data.color) && !data.isOverride) {
        const currentEl = (envelopeElements[roomId] || []).find(el => el.id === elementId);
        if (currentEl && !currentEl.isOverride) {
          const zone = isVRF && systemId
            ? systems.find(s => s.id === systemId) as unknown as Zone
            : zones.find(z => z.id === zoneId);
          const deltaT = (zone?.outdoorTemp || 95) - (zone?.indoorTemp || 75);
          const designAltitude = (zone as any)?.altitude ?? project.altitude ?? project.data?.altitude ?? 0;
          const designMonth = (zone as any)?.designMonth ?? project.designMonth ?? project.data?.designMonth ?? 7;
          const dailyRange = (zone as any)?.dailyRange ?? project.dailyRange ?? project.data?.dailyRange ?? 20;
          const elType = data.type || currentEl.type;
          const elOrientation = data.orientation || currentEl.orientation;
          const elColor = data.color || currentEl.color || 'Dark';
          if (elType === 'Glass') {
            data = { ...data, solarFactor: getSHGF(elOrientation as any, designAltitude) };
          } else {
            data = { ...data, solarFactor: getCLTD(elOrientation as any, elType, deltaT, designAltitude, {
              indoorTemp: zone?.indoorTemp || 75,
              outdoorMax: zone?.outdoorTemp || 95,
              dailyRange,
              color: elColor as any,
              designMonth,
            }) };
          }
        }
      }
      const nextElements = ((envelopeElements[roomId] || []).map(el => el.id === elementId ? { ...el, ...data } : el)) as EnvelopeElement[];
      setEnvelopeElements(prev => ({
        ...prev,
        [roomId]: nextElements,
      }));
      let elRef;
      if (isVRF && systemId) {
        elRef = doc(db, 'projects', project.id, 'systems', systemId, 'rooms', roomId, 'envelopeElements', elementId);
      } else {
        elRef = systemId
          ? doc(db, 'projects', project.id, 'systems', systemId, 'zones', zoneId, 'rooms', roomId, 'envelopeElements', elementId)
          : doc(db, 'projects', project.id, 'zones', zoneId, 'rooms', roomId, 'envelopeElements', elementId);
      }
      await updateDoc(elRef, data);
      await persistRoomAnalysisSnapshot(zoneId, roomId, systemId, undefined, nextElements);
    } catch (error) {
      toast.error('Update failed');
    }
  };

  const deleteEnvelopeElement = async (zoneId: string, roomId: string, elementId: string, systemId?: string) => {
    try {
      const nextElements = ((envelopeElements[roomId] || []).filter(el => el.id !== elementId)) as EnvelopeElement[];
      setEnvelopeElements(prev => ({ ...prev, [roomId]: nextElements }));
      let elRef;
      if (isVRF && systemId) {
        elRef = doc(db, 'projects', project.id, 'systems', systemId, 'rooms', roomId, 'envelopeElements', elementId);
      } else {
        elRef = systemId
          ? doc(db, 'projects', project.id, 'systems', systemId, 'zones', zoneId, 'rooms', roomId, 'envelopeElements', elementId)
          : doc(db, 'projects', project.id, 'zones', zoneId, 'rooms', roomId, 'envelopeElements', elementId);
      }
      await deleteDoc(elRef);
      await persistRoomAnalysisSnapshot(zoneId, roomId, systemId, undefined, nextElements);
      toast.success('Element deleted');
    } catch (error) {
      toast.error('Delete failed');
    }
  };

  const saveEnvelopeChanges = useCallback(async (
    zoneId: string,
    roomId: string,
    systemId: string | undefined,
    changes: {
      deleted: string[];
      added: Array<Omit<EnvelopeElement, 'id'>>;
      updated: Array<{ id: string; data: Partial<EnvelopeElement> }>;
    },
  ) => {
    const getElRef = (elId: string) => {
      if (isVRF && systemId) return doc(db, 'projects', project.id, 'systems', systemId, 'rooms', roomId, 'envelopeElements', elId);
      return systemId
        ? doc(db, 'projects', project.id, 'systems', systemId, 'zones', zoneId, 'rooms', roomId, 'envelopeElements', elId)
        : doc(db, 'projects', project.id, 'zones', zoneId, 'rooms', roomId, 'envelopeElements', elId);
    };
    const getColRef = () => {
      if (isVRF && systemId) return collection(db, 'projects', project.id, 'systems', systemId, 'rooms', roomId, 'envelopeElements');
      return systemId
        ? collection(db, 'projects', project.id, 'systems', systemId, 'zones', zoneId, 'rooms', roomId, 'envelopeElements')
        : collection(db, 'projects', project.id, 'zones', zoneId, 'rooms', roomId, 'envelopeElements');
    };

    let nextElements = [...(envelopeElements[roomId] || [])] as EnvelopeElement[];

    for (const elId of changes.deleted) {
      await deleteDoc(getElRef(elId));
      nextElements = nextElements.filter(el => el.id !== elId);
    }
    for (const { id: elId, data } of changes.updated) {
      await updateDoc(getElRef(elId), data as Record<string, unknown>);
      nextElements = nextElements.map(el => el.id === elId ? { ...el, ...data } : el);
    }
    for (const elData of changes.added) {
      const ref = await addDoc(getColRef(), elData as Record<string, unknown>);
      nextElements = [...nextElements, { id: ref.id, ...elData } as EnvelopeElement];
    }

    setEnvelopeElements(prev => ({ ...prev, [roomId]: nextElements }));
    await persistRoomAnalysisSnapshot(zoneId, roomId, systemId, undefined, nextElements);
  }, [isVRF, project.id, envelopeElements, persistRoomAnalysisSnapshot]);

  const clampFalseCeilingToSlab = (currentRoom: Room | undefined, patch: Partial<Room>): Partial<Room> => {
    const nextPatch: Partial<Room> = { ...patch };
    const slabHeight = Math.max(0, Number(nextPatch.height ?? currentRoom?.height) || 0);

    if (nextPatch.falseCeilingHeight !== undefined) {
      const fcHeight = Number(nextPatch.falseCeilingHeight);
      if (Number.isFinite(fcHeight) && fcHeight > slabHeight) {
        nextPatch.falseCeilingHeight = slabHeight;
      }
      return nextPatch;
    }

    const currentFalseCeiling = Number(currentRoom?.falseCeilingHeight);
    if (Number.isFinite(currentFalseCeiling) && currentFalseCeiling > slabHeight) {
      nextPatch.falseCeilingHeight = slabHeight;
    }

    return nextPatch;
  };

  const updateRoom = async (zoneId: string, roomId: string, data: Partial<Room>, systemId?: string) => {
    try {
      const currentRoom = (rooms[zoneId] || []).find(r => r.id === roomId);
      const safeData = clampFalseCeilingToSlab(currentRoom, data);
      const mergedRoom = currentRoom ? ({ ...currentRoom, ...safeData } as Room) : undefined;
      setRooms(prev => ({
        ...prev,
        [zoneId]: (prev[zoneId] || []).map(r => r.id === roomId ? { ...r, ...safeData } : r),
      }));
      let roomRef;
      if (isVRF && systemId) {
        roomRef = doc(db, 'projects', project.id, 'systems', systemId, 'rooms', roomId);
      } else {
        roomRef = systemId
          ? doc(db, 'projects', project.id, 'systems', systemId, 'zones', zoneId, 'rooms', roomId)
          : doc(db, 'projects', project.id, 'zones', zoneId, 'rooms', roomId);
      }
      await updateDoc(roomRef, safeData);
      if (mergedRoom) {
        await persistRoomAnalysisSnapshot(zoneId, roomId, systemId, mergedRoom, envelopeElements[roomId] || []);
      }
    } catch (error) {
      toast.error('Update failed');
    }
  };

  const deleteRoom = async (zoneId: string, roomId: string, systemId?: string) => {
    try {
      setRooms(prev => ({ ...prev, [zoneId]: (prev[zoneId] || []).filter(r => r.id !== roomId) }));
      setEnvelopeElements(prev => { const next = { ...prev }; delete next[roomId]; return next; });
      let roomRef;
      if (isVRF && systemId) {
        roomRef = doc(db, 'projects', project.id, 'systems', systemId, 'rooms', roomId);
      } else {
        roomRef = systemId
          ? doc(db, 'projects', project.id, 'systems', systemId, 'zones', zoneId, 'rooms', roomId)
          : doc(db, 'projects', project.id, 'zones', zoneId, 'rooms', roomId);
      }
      await deleteDoc(roomRef);
      toast.success('Room deleted');
    } catch (error) {
      toast.error('Delete failed');
    }
  };

  // Debounced DB write timers
  const envElementDbTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const roomDbTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const analysisDbTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const pendingEnvelopeWritesRef = useRef<Record<string, {
    zoneId: string;
    roomId: string;
    elementId: string;
    data: Partial<EnvelopeElement>;
    systemId?: string;
    nextElements: EnvelopeElement[];
  }>>({});
  const pendingRoomWritesRef = useRef<Record<string, {
    zoneId: string;
    roomId: string;
    data: Partial<Room>;
    systemId?: string;
    mergedRoom?: Room;
  }>>({});
  const pendingAnalysisWritesRef = useRef<Record<string, {
    zoneId: string;
    roomId: string;
    systemId?: string;
    roomOverride?: Room;
    elementsOverride?: EnvelopeElement[];
  }>>({});

  const runPendingEnvelopeWrite = useCallback(async (key: string) => {
    const pending = pendingEnvelopeWritesRef.current[key];
    if (!pending) return;
    try {
      const { zoneId, roomId, elementId, data, systemId, nextElements } = pending;
      let elRef;
      if (isVRF && systemId) {
        elRef = doc(db, 'projects', project.id, 'systems', systemId, 'rooms', roomId, 'envelopeElements', elementId);
      } else {
        elRef = systemId
          ? doc(db, 'projects', project.id, 'systems', systemId, 'zones', zoneId, 'rooms', roomId, 'envelopeElements', elementId)
          : doc(db, 'projects', project.id, 'zones', zoneId, 'rooms', roomId, 'envelopeElements', elementId);
      }
      await updateDoc(elRef, data);
      schedulePersistRoomAnalysis(zoneId, roomId, systemId, undefined, nextElements);
    } catch (error) {
      toast.error('Update failed');
    } finally {
      delete pendingEnvelopeWritesRef.current[key];
      delete envElementDbTimersRef.current[key];
    }
  }, [isVRF, project.id, schedulePersistRoomAnalysis]);

  const runPendingRoomWrite = useCallback(async (key: string) => {
    const pending = pendingRoomWritesRef.current[key];
    if (!pending) return;
    try {
      const { zoneId, roomId, data, systemId, mergedRoom } = pending;
      let roomRef;
      if (isVRF && systemId) {
        roomRef = doc(db, 'projects', project.id, 'systems', systemId, 'rooms', roomId);
      } else {
        roomRef = systemId
          ? doc(db, 'projects', project.id, 'systems', systemId, 'zones', zoneId, 'rooms', roomId)
          : doc(db, 'projects', project.id, 'zones', zoneId, 'rooms', roomId);
      }
      await updateDoc(roomRef, data);
      if (mergedRoom) {
        schedulePersistRoomAnalysis(zoneId, roomId, systemId, mergedRoom, envelopeElements[roomId] || []);
      }
      setRoomSaveStates(prev => ({ ...prev, [roomId]: 'saved' }));
      setTimeout(() => setRoomSaveStates(prev => {
        const next = { ...prev };
        if (next[roomId] === 'saved') next[roomId] = 'idle';
        return next;
      }), 2500);
    } catch (error) {
      toast.error('Update failed');
      const roomId = pending?.roomId;
      if (roomId) {
        setRoomSaveStates(prev => ({ ...prev, [roomId]: 'idle' }));
      }
    } finally {
      delete pendingRoomWritesRef.current[key];
      delete roomDbTimersRef.current[key];
    }
  }, [isVRF, project.id, schedulePersistRoomAnalysis, envelopeElements]);

  const runPendingAnalysisWrite = useCallback(async (key: string) => {
    const pending = pendingAnalysisWritesRef.current[key];
    if (!pending) return;
    try {
      await persistRoomAnalysisSnapshot(
        pending.zoneId,
        pending.roomId,
        pending.systemId,
        pending.roomOverride,
        pending.elementsOverride,
      );
    } catch {
      // Keep UI responsive; the update handlers already surface write failures.
    } finally {
      delete pendingAnalysisWritesRef.current[key];
      delete analysisDbTimersRef.current[key];
    }
  }, [persistRoomAnalysisSnapshot]);

  // Always-current refs so flushPendingWrites can be stable (empty deps).
  // Without this, each of the three write callbacks changes every render
  // (due to their own unstable deps), making flushPendingWrites unstable,
  // which causes the beforeunload/visibilitychange/pagehide effect to
  // remove and re-add its listeners on every single render.
  const runPendingEnvelopeWriteRef = useRef(runPendingEnvelopeWrite);
  runPendingEnvelopeWriteRef.current = runPendingEnvelopeWrite;
  const runPendingRoomWriteRef = useRef(runPendingRoomWrite);
  runPendingRoomWriteRef.current = runPendingRoomWrite;
  const runPendingAnalysisWriteRef = useRef(runPendingAnalysisWrite);
  runPendingAnalysisWriteRef.current = runPendingAnalysisWrite;

  const flushPendingWrites = useCallback(async () => {
    const envKeys = Object.keys(pendingEnvelopeWritesRef.current);
    const roomKeys = Object.keys(pendingRoomWritesRef.current);
    const analysisKeys = Object.keys(pendingAnalysisWritesRef.current);

    envKeys.forEach((key) => {
      if (envElementDbTimersRef.current[key]) {
        clearTimeout(envElementDbTimersRef.current[key]);
      }
    });
    roomKeys.forEach((key) => {
      if (roomDbTimersRef.current[key]) {
        clearTimeout(roomDbTimersRef.current[key]);
      }
    });
    analysisKeys.forEach((key) => {
      if (analysisDbTimersRef.current[key]) {
        clearTimeout(analysisDbTimersRef.current[key]);
      }
    });

    await Promise.allSettled([
      ...envKeys.map((key) => runPendingEnvelopeWriteRef.current(key)),
      ...roomKeys.map((key) => runPendingRoomWriteRef.current(key)),
      ...analysisKeys.map((key) => runPendingAnalysisWriteRef.current(key)),
    ]);
  }, []); // stable — reads the three write callbacks via always-current refs

  const hasPendingWrites = useCallback(() => {
    return (
      Object.keys(pendingEnvelopeWritesRef.current).length > 0 ||
      Object.keys(pendingRoomWritesRef.current).length > 0 ||
      Object.keys(pendingAnalysisWritesRef.current).length > 0
    );
  }, []);

  function schedulePersistRoomAnalysis(
    zoneId: string,
    roomId: string,
    systemId?: string,
    roomOverride?: Room,
    elementsOverride?: EnvelopeElement[],
  ) {
    const key = `${zoneId}:${roomId}:${systemId || 'base'}`;
    pendingAnalysisWritesRef.current[key] = { zoneId, roomId, systemId, roomOverride, elementsOverride };
    if (analysisDbTimersRef.current[key]) {
      clearTimeout(analysisDbTimersRef.current[key]);
    }

    // Batch expensive analysis writes while the user is actively editing.
    analysisDbTimersRef.current[key] = setTimeout(() => {
      void runPendingAnalysisWrite(key);
    }, 5000);
  }

  const updateEnvelopeElementDebounced = useCallback(
    async (zoneId: string, roomId: string, elementId: string, data: Partial<EnvelopeElement>, systemId?: string) => {
      const key = `${roomId}:${elementId}`;
      
      // Cancel any pending update for this element
      if (envElementDbTimersRef.current[key]) {
        clearTimeout(envElementDbTimersRef.current[key]);
      }

      // Update state immediately for UI responsiveness
      const nextElements = ((envelopeElements[roomId] || []).map(el => el.id === elementId ? { ...el, ...data } : el)) as EnvelopeElement[];
      startTransition(() => {
        setEnvelopeElements(prev => ({
          ...prev,
          [roomId]: nextElements,
        }));
      });

      pendingEnvelopeWritesRef.current[key] = {
        zoneId,
        roomId,
        elementId,
        data,
        systemId,
        nextElements,
      };

      // Debounce the DB write (2000ms)
      envElementDbTimersRef.current[key] = setTimeout(() => {
        void runPendingEnvelopeWrite(key);
      }, 2000);
    },
    [envelopeElements, runPendingEnvelopeWrite]
  );

  const updateRoomDebounced = useCallback(
    async (zoneId: string, roomId: string, data: Partial<Room>, systemId?: string) => {
      const key = `${zoneId}:${roomId}`;

      // Cancel any pending update for this room
      if (roomDbTimersRef.current[key]) {
        clearTimeout(roomDbTimersRef.current[key]);
      }

      // Update state immediately for UI responsiveness
      const currentRoom = (rooms[zoneId] || []).find(r => r.id === roomId);
      const safeData = clampFalseCeilingToSlab(currentRoom, data);
      const existingPending = pendingRoomWritesRef.current[key];
      const baseRoom = existingPending?.mergedRoom ?? currentRoom;
      const mergedData = existingPending ? ({ ...existingPending.data, ...safeData } as Partial<Room>) : safeData;
      const mergedRoom = baseRoom ? ({ ...baseRoom, ...safeData } as Room) : undefined;
      startTransition(() => {
        setRooms(prev => ({
          ...prev,
          [zoneId]: (prev[zoneId] || []).map(r => r.id === roomId ? { ...r, ...safeData } : r),
        }));
      });
      setRoomSaveStates(prev => ({ ...prev, [roomId]: 'saving' }));

      pendingRoomWritesRef.current[key] = {
        zoneId,
        roomId,
        data: mergedData,
        systemId: systemId ?? existingPending?.systemId,
        mergedRoom,
      };

      // Debounce the DB write (2000ms)
      roomDbTimersRef.current[key] = setTimeout(() => {
        void runPendingRoomWrite(key);
      }, 2000);
    },
    [rooms, runPendingRoomWrite]
  );

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasPendingWrites()) return;
      void flushPendingWrites();
      event.preventDefault();
      event.returnValue = '';
    };

    const flushOnHidden = () => {
      if (document.visibilityState === 'hidden') {
        void flushPendingWrites();
      }
    };

    const flushOnPageHide = () => {
      void flushPendingWrites();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', flushOnHidden);
    window.addEventListener('pagehide', flushOnPageHide);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', flushOnHidden);
      window.removeEventListener('pagehide', flushOnPageHide);
    };
  }, [flushPendingWrites, hasPendingWrites]);

  const moveRoom = async (room: Room, sourceZoneId: string, targetZoneId: string) => {
    try {
      const sourceZone = zones.find(z => z.id === sourceZoneId) || systems.find(s => s.id === sourceZoneId);
      const targetZone = zones.find(z => z.id === targetZoneId) || systems.find(s => s.id === targetZoneId);
      
      if (!sourceZone || !targetZone) return;

      const sourceIsSystem = systems.some(s => s.id === sourceZoneId);
      const targetIsSystem = systems.some(s => s.id === targetZoneId);
      
      const sourceSystemId = (sourceZone as any).systemId || (sourceIsSystem ? sourceZoneId : undefined);
      const targetSystemId = (targetZone as any).systemId || (targetIsSystem ? targetZoneId : undefined);

      // 1. Get elements
      const elements = envelopeElements[room.id] || [];

      // 2. Define paths
      let targetPath;
      if (isVRF && targetIsSystem) {
        targetPath = collection(db, 'projects', project.id, 'systems', targetZoneId, 'rooms');
      } else {
        targetPath = targetSystemId
          ? collection(db, 'projects', project.id, 'systems', targetSystemId, 'zones', targetZoneId, 'rooms')
          : collection(db, 'projects', project.id, 'zones', targetZoneId, 'rooms');
      }

      // 3. Create new room
      const { id: oldId, ...roomData } = room;
      const newRoomRef = await addDoc(targetPath, roomData);
      const newRoomId = newRoomRef.id;

      // 4. Copy elements
      const copiedElements: EnvelopeElement[] = [];
      for (const el of elements) {
        const { id: elOldId, ...elData } = el;
        let elPath;
        if (isVRF && targetIsSystem) {
          elPath = collection(db, 'projects', project.id, 'systems', targetZoneId, 'rooms', newRoomId, 'envelopeElements');
        } else {
          elPath = targetSystemId
            ? collection(db, 'projects', project.id, 'systems', targetSystemId, 'zones', targetZoneId, 'rooms', newRoomId, 'envelopeElements')
            : collection(db, 'projects', project.id, 'zones', targetZoneId, 'rooms', newRoomId, 'envelopeElements');
        }
        const newElementRef = await addDoc(elPath, elData);
        copiedElements.push({ id: newElementRef.id, ...elData } as EnvelopeElement);
      }

      // 5. Delete old room
      let oldRoomRef;
      if (isVRF && sourceIsSystem) {
        oldRoomRef = doc(db, 'projects', project.id, 'systems', sourceZoneId, 'rooms', room.id);
      } else {
        oldRoomRef = sourceSystemId
          ? doc(db, 'projects', project.id, 'systems', sourceSystemId, 'zones', sourceZoneId, 'rooms', room.id)
          : doc(db, 'projects', project.id, 'zones', sourceZoneId, 'rooms', room.id);
      }
      await deleteDoc(oldRoomRef);

      // 6. Update local UI state immediately
      setRooms((prev) => {
        const next = { ...prev };
        next[sourceZoneId] = (next[sourceZoneId] || []).filter((r) => r.id !== room.id);
        next[targetZoneId] = [...(next[targetZoneId] || []), normalizeRoom({ id: newRoomId, ...roomData })];
        return next;
      });
      setEnvelopeElements((prev) => {
        const next = { ...prev };
        delete next[room.id];
        next[newRoomId] = copiedElements;
        return next;
      });
      await persistRoomAnalysisSnapshot(targetZoneId, newRoomId, targetSystemId, normalizeRoom({ id: newRoomId, ...roomData }), copiedElements);
      if (expandedRoom === room.id) {
        setExpandedRoom(newRoomId);
      }
      
      toast.success(`Moved ${room.name} to ${targetZone.name}`);
    } catch (error) {
      console.error('Move failed:', error);
      toast.error('Failed to move room');
    }
  };

  const saveProjectData = async () => {
    try {
      setEditLoading(true);

      const currentLongitude = project.longitude ?? project.data?.longitude;
      const currentLatitude = project.latitude ?? project.data?.latitude;
      const currentAltitude = project.altitude ?? project.data?.altitude ?? 0;
      const currentSummerTemp = project.summerDesignTemp ?? project.data?.summerDesignTemp ?? 95;
      const currentSummerRH = project.summerDesignHumidity ?? project.data?.summerDesignHumidity ?? 50;
      const currentMonsoonTemp = project.monsoonDesignTemp ?? project.data?.monsoonDesignTemp ?? 85;
      const currentMonsoonRH = project.monsoonDesignHumidity ?? project.data?.monsoonDesignHumidity ?? 85;
      const currentWinterTemp = project.winterDesignTemp ?? project.data?.winterDesignTemp ?? 30;
      const currentWinterRH = project.winterDesignHumidity ?? project.data?.winterDesignHumidity ?? 30;
      const currentIncludeMonsoon = project.includeMonsoon ?? project.data?.includeMonsoon ?? false;
      const currentInsideSummerTemp = project.insideSummerTemp ?? project.data?.insideSummerTemp ?? 75;
      const currentInsideSummerRH = project.insideSummerHumidity ?? project.data?.insideSummerHumidity ?? 50;
      const currentInsideMonsoonTemp = project.insideMonsoonTemp ?? project.data?.insideMonsoonTemp ?? currentInsideSummerTemp;
      const currentInsideMonsoonRH = project.insideMonsoonHumidity ?? project.data?.insideMonsoonHumidity ?? 55;
      const currentInsideWinterTemp = project.insideWinterTemp ?? project.data?.insideWinterTemp ?? 72;
      const currentInsideWinterRH = project.insideWinterHumidity ?? project.data?.insideWinterHumidity ?? 40;

      const resolvedName = editData.name.trim() !== '' ? editData.name.trim() : (project.name || '');
      const resolvedLocation = editData.location.trim() !== '' ? editData.location.trim() : (project.location || '');
      const resolvedLongitude = editData.longitude === '' ? currentLongitude : Number(editData.longitude);
      const resolvedLatitude = editData.latitude === '' ? currentLatitude : Number(editData.latitude);
      const resolvedAltitude = editData.altitude === '' ? currentAltitude : Number(editData.altitude);
      const resolvedIncludeMonsoon = editData.includeMonsoon ?? currentIncludeMonsoon;
      const resolvedSummerTemp = editData.summerDesignTemp === '' ? currentSummerTemp : Number(editData.summerDesignTemp);
      const resolvedSummerRH = editData.summerDesignHumidity === '' ? currentSummerRH : Number(editData.summerDesignHumidity);
      const resolvedMonsoonTemp = editData.monsoonDesignTemp === '' ? currentMonsoonTemp : Number(editData.monsoonDesignTemp);
      const resolvedMonsoonRH = editData.monsoonDesignHumidity === '' ? currentMonsoonRH : Number(editData.monsoonDesignHumidity);
      const resolvedWinterTemp = editData.winterDesignTemp === '' ? currentWinterTemp : Number(editData.winterDesignTemp);
      const resolvedWinterRH = editData.winterDesignHumidity === '' ? currentWinterRH : Number(editData.winterDesignHumidity);
      const resolvedInsideSummerTemp = editData.insideSummerTemp === '' ? currentInsideSummerTemp : Number(editData.insideSummerTemp);
      const resolvedInsideSummerRH = editData.insideSummerHumidity === '' ? currentInsideSummerRH : Number(editData.insideSummerHumidity);
      const resolvedInsideMonsoonTemp = editData.insideMonsoonTemp === '' ? currentInsideMonsoonTemp : Number(editData.insideMonsoonTemp);
      const resolvedInsideMonsoonRH = editData.insideMonsoonHumidity === '' ? currentInsideMonsoonRH : Number(editData.insideMonsoonHumidity);
      const resolvedInsideWinterTemp = editData.insideWinterTemp === '' ? currentInsideWinterTemp : Number(editData.insideWinterTemp);
      const resolvedInsideWinterRH = editData.insideWinterHumidity === '' ? currentInsideWinterRH : Number(editData.insideWinterHumidity);

      await updateDoc(doc(db, 'projects', project.id), {
        name: resolvedName,
        location: resolvedLocation,
        includeMonsoon: resolvedIncludeMonsoon,
        summerDesignTemp: resolvedSummerTemp,
        summerDesignHumidity: resolvedSummerRH,
        monsoonDesignTemp: resolvedMonsoonTemp,
        monsoonDesignHumidity: resolvedMonsoonRH,
        winterDesignTemp: resolvedWinterTemp,
        winterDesignHumidity: resolvedWinterRH,
        insideSummerTemp: resolvedInsideSummerTemp,
        insideSummerHumidity: resolvedInsideSummerRH,
        insideMonsoonTemp: resolvedInsideMonsoonTemp,
        insideMonsoonHumidity: resolvedInsideMonsoonRH,
        insideWinterTemp: resolvedInsideWinterTemp,
        insideWinterHumidity: resolvedInsideWinterRH,
        data: {
          ...(project.data || {}),
          longitude: resolvedLongitude,
          latitude: resolvedLatitude,
          altitude: resolvedAltitude,
          includeMonsoon: resolvedIncludeMonsoon,
          summerDesignTemp: resolvedSummerTemp,
          summerDesignHumidity: resolvedSummerRH,
          monsoonDesignTemp: resolvedMonsoonTemp,
          monsoonDesignHumidity: resolvedMonsoonRH,
          winterDesignTemp: resolvedWinterTemp,
          winterDesignHumidity: resolvedWinterRH,
          insideSummerTemp: resolvedInsideSummerTemp,
          insideSummerHumidity: resolvedInsideSummerRH,
          insideMonsoonTemp: resolvedInsideMonsoonTemp,
          insideMonsoonHumidity: resolvedInsideMonsoonRH,
          insideWinterTemp: resolvedInsideWinterTemp,
          insideWinterHumidity: resolvedInsideWinterRH,
        },
        updatedAt: new Date(),
      });
      toast.success('Project data updated!');
      setEditData({
        name: '',
        location: '',
        longitude: '',
        latitude: '',
        altitude: '',
        includeMonsoon: false,
        summerDesignTemp: '',
        summerDesignHumidity: '',
        monsoonDesignTemp: '',
        monsoonDesignHumidity: '',
        winterDesignTemp: '',
        winterDesignHumidity: '',
        insideSummerTemp: '',
        insideSummerHumidity: '',
        insideMonsoonTemp: '',
        insideMonsoonHumidity: '',
        insideWinterTemp: '',
        insideWinterHumidity: '',
      });
      setEditModalOpen(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to update project data');
    } finally {
      setEditLoading(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    // Find source zone and room
    let sourceZoneId = '';
    let roomToMove: Room | null = null;
    for (const [zId, rList] of Object.entries(rooms)) {
      const r = rList.find(room => room.id === activeId);
      if (r) {
        sourceZoneId = zId;
        roomToMove = r;
        break;
      }
    }

    if (!roomToMove) return;

    // Find target zone
    let targetZoneId = '';
    // If over a room, find its zone
    for (const [zId, rList] of Object.entries(rooms)) {
      if (rList.some(room => room.id === overId)) {
        targetZoneId = zId;
        break;
      }
    }
    // If over a zone container directly
    if (!targetZoneId && String(overId).startsWith('zone-')) {
      targetZoneId = String(overId).replace('zone-', '');
    }

    if (targetZoneId && targetZoneId !== sourceZoneId) {
      await moveRoom(roomToMove, sourceZoneId, targetZoneId);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-6 pb-20">

        {/* ── Compact header bar ─────────────────────────────────────────── */}
        <div className="sticky top-0 z-20 -mx-2 px-2 py-2 bg-gray-50/95 backdrop-blur border-b border-gray-200 rounded-lg flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-gray-900 truncate">{project.name}</h2>
            <p className="text-xs text-gray-400">
              {isHybrid ? 'Hybrid' : isVRF ? 'VRF — System › Room' : 'CAC — Zone › Room'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onNavigate && (
              <Button variant="outline" size="sm" onClick={() => onNavigate('methodology')} className="gap-1 text-gray-600 border-gray-300">
                <BookOpen className="w-3.5 h-3.5" /> Methodology
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Debug log for export state
                console.log('[Excel Export] systems:', systems);
                console.log('[Excel Export] zones:', zones);
                console.log('[Excel Export] rooms:', rooms);
                // Allow export if (systems OR zones) and rooms exist
                if ((systems.length === 0 && zones.length === 0) || Object.keys(rooms).length === 0) {
                  toast.error('Data is still loading or incomplete. Please try again.');
                  return;
                }
                generateExcelReport(project, systems, zones, rooms, envelopeElements);
              }}
              className="gap-1 bg-green-50 text-green-700 border-green-200 hover:bg-green-100 shadow-sm"
            >
              <Download className="w-3.5 h-3.5" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => generatePDFReport(project, systems, zones, rooms, envelopeElements)} className="gap-1 bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100 shadow-sm">
              <Download className="w-3.5 h-3.5" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              setEditData({
                name: '',
                location: '',
                longitude: '',
                latitude: '',
                altitude: '',
                includeMonsoon: project.includeMonsoon ?? project.data?.includeMonsoon ?? false,
                summerDesignTemp: '',
                summerDesignHumidity: '',
                monsoonDesignTemp: '',
                monsoonDesignHumidity: '',
                winterDesignTemp: '',
                winterDesignHumidity: '',
                insideSummerTemp: '',
                insideSummerHumidity: '',
                insideMonsoonTemp: '',
                insideMonsoonHumidity: '',
                insideWinterTemp: '',
                insideWinterHumidity: '',
              });
              setEditModalOpen(true);
            }} className="gap-1 text-blue-600 border-blue-200 hover:bg-blue-50 shadow-sm">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Workflow</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="font-semibold text-slate-700">Step 1</p>
              <p className="text-slate-500">Project Conditions</p>
            </div>
            <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2">
              <p className="font-semibold text-orange-700">Step 2</p>
              <p className="text-orange-600">Zones & Rooms</p>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
              <p className="font-semibold text-blue-700">Step 3</p>
              <p className="text-blue-600">Room-Level Loads</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className="font-semibold text-emerald-700">Step 4</p>
              <p className="text-emerald-600">Psychrometric Review</p>
            </div>
          </div>
        </div>

        {/* ── Project summary strip ─────────────────────────────────────── */}
        {projectTotals.roomCount > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-orange-50/40 to-amber-50/70 shadow-sm overflow-hidden">
            <div className="border-b border-slate-200/80 px-5 py-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-700">Step 1</p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-900">Project-Level Summary</h3>
                  <p className="mt-1 text-xs text-slate-500">Live aggregate of all room loads, airflow, and conditioned area.</p>
                </div>
                <div className="rounded-xl border border-orange-200 bg-orange-100/70 px-4 py-2 min-w-[220px]">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-700">AHU Governing Basis</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-sm font-semibold text-orange-800">{projectTotals.peakSeason}</span>
                    <span className="rounded-full border border-orange-300 bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
                      {projectTotals.totalTR === projectTotals.governingCfmTR ? 'CFM Gov' : 'Load Gov'}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-2xl font-bold text-orange-900">{projectTotals.totalTR.toFixed(2)} <span className="text-sm font-semibold text-orange-600">TR</span></p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-700">Summer Load</p>
                    <p className="mt-2 font-mono text-xl font-bold text-orange-900">{projectTotals.summer.governingTR.toFixed(2)} <span className="text-[11px] font-semibold text-orange-600">TR</span></p>
                  </div>
                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-orange-700">{Math.round(projectTotals.summer.totalCooling).toLocaleString()} BTU/h</span>
                </div>
                <p className="mt-2 text-xs text-orange-600">Gov = max(Load {projectTotals.summer.totalTR.toFixed(2)} TR, CFM {projectTotals.summer.cfmTR.toFixed(2)} TR)</p>
              </div>
              <div className={`rounded-xl border px-4 py-3 ${projectTotals.includeMonsoon ? 'border-teal-200 bg-teal-50' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${projectTotals.includeMonsoon ? 'text-teal-700' : 'text-slate-600'}`}>Monsoon Load</p>
                    <p className={`mt-2 font-mono text-xl font-bold ${projectTotals.includeMonsoon ? 'text-teal-900' : 'text-slate-700'}`}>{projectTotals.includeMonsoon ? projectTotals.monsoon.governingTR.toFixed(2) : '--'} <span className={`text-[11px] font-semibold ${projectTotals.includeMonsoon ? 'text-teal-600' : 'text-slate-500'}`}>TR</span></p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${projectTotals.includeMonsoon ? 'bg-white/80 text-teal-700' : 'bg-white text-slate-500'}`}>{projectTotals.includeMonsoon ? `${Math.round(projectTotals.monsoon.totalCooling).toLocaleString()} BTU/h` : 'Disabled'}</span>
                </div>
                <p className={`mt-2 text-xs ${projectTotals.includeMonsoon ? 'text-teal-600' : 'text-slate-500'}`}>{projectTotals.includeMonsoon ? `Gov = max(Load ${projectTotals.monsoon.totalTR.toFixed(2)} TR, CFM ${projectTotals.monsoon.cfmTR.toFixed(2)} TR)` : 'Enable monsoon to compare seasonal peak.'}</p>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-700">Heating Load</p>
                <p className="mt-2 font-mono text-xl font-bold text-blue-900">{Math.round(projectTotals.totalHeating).toLocaleString()}</p>
                <p className="mt-1 text-xs text-blue-600">BTU/h winter design basis</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Design Airflow</p>
                <p className="mt-2 font-mono text-xl font-bold text-emerald-900">{Math.round(projectTotals.totalDesignCfm).toLocaleString()}</p>
                <p className="mt-1 text-xs text-emerald-600">CFM governed by {projectTotals.governingAirflowSeason.toLowerCase()} season</p>
              </div>
              <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-700">Conditioned Area</p>
                <p className="mt-2 font-mono text-xl font-bold text-violet-900">{Math.round(projectTotals.totalArea).toLocaleString()}</p>
                <p className="mt-1 text-xs text-violet-600">{projectTotals.roomCount} rooms included in load model</p>
              </div>
            </div>

            <div className="border-t border-slate-200/80 bg-white/70 px-5 py-4">
              {projectTotals.includeMonsoon ? (
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Seasonal Comparison</p>
                    <p className="mt-1 text-xs font-semibold text-slate-700">
                      <span className="font-mono text-orange-700">S {projectTotals.summer.governingTR.toFixed(2)} TR</span>
                      <span className="mx-1 text-slate-300">vs</span>
                      <span className="font-mono text-teal-700">M {projectTotals.monsoon.governingTR.toFixed(2)} TR</span>
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Delta</p>
                    <p className="mt-1 font-mono text-sm font-bold text-slate-800">{Math.abs(projectTotals.monsoon.governingTR - projectTotals.summer.governingTR).toFixed(2)} TR</p>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-blue-600">Load Governor</p>
                    <p className="mt-1 text-sm font-semibold text-blue-800">{projectTotals.governingLoadSeason} <span className="font-mono">{projectTotals.governingLoadTR.toFixed(2)} TR</span></p>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-emerald-600">Airflow Governor</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-800">{projectTotals.governingAirflowSeason} <span className="font-mono">{projectTotals.governingCfmTR.toFixed(2)} TR</span></p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-600">
                  Monsoon comparison is blank because Include Monsoon Calculation is OFF. Governing cooling currently follows Summer.
                </p>
              )}
            </div>

            <div className="border-t border-slate-200/80 bg-white/70 px-5 py-3 flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setProjectPsychroOpen((prev) => !prev)}
                aria-expanded={projectPsychroOpen}
                className="text-xs h-8"
              >
                {projectPsychroOpen ? 'Hide Project Psychrometric' : 'Show Project Psychrometric'}
              </Button>
            </div>

            {projectPsychroOpen && (
              <div className="border-t border-slate-200/80 p-4 bg-white/90">
                <div className="mx-auto w-full max-w-5xl space-y-3">
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">Project Psychrometrics</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {includeMonsoon ? 'Summer and Monsoon design conditions' : 'Summer design conditions only'} · Altitude {projectAltitude || 0} ft
                  </p>
                </div>

                <div className={`grid gap-4 ${includeMonsoon ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
                  <div className="rounded-xl border border-orange-200 bg-orange-50/40 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wider text-orange-700">Summer Psychrometric</p>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-orange-700">
                        {summerDesignTemp}°F / {summerDesignHumidity}% RH
                      </span>
                    </div>
                    <PsychrometricChart
                      width={620}
                      height={240}
                      altitude={projectAltitude || 0}
                      points={[
                        { temp: summerDesignTemp, rh: summerDesignHumidity, label: 'Summer Outdoor', color: '#ef4444' },
                        { temp: insideSummerTemp, rh: insideSummerHumidity, label: 'Summer Indoor', color: '#2563eb' },
                      ]}
                    />
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase text-red-700">Outdoor</p>
                        <p className="font-semibold text-red-800">{summerDesignTemp}°F</p>
                        <p className="text-red-600">{summerDesignHumidity}% RH</p>
                      </div>
                      <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase text-blue-700">Indoor</p>
                        <p className="font-semibold text-blue-800">{insideSummerTemp}°F</p>
                        <p className="text-blue-600">{insideSummerHumidity}% RH</p>
                      </div>
                    </div>
                  </div>

                  <div className={`rounded-xl border p-4 ${includeMonsoon ? 'border-teal-200 bg-teal-50/40' : 'border-slate-200 bg-slate-50/70 border-dashed'}`}>
                    <div className="mb-3 flex items-center justify-between">
                      <p className={`text-xs font-bold uppercase tracking-wider ${includeMonsoon ? 'text-teal-700' : 'text-slate-500'}`}>Monsoon Psychrometric</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${includeMonsoon ? 'bg-white text-teal-700' : 'bg-white text-slate-500'}`}>
                        {includeMonsoon ? `${monsoonDesignTemp}°F / ${monsoonDesignHumidity}% RH` : 'Blank'}
                      </span>
                    </div>
                    {includeMonsoon ? (
                      <>
                        <PsychrometricChart
                          width={620}
                          height={240}
                          altitude={projectAltitude || 0}
                          points={[
                            { temp: monsoonDesignTemp, rh: monsoonDesignHumidity, label: 'Monsoon Outdoor', color: '#0f766e' },
                            { temp: insideMonsoonTemp, rh: insideMonsoonHumidity, label: 'Monsoon Indoor', color: '#0ea5e9' },
                          ]}
                        />
                        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                          <div className="rounded-lg border border-teal-100 bg-teal-50 px-3 py-2">
                            <p className="text-[10px] font-bold uppercase text-teal-700">Outdoor</p>
                            <p className="font-semibold text-teal-800">{monsoonDesignTemp}°F</p>
                            <p className="text-teal-600">{monsoonDesignHumidity}% RH</p>
                          </div>
                          <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2">
                            <p className="text-[10px] font-bold uppercase text-sky-700">Indoor</p>
                            <p className="font-semibold text-sky-800">{insideMonsoonTemp}°F</p>
                            <p className="text-sky-600">{insideMonsoonHumidity}% RH</p>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-center">
                        <div className="px-4">
                          <p className="text-sm font-semibold text-slate-600">Monsoon chart is blank</p>
                          <p className="mt-1 text-xs text-slate-500">Enable Include Monsoon Calculation in Project Edit to run and visualize monsoon conditions.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {includeMonsoon && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
                    Governing Cooling: <span className="font-semibold">{projectTotals.peakSeason}</span> based on project cooling comparison.
                  </div>
                )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Zone / System management ───────────────────────────────────── */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          {/* Section header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">
                Step 2: 
                <span className="ml-1">
                {isVRF ? 'Systems & Rooms' : isHybrid ? 'Systems & Zones' : 'Zones & Rooms'}
                </span>
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {zones.length} zone{zones.length !== 1 ? 's' : ''}{systems.length > 0 ? ` · ${systems.length} system${systems.length !== 1 ? 's' : ''}` : ''}
              </p>
            </div>
            {canEdit && (
              <div className="flex gap-2">
                {(isVRF || isHybrid) && (
                  <Button size="sm" onClick={addSystem} className="gap-1 bg-blue-600 hover:bg-blue-700 text-xs h-8">
                    <Plus className="w-3.5 h-3.5" /> Add System
                  </Button>
                )}
                {!isVRF && (
                  <Button size="sm" onClick={() => addZone()} className="gap-1 bg-orange-600 hover:bg-orange-700 text-xs h-8">
                    <Plus className="w-3.5 h-3.5" /> Add Zone
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Zone / System list */}
          <div className="divide-y divide-gray-100">
            {dataLoading ? (
              <div className="py-12 text-center text-gray-500">
                <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-gray-400" />
                <p className="text-sm">Loading project structure...</p>
              </div>
            ) : zones.length === 0 && systems.length === 0 ? (
              <div className="text-center py-16">
                <Building className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-500">No zones yet</p>
                <p className="text-xs text-gray-400 mt-1">Click "Add Zone" above to start building your load calculation</p>
              </div>
            ) : (
              <ZoneList
                systems={systems}
                zones={zones}
                rooms={rooms}
                liveRooms={liveRooms}
                envelopeElements={liveEnvelopeElements}
                expandedZone={expandedZone}
                setExpandedZone={setExpandedZone}
                expandedSystem={expandedSystem}
                setExpandedSystem={setExpandedSystem}
                expandedRoom={expandedRoom}
                setExpandedRoom={setExpandedRoom}
                addZone={addZone}
                addRoom={addRoom}
                updateZone={updateZone}
                updateSystem={updateSystem}
                deleteZone={deleteZone}
                deleteSystem={deleteSystem}
                updateRoom={updateRoom}
                deleteRoom={deleteRoom}
                addEnvelopeElement={addEnvelopeElement}
                updateEnvelopeElement={updateEnvelopeElementDebounced}
                deleteEnvelopeElement={deleteEnvelopeElement}
                saveEnvelopeChanges={saveEnvelopeChanges}
                onRoomDraftChange={handleRoomDraftChange}
                onEnvelopeDraftChange={handleEnvelopeDraftChange}
                onZoneConditionDraftsChange={handleZoneConditionDraftsChange}
                project={project}
                userProfile={userProfile}
                defaultDesignConditions={defaultDesignConditions}
                canEdit={canEdit}
                isVRF={isVRF}
                isHybrid={isHybrid}
                roomSaveStates={roomSaveStates}
              />
            )}
          </div>
        </div>

      </div>

      {/* Edit Project Data Modal */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Project Data</DialogTitle>
            <DialogDescription>Update project metadata and design conditions</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Project Name</Label>
              <Input
                id="edit-name"
                value={editData.name}
                onChange={(e) => setEditData({...editData, name: e.target.value})}
                placeholder={project.name || 'Project name'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-location">Location</Label>
              <Input
                id="edit-location"
                value={editData.location}
                onChange={(e) => setEditData({...editData, location: e.target.value})}
                placeholder={project.location || 'City, State'}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-latitude">Latitude</Label>
                <Input
                  id="edit-latitude"
                  type="number"
                  step="0.0001"
                  value={editData.latitude}
                  onChange={(e) => setEditData({...editData, latitude: e.target.value})}
                  placeholder={(project.latitude ?? project.data?.latitude)?.toString() || 'Latitude'}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-longitude">Longitude</Label>
                <Input
                  id="edit-longitude"
                  type="number"
                  step="0.0001"
                  value={editData.longitude}
                  onChange={(e) => setEditData({...editData, longitude: e.target.value})}
                  placeholder={(project.longitude ?? project.data?.longitude)?.toString() || 'Longitude'}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-altitude">Altitude (ft)</Label>
              <Input
                id="edit-altitude"
                type="number"
                value={editData.altitude}
                onChange={(e) => setEditData({...editData, altitude: e.target.value})}
                placeholder={(project.altitude ?? project.data?.altitude)?.toString() || 'Elevation in feet'}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-teal-200 bg-teal-50 px-3 py-2">
              <Label htmlFor="edit-include-monsoon" className="font-semibold text-teal-700">Include Monsoon</Label>
              <input
                id="edit-include-monsoon"
                type="checkbox"
                checked={editData.includeMonsoon}
                onChange={(e) => setEditData({ ...editData, includeMonsoon: e.target.checked })}
                className="h-4 w-4"
              />
            </div>
            <Separator />
            <div className="space-y-2">
              <Label className="font-semibold">Summer Design Conditions</Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-summer-temp">Temperature (°F)</Label>
                  <Input
                    id="edit-summer-temp"
                    type="number"
                    step="0.1"
                    value={editData.summerDesignTemp}
                    onChange={(e) => setEditData({...editData, summerDesignTemp: e.target.value})}
                    placeholder={(project.summerDesignTemp ?? project.data?.summerDesignTemp ?? 95).toString()}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-summer-humidity">Humidity (%)</Label>
                  <Input
                    id="edit-summer-humidity"
                    type="number"
                    step="0.1"
                    value={editData.summerDesignHumidity}
                    onChange={(e) => setEditData({...editData, summerDesignHumidity: e.target.value})}
                    placeholder={(project.summerDesignHumidity ?? project.data?.summerDesignHumidity ?? 50).toString()}
                  />
                </div>
              </div>
            </div>
            {editData.includeMonsoon && (
              <div className="space-y-2">
                <Label className="font-semibold">Monsoon Design Conditions</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-monsoon-temp">Temperature (°F)</Label>
                    <Input
                      id="edit-monsoon-temp"
                      type="number"
                      step="0.1"
                      value={editData.monsoonDesignTemp}
                      onChange={(e) => setEditData({ ...editData, monsoonDesignTemp: e.target.value })}
                      placeholder={(project.monsoonDesignTemp ?? project.data?.monsoonDesignTemp ?? 85).toString()}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-monsoon-humidity">Humidity (%)</Label>
                    <Input
                      id="edit-monsoon-humidity"
                      type="number"
                      step="0.1"
                      value={editData.monsoonDesignHumidity}
                      onChange={(e) => setEditData({ ...editData, monsoonDesignHumidity: e.target.value })}
                      placeholder={(project.monsoonDesignHumidity ?? project.data?.monsoonDesignHumidity ?? 85).toString()}
                    />
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label className="font-semibold">Winter Design Conditions</Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-winter-temp">Temperature (°F)</Label>
                  <Input
                    id="edit-winter-temp"
                    type="number"
                    step="0.1"
                    value={editData.winterDesignTemp}
                    onChange={(e) => setEditData({...editData, winterDesignTemp: e.target.value})}
                    placeholder={(project.winterDesignTemp ?? project.data?.winterDesignTemp ?? 30).toString()}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-winter-humidity">Humidity (%)</Label>
                  <Input
                    id="edit-winter-humidity"
                    type="number"
                    step="0.1"
                    value={editData.winterDesignHumidity}
                    onChange={(e) => setEditData({...editData, winterDesignHumidity: e.target.value})}
                    placeholder={(project.winterDesignHumidity ?? project.data?.winterDesignHumidity ?? 30).toString()}
                  />
                </div>
              </div>
            </div>
            <Separator />
            <div className="space-y-2">
              <Label className="font-semibold">Inside Design Conditions</Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-inside-summer-temp">Summer Temp (°F)</Label>
                  <Input
                    id="edit-inside-summer-temp"
                    type="number"
                    step="0.1"
                    value={editData.insideSummerTemp}
                    onChange={(e) => setEditData({ ...editData, insideSummerTemp: e.target.value })}
                    placeholder={(project.insideSummerTemp ?? project.data?.insideSummerTemp ?? 75).toString()}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-inside-summer-rh">Summer RH (%)</Label>
                  <Input
                    id="edit-inside-summer-rh"
                    type="number"
                    step="0.1"
                    value={editData.insideSummerHumidity}
                    onChange={(e) => setEditData({ ...editData, insideSummerHumidity: e.target.value })}
                    placeholder={(project.insideSummerHumidity ?? project.data?.insideSummerHumidity ?? 50).toString()}
                  />
                </div>
              </div>
              {editData.includeMonsoon && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-inside-monsoon-temp">Monsoon Temp (°F)</Label>
                    <Input
                      id="edit-inside-monsoon-temp"
                      type="number"
                      step="0.1"
                      value={editData.insideMonsoonTemp}
                      onChange={(e) => setEditData({ ...editData, insideMonsoonTemp: e.target.value })}
                      placeholder={(project.insideMonsoonTemp ?? project.data?.insideMonsoonTemp ?? project.insideSummerTemp ?? 75).toString()}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-inside-monsoon-rh">Monsoon RH (%)</Label>
                    <Input
                      id="edit-inside-monsoon-rh"
                      type="number"
                      step="0.1"
                      value={editData.insideMonsoonHumidity}
                      onChange={(e) => setEditData({ ...editData, insideMonsoonHumidity: e.target.value })}
                      placeholder={(project.insideMonsoonHumidity ?? project.data?.insideMonsoonHumidity ?? 55).toString()}
                    />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-inside-winter-temp">Winter Temp (°F)</Label>
                  <Input
                    id="edit-inside-winter-temp"
                    type="number"
                    step="0.1"
                    value={editData.insideWinterTemp}
                    onChange={(e) => setEditData({ ...editData, insideWinterTemp: e.target.value })}
                    placeholder={(project.insideWinterTemp ?? project.data?.insideWinterTemp ?? 72).toString()}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-inside-winter-rh">Winter RH (%)</Label>
                  <Input
                    id="edit-inside-winter-rh"
                    type="number"
                    step="0.1"
                    value={editData.insideWinterHumidity}
                    onChange={(e) => setEditData({ ...editData, insideWinterHumidity: e.target.value })}
                    placeholder={(project.insideWinterHumidity ?? project.data?.insideWinterHumidity ?? 40).toString()}
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditData({
                  name: '',
                  location: '',
                  longitude: '',
                  latitude: '',
                  altitude: '',
                  includeMonsoon: false,
                  summerDesignTemp: '',
                  summerDesignHumidity: '',
                  monsoonDesignTemp: '',
                  monsoonDesignHumidity: '',
                  winterDesignTemp: '',
                  winterDesignHumidity: '',
                  insideSummerTemp: '',
                  insideSummerHumidity: '',
                  insideMonsoonTemp: '',
                  insideMonsoonHumidity: '',
                  insideWinterTemp: '',
                  insideWinterHumidity: '',
                });
                setEditModalOpen(false);
              }}
              disabled={editLoading}
            >
              Cancel
            </Button>
            <Button onClick={saveProjectData} disabled={editLoading} className="bg-blue-600 hover:bg-blue-700">
              {editLoading ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DndContext>
  );
});

export default LoadCalculator;
