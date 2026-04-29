import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ChevronDown, ChevronRight, Trash2, Plus, Grip, Loader2, PackagePlus } from 'lucide-react';
import EquipmentPickerDialog from './EquipmentPickerDialog';
import { toast } from 'sonner';
import {
  calculateEnvelopeGain,
  calculateRoomVolume,
  calculateInternalGains,
  calculateVentilationLoad,
  calculateParasiticGains,
  calculateHeatingLoad,
  calculatePsychrometrics,
  calculateCoilParameters,
  calculateReheat,
  getCLTD,
  getSHGF,
  DEFAULT_WALL_TYPES,
  ACTIVITY_TYPES,
  ACTIVITY_ACH_RECOMMENDATIONS,
  getRecommendedAch,
  type WallColor,
  type DesignConditions,
  type RoomDetails,
  type EnvelopeElement,
} from '../../lib/hvac';
import PsychrometricChart from './PsychrometricChart';

type ElementType = 'Wall' | 'Glass' | 'Roof' | 'Floor' | 'Partition';
type Orientation = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'H';

const VERTICAL_ORIENTATIONS: Orientation[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const HORIZONTAL_ORIENTATIONS: Orientation[] = ['H'];
const BF = 0.15; // Bypass Factor

const WALL_TYPES  = DEFAULT_WALL_TYPES.filter(w => w.id.startsWith('w'));
const GLASS_TYPES = DEFAULT_WALL_TYPES.filter(w => w.id.startsWith('g'));

type RoomTableProps = {
  rooms: any[];
  liveRooms?: any[];
  zoneId: string;
  systemId?: string;
  expandedRoom: string | null;
  setExpandedRoom: (id: string | null) => void;
  updateRoom: (zoneId: string, roomId: string, data: Record<string, any>, systemId?: string) => Promise<void> | void;
  deleteRoom: (zoneId: string, roomId: string, systemId?: string) => void;
  addEnvelopeElement: (zoneId: string, roomId: string, type: ElementType, systemId?: string) => void;
  updateEnvelopeElement: (zoneId: string, roomId: string, elementId: string, data: Record<string, any>, systemId?: string) => void;
  deleteEnvelopeElement: (zoneId: string, roomId: string, elementId: string, systemId?: string) => void;
  envelopeElements: Record<string, any[]>;
  project?: any;
  designConditions?: DesignConditions;
  roomSaveStates?: Record<string, 'idle' | 'saving' | 'saved'>;
  onRoomDraftChange?: (zoneId: string, roomId: string, draft: Record<string, any> | null, systemId?: string) => void;
};

type RoomParameterState = {
  name: string;
  floor: string;
  length: number;
  width: number;
  height: number;
  hasFalseCeiling: boolean;
  falseCeilingHeight: number;
  peopleCount: number;
  activityType: string;
  achProfile: string;
  lightsWattsPerSqft: number;
  equipmentKW: number;
  othersKW: number;
  facph: number;
  sensibleSafetyPercent: number;
  latentSafetyPercent: number;
  overallSafetyPercent: number;
  ductGainPct: number;
  fanGainPct: number;
};

function getRoomParameterState(room: any): RoomParameterState {
  return {
    name: room?.name ?? '',
    floor: room?.floor ?? 'Ground',
    length: Number(room?.length) || 0,
    width: Number(room?.width) || 0,
    height: Number(room?.height) || 0,
    hasFalseCeiling: room?.hasFalseCeiling ?? false,
    falseCeilingHeight: Number(room?.falseCeilingHeight) || 8,
    peopleCount: Number(room?.peopleCount) || 0,
    activityType: room?.activityType ?? 'office',
    achProfile: room?.achProfile ?? room?.activityType ?? 'office',
    lightsWattsPerSqft: Number(room?.lightsWattsPerSqft) || 0,
    equipmentKW: Number(room?.equipmentKW) || 0,
    othersKW: Number(room?.othersKW) || 0,
    facph: Number(room?.facph) || 0,
    sensibleSafetyPercent: Number(room?.sensibleSafetyPercent) || 10,
    latentSafetyPercent: Number(room?.latentSafetyPercent) || 5,
    overallSafetyPercent: Number(room?.overallSafetyPercent) || 3,
    ductGainPct: Number(room?.ductGainPct) || 2,
    fanGainPct: Number(room?.fanGainPct) || 3,
  };
}

function areRoomParameterStatesEqual(left: RoomParameterState, right: RoomParameterState) {
  return (
    left.name === right.name &&
    left.floor === right.floor &&
    left.length === right.length &&
    left.width === right.width &&
    left.height === right.height &&
    left.hasFalseCeiling === right.hasFalseCeiling &&
    left.falseCeilingHeight === right.falseCeilingHeight &&
    left.peopleCount === right.peopleCount &&
    left.activityType === right.activityType &&
    left.achProfile === right.achProfile &&
    left.lightsWattsPerSqft === right.lightsWattsPerSqft &&
    left.equipmentKW === right.equipmentKW &&
    left.othersKW === right.othersKW &&
    left.facph === right.facph &&
    left.sensibleSafetyPercent === right.sensibleSafetyPercent &&
    left.latentSafetyPercent === right.latentSafetyPercent &&
    left.overallSafetyPercent === right.overallSafetyPercent &&
    left.ductGainPct === right.ductGainPct &&
    left.fanGainPct === right.fanGainPct
  );
}

// ─── Per-room calculation hook ────────────────────────────────────────────────

function useRoomCalc(room: any, elements: any[], designConditions: DesignConditions, project?: any) {
  return useMemo(() => {
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

    const typedElements = (elements || []) as EnvelopeElement[];

    const envelope = calculateEnvelopeGain(typedElements, designConditions);
    const internal = calculateInternalGains(rd);
    const vent = calculateVentilationLoad(rd, designConditions);
    const heating = calculateHeatingLoad(rd, typedElements, designConditions);

    // Effective room loads (with bypass factor on ventilation)
    const erSensible =
      envelope.sensible +
      internal.sensible +
      vent.sensible * BF;
    const erLatent = internal.latent + vent.latent * BF;

    const ductPct = Number(room.ductGainPct) || 2;
    const fanPct = Number(room.fanGainPct) || 3;
    const parasitic = calculateParasiticGains(erSensible, erSensible, ductPct, fanPct);

    let ersh = erSensible + parasitic.ductGain + parasitic.fanGain;
    let erlh = erLatent;
    
    // Apply safety factors to sensible and latent loads
    const sensibleSafetyFactor = Number(room.sensibleSafetyPercent ?? 10) / 100;
    const latentSafetyFactor = Number(room.latentSafetyPercent ?? 5) / 100;
    ersh = ersh * (1 + sensibleSafetyFactor);
    erlh = erlh * (1 + latentSafetyFactor);
    
    const erh = ersh + erlh;

    // Outside air (un-bypassed)
    const oaSensible = vent.sensible * (1 - BF);
    const oaLatent = vent.latent * (1 - BF);
    const oaTotal = oaSensible + oaLatent;

    // Coil sizing uses full OA load (engineering standard):
    // Coil sensible = room sensible + OA sensible (+ duct/fan)
    // Coil latent   = room latent + OA latent
    const coilSensible = ersh + oaSensible;
    const coilLatent = erlh + oaLatent;

    const grandTotal = erh + oaTotal;
    const grandTotalTR = grandTotal / 12000;
    const rshf = coilSensible > 0 ? coilSensible / (coilSensible + coilLatent) : 1;

    // Psychrometric properties and moisture management
    const altFt = designConditions.altitude ?? 0;
    const outdoorPsych = calculatePsychrometrics(designConditions.outdoorTemp, designConditions.outdoorHumidity, altFt);
    const indoorPsych  = calculatePsychrometrics(designConditions.indoorTemp,  designConditions.indoorHumidity,  altFt);

    // Total dehumidification = entire coil latent load (people + ventilation + infiltration)
    // expressed as moisture removal rate (lbs/hr), not just ventilation portion
    const LATENT_HEAT_VAPORIZATION = 1050; // BTU/lb at coil conditions
    const totalMoistureLbsHr = coilLatent / LATENT_HEAT_VAPORIZATION;
    const moisture = {
      rate:    totalMoistureLbsHr,
      action:  'Dehumidify' as const,
      unit:    'lbs/hr',
      loadBTU: coilLatent,
    };

    // Reheat uses coil sensible/latent ratio (Grand Sensible Heat Factor)
    // so that OA contribution is included — gives the true supply-air SHR
    const reheat = calculateReheat(coilSensible, coilLatent);

    const isChiller = String(project?.systemType || '').toLowerCase().includes('chiller');
    const coil = calculateCoilParameters(
      coilSensible,
      coilLatent,
      designConditions.indoorTemp,
      designConditions.indoorHumidity,
      altFt,
      BF,
      35,
      65,
      isChiller ? 50 : 54,
    );

    // Separate OA FACPH from total-supply ACH requirement.
    // OA FACPH drives outdoor-air load; total ACH (preset) drives minimum supply airflow.
    const presetTotalACH = getRecommendedAch(room.achProfile ?? room.activityType);
    const totalSupplyACH = Math.max(presetTotalACH, rd.facph);
    const totalSupplyCFM = (calculateRoomVolume(rd) * totalSupplyACH) / 60;
    const designCFM = Math.max(coil.dehumidifiedCFM, totalSupplyCFM);
    const achGovernsAirflow = coil.dehumidifiedCFM < totalSupplyCFM;

    // CFM-based TR from governing design airflow, using nominal 20F supply-room delta.
    const cfmTR = (designCFM * 1.08 * 20) / 12000;
    const governingTR = Math.max(grandTotalTR, cfmTR);
    
    // Apply overall safety factor to final TR
    const overallSafetyFactor = Number(room.overallSafetyPercent ?? 3) / 100;
    const requiredTR = governingTR * (1 + overallSafetyFactor);

    const defaultOutdoorTemp = project?.summerDesignTemp ?? project?.data?.summerDesignTemp ?? 95;
    const defaultOutdoorRh = project?.summerDesignHumidity ?? project?.data?.summerDesignHumidity ?? 50;
    const defaultIndoorTemp = project?.insideSummerTemp ?? project?.data?.insideSummerTemp ?? 75;
    const defaultIndoorRh = project?.insideSummerHumidity ?? project?.data?.insideSummerHumidity ?? 50;
    const defaultAltitude = project?.altitude ?? project?.data?.altitude ?? 0;

    const baselineOutdoorPsych = calculatePsychrometrics(defaultOutdoorTemp, defaultOutdoorRh, defaultAltitude);
    const baselineIndoorPsych = calculatePsychrometrics(defaultIndoorTemp, defaultIndoorRh, defaultAltitude);

    return {
      rd,
      envelope,
      internal,
      vent,
      heating,
      parasitic,
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
      cfmTR,
      governingTR,
      requiredTR,
      rshf,
      ductPct,
      fanPct,
      sensibleSafetyFactor,
      latentSafetyFactor,
      overallSafetyFactor,
      outdoorPsych,
      indoorPsych,
      baselineOutdoorPsych,
      baselineIndoorPsych,
      moisture,
      reheat,
      coil,
      designCFM,
      achGovernsAirflow,
      presetTotalACH,
      totalSupplyACH,
      totalSupplyCFM,
    };
  }, [room, elements, designConditions, project]);
}

function getMonsoonDesignConditions(project?: any, base?: DesignConditions): DesignConditions {
  return {
    ...(base || {
      outdoorTemp: 95,
      indoorTemp: 75,
      outdoorHumidity: 50,
      indoorHumidity: 50,
      altitude: 0,
    }),
    outdoorTemp: project?.monsoonDesignTemp ?? project?.data?.monsoonDesignTemp ?? 85,
    outdoorHumidity: project?.monsoonDesignHumidity ?? project?.data?.monsoonDesignHumidity ?? 85,
    indoorTemp: project?.insideMonsoonTemp ?? project?.data?.insideMonsoonTemp ?? project?.insideSummerTemp ?? project?.data?.insideSummerTemp ?? base?.indoorTemp ?? 75,
    indoorHumidity: project?.insideMonsoonHumidity ?? project?.data?.insideMonsoonHumidity ?? 55,
  };
}

// ─── Field label wrapper ───────────────────────────────────────────────────────
// Must be defined at module level — NOT inside RoomDetail — to prevent remount on re-render

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      {children}
    </div>
  );
}

// ─── Unit Conversion Helper ─────────────────────────────────────────────────────
const parseCalculatorInput = (input: string): number | null => {
  if (!input.startsWith('=')) return null;
  const expr = input.substring(1).trim();
  
  // Unit conversion patterns: "10m", "5cm", "2.5in", "3ft"
  const unitMatch = expr.match(/^([\d.]+)\s*(m|cm|mm|ft|in|inch|inches)$/i);
  if (unitMatch) {
    const num = parseFloat(unitMatch[1]);
    const unit = unitMatch[2].toLowerCase();
    if (isNaN(num)) return null;
    switch (unit) {
      case 'm': return num * 3.28084; // meters to feet
      case 'cm': return num / 30.48; // centimeters to feet
      case 'mm': return num / 304.8; // millimeters to feet
      case 'in':
      case 'inch':
      case 'inches': return num / 12; // inches to feet
      case 'ft': return num;
      default: return null;
    }
  }
  
  // Evaluate mathematical expressions: "10*3.28", "5+2", etc.
  try {
    // Sanitize: allow only numbers, operators, and parentheses
    if (!/^[\d.+\-*/().\s]+$/.test(expr)) return null;
    // eslint-disable-next-line no-eval
    const result = Function(`"use strict"; return (${expr})`)();
    return typeof result === 'number' && !isNaN(result) ? result : null;
  } catch {
    return null;
  }
};

// ─── Buffered number input ─────────────────────────────────────────────────────
// Must be defined at module level — NOT inside RoomDetail — to prevent React
// from treating it as a new component type on every re-render (which would
// unmount/remount it, resetting draft state to 0 on every keystroke).

function BufferedNumberInput({
  draftKey,
  value,
  onCommit,
  onDraftChange,
  className,
  placeholder,
  title,
  min,
  max,
  disabled,
  committersRef,
  defaultValue,
}: {
  draftKey: string;
  value: number | string | undefined;
  onCommit: (next: number) => void;
  onDraftChange?: (draft: string, parsedValue?: number) => void;
  className?: string;
  placeholder?: string;
  title?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  committersRef: React.MutableRefObject<Record<string, () => void>>;
  defaultValue?: number;
}) {
  const [draft, setDraft] = useState(value === null || value === undefined ? '' : String(value));
  const [calcError, setCalcError] = useState(false);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (isFocusedRef.current) return;
    setDraft(value === null || value === undefined ? '' : String(value));
  }, [value]);

  const commit = () => {
    if (draft.trim() === '') {
      if (Number(value ?? 0) !== 0) onCommit(0);
      return;
    }
    
    // Try calculator input first
    const calcResult = parseCalculatorInput(draft);
    if (calcResult !== null) {
      let next = calcResult;
      if (typeof min === 'number') next = Math.max(min, next);
      if (typeof max === 'number') next = Math.min(max, next);
      onCommit(next);
      setCalcError(false);
      return;
    }
    
    // If starts with '=' but parsing failed, show error
    if (draft.trim().startsWith('=')) {
      setCalcError(true);
      return;
    }
    
    const parsed = Number.parseFloat(draft);
    if (Number.isNaN(parsed)) return;
    let next = parsed;
    if (typeof min === 'number') next = Math.max(min, next);
    if (typeof max === 'number') next = Math.min(max, next);
    const current = Number.parseFloat(String(value ?? '0'));
    if (!Number.isNaN(current) && current === next) return;
    onCommit(next);
    setCalcError(false);
  };

  useEffect(() => {
    committersRef.current[draftKey] = commit;
    return () => { delete committersRef.current[draftKey]; };
  }, [draftKey, draft, value, min, max]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check if value is overridden from default
  const isOverridden = defaultValue !== undefined && Number(value ?? 0) !== defaultValue;

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={() => {
        isFocusedRef.current = true;
      }}
      onChange={e => {
        const nextDraft = e.target.value;
        setDraft(nextDraft);
        setCalcError(false);

        if (onDraftChange) {
          if (nextDraft.trim() === '') {
            onDraftChange(nextDraft, 0);
            return;
          }

          const calcResult = parseCalculatorInput(nextDraft);
          if (calcResult !== null) {
            let next = calcResult;
            if (typeof min === 'number') next = Math.max(min, next);
            if (typeof max === 'number') next = Math.min(max, next);
            onDraftChange(nextDraft, next);
            return;
          }

          if (!nextDraft.trim().startsWith('=')) {
            const parsed = Number.parseFloat(nextDraft);
            if (!Number.isNaN(parsed)) {
              let next = parsed;
              if (typeof min === 'number') next = Math.max(min, next);
              if (typeof max === 'number') next = Math.min(max, next);
              onDraftChange(nextDraft, next);
              return;
            }
          }

          onDraftChange(nextDraft, undefined);
        }
      }}
      onBlur={e => {
        isFocusedRef.current = false;
        const nextEl = e.relatedTarget as HTMLElement | null;
        if (nextEl) {
          const tag = nextEl.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
          if (nextEl.getAttribute('role') === 'button') return;
        }
        setTimeout(commit, 0);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      }}
      placeholder={placeholder}
      title={title}
      disabled={disabled}
      className={`${className || ''} ${isOverridden ? 'border-red-400 bg-red-50/30' : ''} ${calcError ? 'border-red-500 bg-red-50' : ''}`}
    />
  );
}

// ─── Single room expanded detail ──────────────────────────────────────────────

function RoomDetail({
  room, zoneId, systemId, elements, designConditions, project,
  updateRoom, addEnvelopeElement, updateEnvelopeElement, deleteEnvelopeElement,
  saveState, onDirtyChange, onRoomDraftChange,
}: {
  room: any; zoneId: string; systemId?: string; elements: any[];
  designConditions: DesignConditions;
  project?: any;
  saveState?: 'idle' | 'saving' | 'saved';
  updateRoom: (zoneId: string, roomId: string, data: Record<string, any>, systemId?: string) => Promise<void> | void;
  addEnvelopeElement: (zoneId: string, roomId: string, type: ElementType, systemId?: string) => void;
  updateEnvelopeElement: (zoneId: string, roomId: string, elementId: string, data: Record<string, any>, systemId?: string) => void;
  deleteEnvelopeElement: (zoneId: string, roomId: string, elementId: string, systemId?: string) => void;
  onDirtyChange?: (roomId: string, isDirty: boolean) => void;
  onRoomDraftChange?: (zoneId: string, roomId: string, draft: Record<string, any> | null, systemId?: string) => void;
}) {
  const id = room.id;
  const [activeStep, setActiveStep] = useState<'inputs' | 'envelope' | 'cooling' | 'heating' | 'moisture'>('inputs');
  const [equipmentPickerOpen, setEquipmentPickerOpen] = useState(false);
  const [coolingPanelsOpen, setCoolingPanelsOpen] = useState({ summer: true, monsoon: false });
  const [moisturePanelsOpen, setMoisturePanelsOpen] = useState({ summer: true, monsoon: false });
  const [psychroChartsOpen, setPsychroChartsOpen] = useState({ summer: true, monsoon: false });
  const [roomDraft, setRoomDraft] = useState<RoomParameterState>(() => getRoomParameterState(room));
  const [isUpdating, setIsUpdating] = useState(false);
  const roomDraftRef = useRef<RoomParameterState>(roomDraft);
  const committedRoomState = useMemo(() => getRoomParameterState(room), [room]);
  const liveRoom = useMemo(() => ({ ...room, ...roomDraft }), [room, roomDraft]);
  const isRoomDirty = useMemo(
    () => !areRoomParameterStatesEqual(roomDraft, committedRoomState),
    [roomDraft, committedRoomState],
  );
  const c = useRoomCalc(liveRoom, elements, designConditions, project);
  const monsoonDc = useMemo(() => getMonsoonDesignConditions(project, designConditions), [project, designConditions]);
  const monsoonCalc = useRoomCalc(liveRoom, elements, monsoonDc, project);
  const hasMonsoon = !!(project?.includeMonsoon ?? project?.data?.includeMonsoon);
  const loadGoverningSeason = hasMonsoon && monsoonCalc.grandTotalTR > c.grandTotalTR ? 'Monsoon' : 'Summer';
  const cfmGoverningSeason = hasMonsoon && monsoonCalc.cfmTR > c.cfmTR ? 'Monsoon' : 'Summer';
  const loadGoverningTR = hasMonsoon ? Math.max(c.grandTotalTR, monsoonCalc.grandTotalTR) : c.grandTotalTR;
  const cfmGoverningTR = hasMonsoon ? Math.max(c.cfmTR, monsoonCalc.cfmTR) : c.cfmTR;
  const overallGoverningTR = Math.max(loadGoverningTR, cfmGoverningTR);
  const governingMetric = overallGoverningTR === cfmGoverningTR ? 'CFM' : 'Load';
  const governingSeason = governingMetric === 'CFM' ? cfmGoverningSeason : loadGoverningSeason;
  const equipmentDesignCFM = hasMonsoon ? Math.max(c.designCFM, monsoonCalc.designCFM) : c.designCFM;
  const equipmentBasis = {
    loadGoverningSeason,
    cfmGoverningSeason,
    governingMetric,
    governingSeason,
    loadGoverningTR,
    cfmGoverningTR,
    governingTR: overallGoverningTR,
    requiredTR: overallGoverningTR * (1 + c.overallSafetyFactor),
    designCFM: equipmentDesignCFM,
    achGovernsAirflow: cfmGoverningTR >= loadGoverningTR,
  };
  const n = (v: number) => Math.round(v).toLocaleString();
  const f1 = (v: number) => v.toFixed(1);
  const freshAirCfmFromInput = (calculateRoomVolume(c.rd) * Math.max(0, Number(roomDraft.facph) || 0)) / 60;
  const governingDesignAirflowSeason = hasMonsoon && monsoonCalc.designCFM > c.designCFM ? 'Monsoon' : 'Summer';
  const governingDesignAirflow = hasMonsoon
    ? Math.max(c.designCFM, monsoonCalc.designCFM)
    : c.designCFM;
  const freshAirPctOnDesignCfm = governingDesignAirflow > 0 ? (freshAirCfmFromInput / governingDesignAirflow) * 100 : 0;
  const monsoonExtremeDscfmRatio = hasMonsoon && monsoonCalc.totalSupplyCFM > 0
    ? monsoonCalc.coil.dehumidifiedCFM / monsoonCalc.totalSupplyCFM
    : 0;
  const monsoonExtremeDscfm = hasMonsoon && monsoonExtremeDscfmRatio > 1.5;

  // Track if user has actively edited this room (to prevent draft clearing from parent updates)
  const [hasActiveEdits, setHasActiveEdits] = useState(false);

  useEffect(() => {
    roomDraftRef.current = roomDraft;
  }, [roomDraft]);

  useEffect(() => {
    // Only reset draft on parent update if there are no active edits
    if (!isRoomDirty && !hasActiveEdits) {
      setRoomDraft(committedRoomState);
      roomDraftRef.current = committedRoomState;
    }
  }, [committedRoomState, isRoomDirty, hasActiveEdits]);

  useEffect(() => {
    onDirtyChange?.(id, isRoomDirty);
    return () => {
      onDirtyChange?.(id, false);
    };
  }, [id, isRoomDirty, onDirtyChange]);

  // Publish draft whenever roomDraft changes (user has actively edited)
  useEffect(() => {
    if (hasActiveEdits) {
      onRoomDraftChange?.(zoneId, id, roomDraft, systemId);
    }
  }, [zoneId, id, systemId, roomDraft, hasActiveEdits, onRoomDraftChange]);

  // Only clear draft when explicitly cancelled or unmounting
  useEffect(() => {
    return () => {
      onRoomDraftChange?.(zoneId, id, null, systemId);
    };
  }, [zoneId, id, systemId, onRoomDraftChange]);

  useEffect(() => {
    if (!isRoomDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isRoomDirty]);

  const patchRoomDraft = (patch: Partial<RoomParameterState>) => {
    setHasActiveEdits(true);
    setRoomDraft((prev) => {
      const next = { ...prev, ...patch };
      const slabHeight = Math.max(0, Number(next.height) || 0);
      if ((Number(next.falseCeilingHeight) || 0) > slabHeight) {
        next.falseCeilingHeight = slabHeight;
      }
      roomDraftRef.current = next;
      return next;
    });
  };

  const handleNumericDraftChange = (field: keyof RoomParameterState, _draft: string, parsedValue?: number) => {
    if (parsedValue === undefined) return;
    patchRoomDraft({ [field]: parsedValue } as Partial<RoomParameterState>);
  };

  const handleCancelRoomParameters = () => {
    setHasActiveEdits(false);
    setRoomDraft(committedRoomState);
    roomDraftRef.current = committedRoomState;
  };

  const handleUpdateRoomParameters = async () => {
    flushDraftInputs();

    const nextDraft = roomDraftRef.current;
    if (areRoomParameterStatesEqual(nextDraft, committedRoomState)) return;

    setIsUpdating(true);
    try {
      await updateRoom(zoneId, id, nextDraft, systemId);
      setHasActiveEdits(false);
    } finally {
      setIsUpdating(false);
    }
  };

  const toggleSeasonPanel = (
    group: 'cooling' | 'moisture',
    season: 'summer' | 'monsoon',
  ) => {
    if (group === 'cooling') {
      setCoolingPanelsOpen((prev) => ({ ...prev, [season]: !prev[season] }));
      return;
    }
    setMoisturePanelsOpen((prev) => ({ ...prev, [season]: !prev[season] }));
  };

  const renderSeasonPanel = (
    group: 'cooling' | 'moisture',
    season: 'summer' | 'monsoon',
    title: string,
    content: React.ReactNode,
  ) => {
    const isOpen = group === 'cooling' ? coolingPanelsOpen[season] : moisturePanelsOpen[season];
    return (
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSeasonPanel(group, season)}
          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
        >
          <span className="text-sm font-semibold text-slate-800">{title}</span>
          {isOpen ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
        </button>
        {isOpen && <div className="border-t border-slate-100 p-4">{content}</div>}
      </div>
    );
  };

  const renderCoolingSection = (calc: any, seasonalDc: DesignConditions, title: string, accent: string) => (
    <div className={`rounded-xl border p-4 ${accent}`}>
      <h4 className="text-xs font-bold uppercase tracking-widest mb-2">{title}</h4>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-700">
              <TableHead className="text-xs py-2 text-white font-semibold">Component</TableHead>
              <TableHead className="text-xs py-2 text-white font-semibold text-right">Sensible (BTU/h)</TableHead>
              <TableHead className="text-xs py-2 text-white font-semibold text-right">Latent (BTU/h)</TableHead>
              <TableHead className="text-xs py-2 text-white font-semibold text-right">Total (BTU/h)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-amber-50">
              <TableCell className="text-xs py-1.5 font-semibold text-amber-800">1. Solar Heat Gain</TableCell>
              <TableCell className="text-xs py-1.5 text-right font-mono">{n(calc.envelope.breakdown.glassSolar)}</TableCell>
              <TableCell className="text-xs py-1.5 text-right text-gray-400">—</TableCell>
              <TableCell className="text-xs py-1.5 text-right font-mono font-semibold">{n(calc.envelope.breakdown.glassSolar)}</TableCell>
            </TableRow>
            <TableRow className="bg-orange-50">
              <TableCell className="text-xs py-1.5 font-semibold text-orange-800">2. Transmission Heat Gain</TableCell>
              <TableCell colSpan={3}></TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-xs py-1 pl-8 text-gray-600">Walls &amp; Partitions</TableCell>
              <TableCell className="text-xs py-1 text-right font-mono">{n(calc.envelope.breakdown.walls + calc.envelope.breakdown.partitions)}</TableCell>
              <TableCell className="text-xs py-1 text-right text-gray-400">—</TableCell>
              <TableCell className="text-xs py-1 text-right font-mono">{n(calc.envelope.breakdown.walls + calc.envelope.breakdown.partitions)}</TableCell>
            </TableRow>
            <TableRow className="bg-gray-50">
              <TableCell className="text-xs py-1 pl-8 text-gray-600">Roof &amp; Floor</TableCell>
              <TableCell className="text-xs py-1 text-right font-mono">{n(calc.envelope.breakdown.roof + calc.envelope.breakdown.floor)}</TableCell>
              <TableCell className="text-xs py-1 text-right text-gray-400">—</TableCell>
              <TableCell className="text-xs py-1 text-right font-mono">{n(calc.envelope.breakdown.roof + calc.envelope.breakdown.floor)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-xs py-1 pl-8 text-gray-600">Glass Transmission</TableCell>
              <TableCell className="text-xs py-1 text-right font-mono">{n(calc.envelope.breakdown.glassTransmission)}</TableCell>
              <TableCell className="text-xs py-1 text-right text-gray-400">—</TableCell>
              <TableCell className="text-xs py-1 text-right font-mono">{n(calc.envelope.breakdown.glassTransmission)}</TableCell>
            </TableRow>
            <TableRow className="bg-blue-50">
              <TableCell className="text-xs py-1.5 font-semibold text-blue-800">3. Internal Heat Gain</TableCell>
              <TableCell className="text-xs py-1.5 text-right font-mono">{n(calc.internal.sensible)}</TableCell>
              <TableCell className="text-xs py-1.5 text-right font-mono">{n(calc.internal.latent)}</TableCell>
              <TableCell className="text-xs py-1.5 text-right font-mono font-semibold">{n(calc.internal.sensible + calc.internal.latent)}</TableCell>
            </TableRow>
            <TableRow className="bg-green-50">
              <TableCell className="text-xs py-1.5 font-semibold text-green-800">4. Ventilation (BF: {BF})</TableCell>
              <TableCell className="text-xs py-1.5 text-right font-mono">{n(calc.vent.sensible * BF)}</TableCell>
              <TableCell className="text-xs py-1.5 text-right font-mono">{n(calc.vent.latent * BF)}</TableCell>
              <TableCell className="text-xs py-1.5 text-right font-mono font-semibold">{n((calc.vent.sensible + calc.vent.latent) * BF)}</TableCell>
            </TableRow>
            <TableRow className="bg-purple-50">
              <TableCell className="text-xs py-1.5 font-semibold text-purple-800">5. Parasitic Gains</TableCell>
              <TableCell colSpan={3}></TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-xs py-1 pl-8 text-gray-600">Duct Heat Gain ({calc.ductPct}%)</TableCell>
              <TableCell className="text-xs py-1 text-right font-mono">{n(calc.parasitic.ductGain)}</TableCell>
              <TableCell className="text-xs py-1 text-right text-gray-400">—</TableCell>
              <TableCell className="text-xs py-1 text-right font-mono">{n(calc.parasitic.ductGain)}</TableCell>
            </TableRow>
            <TableRow className="bg-gray-50">
              <TableCell className="text-xs py-1 pl-8 text-gray-600">Fan Heat Gain ({calc.fanPct}%)</TableCell>
              <TableCell className="text-xs py-1 text-right font-mono">{n(calc.parasitic.fanGain)}</TableCell>
              <TableCell className="text-xs py-1 text-right text-gray-400">—</TableCell>
              <TableCell className="text-xs py-1 text-right font-mono">{n(calc.parasitic.fanGain)}</TableCell>
            </TableRow>
            <TableRow className="bg-slate-100 border-t-2 border-slate-300">
              <TableCell className="text-xs py-2 font-bold text-slate-900">EFFECTIVE ROOM HEAT</TableCell>
              <TableCell className="text-xs py-2 text-right font-mono font-bold text-slate-900">{n(calc.ersh)}</TableCell>
              <TableCell className="text-xs py-2 text-right font-mono font-bold text-slate-900">{n(calc.erlh)}</TableCell>
              <TableCell className="text-xs py-2 text-right font-mono font-bold text-slate-900">{n(calc.erh)}</TableCell>
            </TableRow>
            <TableRow className="bg-red-50">
              <TableCell className="text-xs py-1.5 font-semibold text-red-700">Outside Air (1−BF)</TableCell>
              <TableCell className="text-xs py-1.5 text-right font-mono">{n(calc.oaSensible)}</TableCell>
              <TableCell className="text-xs py-1.5 text-right font-mono">{n(calc.oaLatent)}</TableCell>
              <TableCell className="text-xs py-1.5 text-right font-mono font-semibold">{n(calc.oaTotal)}</TableCell>
            </TableRow>
            <TableRow className="bg-orange-600 border-t-2 border-orange-700">
              <TableCell className="text-xs py-2 font-bold text-white">OVERALL TOTAL COOLING</TableCell>
              <TableCell className="text-xs py-2 text-right text-orange-200">—</TableCell>
              <TableCell className="text-xs py-2 text-right text-orange-200">—</TableCell>
              <TableCell className="text-xs py-2 text-right font-mono font-bold text-white">{n(calc.requiredTR * 12000)} BTU/h / {calc.requiredTR.toFixed(2)} TR</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">RSHF</p>
          <p className="text-sm font-bold text-slate-800">{f1(calc.rshf * 100)}%</p>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Supply Air CFM</p>
          <p className="text-sm font-bold text-slate-800">{Math.round(calc.designCFM)}</p>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Area</p>
          <p className="text-sm font-bold text-slate-800">{calc.rd.length * calc.rd.width} ft²</p>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/20 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-xs font-bold text-indigo-700 uppercase tracking-widest">{title} Psychrometric Review</h4>
          <button
            type="button"
            onClick={() => setPsychroChartsOpen((prev) => ({ ...prev, [title.toLowerCase().includes('monsoon') ? 'monsoon' : 'summer']: !prev[title.toLowerCase().includes('monsoon') ? 'monsoon' : 'summer'] }))}
            className="h-8 rounded-md border border-indigo-200 bg-white px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
            aria-expanded={title.toLowerCase().includes('monsoon') ? psychroChartsOpen.monsoon : psychroChartsOpen.summer}
          >
            {title.toLowerCase().includes('monsoon')
              ? (psychroChartsOpen.monsoon ? 'Hide Chart' : 'Show Chart')
              : (psychroChartsOpen.summer ? 'Hide Chart' : 'Show Chart')}
          </button>
        </div>
        {(title.toLowerCase().includes('monsoon') ? psychroChartsOpen.monsoon : psychroChartsOpen.summer) && (
          <PsychrometricChart
            width={800}
            height={320}
            altitude={seasonalDc.altitude ?? 0}
            showGuides
            showLegend
            points={[
              { id: 'outdoor', temp: seasonalDc.outdoorTemp, rh: seasonalDc.outdoorHumidity, label: 'Outdoor', color: '#ef4444' },
              { id: 'indoor', temp: seasonalDc.indoorTemp, rh: seasonalDc.indoorHumidity, label: 'Indoor', color: '#3b82f6' },
              { id: 'indicated-adp', temp: calc.coil.indicatedADP, rh: 100, label: 'Indicated ADP', color: '#a855f7' },
              { id: 'selected-adp', temp: calc.coil.selectedADP, rh: 100, label: 'Selected ADP', color: '#7c3aed' },
            ]}
            segments={[
              { fromId: 'outdoor', toId: 'indoor', color: '#64748b', dashed: true, label: 'OA to Room' },
              { fromId: 'indoor', toId: 'indicated-adp', color: '#a855f7', dashed: true, label: 'Room SHR' },
              { fromId: 'indicated-adp', toId: 'selected-adp', color: '#7c3aed', dashed: false, label: 'Selected Coil ADP' },
            ]}
          />
        )}
      </div>
    </div>
  );

  const renderMoistureSection = (calc: any, seasonalDc: DesignConditions, title: string) => (
    <div className="space-y-4 rounded-xl border border-emerald-100 bg-emerald-50/15 p-4">
      <h4 className="text-xs font-bold text-emerald-700 uppercase tracking-widest">{title} Moisture Control</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-red-100 bg-red-50/30 p-4">
          <h4 className="text-xs font-bold text-red-700 uppercase tracking-widest mb-2">Outdoor Conditions</h4>
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between"><dt className="text-gray-500">Dry Bulb Temp</dt><dd className="font-mono font-semibold">{seasonalDc.outdoorTemp} °F</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Relative Humidity</dt><dd className="font-mono font-semibold">{seasonalDc.outdoorHumidity} %</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Humidity Ratio (W)</dt><dd className="font-mono font-semibold">{(calc.outdoorPsych.humidityRatio * 7000).toFixed(1)} gr/lb</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Enthalpy (h)</dt><dd className="font-mono font-semibold">{calc.outdoorPsych.enthalpy.toFixed(1)} BTU/lb</dd></div>
          </dl>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50/30 p-4">
          <h4 className="text-xs font-bold text-blue-700 uppercase tracking-widest mb-2">Indoor Design Conditions</h4>
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between"><dt className="text-gray-500">Dry Bulb Temp</dt><dd className="font-mono font-semibold">{seasonalDc.indoorTemp} °F</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Relative Humidity</dt><dd className="font-mono font-semibold">{seasonalDc.indoorHumidity} %</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Humidity Ratio (W)</dt><dd className="font-mono font-semibold">{(calc.indoorPsych.humidityRatio * 7000).toFixed(1)} gr/lb</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Enthalpy (h)</dt><dd className="font-mono font-semibold">{calc.indoorPsych.enthalpy.toFixed(1)} BTU/lb</dd></div>
          </dl>
        </div>
      </div>
      <div className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-4">
        <h4 className="text-xs font-bold text-emerald-700 uppercase tracking-widest mb-3">Moisture Management</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Action Required', value: calc.moisture.action, color: calc.moisture.action === 'Dehumidify' ? 'text-amber-700' : 'text-emerald-700' },
            { label: 'Moisture Rate', value: `${calc.moisture.rate.toFixed(2)} lbs/hr`, color: 'text-gray-800' },
            { label: 'Latent Load', value: `${n(calc.moisture.loadBTU ?? 0)} BTU/h`, color: 'text-gray-800' },
            { label: 'ΔW (gr/lb)', value: `${((calc.outdoorPsych.humidityRatio - calc.indoorPsych.humidityRatio) * 7000).toFixed(1)}`, color: 'text-gray-800' },
          ].map(item => (
            <div key={item.label} className="bg-white border border-emerald-100 rounded-lg px-3 py-2 text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">{item.label}</p>
              <p className={`text-sm font-bold ${item.color}`}>{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const formatSavedAt = (value: any) => {
    if (!value) return 'Not saved yet';
    if (typeof value?.toDate === 'function') return value.toDate().toLocaleString();
    if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000).toLocaleString();
    const ts = Number(value);
    if (!Number.isNaN(ts) && ts > 0) return new Date(ts).toLocaleString();
    return 'Not saved yet';
  };

  const draftCommittersRef = useRef<Record<string, () => void>>({});
  const flushDraftInputs = () => {
    Object.values(draftCommittersRef.current).forEach(commit => commit());
  };
  const runAfterDraftSave = (action: () => void) => {
    flushDraftInputs();
    action();
  };

  return (
    <div className="bg-white border-t border-blue-100 px-4 py-5 space-y-5">

      <div className="sticky top-0 z-10 -mx-4 px-4 py-2.5 bg-white/95 backdrop-blur border-b border-slate-100">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold text-slate-900 truncate">{room?.name || 'Room'}</h4>
          <span
            className={`text-[11px] rounded border px-2 py-0.5 font-semibold ${
              equipmentBasis.governingSeason === 'Monsoon'
                ? 'border-teal-300 bg-teal-50 text-teal-700'
                : 'border-orange-300 bg-orange-50 text-orange-700'
            }`}
            title={hasMonsoon
              ? 'Season used for equipment sizing after load/CFM seasonal governance'
              : 'Monsoon is off, so Summer governs equipment sizing'}
          >
            AHU Season: {equipmentBasis.governingSeason}
          </span>
          <span className="text-[11px] rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700" title="Final governing metric for AHU sizing">
            Basis: {equipmentBasis.governingMetric}
          </span>
          {hasMonsoon && (
            <span className="text-[11px] rounded border border-slate-300 bg-slate-50 px-2 py-0.5 font-semibold text-slate-700" title="Separate seasonal governors for load and airflow">
              Load: {equipmentBasis.loadGoverningSeason} | CFM: {equipmentBasis.cfmGoverningSeason}
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] rounded border border-blue-200 bg-blue-50 px-2 py-0.5 font-semibold text-blue-700" title="Load-based TR (Grand Total / 12000)">
            Load TR: {c.grandTotalTR.toFixed(2)}
          </span>
          <span className="text-[11px] rounded border border-cyan-200 bg-cyan-50 px-2 py-0.5 font-semibold text-cyan-700" title="CFM-based TR (from Design Supply CFM)">
            CFM TR: {c.cfmTR.toFixed(2)}
          </span>
          <span className={`text-[11px] rounded border px-2 py-0.5 font-semibold ${equipmentBasis.governingMetric === 'CFM' ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-blue-300 bg-blue-100 text-blue-800'}`} title="Final governing TR = max(load-governor TR, airflow-governor TR)">
            Governing TR: {equipmentBasis.governingTR.toFixed(2)}
          </span>
          <span className="text-[11px] rounded border border-orange-200 bg-orange-50 px-2 py-0.5 font-semibold text-orange-700" title="Required TR with 10% safety factor">
            Req TR: {equipmentBasis.requiredTR.toFixed(2)}
          </span>
          <span className="text-[11px] rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
            Design CFM: {Math.round(equipmentBasis.designCFM)}
          </span>
          <span className="text-[11px] rounded border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">
            {n(c.grandTotal)} BTU/h
          </span>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          {saveState === 'saving' ? (
            <span className="inline-flex items-center gap-1 text-blue-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              Saving…
            </span>
          ) : saveState === 'saved' ? (
            <span className="text-emerald-600 font-medium">✓ Saved just now</span>
          ) : (
            <>Last analysis saved: <span className="font-medium text-slate-700">{formatSavedAt(room?.analysisUpdatedAt)}</span></>
          )}
        </p>

        <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2">
          {([
            ['inputs',   'Step 1: Inputs'],
            ['envelope', 'Step 2: Envelope'],
            ['cooling',  'Step 3: Cooling'],
            ['heating',  'Step 4: Heating'],
            ['moisture', 'Step 5: Moisture'],
          ] as const).map(([step, label]) => (
            <button
              key={step}
              type="button"
              onClick={() => runAfterDraftSave(() => setActiveStep(step))}
              className={`text-xs rounded-md px-2 py-1.5 border transition-colors ${
                activeStep === step
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Room Inputs ───────────────────────────────────────────── */}
      {activeStep === 'inputs' && (
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Room Parameters</h4>
        <p className="mb-3 text-[11px] font-medium text-slate-600">Step 1 inputs and dropdowns use live app-engine recalculation immediately. Database is updated only when you click Update.</p>
        {isRoomDirty && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-[11px] font-medium text-amber-800">Unsaved room parameter changes are affecting live calculations. Update or cancel before leaving this room.</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCancelRoomParameters}
                className="h-7 rounded-md border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleUpdateRoomParameters()}
                disabled={isUpdating}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-blue-300 bg-blue-600 px-2.5 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isUpdating && <Loader2 className="h-3 w-3 animate-spin" />}
                Update
              </button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          <Field label="Name">
            <Input value={roomDraft.name} onChange={e => patchRoomDraft({ name: e.target.value })} className="h-8 text-sm" />
          </Field>
          <Field label="Floor">
            <Input value={roomDraft.floor} onChange={e => patchRoomDraft({ floor: e.target.value })} className="h-8 text-sm" />
          </Field>
          <Field label="Length (ft)">
            <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-length`} value={roomDraft.length} onDraftChange={(draft, parsed) => handleNumericDraftChange('length', draft, parsed)} onCommit={next => patchRoomDraft({ length: next })} className="h-8 text-sm" title="Type =10m to convert 10 meters to feet, or =32.8 for feet" />
          </Field>
          <Field label="Width (ft)">
            <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-width`} value={roomDraft.width} onDraftChange={(draft, parsed) => handleNumericDraftChange('width', draft, parsed)} onCommit={next => patchRoomDraft({ width: next })} className="h-8 text-sm" title="Type =10m to convert 10 meters to feet, or =32.8 for feet" />
          </Field>
          <Field label="Height (ft)">
            <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-height`} value={roomDraft.height} onDraftChange={(draft, parsed) => handleNumericDraftChange('height', draft, parsed)} onCommit={next => patchRoomDraft({ height: next })} className="h-8 text-sm" title="Type =10m to convert 10 meters to feet, or =32.8 for feet" />
          </Field>
          <Field label={`Area: ${c.rd.length * c.rd.width} ft²`}>
            <div className="h-8 flex items-center text-sm font-semibold text-gray-700">
              Vol (effective): {Math.round(c.rd.length * c.rd.width * (c.rd.hasFalseCeiling ? (c.rd.falseCeilingHeight || c.rd.height) : c.rd.height))} ft³
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          <Field label="False Ceiling">
            <label className="h-8 inline-flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={!!roomDraft.hasFalseCeiling}
                onChange={e => patchRoomDraft({ hasFalseCeiling: e.target.checked })}
              />
              Use false ceiling height for calculations
            </label>
          </Field>
          <Field label="False Ceiling Height (ft)">
            <BufferedNumberInput
              committersRef={draftCommittersRef}
              draftKey={`${id}-false-ceiling-height`}
              disabled={!roomDraft.hasFalseCeiling}
              value={roomDraft.falseCeilingHeight}
              defaultValue={8}
              max={Math.max(0, Number(roomDraft.height) || 0)}
              onDraftChange={(draft, parsed) => handleNumericDraftChange('falseCeilingHeight', draft, parsed)}
              onCommit={next => patchRoomDraft({ falseCeilingHeight: next })}
              className="h-8 text-sm"
              title="Default is 8 ft. Must be less than or equal to slab height"
            />
            {roomDraft.hasFalseCeiling && (
              <p className="mt-1 text-[10px] text-slate-500">Must be {'<='} slab height ({Number(roomDraft.height) || 0} ft).</p>
            )}
          </Field>
          <Field label="Effective Height (ft)">
            <div className="h-8 flex items-center text-sm font-semibold text-gray-700">
              {roomDraft.hasFalseCeiling ? (roomDraft.falseCeilingHeight ?? c.rd.height) : c.rd.height}
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mt-3">
          <Field label="People">
            <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-people`} value={roomDraft.peopleCount} onDraftChange={(draft, parsed) => handleNumericDraftChange('peopleCount', draft, parsed)} onCommit={next => patchRoomDraft({ peopleCount: next })} className="h-8 text-sm" />
          </Field>
          <Field label="Occupancy Type">
            <Select
              value={roomDraft.activityType}
              onValueChange={v => {
                const nextActivity = v ?? 'office';
                patchRoomDraft({
                  activityType: nextActivity,
                  achProfile: nextActivity,
                });
              }}
            >
              <SelectTrigger className="h-8 text-xs min-w-max"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTIVITY_TYPES.map(a => (
                  <SelectItem key={a.id} value={a.id} className="text-xs">{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="ACH Preset">
            <Select
              value={roomDraft.achProfile}
              onValueChange={v => patchRoomDraft({ achProfile: v ?? roomDraft.activityType ?? 'office' })}
            >
              <SelectTrigger className="h-8 text-xs min-w-max"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTIVITY_ACH_RECOMMENDATIONS.map(a => (
                  <SelectItem key={a.id} value={a.id} className="text-xs">{a.label} ({a.ach} Total ACH)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Lights (W/ft²)">
            <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-lights`} value={roomDraft.lightsWattsPerSqft} onDraftChange={(draft, parsed) => handleNumericDraftChange('lightsWattsPerSqft', draft, parsed)} onCommit={next => patchRoomDraft({ lightsWattsPerSqft: next })} className="h-8 text-sm" />
          </Field>
          <Field label="Equipment (kW)">
            <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-equipment`} value={roomDraft.equipmentKW} onDraftChange={(draft, parsed) => handleNumericDraftChange('equipmentKW', draft, parsed)} onCommit={next => patchRoomDraft({ equipmentKW: next })} className="h-8 text-sm" />
          </Field>
          <Field label="Others (kW)">
            <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-others`} value={roomDraft.othersKW} onDraftChange={(draft, parsed) => handleNumericDraftChange('othersKW', draft, parsed)} onCommit={next => patchRoomDraft({ othersKW: next })} className="h-8 text-sm" />
          </Field>
          <Field label="OA FACPH">
            <div>
              <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-facph`} value={roomDraft.facph} onDraftChange={(draft, parsed) => handleNumericDraftChange('facph', draft, parsed)} onCommit={next => patchRoomDraft({ facph: next })} className="h-8 text-sm" />
              <p className="mt-1 text-[10px] text-slate-500">OA FACPH should be {'<='} Total ACH. Total supply ACH uses max(Preset ACH, OA FACPH).</p>
              <p className="mt-0.5 text-[10px] font-semibold text-cyan-700">
                Fresh Air on Governing Design Airflow ({governingDesignAirflowSeason}): {freshAirPctOnDesignCfm.toFixed(2)}% ({Math.round(freshAirCfmFromInput).toLocaleString()} / {Math.round(governingDesignAirflow).toLocaleString()} CFM)
              </p>
              {room._oaFacphMigrated && (
                <p className="mt-0.5 text-[10px] font-semibold text-blue-700">Auto-migrated OA FACPH from legacy default. Please review for project-specific compliance.</p>
              )}
              {(Number(roomDraft.facph) || 0) > c.presetTotalACH && (
                <p className="mt-0.5 text-[10px] font-semibold text-amber-700">OA FACPH is above preset total ACH. Effective total ACH is auto-raised to {(Number(roomDraft.facph) || 0).toFixed(1)}.</p>
              )}
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mt-3">
          <Field label="Sensible Safety (%)">
            <BufferedNumberInput 
              committersRef={draftCommittersRef} 
              draftKey={`${id}-sensible-safety`} 
              value={roomDraft.sensibleSafetyPercent} 
              defaultValue={10}
              onDraftChange={(draft, parsed) => handleNumericDraftChange('sensibleSafetyPercent', draft, parsed)}
              onCommit={next => patchRoomDraft({ sensibleSafetyPercent: next })} 
              className="h-8 text-sm" 
              title="Safety factor for sensible loads (default: 10%)"
            />
          </Field>
          <Field label="Latent Safety (%)">
            <BufferedNumberInput 
              committersRef={draftCommittersRef} 
              draftKey={`${id}-latent-safety`} 
              value={roomDraft.latentSafetyPercent} 
              defaultValue={5}
              onDraftChange={(draft, parsed) => handleNumericDraftChange('latentSafetyPercent', draft, parsed)}
              onCommit={next => patchRoomDraft({ latentSafetyPercent: next })} 
              className="h-8 text-sm" 
              title="Safety factor for latent loads (default: 5%)"
            />
          </Field>
          <Field label="Overall Safety (%)">
            <BufferedNumberInput 
              committersRef={draftCommittersRef} 
              draftKey={`${id}-overall-safety`} 
              value={roomDraft.overallSafetyPercent} 
              defaultValue={3}
              onDraftChange={(draft, parsed) => handleNumericDraftChange('overallSafetyPercent', draft, parsed)}
              onCommit={next => patchRoomDraft({ overallSafetyPercent: next })} 
              className="h-8 text-sm" 
              title="Safety factor for final TR (default: 3%)"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mt-3">
          <Field label={`OA CFM: ${Math.round(c.vent.cfm)}`}>
            <div className="grid grid-cols-2 gap-1">
              <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-duct-gain`} placeholder="Duct%" value={roomDraft.ductGainPct} defaultValue={2} onDraftChange={(draft, parsed) => handleNumericDraftChange('ductGainPct', draft, parsed)} onCommit={next => patchRoomDraft({ ductGainPct: next })} className="h-8 text-xs border rounded px-2 w-full" title="Duct Gain % (default: 2%)" />
              <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-fan-gain`} placeholder="Fan%" value={roomDraft.fanGainPct} defaultValue={3} onDraftChange={(draft, parsed) => handleNumericDraftChange('fanGainPct', draft, parsed)} onCommit={next => patchRoomDraft({ fanGainPct: next })} className="h-8 text-xs border rounded px-2 w-full" title="Fan Gain % (default: 3%)" />
            </div>
          </Field>
        </div>
      </div>
      )}

      {/* ── Envelope Elements ──────────────────────────────────────── */}
      {activeStep === 'envelope' && (() => {
        const dT = designConditions.outdoorTemp - designConditions.indoorTemp;
        const altFt = designConditions.altitude ?? 0;
        const designMonth = designConditions.designMonth ?? 7;
        const dailyRange = designConditions.dailyRange ?? 20;
        const cltdOpts = (el: any) => ({
          indoorTemp:  designConditions.indoorTemp,
          outdoorMax:  designConditions.outdoorTemp,
          dailyRange,
          color:       (el?.color ?? 'Dark') as WallColor,
          designMonth,
        });
        const wallEls      = elements.filter((el: any) => el.type === 'Wall' || el.type === 'Partition');
        const glassEls     = elements.filter((el: any) => el.type === 'Glass');
        const roofFloorEls = elements.filter((el: any) => el.type === 'Roof' || el.type === 'Floor');

        const liveCLTD = (el: any) => el.isOverride ? (el.solarFactor ?? 0) : getCLTD(el.orientation, el.type, dT, altFt, cltdOpts(el));
        const liveSHGF = (el: any) => el.isOverride ? (el.solarFactor ?? 0) : getSHGF(el.orientation, altFt);

        const wallGain = (el: any) => (el.uValue ?? 0) * (el.area ?? 0) * liveCLTD(el);
        const glassGain = (el: any) =>
          (el.uValue ?? 0) * (el.area ?? 0) * dT +
          (el.area ?? 0) * liveSHGF(el) * (el.shgc ?? 0.7);

        const WallRow = ({ el, elIdx }: { el: any; elIdx: number }) => {
          const elId = el?.id;
          const wt = WALL_TYPES.find(w => w.id === (el?.wallTypeId || 'w1'));
          return (
            <TableRow key={elId || elIdx} className={elIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <TableCell className="py-1.5">
                <Select value={el?.type || 'Wall'} onValueChange={v => updateEnvelopeElement(zoneId, id, elId, { type: v as ElementType, orientation: v === 'Partition' ? 'N' : (el?.orientation || 'S') }, systemId)}>
                  <SelectTrigger className="h-7 text-xs min-w-max"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(['Wall', 'Partition'] as ElementType[]).map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell className="py-1.5">
                <Select
                  value={el?.wallTypeId && WALL_TYPES.find(w => w.id === el.wallTypeId) ? el.wallTypeId : 'w1'}
                  onValueChange={v => {
                    const w = WALL_TYPES.find(wt => wt.id === v);
                    if (w) updateEnvelopeElement(zoneId, id, elId, { wallTypeId: v, uValue: w.uValue }, systemId);
                  }}
                >
                  <SelectTrigger className="h-7 text-xs min-w-max"><SelectValue /></SelectTrigger>
                  <SelectContent>{WALL_TYPES.map(w => <SelectItem key={w.id} value={w.id} className="text-xs">{w.name}</SelectItem>)}</SelectContent>
                </Select>
              </TableCell>
              <TableCell className="py-1.5">
                {el?.type === 'Partition' ? (
                  <div className="h-7 text-xs min-w-max rounded border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400">—</div>
                ) : (
                  <Select value={el?.orientation || 'S'} onValueChange={v => updateEnvelopeElement(zoneId, id, elId, { orientation: v as any }, systemId)}>
                    <SelectTrigger className="h-7 text-xs min-w-max"><SelectValue /></SelectTrigger>
                    <SelectContent>{VERTICAL_ORIENTATIONS.map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </TableCell>
              <TableCell className="py-1.5">
                {el?.type === 'Partition' ? (
                  <div className="h-7 text-xs min-w-max rounded border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400">—</div>
                ) : (
                  <Select value={el?.color || 'Dark'} onValueChange={v => updateEnvelopeElement(zoneId, id, elId, { color: v as WallColor }, systemId)}>
                    <SelectTrigger className="h-7 text-xs min-w-max"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(['Dark', 'Medium', 'Light'] as WallColor[]).map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </TableCell>
              <TableCell className="py-1.5 text-right">
                <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-${String(elId)}-wall-area`} value={el?.area ?? ''} onCommit={next => updateEnvelopeElement(zoneId, id, elId, { area: next }, systemId)} className="h-7 text-xs w-16 text-right" />
              </TableCell>
              <TableCell className="py-1.5 text-right">
                <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-${String(elId)}-wall-u`} value={el?.uValue ?? wt?.uValue ?? ''} onCommit={next => updateEnvelopeElement(zoneId, id, elId, { uValue: next }, systemId)} className="h-7 text-xs w-16 text-right" />
              </TableCell>
              <TableCell className="py-1.5 text-right">
                <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-${String(elId)}-wall-sf`} value={parseFloat(liveCLTD(el).toFixed(2))} onCommit={next => updateEnvelopeElement(zoneId, id, elId, { solarFactor: next, isOverride: true }, systemId)} className={`h-7 text-xs w-16 text-right ${el?.isOverride ? 'border-orange-400' : ''}`} title={el?.isOverride ? 'CLTD (°F) — Manual Override' : 'CLTD (°F) — Auto'} />
              </TableCell>
              <TableCell className="py-1.5 text-right text-xs font-mono font-semibold text-amber-800">{n(wallGain(el))}</TableCell>
              <TableCell className="py-1.5">
                <button type="button" title="Delete element" onClick={() => runAfterDraftSave(() => deleteEnvelopeElement(zoneId, id, elId, systemId))} className="p-1 text-gray-300 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </TableCell>
            </TableRow>
          );
        };

        const GlassRow = ({ el, elIdx }: { el: any; elIdx: number }) => {
          const elId = el?.id;
          const gt = GLASS_TYPES.find(g => g.id === (el?.wallTypeId || 'g2'));
          return (
            <TableRow key={elId || elIdx} className={elIdx % 2 === 0 ? 'bg-white' : 'bg-sky-50/40'}>
              <TableCell className="py-1.5">
                <Select
                  value={el?.wallTypeId && GLASS_TYPES.find(g => g.id === el.wallTypeId) ? el.wallTypeId : 'g2'}
                  onValueChange={v => {
                    const g = GLASS_TYPES.find(gt => gt.id === v);
                    if (g) updateEnvelopeElement(zoneId, id, elId, { wallTypeId: v, uValue: g.uValue, shgc: g.defaultShgc ?? el?.shgc ?? 0.7 }, systemId);
                  }}
                >
                  <SelectTrigger className="h-7 text-xs min-w-max"><SelectValue /></SelectTrigger>
                  <SelectContent>{GLASS_TYPES.map(g => <SelectItem key={g.id} value={g.id} className="text-xs">{g.name}</SelectItem>)}</SelectContent>
                </Select>
              </TableCell>
              <TableCell className="py-1.5">
                <Select value={el?.orientation || 'S'} onValueChange={v => updateEnvelopeElement(zoneId, id, elId, { orientation: v as any }, systemId)}>
                  <SelectTrigger className="h-7 text-xs min-w-max"><SelectValue /></SelectTrigger>
                  <SelectContent>{VERTICAL_ORIENTATIONS.map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}</SelectContent>
                </Select>
              </TableCell>
              <TableCell className="py-1.5 text-right">
                <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-${String(elId)}-glass-area`} value={el?.area ?? ''} onCommit={next => updateEnvelopeElement(zoneId, id, elId, { area: next }, systemId)} className="h-7 text-xs w-16 text-right" />
              </TableCell>
              <TableCell className="py-1.5 text-right">
                <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-${String(elId)}-glass-u`} value={el?.uValue ?? gt?.uValue ?? ''} onCommit={next => updateEnvelopeElement(zoneId, id, elId, { uValue: next }, systemId)} className="h-7 text-xs w-14 text-right" title="U-Value (BTU/h·ft²·°F)" />
              </TableCell>
              <TableCell className="py-1.5 text-right">
                <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-${String(elId)}-glass-shgc`} value={el?.shgc ?? gt?.defaultShgc ?? 0.7} onCommit={next => updateEnvelopeElement(zoneId, id, elId, { shgc: next, isOverride: true }, systemId)} min={0} max={1} className="h-7 text-xs w-14 text-right" title="Solar Heat Gain Coefficient" />
              </TableCell>
              <TableCell className="py-1.5 text-right">
                <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-${String(elId)}-glass-sf`} value={parseFloat(liveSHGF(el).toFixed(2))} onCommit={next => updateEnvelopeElement(zoneId, id, elId, { solarFactor: next, isOverride: true }, systemId)} className={`h-7 text-xs w-16 text-right ${el?.isOverride ? 'border-orange-400' : ''}`} title={el?.isOverride ? 'SHGF (BTU/h·ft²) — Manual Override' : 'SHGF (BTU/h·ft²) — Auto'} />
              </TableCell>
              <TableCell className="py-1.5 text-right text-xs font-mono font-semibold text-sky-800">{n(glassGain(el))}</TableCell>
              <TableCell className="py-1.5">
                <button type="button" title="Delete element" onClick={() => runAfterDraftSave(() => deleteEnvelopeElement(zoneId, id, elId, systemId))} className="p-1 text-gray-300 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </TableCell>
            </TableRow>
          );
        };

        return (
          <div className="space-y-4">
            {/* ── Side-by-side: Walls & Partitions | Glass ── */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

              {/* Walls & Partitions Card */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/30 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold text-amber-800 uppercase tracking-widest">Walls &amp; Partitions</h4>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => runAfterDraftSave(() => addEnvelopeElement(zoneId, id, 'Wall', systemId))}
                      className="flex items-center gap-0.5 text-[11px] px-2 py-1 rounded border border-amber-300 hover:bg-amber-100 text-amber-700 font-medium">
                      <Plus className="w-3 h-3" />Wall
                    </button>
                    <button type="button" onClick={() => runAfterDraftSave(() => addEnvelopeElement(zoneId, id, 'Partition', systemId))}
                      className="flex items-center gap-0.5 text-[11px] px-2 py-1 rounded border border-amber-300 hover:bg-amber-100 text-amber-700 font-medium">
                      <Plus className="w-3 h-3" />Partition
                    </button>
                  </div>
                </div>
                {wallEls.length === 0 ? (
                  <div className="text-center py-6 border border-dashed border-amber-200 rounded-lg text-xs text-amber-400">
                    No walls or partitions — click Add above.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-amber-600">
                          <TableHead className="text-xs py-2 text-white font-semibold">Type</TableHead>
                          <TableHead className="text-xs py-2 text-white font-semibold">Wall Type</TableHead>
                          <TableHead className="text-xs py-2 text-white font-semibold">Dir</TableHead>
                          <TableHead className="text-xs py-2 text-white font-semibold">Color</TableHead>
                          <TableHead className="text-xs py-2 text-white font-semibold text-right">Area (ft²)</TableHead>
                          <TableHead className="text-xs py-2 text-white font-semibold text-right">U-Val</TableHead>
                          <TableHead className="text-xs py-2 text-white font-semibold text-right">CLTD</TableHead>
                          <TableHead className="text-xs py-2 text-white font-semibold text-right">Gain</TableHead>
                          <TableHead className="w-7"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {wallEls.map((el: any, idx: number) => <WallRow key={el?.id || idx} el={el} elIdx={idx} />)}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {/* Glass Card */}
              <div className="rounded-xl border border-sky-200 bg-sky-50/30 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold text-sky-800 uppercase tracking-widest">Glass / Fenestration</h4>
                  <button type="button" onClick={() => runAfterDraftSave(() => addEnvelopeElement(zoneId, id, 'Glass', systemId))}
                    className="flex items-center gap-0.5 text-[11px] px-2 py-1 rounded border border-sky-300 hover:bg-sky-100 text-sky-700 font-medium">
                    <Plus className="w-3 h-3" />Glass
                  </button>
                </div>
                {glassEls.length === 0 ? (
                  <div className="text-center py-6 border border-dashed border-sky-200 rounded-lg text-xs text-sky-400">
                    No glass elements — click Add above.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-sky-600">
                          <TableHead className="text-xs py-2 text-white font-semibold">Glass Type</TableHead>
                          <TableHead className="text-xs py-2 text-white font-semibold">Dir</TableHead>
                          <TableHead className="text-xs py-2 text-white font-semibold text-right">Area (ft²)</TableHead>
                          <TableHead className="text-xs py-2 text-white font-semibold text-right">U-Val</TableHead>
                          <TableHead className="text-xs py-2 text-white font-semibold text-right">SHGC</TableHead>
                          <TableHead className="text-xs py-2 text-white font-semibold text-right">SHGF</TableHead>
                          <TableHead className="text-xs py-2 text-white font-semibold text-right">Gain</TableHead>
                          <TableHead className="w-7"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {glassEls.map((el: any, idx: number) => <GlassRow key={el?.id || idx} el={el} elIdx={idx} />)}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>

            {/* ── Roof & Floor ── */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/30 p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest">Roof &amp; Floor</h4>
                <div className="flex gap-1">
                  <button type="button" onClick={() => runAfterDraftSave(() => addEnvelopeElement(zoneId, id, 'Roof', systemId))}
                    className="flex items-center gap-0.5 text-[11px] px-2 py-1 rounded border border-slate-300 hover:bg-slate-100 text-slate-600 font-medium">
                    <Plus className="w-3 h-3" />Roof
                  </button>
                  <button type="button" onClick={() => runAfterDraftSave(() => addEnvelopeElement(zoneId, id, 'Floor', systemId))}
                    className="flex items-center gap-0.5 text-[11px] px-2 py-1 rounded border border-slate-300 hover:bg-slate-100 text-slate-600 font-medium">
                    <Plus className="w-3 h-3" />Floor
                  </button>
                </div>
              </div>
              {roofFloorEls.length === 0 ? (
                <div className="text-center py-4 border border-dashed border-slate-200 rounded-lg text-xs text-slate-400">
                  No roof or floor elements added.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-600">
                        <TableHead className="text-xs py-2 text-white font-semibold">Type</TableHead>
                        <TableHead className="text-xs py-2 text-white font-semibold">Dir</TableHead>
                        <TableHead className="text-xs py-2 text-white font-semibold">Color</TableHead>
                        <TableHead className="text-xs py-2 text-white font-semibold text-right">Area (ft²)</TableHead>
                        <TableHead className="text-xs py-2 text-white font-semibold text-right">U-Value</TableHead>
                        <TableHead className="text-xs py-2 text-white font-semibold text-right">CLTD</TableHead>
                        <TableHead className="text-xs py-2 text-white font-semibold text-right">Gain (BTU/h)</TableHead>
                        <TableHead className="w-7"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {roofFloorEls.map((el: any, elIdx: number) => {
                        const elId = el?.id;
                        return (
                          <TableRow key={elId || elIdx} className={elIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <TableCell className="py-1.5">
                              <Select value={el?.type || 'Roof'} onValueChange={v => updateEnvelopeElement(zoneId, id, elId, { type: v as ElementType }, systemId)}>
                                <SelectTrigger className="h-7 text-xs w-20"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {(['Roof', 'Floor'] as ElementType[]).map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Select value={el?.orientation || 'H'} onValueChange={v => updateEnvelopeElement(zoneId, id, elId, { orientation: v as any }, systemId)}>
                                <SelectTrigger className="h-7 text-xs w-16"><SelectValue /></SelectTrigger>
                                <SelectContent>{HORIZONTAL_ORIENTATIONS.map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}</SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="py-1.5">
                              {el?.type === 'Floor' ? (
                                <div className="h-7 text-xs w-20 rounded border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400">—</div>
                              ) : (
                                <Select value={el?.color || 'Dark'} onValueChange={v => updateEnvelopeElement(zoneId, id, elId, { color: v as WallColor }, systemId)}>
                                  <SelectTrigger className="h-7 text-xs w-20"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {(['Dark', 'Medium', 'Light'] as WallColor[]).map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              )}
                            </TableCell>
                            <TableCell className="py-1.5 text-right">
                              <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-${String(elId)}-roof-area`} value={el?.area ?? ''} onCommit={next => updateEnvelopeElement(zoneId, id, elId, { area: next }, systemId)} className="h-7 text-xs w-16 text-right" />
                            </TableCell>
                            <TableCell className="py-1.5 text-right">
                              <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-${String(elId)}-roof-u`} value={el?.uValue ?? ''} onCommit={next => updateEnvelopeElement(zoneId, id, elId, { uValue: next }, systemId)} className="h-7 text-xs w-16 text-right" />
                            </TableCell>
                            <TableCell className="py-1.5 text-right">
                              <BufferedNumberInput committersRef={draftCommittersRef} draftKey={`${id}-${String(elId)}-roof-sf`} value={parseFloat(liveCLTD(el).toFixed(2))} onCommit={next => updateEnvelopeElement(zoneId, id, elId, { solarFactor: next, isOverride: true }, systemId)} className={`h-7 text-xs w-16 text-right ${el?.isOverride ? 'border-orange-400' : ''}`} title={el?.isOverride ? 'CLTD (°F) — Manual Override' : 'CLTD (°F) — Auto'} />
                            </TableCell>
                            <TableCell className="py-1.5 text-right text-xs font-mono font-semibold text-slate-700">{n(wallGain(el))}</TableCell>
                            <TableCell className="py-1.5">
                              <button type="button" title="Delete element" onClick={() => runAfterDraftSave(() => deleteEnvelopeElement(zoneId, id, elId, systemId))} className="p-1 text-gray-300 hover:text-red-500">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Load Breakdown ─────────────────────────────────────────── */}
      {activeStep === 'cooling' && (
      <div className="space-y-4">
        {renderSeasonPanel(
          'cooling',
          'summer',
          'Summer Cooling Analysis',
          renderCoolingSection(c, designConditions, 'Summer Cooling Load Breakdown', 'border-slate-200 bg-white'),
        )}
        {hasMonsoon && renderSeasonPanel(
          'cooling',
          'monsoon',
          'Monsoon Cooling Analysis',
          renderCoolingSection(monsoonCalc, monsoonDc, 'Monsoon Cooling Load Breakdown', 'border-teal-200 bg-teal-50/20'),
        )}

        {/* Add Equipment for this room */}
        {project?.id && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => setEquipmentPickerOpen(true)}
              className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md font-medium transition-colors shadow-sm"
            >
              <PackagePlus className="w-3.5 h-3.5" />
              Add Equipment to This Room
            </button>
          </div>
        )}
      </div>
      )}

      {/* Equipment Picker Dialog for this room */}
      {project?.id && (
        <EquipmentPickerDialog
          open={equipmentPickerOpen}
          onClose={() => setEquipmentPickerOpen(false)}
          projectId={project.id}
          roomId={room.id}
          roomName={room.name}
          requiredTR={equipmentBasis.requiredTR}
          loadTR={equipmentBasis.loadGoverningTR}
          cfmTR={equipmentBasis.cfmGoverningTR}
          governingTR={equipmentBasis.governingTR}
          designCFM={equipmentBasis.designCFM}
          achGovernsAirflow={equipmentBasis.achGovernsAirflow}
        />
      )}

      {/* ── Heating Load ───────────────────────────────────────────── */}
      {activeStep === 'heating' && (
      <div className="rounded-xl border border-blue-100 bg-blue-50/30 p-4">
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Heating Load (Winter)</h4>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <Table>
            <TableHeader>
              <TableRow className="bg-blue-700">
                <TableHead className="text-xs py-2 text-white font-semibold">Component</TableHead>
                <TableHead className="text-xs py-2 text-white font-semibold text-right">Sensible (BTU/h)</TableHead>
                <TableHead className="text-xs py-2 text-white font-semibold text-right">Total (BTU/h)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="text-xs py-1.5 text-gray-700">Transmission Loss (U × A × ΔT)</TableCell>
                <TableCell className="text-xs py-1.5 text-right font-mono">{n(c.heating.transmissionLoss)}</TableCell>
                <TableCell className="text-xs py-1.5 text-right font-mono">{n(c.heating.transmissionLoss)}</TableCell>
              </TableRow>
              <TableRow className="bg-gray-50">
                <TableCell className="text-xs py-1.5 text-gray-700">Ventilation Heating (1.08 × CFM × ΔT)</TableCell>
                <TableCell className="text-xs py-1.5 text-right font-mono">{n(c.heating.ventilationHeating)}</TableCell>
                <TableCell className="text-xs py-1.5 text-right font-mono">{n(c.heating.ventilationHeating)}</TableCell>
              </TableRow>
              <TableRow className="bg-blue-700">
                <TableCell className="text-xs py-2 font-bold text-white">TOTAL HEATING LOAD</TableCell>
                <TableCell className="text-xs py-2 text-right text-blue-200">—</TableCell>
                <TableCell className="text-xs py-2 text-right font-mono font-bold text-white">{n(c.heating.totalHeatingLoad)} BTU/h</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>
      )}

      {/* ── Moisture & Psychrometrics ─────────────────────────────── */}
      {activeStep === 'moisture' && (
      <div className="space-y-4">
        {renderSeasonPanel(
          'moisture',
          'summer',
          'Summer Moisture Analysis',
          renderMoistureSection(c, designConditions, 'Summer'),
        )}
        {hasMonsoon && renderSeasonPanel(
          'moisture',
          'monsoon',
          'Monsoon Moisture Analysis',
          renderMoistureSection(monsoonCalc, monsoonDc, 'Monsoon'),
        )}

        {/* Coil & reheat analysis */}
        <div className="rounded-xl border border-purple-100 bg-purple-50/30 p-4">
          <h4 className="text-xs font-bold text-purple-700 uppercase tracking-widest mb-3">Coil &amp; Reheat Analysis</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {[
              { label: 'Room SHR',        value: `${f1(c.rshf * 100)} %` },
              { label: 'Reheat Required', value: c.reheat.needed ? 'Yes' : 'No' },
              { label: 'Reheat Load',     value: c.reheat.needed ? `${n(c.reheat.reheatBTU)} BTU/h` : '—' },
              { label: 'OA CFM (from FACPH)', value: `${Math.round(c.vent.cfm)}` },
              { label: 'Preset Total ACH', value: `${c.presetTotalACH.toFixed(1)}` },
              { label: 'Effective Total ACH', value: `${c.totalSupplyACH.toFixed(1)}` },
              { label: 'Total Supply CFM (ACH)', value: `${Math.round(c.totalSupplyCFM)}` },
              { label: 'Indicated ADP',   value: `${c.coil.indicatedADP.toFixed(1)} °F` },
              { label: 'Selected ADP',    value: `${c.coil.selectedADP.toFixed(0)} °F` },
              { label: 'Psychrometric CFM (DSCFM)',value: `${Math.round(c.coil.dehumidifiedCFM)}` },
              { label: 'Bypass Factor',   value: `${(c.coil.bypassFactor * 100).toFixed(0)} %` },
              { label: 'Design Supply CFM', value: `${Math.round(c.designCFM)}${c.achGovernsAirflow ? ' ⚠ ACH' : ''}` },
            ].map(item => (
              <div key={item.label} className="bg-white border border-purple-100 rounded-lg px-3 py-2 text-center">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">{item.label}</p>
                <p className={`text-sm font-bold ${item.label === 'Design Supply CFM' && c.achGovernsAirflow ? 'text-amber-700' : 'text-purple-800'}`}>{item.value}</p>
              </div>
            ))}
          </div>
          {c.achGovernsAirflow && (
            <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
              <span className="font-bold shrink-0">⚠ Total ACH Governs Airflow:</span>
              <span>Total supply-air requirement from ACH preset ({Math.round(c.totalSupplyCFM)} CFM) exceeds psychrometric DSCFM ({Math.round(c.coil.dehumidifiedCFM)} CFM). AHU must be sized for <strong>{Math.round(c.designCFM)} CFM</strong> supply air. OA contribution remains {Math.round(c.vent.cfm)} CFM from selected FACPH.</span>
            </div>
          )}
          {monsoonExtremeDscfm && (
            <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
              <span className="font-bold shrink-0">⚠ Monsoon High Moisture Flag:</span>
              <span>Monsoon psychrometric DSCFM ({Math.round(monsoonCalc.coil.dehumidifiedCFM)} CFM) is {(monsoonExtremeDscfmRatio).toFixed(2)}x of ACH airflow ({Math.round(monsoonCalc.totalSupplyCFM)} CFM). Consider humidity-control strategy review (DOAS/pre-dehumidification/ADP-RH assumptions).</span>
            </div>
          )}
        </div>
      </div>
      )}

      <div className="flex justify-between pt-1">
        <button
          type="button"
          onClick={() => {
            runAfterDraftSave(() => {
              if (activeStep === 'moisture') setActiveStep('heating');
              else if (activeStep === 'heating') setActiveStep('cooling');
              else if (activeStep === 'cooling') setActiveStep('envelope');
              else if (activeStep === 'envelope') setActiveStep('inputs');
            });
          }}
          disabled={activeStep === 'inputs'}
          className="text-xs rounded-md border border-slate-200 px-3 py-1.5 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
        >
          Previous Step
        </button>
        <button
          type="button"
          onClick={() => {
            runAfterDraftSave(() => {
              if (activeStep === 'inputs') setActiveStep('envelope');
              else if (activeStep === 'envelope') setActiveStep('cooling');
              else if (activeStep === 'cooling') setActiveStep('heating');
              else if (activeStep === 'heating') setActiveStep('moisture');
            });
          }}
          disabled={activeStep === 'moisture'}
          className="text-xs rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-100"
        >
          Next Step
        </button>
      </div>

    </div>
  );
}

function calculateRoomStripMetrics(room: any, elements: any[], dc: DesignConditions, project?: any) {
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

  const typedElements = (elements || []) as EnvelopeElement[];
  const envelope = calculateEnvelopeGain(typedElements, dc);
  const internal = calculateInternalGains(rd);
  const vent = calculateVentilationLoad(rd, dc);

  const erSensible = envelope.sensible + internal.sensible + vent.sensible * BF;
  const erLatent = internal.latent + vent.latent * BF;
  const ductPct = Number(room.ductGainPct) || 2;
  const fanPct = Number(room.fanGainPct) || 3;
  const parasitic = calculateParasiticGains(erSensible, erSensible, ductPct, fanPct);

  const ersh = erSensible + parasitic.ductGain + parasitic.fanGain;
  const erlh = erLatent;
  const oaSensible = vent.sensible * (1 - BF);
  const oaLatent = vent.latent * (1 - BF);
  const coilSensible = ersh + oaSensible;
  const coilLatent = erlh + oaLatent;
  const grandTotal = coilSensible + coilLatent;

  const isChiller = String(project?.systemType || '').toLowerCase().includes('chiller');
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

  return {
    totalBTU: grandTotal,
    totalTR: grandTotal / 12000,
    designSupplyCFM: Math.max(
      coil.dehumidifiedCFM,
      (calculateRoomVolume(rd) * Math.max(getRecommendedAch(room.achProfile ?? room.activityType), rd.facph)) / 60,
    ),
  };
}

function DraggableRoomHeader({
  id,
  isExpanded,
  onToggle,
  room,
  elementCount,
  metrics,
  onDelete,
}: {
  id: string;
  isExpanded: boolean;
  onToggle: () => void;
  room: any;
  elementCount: number;
  metrics: { totalBTU: number; totalTR: number; designSupplyCFM: number };
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });

  const area = (Number(room?.length) || 0) * (Number(room?.width) || 0);

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none transition-colors border-l-2 ${
        isExpanded ? 'bg-blue-50 border-l-blue-500' : 'hover:bg-gray-50 border-l-transparent'
      } ${isDragging ? 'opacity-70' : ''}`}
      onClick={onToggle}
    >
      <span
        className="text-gray-400 flex-shrink-0 cursor-grab active:cursor-grabbing"
        title="Drag room to another zone"
        {...listeners}
        {...attributes}
        onClick={e => e.stopPropagation()}
      >
        <Grip className="w-4 h-4" />
      </span>
      <span className="text-gray-400 flex-shrink-0">
        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </span>
      <span className="font-medium text-sm text-gray-900 flex-1 min-w-0 truncate">{room?.name ?? 'Room'}</span>
      <span className="text-xs text-gray-400 hidden sm:inline">{room?.floor ?? ''}</span>
      <span className="text-xs text-gray-400 hidden md:inline">{room?.length ?? 0}×{room?.width ?? 0}×{room?.height ?? 0} ft</span>
      {area > 0 && <span className="text-xs text-gray-400 hidden md:inline">{area} ft²</span>}

      <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5">
        {metrics.totalTR.toFixed(2)} TR
      </span>
      <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">
        {Math.round(metrics.totalBTU).toLocaleString()} BTU/h
      </span>
      <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-1.5 py-0.5">
        {Math.round(metrics.designSupplyCFM)} Design CFM
      </span>

      <span className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 flex-shrink-0">
        {elementCount} element{elementCount !== 1 ? 's' : ''}
      </span>
      <button
        type="button"
        title="Delete room"
        className="p-1 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
        onClick={e => { e.stopPropagation(); onDelete(); }}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

const MemoDraggableRoomHeader = memo(DraggableRoomHeader, (prev, next) => {
  return (
    prev.id === next.id &&
    prev.isExpanded === next.isExpanded &&
    prev.elementCount === next.elementCount &&
    prev.metrics.totalBTU === next.metrics.totalBTU &&
    prev.metrics.totalTR === next.metrics.totalTR &&
    prev.metrics.designSupplyCFM === next.metrics.designSupplyCFM &&
    prev.room?.name === next.room?.name &&
    prev.room?.floor === next.room?.floor &&
    prev.room?.length === next.room?.length &&
    prev.room?.width === next.room?.width &&
    prev.room?.height === next.room?.height
  );
});

// ─── Main RoomTable component ─────────────────────────────────────────────────

export default function RoomTable({
  rooms, liveRooms, zoneId, systemId, expandedRoom, setExpandedRoom,
  updateRoom, deleteRoom, addEnvelopeElement, updateEnvelopeElement,
  deleteEnvelopeElement, envelopeElements, project, designConditions, roomSaveStates, onRoomDraftChange,
}: RoomTableProps) {
  const [dirtyRoomId, setDirtyRoomId] = useState<string | null>(null);

  // Build design conditions from project if not passed explicitly
  const dc: DesignConditions = designConditions ?? {
    outdoorTemp: project?.summerDesignTemp ?? project?.data?.summerDesignTemp ?? 95,
    indoorTemp: project?.insideSummerTemp ?? project?.data?.insideSummerTemp ?? 75,
    outdoorHumidity: project?.summerDesignHumidity ?? project?.data?.summerDesignHumidity ?? 50,
    indoorHumidity: project?.insideSummerHumidity ?? project?.data?.insideSummerHumidity ?? 50,
    altitude: project?.altitude ?? project?.data?.altitude ?? 0,
    latitude: project?.latitude ?? project?.data?.latitude,
    longitude: project?.longitude ?? project?.data?.longitude,
    winterOutdoorTemp: project?.winterDesignTemp ?? project?.data?.winterDesignTemp ?? 40,
    winterOutdoorHumidity: project?.winterDesignHumidity ?? project?.data?.winterDesignHumidity ?? 30,
  };

  const sortedRooms = useMemo(
    () => [...(rooms || [])].sort((a, b) =>
      String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { numeric: true, sensitivity: 'base' })
    ),
    [rooms]
  );

  const liveRoomMap = useMemo(
    () => new Map((liveRooms || rooms || []).map((room) => [room?.id, room])),
    [liveRooms, rooms],
  );

  const roomSummaries = useMemo(
    () => sortedRooms.map((room, idx) => {
      const id = room?.id;
      const summaryRoom = (id ? liveRoomMap.get(id) : null) ?? room;
      const elements: any[] = id ? (envelopeElements?.[id] || []) : [];
      // Always compute live metrics so Room strip stays in sync with Zone/Project totals.
      const metrics = calculateRoomStripMetrics(summaryRoom, elements, dc, project);

      return {
        idx,
        id,
        room,
        elements,
        elementCount: elements.length,
        metrics,
      };
    }),
    [sortedRooms, liveRoomMap, envelopeElements, dc, project]
  );

  if (!sortedRooms.length) {
    return (
      <div className="px-4 py-6 text-center text-sm text-gray-400">
        No rooms yet — click "Add Room" to add one.
      </div>
    );
  }

  const blockDirtyRoomNavigation = () => {
    if (!dirtyRoomId) return false;
    toast.error('Update or cancel the room parameter changes before leaving this room.');
    return true;
  };

  const handleExpandedRoomChange = (nextRoomId: string | null) => {
    if (dirtyRoomId && dirtyRoomId !== nextRoomId) {
      blockDirtyRoomNavigation();
      return;
    }
    if (dirtyRoomId && nextRoomId === null) {
      blockDirtyRoomNavigation();
      return;
    }
    setExpandedRoom(nextRoomId);
  };

  const handleDeleteRoom = (roomId: string) => {
    if (blockDirtyRoomNavigation()) return;
    deleteRoom(zoneId, roomId, systemId);
  };

  return (
    <div className="divide-y divide-gray-100">
      {roomSummaries.map(({ idx, id, room, elements, elementCount, metrics }) => {
        const isExpanded = expandedRoom === id;

        return (
          <div key={id || idx}>
            {/* Room header */}
            {id && (
              <MemoDraggableRoomHeader
                id={id}
                room={room}
                elementCount={elementCount}
                metrics={metrics}
                isExpanded={isExpanded}
                onToggle={() => handleExpandedRoomChange(isExpanded ? null : id)}
                onDelete={() => handleDeleteRoom(id)}
              />
            )}

            {/* Room detail */}
            {isExpanded && id && (
              <RoomDetail
                room={room}
                zoneId={zoneId}
                systemId={systemId}
                elements={elements}
                designConditions={dc}
                project={project}
                saveState={roomSaveStates?.[id] ?? 'idle'}
                updateRoom={updateRoom}
                addEnvelopeElement={addEnvelopeElement}
                updateEnvelopeElement={updateEnvelopeElement}
                deleteEnvelopeElement={deleteEnvelopeElement}
                onRoomDraftChange={onRoomDraftChange}
                onDirtyChange={(roomId, isDirty) => {
                  setDirtyRoomId((prev) => {
                    if (isDirty) return roomId;
                    return prev === roomId ? null : prev;
                  });
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
