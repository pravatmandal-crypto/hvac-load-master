
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
import { Plus, Download, Building, BookOpen, Pencil, Loader2, BarChart3, Thermometer, Droplets, MapPin, Settings, AlertTriangle } from 'lucide-react';
import { MetDataImporterDialog } from './MetDataImporterDialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Separator } from '../ui/separator';
import { db } from '../../lib/firebase';
import { collection, addDoc, getDocs, onSnapshot, doc, deleteDoc, updateDoc, setDoc, deleteField, writeBatch, serverTimestamp } from 'firebase/firestore';
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
  calculateTFALoad,
  calculatePsychrometrics,
  calculateCoilParameters,
  calculateRoomVolume,
  calculateReheat,
  getRecommendedAch,
  getMinAdp,
  type RoomDetails,
} from '../../lib/hvac';
import { EnvelopeElement, ACTIVITY_TYPES, ACTIVITY_ACH_RECOMMENDATIONS } from '../../lib/hvac/constants';


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
import { generatePDFReport, generateEquipmentSchedulePDF, generateEngineeringReviewPDF } from '../../services/reportService';
import { generateExcelReport } from '../../services/excelService';
import { envelopeCache } from '../../lib/envelopeCache';
import ZoneList from './ZoneList';

export type LoadCalculatorHandle = {
  saveAllDirty: () => Promise<void>;
};

// Merges Firestore zone docs (authoritative for name/conditions) with room-derived zones.
// Firestore zones win on name and condition overrides; room-derived data wins on systemId/runtime fields.
// Empty zones from Firestore (no rooms yet) are always included.
function mergeZones(fsZones: Zone[], roomZones: Zone[]): Zone[] {
  const fsMap = new Map(fsZones.map(z => [z.id, z]));
  const roomMap = new Map(roomZones.map(z => [z.id, z]));
  const merged: Zone[] = [];
  // All FS zones, enriched with room-derived runtime fields (systemId etc.)
  for (const fz of fsZones) {
    const rz = roomMap.get(fz.id);
    merged.push({ ...rz, ...fz, ...(rz?.systemId ? { systemId: rz.systemId } : {}) });
  }
  // Any room-derived zones not in Firestore (legacy rooms without a zone doc)
  for (const rz of roomZones) {
    if (!fsMap.has(rz.id)) merged.push(rz);
  }
  return merged;
}

// Native-input className matching the shadcn/base-ui Input style.
// Used in the Edit Project dialog because the base-ui FieldControl wrapper had
// a bug where typing did not flush state to the displayed value for non-first
// inputs (e.g. on a cloned project, only Project Name was editable).
const EDIT_INPUT_CLS = "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30";

const LoadCalculator = forwardRef<LoadCalculatorHandle, { project: any; userProfile: any; onNavigate?: (id: string) => void; onUnsavedChangesChange?: (has: boolean) => void; reloadKey?: number }>(
  function LoadCalculator({ project, userProfile, onNavigate, onUnsavedChangesChange, reloadKey }, ref) {
  const analysisBackfillDoneRef = useRef<Set<string>>(new Set());
  const oaFacphMigrationDoneRef = useRef<Set<string>>(new Set());
  const loadedEnvelopeRoomsRef = useRef<Set<string>>(new Set());
  const backfillRunningRef = useRef(false);
  const migrationRunningRef = useRef(false);
  const hasAutoExpandedZoneRef = useRef(false);
  // Declared up here (instead of next to the migration useEffect) so the room-listener
  // useEffect can clear them on project switch.
  const zoneRenameMigrationDoneRef = useRef<Set<string>>(new Set());
  const zoneRenameMigrationRunningRef = useRef(false);
  const legacyDefaultOaFacph = Number(project?.legacyDefaultOaFacph ?? project?.data?.legacyDefaultOaFacph ?? 1.5);

  const normalizeRoom = (r: any): Room => {
    const rawFacph = r.facph ?? r.data?.facph;
    const facphMissing = rawFacph === undefined || rawFacph === null || rawFacph === '';
    const normalizedFacph = facphMissing ? legacyDefaultOaFacph : Number(rawFacph);

    return {
      id: r.id,
      name: r.name ?? r.data?.name ?? '',
      floor: r.floor ?? r.data?.floor ?? 'Ground',
      length: r.length ?? r.data?.length ?? 0,
      width: r.width ?? r.data?.width ?? 0,
      height: r.height ?? r.data?.height ?? 0,
      hasFalseCeiling: r.hasFalseCeiling ?? r.data?.hasFalseCeiling ?? false,
      falseCeilingHeight: r.falseCeilingHeight ?? r.data?.falseCeilingHeight ?? 8,
      facph: Number.isFinite(normalizedFacph) ? normalizedFacph : legacyDefaultOaFacph,
      peopleCount: r.peopleCount ?? r.data?.peopleCount ?? 0,
      activityType: r.activityType ?? r.data?.activityType ?? 'office',
      achProfile: r.achProfile ?? r.data?.achProfile ?? r.activityType ?? r.data?.activityType ?? 'office',
      spaceType: r.spaceType ?? r.data?.spaceType ?? 'office_general',
      lightsWattsPerSqft: r.lightsWattsPerSqft ?? r.data?.lightsWattsPerSqft ?? 0,
      equipmentKW: r.equipmentKW ?? r.data?.equipmentKW ?? 0,
      othersKW: r.othersKW ?? r.data?.othersKW ?? 0,
      sensibleSafetyFactor: r.sensibleSafetyFactor ?? r.data?.sensibleSafetyFactor ?? 10,
      latentSafetyFactor: r.latentSafetyFactor ?? r.data?.latentSafetyFactor ?? 5,
      grandTotalSafetyFactor: r.grandTotalSafetyFactor ?? r.data?.grandTotalSafetyFactor ?? 3,
      sensibleSafetyPercent: r.sensibleSafetyPercent ?? r.data?.sensibleSafetyPercent,
      latentSafetyPercent: r.latentSafetyPercent ?? r.data?.latentSafetyPercent,
      overallSafetyPercent: r.overallSafetyPercent ?? r.data?.overallSafetyPercent,
      heatingSafetyPercent: r.heatingSafetyPercent ?? r.data?.heatingSafetyPercent,
      heatingPickupPercent: r.heatingPickupPercent ?? r.data?.heatingPickupPercent,
      includeHumidifier: r.includeHumidifier ?? r.data?.includeHumidifier ?? false,
      ductGainPct: r.ductGainPct ?? r.data?.ductGainPct ?? 2,
      fanGainPct: r.fanGainPct ?? r.data?.fanGainPct ?? 3,
      _oaFacphMigrated: r._oaFacphMigrated ?? r.data?._oaFacphMigrated ?? false,
      _oaFacphMigrationSource: r._oaFacphMigrationSource ?? r.data?._oaFacphMigrationSource,
      _oaFacphMigratedAt: r._oaFacphMigratedAt ?? r.data?._oaFacphMigratedAt,
      _oaFacphWasMissingOnLoad: facphMissing,
      zoneId: r.zoneId,
      zoneName: r.zoneName,
      systemId: r.systemId,
      systemName: r.systemName,
    };
  };

  const [systems, setSystems] = useState<HVACSystem[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [equipSystems, setEquipSystems] = useState<any[]>([]);
  const [rooms, setRooms] = useState<Record<string, Room[]>>({});
  const [envelopeElements, setEnvelopeElements] = useState<Record<string, EnvelopeElement[]>>({});
  const [expandedZone, setExpandedZone] = useState<string | null>(null);
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);
  const [expandedSystem, setExpandedSystem] = useState<string | null>(null);
  
  // Edit Project Data state
  const [editModalOpen, setEditModalOpen] = useState(false);
  // Met Data Importer modal — opened from inside the Edit dialog
  const [metDataDialogOpen, setMetDataDialogOpen] = useState(false);
  const [editData, setEditData] = useState({
    name: '',
    location: '',
    longitude: '',
    latitude: '',
    altitude: '',
    includeMonsoon: false,
    includeWinter: false,
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


  const userRole = userProfile?.role;
  // Allow editing in offline/internal flows where role may be absent from profile payload.
  const canEdit = !userRole || ['Super', 'Admin A', 'Admin B', 'Design Team'].includes(userRole);

  // Use project fields for design conditions and location
  const projectAltitude = project.altitude ?? (project.data?.altitude ?? 0);
  const projectLatitude = project.latitude ?? (project.data?.latitude ?? undefined);
  const projectLongitude = project.longitude ?? (project.data?.longitude ?? undefined);
  const includeMonsoon = project.includeMonsoon ?? project.data?.includeMonsoon ?? false;
  const includeWinter  = project.includeWinter  ?? project.data?.includeWinter  ?? false;
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
    includeWinter,
  }), [
    summerDesignTemp, insideSummerTemp, summerDesignHumidity, insideSummerHumidity,
    projectAltitude, projectLatitude, projectLongitude,
    winterDesignTemp, winterDesignHumidity, insideWinterTemp, insideWinterHumidity,
    includeWinter,
  ]);

  const getRoomRef = (_zoneId: string, roomId: string, _systemId?: string) => {
    return doc(db, 'projects', project.id, 'rooms', roomId);
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
      includeWinter,
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

    try {
    // ── TFA / DOAS detection ──
    // A room is TFA-served if EITHER its primary system is in some DOAS's
    // doasLinkedSystemIds (legacy) OR its zone is in some DOAS's
    // doasLinkedZoneIds (Phase B+, zone-granularity). Otherwise behave exactly
    // as before (backward-compat: projects without a DOAS see identical numbers).
    // Phase C: room.tfaMode='no-tfa' opts out even if the zone is linked.
    const doasCandidate = (systemId || zoneId)
      ? equipSystems.find((s: any) => {
          if (s?.type !== 'DOAS') return false;
          const sysIds = (s?.doasLinkedSystemIds ?? []) as string[];
          const zoneIds = (s?.doasLinkedZoneIds ?? []) as string[];
          if (systemId && sysIds.includes(systemId)) return true;
          if (zoneId && zoneIds.includes(zoneId)) return true;
          if (systemId && zoneIds.includes(systemId)) return true;
          return false;
        })
      : null;
    // Resolve effective TFA mode: explicit room override → zone default → 'tfa-served'.
    const rawRoomMode = (roomSource as any)?.tfaMode as string | undefined;
    const zoneDocForRoom = zones.find((z: any) => z.id === zoneId);
    const zoneDefaultMode = (zoneDocForRoom as any)?.tfaDefaultMode as string | undefined;
    const effectiveTfaMode: 'no-tfa' | 'tfa-served' | 'tfa-only' = !doasCandidate
      ? 'no-tfa'
      : (rawRoomMode === 'no-tfa' || rawRoomMode === 'tfa-served' || rawRoomMode === 'tfa-only')
        ? rawRoomMode
        : (zoneDefaultMode === 'tfa-only' || zoneDefaultMode === 'tfa-served')
          ? zoneDefaultMode
          : 'tfa-served';
    const roomTfaMode = effectiveTfaMode; // alias used below
    const doasForThis = effectiveTfaMode === 'no-tfa' ? null : doasCandidate;
    const isTFA = !!doasForThis;
    const baseDc = getDesignConditionsForZone(zoneId, systemId);
    const dc: any = isTFA
      ? {
          ...baseDc,
          ventilationStrategy: 'tfa-cold',
          tfaSupplyTemp: (doasForThis as any).tfaSupplyTemp,
          tfaSupplyHumidity: (doasForThis as any).tfaSupplyHumidity,
          ervSensibleEffectiveness: (doasForThis as any).ervSensibleEffectiveness,
          ervLatentEffectiveness: (doasForThis as any).ervLatentEffectiveness,
        }
      : baseDc;
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
      isGroundFloor: !!roomSource.isGroundFloor,
      slabPerimeter: Number(roomSource.slabPerimeter) || 0,
      // Omit slabFFactor when not set so it doesn't serialize as `undefined` to Firestore;
      // calculateHeatingLoad uses `?? 0.73` as the uninsulated-slab default.
      ...(Number(roomSource.slabFFactor) > 0 ? { slabFFactor: Number(roomSource.slabFFactor) } : {}),
    };

    const elements = (elementsOverride ?? envelopeElements[roomId] ?? []) as EnvelopeElement[];
    const envelope = calculateEnvelopeGain(elements, dc);
    const internal = calculateInternalGains(rd);
    const vent = calculateVentilationLoad(rd, dc);
    const tfa = isTFA ? calculateTFALoad(rd, dc) : null;
    const heating = calculateHeatingLoad(rd, elements, dc);

    const bf = 0.15;
    // OA bypass-factor model only applies when OA enters the primary coil.
    // In TFA mode, OA is conditioned by DOAS — primary sees no raw OA.
    const erVentSensible = isTFA ? 0 : vent.sensible * bf;
    const erVentLatent = isTFA ? 0 : vent.latent * bf;
    const erSensible = envelope.sensible + internal.sensible + erVentSensible;
    const erLatent = internal.latent + erVentLatent;
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
    const oaSensible = isTFA ? 0 : vent.sensible * (1 - bf);
    const oaLatent = isTFA ? 0 : vent.latent * (1 - bf);
    const oaTotal = oaSensible + oaLatent;
    // Cold-DOAS credit (engineering-correct, per locked decision 5).
    const tfaOffsetSensible = tfa ? tfa.spaceSensibleOffset : 0;
    const tfaOffsetLatent = tfa ? tfa.spaceLatentOffset : 0;
    // Phase D: tfa-only rooms contribute zero to primary; room sensible is
    // carried by the TFA supply air's reserve (1.08 × CFM × ΔT). Engine warns
    // if carrying < ersh; designer decides whether to bump CFM or supply temp.
    const isTfaOnly = isTFA && roomTfaMode === 'tfa-only';
    const tfaCarryingBTUH = tfa ? 1.08 * tfa.cfm * (dc.indoorTemp - tfa.supplyTemp) : 0;
    const tfaCarryingDeficit = isTfaOnly ? Math.max(0, ersh - tfaCarryingBTUH) : 0;
    const coilSensible = isTfaOnly ? 0 : (isTFA ? Math.max(0, ersh - tfaOffsetSensible) : ersh + oaSensible);
    const coilLatent = isTfaOnly ? 0 : (isTFA ? Math.max(0, erlh - tfaOffsetLatent) : erlh + oaLatent);
    const grandTotal = isTfaOnly ? 0 : (isTFA ? coilSensible + coilLatent : erh + oaTotal);
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
    const designSupplyCFM = Math.max(coil.minAdpSensibleCFM, totalSupplyCFM);
    // Plant TR is load-only (2026-05-20). cfmTR retained as sanity ratio.
    const cfmTR = designSupplyCFM / 400;
    const governingTR = grandTotalTR;
    const requiredTR = governingTR * (1 + overallSafetyPct / 100);

    // Monsoon snapshot — always computed so EquipmentSelection can compare seasons
    const monsoonDc: any = { ...dc, outdoorTemp: monsoonDesignTemp, outdoorHumidity: monsoonDesignHumidity };
    const monsoonEnvelope = calculateEnvelopeGain(elements, monsoonDc);
    const monsoonVent = calculateVentilationLoad(rd, monsoonDc);
    const monsoonTfa = isTFA ? calculateTFALoad(rd, monsoonDc) : null;
    const monsoonErVentSen = isTFA ? 0 : monsoonVent.sensible * bf;
    const monsoonErVentLat = isTFA ? 0 : monsoonVent.latent * bf;
    const monsoonErSensible = monsoonEnvelope.sensible + internal.sensible + monsoonErVentSen;
    const monsoonErLatent = internal.latent + monsoonErVentLat;
    const monsoonParasitic = calculateParasiticGains(monsoonErSensible, monsoonErSensible, ductPct, fanPct);
    const monsoonErshRaw = monsoonErSensible + monsoonParasitic.ductGain + monsoonParasitic.fanGain;
    const monsoonErsh = monsoonErshRaw * (1 + sensibleSafetyPct / 100);
    const monsoonErlh = monsoonErLatent * (1 + latentSafetyPct / 100);
    const monsoonOaSen = isTFA ? 0 : monsoonVent.sensible * (1 - bf);
    const monsoonOaLat = isTFA ? 0 : monsoonVent.latent * (1 - bf);
    const monsoonTfaOffsetSen = monsoonTfa ? monsoonTfa.spaceSensibleOffset : 0;
    const monsoonTfaOffsetLat = monsoonTfa ? monsoonTfa.spaceLatentOffset : 0;
    const monsoonCoilSen = isTfaOnly
      ? 0
      : (isTFA ? Math.max(0, monsoonErsh - monsoonTfaOffsetSen) : monsoonErsh + monsoonOaSen);
    const monsoonCoilLat = isTfaOnly
      ? 0
      : (isTFA ? Math.max(0, monsoonErlh - monsoonTfaOffsetLat) : monsoonErlh + monsoonOaLat);
    const monsoonGrandTotal = monsoonCoilSen + monsoonCoilLat;
    const monsoonGrandTotalTR = monsoonGrandTotal / 12000;
    const monsoonCoilParams = calculateCoilParameters(
      monsoonCoilSen, monsoonCoilLat,
      dc.indoorTemp, dc.indoorHumidity, dc.altitude || 0,
      bf, 35, 65, getMinAdp(project?.systemType),
    );
    const monsoonDesignCFM = Math.max(monsoonCoilParams.minAdpSensibleCFM, totalSupplyCFM);
    const monsoonCfmTR = monsoonDesignCFM / 400;
    const monsoonGoverningTR = monsoonGrandTotalTR;
    const monsoonRequiredTR = monsoonGoverningTR * (1 + overallSafetyPct / 100);
    const overallGoverningTR = includeMonsoon ? Math.max(governingTR, monsoonGoverningTR) : governingTR;
    const overallRequiredTR  = includeMonsoon ? Math.max(requiredTR, monsoonRequiredTR) : requiredTR;
    const overallDesignCFM   = includeMonsoon ? Math.max(designSupplyCFM, monsoonDesignCFM) : designSupplyCFM;

    const outdoorPsych = calculatePsychrometrics(dc.outdoorTemp, dc.outdoorHumidity, dc.altitude || 0);
    const indoorPsych = calculatePsychrometrics(dc.indoorTemp, dc.indoorHumidity, dc.altitude || 0);
    // Moisture analysis — pick the governing season (monsoon usually wets the coil
    // harder than summer in Indian climates). Keep per-season breakdown so the
    // PDF / room table can show both rates.
    const summerMoistureLbsHr  = Math.abs(coilLatent) / 1050;
    const monsoonMoistureLbsHr = includeMonsoon ? Math.abs(monsoonCoilLat) / 1050 : 0;
    const monsoonMoistGoverns  = includeMonsoon && monsoonMoistureLbsHr > summerMoistureLbsHr;
    const govMoistLatent       = monsoonMoistGoverns ? monsoonCoilLat : coilLatent;
    const govMoistLbsHr        = monsoonMoistGoverns ? monsoonMoistureLbsHr : summerMoistureLbsHr;
    const moisture = {
      rate: govMoistLbsHr,
      action: govMoistLatent > 0 ? 'Dehumidify' : govMoistLatent < 0 ? 'Humidify' : 'None',
      unit: 'lbs/hr',
      loadBTU: govMoistLatent,
      summerRate: parseFloat(summerMoistureLbsHr.toFixed(2)),
      monsoonRate: parseFloat(monsoonMoistureLbsHr.toFixed(2)),
      governs: monsoonMoistGoverns ? 'monsoon' : 'summer',
    };
    // Reheat sized against ROOM SHF (ersh / erlh). Using coil totals (which
    // include OA latent) inflates reheat by 10-15x for over-ventilated rooms.
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
      heating,
      psychrometrics: {
        outdoor: outdoorPsych,
        indoor: indoorPsych,
      },
      // TFA / DOAS block — null when this room isn't DOAS-served. Mirrors what
      // loadCalculationService.calculateAndPersistRoom writes for SD-saved rooms
      // so all readers (reports, exports, badges) can rely on a single shape.
      tfa: isTFA && tfa
        ? {
            strategy: 'tfa-cold' as const,
            summer: tfa,
            monsoon: monsoonTfa,
            governingCoilBTUH: Math.max(
              tfa.coilSensible + tfa.coilLatent,
              monsoonTfa ? monsoonTfa.coilSensible + monsoonTfa.coilLatent : 0,
            ),
            governs: (monsoonTfa && monsoonTfa.coilSensible + monsoonTfa.coilLatent > tfa.coilSensible + tfa.coilLatent
              ? 'monsoon'
              : 'summer') as 'summer' | 'monsoon',
          }
        : null,
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
      // Phase D: tfa-only flag + carrying capacity diagnostics. Always written
      // (true/false + numeric values) so badges + warnings don't go stale.
      _calcTfaOnly: !!isTfaOnly,
      _calcTfaCarryingBTUH: parseFloat((tfaCarryingBTUH || 0).toFixed(0)),
      _calcTfaCarryingDeficit: parseFloat((tfaCarryingDeficit || 0).toFixed(0)),
      // Winter heating BTU/h — flat field so ES, LC row badges, and PDF can read it
      // without parsing the nested analysis.heating object. Always written (even when winter
      // isn't enabled in project settings) so toggling the season doesn't require a re-save.
      // Safety factor (overallSafetyPct) is applied to mirror the cooling-side margin.
      _calcWinterHeatingBTUH: parseFloat(((heating.totalHeatingLoad || 0) * (1 + overallSafetyPct / 100)).toFixed(0)),
      // TFA / DOAS flat fields — populated only when this room's primary is DOAS-served.
      // Mirrors what loadCalculationService writes so SD's getRoomReqs stored-fallback
      // path can read them after LC persists. Use deleteField so toggling DOAS off
      // doesn't leave stale TR numbers behind.
      _calcTfaCoilBTUH: isTFA && tfa
        ? parseFloat((tfa.coilSensible + tfa.coilLatent).toFixed(0))
        : deleteField(),
      _calcTfaCoilTR: isTFA && tfa
        ? parseFloat(((tfa.coilSensible + tfa.coilLatent) / 12000).toFixed(3))
        : deleteField(),
      _calcTfaCfm: isTFA && tfa ? parseFloat(tfa.cfm.toFixed(0)) : deleteField(),
      _calcMonsoonTfaCoilBTUH: isTFA && monsoonTfa
        ? parseFloat((monsoonTfa.coilSensible + monsoonTfa.coilLatent).toFixed(0))
        : deleteField(),
      _calcMonsoonTfaCoilTR: isTFA && monsoonTfa
        ? parseFloat(((monsoonTfa.coilSensible + monsoonTfa.coilLatent) / 12000).toFixed(3))
        : deleteField(),
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
              _calcWinterHeatingBTUH: parseFloat(((heating.totalHeatingLoad || 0) * (1 + overallSafetyPct / 100)).toFixed(0)),
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
    } catch (error) {
      console.error('[LoadCalculator] Failed to persist room analysis snapshot:', { roomId, error });
      toast.error('Failed to save room analysis: ' + (error instanceof Error ? error.message : 'Unknown error'));
      setRoomSaveStates(prev => ({ ...prev, [roomId]: 'idle' }));
    }
  };

  // ── Project-level totals (computed from all rooms) ───────────────────────────
  const projectTotals = useMemo(() => {
    const BF_LOCAL = 0.15;
    let totalHeating = 0;
    let totalArea = 0;
    let summerCooling = 0;
    let summerDesignCfm = 0;
    let summerCoilDehumCfm = 0;
    let monsoonCooling = 0;
    let monsoonDesignCfm = 0;
    let monsoonCoilDehumCfm = 0;
    // Phase D aggregations — TFA-side numbers split out from plant totals.
    let tfaCoilBTUH = 0;          // Σ TFA-served room OA conditioning (summer)
    let tfaMonsoonCoilBTUH = 0;   // Σ TFA-served room OA conditioning (monsoon)
    let tfaTotalCFM = 0;          // Σ TFA CFM across all TFA-served + tfa-only rooms
    let tfaServedRoomCount = 0;
    let tfaOnlyRoomCount = 0;
    let tfaOnlyRoomLoadBTUH = 0;  // Σ room sensible+latent on tfa-only rooms (for reference)
    let tfaCarryingDeficitTotal = 0;
    const tfaUndersizedRoomIds: string[] = [];

    // ── Build (systemId|zoneId) → DOAS lookup (one DOAS can serve many primaries) ──
    // Project totals must apply the same TFA branch as persistRoomAnalysisSnapshot
    // and EquipmentSelection.computeRoomReqs — otherwise the Project-Level Summary
    // shows pre-DOAS numbers even after rooms are persisted in TFA mode.
    // Includes both legacy system-links and Phase B+ zone-links.
    const doasForPrimary = new Map<string, any>();
    for (const s of equipSystems as any[]) {
      if (s?.type === 'DOAS') {
        for (const pid of ((s.doasLinkedSystemIds ?? []) as string[])) doasForPrimary.set(pid, s);
        for (const zid of ((s.doasLinkedZoneIds ?? []) as string[])) doasForPrimary.set(zid, s);
      }
    }

    const calculateCoolingSnapshot = (room: any, elements: EnvelopeElement[], zoneDc: typeof defaultDesignConditions, doas: any | null, zoneDefaultMode?: string) => {
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

      // TFA-aware design conditions — when DOAS-served, attach strategy + supply
      // params so vent / TFA load functions use the same branch as the persist path.
      const isTFA = !!doas;
      const dcEff: any = isTFA
        ? {
            ...zoneDc,
            ventilationStrategy: 'tfa-cold',
            tfaSupplyTemp: doas.tfaSupplyTemp,
            tfaSupplyHumidity: doas.tfaSupplyHumidity,
            ervSensibleEffectiveness: doas.ervSensibleEffectiveness,
            ervLatentEffectiveness: doas.ervLatentEffectiveness,
          }
        : zoneDc;

      const envelope = calculateEnvelopeGain(elements, dcEff);
      const internal = calculateInternalGains(rd);
      const vent = calculateVentilationLoad(rd, dcEff);
      const tfa = isTFA ? calculateTFALoad(rd, dcEff) : null;
      // Phase D: tfa-only rooms route ALL load through TFA supply carrying.
      // Phase E: respect zone.tfaDefaultMode when room.tfaMode is 'inherit'/unset.
      const rawRoomModeSnap = (room as any)?.tfaMode as string | undefined;
      const zoneDefaultSnap = zoneDefaultMode;
      const effectiveModeSnap: 'no-tfa' | 'tfa-served' | 'tfa-only' = !isTFA
        ? 'no-tfa'
        : (rawRoomModeSnap === 'no-tfa' || rawRoomModeSnap === 'tfa-served' || rawRoomModeSnap === 'tfa-only')
          ? rawRoomModeSnap
          : (zoneDefaultSnap === 'tfa-only' || zoneDefaultSnap === 'tfa-served')
            ? zoneDefaultSnap
            : 'tfa-served';
      const isTfaOnly = effectiveModeSnap === 'tfa-only';

      // Bypass-OA terms zero out when TFA is active — OA goes to the DOAS unit.
      const erVentSensible = isTFA ? 0 : vent.sensible * BF_LOCAL;
      const erVentLatent = isTFA ? 0 : vent.latent * BF_LOCAL;
      const erSensible = envelope.sensible + internal.sensible + erVentSensible;
      const erLatent = internal.latent + erVentLatent;
      const ductPct = Number(room.ductGainPct) || 2;
      const fanPct = Number(room.fanGainPct) || 3;
      const sensibleSafetyPct = Number(room.sensibleSafetyPercent ?? room.sensibleSafetyFactor ?? 10);
      const latentSafetyPct = Number(room.latentSafetyPercent ?? room.latentSafetyFactor ?? 5);
      const overallSafetyPct = Number(room.overallSafetyPercent ?? room.grandTotalSafetyFactor ?? 3);
      const parasitic = calculateParasiticGains(erSensible, erSensible, ductPct, fanPct);

      const ersh = (erSensible + parasitic.ductGain + parasitic.fanGain) * (1 + sensibleSafetyPct / 100);
      const erlh = erLatent * (1 + latentSafetyPct / 100);
      const oaSensible = isTFA ? 0 : vent.sensible * (1 - BF_LOCAL);
      const oaLatent = isTFA ? 0 : vent.latent * (1 - BF_LOCAL);
      const tfaOffSen = tfa ? tfa.spaceSensibleOffset : 0;
      const tfaOffLat = tfa ? tfa.spaceLatentOffset : 0;
      const coilSensible = isTfaOnly ? 0 : (isTFA ? Math.max(0, ersh - tfaOffSen) : ersh + oaSensible);
      const coilLatent = isTfaOnly ? 0 : (isTFA ? Math.max(0, erlh - tfaOffLat) : erlh + oaLatent);
      const grandTotal = coilSensible + coilLatent;

      const coilLocal = calculateCoilParameters(
        coilSensible,
        coilLatent,
        dcEff.indoorTemp,
        dcEff.indoorHumidity,
        dcEff.altitude || 0,
        BF_LOCAL,
        35,
        65,
        getMinAdp(project?.systemType),
      );
      const presetTotalACH = getRecommendedAch(room.achProfile ?? room.activityType);
      const totalSupplyACH = Math.max(presetTotalACH, rd.facph);
      const totalSupplyCFM = (calculateRoomVolume(rd) * totalSupplyACH) / 60;
      const designSupplyCFM = Math.max(coilLocal.minAdpSensibleCFM, totalSupplyCFM);

      // Phase D: carrying capacity used by tfa-only rooms (and reported for
      // all TFA-served rooms as a sanity check). Deficit > 0 = undersized.
      const tfaCarryingBTUH = tfa ? 1.08 * tfa.cfm * (dcEff.indoorTemp - tfa.supplyTemp) : 0;
      const tfaCarryingDeficit = isTfaOnly ? Math.max(0, ersh - tfaCarryingBTUH) : 0;
      return {
        grandTotal,
        designSupplyCFM,
        coilDehumCFM: designSupplyCFM,
        heating: calculateHeatingLoad(rd, elements, dcEff),
        area: rd.length * rd.width,
        // Per-room TFA coil load — aggregated by the caller into project TFA totals.
        tfaCoilBTUH: tfa ? tfa.coilSensible + tfa.coilLatent : 0,
        tfaCfm: tfa ? tfa.cfm : 0,
        isTfaOnly,
        tfaCarryingBTUH,
        tfaCarryingDeficit,
        // tfa-only rooms remove their full envelope+internal load via TFA carrying;
        // the caller uses this to size the TFA aggregate vs the chiller plant.
        tfaOnlyRoomLoad: isTfaOnly ? (ersh + erlh) : 0,
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

      const zoneDefaultModeForLoop = (zoneRecord as any)?.tfaDefaultMode as string | undefined;
      for (const room of (zoneRooms as any[])) {
        const elements = (liveEnvelopeElements[room.id] || []) as EnvelopeElement[];
        // Phase C: room.tfaMode='no-tfa' opts out of TFA even if zone is linked.
        const candidate = doasForPrimary.get(room.systemId) ?? doasForPrimary.get(room.zoneId) ?? null;
        const doas = (room as any)?.tfaMode === 'no-tfa' ? null : candidate;
        const summerSnapshot = calculateCoolingSnapshot(room, elements, zoneSummerDc, doas, zoneDefaultModeForLoop);
        const heatingSnapshot = calculateCoolingSnapshot(room, elements, zoneHeatingDc, doas, zoneDefaultModeForLoop);

        summerCooling += summerSnapshot.grandTotal;
        summerDesignCfm += summerSnapshot.designSupplyCFM;
        summerCoilDehumCfm += summerSnapshot.coilDehumCFM;
        {
          const heatingSF = Number(room.overallSafetyPercent ?? room.grandTotalSafetyFactor ?? 3);
          totalHeating += heatingSnapshot.heating.totalHeatingLoad * (1 + heatingSF / 100);
        }
        totalArea += summerSnapshot.area;
        // Phase D — split TFA-side numbers out.
        if (doas) {
          tfaCoilBTUH += summerSnapshot.tfaCoilBTUH;
          tfaTotalCFM += summerSnapshot.tfaCfm;
          if (summerSnapshot.isTfaOnly) {
            tfaOnlyRoomCount += 1;
            tfaOnlyRoomLoadBTUH += summerSnapshot.tfaOnlyRoomLoad;
            tfaCarryingDeficitTotal += summerSnapshot.tfaCarryingDeficit;
            if (summerSnapshot.tfaCarryingDeficit > 0) tfaUndersizedRoomIds.push(room.id);
          } else {
            tfaServedRoomCount += 1;
          }
        }

        if (includeMonsoon) {
          const monsoonSnapshot = calculateCoolingSnapshot(room, elements, zoneMonsoonDc, doas, zoneDefaultModeForLoop);
          monsoonCooling += monsoonSnapshot.grandTotal;
          monsoonDesignCfm += monsoonSnapshot.designSupplyCFM;
          monsoonCoilDehumCfm += monsoonSnapshot.coilDehumCFM;
          if (doas) tfaMonsoonCoilBTUH += monsoonSnapshot.tfaCoilBTUH;
        }
      }
    }

    const roomCount = Object.values(liveRooms).reduce((sum, r) => sum + (r as any[]).length, 0);
    const monsoonTR = monsoonCooling / 12000;
    const summerTR = summerCooling / 12000;
    // cfmTR is a SANITY RATIO only — kept for display/warning. It does NOT
    // govern plant sizing. (Engine decision: 2026-05-20.)
    const summerCfmTR = summerCoilDehumCfm > 0 ? summerCoilDehumCfm / 400 : 0;
    const monsoonCfmTR = monsoonCoilDehumCfm > 0 ? monsoonCoilDehumCfm / 400 : 0;
    const summerGoverningTR = summerTR;
    const monsoonGoverningTR = monsoonTR;
    const governingLoadSeason = includeMonsoon && monsoonTR > summerTR ? 'Monsoon' : 'Summer';
    const governingAirflowSeason = includeMonsoon && monsoonCfmTR > summerCfmTR ? 'Monsoon' : 'Summer';
    const governingLoadTR = includeMonsoon ? Math.max(summerTR, monsoonTR) : summerTR;
    const governingCfmTR = includeMonsoon ? Math.max(summerCfmTR, monsoonCfmTR) : summerCfmTR;
    const totalTR = governingLoadTR;
    const peakSeason = governingLoadSeason;
    const totalCooling = governingLoadSeason === 'Monsoon' ? monsoonCooling : summerCooling;
    const totalDesignCfm = includeMonsoon ? Math.max(summerDesignCfm, monsoonDesignCfm) : summerDesignCfm;
    // CFM/TR ratio for sanity warning (typical 350-450 CFM/TR for comfort cooling).
    const cfmPerTRRatio = totalTR > 0 ? totalDesignCfm / totalTR : 0;
    const cfmRatioOutOfRange = cfmPerTRRatio > 0 && (cfmPerTRRatio < 350 || cfmPerTRRatio > 450);

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
      cfmPerTRRatio,
      cfmRatioOutOfRange,
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
      // Phase D — TFA-side split numbers.
      tfa: {
        coilBTUHSummer: tfaCoilBTUH,
        coilBTUHMonsoon: tfaMonsoonCoilBTUH,
        coilTR: Math.max(tfaCoilBTUH, tfaMonsoonCoilBTUH) / 12000,
        totalCFM: tfaTotalCFM,
        servedRoomCount: tfaServedRoomCount,
        onlyRoomCount: tfaOnlyRoomCount,
        onlyRoomLoadBTUH: tfaOnlyRoomLoadBTUH,
        carryingDeficitTotal: tfaCarryingDeficitTotal,
        undersizedRoomIds: tfaUndersizedRoomIds,
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
    equipSystems,
  ]);

  // ── DOAS / TFA staleness detection ──────────────────────────────────────
  // A room is "stale" when its persisted _calcTfa* fields disagree with the
  // current DOAS configuration in equipSystems. Two cases:
  //   1. Room's primary is now DOAS-served but room has no _calcTfaCoilBTUH
  //      → loads still include OA, primary is oversized.
  //   2. Room's primary is no longer DOAS-served but room still has _calcTfaCoilBTUH
  //      → loads have an obsolete TFA credit, primary is undersized.
  // The banner in the project summary surfaces a single "Recalculate" action.
  const tfaStaleRoomIds = useMemo(() => {
    const stale: string[] = [];
    const doasSystems = equipSystems.filter((s: any) => s?.type === 'DOAS');
    if (doasSystems.length === 0) return stale;
    // Union of system-links and Phase B+ zone-links.
    const doasLinkedSet = new Set<string>();
    for (const d of doasSystems) {
      for (const id of (d.doasLinkedSystemIds ?? []) as string[]) doasLinkedSet.add(id);
      for (const id of (d.doasLinkedZoneIds ?? []) as string[]) doasLinkedSet.add(id);
    }
    for (const zoneRooms of Object.values(rooms)) {
      for (const r of zoneRooms as any[]) {
        const sysId = r.systemId as string | undefined;
        const zoneId = r.zoneId as string | undefined;
        const shouldBeTFA = (!!sysId && doasLinkedSet.has(sysId)) || (!!zoneId && doasLinkedSet.has(zoneId));
        const hasTFAFields = Number(r._calcTfaCoilBTUH) > 0;
        if (shouldBeTFA !== hasTFAFields) stale.push(r.id);
      }
    }
    return stale;
  }, [equipSystems, rooms]);

  const recalcAllRooms = useCallback(async () => {
    const ids = tfaStaleRoomIds;
    if (ids.length === 0) return;
    toast.info(`Recalculating ${ids.length} room${ids.length === 1 ? '' : 's'}…`);
    let ok = 0;
    for (const zoneId of Object.keys(rooms)) {
      const zoneRooms = rooms[zoneId] ?? [];
      for (const r of zoneRooms as any[]) {
        if (!ids.includes(r.id)) continue;
        try {
          await persistRoomAnalysisSnapshot(zoneId, r.id, r.systemId ?? zoneId, r, envelopeElements[r.id] ?? []);
          ok += 1;
        } catch (err) {
          console.error('[LC] TFA recalc failed for room', r.id, err);
        }
      }
    }
    toast.success(`Recalculated ${ok} room${ok === 1 ? '' : 's'} in TFA mode`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tfaStaleRoomIds, rooms, envelopeElements]);

  // ── CFM-governance staleness detection ─────────────────────────────────
  // Engine change 2026-05-20: cfmTR no longer inflates _calcRequiredTR.
  // Any room with persisted _calcCfmTR > _calcLoadTR was sized under the OLD
  // governance and its _calcRequiredTR is now too high. Recalc rewrites it.
  const cfmGovernanceStaleRoomIds = useMemo(() => {
    const stale: string[] = [];
    for (const zoneRooms of Object.values(rooms)) {
      for (const r of zoneRooms as any[]) {
        const loadTR = Number(r._calcLoadTR) || 0;
        const cfmTR = Number(r._calcCfmTR) || 0;
        if (loadTR > 0 && cfmTR > loadTR + 0.01) stale.push(r.id);
      }
    }
    return stale;
  }, [rooms]);

  const recalcCfmGovernanceRooms = useCallback(async () => {
    const ids = cfmGovernanceStaleRoomIds;
    if (ids.length === 0) return;
    toast.info(`Recalculating ${ids.length} room${ids.length === 1 ? '' : 's'} under load-only governance…`);
    let ok = 0;
    for (const zoneId of Object.keys(rooms)) {
      const zoneRooms = rooms[zoneId] ?? [];
      for (const r of zoneRooms as any[]) {
        if (!ids.includes(r.id)) continue;
        try {
          await persistRoomAnalysisSnapshot(zoneId, r.id, r.systemId ?? zoneId, r, envelopeElements[r.id] ?? []);
          ok += 1;
        } catch (err) {
          console.error('[LC] CFM-governance recalc failed for room', r.id, err);
        }
      }
    }
    toast.success(`Recalculated ${ok} room${ok === 1 ? '' : 's'} — plant TR now load-only`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfmGovernanceStaleRoomIds, rooms, envelopeElements]);

  // Firestore zone + system documents — authoritative for names, design-condition overrides, and empty zones.
  // /zones    — LC zones created by the user
  // /systems  — legacy VRF systems (backward compat)
  // /equipmentSystems — SD equipment systems; rooms assigned in SD get zoneId = equipSystem.id
  // Priority: /zones > /systems > /equipmentSystems (highest precision first)
  const fsZoneDocsRef = useRef<Zone[]>([]);         // /zones
  const fsSystemDocsRef = useRef<Zone[]>([]);        // /systems (legacy VRF)
  const fsEquipSystemDocsRef = useRef<Zone[]>([]);   // /equipmentSystems (SD)
  const fsZonesRef = useRef<Zone[]>([]);
  const liveAllRoomsRef = useRef<Record<string, Room[]>>({}); // updated by rooms listener
  const rebuildFsZonesRef = useRef(() => {
    const zoneIds = new Set(fsZoneDocsRef.current.map(z => z.id));
    const sysIds  = new Set([...zoneIds, ...fsSystemDocsRef.current.map(s => s.id)]);
    const liveRooms = liveAllRoomsRef.current;
    // ES system ids referenced by any live room (direct via zoneId or via systemId).
    const esIdsWithRooms = new Set<string>();
    for (const rs of Object.values(liveRooms)) {
      for (const r of rs as any[]) {
        if (r.systemId) esIdsWithRooms.add(r.systemId);
      }
    }
    // Sub-zone name lookup from ES system docs so we can re-name legacy room-derived zones
    // (where room.zoneName === systemName) to their canonical sub-zone name.
    const esSubZoneNameById: Record<string, string> = {};
    for (const es of fsEquipSystemDocsRef.current as any[]) {
      for (const z of (es.zones ?? []) as any[]) {
        if (z?.id && z?.name) esSubZoneNameById[z.id] = z.name;
      }
    }
    // Surface every ES sub-zone (system.zones[]) as a zone in LC's tree — including ones
    // that don't yet have any rooms. Without this, "+ Add Zone" creates an ES sub-zone
    // but LC wouldn't render it until the first room is added.
    const esSubZonesAsZones = (fsEquipSystemDocsRef.current as any[]).flatMap((es: any) =>
      ((es.zones ?? []) as any[])
        .filter((z: any) => z?.id)
        .map((z: any) => ({ id: z.id, name: z.name ?? 'Zone', systemId: es.id })),
    );

    fsZonesRef.current = [
      ...fsZoneDocsRef.current,
      ...fsSystemDocsRef.current.filter(s => !zoneIds.has(s.id)),
      // SD equipment systems become parent rows in LC; sub-zones attach via zone.systemId === system.id.
      // Stamp `description` so the ZoneList `isSystem` check (zone.description !== undefined) recognises them.
      ...fsEquipSystemDocsRef.current
        .filter(es => !sysIds.has(es.id) && esIdsWithRooms.has(es.id))
        .map((es: any) => ({
          ...es,
          description: es.description ?? (es.type ? `${es.type} System` : 'Equipment System'),
        })),
      // Empty / non-empty ES sub-zones (deduped against /zones and /systems by id)
      ...esSubZonesAsZones.filter((z: any) => !zoneIds.has(z.id) && !sysIds.has(z.id)),
    ];
    // Rewrite previous room-derived zone NAMES from ES sub-zones so late-loading ES doc fixes stale labels.
    setZones(prev => {
      // CRITICAL: mergeZones preserves prev entries not in fsZones, but that path
      // keeps phantom rows alive forever (e.g. a zone that was in es.zones[] yesterday
      // but cleanup removed today). Filter prev to entries that have CURRENT backing:
      // either appear in fsZonesRef.current, or have live rooms referencing them.
      const fsIds = new Set(fsZonesRef.current.map(z => z.id));
      const liveRooms = liveAllRoomsRef.current;
      const kept = prev.filter(z => fsIds.has(z.id) || (liveRooms[z.id]?.length ?? 0) > 0);
      const renamed = kept.map(z =>
        esSubZoneNameById[z.id] ? { ...z, name: esSubZoneNameById[z.id] } : z,
      );
      return mergeZones(fsZonesRef.current, renamed);
    });
  });
  useEffect(() => {
    if (!project.id || !userProfile) return;
    // Reset stale FS-document refs / state from any previous project before subscribing.
    // Otherwise Igloo Test loads with R&R Resort's ES systems still in memory until
    // the new snapshots arrive — duplicates and orphan zones flash on screen.
    fsZoneDocsRef.current = [];
    fsSystemDocsRef.current = [];
    fsEquipSystemDocsRef.current = [];
    fsZonesRef.current = [];
    setEquipSystems([]);
    setSystems([]);
    setZones([]);

    const unsubZones = onSnapshot(
      collection(db, 'projects', project.id, 'zones'),
      (snap) => {
        fsZoneDocsRef.current = snap.docs.map(d => ({ id: d.id, ...d.data() } as Zone));
        rebuildFsZonesRef.current();
      },
    );
    const unsubSystems = onSnapshot(
      collection(db, 'projects', project.id, 'systems'),
      (snap) => {
        fsSystemDocsRef.current = snap.docs.map(d => ({ id: d.id, ...d.data() } as Zone));
        // Also mirror to React state so addSystem / deleteSystem can read it.
        setSystems(snap.docs.map(d => ({ id: d.id, ...d.data() } as HVACSystem)));
        rebuildFsZonesRef.current();
      },
    );
    const unsubEquipSystems = onSnapshot(
      collection(db, 'projects', project.id, 'equipmentSystems'),
      (snap) => {
        const raw = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        // Apply the same dedup that EquipmentSelection uses, so LC sees one entry per
        // (type, name) combination. Without this, legacy duplicate ES system docs (created
        // before today's flow) leak through and render as phantom rows in LC.
        // 1) dedup by id (no-op for unique ids)
        const seenIds = new Set<string>();
        const idDeduped = raw.filter(s => {
          if (seenIds.has(s.id)) return false;
          seenIds.add(s.id);
          return true;
        });
        // 2) dedup by (type, name) — keep most recently updated
        const nameKey = (s: any) => `${String(s.type || '')}|${String(s.name || s.id).toLowerCase().trim()}`;
        const nameMap = new Map<string, any[]>();
        idDeduped.forEach(s => {
          const k = nameKey(s);
          if (!nameMap.has(k)) nameMap.set(k, []);
          nameMap.get(k)!.push(s);
        });
        const docs = Array.from(nameMap.values()).map(group => {
          if (group.length === 1) return group[0];
          return group.reduce((best, s) => {
            const tBest = (best as any).updatedAt?.seconds ?? 0;
            const tS    = (s as any).updatedAt?.seconds    ?? 0;
            return tS > tBest ? s : best;
          }, group[0]);
        });
        fsEquipSystemDocsRef.current = docs as Zone[];
        setEquipSystems(docs);
        rebuildFsZonesRef.current();
      },
    );
    return () => { unsubZones(); unsubSystems(); unsubEquipSystems(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, userProfile]);

  // Live room listener — re-groups zones instantly when room.zoneId changes
  useEffect(() => {
    if (!project.id || !userProfile) return;
    analysisBackfillDoneRef.current.clear();
    oaFacphMigrationDoneRef.current.clear();
    loadedEnvelopeRoomsRef.current.clear();
    // Zone-rename migration cache must reset per project — otherwise an old project's
    // (sys.id, subZone.id, room.id) tuples could shadow new-project work.
    zoneRenameMigrationDoneRef.current.clear();
    zoneRenameMigrationRunningRef.current = false;
    // Clear stale per-room state. The listener will repopulate from the new project.
    liveAllRoomsRef.current = {};
    setRooms({});
    setEnvelopeElements({});
    setDataLoading(true);

    const unsub = onSnapshot(
      collection(db, 'projects', project.id, 'rooms'),
      async (snap) => {
        const rList = snap.docs.map(d => normalizeRoom({ id: d.id, ...d.data() }));

        // Build a lookup so legacy rooms (zoneName === systemName) get re-named from the
        // authoritative sub-zone label stored in the ES system doc (system.zones[]).
        const esSubZoneNameById: Record<string, string> = {};
        // Map of system id → system type (used to detect Split/DOAS, which don't use sub-zones).
        const esSystemTypeById: Record<string, string> = {};
        for (const es of fsEquipSystemDocsRef.current as any[]) {
          if (es?.id && es?.type) esSystemTypeById[es.id] = es.type;
          for (const z of (es.zones ?? []) as any[]) {
            if (z?.id && z?.name) esSubZoneNameById[z.id] = z.name;
          }
        }

        const allRooms: Record<string, Room[]> = {};
        const zoneMap: Record<string, { id: string; name: string; systemId?: string }> = {};
        for (const room of rList) {
          const rSystemId = (room as any).systemId as string | undefined;
          const sysType = rSystemId ? esSystemTypeById[rSystemId] : undefined;
          // Split & DOAS: collapse zone layer — group all rooms under the system id directly,
          // so the LC system card lists rooms flat (no Zone 1/Zone 2 intermediate row).
          const isFlatSystem = sysType === 'Split' || sysType === 'DOAS';
          const key = isFlatSystem && rSystemId
            ? rSystemId
            : ((room as any).zoneId ?? 'default');
          const subZoneName = esSubZoneNameById[key];
          const zName = subZoneName ?? (room as any).zoneName ?? 'Zone';
          if (!allRooms[key]) allRooms[key] = [];
          allRooms[key].push(room);
          if (!zoneMap[key]) {
            zoneMap[key] = { id: key, name: zName, ...(rSystemId ? { systemId: rSystemId } : {}) };
          }
        }

        // Apply cached envelope elements synchronously (no network) so anything
        // already in memory is available immediately.
        const cachedNow: Record<string, EnvelopeElement[]> = {};
        const networkFetchIds: string[] = [];
        for (const r of rList) {
          if (loadedEnvelopeRoomsRef.current.has(r.id)) continue;
          const cached = envelopeCache.get(project.id, r.id);
          if (cached) {
            cachedNow[r.id] = cached;
            loadedEnvelopeRoomsRef.current.add(r.id);
          } else {
            networkFetchIds.push(r.id);
          }
        }
        if (Object.keys(cachedNow).length > 0) {
          setEnvelopeElements(prev => ({ ...prev, ...cachedNow }));
        }

        // Fetch missing envelope subcollections IN PARALLEL in the background.
        // The structure UI doesn't need envelope data to render — only per-room
        // detail does — so we drop the spinner first and let envelopes stream in.
        if (networkFetchIds.length > 0) {
          networkFetchIds.forEach(id => loadedEnvelopeRoomsRef.current.add(id));
          void Promise.all(
            networkFetchIds.map(async (roomId) => {
              try {
                const elSnap = await getDocs(collection(db, 'projects', project.id, 'rooms', roomId, 'envelopeElements'));
                const elements = elSnap.docs.map(d => ({ id: d.id, ...d.data() })) as EnvelopeElement[];
                envelopeCache.set(project.id, roomId, elements);
                return [roomId, elements] as const;
              } catch (err) {
                console.error(`[LoadCalculator] envelope load failed for room ${roomId}:`, err);
                return [roomId, [] as EnvelopeElement[]] as const;
              }
            }),
          ).then((results) => {
            const merged: Record<string, EnvelopeElement[]> = {};
            for (const [id, els] of results) merged[id] = els;
            setEnvelopeElements(prev => ({ ...prev, ...merged }));
          });
        }

        // Keep the live-rooms ref in sync so rebuildFsZonesRef can use actual room data.
        liveAllRoomsRef.current = allRooms;

        // ES systems referenced by any live room (directly via zoneId, or via systemId on sub-zoned rooms).
        // These become parent rows in LC. Stamped with `description` so ZoneList.isSystemRow detects them.
        const esIdsReferenced = new Set<string>();
        for (const r of rList) {
          const sid = (r as any).systemId;
          if (sid) esIdsReferenced.add(sid);
        }
        const esSystemsAsZones: Zone[] = (fsEquipSystemDocsRef.current as any[])
          .filter(es => esIdsReferenced.has(es.id))
          .map(es => ({
            ...es,
            description: es.description ?? (es.type ? `${es.type} System` : 'Equipment System'),
          })) as Zone[];

        // Merge room-derived zones with Firestore zone documents so that:
        // 1. Empty zones (no rooms yet) are preserved from Firestore
        // 2. Zone names / design-condition overrides from Firestore take precedence
        // ES systems are sourced exclusively from esSystemsAsZones (above) to avoid duplicates.
        // Sub-zones whose systemId points to a system not in current ES collection are orphans
        // (e.g. cached sub-zones from a deleted system); drop them so phantom rows can't survive.
        const equipSystemIds = new Set(fsEquipSystemDocsRef.current.map(es => es.id));
        const filteredFsZones = fsZonesRef.current.filter(z =>
          !equipSystemIds.has(z.id) &&
          (!(z as any).systemId || equipSystemIds.has((z as any).systemId)),
        );
        const roomDerivedZones = Object.values(zoneMap) as Zone[];
        // Order matters: put ES systems first (as FS zones) so they render as parent rows,
        // then sub-zones merged in from rooms.
        const mergedZones = mergeZones([...esSystemsAsZones, ...filteredFsZones], roomDerivedZones);
        setZones(mergedZones);
        setRooms(allRooms);
        setDataLoading(false);
      },
      (error) => {
        console.error('[LoadCalculator] Failed to load project data:', error);
        toast.error('Failed to load project data');
        setDataLoading(false);
      },
    );

    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, userProfile]);

  // Reset auto-expand flag whenever the project changes
  useEffect(() => {
    hasAutoExpandedZoneRef.current = false;
  }, [project.id]);

  // Auto-expand the first zone once data has loaded
  useEffect(() => {
    if (dataLoading) return;
    if (hasAutoExpandedZoneRef.current) return;
    if (zones.length > 0) {
      setExpandedZone(zones[0].id);
      hasAutoExpandedZoneRef.current = true;
    }
  }, [dataLoading, zones.length]);

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

  // One-time per-session migration: rewrite legacy room.zoneId / zoneName / systemId / systemName
  // to the canonical values from the ES system docs (system.zones[].roomIds[]).
  // Idempotent — only touches fields that are out of sync, never deletes or touches envelope/calc data.
  // The user's pre-existing room geometry, envelope elements, and load results are preserved.
  // (refs declared near the top so listeners can clear them on project switch)
  useEffect(() => {
    if (dataLoading) return;
    if (zoneRenameMigrationRunningRef.current) return;
    if (!project?.id) return;
    if (!equipSystems || equipSystems.length === 0) return;

    const run = async () => {
      zoneRenameMigrationRunningRef.current = true;
      try {
        // Flatten room state into a roomId -> room lookup
        const roomById = new Map<string, any>();
        for (const rs of Object.values(rooms)) {
          for (const r of rs as any[]) roomById.set(r.id, r);
        }

        let batch = writeBatch(db);
        let opCount = 0;
        let totalUpdated = 0;

        for (const sys of equipSystems as any[]) {
          const subZones = (sys.zones ?? []) as any[];
          for (const subZone of subZones) {
            if (!subZone?.id || !subZone?.name) continue;
            for (const roomId of (subZone.roomIds ?? []) as string[]) {
              const key = `${sys.id}:${subZone.id}:${roomId}`;
              if (zoneRenameMigrationDoneRef.current.has(key)) continue;

              const r = roomById.get(roomId);
              if (!r) { zoneRenameMigrationDoneRef.current.add(key); continue; }

              // Stale-roomIds guard: if the room is currently assigned to a DIFFERENT system,
              // this system's zones[].roomIds[] is stale (an old reference that wasn't cleaned
              // up). Don't claim the room back — let the Cleanup tool handle the orphan ref.
              // Without this guard, two systems each listing the same room id will ping-pong
              // forever, firing the migration toast on every snapshot.
              if (r.systemId && r.systemId !== sys.id) {
                zoneRenameMigrationDoneRef.current.add(key);
                continue;
              }

              const needsUpdate =
                r.zoneId       !== subZone.id   ||
                r.zoneName     !== subZone.name ||
                r.systemId     !== sys.id       ||
                r.systemName   !== (sys.name ?? null);
              if (!needsUpdate) { zoneRenameMigrationDoneRef.current.add(key); continue; }

              batch.update(doc(db, 'projects', project.id, 'rooms', roomId), {
                zoneId:        subZone.id,
                zoneName:      subZone.name,
                systemId:      sys.id,
                systemName:    sys.name ?? null,
                hvacZoneId:    subZone.id,
                hvacZoneName:  subZone.name,
                hvacSystemId:  sys.id,
                hvacSystemName: sys.name ?? null,
                ahuGroupId:    subZone.id,
                ahuGroupName:  subZone.name,
                updatedAt:     serverTimestamp(),
              });
              opCount++;
              totalUpdated++;
              zoneRenameMigrationDoneRef.current.add(key);

              // Firestore caps batches at 500 ops; commit and start a fresh batch at 400.
              if (opCount >= 400) {
                await batch.commit();
                batch = writeBatch(db);
                opCount = 0;
              }
            }
          }
        }

        if (opCount > 0) await batch.commit();
        if (totalUpdated > 0) {
          toast.success(`Normalized ${totalUpdated} room${totalUpdated === 1 ? '' : 's'} — zone labels now match Equipment Selection`);
        }
      } catch (error) {
        console.error('[LoadCalculator] Failed zone-rename migration:', error);
      } finally {
        zoneRenameMigrationRunningRef.current = false;
      }
    };

    void run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoading, equipSystems]);

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

  // ── Global Room Defaults (bulk-apply common inputs to every room) ──────────
  // Engineer ticks the fields they want to push, picks the values, clicks Apply.
  // We only write the ticked fields, so unticked properties on each room stay intact.
  // Manual edits made after Apply are preserved until the engineer clicks Apply again.
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [globalDefaults, setGlobalDefaults] = useState({
    applyFalseCeiling: false,
    hasFalseCeiling:   false,
    falseCeilingHeight: 10,
    applyActivity:     false,
    activityType:      'office',
    applyAch:          false,
    achProfile:        'office',
    applyLights:       false,
    lightsWattsPerSqft: 1.2,
    applyFacph:        false,
    facph:             0.5,
  });

  const totalRoomCount = useMemo(
    () => Object.values(rooms).reduce((s, list) => s + (list?.length ?? 0), 0),
    [rooms],
  );

  const applyGlobalDefaults = async () => {
    if (totalRoomCount === 0) {
      toast.error('No rooms to update');
      return;
    }
    const g = globalDefaults;
    const fields: Record<string, any> = {};
    if (g.applyFalseCeiling) {
      fields.hasFalseCeiling = !!g.hasFalseCeiling;
      fields.falseCeilingHeight = Math.max(0, Number(g.falseCeilingHeight) || 0);
    }
    if (g.applyActivity) fields.activityType = g.activityType;
    if (g.applyAch)      fields.achProfile   = g.achProfile;
    if (g.applyLights)   fields.lightsWattsPerSqft = Math.max(0, Number(g.lightsWattsPerSqft) || 0);
    if (g.applyFacph) {
      // OA fresh-air ACH must be ≤ total supply ACH — outside air is part of the supply,
      // not added on top of it. If ACH Preset is also being applied, validate against the
      // new preset; otherwise validate against the currently-selected preset as a guard rail.
      const achId = g.applyAch ? g.achProfile : g.achProfile;
      const maxAch = Number(ACTIVITY_ACH_RECOMMENDATIONS.find(a => a.id === achId)?.ach) || 0;
      if (maxAch > 0 && g.facph > maxAch) {
        toast.error(`OA FACPH (${g.facph}) cannot exceed ACH Preset (${maxAch})`);
        return;
      }
      fields.facph = Math.max(0, Number(g.facph) || 0);
    }

    if (Object.keys(fields).length === 0) {
      toast.error('Tick at least one field to apply');
      return;
    }

    try {
      // Firestore batch limit is 500 ops. We're nowhere near that for typical projects
      // (~12 rooms) but split into batches of 400 to stay safe on large projects.
      const allRooms: Array<{ id: string; zoneId: string }> = [];
      for (const [zoneId, list] of Object.entries(rooms)) {
        for (const r of list || []) allRooms.push({ id: r.id, zoneId });
      }

      let written = 0;
      for (let i = 0; i < allRooms.length; i += 400) {
        const slice = allRooms.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const { id } of slice) {
          batch.update(doc(db, 'projects', project.id, 'rooms', id), { ...fields, updatedAt: serverTimestamp() });
          written++;
        }
        await batch.commit();
      }

      // Sync local state so UI reflects without waiting for onSnapshot.
      setRooms(prev => {
        const next: Record<string, Room[]> = {};
        for (const [zid, list] of Object.entries(prev)) {
          next[zid] = (list || []).map(r => ({ ...r, ...fields }));
        }
        return next;
      });

      toast.success(`Applied to ${written} room${written === 1 ? '' : 's'}`);
      setGlobalSettingsOpen(false);
    } catch (error) {
      console.error('[LoadCalculator] Global apply failed:', error);
      toast.error('Failed to apply global settings: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const [addingZone, setAddingZone] = useState(false);
  const addZone = async (systemId?: string) => {
    if (addingZone) return;
    setAddingZone(true);
    try {
      // If parent is an ES system, write the new zone as an ES sub-zone (system.zones[]).
      // This keeps LC and ES sharing one zone hierarchy — adding in LC is reflected in ES.
      const esSys = systemId
        ? (equipSystems.find((s: any) => s.id === systemId) as any)
        : null;
      if (esSys) {
        const subZones = (esSys.zones ?? []) as any[];
        const newZoneId = `zone-${Date.now()}`;
        const name = `Zone ${subZones.length + 1}`;
        const newSubZone = { id: newZoneId, name, roomIds: [] as string[] };
        await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', systemId!), {
          zones: [...subZones, newSubZone],
          updatedAt: serverTimestamp(),
        });
        setZones(prev => [...prev, { id: newZoneId, name, systemId } as Zone]);
        setExpandedZone(newZoneId);
        toast.success('Zone added');
        return;
      }

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
    } finally {
      setAddingZone(false);
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
      // setDoc+merge creates the document if it doesn't exist (virtual zones have no
      // Firestore doc until design-condition overrides are first saved).
      await setDoc(zoneRef, cleanData, { merge: true });

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
      const zone = zones.find(z => z.id === zoneId);
      const zoneName = zone?.name ?? 'Zone';
      const systemName = systemId
        ? (systems.find(s => s.id === systemId)?.name ?? zoneName)
        : undefined;
      // Stamp new hierarchy fields when created under an equipment system zone.
      // zoneId !== systemId means this is a sub-zone (AHU group) — use it as hvacZoneId.
      const hvacFields = systemId
        ? zoneId !== systemId
          ? { hvacSystemId: systemId, hvacSystemName: systemName, hvacZoneId: zoneId, hvacZoneName: zoneName }
          : { hvacSystemId: systemId, hvacSystemName: systemName }
        : {};
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
        zoneId,
        zoneName,
        ...(systemId ? { systemId, systemName } : {}),
        ...hvacFields,
      };
      const ref = await addDoc(collection(db, 'projects', project.id, 'rooms'), roomData);
      const newRoom = normalizeRoom({ id: ref.id, ...roomData });
      setRooms(prev => ({ ...prev, [zoneId]: [...(prev[zoneId] || []), newRoom] }));
      setExpandedZone(zoneId);
      setExpandedRoom(ref.id);

      // Sync to ES: if this room belongs to an ES sub-zone, append its id to the
      // sub-zone's roomIds[] array so the room appears under that zone in Equipment
      // Selection automatically (engineer doesn't have to manually re-add it in ES).
      if (systemId && zoneId !== systemId) {
        const esSys = equipSystems.find((s: any) => s.id === systemId) as any;
        const subZones = (esSys?.zones ?? []) as any[];
        const idx = subZones.findIndex((z: any) => z.id === zoneId);
        if (idx >= 0 && !(subZones[idx].roomIds ?? []).includes(ref.id)) {
          const updated = [...subZones];
          updated[idx] = { ...updated[idx], roomIds: [...(updated[idx].roomIds ?? []), ref.id] };
          try {
            await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', systemId), {
              zones: updated,
              updatedAt: serverTimestamp(),
            });
          } catch (err) {
            console.error('[LoadCalculator] Failed to append room to ES sub-zone:', err);
          }
        }
      }

      await persistRoomAnalysisSnapshot(zoneId, newRoom.id, systemId, newRoom, []);
      toast.success('Room added');
    } catch (error) {
      toast.error('Failed to add room');
    }
  };

  const addEnvelopeElement = async (zoneId: string, roomId: string, type: EnvelopeElement['type'], systemId?: string) => {
    try {
      const zone = zones.find(z => z.id === zoneId);
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
      const room = (rooms[zoneId] || []).find((r: any) => r.id === roomId);
      const roomFloorArea = Math.round((Number(room?.length) || 0) * (Number(room?.width) || 0));
      const elementData: any = {
        type,
        orientation: defaultOrient,
        area: (type === 'Roof' || type === 'Floor') ? roomFloorArea : 0,
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
      const path = collection(db, 'projects', project.id, 'rooms', roomId, 'envelopeElements');
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
          const zone = zones.find(z => z.id === zoneId);
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
      const elRef = doc(db, 'projects', project.id, 'rooms', roomId, 'envelopeElements', elementId);
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
      const elRef = doc(db, 'projects', project.id, 'rooms', roomId, 'envelopeElements', elementId);
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
      return doc(db, 'projects', project.id, 'rooms', roomId, 'envelopeElements', elId);
    };
    const getColRef = () => {
      return collection(db, 'projects', project.id, 'rooms', roomId, 'envelopeElements');
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
    envelopeCache.set(project.id, roomId, nextElements);
    await persistRoomAnalysisSnapshot(zoneId, roomId, systemId, undefined, nextElements);
  }, [project.id, envelopeElements, persistRoomAnalysisSnapshot]);

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
      const roomRef = doc(db, 'projects', project.id, 'rooms', roomId);
      await updateDoc(roomRef, safeData);
      if (mergedRoom) {
        await persistRoomAnalysisSnapshot(zoneId, roomId, systemId, mergedRoom, envelopeElements[roomId] || []);
      }
    } catch (error) {
        console.error('[LoadCalculator] Failed to update room:', { roomId, error });
        toast.error('Update failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
        setRoomSaveStates(prev => ({ ...prev, [roomId]: 'idle' }));
    }
  };

  const deleteRoom = async (zoneId: string, roomId: string, systemId?: string) => {
    try {
      setRooms(prev => ({ ...prev, [zoneId]: (prev[zoneId] || []).filter(r => r.id !== roomId) }));
      setEnvelopeElements(prev => { const next = { ...prev }; delete next[roomId]; return next; });
      const roomRef = doc(db, 'projects', project.id, 'rooms', roomId);
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
      const elRef = doc(db, 'projects', project.id, 'rooms', roomId, 'envelopeElements', elementId);
      await updateDoc(elRef, data);
      schedulePersistRoomAnalysis(zoneId, roomId, systemId, undefined, nextElements);
    } catch (error) {
      toast.error('Update failed');
    } finally {
      delete pendingEnvelopeWritesRef.current[key];
      delete envElementDbTimersRef.current[key];
    }
  }, [project.id, schedulePersistRoomAnalysis]);

  const runPendingRoomWrite = useCallback(async (key: string) => {
    const pending = pendingRoomWritesRef.current[key];
    if (!pending) return;
    try {
      const { zoneId, roomId, data, systemId, mergedRoom } = pending;
      const roomRef = doc(db, 'projects', project.id, 'rooms', roomId);
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
  }, [project.id, schedulePersistRoomAnalysis, envelopeElements]);

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
    // 1500ms keeps the snapshot fresh enough that Equipment Selection / row badges
    // reflect edits within ~2s of the user pausing typing.
    analysisDbTimersRef.current[key] = setTimeout(() => {
      void runPendingAnalysisWrite(key);
    }, 1500);
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

  // In-place room move. Keeps the same room.id so:
  //  • the envelope elements subcollection (rooms/{id}/envelopeElements) stays attached
  //  • ES references (system.zones[].roomIds, system.iduSelections[roomId]) stay valid
  //  • the IDU/ODU selection the engineer made is preserved across moves
  // Also keeps ES system.zones[].roomIds[] in sync by removing the room from the source
  // sub-zone and adding it to the target sub-zone.
  const moveRoom = async (room: Room, sourceZoneId: string, targetZoneId: string) => {
    try {
      if (sourceZoneId === targetZoneId) return;

      const targetZone = zones.find(z => z.id === targetZoneId) || systems.find(s => s.id === targetZoneId);
      if (!targetZone) return;
      const targetZoneName = (targetZone as any).name ?? 'Zone';

      const targetSystemId = (targetZone as any).systemId as string | undefined;
      const targetSystemName: string | undefined = targetSystemId
        ? (targetSystemId === targetZoneId
            ? targetZoneName
            : (systems.find(s => s.id === targetSystemId)?.name
                ?? (equipSystems.find((s: any) => s.id === targetSystemId) as any)?.name))
        : undefined;

      const sourceZone = zones.find(z => z.id === sourceZoneId);
      const sourceSystemId = (sourceZone as any)?.systemId as string | undefined;

      // 1. In-place update of the room document — preserves room.id, envelope elements, ES refs.
      const firestoreUpdate: Record<string, any> = {
        zoneId:        targetZoneId,
        zoneName:      targetZoneName,
        hvacZoneId:    targetZoneId,
        hvacZoneName:  targetZoneName,
        ahuGroupId:    targetZoneId,
        ahuGroupName:  targetZoneName,
        updatedAt:     serverTimestamp(),
      };
      if (targetSystemId) {
        firestoreUpdate.systemId      = targetSystemId;
        firestoreUpdate.systemName    = targetSystemName ?? null;
        firestoreUpdate.hvacSystemId  = targetSystemId;
        firestoreUpdate.hvacSystemName = targetSystemName ?? null;
      } else {
        firestoreUpdate.systemId      = deleteField();
        firestoreUpdate.systemName    = deleteField();
        firestoreUpdate.hvacSystemId  = deleteField();
        firestoreUpdate.hvacSystemName = deleteField();
      }
      await updateDoc(doc(db, 'projects', project.id, 'rooms', room.id), firestoreUpdate);

      // 2. Sync ES sub-zone roomIds[]. Group updates per ES system so cross-zone moves
      //    within the same system don't issue two conflicting writes on the same doc.
      const esZonesUpdates: Record<string, any[]> = {};
      if (sourceSystemId) {
        const sourceSys = equipSystems.find((s: any) => s.id === sourceSystemId) as any;
        const sourceSubZones = (sourceSys?.zones ?? []) as any[];
        if (sourceSubZones.some((z: any) => (z.roomIds ?? []).includes(room.id))) {
          esZonesUpdates[sourceSystemId] = sourceSubZones.map((z: any) =>
            (z.roomIds ?? []).includes(room.id)
              ? { ...z, roomIds: (z.roomIds ?? []).filter((id: string) => id !== room.id) }
              : z,
          );
        }
      }
      if (targetSystemId && targetZoneId !== targetSystemId) {
        const baseZones = esZonesUpdates[targetSystemId]
          ?? ((equipSystems.find((s: any) => s.id === targetSystemId) as any)?.zones ?? []);
        const idx = baseZones.findIndex((z: any) => z.id === targetZoneId);
        if (idx >= 0 && !(baseZones[idx].roomIds ?? []).includes(room.id)) {
          const updated = [...baseZones];
          updated[idx] = { ...updated[idx], roomIds: [...(updated[idx].roomIds ?? []), room.id] };
          esZonesUpdates[targetSystemId] = updated;
        }
      }
      const esSysIds = Object.keys(esZonesUpdates);
      if (esSysIds.length > 0) {
        const batch = writeBatch(db);
        for (const sysId of esSysIds) {
          batch.update(doc(db, 'projects', project.id, 'equipmentSystems', sysId), {
            zones: esZonesUpdates[sysId],
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }

      // 3. Update local UI state immediately for snappy feel
      const mergedRoom: any = { ...room, zoneId: targetZoneId, zoneName: targetZoneName };
      if (targetSystemId) {
        mergedRoom.systemId = targetSystemId;
        if (targetSystemName) mergedRoom.systemName = targetSystemName;
      } else {
        delete mergedRoom.systemId;
        delete mergedRoom.systemName;
      }
      const normalizedRoom = normalizeRoom(mergedRoom);
      setRooms((prev) => {
        const next = { ...prev };
        next[sourceZoneId] = (next[sourceZoneId] || []).filter((r) => r.id !== room.id);
        next[targetZoneId] = [...(next[targetZoneId] || []), normalizedRoom];
        return next;
      });

      // 4. Re-run room analysis with the target zone's design conditions
      const elements = envelopeElements[room.id] || [];
      await persistRoomAnalysisSnapshot(targetZoneId, room.id, targetSystemId, normalizedRoom, elements);

      toast.success(`Moved ${room.name} to ${targetZoneName}`);
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
      const currentIncludeWinter  = project.includeWinter  ?? project.data?.includeWinter  ?? false;
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
      const resolvedIncludeWinter  = editData.includeWinter  ?? currentIncludeWinter;
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
        includeWinter: resolvedIncludeWinter,
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
          includeWinter: resolvedIncludeWinter,
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
        includeWinter: false,
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
        <div className="sticky top-0 z-20 -mx-2 px-2 py-2 bg-gray-50/95 dark:bg-slate-900/95 backdrop-blur border-b border-gray-200 dark:border-slate-700 rounded-lg flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100 truncate">{project.name}</h2>
            <p className="text-xs text-gray-400 dark:text-slate-500">
              Zone › Room
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onNavigate && (
              <Button variant="outline" size="sm" onClick={() => onNavigate('methodology')} className="gap-1 text-gray-600 dark:text-slate-400 border-gray-300 dark:border-slate-600">
                <BookOpen className="w-3.5 h-3.5" /> Methodology
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if ((systems.length === 0 && zones.length === 0) || Object.keys(liveRooms).length === 0) {
                  toast.error('Data is still loading or incomplete. Please try again.');
                  return;
                }
                generateExcelReport(project, systems, zones, liveRooms, liveEnvelopeElements, equipSystems, userProfile);
              }}
              className="gap-1 bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30 shadow-sm"
            >
              <Download className="w-3.5 h-3.5" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => generatePDFReport(project, systems, zones, liveRooms, liveEnvelopeElements, equipSystems)} className="gap-1 bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/30 shadow-sm">
              <Download className="w-3.5 h-3.5" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => generatePDFReport(project, systems, zones, liveRooms, liveEnvelopeElements, equipSystems, undefined, true)} className="gap-1 bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-slate-400 border-gray-200 dark:border-slate-600 hover:bg-gray-100 dark:hover:bg-slate-700 shadow-sm" title="Print-friendly PDF (greyscale, no colour backgrounds)">
              <Download className="w-3.5 h-3.5" /> PDF Eco
            </Button>
            <Button variant="outline" size="sm" onClick={() => generateEquipmentSchedulePDF(project, equipSystems, liveRooms)} className="gap-1 bg-teal-50 dark:bg-teal-950/20 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800 hover:bg-teal-100 dark:hover:bg-teal-900/30 shadow-sm" title="Download Equipment Schedule as separate PDF">
              <Download className="w-3.5 h-3.5" /> Equip. Schedule
            </Button>
            <Button variant="outline" size="sm" onClick={() => generateEngineeringReviewPDF(project, systems, zones, liveRooms, liveEnvelopeElements, equipSystems)} className="gap-1 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/30 shadow-sm" title="Internal QA review — auto-detected design findings. Not part of the client load-calculation submission.">
              <Download className="w-3.5 h-3.5" /> Eng. Review
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              const p = project;
              const pd = project.data ?? {};
              setEditData({
                name:                 String(p.name                ?? pd.name                ?? ''),
                location:             String(p.location            ?? pd.location            ?? p.place ?? pd.place ?? ''),
                longitude:            String(p.longitude           ?? pd.longitude           ?? ''),
                latitude:             String(p.latitude            ?? pd.latitude            ?? ''),
                altitude:             String(p.altitude            ?? pd.altitude            ?? ''),
                includeMonsoon:       p.includeMonsoon             ?? pd.includeMonsoon      ?? false,
                includeWinter:        p.includeWinter              ?? pd.includeWinter       ?? false,
                summerDesignTemp:     String(p.summerDesignTemp    ?? pd.summerDesignTemp    ?? 95),
                summerDesignHumidity: String(p.summerDesignHumidity ?? pd.summerDesignHumidity ?? 50),
                monsoonDesignTemp:    String(p.monsoonDesignTemp   ?? pd.monsoonDesignTemp   ?? 85),
                monsoonDesignHumidity:String(p.monsoonDesignHumidity ?? pd.monsoonDesignHumidity ?? 85),
                winterDesignTemp:     String(p.winterDesignTemp    ?? pd.winterDesignTemp    ?? 30),
                winterDesignHumidity: String(p.winterDesignHumidity ?? pd.winterDesignHumidity ?? 30),
                insideSummerTemp:     String(p.insideSummerTemp    ?? pd.insideSummerTemp    ?? 75),
                insideSummerHumidity: String(p.insideSummerHumidity ?? pd.insideSummerHumidity ?? 50),
                insideMonsoonTemp:    String(p.insideMonsoonTemp   ?? pd.insideMonsoonTemp   ?? 75),
                insideMonsoonHumidity:String(p.insideMonsoonHumidity ?? pd.insideMonsoonHumidity ?? 55),
                insideWinterTemp:     String(p.insideWinterTemp    ?? pd.insideWinterTemp    ?? 72),
                insideWinterHumidity: String(p.insideWinterHumidity ?? pd.insideWinterHumidity ?? 40),
              });
              setEditModalOpen(true);
            }} className="gap-1 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/20 shadow-sm">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Workflow</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
              <p className="font-semibold text-slate-700 dark:text-slate-300">Step 1</p>
              <p className="text-slate-500 dark:text-slate-400">Project Conditions</p>
            </div>
            <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20 px-3 py-2">
              <p className="font-semibold text-orange-700 dark:text-orange-400">Step 2</p>
              <p className="text-orange-600 dark:text-orange-400">Systems, Zones & Rooms</p>
            </div>
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 px-3 py-2">
              <p className="font-semibold text-blue-700 dark:text-blue-400">Step 3</p>
              <p className="text-blue-600 dark:text-blue-400">Room-Level Loads</p>
            </div>
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2">
              <p className="font-semibold text-emerald-700 dark:text-emerald-400">Step 4</p>
              <p className="text-emerald-600 dark:text-emerald-400">Psychrometric Review</p>
            </div>
          </div>
        </div>

        {/* ── DOAS / TFA staleness banner ───────────────────────────────────
            Shown when one or more rooms have stored loads that don't match the
            current DOAS configuration (e.g. you just created/linked/unlinked a
            DOAS in Equipment Selection). Until the user clicks Recalculate,
            LC's room loads still include OA the DOAS is supposed to handle. */}
        {tfaStaleRoomIds.length > 0 && (
          <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  TFA/DOAS configuration changed — {tfaStaleRoomIds.length} room{tfaStaleRoomIds.length === 1 ? '' : 's'} need recalculation
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  Stored loads still reflect the previous primary-only sizing. Click Recalculate to refresh in TFA mode.
                </p>
              </div>
            </div>
            <Button size="sm" className="h-8 text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 shrink-0"
              onClick={() => void recalcAllRooms()}>
              Recalculate {tfaStaleRoomIds.length} Room{tfaStaleRoomIds.length === 1 ? '' : 's'}
            </Button>
          </div>
        )}

        {/* ── TFA-only carrying-capacity warning (Phase D) ──────────────────
            Shown when one or more tfa-only rooms have a sensible load that
            exceeds the TFA supply's carrying capacity at the designed CFM and
            supply temperature. Engineering action: bump CFM, lower supply temp,
            or accept the deficit (add a small DX). Engine does not auto-correct. */}
        {projectTotals.tfa.undersizedRoomIds.length > 0 && (
          <div className="rounded-xl border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-rose-800 dark:text-rose-300">
                  TFA undersized — {projectTotals.tfa.undersizedRoomIds.length} TFA-only room{projectTotals.tfa.undersizedRoomIds.length === 1 ? '' : 's'} exceed{projectTotals.tfa.undersizedRoomIds.length === 1 ? 's' : ''} carrying capacity
                </p>
                <p className="text-xs text-rose-700 dark:text-rose-400 mt-0.5">
                  Deficit total: <strong>{Math.round(projectTotals.tfa.carryingDeficitTotal).toLocaleString()} BTU/h</strong>. TFA supply can't absorb the room sensible at the designed CFM and supply temp. Increase CFM (raise <code>facph</code>), lower TFA supply temp, or add a small DX assist.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── CFM-governance staleness banner ───────────────────────────────
            Shown when stored loads were sized under the old governance rule
            (max of load-TR and CFM/400). Engine now uses load-TR only;
            stored _calcRequiredTR is inflated until the user recalculates. */}
        {cfmGovernanceStaleRoomIds.length > 0 && (
          <div className="rounded-xl border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                  Engine updated — {cfmGovernanceStaleRoomIds.length} room{cfmGovernanceStaleRoomIds.length === 1 ? '' : 's'} sized under old CFM/TR governance
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
                  Plant TR is now load-only (CFM/TR no longer inflates capacity). Recalculate to refresh stored TR values.
                </p>
              </div>
            </div>
            <Button size="sm" className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 shrink-0"
              onClick={() => void recalcCfmGovernanceRooms()}>
              Recalculate {cfmGovernanceStaleRoomIds.length} Room{cfmGovernanceStaleRoomIds.length === 1 ? '' : 's'}
            </Button>
          </div>
        )}

        {/* ── Project summary strip ─────────────────────────────────────── */}
        {projectTotals.roomCount > 0 && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-white dark:from-slate-800 via-orange-50/40 dark:via-orange-950/10 to-amber-50/70 dark:to-amber-950/10 shadow-sm overflow-hidden">
            <div className="border-b border-slate-200/80 dark:border-slate-700/80 px-5 py-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-700 dark:text-orange-400">Step 1</p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Project-Level Summary</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Live aggregate of all room loads, airflow, and conditioned area.</p>
                </div>
                <div className="rounded-xl border border-orange-200 dark:border-orange-800 bg-orange-100/70 dark:bg-orange-950/30 px-4 py-2 min-w-[220px]">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-700 dark:text-orange-400">Plant Cooling Capacity</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-sm font-semibold text-orange-800 dark:text-orange-300">{projectTotals.peakSeason} peak</span>
                    <span className="rounded-full border border-orange-300 dark:border-orange-700 bg-white/70 dark:bg-slate-800/70 px-2 py-0.5 text-[10px] font-semibold text-orange-700 dark:text-orange-400">
                      Load basis
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-2xl font-bold text-orange-900 dark:text-orange-300">{projectTotals.totalTR.toFixed(2)} <span className="text-sm font-semibold text-orange-600 dark:text-orange-400">TR</span></p>
                  {projectTotals.tfa.onlyRoomCount > 0 && (
                    <p className="mt-1 text-[10px] text-orange-600 dark:text-orange-400">
                      Excludes {projectTotals.tfa.onlyRoomCount} TFA-only room{projectTotals.tfa.onlyRoomCount === 1 ? '' : 's'} (no primary load)
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className={`grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 ${
              includeMonsoon && includeWinter ? 'xl:grid-cols-5' :
              includeMonsoon || includeWinter ? 'xl:grid-cols-4' : 'xl:grid-cols-3'
            }`}>
              {/* Summer — always shown */}
              <div className="rounded-xl border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-700 dark:text-orange-400">Summer Load</p>
                    <p className="mt-2 font-mono text-xl font-bold text-orange-900 dark:text-orange-300">{projectTotals.summer.governingTR.toFixed(2)} <span className="text-[11px] font-semibold text-orange-600 dark:text-orange-400">TR</span></p>
                  </div>
                  <span className="rounded-full bg-white/80 dark:bg-slate-800/80 px-2 py-0.5 text-[10px] font-semibold text-orange-700 dark:text-orange-400">{Math.round(projectTotals.summer.totalCooling).toLocaleString()} BTU/h</span>
                </div>
                <p className="mt-2 text-xs text-orange-600 dark:text-orange-400">Coil load · airflow ratio {projectTotals.summer.totalTR > 0 ? Math.round(projectTotals.summer.totalDesignCfm / projectTotals.summer.totalTR) : 0} CFM/TR</p>
              </div>
              {/* Monsoon — only when enabled */}
              {includeMonsoon && (
                <div className="rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/20 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-teal-700 dark:text-teal-400">Monsoon Load</p>
                      <p className="mt-2 font-mono text-xl font-bold text-teal-900 dark:text-teal-300">{projectTotals.monsoon.governingTR.toFixed(2)} <span className="text-[11px] font-semibold text-teal-600 dark:text-teal-400">TR</span></p>
                    </div>
                    <span className="rounded-full bg-white/80 dark:bg-slate-800/80 px-2 py-0.5 text-[10px] font-semibold text-teal-700 dark:text-teal-400">{Math.round(projectTotals.monsoon.totalCooling).toLocaleString()} BTU/h</span>
                  </div>
                  <p className="mt-2 text-xs text-teal-600 dark:text-teal-400">Coil load · airflow ratio {projectTotals.monsoon.totalTR > 0 ? Math.round(projectTotals.monsoon.totalDesignCfm / projectTotals.monsoon.totalTR) : 0} CFM/TR</p>
                </div>
              )}
              {/* Heating — only when winter is enabled */}
              {includeWinter && (
                <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-700 dark:text-blue-400">Heating Load</p>
                  <p className="mt-2 font-mono text-xl font-bold text-blue-900 dark:text-blue-300">{Math.round(projectTotals.totalHeating).toLocaleString()}</p>
                  <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">BTU/h winter design basis</p>
                  {(() => {
                    const wOut = Number(winterDesignTemp);
                    const wIn = Number(insideWinterTemp);
                    const missing = !Number.isFinite(wOut) || !Number.isFinite(wIn);
                    const implausibleOutdoor = Number.isFinite(wOut) && (wOut < -20 || wOut > 70);
                    const implausibleIndoor = Number.isFinite(wIn) && (wIn < 50 || wIn > 80);
                    if (missing) {
                      return (
                        <p className="mt-2 text-[11px] font-semibold text-red-700 dark:text-red-400">
                          ⚠ Winter design temps missing — heating load reads 0. Set winter outdoor &amp; indoor temps in project settings.
                        </p>
                      );
                    }
                    if (implausibleOutdoor || implausibleIndoor) {
                      return (
                        <p className="mt-2 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                          ⚠ Winter temps look unusual (Out {wOut}°F, In {wIn}°F). Verify in project settings.
                        </p>
                      );
                    }
                    return null;
                  })()}
                </div>
              )}
              {/* Design Airflow — always shown */}
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-400">Design Airflow</p>
                <p className="mt-2 font-mono text-xl font-bold text-emerald-900 dark:text-emerald-300">{Math.round(projectTotals.totalDesignCfm).toLocaleString()}</p>
                <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">CFM governed by {projectTotals.governingAirflowSeason.toLowerCase()} season</p>
              </div>
              {/* TFA Coil Capacity — only when project has TFA-served rooms */}
              {(projectTotals.tfa.servedRoomCount + projectTotals.tfa.onlyRoomCount) > 0 && (
                <div className="rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/20 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-teal-700 dark:text-teal-400">TFA Coil Capacity</p>
                  <p className="mt-2 font-mono text-xl font-bold text-teal-900 dark:text-teal-300">{projectTotals.tfa.coilTR.toFixed(2)} <span className="text-[11px] font-semibold text-teal-600 dark:text-teal-400">TR</span></p>
                  <p className="mt-1 text-[11px] text-teal-600 dark:text-teal-400">
                    {projectTotals.tfa.servedRoomCount} TFA-served · {projectTotals.tfa.onlyRoomCount} TFA-only · {Math.round(projectTotals.tfa.totalCFM).toLocaleString()} CFM
                  </p>
                </div>
              )}
              {/* Conditioned Area — always shown */}
              <div className="rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/20 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-700 dark:text-violet-400">Conditioned Area</p>
                <p className="mt-2 font-mono text-xl font-bold text-violet-900 dark:text-violet-300">{Math.round(projectTotals.totalArea).toLocaleString()}</p>
                <p className="mt-1 text-xs text-violet-600 dark:text-violet-400">{projectTotals.roomCount} rooms included in load model</p>
              </div>
            </div>

            <div className="border-t border-slate-200/80 dark:border-slate-700/80 bg-white/70 dark:bg-slate-800/70 px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {includeMonsoon ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">Seasonal Comparison</p>
                        <p className="mt-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
                          <span className="font-mono text-orange-700 dark:text-orange-400">S {projectTotals.summer.governingTR.toFixed(2)} TR</span>
                          <span className="mx-1 text-slate-300 dark:text-slate-600">vs</span>
                          <span className="font-mono text-teal-700 dark:text-teal-400">M {projectTotals.monsoon.governingTR.toFixed(2)} TR</span>
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">Delta</p>
                        <p className="mt-1 font-mono text-sm font-bold text-slate-800 dark:text-slate-200">{Math.abs(projectTotals.monsoon.governingTR - projectTotals.summer.governingTR).toFixed(2)} TR</p>
                      </div>
                      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wider font-semibold text-blue-600 dark:text-blue-400">Peak Cooling Season</p>
                        <p className="mt-1 text-sm font-semibold text-blue-800 dark:text-blue-300">{projectTotals.governingLoadSeason} <span className="font-mono">{projectTotals.governingLoadTR.toFixed(2)} TR</span></p>
                      </div>
                      <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wider font-semibold text-emerald-600 dark:text-emerald-400">Peak Airflow Season</p>
                        <p className="mt-1 text-sm font-semibold text-emerald-800 dark:text-emerald-300">{projectTotals.governingAirflowSeason} <span className="font-mono">{Math.round(projectTotals.totalDesignCfm).toLocaleString()} CFM</span></p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Summer governs cooling. Enable Monsoon or Winter in Project Settings to add seasonal comparison.
                    </p>
                  )}
                  {projectTotals.cfmRatioOutOfRange && (
                    <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                      ⚠ Project CFM/TR ratio is {Math.round(projectTotals.cfmPerTRRatio)} — outside typical 350–450 band. Verify duct/fan sizing; AHU/IDU selection should satisfy CFM independently of plant TR.
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setProjectPsychroOpen((prev) => !prev)}
                  aria-expanded={projectPsychroOpen}
                  className="text-xs h-8 shrink-0"
                >
                  {projectPsychroOpen ? 'Hide Project Psychrometric' : 'Show Project Psychrometric'}
                </Button>
              </div>
            </div>

            {projectPsychroOpen && (
              <div className="border-t border-slate-200/80 dark:border-slate-700/80 p-4 bg-white/90 dark:bg-slate-800/90">
                <div className="mx-auto w-full max-w-5xl space-y-3">
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-slate-100 text-sm">Project Psychrometrics</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {includeMonsoon ? 'Summer and Monsoon design conditions' : 'Summer design conditions only'} · Altitude {projectAltitude || 0} ft
                  </p>
                </div>

                <div className={`grid gap-4 ${includeMonsoon ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
                  <div className="rounded-xl border border-orange-200 dark:border-orange-800 bg-orange-50/40 dark:bg-orange-950/20 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wider text-orange-700 dark:text-orange-400">Summer Psychrometric</p>
                      <span className="rounded-full bg-white dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-orange-700 dark:text-orange-400">
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
                      <div className="rounded-lg border border-red-100 dark:border-red-900 bg-red-50 dark:bg-red-950/20 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase text-red-700 dark:text-red-400">Outdoor</p>
                        <p className="font-semibold text-red-800 dark:text-red-300">{summerDesignTemp}°F</p>
                        <p className="text-red-600 dark:text-red-400">{summerDesignHumidity}% RH</p>
                      </div>
                      <div className="rounded-lg border border-blue-100 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/20 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase text-blue-700 dark:text-blue-400">Indoor</p>
                        <p className="font-semibold text-blue-800 dark:text-blue-300">{insideSummerTemp}°F</p>
                        <p className="text-blue-600 dark:text-blue-400">{insideSummerHumidity}% RH</p>
                      </div>
                    </div>
                  </div>

                  <div className={`rounded-xl border p-4 ${includeMonsoon ? 'border-teal-200 dark:border-teal-800 bg-teal-50/40 dark:bg-teal-950/20' : 'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 border-dashed'}`}>
                    <div className="mb-3 flex items-center justify-between">
                      <p className={`text-xs font-bold uppercase tracking-wider ${includeMonsoon ? 'text-teal-700 dark:text-teal-400' : 'text-slate-500 dark:text-slate-400'}`}>Monsoon Psychrometric</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${includeMonsoon ? 'bg-white dark:bg-slate-800 text-teal-700 dark:text-teal-400' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
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
                          <div className="rounded-lg border border-teal-100 dark:border-teal-900 bg-teal-50 dark:bg-teal-950/20 px-3 py-2">
                            <p className="text-[10px] font-bold uppercase text-teal-700 dark:text-teal-400">Outdoor</p>
                            <p className="font-semibold text-teal-800 dark:text-teal-300">{monsoonDesignTemp}°F</p>
                            <p className="text-teal-600 dark:text-teal-400">{monsoonDesignHumidity}% RH</p>
                          </div>
                          <div className="rounded-lg border border-sky-100 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/20 px-3 py-2">
                            <p className="text-[10px] font-bold uppercase text-sky-700 dark:text-sky-400">Indoor</p>
                            <p className="font-semibold text-sky-800 dark:text-sky-300">{insideMonsoonTemp}°F</p>
                            <p className="text-sky-600 dark:text-sky-400">{insideMonsoonHumidity}% RH</p>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-center">
                        <div className="px-4">
                          <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Monsoon chart is blank</p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Enable Include Monsoon Calculation in Project Edit to run and visualize monsoon conditions.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {includeMonsoon && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2 text-xs text-slate-700 dark:text-slate-300">
                    Governing Cooling: <span className="font-semibold">{projectTotals.peakSeason}</span> based on project cooling comparison.
                  </div>
                )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Zone / System management ───────────────────────────────────── */}
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          {/* Section header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-slate-800/80 border-b border-gray-200 dark:border-slate-700">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-slate-100 text-sm">
                Step 2:
                <span className="ml-1">
                Systems, Zones &amp; Rooms
                </span>
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {(() => {
                  const sysCount = zones.filter((z: any) => z.description !== undefined).length;
                  const zoneCount = zones.length - sysCount;
                  const parts: string[] = [];
                  if (sysCount > 0) parts.push(`${sysCount} system${sysCount !== 1 ? 's' : ''}`);
                  if (zoneCount > 0) parts.push(`${zoneCount} zone${zoneCount !== 1 ? 's' : ''}`);
                  return parts.length > 0 ? parts.join(' · ') : '0 zones';
                })()}
              </p>
            </div>
            {canEdit && (
              <div className="flex gap-2 items-center">
                <button
                  type="button"
                  onClick={() => setGlobalSettingsOpen(o => !o)}
                  title="Apply common defaults (false ceiling, occupancy, ACH, lights, OA) to all rooms in one click"
                  className={
                    'inline-flex items-center gap-1 text-xs h-8 px-2.5 rounded-md border transition-colors ' +
                    (globalSettingsOpen
                      ? 'bg-slate-700 border-slate-700 text-white'
                      : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700')
                  }
                >
                  <Settings className="w-3.5 h-3.5" />
                  Global
                </button>
                <Button size="sm" onClick={() => addZone()} disabled={addingZone} className="gap-1 bg-orange-600 hover:bg-orange-700 text-xs h-8">
                  {addingZone ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add Zone
                </Button>
              </div>
            )}
          </div>

          {canEdit && globalSettingsOpen && (
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 space-y-2">
              <div className="text-xs text-slate-600 dark:text-slate-400">
                Tick the fields to push to <span className="font-semibold">all {totalRoomCount} rooms</span>. Unticked fields are left as-is. Manual edits after Apply are preserved until you Apply again.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2 text-xs">
                {/* False Ceiling */}
                <label className="flex items-center gap-2 col-span-1">
                  <input
                    type="checkbox"
                    checked={globalDefaults.applyFalseCeiling}
                    onChange={e => setGlobalDefaults(g => ({ ...g, applyFalseCeiling: e.target.checked }))}
                    className="accent-orange-600"
                  />
                  <span className="font-medium text-slate-700 dark:text-slate-300 w-24">False Ceiling</span>
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={globalDefaults.hasFalseCeiling}
                      disabled={!globalDefaults.applyFalseCeiling}
                      onChange={e => setGlobalDefaults(g => ({ ...g, hasFalseCeiling: e.target.checked }))}
                      className="accent-orange-600"
                    />
                    <span>Yes</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={globalDefaults.falseCeilingHeight}
                    disabled={!globalDefaults.applyFalseCeiling || !globalDefaults.hasFalseCeiling}
                    onChange={e => setGlobalDefaults(g => ({ ...g, falseCeilingHeight: Number(e.target.value) || 0 }))}
                    className="h-7 w-16 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 text-right disabled:opacity-50"
                  />
                  <span className="text-slate-500 dark:text-slate-400">ft</span>
                </label>

                {/* Occupancy Type */}
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={globalDefaults.applyActivity}
                    onChange={e => setGlobalDefaults(g => ({ ...g, applyActivity: e.target.checked }))}
                    className="accent-orange-600"
                  />
                  <span className="font-medium text-slate-700 dark:text-slate-300 w-24">Occupancy</span>
                  <select
                    value={globalDefaults.activityType}
                    disabled={!globalDefaults.applyActivity}
                    onChange={e => setGlobalDefaults(g => ({ ...g, activityType: e.target.value }))}
                    className="h-7 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 disabled:opacity-50 flex-1 min-w-0"
                  >
                    {ACTIVITY_TYPES.map(a => (
                      <option key={a.id} value={a.id}>{a.label}</option>
                    ))}
                  </select>
                </label>

                {/* ACH Preset */}
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={globalDefaults.applyAch}
                    onChange={e => setGlobalDefaults(g => ({ ...g, applyAch: e.target.checked }))}
                    className="accent-orange-600"
                  />
                  <span className="font-medium text-slate-700 dark:text-slate-300 w-24">ACH Preset</span>
                  <select
                    value={globalDefaults.achProfile}
                    disabled={!globalDefaults.applyAch}
                    onChange={e => {
                      const id = e.target.value;
                      const ach = Number(ACTIVITY_ACH_RECOMMENDATIONS.find(a => a.id === id)?.ach) || 0;
                      setGlobalDefaults(g => ({
                        ...g,
                        achProfile: id,
                        facph: ach > 0 ? Math.min(g.facph, ach) : g.facph,
                      }));
                    }}
                    className="h-7 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 disabled:opacity-50 flex-1 min-w-0"
                  >
                    {ACTIVITY_ACH_RECOMMENDATIONS.map(a => (
                      <option key={a.id} value={a.id}>{a.label} ({a.ach} ACH)</option>
                    ))}
                  </select>
                </label>

                {/* Lights */}
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={globalDefaults.applyLights}
                    onChange={e => setGlobalDefaults(g => ({ ...g, applyLights: e.target.checked }))}
                    className="accent-orange-600"
                  />
                  <span className="font-medium text-slate-700 dark:text-slate-300 w-24">Lights</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={globalDefaults.lightsWattsPerSqft}
                    disabled={!globalDefaults.applyLights}
                    onChange={e => setGlobalDefaults(g => ({ ...g, lightsWattsPerSqft: Number(e.target.value) || 0 }))}
                    className="h-7 w-20 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 text-right disabled:opacity-50"
                  />
                  <span className="text-slate-500 dark:text-slate-400">W/ft²</span>
                </label>

                {/* FACPH — must be ≤ selected ACH Preset (OA is a subset of total air changes) */}
                {(() => {
                  const ach = ACTIVITY_ACH_RECOMMENDATIONS.find(a => a.id === globalDefaults.achProfile);
                  const maxAch = Number(ach?.ach) || 0;
                  const overLimit = globalDefaults.applyFacph && maxAch > 0 && globalDefaults.facph > maxAch;
                  return (
                    <div className="col-span-1">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={globalDefaults.applyFacph}
                          onChange={e => setGlobalDefaults(g => ({ ...g, applyFacph: e.target.checked }))}
                          className="accent-orange-600"
                        />
                        <span className="font-medium text-slate-700 dark:text-slate-300 w-24">OA FACPH</span>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          max={maxAch > 0 ? maxAch : undefined}
                          value={globalDefaults.facph}
                          disabled={!globalDefaults.applyFacph}
                          onChange={e => {
                            const v = Number(e.target.value) || 0;
                            const capped = maxAch > 0 ? Math.min(v, maxAch) : v;
                            setGlobalDefaults(g => ({ ...g, facph: capped }));
                          }}
                          className={
                            'h-7 w-20 text-xs rounded border bg-white dark:bg-slate-800 px-1.5 text-right disabled:opacity-50 ' +
                            (overLimit ? 'border-rose-500 dark:border-rose-500 text-rose-700 dark:text-rose-300' : 'border-slate-300 dark:border-slate-600')
                          }
                        />
                        <span className="text-slate-500 dark:text-slate-400">ACH</span>
                        {maxAch > 0 && (
                          <span className={'text-[11px] ' + (overLimit ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-slate-400 dark:text-slate-500')}>
                            ≤ {maxAch} ACH (total)
                          </span>
                        )}
                      </label>
                      {overLimit && (
                        <div className="text-[11px] text-rose-600 dark:text-rose-400 ml-32 mt-0.5">
                          OA cannot exceed total ACH — fresh air is part of the supply, not added on top.
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={applyGlobalDefaults}
                  disabled={totalRoomCount === 0}
                  className="h-7 px-3 text-xs bg-orange-600 hover:bg-orange-700"
                >
                  Apply to All {totalRoomCount} Room{totalRoomCount === 1 ? '' : 's'}
                </Button>
                <button
                  type="button"
                  onClick={() => setGlobalSettingsOpen(false)}
                  className="h-7 px-3 text-xs rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Zone / System list */}
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {dataLoading ? (
              <div className="py-12 text-center text-gray-500 dark:text-slate-400">
                <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-gray-400 dark:text-slate-500" />
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
                roomSaveStates={roomSaveStates}
                moveRoom={moveRoom}
                equipSystems={equipSystems}
              />
            )}
          </div>
        </div>

      </div>

      {/* Edit Project Data Modal — polished UI matching the New Project dialog (LoadCalculatorPage). */}
      {(() => {
        const activeSeasonsCount = 1 + (editData.includeMonsoon ? 1 : 0) + (editData.includeWinter ? 1 : 0);
        const gridCols = activeSeasonsCount === 1 ? 'grid-cols-1' : activeSeasonsCount === 2 ? 'grid-cols-2' : 'grid-cols-3';
        return (
        <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
          <DialogContent className="max-h-[92vh] w-[95vw] sm:max-w-6xl overflow-y-auto p-0">

            {/* Header */}
            <div className="sticky top-0 z-10 rounded-t-lg border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500/10 dark:bg-teal-500/20">
                  <Thermometer className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Edit Project</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Update project settings and design conditions</p>
                </div>
                <Button type="button" size="sm" variant="outline" className="text-xs gap-1.5 h-8"
                  onClick={() => setMetDataDialogOpen(true)}>
                  <BarChart3 className="w-3.5 h-3.5" /> Import from Met Data
                </Button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-6">

              {/* ── Project Information ──────────────────────────── */}
              <div className="space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Project Information</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2 space-y-1.5">
                    <Label className="text-sm font-medium">Project Name</Label>
                    <input className={EDIT_INPUT_CLS}
                      value={editData.name}
                      onChange={(e) => setEditData(prev => ({ ...prev, name: e.target.value }))}
                      placeholder={project.name || 'Project name'}
                    />
                  </div>

                  <div className="sm:col-span-2 space-y-1.5">
                    <Label className="text-sm font-medium">Project Location</Label>
                    <input className={EDIT_INPUT_CLS}
                      value={editData.location}
                      onChange={(e) => setEditData(prev => ({ ...prev, location: e.target.value }))}
                      placeholder={project.location || 'City, State'}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-slate-400" /> Latitude
                    </Label>
                    <input className={EDIT_INPUT_CLS}
                      type="text" inputMode="decimal" step="0.0001"
                      value={editData.latitude}
                      onChange={(e) => setEditData(prev => ({ ...prev, latitude: e.target.value }))}
                      placeholder={(project.latitude ?? project.data?.latitude)?.toString() || 'Latitude'}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-slate-400" /> Longitude
                    </Label>
                    <input className={EDIT_INPUT_CLS}
                      type="text" inputMode="decimal" step="0.0001"
                      value={editData.longitude}
                      onChange={(e) => setEditData(prev => ({ ...prev, longitude: e.target.value }))}
                      placeholder={(project.longitude ?? project.data?.longitude)?.toString() || 'Longitude'}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Altitude (ft)</Label>
                    <input className={EDIT_INPUT_CLS}
                      type="text" inputMode="decimal"
                      value={editData.altitude}
                      onChange={(e) => setEditData(prev => ({ ...prev, altitude: e.target.value }))}
                      placeholder={(project.altitude ?? project.data?.altitude)?.toString() || 'Elevation in feet'}
                    />
                  </div>
                </div>
              </div>

              <Separator className="dark:bg-slate-700" />

              {/* ── Season Toggles ───────────────────────────────── */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Design Seasons</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all ${
                    editData.includeMonsoon
                      ? 'border-teal-400/60 bg-teal-50 dark:border-teal-600/50 dark:bg-teal-900/20'
                      : 'border-slate-200 dark:border-slate-700 hover:border-teal-300 dark:hover:border-teal-700'
                  }`}>
                    <input
                      type="checkbox"
                      checked={editData.includeMonsoon}
                      onChange={(e) => setEditData(prev => ({ ...prev, includeMonsoon: e.target.checked }))}
                      className="mt-0.5 h-4 w-4 cursor-pointer accent-teal-500"
                    />
                    <div>
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Include Monsoon</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Calculate peak load at monsoon conditions (high humidity)
                      </p>
                    </div>
                  </label>

                  <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all ${
                    editData.includeWinter
                      ? 'border-blue-400/60 bg-blue-50 dark:border-blue-600/50 dark:bg-blue-900/20'
                      : 'border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700'
                  }`}>
                    <input
                      type="checkbox"
                      checked={editData.includeWinter}
                      onChange={(e) => setEditData(prev => ({ ...prev, includeWinter: e.target.checked }))}
                      className="mt-0.5 h-4 w-4 cursor-pointer accent-blue-500"
                    />
                    <div>
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Include Winter</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Calculate heating load at winter design conditions
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              <Separator className="dark:bg-slate-700" />

              {/* ── Outside Design Conditions ─────────────────────── */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Thermometer className="h-4 w-4 text-orange-500" />
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Outside Design Conditions</h3>
                </div>
                <div className={`grid gap-3 ${gridCols}`}>
                  {/* Summer */}
                  <div className="rounded-xl border border-orange-200 dark:border-orange-800/50 bg-orange-50 dark:bg-orange-900/15 p-4 space-y-3">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-orange-400" />
                      <p className="text-xs font-bold text-orange-700 dark:text-orange-300 uppercase tracking-wide">Summer</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-slate-500 dark:text-slate-400">Temp (°F)</Label>
                        <input className={EDIT_INPUT_CLS}
                          type="text" inputMode="decimal"
                          value={editData.summerDesignTemp}
                          onChange={(e) => setEditData(prev => ({ ...prev, summerDesignTemp: e.target.value }))}
                          placeholder={(project.summerDesignTemp ?? project.data?.summerDesignTemp ?? 95).toString()}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-slate-500 dark:text-slate-400">RH (%)</Label>
                        <input className={EDIT_INPUT_CLS}
                          type="text" inputMode="decimal"
                          value={editData.summerDesignHumidity}
                          onChange={(e) => setEditData(prev => ({ ...prev, summerDesignHumidity: e.target.value }))}
                          placeholder={(project.summerDesignHumidity ?? project.data?.summerDesignHumidity ?? 50).toString()}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Monsoon */}
                  {editData.includeMonsoon && (
                    <div className="rounded-xl border border-teal-200 dark:border-teal-700/50 bg-teal-50 dark:bg-teal-900/15 p-4 space-y-3">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-teal-400" />
                        <p className="text-xs font-bold text-teal-700 dark:text-teal-300 uppercase tracking-wide">Monsoon</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[11px] text-slate-500 dark:text-slate-400">Temp (°F)</Label>
                          <input className={EDIT_INPUT_CLS}
                            type="text" inputMode="decimal"
                            value={editData.monsoonDesignTemp}
                            onChange={(e) => setEditData(prev => ({ ...prev, monsoonDesignTemp: e.target.value }))}
                            placeholder={(project.monsoonDesignTemp ?? project.data?.monsoonDesignTemp ?? 85).toString()}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-slate-500 dark:text-slate-400">RH (%)</Label>
                          <input className={EDIT_INPUT_CLS}
                            type="text" inputMode="decimal"
                            value={editData.monsoonDesignHumidity}
                            onChange={(e) => setEditData(prev => ({ ...prev, monsoonDesignHumidity: e.target.value }))}
                            placeholder={(project.monsoonDesignHumidity ?? project.data?.monsoonDesignHumidity ?? 85).toString()}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Winter */}
                  {editData.includeWinter && (
                    <div className="rounded-xl border border-blue-200 dark:border-blue-700/50 bg-blue-50 dark:bg-blue-900/15 p-4 space-y-3">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-blue-400" />
                        <p className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wide">Winter</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[11px] text-slate-500 dark:text-slate-400">Temp (°F)</Label>
                          <input className={EDIT_INPUT_CLS}
                            type="text" inputMode="decimal"
                            value={editData.winterDesignTemp}
                            onChange={(e) => setEditData(prev => ({ ...prev, winterDesignTemp: e.target.value }))}
                            placeholder={(project.winterDesignTemp ?? project.data?.winterDesignTemp ?? 30).toString()}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-slate-500 dark:text-slate-400">RH (%)</Label>
                          <input className={EDIT_INPUT_CLS}
                            type="text" inputMode="decimal"
                            value={editData.winterDesignHumidity}
                            onChange={(e) => setEditData(prev => ({ ...prev, winterDesignHumidity: e.target.value }))}
                            placeholder={(project.winterDesignHumidity ?? project.data?.winterDesignHumidity ?? 30).toString()}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Inside Design Conditions ──────────────────────── */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Droplets className="h-4 w-4 text-sky-500" />
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Inside Design Conditions</h3>
                </div>
                <div className={`grid gap-3 ${gridCols}`}>
                  {/* Summer inside */}
                  <div className="rounded-xl border border-sky-200 dark:border-sky-700/50 bg-sky-50 dark:bg-sky-900/15 p-4 space-y-3">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-sky-400" />
                      <p className="text-xs font-bold text-sky-700 dark:text-sky-300 uppercase tracking-wide">Summer (Cooling)</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-slate-500 dark:text-slate-400">Temp (°F)</Label>
                        <input className={EDIT_INPUT_CLS}
                          type="text" inputMode="decimal"
                          value={editData.insideSummerTemp}
                          onChange={(e) => setEditData(prev => ({ ...prev, insideSummerTemp: e.target.value }))}
                          placeholder={(project.insideSummerTemp ?? project.data?.insideSummerTemp ?? 75).toString()}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-slate-500 dark:text-slate-400">RH (%)</Label>
                        <input className={EDIT_INPUT_CLS}
                          type="text" inputMode="decimal"
                          value={editData.insideSummerHumidity}
                          onChange={(e) => setEditData(prev => ({ ...prev, insideSummerHumidity: e.target.value }))}
                          placeholder={(project.insideSummerHumidity ?? project.data?.insideSummerHumidity ?? 50).toString()}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Monsoon inside */}
                  {editData.includeMonsoon && (
                    <div className="rounded-xl border border-cyan-200 dark:border-cyan-700/50 bg-cyan-50 dark:bg-cyan-900/15 p-4 space-y-3">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-cyan-400" />
                        <p className="text-xs font-bold text-cyan-700 dark:text-cyan-300 uppercase tracking-wide">Monsoon (Cooling)</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[11px] text-slate-500 dark:text-slate-400">Temp (°F)</Label>
                          <input className={EDIT_INPUT_CLS}
                            type="text" inputMode="decimal"
                            value={editData.insideMonsoonTemp}
                            onChange={(e) => setEditData(prev => ({ ...prev, insideMonsoonTemp: e.target.value }))}
                            placeholder={(project.insideMonsoonTemp ?? project.data?.insideMonsoonTemp ?? project.insideSummerTemp ?? 75).toString()}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-slate-500 dark:text-slate-400">RH (%)</Label>
                          <input className={EDIT_INPUT_CLS}
                            type="text" inputMode="decimal"
                            value={editData.insideMonsoonHumidity}
                            onChange={(e) => setEditData(prev => ({ ...prev, insideMonsoonHumidity: e.target.value }))}
                            placeholder={(project.insideMonsoonHumidity ?? project.data?.insideMonsoonHumidity ?? 55).toString()}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Winter inside */}
                  {editData.includeWinter && (
                    <div className="rounded-xl border border-indigo-200 dark:border-indigo-700/50 bg-indigo-50 dark:bg-indigo-900/15 p-4 space-y-3">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-indigo-400" />
                        <p className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wide">Winter (Heating)</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[11px] text-slate-500 dark:text-slate-400">Temp (°F)</Label>
                          <input className={EDIT_INPUT_CLS}
                            type="text" inputMode="decimal"
                            value={editData.insideWinterTemp}
                            onChange={(e) => setEditData(prev => ({ ...prev, insideWinterTemp: e.target.value }))}
                            placeholder={(project.insideWinterTemp ?? project.data?.insideWinterTemp ?? 72).toString()}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-slate-500 dark:text-slate-400">RH (%)</Label>
                          <input className={EDIT_INPUT_CLS}
                            type="text" inputMode="decimal"
                            value={editData.insideWinterHumidity}
                            onChange={(e) => setEditData(prev => ({ ...prev, insideWinterHumidity: e.target.value }))}
                            placeholder={(project.insideWinterHumidity ?? project.data?.insideWinterHumidity ?? 40).toString()}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  Enthalpy and humidity ratio are calculated automatically on save.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 rounded-b-lg border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-6 py-4 flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setEditData({
                    name: '', location: '', longitude: '', latitude: '', altitude: '',
                    includeMonsoon: false, includeWinter: false,
                    summerDesignTemp: '', summerDesignHumidity: '',
                    monsoonDesignTemp: '', monsoonDesignHumidity: '',
                    winterDesignTemp: '', winterDesignHumidity: '',
                    insideSummerTemp: '', insideSummerHumidity: '',
                    insideMonsoonTemp: '', insideMonsoonHumidity: '',
                    insideWinterTemp: '', insideWinterHumidity: '',
                  });
                  setEditModalOpen(false);
                }}
                disabled={editLoading}
                className="h-9"
              >
                Cancel
              </Button>
              <Button onClick={saveProjectData} disabled={editLoading} className="h-9 bg-teal-600 hover:bg-teal-500 text-white min-w-[130px]">
                {editLoading
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
                  : 'Update Project'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        );
      })()}

      {/* Met Data Importer — opened from inside the Edit Project dialog. Read-only utility:
          parses pasted 10-yr monthly Min/Max/RH, computes ASHRAE-style design conditions at
          1% or 4% basis, and shows results with copy buttons. User pastes values back into
          the design-condition fields above. No schema change. */}
      <MetDataImporterDialog open={metDataDialogOpen} onClose={() => setMetDataDialogOpen(false)} />
    </DndContext>
  );
});

export default LoadCalculator;
