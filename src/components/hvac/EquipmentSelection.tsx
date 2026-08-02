import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db, auth, storage, handleFirestoreError, OperationType } from '../../lib/firebase';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import {
  collection, addDoc, onSnapshot, doc, getDoc, getDocs, updateDoc, deleteDoc, setDoc,
  serverTimestamp, arrayUnion, arrayRemove, deleteField, query, where, orderBy,
  writeBatch, limit,
} from 'firebase/firestore';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { NumericInput } from '../ui/numeric-input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '../ui/select';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import {
  EQUIPMENT_CATALOG, IDU_SUBTYPE_LABELS,
} from '../../constants/equipment-catalog';
import type { EquipmentModel } from '../../constants/equipment-catalog';
import GlobalEquipmentLibrary from './GlobalEquipmentLibrary';
import { getLibraryItemsByType, GLOBAL_LIB_COLLECTION } from '../../services/equipmentLibraryService';
import { ComboboxInput } from '../ui/combobox-input';
import { calculateCoilParameters, calculatePsychrometrics, dewPointFromHumidityRatio, EZ_OPTIONS, calcZoneVentilation, calcSystemVentilation62, getMinAdp, resolveRoomTfa } from '../../lib/hvac';
import { calculateRoomVolume } from '../../lib/hvac/geometry';
import SpecSheet from './SpecSheet';
import type {
  EquipmentSystem, IDUSelection, ODUSelection, ODUCombinationUnit, SingleUnitSelection, SystemType, EquipmentZone, AHUConfig,
} from '../../types/equipment-systems';
import { getZoneUnits } from '../../types/equipment-systems';
import {
  Plus, Trash2, Package, FileText, Search, Lock, Unlock, Box, Check, LayoutGrid,
  AlertTriangle, CheckCircle2, Wind, Zap, Droplets, ExternalLink, Upload,
  ChevronRight, ChevronDown, Info, BookOpen, Pencil, ArrowLeftRight, ArrowRight, ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';

// ─── Constants ───────────────────────────────────────────────────────────────

const VRF_DEFAULT_BRANDS = ['Blue Star', 'Samsung', 'Voltas', 'Trane'];

// Dehumidifier sizing & selection. AHU systems pick per-zone; other systems pick at the
// system level. Stored as Firestore field `dehumidifierUnits` on the system doc (system-level)
// or inside each zone in `system.zones[].dehumidifierUnits` (AHU per-zone).
interface DehumidifierUnit {
  modelId: string;
  brand: string;
  modelSeries: string;
  subType?: string;          // 'Desiccant' | 'DX-Refrigerant' (also allows custom)
  capacityLPH: number;       // litres per hour moisture removal
  powerInputKW?: number;
  quantity: number;
}

// 1 lb water ≈ 0.4536 L (water density). Used to convert calculated lbs/hr → LPH for sizing.
const LBS_PER_HR_TO_LPH = 0.4536;
// 3412 BTU/h ≈ 1 kW (electric / thermal output conversion for reheat sizing).
const BTUH_PER_KW = 3412;
const PA_PER_MMWG = 9.80665;

const paToMmWg = (pa?: number | null): number | undefined =>
  pa == null ? undefined : Number((pa / PA_PER_MMWG).toFixed(1));

const mmWgToPa = (mmWg?: number | null): number | undefined =>
  mmWg == null ? undefined : Number((mmWg * PA_PER_MMWG).toFixed(1));

// Dehumidification strategy. Engineer picks one of four methods per zone (or per zoneless system).
// All four achieve the same end (lower room RH) but via different equipment, with different
// equipment-schedule implications.
type DehumidMethod = 'reheat-hwc' | 'reheat-electric-ahu' | 'reheat-duct' | 'standalone';

const DEHUMID_METHOD_LABELS: Record<DehumidMethod, string> = {
  'reheat-hwc':           'Reheat — AHU Heating Coil (HW)',
  'reheat-electric-ahu':  'Reheat — AHU Electric Heater',
  'reheat-duct':          'Reheat — Duct Heater',
  'standalone':           'Standalone Desiccant / DX',
};

const FAHU_CAPABLE_SUBTYPES = new Set(['ductable-low', 'ductable-mid', 'ductable-hi', 'AHU-DX', 'AHU', 'TFA']);

const DEFAULT_AHU_CONFIG: AHUConfig = {
  hasHeatingCoil: false,
  fanCurve: 'backward-curved',
  fanDrive: 'belt-driven',
  extStaticPa: 150,
  hasMixingBox: true,
  coolingCoilRows: 6,
  heatingCoilRows: 2,
  filters: { pre: true, fine: true, hepa: false },
  preFilterGrade: 'G4 (EU4 / MERV-8)',
  fineFilterGrade: 'F7 (EU7 / MERV-13)',
  hepaFilterGrade: 'H14',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getFitStatus(
  itemTR: number, itemCFM: number | undefined,
  reqTR: number, reqCFM: number,
): 'ok' | 'oversized' | 'undersized' | 'unknown' {
  if (!reqTR && !reqCFM) return 'unknown';
  if (reqTR && itemTR < reqTR) return 'undersized';
  if (reqCFM && itemCFM && itemCFM < reqCFM) return 'undersized';
  if (reqTR && itemTR > reqTR * 1.3) return 'oversized';
  return 'ok';
}

function FitBadge({ status }: { status: 'ok' | 'oversized' | 'undersized' | 'unknown' }) {
  if (status === 'ok')         return <span className="text-sm font-bold px-2 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 whitespace-nowrap">✅ Fits</span>;
  if (status === 'oversized')  return <span className="text-sm font-bold px-2 py-1 rounded-md bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 whitespace-nowrap">🟡 Oversized</span>;
  if (status === 'undersized') return <span className="text-sm font-bold px-2 py-1 rounded-md bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 whitespace-nowrap">🔴 Under</span>;
  return null;
}

// Custom Select item that shows a short label in the trigger but a full title + description in the dropdown list.
// Description is placed outside <ItemText> so base-ui only shows the label in the trigger.
function SelectItemWithDesc({
  value, label, desc, className,
}: { value: string; label: string; desc: string; className?: string }) {
  return (
    <SelectPrimitive.Item
      value={value}
      className={cn(
        'relative flex w-full cursor-default flex-col gap-0.5 rounded-md py-2 pr-8 pl-1.5 outline-none select-none',
        'focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
    >
      <SelectPrimitive.ItemText className="text-sm font-medium whitespace-nowrap leading-tight">
        {label}
      </SelectPrimitive.ItemText>
      <span className="text-xs text-slate-400 leading-snug whitespace-normal pr-1 max-w-xs pointer-events-none">{desc}</span>
      <SelectPrimitive.ItemIndicator
        render={<span className="pointer-events-none absolute right-2 top-2 flex size-4 items-center justify-center" />}
      >
        <Check className="size-3 pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

function normalizeIDUList(val: IDUSelection | IDUSelection[] | null | undefined): IDUSelection[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function systemStatusInfo(sys: EquipmentSystem, rooms: any[]) {
  const assignedCount = rooms.filter((r: any) => r.zoneId === sys.id || r.systemId === sys.id).length;
  if (assignedCount === 0) return { label: 'No rooms', color: 'text-slate-400' };
  if (sys.type === 'VRF') {
    // Rooms covered = individual IDU selections + rooms in zones that have a selection
    const zoneCoveredRooms = new Set<string>();
    for (const zone of (sys.zones ?? (sys as any).ahuGroups ?? [])) {
      if (zone.selection) zone.roomIds.forEach((id: string) => zoneCoveredRooms.add(id));
    }
    const iduCount = Object.keys(sys.iduSelections).length + zoneCoveredRooms.size;
    const hasODU = !!sys.oduSelection;
    if (iduCount < assignedCount) return { label: `IDU missing (${assignedCount - iduCount})`, color: 'text-amber-600' };
    if (!hasODU) return { label: 'ODU not selected', color: 'text-orange-600' };
    return { label: 'Complete', color: 'text-emerald-600' };
  }
  if (sys.type === 'Chiller') {
    const hasPlant = ((sys as any).chillerUnits?.length ?? 0) > 0 || !!sys.unitSelection;
    if (!hasPlant) return { label: 'Chiller not selected', color: 'text-orange-600' };
    return { label: 'Complete', color: 'text-emerald-600' };
  }
  if (sys.type === 'AHU') {
    if (!sys.unitSelection) return { label: 'Condensing unit missing', color: 'text-orange-600' };
    return { label: 'Complete', color: 'text-emerald-600' };
  }
  if (sys.type === 'DOAS') {
    if (!sys.unitSelection) return { label: 'Unit not selected', color: 'text-orange-600' };
    return { label: 'Complete', color: 'text-emerald-600' };
  }
  if (!sys.unitSelection) return { label: 'Unit not selected', color: 'text-orange-600' };
  return { label: 'Complete', color: 'text-emerald-600' };
}

// ─── Humidifier sizing helper ─────────────────────────────────────────────────
// Computes the suggested FAHU/AHU humidifier capacity (kg/hr) for a zone, based on
// real psychrometrics: mass-flow of OUTDOOR AIR × humidity-ratio lift from winter
// outdoor to inside winter design conditions.
//
//   ṁ_water (lb/hr) = ṁ_air (lb/hr) × ΔW (lb/lb)
//                   = OA_CFM × 4.5 × (W_in - W_out)        (ASHRAE 4.5 = 60·0.075)
//   ṁ_water (kg/hr) = lb/hr × 0.4536
//   Final         = ṁ_water × (1 + safety/100)             (ASHRAE HVAC Sys & Eq Ch.22:
//                                                            10–15 % for steam dispersion
//                                                            losses, filter bypass, duct
//                                                            absorption)
//
// OA_CFM (not full supply CFM) is the right denominator — the humidifier only sees
// the outdoor-air fraction; room return air is already at indoor humidity. For a
// 100%-OA FAHU these collapse to the same number. Returns 0 if winter design
// conditions are missing or outdoor is already wetter than indoors (no humidification).
const DEFAULT_HUMIDIFIER_SAFETY_PCT = 10; // ASHRAE HVAC S&E Ch.22 typical range 10–15 %
type HumidifierSizingResult = {
  kgHr: number;            // final suggestion incl. safety
  baseKgHr: number;        // raw psychrometric kg/hr (no safety)
  oaCFM: number;           // OA mass flow basis
  deltaW_gPerKg: number;   // humidity-ratio lift (g water / kg dry air)
  safetyPct: number;       // % safety applied
};
function calcSuggestedHumidifier(zoneRooms: any[], project: any): HumidifierSizingResult {
  const empty: HumidifierSizingResult = { kgHr: 0, baseKgHr: 0, oaCFM: 0, deltaW_gPerKg: 0, safetyPct: 0 };
  if (!zoneRooms || zoneRooms.length === 0) return empty;
  const altitude = Number(project?.altitude ?? project?.data?.altitude) || 0;
  const winterT   = Number(project?.winterDesignTemp     ?? project?.data?.winterDesignTemp);
  const winterRH  = Number(project?.winterDesignHumidity ?? project?.data?.winterDesignHumidity);
  const insideWT  = Number(project?.insideWinterTemp     ?? project?.data?.insideWinterTemp);
  const insideWRH = Number(project?.insideWinterHumidity ?? project?.data?.insideWinterHumidity);
  if (![winterT, winterRH, insideWT, insideWRH].every(Number.isFinite)) return empty;

  const Wout = calculatePsychrometrics(winterT, winterRH, altitude).humidityRatio; // lb/lb
  const Win  = calculatePsychrometrics(insideWT, insideWRH, altitude).humidityRatio; // lb/lb
  const deltaW = Math.max(0, Win - Wout);
  if (deltaW <= 0) return empty;

  let oaCFM = 0;
  for (const r of zoneRooms) {
    const vol = calculateRoomVolume(r);
    oaCFM += vol * (Number(r.facph) || 0) / 60;
  }
  if (oaCFM <= 0) return empty;

  const lbHr = oaCFM * 4.5 * deltaW;
  const baseKgHr = lbHr * 0.4536;
  const rawSafety = Number(project?.humidifierSafetyPercent ?? project?.data?.humidifierSafetyPercent);
  const safetyPct = Number.isFinite(rawSafety) && rawSafety >= 0 && rawSafety <= 50
    ? rawSafety : DEFAULT_HUMIDIFIER_SAFETY_PCT;
  const kgHr = baseKgHr * (1 + safetyPct / 100);

  return {
    kgHr: parseFloat(kgHr.toFixed(1)),
    baseKgHr: parseFloat(baseKgHr.toFixed(1)),
    oaCFM: parseFloat(oaCFM.toFixed(0)),
    deltaW_gPerKg: parseFloat((deltaW * 1000).toFixed(2)),
    safetyPct,
  };
}

// Backwards-compatible wrapper returning just the kg/hr number
function calcSuggestedHumidifierKgHr(zoneRooms: any[], project: any): number {
  return calcSuggestedHumidifier(zoneRooms, project).kgHr;
}

// ─── IDU Picker Dialog ────────────────────────────────────────────────────────

function IDUPickerDialog({
  open, onClose, roomName, requiredTR, designCFM, lockedBrand, onSelect,
  systemType, coilDutyTR,
}: {
  open: boolean; onClose: () => void;
  roomName: string; requiredTR: number; designCFM: number;
  lockedBrand: string | null;
  onSelect: (sel: IDUSelection) => void;
  // Chiller AHU selection: drop the 400 CFM/TR-based "Required TR" framing and show
  // Coil Duty (thermal load) + Design CFM as two independent sizing properties.
  systemType?: string;
  coilDutyTR?: number;
}) {
  const isChillerPicker = String(systemType ?? '').toLowerCase() === 'chiller';
  const [search, setSearch] = useState('');
  const [filterBrand, setFilterBrand] = useState(lockedBrand ?? 'all');
  const [filterType, setFilterType] = useState('VRF-IDU');
  const [filterSubType, setFilterSubType] = useState('all');
  const [extraBrands] = useState<string[]>([]);

  // Custom creation form state
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [savingCustomIDU, setSavingCustomIDU] = useState(false);
  const [customType, setCustomType] = useState('VRF-IDU');
  const [customBrand, setCustomBrand] = useState('');
  const [customSubType, setCustomSubType] = useState('hi-wall');
  const [customModel, setCustomModel] = useState('');
  const [customTR, setCustomTR] = useState('');
  const [customCFM, setCustomCFM] = useState('');
  const [customStaticPa, setCustomStaticPa] = useState('');

  useEffect(() => { setFilterBrand(lockedBrand ?? 'all'); }, [lockedBrand]);
  useEffect(() => {
    if (open) {
      setShowCustomForm(false);
      setCustomType('VRF-IDU');
      setCustomBrand(lockedBrand ?? (filterBrand !== 'all' ? filterBrand : ''));
      setCustomSubType('hi-wall');
      setCustomModel(''); setCustomTR(''); setCustomCFM(''); setCustomStaticPa('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const [libraryIDUItems, setLibraryIDUItems] = useState<EquipmentModel[]>([]);
  useEffect(() => {
    if (!open) return;
    // Fetch all IDU-relevant types so the Type filter works just like the Global Library
    getLibraryItemsByType(['VRF-IDU', 'FCU', 'AHU', 'DuctableSplit', 'Split'])
      .then(items => setLibraryIDUItems(items.map(m => ({ ...m, subType: m.subType?.toLowerCase() }))))
      .catch(() => {
        setLibraryIDUItems(
          EQUIPMENT_CATALOG.filter(m => ['VRF-IDU', 'FCU', 'AHU', 'DuctableSplit', 'Split'].includes(m.type as string))
            .map(m => ({ ...m, subType: m.subType?.toLowerCase() }))
        );
      });
  }, [open]);

  // ── Cascading filter option lists (mirrors Global Equipment Library) ──────
  // Brand list: preferred brands first, then library brands
  const brandFilteredItems = libraryIDUItems;
  const libraryBrands = [...new Set(brandFilteredItems.map(m => m.brand))];
  const allBrands = [
    ...VRF_DEFAULT_BRANDS.filter(b => libraryBrands.includes(b)),
    ...libraryBrands.filter(b => !VRF_DEFAULT_BRANDS.includes(b)),
    ...extraBrands.filter(b => !libraryBrands.includes(b)),
  ];

  // Type list: derived from items matching the selected brand
  const afterBrandItems = libraryIDUItems
    .filter(m => lockedBrand ? m.brand === lockedBrand : (filterBrand === 'all' || m.brand === filterBrand));
  const allTypes = [...new Set(afterBrandItems.map(m => String(m.type)).filter(Boolean))].sort();

  // Sub-type list: derived from items matching brand + type
  const afterTypeItems = afterBrandItems
    .filter(m => filterType === 'all' || String(m.type) === filterType);
  const allSubTypes = [...new Set(afterTypeItems.map(m => m.subType).filter(Boolean))].sort((a, b) =>
    (IDU_SUBTYPE_LABELS[a!] ?? a!).localeCompare(IDU_SUBTYPE_LABELS[b!] ?? b!));

  // Chiller AHU/FCU sizing is by coil duty, not by 400-CFM/TR-derived requiredTR.
  // Use coilDutyTR as the fit reference so the sorter ranks correctly-sized AHUs first.
  const effectiveReqTR = isChillerPicker ? (coilDutyTR ?? 0) : requiredTR;

  // Final visible items
  const items = afterTypeItems
    .filter(m => filterSubType === 'all' || m.subType === filterSubType)
    .filter(m => !search || m.modelSeries.toLowerCase().includes(search.toLowerCase()) || m.brand.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const aFit = getFitStatus(a.capacityTR, a.ratedAirflowCFM, effectiveReqTR, designCFM);
      const bFit = getFitStatus(b.capacityTR, b.ratedAirflowCFM, effectiveReqTR, designCFM);
      const order = { ok: 0, oversized: 1, undersized: 2, unknown: 3 };
      if (order[aFit] !== order[bFit]) return order[aFit] - order[bFit];
      // Within the same fit bucket, prefer smallest capacity that still fits
      // (tightest match → less oversizing on the AHU and less plant inflation).
      return (a.capacityTR ?? 0) - (b.capacityTR ?? 0);
    });

  const submitCustom = async () => {
    const tr = parseFloat(customTR);
    if (!customBrand.trim() || !customModel.trim() || !tr || tr <= 0) return;
    setSavingCustomIDU(true);
    try {
      const payload: Record<string, any> = {
        brand: customBrand.trim(),
        type: customType.trim() || 'VRF-IDU',
        subType: customSubType,
        modelSeries: customModel.trim(),
        capacityTR: tr,
        capacityBTU: Math.round(tr * 12000),
        userId: auth.currentUser?.uid ?? null,
        createdAt: serverTimestamp(),
      };
      const cfm = parseFloat(customCFM);
      if (!isNaN(cfm) && cfm > 0) payload.ratedAirflowCFM = cfm;
      const espMmWg = parseFloat(customStaticPa);
      if (!isNaN(espMmWg) && espMmWg > 0) payload.staticPressurePa = mmWgToPa(espMmWg);

      const docRef = await addDoc(collection(db, GLOBAL_LIB_COLLECTION), {
        ...payload,
        source: 'user',
        addedBy: auth.currentUser?.uid ?? null,
      });
      toast.success(`${payload.brand} ${payload.modelSeries} saved to Global Library`);
      onSelect({
        modelId: docRef.id,
        brand: payload.brand,
        modelSeries: payload.modelSeries,
        subType: customSubType,
        trCapacity: tr,
        cfmRated: cfm || 0,
      });
      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, GLOBAL_LIB_COLLECTION);
    } finally {
      setSavingCustomIDU(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-5xl max-h-[88vh] flex flex-col p-0 dark:bg-slate-900">
        <DialogHeader className="px-6 pt-5 pb-4 border-b dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60">
          <DialogTitle className="text-base font-bold flex items-center gap-2 dark:text-slate-100">
            Select IDU — <span className="text-blue-600 dark:text-blue-400">{roomName}</span>
            {lockedBrand && <Badge variant="outline" className="gap-1 text-sm text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20"><Lock className="w-3 h-3" />{lockedBrand}</Badge>}
          </DialogTitle>
          {isChillerPicker ? (
            ((coilDutyTR ?? 0) > 0 || designCFM > 0) && (
              <div className="mt-3 flex items-start gap-3 p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800 text-sm">
                <Info className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap gap-4">
                    {(coilDutyTR ?? 0) > 0 && (
                      <span className="text-indigo-700 dark:text-indigo-300">Coil Duty / Required: <strong className="text-orange-700 dark:text-orange-400">{(coilDutyTR ?? 0).toFixed(2)} TR</strong></span>
                    )}
                    {designCFM > 0 && (
                      <span className="text-indigo-700 dark:text-indigo-300">Design CFM: <strong>{Math.round(designCFM).toLocaleString()}</strong></span>
                    )}
                  </div>
                  <span className="text-[11.5px] text-slate-500 dark:text-slate-400 italic leading-snug">
                    Chiller AHU — Coil Duty (thermal load) and Design CFM (dehumidified airflow) are independent.
                    The coil is built to the Coil Duty, which already carries the project safety factor — the
                    selected model is sized to that duty (no extra selection margin added).
                  </span>
                </div>
              </div>
            )
          ) : (
            requiredTR > 0 && (
              <div className="mt-3 flex flex-wrap gap-4 p-3 rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 text-sm">
                <Info className="w-4 h-4 text-violet-500 mt-0.5 shrink-0" />
                <span className="text-violet-700 dark:text-violet-300">Required: <strong>{requiredTR.toFixed(2)} TR</strong></span>
                {designCFM > 0 && <span className="text-violet-700 dark:text-violet-300">Design CFM: <strong>{Math.round(designCFM).toLocaleString()}</strong></span>}
                <span className="text-slate-400 dark:text-slate-500 italic">Fits: {requiredTR.toFixed(2)}–{(requiredTR * 1.3).toFixed(2)} TR</span>
              </div>
            )
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <Input className="pl-9 h-9 text-sm" placeholder="Search model…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {!lockedBrand && (
              <Select value={filterBrand} onValueChange={v => { setFilterBrand(v ?? 'all'); setFilterType('VRF-IDU'); setFilterSubType('all'); }}>
                <SelectTrigger className="h-9 w-40 text-sm"><SelectValue placeholder="All Brands" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Brands</SelectItem>
                  {allBrands.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={filterType} onValueChange={v => { setFilterType(v ?? 'all'); setFilterSubType('all'); }}>
              <SelectTrigger className="h-9 w-36 text-sm"><SelectValue placeholder="All Types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {allTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterSubType} onValueChange={v => setFilterSubType(v ?? 'all')}>
              <SelectTrigger className="h-9 w-48 text-sm"><SelectValue placeholder="All Sub-Types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sub-Types</SelectItem>
                {allSubTypes.map(s => <SelectItem key={s} value={s!}>{IDU_SUBTYPE_LABELS[s!] ?? s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 min-h-0">
          <Table containerClassName="overflow-x-clip">
            <TableHeader className="sticky top-0 bg-white dark:bg-slate-900 z-10 shadow-sm">
              <TableRow className="bg-slate-100 dark:bg-slate-700 text-xs font-semibold uppercase tracking-wide">
                <TableHead className="py-3">Brand</TableHead>
                <TableHead className="py-3 hidden sm:table-cell">Type</TableHead>
                <TableHead className="py-3 hidden sm:table-cell">Model</TableHead>
                <TableHead className="text-right py-3">TR</TableHead>
                <TableHead className="text-right py-3">CFM</TableHead>
                <TableHead className="text-center py-3">Fit</TableHead>
                <TableHead className="w-20 py-3"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-slate-400">No catalog models match — use "Create Custom" below.</TableCell></TableRow>
              )}
              {items.map(item => {
                const fit = getFitStatus(item.capacityTR, item.ratedAirflowCFM, effectiveReqTR, designCFM);
                return (
                  <TableRow key={item.id} className={cn('hover:bg-blue-50/40 dark:hover:bg-blue-950/20', fit === 'ok' && 'bg-emerald-50/30 dark:bg-emerald-950/20', fit === 'undersized' && 'opacity-60')}>
                    <TableCell className="font-bold text-sm py-3">{item.brand}</TableCell>
                    <TableCell className="text-sm text-slate-500 dark:text-slate-400 py-3 hidden sm:table-cell">{IDU_SUBTYPE_LABELS[item.subType ?? ''] ?? item.subType}</TableCell>
                    <TableCell className="font-medium text-sm py-3 hidden sm:table-cell">{item.modelSeries}</TableCell>
                    <TableCell className="text-right font-mono text-sm py-3">{item.capacityTR}</TableCell>
                    <TableCell className="text-right font-mono text-sm py-3">{item.ratedAirflowCFM ? Math.round(item.ratedAirflowCFM).toLocaleString() : '—'}</TableCell>
                    <TableCell className="text-center py-3"><FitBadge status={fit} /></TableCell>
                    <TableCell className="py-3">
                      <Button size="sm" variant={fit === 'ok' ? 'default' : 'outline'} className="h-8 text-sm px-3"
                        onClick={() => {
                          onSelect({ modelId: item.id, brand: item.brand, modelSeries: item.modelSeries, subType: item.subType ?? '', trCapacity: item.capacityTR, cfmRated: item.ratedAirflowCFM ?? 0 });
                          onClose();
                        }}>
                        {fit === 'undersized' ? '⚠ Select Anyway' : 'Select'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* ── Custom IDU creation ──────────────────────────────────────────── */}
        <div className="border-t border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setShowCustomForm(v => !v)}
            className="w-full flex items-center justify-between px-5 py-2.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              Can't find your model? Create custom IDU
            </span>
            <ChevronRight className={cn('w-3.5 h-3.5 transition-transform', showCustomForm && 'rotate-90')} />
          </button>

          {showCustomForm && (
            <div className="px-5 pb-4 pt-1 bg-slate-50 dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 space-y-3">
              <p className="text-xs text-slate-400 dark:text-slate-500">Enter model specs — this selection is saved to the project equipment schedule.</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-600 dark:text-slate-400">Type *</label>
                  <ComboboxInput
                    inputClassName="h-8 text-xs"
                    placeholder="e.g. VRF-IDU"
                    value={customType}
                    onChange={setCustomType}
                    options={['VRF-IDU', 'FCU', 'AHU', 'DuctableSplit', 'Split']}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-600 dark:text-slate-400">Brand *</label>
                  <ComboboxInput
                    inputClassName="h-8 text-xs"
                    placeholder="e.g. Blue Star"
                    value={customBrand}
                    onChange={setCustomBrand}
                    options={allBrands}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-600 dark:text-slate-400">Sub-Type</label>
                  <ComboboxInput
                    inputClassName="h-8 text-xs"
                    placeholder="e.g. hi-wall"
                    value={customSubType}
                    onChange={setCustomSubType}
                    options={[...new Set([...Object.keys(IDU_SUBTYPE_LABELS), ...allSubTypes])].sort()}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-600 dark:text-slate-400">Model / Series *</label>
                  <Input className="h-8 text-xs" placeholder="e.g. BI18DB" value={customModel} onChange={e => setCustomModel(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-600 dark:text-slate-400">Capacity (TR) *</label>
                  <Input type="text" inputMode="decimal" min="0" step="0.5" className="h-8 text-xs" placeholder="e.g. 1.5" value={customTR} onChange={e => setCustomTR(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-600 dark:text-slate-400">Airflow (CFM)</label>
                  <Input type="text" inputMode="decimal" min="0" className="h-8 text-xs" placeholder="optional" value={customCFM} onChange={e => setCustomCFM(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-600 dark:text-slate-400">Static (mm WG)</label>
                  <Input type="text" inputMode="decimal" min="0" className="h-8 text-xs" placeholder="AHU only" value={customStaticPa} onChange={e => setCustomStaticPa(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button size="sm" className="h-8 text-xs px-4 bg-teal-600 hover:bg-teal-700"
                  disabled={savingCustomIDU || !customBrand.trim() || !customModel.trim() || !parseFloat(customTR)}
                  onClick={submitCustom}>
                  {savingCustomIDU ? 'Saving…' : 'Save to Catalog & Select'}
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowCustomForm(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── ODU Picker Dialog ────────────────────────────────────────────────────────

const MAX_COMBO_UNITS = 4;

function ODUPickerDialog({
  open, onClose, requiredTR, lockedBrand, onSelect,
}: {
  open: boolean; onClose: () => void;
  requiredTR: number; lockedBrand: string | null;
  onSelect: (sel: ODUSelection) => void;
}) {
  const [search, setSearch] = useState('');
  const [filterBrand, setFilterBrand] = useState(lockedBrand ?? 'all');
  const [filterType, setFilterType] = useState('VRF-ODU');
  const [filterDischarge, setFilterDischarge] = useState('all');
  const [filterCompressor, setFilterCompressor] = useState('all');
  const [moduleCount, setModuleCount] = useState<Record<string, number>>({});
  const [combination, setCombination] = useState<ODUCombinationUnit[]>([]);

  // Custom ODU form
  const [showCustomODU, setShowCustomODU] = useState(false);
  const [savingCustomODU, setSavingCustomODU] = useState(false);
  const [customODUType, setCustomODUType] = useState('VRF-ODU');
  const [customODUBrand, setCustomODUBrand] = useState('');
  const [customODUModel, setCustomODUModel] = useState('');
  const [customODUTR, setCustomODUTR] = useState('');
  const [customODUDischarge, setCustomODUDischarge] = useState<'top' | 'side'>('top');
  const [customODUCompressor, setCustomODUCompressor] = useState<'heat-pump' | 'cooling-only'>('heat-pump');

  useEffect(() => { setFilterBrand(lockedBrand ?? 'all'); }, [lockedBrand]);
  useEffect(() => {
    if (open) {
      setModuleCount({});
      setCombination([]);
      setShowCustomODU(false);
      setCustomODUType('VRF-ODU');
      setCustomODUBrand(lockedBrand ?? '');
      setCustomODUModel(''); setCustomODUTR('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const [libraryODUItems, setLibraryODUItems] = useState<EquipmentModel[]>([]);
  useEffect(() => {
    if (!open) return;
    getLibraryItemsByType(['VRF-ODU', 'Chiller', 'CoolingTower']).then(setLibraryODUItems).catch(() => {
      setLibraryODUItems(EQUIPMENT_CATALOG.filter(m => m.type === 'VRF-ODU'));
    });
  }, [open]);

  const comboTotalUnits = combination.reduce((s, u) => s + u.quantity, 0);
  const comboTotalTR = combination.reduce((s, u) => s + u.trCapacity * u.quantity, 0);
  const comboSufficient = comboTotalTR >= requiredTR;

  const addToCombo = (item: (typeof EQUIPMENT_CATALOG)[0]) => {
    if (comboTotalUnits >= MAX_COMBO_UNITS) return;
    setCombination(prev => {
      const existing = prev.find(u => u.modelId === item.id);
      if (existing) {
        return prev.map(u => u.modelId === item.id ? { ...u, quantity: u.quantity + 1 } : u);
      }
      return [...prev, {
        modelId: item.id, brand: item.brand, modelSeries: item.modelSeries,
        trCapacity: item.capacityTR, quantity: 1,
        dischargeType: item.dischargeType, compressorType: item.compressorType,
      }];
    });
  };

  const adjustComboQty = (modelId: string, delta: number) => {
    setCombination(prev =>
      prev.map(u => u.modelId === modelId ? { ...u, quantity: u.quantity + delta } : u)
          .filter(u => u.quantity > 0)
    );
  };

  const confirmCombination = () => {
    if (combination.length === 0) return;
    const first = combination[0];
    const allDischarge = combination.every(u => u.dischargeType === first.dischargeType) ? first.dischargeType : undefined;
    const allCompressor = combination.every(u => u.compressorType === first.compressorType) ? first.compressorType : undefined;
    if (combination.length === 1 && combination[0].quantity === 1) {
      onSelect({ modelId: first.modelId, brand: first.brand, modelSeries: first.modelSeries, trCapacity: first.trCapacity, dischargeType: allDischarge, compressorType: allCompressor });
    } else {
      onSelect({
        modelId: first.modelId, brand: first.brand,
        modelSeries: combination.length === 1 ? first.modelSeries : `${first.brand} Combination`,
        trCapacity: first.trCapacity, dischargeType: allDischarge, compressorType: allCompressor,
        effectiveTR: comboTotalTR, combination,
      });
    }
    onClose();
  };

  // ── Cascading filter option lists (mirrors Global Equipment Library) ──────
  const oduLibraryBrands = [...new Set(libraryODUItems.map(m => m.brand))];
  const allBrands = [
    ...VRF_DEFAULT_BRANDS.filter(b => oduLibraryBrands.includes(b)),
    ...oduLibraryBrands.filter(b => !VRF_DEFAULT_BRANDS.includes(b)),
  ];

  // Type list: derived from items matching the selected brand
  const afterBrandItems = libraryODUItems
    .filter(m => lockedBrand ? m.brand === lockedBrand : (filterBrand === 'all' || m.brand === filterBrand));
  const allODUTypes = [...new Set(afterBrandItems.map(m => String(m.type)).filter(Boolean))].sort();

  // Final visible items: brand → type → discharge → compressor → search
  const items = afterBrandItems
    .filter(m => filterType === 'all' || String(m.type) === filterType)
    .filter(m => filterDischarge === 'all' || m.dischargeType === filterDischarge)
    .filter(m => filterCompressor === 'all' || m.compressorType === filterCompressor)
    .filter(m => !search || m.modelSeries.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const aMods = a.isModular ? (moduleCount[a.id] ?? 1) : 1;
      const bMods = b.isModular ? (moduleCount[b.id] ?? 1) : 1;
      const aEff = a.capacityTR * aMods;
      const bEff = b.capacityTR * bMods;
      if (aEff < requiredTR && bEff >= requiredTR) return 1;
      if (bEff < requiredTR && aEff >= requiredTR) return -1;
      return aEff - bEff;
    });

  const submitCustomODU = async () => {
    const tr = parseFloat(customODUTR);
    if (!customODUBrand.trim() || !customODUModel.trim() || !tr || tr <= 0) return;
    setSavingCustomODU(true);
    try {
      const payload: Record<string, any> = {
        brand: customODUBrand.trim(),
        type: customODUType.trim() || 'VRF-ODU',
        modelSeries: customODUModel.trim(),
        capacityTR: tr,
        capacityBTU: Math.round(tr * 12000),
        dischargeType: customODUDischarge,
        compressorType: customODUCompressor,
        userId: auth.currentUser?.uid ?? null,
        createdAt: serverTimestamp(),
      };
      const docRef = await addDoc(collection(db, GLOBAL_LIB_COLLECTION), {
        ...payload,
        source: 'user',
        addedBy: auth.currentUser?.uid ?? null,
      });
      toast.success(`${payload.brand} ${payload.modelSeries} saved to Global Library`);
      onSelect({
        modelId: docRef.id,
        brand: payload.brand,
        modelSeries: payload.modelSeries,
        trCapacity: tr,
        dischargeType: customODUDischarge,
        compressorType: customODUCompressor,
      });
      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, GLOBAL_LIB_COLLECTION);
    } finally {
      setSavingCustomODU(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] flex flex-col p-0 dark:bg-slate-900">
        <DialogHeader className="px-5 pt-5 pb-3 border-b dark:border-slate-700">
          <DialogTitle className="text-sm font-bold dark:text-slate-100">
            Select ODU
            {lockedBrand && <Badge variant="outline" className="ml-2 gap-1 text-xs text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20"><Lock className="w-2.5 h-2.5" />{lockedBrand}</Badge>}
          </DialogTitle>
          <div className="mt-1.5 flex items-center gap-3 p-2 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-xs">
            <Info className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-blue-700 dark:text-blue-300">Required ODU capacity (after diversity): <strong>{requiredTR.toFixed(2)} TR</strong></span>
            <span className="text-slate-400 dark:text-slate-500 italic">Use <strong>Select</strong> for single unit · <strong>+ Add</strong> to build a multi-unit combination (max {MAX_COMBO_UNITS} units)</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
              <Input className="pl-8 h-8 text-xs" placeholder="Search model…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {!lockedBrand && (
              <Select value={filterBrand} onValueChange={v => { setFilterBrand(v ?? 'all'); setFilterType('VRF-ODU'); }}>
                <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="All Brands" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Brands</SelectItem>
                  {allBrands.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={filterType} onValueChange={v => setFilterType(v ?? 'all')}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="All Types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {allODUTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterDischarge} onValueChange={v => setFilterDischarge(v ?? 'all')}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Discharge" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any Discharge</SelectItem>
                <SelectItem value="top">Top Discharge</SelectItem>
                <SelectItem value="side">Side Discharge</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterCompressor} onValueChange={v => setFilterCompressor(v ?? 'all')}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Compressor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Heat Pump + CO</SelectItem>
                <SelectItem value="heat-pump">Heat Pump</SelectItem>
                <SelectItem value="cooling-only">Cooling Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </DialogHeader>
        {/* Combination basket */}
        {combination.length > 0 && (
          <div className="px-4 py-2.5 bg-purple-50 dark:bg-purple-950/20 border-b border-purple-200 dark:border-purple-800">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="text-sm font-bold text-purple-700 dark:text-purple-300 mb-1.5">
                  ODU Combination — {comboTotalUnits}/{MAX_COMBO_UNITS} units
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {combination.map(u => (
                    <div key={u.modelId} className="flex items-center gap-1 bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-700 rounded px-2 py-1 text-xs shadow-sm">
                      <button type="button"
                        className="w-4 h-4 rounded text-purple-500 flex items-center justify-center hover:bg-purple-100 dark:hover:bg-purple-900/30 disabled:opacity-30 text-sm font-bold"
                        disabled={u.quantity <= 1}
                        onClick={() => adjustComboQty(u.modelId, -1)}>−</button>
                      <span className="font-mono font-bold text-purple-700 dark:text-purple-300 w-4 text-center">{u.quantity}</span>
                      <button type="button"
                        className="w-4 h-4 rounded text-purple-500 flex items-center justify-center hover:bg-purple-100 dark:hover:bg-purple-900/30 disabled:opacity-30 text-sm font-bold"
                        disabled={comboTotalUnits >= MAX_COMBO_UNITS}
                        onClick={() => adjustComboQty(u.modelId, 1)}>+</button>
                      <span className="text-slate-700 dark:text-slate-300 mx-1">{u.modelSeries}</span>
                      <span className="text-slate-400 dark:text-slate-500 font-mono text-sm">{u.trCapacity} TR</span>
                      <button type="button"
                        className="ml-1 w-4 h-4 flex items-center justify-center rounded text-red-400 hover:text-red-600 hover:bg-red-50 text-sm font-bold"
                        onClick={() => setCombination(prev => prev.filter(x => x.modelId !== u.modelId))}>×</button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                <div className={cn('text-sm font-bold', comboSufficient ? 'text-emerald-700' : 'text-orange-600')}>
                  Total: {comboTotalTR} TR
                  {!comboSufficient && <span className="text-xs font-normal ml-1">(need {requiredTR.toFixed(1)})</span>}
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" className="h-8 text-sm text-red-400 hover:text-red-600" onClick={() => setCombination([])}>Clear</Button>
                  <Button size="sm" className="h-8 text-sm bg-purple-600 hover:bg-purple-700 text-white" disabled={!comboSufficient} onClick={confirmCombination}>
                    Confirm {comboTotalTR} TR
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="overflow-y-auto flex-1 min-h-0">
          <Table containerClassName="overflow-x-clip">
            <TableHeader className="sticky top-0 bg-white dark:bg-slate-900 z-10">
              <TableRow className="bg-slate-50 dark:bg-slate-800 text-xs uppercase">
                <TableHead>Brand</TableHead>
                <TableHead className="hidden sm:table-cell">Model</TableHead>
                <TableHead className="hidden sm:table-cell">Discharge</TableHead>
                <TableHead className="hidden sm:table-cell">Type</TableHead>
                <TableHead className="text-right">TR/Unit</TableHead>
                <TableHead className="text-center">Modules</TableHead>
                <TableHead className="text-right">Eff. TR</TableHead>
                <TableHead className="text-right hidden sm:table-cell">EER</TableHead>
                <TableHead className="w-28"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-sm text-slate-400">No ODU models match — use "Create Custom" below.</TableCell></TableRow>
              )}
              {items.map(item => {
                const mods = item.isModular ? (moduleCount[item.id] ?? 1) : 1;
                const effectiveTR = item.capacityTR * mods;
                const sufficient = effectiveTR >= requiredTR;
                const inCombo = combination.find(u => u.modelId === item.id);
                const comboFull = comboTotalUnits >= MAX_COMBO_UNITS && !inCombo;
                return (
                  <TableRow key={item.id} className={cn('hover:bg-blue-50/30 dark:hover:bg-blue-950/20', sufficient && 'bg-emerald-50/20 dark:bg-emerald-950/20', !sufficient && 'opacity-50')}>
                    <TableCell className="font-bold text-xs">{item.brand}</TableCell>
                    <TableCell className="font-medium text-xs hidden sm:table-cell">
                      {item.modelSeries}
                      {item.isModular && (
                        <span className="ml-1.5 text-sm font-bold px-1 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700">
                          Modular ×{item.maxModules}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs capitalize hidden sm:table-cell">{item.dischargeType ?? '—'}</TableCell>
                    <TableCell className="text-xs hidden sm:table-cell">{item.compressorType === 'heat-pump' ? 'Heat Pump' : 'Cooling Only'}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{item.capacityTR}</TableCell>
                    <TableCell className="text-center py-1">
                      {item.isModular ? (
                        <div className="inline-flex items-center gap-0.5">
                          <button type="button"
                            className="w-5 h-5 rounded border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 flex items-center justify-center text-xs hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40"
                            disabled={mods <= 1}
                            onClick={() => setModuleCount(prev => ({ ...prev, [item.id]: Math.max(1, mods - 1) }))}>−</button>
                          <span className={cn('w-5 text-center text-sm font-bold font-mono', mods > 1 ? 'text-purple-700 dark:text-purple-300' : 'text-slate-400 dark:text-slate-500')}>{mods}</span>
                          <button type="button"
                            className="w-5 h-5 rounded border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 flex items-center justify-center text-xs hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40"
                            disabled={mods >= (item.maxModules ?? 4)}
                            onClick={() => setModuleCount(prev => ({ ...prev, [item.id]: Math.min(item.maxModules ?? 4, mods + 1) }))}>+</button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className={cn('text-right font-mono text-sm font-bold', sufficient ? 'text-emerald-700' : '')}>
                      {mods > 1 ? `${mods}×${item.capacityTR}=${effectiveTR}` : item.capacityTR}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm hidden sm:table-cell">{item.eer ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant={sufficient ? 'default' : 'outline'} className="h-8 text-sm px-2"
                          disabled={combination.length > 0}
                          onClick={() => {
                            const sel: ODUSelection = {
                              modelId: item.id, brand: item.brand, modelSeries: item.modelSeries,
                              trCapacity: item.capacityTR, dischargeType: item.dischargeType,
                              compressorType: item.compressorType,
                            };
                            if (item.isModular && mods > 1) { sel.modules = mods; sel.effectiveTR = effectiveTR; }
                            onSelect(sel);
                            onClose();
                          }}>
                          {sufficient ? 'Select' : '⚠ Select Anyway'}
                        </Button>
                        <Button size="sm" variant="outline"
                          className={cn('h-8 text-sm px-2', inCombo ? 'border-purple-400 text-purple-700 bg-purple-50 dark:bg-purple-950/20 dark:border-purple-700 dark:text-purple-300' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400')}
                          disabled={comboFull}
                          title={comboFull ? `Max ${MAX_COMBO_UNITS} units` : 'Add to combination'}
                          onClick={() => addToCombo(item)}>
                          {inCombo ? `×${inCombo.quantity}` : '+Add'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* ── Custom ODU creation ─────────────────────────────────────────── */}
        <div className="border-t border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setShowCustomODU(v => !v)}
            className="w-full flex items-center justify-between px-5 py-2.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              Can't find your ODU? Create custom ODU
            </span>
            <ChevronRight className={cn('w-3.5 h-3.5 transition-transform', showCustomODU && 'rotate-90')} />
          </button>
          {showCustomODU && (
            <div className="px-5 pb-4 pt-1 bg-slate-50 dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 space-y-3">
              <p className="text-xs text-slate-400 dark:text-slate-500">Enter ODU specs — saved to the project equipment schedule.</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-600 dark:text-slate-400">Type *</label>
                  <ComboboxInput
                    inputClassName="h-8 text-xs"
                    placeholder="e.g. VRF-ODU"
                    value={customODUType}
                    onChange={setCustomODUType}
                    options={['VRF-ODU', 'Chiller', 'CoolingTower', 'Boiler']}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-600 dark:text-slate-400">Brand *</label>
                  <ComboboxInput
                    inputClassName="h-8 text-xs"
                    placeholder="e.g. Blue Star"
                    value={customODUBrand}
                    onChange={setCustomODUBrand}
                    options={allBrands}
                  />
                </div>
                <div className="space-y-1 col-span-2 sm:col-span-1">
                  <label className="text-sm font-semibold text-slate-600 dark:text-slate-400">Model / Series *</label>
                  <Input className="h-8 text-xs" placeholder="e.g. W Series HP" value={customODUModel} onChange={e => setCustomODUModel(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-600 dark:text-slate-400">Capacity (TR) *</label>
                  <Input type="text" inputMode="decimal" min="0" step="0.5" className="h-8 text-xs" placeholder="e.g. 20" value={customODUTR} onChange={e => setCustomODUTR(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-600 dark:text-slate-400">Discharge</label>
                  <Select value={customODUDischarge} onValueChange={v => setCustomODUDischarge(v as 'top' | 'side')}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="top">Top Discharge</SelectItem>
                      <SelectItem value="side">Side Discharge</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-600 dark:text-slate-400">Compressor</label>
                  <Select value={customODUCompressor} onValueChange={v => setCustomODUCompressor(v as 'heat-pump' | 'cooling-only')}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="heat-pump">Heat Pump</SelectItem>
                      <SelectItem value="cooling-only">Cooling Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button size="sm" className="h-8 text-xs px-4 bg-blue-600 hover:bg-blue-700"
                  disabled={savingCustomODU || !customODUBrand.trim() || !customODUModel.trim() || !parseFloat(customODUTR)}
                  onClick={submitCustomODU}>
                  {savingCustomODU ? 'Saving…' : 'Save to Catalog & Select'}
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowCustomODU(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── HVAC Equipment Generator ────────────────────────────────────────────────

const STD_TR_SIZES = [3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150];

function roundUpToStdTR(tr: number): number {
  return STD_TR_SIZES.find(s => s >= tr) ?? Math.ceil(tr / 10) * 10;
}

function generateEquipmentSpecs(
  systemType: string, requiredTR: number, designCFM: number, systemName?: string,
): Partial<EquipmentModel> & { staticPressurePa?: number } {
  // Chiller AHU coils are built to the Coil Duty, which already carries the project safety
  // factor — no extra selection margin (engineer decision 2026-06-19). Other unit types keep a
  // 10% catalog-selection margin. Either way, roundUpToStdTR adds natural headroom.
  const safetyFactor = systemType === 'Chiller' ? 1.0 : 1.1;
  const rawTR = requiredTR * safetyFactor;
  const tr = roundUpToStdTR(rawTR);

  // Rated airflow = designCFM directly. The OLD `max(designCFM, tr × 400)` rule
  // was dropped 2026-05-20: it incorrectly couples plant TR to airflow.
  //   - DOAS:  CFM is OA-driven (5,245 CFM from FACPH × volume), independent of coil TR
  //   - AHU:   CFM is dehumidified-airflow-driven, set by room ADP psychrometrics
  //   - DX:    OEM ratings already couple TR↔CFM; catalog selection enforces fit
  // Chiller has no air handling, so cfm = 0.
  const cfm = systemType === 'Chiller' ? 0 : Math.round(designCFM);

  const espMap: Record<string, number> = {
    AHU: 150, Package: 100, DuctableSplit: 120, Split: 0, Chiller: 0,
  };
  const esp = espMap[systemType] ?? 0;

  const subTypeMap: Record<string, string> = {
    AHU: 'Chilled Water', FCU: 'Chilled Water', Chiller: 'Air Cooled',
    Package: 'Packaged AC', DuctableSplit: 'Ducted Split', Split: 'Inverter Split',
  };

  const prefix: Record<string, string> = {
    AHU: 'AHU', Package: 'PAC', DuctableSplit: 'DS', Chiller: 'CH', Split: 'SPL', FCU: 'FCU',
  };
  const autoName = systemName
    ? `${systemName} (${tr} TR)`
    : `${prefix[systemType] ?? systemType}-${tr}TR`;

  return {
    brand: 'Custom',
    type: systemType as any,
    subType: subTypeMap[systemType],
    modelSeries: autoName,
    capacityTR: tr,
    capacityBTU: Math.round(tr * 12000),
    ratedAirflowCFM: Math.round(cfm),
    staticPressurePa: esp > 0 ? esp : undefined,
    powerInputKW: parseFloat((tr * 0.95).toFixed(1)),
  };
}

// ─── Unit Picker Dialog (Package / DuctableSplit / AHU / Chiller / Split) ──────

function UnitPickerDialog({
  open, onClose, systemType, packageSubType, requiredTR, designCFM, customItems = [],
  systemName, onSaveToLibrary, onSelect,
}: {
  open: boolean; onClose: () => void;
  systemType: 'Package' | 'DuctableSplit' | 'AHU' | 'Chiller' | 'Split' | 'DOAS';
  packageSubType?: string;
  requiredTR: number; designCFM: number;
  customItems?: EquipmentModel[];
  systemName?: string;
  onSelect: (sel: SingleUnitSelection) => void;
  onSaveToLibrary?: (item: Partial<EquipmentModel>) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [filterSubType, setFilterSubType] = useState('all');

  // Generate panel state
  const [showGenerate, setShowGenerate] = useState(false);
  const [genSaving, setGenSaving] = useState(false);
  const [genSpec, setGenSpec] = useState<Partial<EquipmentModel> & { staticPressurePa?: number }>({});

  const isAHU     = systemType === 'AHU';
  const isChiller = systemType === 'Chiller';
  const isDOAS    = systemType === 'DOAS';

  const [libraryPkgItems, setLibraryPkgItems] = useState<EquipmentModel[]>([]);
  useEffect(() => {
    if (!open) return;
    if (isDOAS) {
      getLibraryItemsByType('AHU').then(items => {
        const doasSubTypes = new Set(['ERV', 'HRV', 'DOAS-DX', 'Fresh Air HW']);
        setLibraryPkgItems(items.filter(m => doasSubTypes.has(m.subType ?? '')));
      }).catch(() => {
        const doasSubTypes = new Set(['ERV', 'HRV', 'DOAS-DX', 'Fresh Air HW']);
        setLibraryPkgItems(EQUIPMENT_CATALOG.filter(m => m.type === 'AHU' && doasSubTypes.has(m.subType ?? '')));
      });
    } else {
      getLibraryItemsByType(systemType).then(setLibraryPkgItems).catch(() => {
        setLibraryPkgItems(EQUIPMENT_CATALOG.filter(m => m.type === systemType));
      });
    }
  }, [open, systemType, isDOAS]);

  const subTypes = [...new Set(libraryPkgItems.map(m => m.subType).filter(Boolean))];

  const matchedCustom = (customItems ?? [])
    .filter(m => m.type === systemType)
    .filter(m => !search || m.modelSeries.toLowerCase().includes(search.toLowerCase()) || m.brand.toLowerCase().includes(search.toLowerCase()));

  const items = libraryPkgItems
    .filter(m => systemType !== 'Package' || !packageSubType || packageSubType === 'all' || m.subType === packageSubType)
    .filter(m => filterSubType === 'all' || m.subType === filterSubType)
    .filter(m => !search || m.modelSeries.toLowerCase().includes(search.toLowerCase()) || m.brand.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (isChiller) return a.capacityTR - b.capacityTR;
      const order = { ok: 0, oversized: 1, undersized: 2, unknown: 3 };
      return order[getFitStatus(a.capacityTR, a.ratedAirflowCFM, requiredTR, designCFM)]
           - order[getFitStatus(b.capacityTR, b.ratedAirflowCFM, requiredTR, designCFM)];
    });

  const hasAdequateUnit = isChiller
    ? items.some(m => m.capacityTR >= requiredTR) || matchedCustom.some(m => m.capacityTR >= requiredTR)
    : items.some(m => getFitStatus(m.capacityTR, m.ratedAirflowCFM, requiredTR, designCFM) !== 'undersized')
      || matchedCustom.some(m => getFitStatus(m.capacityTR, m.ratedAirflowCFM, requiredTR, designCFM) !== 'undersized');

  const dialogTitle =
    isAHU     ? 'Select DX Condensing Unit' :
    isChiller ? 'Select Chiller' :
    isDOAS    ? 'Select TFA/DOAS Unit (ERV / HRV / FAHU)' :
    systemType === 'Package' ? 'Select Package Unit' : 'Select Ductable Split Unit';

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] flex flex-col p-0 dark:bg-slate-900">
        <DialogHeader className="px-5 pt-5 pb-3 border-b dark:border-slate-700">
          <DialogTitle className="text-sm font-bold dark:text-slate-100">{dialogTitle}</DialogTitle>
          {requiredTR > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-3 p-2 rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 text-xs">
              <Info className="w-3.5 h-3.5 text-violet-500" />
              <span className="text-violet-700 dark:text-violet-300">Required: <strong>{requiredTR.toFixed(2)} TR</strong></span>
              {!isChiller && designCFM > 0 && <span className="text-violet-700 dark:text-violet-300">Design CFM: <strong>{Math.round(designCFM).toLocaleString()}</strong></span>}
              {isChiller && <span className="text-slate-400 dark:text-slate-500 italic">Select chiller ≥ {requiredTR.toFixed(2)} TR</span>}
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
              <Input className="pl-8 h-8 text-xs" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {subTypes.length > 1 && (
              <Select value={filterSubType} onValueChange={v => setFilterSubType(v ?? 'all')}>
                <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="All Types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {subTypes.map(s => <SelectItem key={s} value={s!}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </DialogHeader>

        {/* Generate Equipment panel */}
        {!hasAdequateUnit && requiredTR > 0 && !showGenerate && (
          <div className="mx-5 mt-3 mb-0 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <p className="text-xs text-amber-800 dark:text-amber-300">No {isDOAS ? 'TFA/DOAS' : systemType} unit in catalog meets <strong>{requiredTR.toFixed(1)} TR</strong> requirement.</p>
            </div>
            <Button size="sm" className="h-8 text-sm shrink-0 bg-amber-600 hover:bg-amber-700 gap-1"
              onClick={() => { setGenSpec(generateEquipmentSpecs(systemType, requiredTR, designCFM, systemName)); setShowGenerate(true); }}>
              <Plus className="w-3 h-3" /> Generate Equipment
            </Button>
          </div>
        )}
        {showGenerate && (
          <div className="mx-5 mt-3 rounded-lg border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-violet-600" />
                <span className="text-sm font-bold text-violet-800 dark:text-violet-300 uppercase tracking-wide">Generate Equipment from Load</span>
              </div>
              <button className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-xs" onClick={() => setShowGenerate(false)}>✕</button>
            </div>

            {/* Engineering logic explanation */}
            <div className="text-xs text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-900/30 rounded px-2.5 py-1.5 space-y-0.5">
              <div>Load: <strong>{requiredTR.toFixed(2)} TR</strong> → +10% safety → {(requiredTR * 1.1).toFixed(1)} TR → rounded to next std size: <strong>{genSpec.capacityTR} TR</strong></div>
              {!isChiller && (
                <div>
                  Airflow = <strong>Design CFM {Math.round(designCFM).toLocaleString()}</strong>
                  <span className="opacity-70">{isDOAS ? ' (OA-driven; independent of coil TR)' : ' (psychrometric DSCFM; independent of plant TR)'}</span>
                </div>
              )}
              {(genSpec as any).staticPressurePa > 0 && <div>ESP: standard {systemType} value = <strong>{paToMmWg((genSpec as any).staticPressurePa)} mm WG</strong></div>}
            </div>

            {/* Editable fields */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div className="flex flex-col gap-0.5">
                <label className="text-xs text-slate-500 dark:text-slate-400">Model name</label>
                <Input className="h-8 text-sm" value={genSpec.modelSeries ?? ''} onChange={e => setGenSpec(s => ({ ...s, modelSeries: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-xs text-slate-500 dark:text-slate-400">Brand</label>
                <Input className="h-8 text-sm" value={genSpec.brand ?? ''} onChange={e => setGenSpec(s => ({ ...s, brand: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-xs text-slate-500 dark:text-slate-400">Capacity (TR)</label>
                <NumericInput className="h-8 text-sm" min={0} value={genSpec.capacityTR ?? undefined} onChange={(n) => setGenSpec(s => ({ ...s, capacityTR: n ?? 0, capacityBTU: (n ?? 0) * 12000 }))} />
              </div>
              {!isChiller && (
                <div className="flex flex-col gap-0.5">
                  <label className="text-xs text-slate-500 dark:text-slate-400">Airflow (CFM)</label>
                  <NumericInput className="h-8 text-sm" min={0} value={genSpec.ratedAirflowCFM ?? undefined} onChange={(n) => setGenSpec(s => ({ ...s, ratedAirflowCFM: n ?? 0 }))} />
                </div>
              )}
              {(isAHU || systemType === 'Package' || systemType === 'DuctableSplit') && (
                <div className="flex flex-col gap-0.5">
                  <label className="text-xs text-slate-500 dark:text-slate-400">ESP (mm WG)</label>
                  <NumericInput className="h-8 text-sm" min={0} value={paToMmWg((genSpec as any).staticPressurePa)} onChange={(n) => setGenSpec(s => ({ ...s, staticPressurePa: mmWgToPa(n) } as any))} />
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                <label className="text-xs text-slate-500 dark:text-slate-400">Power (kW)</label>
                <NumericInput className="h-8 text-sm" min={0} value={genSpec.powerInputKW ?? undefined} onChange={(n) => setGenSpec(s => ({ ...s, powerInputKW: n }))} />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              {onSaveToLibrary && (
                <Button size="sm" className="gap-1 bg-violet-700 hover:bg-violet-800 text-xs" disabled={genSaving}
                  onClick={async () => {
                    setGenSaving(true);
                    try {
                      await onSaveToLibrary(genSpec);
                      const sel: SingleUnitSelection = {
                        modelId: `gen-${Date.now()}`, brand: genSpec.brand ?? 'Custom',
                        modelSeries: genSpec.modelSeries ?? '',
                        trCapacity: Number(genSpec.capacityTR) || 0, cfmRated: Number(genSpec.ratedAirflowCFM) || 0,
                        ...(genSpec.subType ? { subType: genSpec.subType } : {}),
                        ...((genSpec as any).staticPressurePa ? { staticPressurePa: (genSpec as any).staticPressurePa } : {}),
                      };
                      onSelect(sel); onClose();
                    } finally { setGenSaving(false); }
                  }}>
                  {genSaving ? '…' : '💾 Save to Library & Use'}
                </Button>
              )}
              <Button size="sm" variant="outline" className="gap-1 text-xs border-violet-300 text-violet-700"
                onClick={() => {
                  const sel: SingleUnitSelection = {
                    modelId: `gen-${Date.now()}`, brand: genSpec.brand ?? 'Custom',
                    modelSeries: genSpec.modelSeries ?? '',
                    trCapacity: Number(genSpec.capacityTR) || 0, cfmRated: Number(genSpec.ratedAirflowCFM) || 0,
                    ...(genSpec.subType ? { subType: genSpec.subType } : {}),
                    ...((genSpec as any).staticPressurePa ? { staticPressurePa: (genSpec as any).staticPressurePa } : {}),
                  };
                  onSelect(sel); onClose();
                }}>
                Use Once (don't save)
              </Button>
            </div>
          </div>
        )}

        <div className="overflow-y-auto flex-1 min-h-0">
          <Table containerClassName="overflow-x-clip">
            <TableHeader className="sticky top-0 bg-white dark:bg-slate-900 z-10">
              <TableRow className="bg-slate-50 dark:bg-slate-800 text-xs uppercase">
                <TableHead>Brand</TableHead>
                <TableHead className="hidden sm:table-cell">Model</TableHead>
                <TableHead className="hidden sm:table-cell">Sub-Type</TableHead>
                <TableHead className="text-right">TR</TableHead>
                {!isChiller && <TableHead className="text-right">CFM</TableHead>}
                {isAHU && <TableHead className="text-right hidden sm:table-cell">ESP mm WG</TableHead>}
                {!isChiller && <TableHead className="text-center">Fit</TableHead>}
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Custom equipment from library — shown at top */}
              {matchedCustom.length > 0 && (
                <TableRow className="bg-violet-50/50 dark:bg-violet-950/20">
                  <TableCell colSpan={8} className="py-1 px-4">
                    <span className="text-sm font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400">Custom Equipment Library</span>
                  </TableCell>
                </TableRow>
              )}
              {matchedCustom.map(item => {
                const sufficient = isChiller
                  ? item.capacityTR >= requiredTR
                  : getFitStatus(item.capacityTR, item.ratedAirflowCFM, requiredTR, designCFM) !== 'undersized';
                const fit = isChiller ? 'unknown' : getFitStatus(item.capacityTR, item.ratedAirflowCFM, requiredTR, designCFM);
                return (
                  <TableRow key={item.id} className={cn('bg-violet-50/30 dark:bg-violet-950/20 hover:bg-violet-50 dark:hover:bg-violet-950/30', !sufficient && 'opacity-55')}>
                    <TableCell className="font-bold text-xs text-violet-700 dark:text-violet-300">{item.brand}</TableCell>
                    <TableCell className="font-medium text-xs hidden sm:table-cell">
                      {item.modelSeries}
                      <Badge className="ml-1.5 text-xs px-1 py-0 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700">Custom</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 dark:text-slate-400 capitalize hidden sm:table-cell">{item.subType ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold">{item.capacityTR}</TableCell>
                    {!isChiller && <TableCell className="text-right font-mono text-sm">{item.ratedAirflowCFM ? Math.round(item.ratedAirflowCFM).toLocaleString() : '—'}</TableCell>}
                    {isAHU && <TableCell className="text-right font-mono text-sm text-orange-700 font-semibold hidden sm:table-cell">{(item as any).staticPressurePa ? `${paToMmWg((item as any).staticPressurePa)}` : '—'}</TableCell>}
                    {!isChiller && <TableCell className="text-center"><FitBadge status={fit} /></TableCell>}
                    <TableCell>
                      <Button size="sm" variant={sufficient ? 'default' : 'outline'} className="h-8 text-sm px-2"
                        onClick={() => {
                          const sel: SingleUnitSelection = {
                            modelId: item.id, brand: item.brand, modelSeries: item.modelSeries,
                            trCapacity: Number(item.capacityTR) || 0,
                            cfmRated: Number(item.ratedAirflowCFM) || 0,
                          };
                          if (item.subType) sel.subType = item.subType;
                          if ((item as any).staticPressurePa) sel.staticPressurePa = (item as any).staticPressurePa;
                          onSelect(sel);
                          onClose();
                        }}>
                        {sufficient ? 'Select' : '⚠ Select Anyway'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {matchedCustom.length > 0 && (
                <TableRow className="bg-slate-50/50 dark:bg-slate-800/50">
                  <TableCell colSpan={8} className="py-1 px-4">
                    <span className="text-sm font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Catalog</span>
                  </TableCell>
                </TableRow>
              )}
              {items.length === 0 && matchedCustom.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-sm text-slate-400">No units found.</TableCell></TableRow>
              )}
              {items.map(item => {
                const sufficient = isChiller
                  ? item.capacityTR >= requiredTR
                  : getFitStatus(item.capacityTR, item.ratedAirflowCFM, requiredTR, designCFM) !== 'undersized';
                const fit = isChiller ? 'unknown' : getFitStatus(item.capacityTR, item.ratedAirflowCFM, requiredTR, designCFM);
                return (
                  <TableRow key={item.id} className={cn(
                    'hover:bg-blue-50/30 dark:hover:bg-blue-950/20',
                    (fit === 'ok' || (isChiller && sufficient)) && 'bg-emerald-50/20 dark:bg-emerald-950/20',
                    !sufficient && 'opacity-55',
                  )}>
                    <TableCell className="font-bold text-xs">{item.brand}</TableCell>
                    <TableCell className="font-medium text-xs hidden sm:table-cell">{item.modelSeries}</TableCell>
                    <TableCell className="text-xs text-slate-500 dark:text-slate-400 capitalize hidden sm:table-cell">{item.subType ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold">{item.capacityTR}</TableCell>
                    {!isChiller && <TableCell className="text-right font-mono text-sm">{item.ratedAirflowCFM ? Math.round(item.ratedAirflowCFM).toLocaleString() : '—'}</TableCell>}
                    {isAHU && <TableCell className="text-right font-mono text-sm text-orange-700 font-semibold hidden sm:table-cell">{(item as any).staticPressurePa ? `${paToMmWg((item as any).staticPressurePa)}` : '—'}</TableCell>}
                    {!isChiller && <TableCell className="text-center"><FitBadge status={fit} /></TableCell>}
                    <TableCell>
                      <Button size="sm" variant={sufficient ? 'default' : 'outline'} className="h-8 text-sm px-2"
                        onClick={() => {
                          // Guard every field — Firestore rejects undefined, and ERV/HRV
                          // catalog units often have no capacityTR. Omit subType when absent.
                          const sel: SingleUnitSelection = {
                            modelId: item.id, brand: item.brand, modelSeries: item.modelSeries,
                            trCapacity: Number(item.capacityTR) || 0,
                            cfmRated: Number(item.ratedAirflowCFM) || 0,
                          };
                          if (item.subType) sel.subType = item.subType;
                          if ((item as any).staticPressurePa) sel.staticPressurePa = (item as any).staticPressurePa;
                          onSelect(sel);
                          onClose();
                        }}>
                        {sufficient ? 'Select' : '⚠ Select Anyway'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── System Category Guides ───────────────────────────────────────────────────

const SYSTEM_GUIDES: Record<string, { steps: string[]; defaultType: SystemType; note?: string }> = {
  // ── DX Refrigerant Systems ─────────────────────────────────────────────────
  'VRF': {
    defaultType: 'VRF',
    note: 'Refrigerant-based multi-split. One outdoor unit (ODU) serves multiple indoor units — hi-wall, cassette, ductable, or AHU-DX. Best for medium buildings with distributed, independently-controlled zones.',
    steps: [
      'Create a VRF system and name it (e.g. "VRF System 1")',
      'Assign all rooms that this system will serve',
      'Select an IDU (indoor unit) for each assigned room',
      'Select an ODU (outdoor unit) — capacity is auto-calculated with diversity factor',
    ],
  },
  'Package': {
    defaultType: 'Package',
    note: 'Self-contained DX packaged unit (rooftop or floor-standing). Compressor, coil, and blower in one casing. Multiple units can serve one zone. Simple installation; no refrigerant pipework between indoor/outdoor.',
    steps: [
      'Create one Package system per zone (e.g. "PAC-Zone A")',
      'Assign the zone rooms and select the package unit',
    ],
  },
  'DuctableSplit': {
    defaultType: 'DuctableSplit',
    note: 'DX split with a ducted indoor cassette blower. Outdoor compressor unit + indoor ductable unit connected by refrigerant pipes. Non-modular; well suited for small to medium zones with concealed ducts.',
    steps: [
      'Create one Ductable Split system per zone',
      'Assign rooms and select the unit',
    ],
  },
  'Split': {
    defaultType: 'Split',
    note: 'Dedicated wall-mounted split unit per room or small area. Room-by-room DX cooling; completely independent control and service. Simplest system to install, maintain, and expand.',
    steps: [
      'Create one Split system per room or area needing a dedicated unit',
      'Assign the room and select the cooling-only or heat-pump split unit',
    ],
  },
  // ── Chilled Water — Water-Cooled ──────────────────────────────────────────
  'Chiller WC': {
    defaultType: 'Chiller',
    note: 'Water-cooled chiller + cooling tower. Hydronic system serving all indoor types — AHU, TFA, FCU, cassette fan coils, hi-wall fan coils. Highest system COP; suited for large buildings.',
    steps: [
      'Create a Chiller Plant system — assign all rooms to calculate total TR, then select chiller',
      'Create AHU / TFA / FCU systems per zone as needed — assign rooms and select indoor units',
    ],
  },
  // ── Chilled Water — Air-Cooled ────────────────────────────────────────────
  'Chiller AC': {
    defaultType: 'Chiller',
    note: 'Air-cooled chiller — no cooling tower required. Same hydronic indoor flexibility as WC: AHU, TFA, FCU, cassette, hi-wall fan coils. Simpler plant room; slightly lower COP than water-cooled.',
    steps: [
      'Create a Chiller Plant system — assign all rooms, select air-cooled chiller',
      'Create AHU / TFA / FCU systems per zone as needed — assign rooms and select indoor units',
    ],
  },
  // ── Hybrid / Mixed ─────────────────────────────────────────────────────────
  'Hybrid': {
    defaultType: 'VRF',
    note: 'Multiple system types in one project — e.g. VRF for offices, Chiller+AHU for large halls, Split for server rooms. Maximum design flexibility; each system is sized and selected independently.',
    steps: [
      'Create systems of any type as required (VRF, AHU, Chiller, Package, Split…)',
      'Assign rooms to each system — no room should be left unassigned',
      'Select equipment for each system individually',
    ],
  },
  // ── Legacy keys — backward compatibility for existing projects ─────────────
  'Chiller+AHU': {
    defaultType: 'Chiller',
    note: 'Chiller plant with central AHU distribution per zone.',
    steps: [
      'Create a Chiller Plant system — assign all rooms to sum total TR, then select chiller',
      'Create one AHU system per zone (e.g. "AHU-GF", "AHU-FF")',
      'Assign the zone\'s rooms to each AHU system and select the AHU unit',
    ],
  },
  'Chiller+FCU': {
    defaultType: 'Chiller',
    note: 'Chiller plant with room-level fan coil units.',
    steps: [
      'Create a Chiller Plant system — assign all rooms, select chiller',
      'Create FCU systems per zone — assign rooms and select FCU units',
    ],
  },
};

// Maps hvacSystemCategory → primary system type + condenser type + layout behaviour
// Maps hvacSystemCategory → default type + condenserType for the auto-created first system.
// A project can always hold multiple systems of any type — this just seeds the first one.
const CATEGORY_CONFIG: Record<string, {
  type: SystemType;
  condenserType?: 'water-cooled' | 'air-cooled';
  autoName: string;
}> = {
  'VRF':          { type: 'VRF',          autoName: 'VRF System'    },
  'Package':      { type: 'Package',       autoName: 'Package System'},
  'DuctableSplit':{ type: 'DuctableSplit', autoName: 'DX Split System'},
  'Split':        { type: 'Split',         autoName: 'Split Units'   },
  'Chiller WC':   { type: 'Chiller', condenserType: 'water-cooled', autoName: 'Chiller Plant' },
  'Chiller AC':   { type: 'Chiller', condenserType: 'air-cooled',   autoName: 'Chiller Plant' },
  'Hybrid':       { type: 'VRF',           autoName: 'System'        },
  'Chiller+AHU':  { type: 'Chiller', condenserType: 'water-cooled', autoName: 'Chiller Plant' },
  'Chiller+FCU':  { type: 'Chiller', condenserType: 'water-cooled', autoName: 'Chiller Plant' },
};


// Derive hvacSystemCategory from legacy project.systemType when no explicit category is set
// Dehumidification strategy block — one per zone (or per zoneless system). Engineer picks
// one of four strategies; we show the right sizing for each and (for method 2) sync the
// AHU electric-heater config so AHU Configuration reflects it as a single source of truth.
function DehumidificationStrategySection({
  scopeLabel,
  latentLbsHr,
  reheatBTU,
  method,
  reheatKWOverride,
  units,
  isVRF,
  hasHeatingCoilInAHU,
  isSystemLevel,
  models,
  onChangeMethod,
  onChangeReheatKWOverride,
  onAddDehumidifier,
  onRemoveDehumidifier,
  onUpdateDehumidifierQty,
}: {
  scopeLabel: string;
  latentLbsHr: number;
  reheatBTU: number;
  method: DehumidMethod | null;
  reheatKWOverride?: number;
  units: DehumidifierUnit[];
  isVRF: boolean;
  hasHeatingCoilInAHU: boolean;
  isSystemLevel: boolean;
  models: EquipmentModel[];
  onChangeMethod: (m: DehumidMethod | null) => void | Promise<void>;
  onChangeReheatKWOverride: (kw: number | null) => void | Promise<void>;
  onAddDehumidifier: (model: EquipmentModel) => void | Promise<void>;
  onRemoveDehumidifier: (idx: number) => void | Promise<void>;
  onUpdateDehumidifierQty: (idx: number, qty: number) => void | Promise<void>;
}) {
  const latentKgH = latentLbsHr * LBS_PER_HR_TO_LPH;
  const computedReheatKW = reheatBTU / BTUH_PER_KW;
  const effectiveReheatKW = Number.isFinite(reheatKWOverride as number) && (reheatKWOverride as number) > 0
    ? (reheatKWOverride as number)
    : computedReheatKW;

  // Method 1 (HW coil) is only valid when there's an AHU with a heating coil, and never on VRF.
  // System-level (zoneless) systems don't have a zone AHU so the HW coil method is also hidden.
  const methodAvailability: Record<DehumidMethod, { available: boolean; reason?: string }> = {
    'reheat-hwc':          isVRF
      ? { available: false, reason: 'Not applicable to VRF (no AHU heating coil)' }
      : isSystemLevel
        ? { available: false, reason: 'No zone-AHU heating coil for system-level scope' }
        : hasHeatingCoilInAHU
          ? { available: true }
          : { available: false, reason: 'Enable AHU heating coil in AHU Configuration first' },
    'reheat-electric-ahu': isSystemLevel
      ? { available: false, reason: 'No zone-AHU for system-level scope' }
      : { available: true },
    'reheat-duct':         { available: true },
    'standalone':          { available: true },
  };

  const isReheatMethod = method === 'reheat-hwc' || method === 'reheat-electric-ahu' || method === 'reheat-duct';

  return (
    <div className="rounded-lg border border-cyan-200 dark:border-cyan-800 bg-cyan-50/40 dark:bg-cyan-950/10 px-3 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs font-bold uppercase text-cyan-700 dark:text-cyan-300">
          Dehumidification — {scopeLabel}
        </div>
        <div className="text-xs flex items-center gap-4 flex-wrap">
          <span>
            <span className="text-slate-500 dark:text-slate-400">Latent: </span>
            <span className="font-semibold text-cyan-900 dark:text-cyan-200">
              {latentKgH.toFixed(1)} kg/h <span className="text-slate-400">({latentLbsHr.toFixed(1)} lb/h)</span>
            </span>
          </span>
          <span>
            <span className="text-slate-500 dark:text-slate-400">Reheat needed: </span>
            <span className="font-semibold text-rose-700 dark:text-rose-300">
              {computedReheatKW.toFixed(2)} kW <span className="text-slate-400">({Math.round(reheatBTU).toLocaleString()} BTU/h)</span>
            </span>
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        {(Object.keys(DEHUMID_METHOD_LABELS) as DehumidMethod[]).map(m => {
          const avail = methodAvailability[m];
          const checked = method === m;
          const label = DEHUMID_METHOD_LABELS[m];
          return (
            <label
              key={m}
              className={cn(
                'flex items-start gap-2 text-sm',
                avail.available ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
              )}
              title={avail.reason ?? ''}
            >
              <input
                type="radio"
                name={`dehumid-method-${scopeLabel}`}
                checked={checked}
                disabled={!avail.available}
                onChange={() => avail.available && onChangeMethod(m)}
                className="mt-0.5 accent-cyan-600"
              />
              <span className={cn('font-medium', checked ? 'text-cyan-800 dark:text-cyan-200' : 'text-slate-700 dark:text-slate-300')}>
                {label}
                {!avail.available && avail.reason && (
                  <span className="ml-2 text-xs text-slate-400 dark:text-slate-500 italic">— {avail.reason}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>

      {/* Conditional sub-section based on method */}
      {isReheatMethod && (
        <div className="border-t border-cyan-200 dark:border-cyan-800 pt-2 space-y-1">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-slate-600 dark:text-slate-400 font-medium">
              {method === 'reheat-duct' ? 'Duct heater capacity' : method === 'reheat-hwc' ? 'HW coil heating capacity' : 'Electric heater capacity'}:
            </span>
            <input
              type="number"
              min={0}
              step="0.1"
              value={Number.isFinite(reheatKWOverride as number) && (reheatKWOverride as number) > 0 ? reheatKWOverride : ''}
              placeholder={computedReheatKW.toFixed(2)}
              onChange={e => {
                const raw = e.target.value.trim();
                if (raw === '') return onChangeReheatKWOverride(null);
                const v = Number(raw);
                if (Number.isFinite(v) && v >= 0) onChangeReheatKWOverride(v);
              }}
              className="h-7 w-20 text-xs text-right rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5"
            />
            <span className="text-slate-500 dark:text-slate-400">kW</span>
            {reheatKWOverride != null && reheatKWOverride > 0 && (
              <button
                type="button"
                onClick={() => onChangeReheatKWOverride(null)}
                className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
              >
                reset to auto ({computedReheatKW.toFixed(2)} kW)
              </button>
            )}
            <span className="text-xs text-slate-400 dark:text-slate-500 italic">
              · using {effectiveReheatKW.toFixed(2)} kW
            </span>
          </div>
          {method === 'reheat-electric-ahu' && (
            <div className="text-xs text-emerald-700 dark:text-emerald-400 pl-1">✓ Synced to AHU Configuration (Electric Heater enabled)</div>
          )}
          {method === 'reheat-hwc' && (
            <div className="text-xs text-cyan-700 dark:text-cyan-400 pl-1">Heating coil in AHU is sized against this reheat duty in monsoon mode.</div>
          )}
          {method === 'reheat-duct' && (
            <div className="text-xs text-cyan-700 dark:text-cyan-400 pl-1">Add this duct heater to your equipment schedule separately.</div>
          )}
        </div>
      )}

      {method === 'standalone' && (
        <div className="border-t border-cyan-200 dark:border-cyan-800 pt-2">
          <DehumidifierPickerRow
            scopeLabel={scopeLabel}
            requiredLPH={latentKgH}
            units={units}
            models={models}
            onAdd={onAddDehumidifier}
            onRemove={onRemoveDehumidifier}
            onUpdateQty={onUpdateDehumidifierQty}
            embedded
          />
        </div>
      )}
    </div>
  );
}

// Dehumidifier picker — one row per scope (whole system, or one AHU zone). Lets the
// designer pick a catalog dehumidifier, set a quantity, see installed-vs-required, and
// remove units. Stays inline (no dialog) — the dropdown lists ~10 models so a full
// dialog adds friction without payoff. `embedded` strips the outer cyan card when this
// renders inside the wider Dehumidification Strategy block.
function DehumidifierPickerRow({
  scopeLabel,
  requiredLPH,
  units,
  models,
  onAdd,
  onRemove,
  onUpdateQty,
  embedded = false,
}: {
  scopeLabel: string;
  requiredLPH: number;
  units: DehumidifierUnit[];
  models: EquipmentModel[];
  onAdd: (model: EquipmentModel) => void | Promise<void>;
  onRemove: (idx: number) => void | Promise<void>;
  onUpdateQty: (idx: number, qty: number) => void | Promise<void>;
  embedded?: boolean;
}) {
  const [pickedId, setPickedId] = useState<string>('');

  const installedLPH = units.reduce((s, u) => s + (Number(u.capacityLPH) || 0) * (Number(u.quantity) || 1), 0);
  const coverage = requiredLPH > 0 ? (installedLPH / requiredLPH) * 100 : 0;
  const coverageBadge =
    requiredLPH === 0
      ? null
      : coverage >= 100
        ? <span className="text-emerald-700 dark:text-emerald-400 font-semibold">✓ {coverage.toFixed(0)}% covered</span>
        : <span className="text-amber-700 dark:text-amber-400 font-semibold">⚠ {coverage.toFixed(0)}% — undersized</span>;

  const handleAdd = () => {
    if (!pickedId) return;
    const model = models.find(m => m.id === pickedId);
    if (!model) return;
    void onAdd(model);
    setPickedId('');
  };

  return (
    <div className={embedded ? 'space-y-2' : 'rounded-lg border border-cyan-200 dark:border-cyan-800 bg-cyan-50/40 dark:bg-cyan-950/10 px-3 py-3 space-y-2'}>
      {!embedded && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs font-bold uppercase text-cyan-700 dark:text-cyan-300">
            Dehumidifier — {scopeLabel}
          </div>
          <div className="text-xs">
            <span className="text-slate-500 dark:text-slate-400">Required: </span>
            <span className="font-semibold text-cyan-900 dark:text-cyan-200">
              {(requiredLPH * 1.0).toFixed(1)} kg/h ({requiredLPH.toFixed(1)} LPH)
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={pickedId}
          onChange={e => setPickedId(e.target.value)}
          className="h-8 text-xs rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 min-w-[260px]"
        >
          <option value="">— Pick a dehumidifier model —</option>
          {models.map(m => (
            <option key={m.id} value={m.id}>
              {m.brand} {m.modelSeries} — {m.capacityLPH} LPH ({m.subType ?? 'Dehumidifier'})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!pickedId}
          className="h-8 px-3 text-xs font-semibold rounded-md bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-300 disabled:dark:bg-slate-700 disabled:cursor-not-allowed text-white"
        >
          + Add
        </button>
      </div>

      {units.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-slate-500 dark:text-slate-400 border-b dark:border-slate-700">
                <th className="text-left py-1 pr-3 font-semibold">Model</th>
                <th className="text-right py-1 px-2 font-semibold">Per Unit</th>
                <th className="text-right py-1 px-2 font-semibold">Qty</th>
                <th className="text-right py-1 px-2 font-semibold">Total</th>
                <th className="text-right py-1 pl-2 font-semibold">&nbsp;</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {units.map((u, idx) => {
                const totalLPH = (Number(u.capacityLPH) || 0) * (Number(u.quantity) || 1);
                return (
                  <tr key={`${u.modelId}-${idx}`}>
                    <td className="py-1 pr-3 dark:text-slate-300">
                      <span className="font-semibold">{u.brand}</span> {u.modelSeries}
                      {u.subType && <span className="text-slate-400 dark:text-slate-500"> · {u.subType}</span>}
                    </td>
                    <td className="text-right py-1 px-2 dark:text-slate-300">{u.capacityLPH} LPH</td>
                    <td className="text-right py-1 px-2">
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={u.quantity}
                        onChange={e => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v >= 1 && v <= 20) onUpdateQty(idx, v);
                        }}
                        className="h-7 w-14 text-xs text-right rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1"
                      />
                    </td>
                    <td className="text-right py-1 px-2 font-semibold dark:text-slate-200">{totalLPH.toFixed(1)} LPH</td>
                    <td className="text-right py-1 pl-2">
                      <button
                        type="button"
                        onClick={() => onRemove(idx)}
                        className="text-rose-600 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300"
                        title="Remove"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-1 text-xs flex items-center justify-end gap-3">
            <span className="text-slate-500 dark:text-slate-400">
              Installed: <span className="font-semibold dark:text-slate-200">{installedLPH.toFixed(1)} LPH</span>
            </span>
            {coverageBadge}
          </div>
        </div>
      )}
    </div>
  );
}

function deriveCategory(projectSystemType?: string): string {
  const map: Record<string, string> = {
    'VRF':      'VRF',
    'Hydronic': 'Chiller WC',
    'Chiller':  'Chiller WC',
    'Hybrid':   'Hybrid',
  };
  return map[projectSystemType ?? ''] ?? '';
}

// Infer the hvacSystemCategory from an existing equipmentSystems doc when the project never
// persisted one. Lets Equipment Selection recover a system on load even if the project's
// systemType/hvacSystemCategory is missing — otherwise auto-init bails and the screen sits
// blank ("Select a system") even though a system exists in the database.
function inferCategoryFromSystem(sys: any): string {
  if (!sys?.type) return '';
  const cond = sys.condenserType ?? sys.packageSubType ?? null;
  for (const [cat, cfg] of Object.entries(CATEGORY_CONFIG)) {
    if (cat === 'Hybrid') continue;
    if (cfg.type !== sys.type) continue;
    if (cfg.condenserType && cond && cfg.condenserType !== cond) continue;
    return cat;
  }
  return '';
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function EquipmentSelection({
  project, userProfile, userRole, onProjectChange,
}: {
  project: any;
  userProfile: any;
  userRole?: string | null;
  onProjectChange?: (project: any) => void;
}) {
  const [equipSystems, setEquipSystems] = useState<EquipmentSystem[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const lsKey = project?.id ? `hvac_sel_sys_${project.id}` : null;
  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(
    () => (lsKey ? localStorage.getItem(lsKey) : null),
  );
  const [allProjects, setAllProjects] = useState<any[]>([]);
  // Tracks which category we've already auto-initialised to avoid duplicate creates
  const categoryInitRef = useRef<string | null>(null);
  // Flips true once the equipmentSystems snapshot has arrived at least once
  const systemsLoadedRef = useRef(false);

  // New system form state
  const [showNewSystem, setShowNewSystem] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<SystemType>('VRF');
  const [newPkgSubType, setNewPkgSubType] = useState<'air-cooled' | 'water-cooled'>('air-cooled');
  const [newBrand, setNewBrand] = useState('');
  const [newBrandCustom, setNewBrandCustom] = useState('');
  const [creatingSystem, setCreatingSystem] = useState(false);

  // HVAC system category (stored on project doc, drives guided setup)
  const [hvacSystemCategory, setHvacSystemCategory] = useState<string>(project?.hvacSystemCategory ?? '');

  // Quantity state — per-room IDU qty and single-unit qty, keyed by selectedSystemId
  const [roomQuantities, setRoomQuantities] = useState<Record<string, number>>({});
  const [unitQuantity, setUnitQuantity] = useState(1);
  // DOAS tile: collapse supply/ERV/cooling-source/zone-links into "Advanced" — fresh
  // air is set per-room in the Load Calculator now (Phase 1 simplification).
  const [showDoasAdvanced, setShowDoasAdvanced] = useState(false);

  // Picker dialog state
  const [iduPicker, setIduPicker] = useState<{ roomId: string; roomName: string; reqTR: number; reqCFM: number } | null>(null);
  const [oduPicker, setOduPicker] = useState(false);
  const [unitPicker, setUnitPicker] = useState(false);
  const [humidPicker, setHumidPicker] = useState<{ zoneId: string; suggestedKgHr: number } | null>(null);
  // Zone state
  const [zoneMode, setZoneMode] = useState(false);
  const [zoneSelected, setZoneSelected] = useState<Set<string>>(new Set());
  const [zonePicker, setZonePicker] = useState<{ zoneId: string; zoneName: string; totalTR: number; totalCFM: number; coilTR?: number; systemType?: string } | null>(null);
  // Non-VRF zone terminal unit picker (Chiller terminal AHU/FCU per zone)
  const [zoneTerminalPicker, setZoneTerminalPicker] = useState<{ zoneId: string; zoneName: string; totalTR: number; totalCFM: number; coilTR?: number; systemType?: string } | null>(null);
  // Cooling Tower form
  const [ctFormOpen, setCtFormOpen] = useState(false);
  const [ctForm, setCtForm] = useState<{ brand: string; modelSeries: string; trCapacity: number; quantity: number }>({ brand: '', modelSeries: '', trCapacity: 0, quantity: 1 });
  // Zone management (universal — VRF / Chiller / Split / DuctableSplit)
  const [addRoomsZoneId, setAddRoomsZoneId] = useState<string | null>(null);
  const [addRoomsSelected, setAddRoomsSelected] = useState<Set<string>>(new Set());
  const [showLcZonePicker, setShowLcZonePicker] = useState(false);
  const [renamingZoneId, setRenamingZoneId] = useState<string | null>(null);
  const [renamingZoneName, setRenamingZoneName] = useState('');
  const [zoneEquipPicker, setZoneEquipPicker] = useState<{ zoneId: string; zoneName: string; totalTR: number; totalCFM: number; coilTR?: number; systemType?: string } | null>(null);
  const [zoneMultiUnitPicker, setZoneMultiUnitPicker] = useState<{ zoneId: string; zoneName: string; totalTR: number; totalCFM: number; coilTR?: number; systemType?: string } | null>(null);
  const [roomUnitPicker, setRoomUnitPicker] = useState<{ roomId: string; roomName: string; reqTR: number; reqCFM: number } | null>(null);

  // Zone AHU config collapse/expand — collapsed by default so rooms+zones are visible first
  const [expandedZoneConfigIds, setExpandedZoneConfigIds] = useState<Set<string>>(new Set());

  // Custom equipment library
  const [customEquipment, setCustomEquipment] = useState<EquipmentModel[]>([]);
  const [showCustomLibrary, setShowCustomLibrary] = useState(false);
  const [ceForm, setCeForm] = useState<Partial<EquipmentModel> & { id?: string }>({});
  const [ceEditing, setCeEditing] = useState<string | null>(null);

  // Zone ↔ System sync
  const [syncDialog, setSyncDialog] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  // zoneMapping: maps LC zone name → equipment system ID (for manual Pull mapping)
  const [zoneMapping, setZoneMapping] = useState<Record<string, string>>({});

  // Inline system editing
  const [editingSystemId, setEditingSystemId] = useState<string | null>(null);
  const [editingSystemName, setEditingSystemName] = useState('');
  const [editingSystemType, setEditingSystemType] = useState<SystemType>('VRF');
  // Pending type-change confirmation — set when user clicks Save with a different type
  const [typeChangeConfirm, setTypeChangeConfirm] = useState<{ systemId: string; oldType: SystemType; newType: SystemType; newName: string } | null>(null);

  // Live recalculation — zone design conditions + per-room results
  const [zoneDocs, setZoneDocs] = useState<any[]>([]);

  // Active tab — controlled so Summary tab can jump back to System Design
  const [activeTab, setActiveTab] = useState('systems');

  const [drawings, setDrawings] = useState<{ id: string; name: string; type: string; format: string; version: string; downloadURL: string; uploadedAt?: any; sizeBytes?: number }[]>([]);
  const [uploadingDrawing, setUploadingDrawing] = useState(false);
  const drawingFileRef = useRef<HTMLInputElement>(null);

  // ── Firestore listeners ────────────────────────────────────────────────────

  // Load all accessible projects for the project switcher dropdown (one-time read, not a live listener)
  useEffect(() => {
    if (!userProfile?.uid) return;
    const q = userRole === 'Super'
      ? query(collection(db, 'projects'), orderBy('updatedAt', 'desc'), limit(100))
      : query(collection(db, 'projects'), where('userId', '==', userProfile.uid), orderBy('updatedAt', 'desc'), limit(100));
    getDocs(q).then(snap => {
      setAllProjects(snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, name: data.name ?? '', location: data.location ?? '' };
      }));
    }).catch(() => {});
  }, [userProfile?.uid, userRole]);

  useEffect(() => {
    setEquipSystems([]);
    setRooms([]);
    setSelectedSystemId(null);
    categoryInitRef.current = null;
    // Use explicit hvacSystemCategory, or fall back to deriving from project.systemType
    const cat = project?.hvacSystemCategory || deriveCategory(project?.systemType ?? project?.data?.systemType);
    setHvacSystemCategory(cat);
    // Persist the derived category so future loads don't need to re-derive
    if (!project?.hvacSystemCategory && cat) {
      updateDoc(doc(db, 'projects', project.id), { hvacSystemCategory: cat, updatedAt: serverTimestamp() }).catch(err => {
        console.error('Persist hvacSystemCategory failed:', err);
      });
    }
    setRoomQuantities({});
    setUnitQuantity(1);
  }, [project?.id]);

  // Auto-initialise the primary system when category + system list are both ready
  useEffect(() => {
    if (!hvacSystemCategory) return;
    const config = CATEGORY_CONFIG[hvacSystemCategory];
    // Hybrid has manual system creation; skip auto-init
    if (!config || hvacSystemCategory === 'Hybrid') return;
    // Only run once per category change
    if (categoryInitRef.current === hvacSystemCategory) return;

    // Find an existing system of the right type/condenserType
    const existing = equipSystems.find(s =>
      s.type === config.type &&
      (!config.condenserType || s.condenserType === config.condenserType),
    );
    if (existing) {
      // Lock now that we've confirmed we have real data — prevents duplicate creates
      categoryInitRef.current = hvacSystemCategory;
      setSelectedSystemId(existing.id);
      return;
    }

    // Don't create until the snapshot has arrived at least once.
    // Without this guard, the effect fires with equipSystems=[] before Firestore responds,
    // creates a new empty system, and then locks the ref — so the real data is never selected.
    if (!systemsLoadedRef.current) return;

    // No matching system and data has loaded — safe to auto-create
    categoryInitRef.current = hvacSystemCategory;
    addDoc(collection(db, 'projects', project.id, 'equipmentSystems'), {
      name:          config.autoName,
      type:          config.type,
      condenserType: config.condenserType ?? null,
      packageSubType: config.condenserType ?? null, // backward compat for Package queries
      brand:          null,
      brandLocked:    false,
      diversityFactor: 0.75,
      assignedRoomIds: [],
      iduSelections:   {},
      oduSelection:    null,
      unitSelection:   null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).then(ref => setSelectedSystemId(ref.id)).catch(err => {
      // Surface the failure instead of leaving an empty system list with no feedback,
      // and release the lock so the effect can retry (otherwise it stays empty all session).
      categoryInitRef.current = null;
      console.error('Auto-create equipment system failed:', err);
      toast.error(
        (err as any)?.code === 'permission-denied'
          ? 'Could not create the equipment system — you may not have edit permission for this project.'
          : `Could not create the equipment system — ${(err as any)?.message ?? 'unknown error'}`,
      );
    });
  }, [hvacSystemCategory, equipSystems]);

  // Fallback selection — recover from a blank screen. If systems are loaded but nothing valid
  // is selected (e.g. the project's hvacSystemCategory was never persisted, so the auto-init
  // effect above bailed on `!hvacSystemCategory`), select the existing primary system and adopt
  // its category. Without this, navigating back to Equipment Selection shows "Select a system"
  // even though the Chiller Plant exists in the database — the "system disappeared" symptom.
  useEffect(() => {
    if (!systemsLoadedRef.current || equipSystems.length === 0) return;
    const valid = selectedSystemId && equipSystems.some(s => s.id === selectedSystemId);
    if (valid) return;
    const primary = equipSystems.find(s => s.type !== 'DOAS') ?? equipSystems[0];
    if (!primary) return;
    setSelectedSystemId(primary.id);
    if (!hvacSystemCategory) {
      const inferred = inferCategoryFromSystem(primary);
      if (inferred) setHvacSystemCategory(inferred);
    }
  }, [equipSystems, selectedSystemId, hvacSystemCategory]);

  // Re-initialize quantities when user switches to a different system
  useEffect(() => {
    const sys = equipSystems.find(s => s.id === selectedSystemId);
    if (!sys) { setRoomQuantities({}); setUnitQuantity(1); return; }
    const qtys: Record<string, number> = {};
    rooms.filter((r: any) => r.zoneId === sys.id || r.systemId === sys.id).forEach((r: any) => {
      qtys[r.id] = normalizeIDUList(sys.iduSelections[r.id]).reduce((s, u) => s + (u.quantity ?? 1), 1);
    });
    setRoomQuantities(qtys);
    setUnitQuantity(sys.unitSelection?.quantity ?? 1);
  }, [selectedSystemId]); // intentionally only on system switch, not on every data update

  useEffect(() => {
    if (!lsKey) return;
    if (selectedSystemId) localStorage.setItem(lsKey, selectedSystemId);
    else localStorage.removeItem(lsKey);
  }, [selectedSystemId, lsKey]);

  useEffect(() => {
    if (!project?.id) return;
    systemsLoadedRef.current = false; // reset on project change
    const unsub = onSnapshot(
      collection(db, 'projects', project.id, 'equipmentSystems'),
      snap => {
        systemsLoadedRef.current = true;
        const raw = snap.docs.map(d => ({ id: d.id, ...d.data() } as EquipmentSystem));

        // Step 1: deduplicate by Firestore document ID
        const seenIds = new Set<string>();
        const idDeduped = raw.filter(s => {
          if (seenIds.has(s.id)) return false;
          seenIds.add(s.id);
          return true;
        });

        // Step 2: deduplicate stale docs with same type+name — keep most recently updated
        const nameKey = (s: EquipmentSystem) =>
          `${String(s.type || '')}|${String(s.name || s.id).toLowerCase().trim()}`;
        const nameMap = new Map<string, EquipmentSystem[]>();
        idDeduped.forEach(s => {
          const k = nameKey(s);
          if (!nameMap.has(k)) nameMap.set(k, []);
          nameMap.get(k)!.push(s);
        });
        const nameDeduped = Array.from(nameMap.values()).map(group => {
          if (group.length === 1) return group[0];
          return group.reduce((best, s) => {
            const tBest = (best as any).updatedAt?.seconds ?? 0;
            const tS    = (s as any).updatedAt?.seconds    ?? 0;
            return tS > tBest ? s : best;
          }, group[0]);
        });

        // Step 3: if any Chiller uses zone-based setup, remove legacy unitSelection-only Chillers
        const hasZoneBasedChiller = nameDeduped.some(s =>
          s.type === 'Chiller' &&
          ((s as any).zones ?? []).some((z: any) => z.selection || (z.unitSelections ?? []).length > 0)
        );
        const deduped = hasZoneBasedChiller
          ? nameDeduped.filter(s => {
              if (s.type !== 'Chiller') return true;
              const hasZones = ((s as any).zones ?? []).some((z: any) => z.selection || (z.unitSelections ?? []).length > 0);
              if (hasZones) return true;
              return !((s as any).unitSelection || ((s as any).chillerUnits ?? []).length > 0);
            })
          : nameDeduped;

        setEquipSystems(deduped);
      },
      // Without an error callback a failed read (permission / network / offline-cache
      // hiccup on remount) silently leaves the systems list empty with no feedback —
      // which reads to the user as "my equipment system disappeared / didn't save".
      err => {
        systemsLoadedRef.current = true; // unblock auto-init retry rather than hang
        console.error('equipmentSystems listener error:', err);
        toast.error(
          (err as any)?.code === 'permission-denied'
            ? 'Could not load equipment systems — permission denied for this project.'
            : `Could not load equipment systems — ${(err as any)?.message ?? 'connection error'}. Reopen the project to retry.`,
        );
      },
    );
    return () => unsub();
  }, [project?.id]);

  useEffect(() => {
    if (!project?.id) return;
    const unsub = onSnapshot(
      collection(db, 'projects', project.id, 'rooms'),
      snap => {
        setRooms(snap.docs.map(d => ({
          id: d.id,
          zoneId: d.data().zoneId ?? 'default',
          zoneName: d.data().zoneName ?? 'Zone',
          ...d.data(),
        })));
      },
      err => {
        console.error('rooms listener error:', err);
        toast.error(`Could not load rooms — ${(err as any)?.message ?? 'connection error'}.`);
      },
    );
    return () => unsub();
  }, [project?.id]);

  // Zone design conditions — needed for live recalculation
  useEffect(() => {
    if (!project?.id) return;
    const unsubZones = onSnapshot(collection(db, 'projects', project.id, 'zones'), snap => {
      setZoneDocs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsubZones();
  }, [project?.id]);

  // Drawings listener — no orderBy to avoid needing a Firestore index; sort in memory
  useEffect(() => {
    if (!project?.id) return;
    const unsub = onSnapshot(
      collection(db, 'projects', project.id, 'drawings'),
      snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        docs.sort((a, b) => {
          const ta = a.uploadedAt?.toMillis?.() ?? 0;
          const tb = b.uploadedAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
        setDrawings(docs);
      },
      err => handleFirestoreError(err, OperationType.LIST, `projects/${project.id}/drawings`),
    );
    return () => unsub();
  }, [project?.id]);

  // Custom equipment library — only load when the library panel is open
  useEffect(() => {
    if (!showCustomLibrary) { setCustomEquipment([]); return; }
    const unsub = onSnapshot(
      query(collection(db, 'customEquipment'), orderBy('createdAt', 'desc')),
      snap => setCustomEquipment(snap.docs.map(d => ({ id: d.id, ...d.data() } as EquipmentModel))),
    );
    return () => unsub();
  }, [showCustomLibrary]);

  // ── Drawing upload ─────────────────────────────────────────────────────────
  const handleDrawingUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project?.id) return;
    e.target.value = '';
    setUploadingDrawing(true);
    try {
      const ext = file.name.split('.').pop()?.toUpperCase() ?? '';
      const path = `projects/${project.id}/drawings/${Date.now()}_${file.name}`;
      const sRef = storageRef(storage, path);
      const task = uploadBytesResumable(sRef, file);
      await new Promise<void>((resolve, reject) => {
        task.on('state_changed', null, reject, resolve);
      });
      const downloadURL = await getDownloadURL(sRef);
      await addDoc(collection(db, 'projects', project.id, 'drawings'), {
        name: file.name.replace(/\.[^.]+$/, ''),
        type: 'General',
        format: ext,
        version: 'V1.0',
        downloadURL,
        storagePath: path,
        uploadedAt: serverTimestamp(),
        sizeBytes: file.size,
      });
      toast.success(`"${file.name}" uploaded`);
    } catch (err) {
      toast.error('Upload failed');
      console.error(err);
    } finally {
      setUploadingDrawing(false);
    }
  };

  const handleDrawingDelete = async (drawing: { id: string; name: string; storagePath?: string }) => {
    if (!project?.id) return;
    if (!window.confirm(`Delete "${drawing.name}"? This cannot be undone.`)) return;
    try {
      if (drawing.storagePath) {
        await import('firebase/storage').then(({ deleteObject }) =>
          deleteObject(storageRef(storage, drawing.storagePath!))
        ).catch(() => {});
      }
      await deleteDoc(doc(db, 'projects', project.id, 'drawings', drawing.id));
      toast.success(`"${drawing.name}" deleted`);
    } catch (err) {
      toast.error('Delete failed');
      console.error(err);
    }
  };

  // ── System CRUD ────────────────────────────────────────────────────────────

  const createSystem = async () => {
    if (!newName.trim()) { toast.error('System name required'); return; }
    const finalBrand = newType === 'VRF'
      ? (newBrand === '__other__' ? newBrandCustom.trim() || null : newBrand || null)
      : null;
    setCreatingSystem(true);
    try {
      // Derive condenserType from hvacSystemCategory when creating a Chiller system
      const derivedCondenserType = newType === 'Chiller'
        ? (CATEGORY_CONFIG[hvacSystemCategory]?.condenserType ?? null)
        : null;
      const ref = await addDoc(collection(db, 'projects', project.id, 'equipmentSystems'), {
        name: newName.trim(),
        type: newType,
        condenserType: derivedCondenserType,
        ...(newType === 'Package' ? { packageSubType: newPkgSubType } : {}),
        brand: finalBrand,
        brandLocked: !!finalBrand,
        diversityFactor: 0.75,
        assignedRoomIds: [],
        iduSelections: {},
        oduSelection: null,
        unitSelection: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSelectedSystemId(ref.id);
      setShowNewSystem(false);
      setNewName('');
      setNewType('VRF');
      setNewBrand('');
      setNewBrandCustom('');
      toast.success(`System "${newName.trim()}" created`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `projects/${project.id}/equipmentSystems`);
    } finally {
      setCreatingSystem(false);
    }
  };

  const deleteSystem = async (systemId: string) => {
    try {
      const sys = equipSystems.find(s => s.id === systemId);
      // Deleting a TFA/DOAS unit: detach its rooms (clear the pinned doasId + set them back to
      // "on the room unit") so the resolver doesn't silently re-route them to another DOAS.
      if (sys?.type === 'DOAS') {
        const batch = writeBatch(db);
        let n = 0;
        for (const r of rooms as any[]) {
          if (r.doasId === systemId) {
            batch.update(doc(db, 'projects', project.id, 'rooms', r.id), {
              tfaMode: 'no-tfa', doasId: deleteField(), updatedAt: serverTimestamp(),
            });
            n++;
          }
        }
        if (n > 0) await batch.commit();
      }
      await deleteDoc(doc(db, 'projects', project.id, 'equipmentSystems', systemId));
      if (selectedSystemId === systemId) setSelectedSystemId(null);
      toast.success('System deleted');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `equipmentSystems/${systemId}`);
    }
  };

  const renameSystem = async (systemId: string) => {
    if (!editingSystemName.trim()) { toast.error('Name required'); return; }
    const sys = equipSystems.find(s => s.id === systemId);
    // If type changed, gate behind a confirmation dialog before clearing equipment
    if (sys && editingSystemType !== sys.type) {
      setTypeChangeConfirm({ systemId, oldType: sys.type, newType: editingSystemType, newName: editingSystemName.trim() });
      return;
    }
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', systemId), {
        name: editingSystemName.trim(),
        type: editingSystemType,
        updatedAt: serverTimestamp(),
      });
      setEditingSystemId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${systemId}`);
    }
  };

  // Called when user confirms the type-change warning — clears all equipment selections
  const confirmSystemTypeChange = async () => {
    if (!typeChangeConfirm) return;
    const { systemId, newType, newName } = typeChangeConfirm;
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', systemId), {
        name: newName,
        type: newType,
        // Clear all equipment selections — user must re-select for the new system type
        brand: null,
        brandLocked: false,
        iduSelections: {},
        oduSelection: null,
        unitSelection: null,
        ctSelection: null,
        zones: deleteField(),
        zoneSelections: deleteField(),
        chillerUnits: deleteField(),
        roomSelections: deleteField(),
        ahuConfig: deleteField(),
        updatedAt: serverTimestamp(),
      });
      setTypeChangeConfirm(null);
      setEditingSystemId(null);
      toast.success('System type changed — please re-select equipment');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${systemId}`);
    }
  };

  // ── Zone ↔ System Sync ────────────────────────────────────────────────────

  // Push: Equipment systems → Load Calculator (stamps systemId on rooms; zoneId stays as LC zone)
  const pushSystemsToZones = async () => {
    if (equipSystems.length === 0) { toast.error('No systems to push'); return; }
    setSyncBusy(true);
    try {
      const liveRoomIds = new Set(rooms.map(r => r.id));
      const batch = writeBatch(db);
      let updated = 0;
      const staleBySystem: Record<string, string[]> = {};

      for (const sys of equipSystems) {
        const stale: string[] = [];
        for (const roomId of sys.assignedRoomIds) {
          if (!liveRoomIds.has(roomId)) {
            stale.push(roomId);
            continue; // skip deleted rooms — can't update a non-existent doc
          }
          batch.update(doc(db, 'projects', project.id, 'rooms', roomId), {
            systemId: sys.id,
            systemName: sys.name,
            hvacSystemId: sys.id,
            hvacSystemName: sys.name,
            updatedAt: serverTimestamp(),
          });
          updated++;
        }
        if (stale.length > 0) staleBySystem[sys.name] = stale;
      }

      // assignedRoomIds on equipment system docs is no longer used — room docs are the source of truth

      await batch.commit();

      // Stamp the project so Load Calculator's real-time listener detects the push
      // and re-fetches rooms even if it's already mounted in another browser tab.
      if (updated > 0) {
        await updateDoc(doc(db, 'projects', project.id), { zonesLastSyncedAt: serverTimestamp() });
      }

      const staleCount = Object.values(staleBySystem).reduce((n, arr) => n + arr.length, 0);
      if (updated === 0 && staleCount > 0) {
        toast.warning(`No rooms updated — ${staleCount} deleted room(s) removed from systems. Re-assign rooms and push again.`);
      } else if (staleCount > 0) {
        toast.success(`Zones updated — ${updated} rooms re-grouped. ${staleCount} stale room(s) removed from systems.`);
      } else {
        toast.success(`Zones updated — ${updated} rooms re-grouped`);
      }
      setSyncDialog(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `rooms (batch zone update)`);
    } finally {
      setSyncBusy(false);
    }
  };

  // Pull: Load Calculator zones → Equipment system assignment
  // Rooms are matched to systems by zone name (case-insensitive), then by zone order
  const pullZonesToSystems = async () => {
    if (rooms.length === 0) { toast.error('No rooms loaded'); return; }
    const mappedEntries = Object.entries(zoneMapping).filter(([, sysId]) => !!sysId);
    if (mappedEntries.length === 0) { toast.error('Map at least one zone to a system before pulling'); return; }
    setSyncBusy(true);
    try {
      // Build zone groups from current room data
      const zoneGroups: Record<string, string[]> = {};
      for (const r of rooms) {
        const key = ((r as any).zoneName || 'Zone').trim();
        if (!zoneGroups[key]) zoneGroups[key] = [];
        zoneGroups[key].push(r.id);
      }
      const batch = writeBatch(db);
      let matched = 0;
      // For each system that has a mapping, collect all room IDs across all zones mapped to it
      const sysRooms: Record<string, string[]> = {};
      for (const [zoneName, sysId] of mappedEntries) {
        if (!sysId) continue;
        if (!sysRooms[sysId]) sysRooms[sysId] = [];
        sysRooms[sysId].push(...(zoneGroups[zoneName] ?? []));
      }
      // Write systemId on each room document — zoneId stays as LC zone, systemId = SD assignment
      let roomsWritten = 0;
      for (const [sysId, roomIds] of Object.entries(sysRooms)) {
        const sys = equipSystems.find(s => s.id === sysId);
        if (!sys) continue;
        for (const roomId of roomIds) {
          batch.update(doc(db, 'projects', project.id, 'rooms', roomId), {
            systemId: sysId,
            systemName: sys.name,
            hvacSystemId: sysId,
            hvacSystemName: sys.name,
            updatedAt: serverTimestamp(),
          });
          roomsWritten++;
        }
        matched++;
      }
      await batch.commit();
      // Stamp project so Load Calculator detects the change and re-fetches rooms
      await updateDoc(doc(db, 'projects', project.id), { zonesLastSyncedAt: serverTimestamp() });
      toast.success(`${roomsWritten} room${roomsWritten !== 1 ? 's' : ''} assigned across ${matched} system${matched !== 1 ? 's' : ''} — Load Calculator will refresh`);
      setSyncDialog(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems (batch)`);
    } finally {
      setSyncBusy(false);
    }
  };

  // Cleanup: remove stale data across ES system docs AND LC zone collections.
  // Five kinds of garbage we clean:
  //   1. system.zones[].roomIds[] entries pointing to rooms that don't exist anymore
  //   2. system.zones[].roomIds[] entries pointing to rooms whose systemId is a different system
  //   3. system.zones[] entries with empty roomIds[] (zone with no rooms — orphan)
  //   4. /projects/{id}/zones/{zoneId} docs with no rooms referencing them AND not used as an ES sub-zone
  //   5. /projects/{id}/systems/{sysId}/zones/{zoneId} legacy nested zone docs with no rooms referencing them
  // Read-only first to count, then write the cleaned arrays / delete the orphan docs. Idempotent.
  const cleanOrphanZones = async () => {
    if (!project?.id) return;
    setSyncBusy(true);
    try {
      const roomIdsAlive = new Set(rooms.map((r: any) => r.id));
      const roomSystemById: Record<string, string | undefined> = {};
      const roomZoneIdById: Record<string, string | undefined> = {};
      // Set of zoneIds that any room references — used to identify orphan zone docs
      const referencedZoneIds = new Set<string>();
      for (const r of rooms as any[]) {
        roomSystemById[r.id] = r.systemId;
        roomZoneIdById[r.id] = r.zoneId;
        if (r.zoneId) referencedZoneIds.add(r.zoneId);
      }
      // Also collect every sub-zone id from ES system docs — those are legitimate even if empty
      const esSubZoneIds = new Set<string>();
      for (const sys of equipSystems as any[]) {
        for (const z of (sys.zones ?? []) as any[]) {
          if (z?.id) esSubZoneIds.add(z.id);
        }
      }

      let staleRoomRefs = 0;
      let emptyZones = 0;
      let systemsTouched = 0;
      let orphanZoneDocs = 0;
      let orphanLegacyZoneDocs = 0;
      let orphanLegacySystemDocs = 0;
      let orphanEsSystemDocs = 0;

      // Set of system ids that any live room references via room.systemId
      const referencedSystemIds = new Set<string>();
      for (const r of rooms as any[]) if (r.systemId) referencedSystemIds.add(r.systemId);

      // CRITICAL: read ALL /equipmentSystems docs directly from Firestore, not from React state.
      // EquipmentSelection's listener dedups by (type, name) so React state has fewer entries
      // than Firestore actually contains. Duplicate ES system docs (created from earlier work,
      // hidden from the user by dedup) leak through to LC and render as phantom rows.
      const allEsDocsSnap = await getDocs(collection(db, 'projects', project.id, 'equipmentSystems'));
      const allEsDocs = allEsDocsSnap.docs.map(d => ({ id: d.id, ref: d.ref, data: d.data() as any }));

      // ── Part 1: clean each ES system.zones[] array (iterate ALL docs, not just state) ──
      const batch = writeBatch(db);
      for (const sysDoc of allEsDocs) {
        const sys: any = { id: sysDoc.id, ...sysDoc.data };
        const subZones = (sys.zones ?? []) as any[];
        if (subZones.length === 0) continue;
        const cleanedZones = subZones
          .map((z: any) => {
            const before = (z.roomIds ?? []) as string[];
            const after = before.filter((rid: string) => {
              if (!roomIdsAlive.has(rid)) { staleRoomRefs++; return false; }
              const owner = roomSystemById[rid];
              if (owner && owner !== sys.id) { staleRoomRefs++; return false; }
              // LC matches rooms to zones via room.zoneId — if the room's zoneId is
              // a DIFFERENT sub-zone, this entry is stale (an old reference left over
              // from a move). Drop it so the zone may collapse to "empty" and be removed.
              const rZoneId = roomZoneIdById[rid];
              if (rZoneId && rZoneId !== z.id) { staleRoomRefs++; return false; }
              return true;
            });
            return { ...z, roomIds: after };
          })
          .filter((z: any) => {
            if ((z.roomIds ?? []).length === 0) { emptyZones++; return false; }
            return true;
          });
        if (cleanedZones.length !== subZones.length || JSON.stringify(cleanedZones) !== JSON.stringify(subZones)) {
          batch.update(doc(db, 'projects', project.id, 'equipmentSystems', sys.id), {
            zones: cleanedZones,
            updatedAt: serverTimestamp(),
          });
          systemsTouched++;
        }
      }

      // ── Part 1b: delete ENTIRE /equipmentSystems docs that are orphan duplicates ──
      // A system is a deletable orphan ONLY when it is BOTH unreferenced (no room.systemId
      // points to it AND none of its sub-zones is referenced by a room.zoneId) AND carries no
      // configuration of its own (no assigned rooms, no zone room-lists, no equipment selected).
      // Earlier this deleted any system no room referenced via systemId — which destroyed real
      // systems whose rooms link by zoneId instead (the "my Chiller Plant disappeared" bug).
      const systemHasConfig = (s: any) =>
        (s.assignedRoomIds?.length ?? 0) > 0 ||
        ((s.zones ?? []) as any[]).some((z: any) =>
          (z.roomIds?.length ?? 0) > 0 || z.selection || (z.unitSelections?.length ?? 0) > 0) ||
        !!s.unitSelection ||
        (s.chillerUnits?.length ?? 0) > 0 ||
        !!s.oduSelection ||
        Object.keys(s.iduSelections ?? {}).length > 0;
      for (const sysDoc of allEsDocs) {
        const s: any = sysDoc.data;
        if (referencedSystemIds.has(sysDoc.id)) continue;  // a room references it via systemId → keep
        const reachableByZone = ((s.zones ?? []) as any[]).some((z: any) => z?.id && referencedZoneIds.has(z.id));
        if (reachableByZone) continue;                     // a room references one of its sub-zones → keep
        if (systemHasConfig(s)) continue;                  // holds real configuration → keep
        batch.delete(sysDoc.ref);
        orphanEsSystemDocs++;
      }

      // ── Part 2: scan /projects/{id}/zones — delete docs no room or ES sub-zone references ──
      const zonesSnap = await getDocs(collection(db, 'projects', project.id, 'zones'));
      for (const zd of zonesSnap.docs) {
        const zid = zd.id;
        if (referencedZoneIds.has(zid)) continue;      // some room still points here
        if (esSubZoneIds.has(zid)) continue;           // ES sub-zone with same id (paired)
        batch.delete(zd.ref);
        orphanZoneDocs++;
      }

      // ── Part 3: scan /projects/{id}/systems/{sysId}/zones (legacy nested) — same rule ──
      // Plus: delete the parent /systems/{sysId} doc itself if it has no nested zones AND
      // no rooms reference it AND it's not paired with any ES system or zone. These legacy
      // docs render as empty zone-like rows in LC since they predate the ES architecture.
      const roomSystemIds = new Set<string>();
      for (const r of rooms as any[]) if (r.systemId) roomSystemIds.add(r.systemId);
      const esSystemIds = new Set<string>(equipSystems.map((s: any) => s.id));
      const systemsSnap = await getDocs(collection(db, 'projects', project.id, 'systems'));
      for (const sd of systemsSnap.docs) {
        const nestedSnap = await getDocs(collection(db, 'projects', project.id, 'systems', sd.id, 'zones'));
        let remainingNested = 0;
        for (const zd of nestedSnap.docs) {
          const zid = zd.id;
          if (referencedZoneIds.has(zid)) { remainingNested++; continue; }
          if (esSubZoneIds.has(zid))     { remainingNested++; continue; }
          batch.delete(zd.ref);
          orphanLegacyZoneDocs++;
        }
        // Now decide on the system doc itself. Orphan only if it has no surviving nested
        // zones AND no room or ES system shares its id.
        const isOrphan =
          remainingNested === 0 &&
          !roomSystemIds.has(sd.id) &&
          !esSystemIds.has(sd.id) &&
          !referencedZoneIds.has(sd.id);
        if (isOrphan) {
          batch.delete(sd.ref);
          orphanLegacySystemDocs++;
        }
      }

      const totalWrites = systemsTouched + orphanZoneDocs + orphanLegacyZoneDocs + orphanLegacySystemDocs + orphanEsSystemDocs;
      if (totalWrites > 0) await batch.commit();

      const total = staleRoomRefs + emptyZones + orphanZoneDocs + orphanLegacyZoneDocs + orphanLegacySystemDocs + orphanEsSystemDocs;
      if (total === 0) {
        toast.success('No orphan data found — everything is clean.');
      } else {
        const parts: string[] = [];
        if (staleRoomRefs > 0)           parts.push(`${staleRoomRefs} stale room ref${staleRoomRefs === 1 ? '' : 's'}`);
        if (emptyZones > 0)              parts.push(`${emptyZones} empty ES sub-zone${emptyZones === 1 ? '' : 's'}`);
        if (orphanEsSystemDocs > 0)      parts.push(`${orphanEsSystemDocs} duplicate /equipmentSystems doc${orphanEsSystemDocs === 1 ? '' : 's'}`);
        if (orphanZoneDocs > 0)          parts.push(`${orphanZoneDocs} orphan /zones doc${orphanZoneDocs === 1 ? '' : 's'}`);
        if (orphanLegacyZoneDocs > 0)    parts.push(`${orphanLegacyZoneDocs} orphan legacy nested zone${orphanLegacyZoneDocs === 1 ? '' : 's'}`);
        if (orphanLegacySystemDocs > 0)  parts.push(`${orphanLegacySystemDocs} orphan legacy system doc${orphanLegacySystemDocs === 1 ? '' : 's'}`);
        toast.success(`Cleaned ${total} orphan${total === 1 ? '' : 's'}: ${parts.join(', ')}.`);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'project (cleanup)');
    } finally {
      setSyncBusy(false);
    }
  };

  // ── Custom Equipment Library CRUD ─────────────────────────────────────────

  const saveCustomEquipment_item = async (item: Partial<EquipmentModel>) => {
    const data: Record<string, unknown> = {
      brand: item.brand ?? 'Custom',
      type: item.type,
      subType: item.subType ?? undefined,
      modelSeries: item.modelSeries ?? 'Custom',
      capacityTR: item.capacityTR ?? 0,
      capacityBTU: (item.capacityTR ?? 0) * 12000,
      ratedAirflowCFM: item.ratedAirflowCFM ?? 0,
      staticPressurePa: (item as any).staticPressurePa ?? undefined,
      powerInputKW: item.powerInputKW ?? undefined,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
    await addDoc(collection(db, 'customEquipment'), data);
  };

  const saveCustomEquipment = async () => {
    const tr = parseFloat(String(ceForm.capacityTR ?? ''));
    if (!ceForm.type || !ceForm.modelSeries?.trim() || isNaN(tr) || tr <= 0) {
      toast.error('Type, model name, and TR are required');
      return;
    }
    const data: Record<string, unknown> = {
      brand: ceForm.brand?.trim() || 'Custom',
      type: ceForm.type,
      subType: ceForm.subType?.trim() || undefined,
      modelSeries: ceForm.modelSeries.trim(),
      capacityTR: tr,
      capacityBTU: Math.round(tr * 12000),
      ratedAirflowCFM: parseFloat(String(ceForm.ratedAirflowCFM ?? '')) || 0,
      staticPressurePa: parseFloat(String((ceForm as any).staticPressurePa ?? '')) || undefined,
      powerInputKW: parseFloat(String(ceForm.powerInputKW ?? '')) || undefined,
      updatedAt: serverTimestamp(),
    };
    // strip undefined
    Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
    try {
      if (ceEditing) {
        await updateDoc(doc(db, 'customEquipment', ceEditing), data);
        toast.success('Equipment updated');
      } else {
        await addDoc(collection(db, 'customEquipment'), { ...data, createdAt: serverTimestamp() });
        toast.success('Custom equipment added to library');
      }
      setCeForm({});
      setCeEditing(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'customEquipment');
    }
  };

  const deleteCustomEquipment = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'customEquipment', id));
      toast.success('Removed from library');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'customEquipment');
    }
  };

  // Pending category for the "you'll lose all design data" confirmation dialog
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  const [categoryWarnOpen, setCategoryWarnOpen] = useState(false);
  const [categoryWarnBusy, setCategoryWarnBusy] = useState(false);

  const saveHvacSystemCategory = (cat: string) => {
    // If there are existing systems, require confirmation first
    if (equipSystems.length > 0 && cat !== hvacSystemCategory) {
      setPendingCategory(cat);
      setCategoryWarnOpen(true);
      return;
    }
    void applyHvacSystemCategory(cat);
  };

  const applyHvacSystemCategory = async (cat: string) => {
    setHvacSystemCategory(cat);
    if (cat && SYSTEM_GUIDES[cat]) setNewType(SYSTEM_GUIDES[cat].defaultType);
    try {
      await updateDoc(doc(db, 'projects', project.id), {
        hvacSystemCategory: cat || deleteField(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `projects/${project.id}`);
    }
  };

  const confirmCategoryChange = async () => {
    if (!pendingCategory) return;
    setCategoryWarnBusy(true);
    try {
      // Delete all equipment systems for this project (fresh start)
      const batch = writeBatch(db);
      for (const sys of equipSystems) {
        batch.delete(doc(db, 'projects', project.id, 'equipmentSystems', sys.id));
      }
      await batch.commit();
      categoryInitRef.current = null;
      setSelectedSystemId(null);
      await applyHvacSystemCategory(pendingCategory);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'equipmentSystems');
    } finally {
      setCategoryWarnBusy(false);
      setCategoryWarnOpen(false);
      setPendingCategory(null);
    }
  };

  // Update quantity on the zone's primary AHU/FCU selection.
  // Used for "same-spec multi-AHU" zones (e.g. Banquet hall split into 2 AHUs because of duct
  // height constraint — same model, dedicated duct per AHU, total CFM divided across units).
  const updateZoneSelectionQty = async (zoneId: string, qty: number) => {
    if (!selectedSystem || !project) return;
    const clamped = Math.max(1, Math.min(20, qty));
    const zones = ((selectedSystem.zones ?? []) as EquipmentZone[]).map((z: EquipmentZone) =>
      z.id === zoneId && z.selection
        ? { ...z, selection: { ...z.selection, quantity: clamped } }
        : z);
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), {
        zones, updatedAt: serverTimestamp(),
      });
    } catch (err) { handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${selectedSystem.id}`); }
  };

  // Update AHU/FCU mounting or coil type on the primary zone unit (zone.selection)
  const handleUpdateZoneEquipProps = async (zoneId: string, props: Partial<IDUSelection>) => {
    if (!selectedSystem || !project) return;
    const zones = ((selectedSystem.zones ?? []) as EquipmentZone[]).map((z: EquipmentZone) =>
      z.id === zoneId ? { ...z, selection: z.selection ? { ...z.selection, ...props } : z.selection } : z);
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), {
        zones, updatedAt: serverTimestamp(),
      });
    } catch (err) { handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${selectedSystem.id}`); }
  };

  const updateSystemField = async (systemId: string, fields: Record<string, any>) => {
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', systemId), {
        ...fields,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${systemId}`);
    }
  };

  // ── Dehumidifier handlers ────────────────────────────────────────────────
  // System-level: writes to system.dehumidifierUnits[].
  // AHU per-zone: writes to system.zones[zoneIdx].dehumidifierUnits[].

  const makeDehumidifierUnit = (model: EquipmentModel): DehumidifierUnit => ({
    modelId: model.id,
    brand: model.brand,
    modelSeries: model.modelSeries,
    subType: model.subType,
    capacityLPH: Number(model.capacityLPH) || 0,
    powerInputKW: Number(model.powerInputKW) || 0,
    quantity: 1,
  });

  const addSystemDehumidifier = async (systemId: string, model: EquipmentModel) => {
    const sys = equipSystems.find(s => s.id === systemId);
    const current: DehumidifierUnit[] = (sys as any)?.dehumidifierUnits ?? [];
    await updateSystemField(systemId, {
      dehumidifierUnits: [...current, makeDehumidifierUnit(model)],
    });
  };

  const removeSystemDehumidifier = async (systemId: string, idx: number) => {
    const sys = equipSystems.find(s => s.id === systemId);
    const current: DehumidifierUnit[] = [...((sys as any)?.dehumidifierUnits ?? [])];
    if (idx < 0 || idx >= current.length) return;
    current.splice(idx, 1);
    await updateSystemField(systemId, { dehumidifierUnits: current });
  };

  const updateSystemDehumidifierQty = async (systemId: string, idx: number, qty: number) => {
    if (!Number.isFinite(qty) || qty < 1 || qty > 20) return;
    const sys = equipSystems.find(s => s.id === systemId);
    const current: DehumidifierUnit[] = [...((sys as any)?.dehumidifierUnits ?? [])];
    if (idx < 0 || idx >= current.length) return;
    current[idx] = { ...current[idx], quantity: qty };
    await updateSystemField(systemId, { dehumidifierUnits: current });
  };

  const mutateZoneDehumidifiers = async (
    systemId: string,
    zoneId: string,
    mutator: (units: DehumidifierUnit[]) => DehumidifierUnit[],
  ) => {
    const sys = equipSystems.find(s => s.id === systemId);
    if (!sys) return;
    const zones = ((sys.zones ?? (sys as any).ahuGroups ?? []) as EquipmentZone[]).slice();
    const idx = zones.findIndex(z => z.id === zoneId);
    if (idx < 0) return;
    const zone = zones[idx];
    const existing: DehumidifierUnit[] = (zone as any).dehumidifierUnits ?? [];
    const next = mutator(existing);
    zones[idx] = { ...zone, dehumidifierUnits: next } as EquipmentZone;
    await updateSystemField(systemId, { zones });
  };

  const addZoneDehumidifier = (systemId: string, zoneId: string, model: EquipmentModel) =>
    mutateZoneDehumidifiers(systemId, zoneId, units => [...units, makeDehumidifierUnit(model)]);

  const removeZoneDehumidifier = (systemId: string, zoneId: string, idx: number) =>
    mutateZoneDehumidifiers(systemId, zoneId, units => units.filter((_, i) => i !== idx));

  const updateZoneDehumidifierQty = (systemId: string, zoneId: string, idx: number, qty: number) => {
    if (!Number.isFinite(qty) || qty < 1 || qty > 20) return;
    return mutateZoneDehumidifiers(systemId, zoneId, units =>
      units.map((u, i) => (i === idx ? { ...u, quantity: qty } : u)),
    );
  };

  // ── Dehumidification method handlers ─────────────────────────────────────
  // Writes `dehumidMethod` / `dehumidReheatKW` on the zone (or system, for zoneless). When method
  // 'reheat-electric-ahu' is picked, also enables the AHU electric heater and pre-fills its kW
  // (single source of truth — AHU Configuration UI reflects the same value).

  const setZoneDehumidMethod = async (systemId: string, zoneId: string, method: DehumidMethod | null, reheatKW: number) => {
    const sys = equipSystems.find(s => s.id === systemId);
    if (!sys) return;
    const zones = ((sys.zones ?? (sys as any).ahuGroups ?? []) as EquipmentZone[]).slice();
    const idx = zones.findIndex(z => z.id === zoneId);
    if (idx < 0) return;
    const zone = zones[idx];
    const next: any = { ...zone, dehumidMethod: method ?? null };
    // Cross-link: method 2 turns on AHU electric heater. Other methods leave fahu untouched —
    // we don't disable it on switch-away because an engineer may want the electric heater on
    // for heating reasons independent of dehumidification.
    if (method === 'reheat-electric-ahu') {
      const fahu = zone.fahu ?? { hasElectricHeater: false, electricHeaterKW: 0, hasHumidifier: false, humidifierKgHr: 0 };
      next.fahu = {
        ...fahu,
        hasElectricHeater: true,
        electricHeaterKW: Math.max(Number(fahu.electricHeaterKW) || 0, Math.round(reheatKW * 100) / 100),
      };
    }
    zones[idx] = next as EquipmentZone;
    await updateSystemField(systemId, { zones });
  };

  const setZoneDehumidReheatKW = async (systemId: string, zoneId: string, kw: number | null) => {
    const sys = equipSystems.find(s => s.id === systemId);
    if (!sys) return;
    const zones = ((sys.zones ?? (sys as any).ahuGroups ?? []) as EquipmentZone[]).slice();
    const idx = zones.findIndex(z => z.id === zoneId);
    if (idx < 0) return;
    const zone = zones[idx];
    const next: any = { ...zone };
    if (kw == null) {
      delete next.dehumidReheatKW;
    } else {
      next.dehumidReheatKW = kw;
    }
    // If method is reheat-electric-ahu, keep the AHU electricHeaterKW in sync with the override.
    if ((zone as any).dehumidMethod === 'reheat-electric-ahu' && kw != null && kw > 0) {
      const fahu = zone.fahu ?? { hasElectricHeater: false, electricHeaterKW: 0, hasHumidifier: false, humidifierKgHr: 0 };
      next.fahu = { ...fahu, hasElectricHeater: true, electricHeaterKW: Math.round(kw * 100) / 100 };
    }
    zones[idx] = next as EquipmentZone;
    await updateSystemField(systemId, { zones });
  };

  const setSystemDehumidMethod = async (systemId: string, method: DehumidMethod | null) => {
    await updateSystemField(systemId, { dehumidMethod: method ?? deleteField() });
  };

  const setSystemDehumidReheatKW = async (systemId: string, kw: number | null) => {
    await updateSystemField(systemId, { dehumidReheatKW: kw == null ? deleteField() : kw });
  };

  const toggleRoomAssignment = async (system: EquipmentSystem, roomId: string) => {
    // Source of truth is the room document (zoneId/zoneName/systemId/systemName).
    const room = rooms.find((r: any) => r.id === roomId);
    const isAssigned = room && (room.zoneId === system.id || room.systemId === system.id);
    try {
      if (isAssigned) {
        // Detect whether the room is in an ES zone of this system — if so, removing it
        // also drops it out of that zone, so the canonical LC zoneId must reset.
        const existingZones = (system.zones ?? (system as any).ahuGroups ?? []) as EquipmentZone[];
        const zoneContaining = existingZones.find((z: EquipmentZone) => z.roomIds.includes(roomId));

        const roomUpdate: Record<string, any> = {
          systemId: deleteField(),
          systemName: deleteField(),
          hvacSystemId: deleteField(),
          hvacSystemName: deleteField(),
          hvacZoneId: deleteField(),
          hvacZoneName: deleteField(),
          updatedAt: serverTimestamp(),
        };
        if (zoneContaining) {
          roomUpdate.zoneId = 'unassigned';
          roomUpdate.zoneName = 'Unassigned';
          roomUpdate.ahuGroupId = deleteField();
          roomUpdate.ahuGroupName = deleteField();
        }
        await updateDoc(doc(db, 'projects', project.id, 'rooms', roomId), roomUpdate);

        if (zoneContaining) {
          const updatedZones = existingZones.map((z: EquipmentZone) =>
            z.id === zoneContaining.id ? { ...z, roomIds: z.roomIds.filter(id => id !== roomId) } : z,
          );
          await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', system.id), {
            zones: updatedZones,
            updatedAt: serverTimestamp(),
          });
        } else {
          // Remove IDU selection (only for directly-assigned rooms, not zone rooms)
          await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', system.id), {
            [`iduSelections.${roomId}`]: deleteField(),
            updatedAt: serverTimestamp(),
          });
        }
      } else {
        // Assign: stamp the room with this system's id/name (preserve zoneId — LC zone stays intact)
        await updateDoc(doc(db, 'projects', project.id, 'rooms', roomId), {
          systemId: system.id,
          systemName: system.name,
          hvacSystemId: system.id,
          hvacSystemName: system.name,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `rooms/${roomId}`);
    }
  };

  const selectIDU = async (system: EquipmentSystem, roomId: string, sel: IDUSelection) => {
    const existing = normalizeIDUList((system.iduSelections as any)[roomId]);
    const updated = [...existing, sel];
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', system.id), {
        [`iduSelections.${roomId}`]: updated,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${system.id}`);
    }
    const room = rooms.find((r: any) => r.id === roomId);
    void saveEquipmentEntry(`${system.id}-idu-${roomId}`, {
      systemId: system.id, systemName: system.name,
      roomId, roomName: room?.name ?? '—',
      type: 'VRF-IDU',
      brand: sel.brand, modelSeries: sel.modelSeries, subType: sel.subType,
      trCapacity: sel.trCapacity, quantity: sel.quantity ?? 1,
    });
  };

  const removeIDUAtIndex = async (systemId: string, roomId: string, idx: number) => {
    const sys = equipSystems.find((s: EquipmentSystem) => s.id === systemId);
    const existing = normalizeIDUList((sys?.iduSelections as any)?.[roomId]);
    const updated = existing.filter((_, i) => i !== idx);
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', systemId), {
        [`iduSelections.${roomId}`]: updated.length > 0 ? updated : deleteField(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${systemId}`);
    }
  };

  const updateIDUQuantity = async (system: EquipmentSystem, roomId: string, qty: number) => {
    const newQty = Math.max(1, Math.min(20, qty));
    setRoomQuantities(prev => ({ ...prev, [roomId]: newQty }));
    const existingIdu = system.iduSelections[roomId];
    if (!existingIdu) return;
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', system.id), {
        [`iduSelections.${roomId}`]: { ...existingIdu, quantity: newQty },
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${system.id}`);
    }
  };

  const updateUnitQuantity = async (system: EquipmentSystem, qty: number) => {
    const newQty = Math.max(1, Math.min(20, qty));
    setUnitQuantity(newQty);
    if (!system.unitSelection) return;
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', system.id), {
        'unitSelection.quantity': newQty,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${system.id}`);
    }
  };

  const removeIDU = async (systemId: string, roomId: string) => {
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', systemId), {
        [`iduSelections.${roomId}`]: deleteField(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${systemId}`);
    }
    void deleteEquipmentEntry(`${systemId}-idu-${roomId}`);
  };

  // Zone functions

  const createZone = async () => {
    if (!selectedSystem || zoneSelected.size < 2) {
      toast.error('Select at least 2 rooms to create a zone');
      return;
    }
    const roomIds = [...zoneSelected];
    const zoneId = `grp-${Date.now()}`;
    const zoneName = `Zone ${((selectedSystem.zones ?? (selectedSystem as any).ahuGroups ?? []).length + 1)}`;
    const newZone: EquipmentZone = { id: zoneId, name: zoneName, roomIds };
    const existing = (selectedSystem.zones ?? (selectedSystem as any).ahuGroups ?? []);
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), {
        zones: [...existing, newZone],
        updatedAt: serverTimestamp(),
      });
      // Stamp room documents with system + zone. ES zone is the source of truth for LC zone grouping —
      // write the canonical zoneId/zoneName so the Load Calculator picks up the new grouping.
      const batch = writeBatch(db);
      for (const roomId of roomIds) {
        batch.update(doc(db, 'projects', project.id, 'rooms', roomId), {
          systemId: selectedSystem.id,
          systemName: selectedSystem.name,
          zoneId,
          zoneName,
          ahuGroupId: zoneId,
          ahuGroupName: zoneName,
          hvacSystemId: selectedSystem.id,
          hvacSystemName: selectedSystem.name,
          hvacZoneId: zoneId,
          hvacZoneName: zoneName,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      setZoneMode(false);
      setZoneSelected(new Set());
      toast.success(`${zoneName} created — select IDU/AHU for the zone`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${selectedSystem.id}`);
    }
  };

  const deleteZone = async (systemId: string, zoneId: string) => {
    const sys = equipSystems.find(s => s.id === systemId);
    if (!sys) return;
    const allZones = (sys.zones ?? (sys as any).ahuGroups ?? []) as EquipmentZone[];
    const zone = allZones.find((g: EquipmentZone) => g.id === zoneId);
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', systemId), {
        zones: allZones.filter((g: EquipmentZone) => g.id !== zoneId),
        updatedAt: serverTimestamp(),
      });
      // Reset rooms back to system-level assignment so LC reflects the change.
      // ES zone is gone, so LC zone grouping falls back to 'unassigned' until reassigned.
      if (zone?.roomIds?.length) {
        const batch = writeBatch(db);
        for (const roomId of zone.roomIds) {
          batch.update(doc(db, 'projects', project.id, 'rooms', roomId), {
            systemId,
            systemName: sys.name,
            zoneId: 'unassigned',
            zoneName: 'Unassigned',
            ahuGroupId: deleteField(),
            ahuGroupName: deleteField(),
            hvacSystemId: systemId,
            hvacSystemName: sys.name,
            hvacZoneId: deleteField(),
            hvacZoneName: deleteField(),
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }
      void deleteEquipmentEntry(`${systemId}-zone-${zoneId}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${systemId}`);
    }
  };

  const selectZoneIDU = async (systemId: string, zoneId: string, sel: IDUSelection) => {
    const sys = equipSystems.find(s => s.id === systemId);
    if (!sys) return;
    const updatedZones = (sys.zones ?? (sys as any).ahuGroups ?? []).map((zone: EquipmentZone) =>
      zone.id === zoneId ? { ...zone, selection: sel } : zone,
    );
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', systemId), {
        zones: updatedZones,
        updatedAt: serverTimestamp(),
      });
      const zone = updatedZones.find((z: EquipmentZone) => z.id === zoneId);
      void saveEquipmentEntry(`${systemId}-zone-${zoneId}`, {
        systemId, systemName: sys.name,
        zoneId, zoneName: zone?.name ?? zoneId,
        roomIds: zone?.roomIds ?? [],
        type: 'VRF-IDU',
        brand: sel.brand, modelSeries: sel.modelSeries, subType: sel.subType,
        trCapacity: sel.trCapacity, quantity: 1,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${systemId}`);
    }
    setZonePicker(null);
  };

  // Chiller terminal unit per LC zone (AHU / FCU selection stored under zoneSelections)
  const selectZoneTerminalUnit = async (systemId: string, zoneId: string, sel: IDUSelection) => {
    const sys = equipSystems.find(s => s.id === systemId);
    if (!sys) return;
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', systemId), {
        [`zoneSelections.${zoneId}`]: sel,
        updatedAt: serverTimestamp(),
      });
      const zone = systemZonesData.find(z => z.zoneId === zoneId);
      void saveEquipmentEntry(`${systemId}-terminal-${zoneId}`, {
        systemId, systemName: sys.name,
        zoneId, zoneName: zone?.zoneName ?? zoneId,
        roomIds: zone?.roomIds ?? [],
        type: 'Terminal-IDU',
        brand: sel.brand, modelSeries: sel.modelSeries, subType: sel.subType,
        trCapacity: sel.trCapacity, quantity: sel.quantity ?? 1,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${systemId}`);
    }
    setZoneTerminalPicker(null);
  };

  const clearZoneTerminalUnit = async (systemId: string, zoneId: string) => {
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', systemId), {
        [`zoneSelections.${zoneId}`]: deleteField(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${systemId}`);
    }
  };

  const addCTUnit = async (systemId: string) => {
    if (!ctForm.brand || !ctForm.modelSeries || ctForm.trCapacity <= 0) return;
    const sys = equipSystems.find(s => s.id === systemId);
    const current: ODUCombinationUnit[] = (sys as any)?.ctUnits ?? [];
    const newUnit: ODUCombinationUnit = {
      modelId: `ct-${systemId}-${current.length}`,
      brand: ctForm.brand,
      modelSeries: ctForm.modelSeries,
      trCapacity: ctForm.trCapacity,
      quantity: ctForm.quantity,
    };
    await updateSystemField(systemId, { ctUnits: [...current, newUnit] });
    void saveEquipmentEntry(`${systemId}-ct-${current.length}`, {
      systemId, systemName: sys?.name ?? '',
      type: 'CT',
      brand: newUnit.brand, modelSeries: newUnit.modelSeries, subType: 'cooling-tower',
      trCapacity: newUnit.trCapacity, quantity: newUnit.quantity,
    });
    setCtFormOpen(false);
  };

  const removeCTUnit = async (systemId: string, idx: number) => {
    const sys = equipSystems.find(s => s.id === systemId);
    const hasNew = ((sys as any)?.ctUnits ?? []).length > 0;
    if (!hasNew) {
      await updateSystemField(systemId, { ctSelection: deleteField() });
      return;
    }
    const current = [...((sys as any).ctUnits as ODUCombinationUnit[])];
    current.splice(idx, 1);
    await updateSystemField(systemId, { ctUnits: current });
  };

  const updateCTUnitQty = async (systemId: string, idx: number, qty: number) => {
    if (qty < 1 || qty > 20) return;
    const sys = equipSystems.find(s => s.id === systemId);
    const hasNew = ((sys as any)?.ctUnits ?? []).length > 0;
    if (!hasNew) {
      if (sys?.ctSelection) await updateSystemField(systemId, { ctSelection: { ...sys.ctSelection, quantity: qty } });
      return;
    }
    const current = [...((sys as any).ctUnits as ODUCombinationUnit[])];
    current[idx] = { ...current[idx], quantity: qty };
    await updateSystemField(systemId, { ctUnits: current });
  };

  const updateCTUnitRole = async (systemId: string, idx: number, role: 'working' | 'standby') => {
    const sys = equipSystems.find(s => s.id === systemId);
    const current = [...((sys as any)?.ctUnits as ODUCombinationUnit[] ?? [])];
    if (current.length === 0) return;
    current[idx] = { ...current[idx], role };
    await updateSystemField(systemId, { ctUnits: current });
  };

  // ── Universal zone management (Project → System → Zone → Room) ────────────

  const handleAddZone = async () => {
    if (!selectedSystem || !project) return;
    const existing = (selectedSystem.zones ?? []) as EquipmentZone[];
    const newZone: EquipmentZone = { id: `zone-${Date.now()}`, name: `Zone ${existing.length + 1}`, roomIds: [] };
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), {
        zones: [...existing, newZone], updatedAt: serverTimestamp(),
      });
    } catch (err) { handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${selectedSystem.id}`); }
  };

  // One-click: create an SD zone from an entire LC zone and assign all its rooms
  const assignLcZoneAsNewZone = async (lcZoneId: string, lcZoneName: string) => {
    if (!selectedSystem || !project) return;
    const lcRooms = (rooms as any[]).filter(r => r.zoneId === lcZoneId && r.systemId !== selectedSystem.id);
    if (lcRooms.length === 0) { toast('All rooms in this zone are already assigned to this system'); return; }
    const newZoneId = `zone-${Date.now()}`;
    const newZone: EquipmentZone = { id: newZoneId, name: lcZoneName, roomIds: lcRooms.map((r: any) => r.id) };
    const existing = (selectedSystem.zones ?? []) as EquipmentZone[];
    const allZones = [...existing, newZone];
    const allAssigned = allZones.flatMap((z: EquipmentZone) => z.roomIds);
    try {
      const batch = writeBatch(db);
      for (const room of lcRooms) {
        batch.update(doc(db, 'projects', project.id, 'rooms', room.id), {
          systemId: selectedSystem.id,
          systemName: selectedSystem.name,
          zoneId: newZoneId,
          zoneName: lcZoneName,
          ahuGroupId: newZoneId,
          ahuGroupName: lcZoneName,
          hvacSystemId: selectedSystem.id,
          hvacSystemName: selectedSystem.name,
          hvacZoneId: newZoneId,
          hvacZoneName: lcZoneName,
          updatedAt: serverTimestamp(),
        });
      }
      batch.update(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), {
        zones: allZones, assignedRoomIds: allAssigned, updatedAt: serverTimestamp(),
      });
      await batch.commit();
      toast.success(`${lcZoneName} → ${selectedSystem.name}: ${lcRooms.length} room${lcRooms.length !== 1 ? 's' : ''} assigned`);
    } catch (err) { handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${selectedSystem.id}`); }
  };

  const handleRenameZone = async (zoneId: string, newName: string) => {
    if (!selectedSystem || !project || !newName.trim()) return;
    const zones = (selectedSystem.zones ?? [] as EquipmentZone[]).map((z: EquipmentZone) =>
      z.id === zoneId ? { ...z, name: newName.trim() } : z);
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), {
        zones, updatedAt: serverTimestamp(),
      });
    } catch (err) { handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${selectedSystem.id}`); }
  };

  const handleDeleteZoneNew = async (zoneId: string) => {
    if (!selectedSystem || !project) return;
    const zone = (selectedSystem.zones ?? [] as EquipmentZone[]).find((z: EquipmentZone) => z.id === zoneId);
    const zones = (selectedSystem.zones ?? [] as EquipmentZone[]).filter((z: EquipmentZone) => z.id !== zoneId);
    const newAssigned = zones.flatMap((z: EquipmentZone) => z.roomIds);
    try {
      const batch = writeBatch(db);
      if (zone?.roomIds?.length) {
        for (const roomId of zone.roomIds) {
          batch.update(doc(db, 'projects', project.id, 'rooms', roomId), {
            zoneId: 'unassigned', zoneName: 'Unassigned',
            systemId: deleteField(), systemName: deleteField(),
            ahuGroupId: deleteField(), ahuGroupName: deleteField(),
            hvacSystemId: deleteField(), hvacSystemName: deleteField(),
            hvacZoneId: deleteField(), hvacZoneName: deleteField(),
            updatedAt: serverTimestamp(),
          });
        }
      }
      batch.update(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), {
        zones, assignedRoomIds: newAssigned, updatedAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (err) { handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${selectedSystem.id}`); }
  };

  const handleAssignRoomsToZone = async (zoneId: string) => {
    if (!selectedSystem || !project || addRoomsSelected.size === 0) return;
    const zone = (selectedSystem.zones ?? [] as EquipmentZone[]).find((z: EquipmentZone) => z.id === zoneId);
    if (!zone) return;
    const roomIds = [...addRoomsSelected];
    const newRoomIds = [...new Set([...zone.roomIds, ...roomIds])];
    const zones = (selectedSystem.zones ?? [] as EquipmentZone[]).map((z: EquipmentZone) =>
      z.id === zoneId ? { ...z, roomIds: newRoomIds } : z);
    const allAssigned = zones.flatMap((z: EquipmentZone) => z.roomIds);
    try {
      const batch = writeBatch(db);
      for (const roomId of roomIds) {
        batch.update(doc(db, 'projects', project.id, 'rooms', roomId), {
          systemId: selectedSystem.id, systemName: selectedSystem.name,
          zoneId, zoneName: zone.name,
          ahuGroupId: zoneId, ahuGroupName: zone.name,
          hvacSystemId: selectedSystem.id, hvacSystemName: selectedSystem.name,
          hvacZoneId: zoneId, hvacZoneName: zone.name,
          updatedAt: serverTimestamp(),
        });
      }
      batch.update(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), {
        zones, assignedRoomIds: allAssigned, updatedAt: serverTimestamp(),
      });
      await batch.commit();
      setAddRoomsZoneId(null); setAddRoomsSelected(new Set());
    } catch (err) { handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${selectedSystem.id}`); }
  };

  const handleRemoveRoomFromZone = async (zoneId: string, roomId: string) => {
    if (!selectedSystem || !project) return;
    const zones = (selectedSystem.zones ?? [] as EquipmentZone[]).map((z: EquipmentZone) =>
      z.id === zoneId ? { ...z, roomIds: z.roomIds.filter(id => id !== roomId) } : z);
    const allAssigned = zones.flatMap((z: EquipmentZone) => z.roomIds);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'projects', project.id, 'rooms', roomId), {
        systemId: deleteField(), systemName: deleteField(),
        zoneId: 'unassigned', zoneName: 'Unassigned',
        ahuGroupId: deleteField(), ahuGroupName: deleteField(),
        hvacSystemId: deleteField(), hvacSystemName: deleteField(),
        hvacZoneId: deleteField(), hvacZoneName: deleteField(),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), {
        zones, assignedRoomIds: allAssigned, updatedAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (err) { handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${selectedSystem.id}`); }
  };

  const handleSelectZoneEquip = async (zoneId: string, sel: IDUSelection) => {
    if (!selectedSystem || !project) return;
    const zones = (selectedSystem.zones ?? [] as EquipmentZone[]).map((z: EquipmentZone) =>
      z.id === zoneId ? { ...z, selection: sel } : z);
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), {
        zones, updatedAt: serverTimestamp(),
      });
      const zone = zones.find((z: EquipmentZone) => z.id === zoneId);
      void saveEquipmentEntry(`${selectedSystem.id}-zone-${zoneId}`, {
        systemId: selectedSystem.id, systemName: selectedSystem.name,
        zoneId, zoneName: zone?.name ?? zoneId, type: 'Zone-Terminal',
        brand: sel.brand, modelSeries: sel.modelSeries,
        trCapacity: sel.trCapacity, quantity: sel.quantity ?? 1,
      });
    } catch (err) { handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${selectedSystem.id}`); }
    setZoneEquipPicker(null);
  };

  const handleUpdateZoneFahu = async (zoneId: string, fahu: NonNullable<EquipmentZone['fahu']>) => {
    if (!selectedSystem || !project) return;
    const zones = (selectedSystem.zones ?? [] as EquipmentZone[]).map((z: EquipmentZone) =>
      z.id === zoneId ? { ...z, fahu } : z);
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), {
        zones, updatedAt: serverTimestamp(),
      });
    } catch (err) { handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${selectedSystem.id}`); }
  };

  // Quantity-aware selection: a single unit (qty=1) or a combination of identical units
  // when no single catalog model covers the demand (typical for large hospital / pharma
  // loads in India where catalog max is ~30 kg/hr per unit and engineers pair multiples).
  const handleSelectHumidifier = async (zoneId: string, item: EquipmentModel, quantity = 1) => {
    if (!selectedSystem || !project) return;
    const zone = ((selectedSystem.zones ?? []) as EquipmentZone[]).find((z: EquipmentZone) => z.id === zoneId);
    const fahu = zone?.fahu ?? { hasElectricHeater: false, electricHeaterKW: 0, hasHumidifier: false, humidifierKgHr: 0 };
    const perUnit = item.capacityLPH ?? 0;
    const qty = Math.max(1, Math.floor(quantity));
    const totalKgHr = perUnit * qty;
    const modelLabel = qty > 1
      ? `${qty} × ${item.brand} ${item.modelSeries} (${perUnit} kg/hr each)`
      : `${item.brand} ${item.modelSeries}`;
    await handleUpdateZoneFahu(zoneId, {
      ...fahu,
      hasHumidifier: true,
      humidifierKgHr: totalKgHr,
      humidifierModel: modelLabel,
      humidifierSubType: item.subType ?? '',
    });
    setHumidPicker(null);
  };

  const handleSetZoneRoomMode = async (zoneId: string, mode: 'single' | 'per-room') => {
    if (!selectedSystem || !project) return;
    const zones = (selectedSystem.zones ?? [] as EquipmentZone[]).map((z: EquipmentZone) => {
      if (z.id !== zoneId) return z;
      if (mode === 'per-room') {
        const { selection, ...rest } = z;
        return { ...rest, roomMode: 'per-room' as const };
      }
      return { ...z, roomMode: 'single' as const };
    });
    const updates: Record<string, any> = { zones, updatedAt: serverTimestamp() };
    if (mode === 'single') {
      const zone = (selectedSystem.zones ?? []).find((z: EquipmentZone) => z.id === zoneId);
      if (zone) {
        for (const roomId of zone.roomIds) {
          updates[`iduSelections.${roomId}`] = deleteField();
        }
      }
    }
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), updates);
    } catch (err) { handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${selectedSystem.id}`); }
  };

  const handleClearZoneEquip = async (zoneId: string) => {
    if (!selectedSystem || !project) return;
    const zones = (selectedSystem.zones ?? [] as EquipmentZone[]).map((z: EquipmentZone) => {
      if (z.id !== zoneId) return z;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { selection, unitSelections, ...rest } = z;
      return rest as EquipmentZone;
    });
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), {
        zones, updatedAt: serverTimestamp(),
      });
    } catch (err) { handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${selectedSystem.id}`); }
  };

  // Update Ez (zone air distribution effectiveness) for ASHRAE 62.1
  const handleSetZoneEz = async (zoneId: string, ezId: string) => {
    if (!selectedSystem || !project) return;
    const zones = (selectedSystem.zones ?? [] as EquipmentZone[]).map((z: EquipmentZone) =>
      z.id === zoneId ? { ...z, ezId } : z);
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), {
        zones, updatedAt: serverTimestamp(),
      });
    } catch (err) { handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${selectedSystem.id}`); }
  };

  // Package / DuctableSplit: add a unit to zone.unitSelections[]
  const handleAddZoneUnit = async (zoneId: string, sel: IDUSelection) => {
    if (!selectedSystem || !project) return;
    const zones = (selectedSystem.zones ?? [] as EquipmentZone[]).map((z: EquipmentZone) =>
      z.id === zoneId ? { ...z, unitSelections: [...(z.unitSelections ?? []), sel] } : z);
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), {
        zones, updatedAt: serverTimestamp(),
      });
    } catch (err) { handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${selectedSystem.id}`); }
    setZoneMultiUnitPicker(null);
  };

  // Package / DuctableSplit: remove a unit at index from zone.unitSelections[]
  const handleRemoveZoneUnit = async (zoneId: string, idx: number) => {
    if (!selectedSystem || !project) return;
    const zones = (selectedSystem.zones ?? [] as EquipmentZone[]).map((z: EquipmentZone) => {
      if (z.id !== zoneId) return z;
      const updated = (z.unitSelections ?? []).filter((_: IDUSelection, i: number) => i !== idx);
      return { ...z, unitSelections: updated };
    });
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), {
        zones, updatedAt: serverTimestamp(),
      });
    } catch (err) { handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${selectedSystem.id}`); }
  };

  // Split: add a unit to system.roomSelections[roomId][]
  const handleAddRoomUnit = async (roomId: string, sel: IDUSelection) => {
    if (!selectedSystem || !project) return;
    const existing = (selectedSystem.roomSelections ?? {})[roomId] ?? [];
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), {
        [`roomSelections.${roomId}`]: [...existing, sel],
        updatedAt: serverTimestamp(),
      });
    } catch (err) { handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${selectedSystem.id}`); }
    setRoomUnitPicker(null);
  };

  // Split: remove a unit at index from system.roomSelections[roomId][]
  const handleRemoveRoomUnit = async (roomId: string, idx: number) => {
    if (!selectedSystem || !project) return;
    const existing = (selectedSystem.roomSelections ?? {})[roomId] ?? [];
    const updated = existing.filter((_: IDUSelection, i: number) => i !== idx);
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), {
        [`roomSelections.${roomId}`]: updated,
        updatedAt: serverTimestamp(),
      });
    } catch (err) { handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${selectedSystem.id}`); }
  };

  const selectODU = async (systemId: string, sel: ODUSelection) => {
    await updateSystemField(systemId, { oduSelection: sel });
    const sys = equipSystems.find(s => s.id === systemId);
    void saveEquipmentEntry(`${systemId}-odu`, {
      systemId, systemName: sys?.name ?? '',
      type: 'VRF-ODU',
      brand: sel.brand, modelSeries: sel.modelSeries,
      trCapacity: sel.trCapacity, quantity: 1,
    });
    // Lock brand at system level for ODU picker consistency
    if (sys && !sys.brandLocked) {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', systemId), {
        brand: sel.brand, brandLocked: true, updatedAt: serverTimestamp(),
      });
    }
  };

  const removeODU = async (systemId: string) => {
    await updateSystemField(systemId, { oduSelection: null });
    void deleteEquipmentEntry(`${systemId}-odu`);
  };

  const saveEquipmentEntry = async (docId: string, data: Record<string, any>) => {
    try {
      await setDoc(doc(db, 'projects', project.id, 'equipment', docId), {
        ...data,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch { /* non-blocking — equipment register is best-effort */ }
  };

  const deleteEquipmentEntry = async (docId: string) => {
    try {
      await deleteDoc(doc(db, 'projects', project.id, 'equipment', docId));
    } catch { /* non-blocking */ }
  };

  const selectUnit = async (systemId: string, sel: SingleUnitSelection) => {
    const stored: SingleUnitSelection = unitQuantity > 1 ? { ...sel, quantity: unitQuantity } : sel;
    await updateSystemField(systemId, { unitSelection: stored });
    const sys = equipSystems.find(s => s.id === systemId);
    void saveEquipmentEntry(`${systemId}-unit`, {
      systemId, systemName: sys?.name ?? '',
      type: sys?.type ?? 'Unit',
      brand: sel.brand, modelSeries: sel.modelSeries, subType: sel.subType ?? null,
      trCapacity: sel.trCapacity, quantity: stored.quantity ?? 1,
    });
  };

  const removeUnit = async (systemId: string) => {
    await updateSystemField(systemId, { unitSelection: null });
    void deleteEquipmentEntry(`${systemId}-unit`);
  };

  const unlockBrand = async (system: EquipmentSystem) => {
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', system.id), {
        brand: null,
        brandLocked: false,
        oduSelection: null,
        updatedAt: serverTimestamp(),
      });
      toast.success('ODU brand unlocked — ODU selection cleared');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${system.id}`);
    }
  };

  // ── Chiller multi-unit handlers ──────────────────────────────────────────

  const addChillerUnit = async (systemId: string, sel: SingleUnitSelection) => {
    const sys = equipSystems.find(s => s.id === systemId);
    const current: ODUCombinationUnit[] = (sys as any)?.chillerUnits ?? [];
    const newUnit: ODUCombinationUnit = {
      modelId: sel.modelId, brand: sel.brand,
      modelSeries: sel.modelSeries, trCapacity: sel.trCapacity, quantity: 1,
    };
    await updateSystemField(systemId, { chillerUnits: [...current, newUnit] });
    void saveEquipmentEntry(`${systemId}-chiller-${current.length}`, {
      systemId, systemName: sys?.name ?? '', type: 'Chiller',
      brand: sel.brand, modelSeries: sel.modelSeries, trCapacity: sel.trCapacity, quantity: 1,
    });
  };

  const removeChillerUnit = async (systemId: string, idx: number) => {
    const sys = equipSystems.find(s => s.id === systemId);
    const hasNew = ((sys as any)?.chillerUnits ?? []).length > 0;
    if (!hasNew) { await removeUnit(systemId); return; }
    const current = [...((sys as any).chillerUnits as ODUCombinationUnit[])];
    current.splice(idx, 1);
    await updateSystemField(systemId, { chillerUnits: current });
  };

  const updateChillerUnitQty = async (systemId: string, idx: number, qty: number) => {
    if (qty < 1 || qty > 20) return;
    const sys = equipSystems.find(s => s.id === systemId);
    const hasNew = ((sys as any)?.chillerUnits ?? []).length > 0;
    if (!hasNew) {
      if (sys?.unitSelection) await updateSystemField(systemId, { unitSelection: { ...sys.unitSelection, quantity: qty } });
      return;
    }
    const current = [...((sys as any).chillerUnits as ODUCombinationUnit[])];
    current[idx] = { ...current[idx], quantity: qty };
    await updateSystemField(systemId, { chillerUnits: current });
  };

  const updateChillerUnitRole = async (systemId: string, idx: number, role: 'working' | 'standby') => {
    const sys = equipSystems.find(s => s.id === systemId);
    const current = [...((sys as any)?.chillerUnits as ODUCombinationUnit[] ?? [])];
    if (current.length === 0) return;
    current[idx] = { ...current[idx], role };
    await updateSystemField(systemId, { chillerUnits: current });
  };

  // Actual TR = designer's minimum required capacity at site conditions; OEM must
  // confirm in their technical proposal. Used for plant sizing. Empty string clears
  // the override and falls back to Nominal (trCapacity).
  const updateChillerUnitActualTR = async (systemId: string, idx: number, raw: string) => {
    const sys = equipSystems.find(s => s.id === systemId);
    const current = [...((sys as any)?.chillerUnits as ODUCombinationUnit[] ?? [])];
    if (current.length === 0) return;
    const trimmed = raw.trim();
    if (trimmed === '') {
      const { actualTR: _drop, ...rest } = current[idx];
      current[idx] = rest as ODUCombinationUnit;
    } else {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) return;
      current[idx] = { ...current[idx], actualTR: n };
    }
    await updateSystemField(systemId, { chillerUnits: current });
  };

  // ── AHU condensing unit multi-unit handlers ──────────────────────────────

  const addAHUUnit = async (systemId: string, sel: SingleUnitSelection) => {
    const sys = equipSystems.find(s => s.id === systemId);
    const current: SingleUnitSelection[] = (sys as any)?.ahuUnits ?? [];
    await updateSystemField(systemId, { ahuUnits: [...current, { ...sel, quantity: 1 }] });
    void saveEquipmentEntry(`${systemId}-ahu-${current.length}`, {
      systemId, systemName: sys?.name ?? '', type: 'AHU',
      brand: sel.brand, modelSeries: sel.modelSeries, trCapacity: sel.trCapacity, quantity: 1,
    });
  };

  const removeAHUUnit = async (systemId: string, idx: number) => {
    const sys = equipSystems.find(s => s.id === systemId);
    const hasNew = ((sys as any)?.ahuUnits ?? []).length > 0;
    if (!hasNew) { await removeUnit(systemId); return; }
    const current = [...((sys as any).ahuUnits as SingleUnitSelection[])];
    current.splice(idx, 1);
    await updateSystemField(systemId, { ahuUnits: current });
  };

  const updateAHUUnitQty = async (systemId: string, idx: number, qty: number) => {
    if (qty < 1 || qty > 20) return;
    const sys = equipSystems.find(s => s.id === systemId);
    const hasNew = ((sys as any)?.ahuUnits ?? []).length > 0;
    if (!hasNew) {
      if (sys?.unitSelection) await updateSystemField(systemId, { unitSelection: { ...sys.unitSelection, quantity: qty } });
      return;
    }
    const current = [...((sys as any).ahuUnits as SingleUnitSelection[])];
    current[idx] = { ...current[idx], quantity: qty };
    await updateSystemField(systemId, { ahuUnits: current });
  };

  // ── Computed values ────────────────────────────────────────────────────────

  // Sidebar is only shown for VRF (multiple ODU groups) and Hybrid (multiple system types)
  const showSidebar = hvacSystemCategory === 'VRF' || hvacSystemCategory === 'Hybrid';

  // TFA/DOAS resolution now lives in the shared lib/hvac/tfa resolver (single source
  // of truth across LC / SD / ZoneList / reports). These thin wrappers keep the
  // existing call sites unchanged. room.tfaMode is the primary driver; the legacy
  // zone/system link is the fallback for unset rooms.
  const findDoasForRoom = (room: any) => resolveRoomTfa(room, equipSystems, zoneDocs).doas;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getEffectiveTfaMode = (room: any, _doas: any | null): 'no-tfa' | 'tfa-served' | 'tfa-only' =>
    resolveRoomTfa(room, equipSystems, zoneDocs).mode;

  // Persist a zone's default TFA mode (Phase E). Writes to /zones/{zoneId}.
  // Uses setDoc+merge (not updateDoc) because LC zones can be "virtual" — they have
  // no /zones document until an override is first saved (a freshly-added zone like
  // "Zone 3" has none). updateDoc would throw "No document to update" and the mode
  // would silently fail to save. merge:true creates the doc if missing.
  const updateZoneTfaDefaultMode = async (zoneId: string, mode: 'inherit' | 'tfa-served' | 'tfa-only') => {
    try {
      const ref = doc(db, 'projects', project.id, 'zones', zoneId);
      const payload: any = mode === 'inherit' ? { tfaDefaultMode: deleteField() } : { tfaDefaultMode: mode };
      payload.updatedAt = serverTimestamp();
      await setDoc(ref, payload, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `zones/${zoneId}`);
    }
  };

  // Persist a room's TFA mode override. 'inherit' deletes the field.
  const updateRoomTfaMode = async (roomId: string, mode: 'inherit' | 'no-tfa' | 'tfa-served' | 'tfa-only') => {
    try {
      const ref = doc(db, 'projects', project.id, 'rooms', roomId);
      const payload: any = mode === 'inherit' ? { tfaMode: deleteField() } : { tfaMode: mode };
      payload.updatedAt = serverTimestamp();
      await updateDoc(ref, payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `rooms/${roomId}`);
    }
  };

  // getRoomReqs: read the persisted _calc* snapshot written by Load Calculator. ES no longer
  // runs its own load engine — Load Calculator is the single source of truth, and every edit
  // (move / update / delete / TFA / design-condition change) re-persists the affected rooms,
  // so this snapshot stays current. (Previously ES had a parallel computeRoomReqs engine that
  // could diverge from LC; it was removed 2026-06-19.)
  const getRoomReqs = (roomId: string) => {
    const r = rooms.find(x => x.id === roomId);
    const summerReqTR = Number(r?._calcRequiredTR) || 0;
    const summerCFM   = Number(r?._calcDesignCFM) || 0;
    return {
      requiredTR:         summerReqTR,
      governingTR:        Number(r?._calcGoverningTR) || 0,
      designCFM:          summerCFM,
      monsoonLoadTR:      Number(r?._calcMonsoonLoadTR) || 0,
      monsoonGoverningTR: Number(r?._calcMonsoonGoverningTR) || 0,
      monsoonRequiredTR:  Number(r?._calcMonsoonRequiredTR) || 0,
      monsoonDesignCFM:   Number(r?._calcMonsoonDesignCFM) || 0,
      overallGoverningTR: Number(r?._calcOverallGoverningTR) || Number(r?._calcGoverningTR) || 0,
      overallRequiredTR:  Number(r?._calcOverallRequiredTR)  || summerReqTR,
      overallDesignCFM:   Number(r?._calcOverallDesignCFM)   || summerCFM,
      // TFA fallback — only populated on rooms that were last persisted in
      // TFA mode by LC. Live calc above will produce correct values regardless.
      tfaCoilBTUH:        Number((r as any)?._calcTfaCoilBTUH) || 0,
      tfaCoilTR:          Number((r as any)?._calcTfaCoilTR) || 0,
      tfaCfm:             Number((r as any)?._calcTfaCfm) || 0,
      monsoonTfaCoilBTUH: Number((r as any)?._calcMonsoonTfaCoilBTUH) || 0,
      monsoonTfaCoilTR:   Number((r as any)?._calcMonsoonTfaCoilTR) || 0,
      isTFA:              !!(r as any)?._calcTfaCoilBTUH,
      // Phase D fallback — persisted by LC so the SD undersized warning shows
      // before any live "Refresh Loads" recalc on this system.
      isTfaOnly:          !!(r as any)?._calcTfaOnly,
      tfaCarryingBTUH:    Number((r as any)?._calcTfaCarryingBTUH) || 0,
      tfaCarryingDeficit: Number((r as any)?._calcTfaCarryingDeficit) || 0,
    };
  };

  // Computed from room documents — single source of truth shared with Load Calculator
  const systemRoomIds = useMemo(
    () => {
      if (!selectedSystemId) return [];
      // Rooms can be linked to a system three ways: legacy flat (room.zoneId === systemId),
      // modern (room.systemId === systemId), OR via the system's sub-zones (zone.roomIds[]).
      // The sub-zone path was missing — so chillers built with zones found no rooms here,
      // which broke live recalc (it fell back to stale persisted TR) and the OA/diversity sums.
      const sys = equipSystems.find(s => s.id === selectedSystemId) as any;
      const subZoneRoomIds = new Set<string>();
      ((sys?.zones ?? []) as any[]).forEach((z: any) =>
        (z.roomIds ?? []).forEach((rid: string) => subZoneRoomIds.add(rid)));
      return rooms
        .filter((r: any) => r.zoneId === selectedSystemId || r.systemId === selectedSystemId || subZoneRoomIds.has(r.id))
        .map((r: any) => r.id);
    },
    [rooms, selectedSystemId, equipSystems],
  );

  // Fresh air CFM from LC FACPH values — used by AHU spec autofill
  const totalSystemOACFM = useMemo(
    () => systemRoomIds.reduce((sum, rid) => {
      const r = rooms.find((x: any) => x.id === rid) as any;
      if (!r) return sum;
      const vol = calculateRoomVolume(r);
      return sum + vol * (Number(r.facph) || 0) / 60;
    }, 0),
    [systemRoomIds, rooms],
  );

  // Simplified space heating load (ventilation component only) for heating coil sizing
  const systemVentHeatingKW = useMemo(() => {
    const indoorTemp = Number(project?.insideSummerTemp ?? project?.data?.insideSummerTemp ?? 75);
    const winterOutdoor = Number(project?.winterDesignTemp ?? project?.data?.winterDesignTemp ?? 40);
    const deltaT = Math.max(0, indoorTemp - winterOutdoor);
    return (1.08 * totalSystemOACFM * deltaT) / 3412;
  }, [totalSystemOACFM, project]);

  // True if any system room has includeHumidifier flag OR psychro shows humidification load
  const systemHasHumidifierFlag = systemRoomIds.some(rid => {
    const r = rooms.find((x: any) => x.id === rid) as any;
    return r?.includeHumidifier === true;
  });

  // A room is "assigned" if its systemId matches any equipment system (new) or zoneId matches (legacy)
  const allAssignedIds = new Set(rooms.filter((r: any) => equipSystems.some(s => s.id === r.systemId || s.id === r.zoneId)).map((r: any) => r.id));
  // TFA-only rooms are DOAS-fed with no space AHU, so they legitimately have no space-system
  // assignment — the "unassigned" banner is about SPACE equipment coverage, so don't flag them.
  const unassignedRooms = rooms.filter((r: any) => !allAssignedIds.has(r.id) && r?.tfaMode !== 'tfa-only' && !r?._calcTfaOnly);

  const selectedSystem = equipSystems.find(s => s.id === selectedSystemId) ?? null;

  // ASHRAE 62.1 multi-space ventilation — only for central air types
  const systemVent62 = useMemo(() => {
    if (!selectedSystem) return null;
    const centralTypes: SystemType[] = ['AHU', 'Chiller', 'Package', 'DuctableSplit'];
    if (!centralTypes.includes(selectedSystem.type)) return null;
    const zones = (selectedSystem.zones ?? []) as EquipmentZone[];
    if (zones.length === 0) return null;
    const zoneCalcs = zones.map(z => {
      const zoneRooms = z.roomIds.map(id => rooms.find((r: any) => r.id === id)).filter(Boolean) as any[];
      return calcZoneVentilation(z.id, z.name, zoneRooms, z.ezId ?? 'ceiling_cool');
    });
    return calcSystemVentilation62(zoneCalcs);
  }, [selectedSystem, rooms]);

  // ── Project-wide DOAS status ────────────────────────────────────────────
  // Used by the SD header chip so the user sees at a glance whether the
  // project has any DOAS unit and what coverage it provides. DOAS is optional
  // — when none exist, the chip explicitly says so (OA on primary).
  const projectDoasAggregate = useMemo(() => {
    const doasUnits = (equipSystems as any[]).filter(s => s?.type === 'DOAS');
    // Resolver-based served rooms (tfaMode primary, legacy link fallback) — matches
    // doasServedRoomIds and the LC. A raw-link count missed rooms set to TFA via the
    // LC dropdown (tfaMode), so this chip read "0 prim · 0 rooms".
    const servedPrimaryIds = new Set<string>();
    const servedRoomIds: string[] = [];
    for (const r of rooms as any[]) {
      if (!resolveRoomTfa(r, equipSystems, zoneDocs).doas) continue;
      servedRoomIds.push(r.id);
      if (r.systemId) servedPrimaryIds.add(r.systemId);
      else if (r.zoneId) servedPrimaryIds.add(r.zoneId);
    }
    const totalOACFM = servedRoomIds.reduce((sum, rid) => {
      const r = rooms.find((x: any) => x.id === rid) as any;
      if (!r) return sum;
      return sum + (calculateRoomVolume(r) * (Number(r.facph) || 0)) / 60;
    }, 0);
    return {
      hasDoas: doasUnits.length > 0,
      doasCount: doasUnits.length,
      primaryCount: servedPrimaryIds.size,
      roomCount: servedRoomIds.length,
      totalOACFM,
      firstDoasId: doasUnits[0]?.id as string | undefined,
    };
  }, [equipSystems, rooms, zoneDocs]);

  // ── DOAS aggregation ────────────────────────────────────────────────────
  // DOAS systems have no rooms assigned directly — they serve rooms belonging
  // to the primary systems listed in doasLinkedSystemIds. Aggregate those.
  const doasServedRoomIds = useMemo(() => {
    if (!selectedSystem || selectedSystem.type !== 'DOAS') return [] as string[];
    // Resolver-based (matches the LC): a room is served by this DOAS when its
    // tfaMode resolves to it (primary path) — or, for unset/inherit rooms, when its
    // zone/system is in this DOAS's legacy link arrays (fallback inside resolveRoomTfa).
    // Using the raw links alone missed rooms set to "Central cold TFA" via the LC
    // dropdown (tfaMode), so the tile showed 0 CFM / 0 TR / 0 rooms.
    return rooms
      .filter((r: any) => resolveRoomTfa(r, equipSystems, zoneDocs).doas?.id === selectedSystem.id)
      .map((r: any) => r.id);
  }, [selectedSystem, rooms, equipSystems, zoneDocs]);

  // Phase D — tfa-only rooms served by this DOAS whose sensible load exceeds the
  // TFA supply-air carrying capacity (1.08 × CFM × ΔT). Warning only; the engine
  // never auto-bumps CFM. Mirrors the LC project-summary banner.
  const doasUndersizedRooms = useMemo(() => {
    return doasServedRoomIds
      .map((rid) => {
        const reqs: any = getRoomReqs(rid);
        const r = rooms.find((x: any) => x.id === rid) as any;
        return {
          id: rid,
          name: r?.name ?? 'Room',
          deficit: Number(reqs?.tfaCarryingDeficit) || 0,
          isTfaOnly: !!reqs?.isTfaOnly,
        };
      })
      .filter((x) => x.isTfaOnly && x.deficit > 0);
    // getRoomReqs reads the persisted snapshot on `rooms`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doasServedRoomIds, rooms]);

  // OA CFM for DOAS = sum of facph × volume over served rooms.
  const doasOACFM = useMemo(
    () => doasServedRoomIds.reduce((sum, rid) => {
      const r = rooms.find((x: any) => x.id === rid) as any;
      if (!r) return sum;
      const vol = calculateRoomVolume(r);
      return sum + vol * (Number(r.facph) || 0) / 60;
    }, 0),
    [doasServedRoomIds, rooms],
  );

  // TFA coil sizing — LIVE psychrometric calc using current supply settings.
  //
  // Previously this memo summed persisted _calcTfaCoilBTUH from rooms, but
  // those values were locked to the supply temp/RH at the time of last persist.
  // Result: changing Supply Temp or RH on the tile didn't refresh the displayed
  // TFA coil load until the user manually hit Refresh Loads on each primary.
  //
  // Fix: always compute live from project design conditions + current DOAS
  // supply + aggregated OA CFM. The persisted per-room values still drive
  // downstream primary-coil sizing; this aggregate is purely the live preview
  // of the DOAS unit duty against the supply settings the user is tuning.
  const doasTFAAggregate = useMemo(() => {
    if (doasOACFM <= 0) {
      return {
        summerCoilTR: 0,
        monsoonCoilTR: 0,
        governingCoilTR: 0,
        governs: 'summer' as 'summer' | 'monsoon',
        cfm: 0,
        source: 'empty' as const,
      };
    }
    const outdoorT  = Number(project?.summerDesignTemp ?? project?.data?.summerDesignTemp ?? 95);
    const outdoorRH = Number(project?.summerDesignHumidity ?? project?.data?.summerDesignHumidity
                            ?? project?.outsideSummerHumidity ?? project?.data?.outsideSummerHumidity ?? 70);
    const indoorT   = Number(project?.insideSummerTemp ?? project?.data?.insideSummerTemp ?? 75);
    const indoorRH  = Number(project?.insideSummerHumidity ?? project?.data?.insideSummerHumidity ?? 50);
    const altitude  = Number(project?.altitude ?? project?.data?.altitude ?? 0);
    const monsoonT  = Number(project?.monsoonDesignTemp ?? project?.data?.monsoonDesignTemp ?? outdoorT);
    const monsoonRH = Number(project?.monsoonDesignHumidity ?? project?.data?.monsoonDesignHumidity ?? outdoorRH);
    const incMonsoon = !!(project?.includeMonsoon ?? project?.data?.includeMonsoon);
    const supplyT  = (selectedSystem as any)?.tfaSupplyTemp ?? 55;
    const supplyRH = (selectedSystem as any)?.tfaSupplyHumidity ?? 90;
    const epsS = Math.max(0, Math.min(1, (selectedSystem as any)?.ervSensibleEffectiveness ?? 0));
    const epsL = Math.max(0, Math.min(1, (selectedSystem as any)?.ervLatentEffectiveness ?? 0));

    const psyOut = calculatePsychrometrics(outdoorT, outdoorRH, altitude);
    const psyIn  = calculatePsychrometrics(indoorT, indoorRH, altitude);
    const psySup = calculatePsychrometrics(supplyT, supplyRH, altitude);

    // Cool OA to its apparatus dew point when the supply is warm enough to need
    // reheat (mirrors calculateTFALoad): the coil leaves at the ADP, a reheat coil
    // warms it to the supply temp. A cold supply leaves the coil at the supply temp
    // (no overcool). Sizing the coil only to the supply temp would understate it by
    // the reheat. Deadband (5°F) absorbs the bypass-delivered rise above ADP.
    const coilADP = dewPointFromHumidityRatio(psySup.humidityRatio, altitude);
    const needsReheat = supplyT - coilADP >= 5;
    const coilLeavingT = needsReheat ? coilADP : supplyT;
    const reheatBTUH = needsReheat ? 1.08 * doasOACFM * (supplyT - coilADP) : 0;

    const sumSen = Math.max(0, 1.08 * doasOACFM * (outdoorT - coilLeavingT)
      - epsS * 1.08 * doasOACFM * (outdoorT - indoorT));
    const sumLat = Math.max(0, 0.68 * doasOACFM * (psyOut.humidityRatio - psySup.humidityRatio) * 7000
      - epsL * 0.68 * doasOACFM * (psyOut.humidityRatio - psyIn.humidityRatio) * 7000);
    const sumTotal = sumSen + sumLat;

    let monTotal = 0;
    if (incMonsoon) {
      const psyMon = calculatePsychrometrics(monsoonT, monsoonRH, altitude);
      const monSen = Math.max(0, 1.08 * doasOACFM * (monsoonT - coilLeavingT)
        - epsS * 1.08 * doasOACFM * (monsoonT - indoorT));
      const monLat = Math.max(0, 0.68 * doasOACFM * (psyMon.humidityRatio - psySup.humidityRatio) * 7000
        - epsL * 0.68 * doasOACFM * (psyMon.humidityRatio - psyIn.humidityRatio) * 7000);
      monTotal = monSen + monLat;
    }
    const govTotal = Math.max(sumTotal, monTotal);

    return {
      summerCoilTR: sumTotal / 12000,
      monsoonCoilTR: monTotal / 12000,
      governingCoilTR: govTotal / 12000,
      governs: (monTotal > sumTotal ? 'monsoon' : 'summer') as 'summer' | 'monsoon',
      coilADP,
      reheatBTUH,
      reheatTR: reheatBTUH / 12000,
      cfm: doasOACFM,
      source: 'live-supply' as const,
    };
  }, [doasOACFM, selectedSystem, project]);

  // TFA/DOAS fresh-air WINTER heating coil — sum of the per-room persisted
  // _calcTfaWinterHeatingBTUH (engine tempers cold OA up to the neutral winter
  // supply). No live winter-supply control yet, so the persisted values (each
  // computed against that room's winter design conditions) are the source.
  const doasTfaWinterHeatingBTUH = useMemo(
    () => doasServedRoomIds.reduce((sum, rid) => {
      const r = rooms.find((x: any) => x.id === rid) as any;
      return sum + (Number(r?._calcTfaWinterHeatingBTUH) || 0);
    }, 0),
    [doasServedRoomIds, rooms],
  );

  // VRF diversity calculation — individual IDUs + zone AHU/IDU selections
  const totalIDU_TR = selectedSystem
    ? Object.values(selectedSystem.iduSelections as any).reduce((s: number, x: any) => s + normalizeIDUList(x).reduce((ss, u) => ss + u.trCapacity * (u.quantity ?? 1), 0), 0)
      + (selectedSystem.zones ?? (selectedSystem as any).ahuGroups ?? []).reduce(
          (s: number, z: EquipmentZone) => s + (z.selection ? z.selection.trCapacity * (z.selection.quantity ?? 1) : 0),
          0,
        )
    : 0;
  const requiredODU_TR = selectedSystem ? totalIDU_TR * (selectedSystem.diversityFactor ?? 0.75) : 0;

  // Connection ratio check — use effectiveTR (modular) if set, else single-unit trCapacity
  const oduCapTR = selectedSystem?.oduSelection?.combination
    ? selectedSystem.oduSelection.combination.reduce((s, u) => s + u.trCapacity * u.quantity, 0)
    : (selectedSystem?.oduSelection?.effectiveTR ?? selectedSystem?.oduSelection?.trCapacity ?? 0);
  const connectionPct = oduCapTR > 0 ? (totalIDU_TR / oduCapTR) * 100 : 0;
  const connOK = oduCapTR > 0 && connectionPct >= 50 && connectionPct <= 130;

  // Package / DuctableSplit totals — use overall (max of summer + monsoon) governing values
  const assignedRoomReqs = systemRoomIds.map(rid => getRoomReqs(rid));
  const totalRequiredTR        = assignedRoomReqs.reduce((s, r) => s + r.overallRequiredTR, 0);
  // TFA-only rooms have no space coil — fed by the DOAS — so exclude their air-change CFM
  // from the space AHU/plant design airflow (matches LC/PDF/Excel). TR is 0 either way.
  const totalDesignCFM         = assignedRoomReqs.reduce((s, r) => s + (r.isTfaOnly ? 0 : r.overallDesignCFM), 0);
  const totalSummerRequiredTR  = assignedRoomReqs.reduce((s, r) => s + r.requiredTR, 0);
  const totalMonsoonRequiredTR = assignedRoomReqs.reduce((s, r) => s + r.monsoonRequiredTR, 0);
  const totalSummerThermalTR   = systemRoomIds.reduce((s, rid) => {
    const room = rooms.find((r: any) => r.id === rid) as any;
    return s + (Number(room?._calcLoadTR) || 0);
  }, 0);
  const totalMonsoonThermalTR  = assignedRoomReqs.reduce((s, r) => s + r.monsoonLoadTR, 0);
  const totalSummerDesignCFM   = assignedRoomReqs.reduce((s, r) => s + (r.isTfaOnly ? 0 : r.designCFM), 0);
  const totalMonsoonDesignCFM  = assignedRoomReqs.reduce((s, r) => s + (r.isTfaOnly ? 0 : r.monsoonDesignCFM), 0);
  const includeMonsoon         = !!(project?.includeMonsoon ?? (project as any)?.data?.includeMonsoon);
  const governingSeason        = includeMonsoon && totalMonsoonRequiredTR > totalSummerRequiredTR ? 'Monsoon' : 'Summer';

  // LC zones that still have rooms not yet assigned to the selected system — for quick-assign
  const availableLcZones = useMemo(() => {
    if (!selectedSystem) return [];
    const groups = new Map<string, { zoneId: string; zoneName: string; roomCount: number; totalTR: number }>();
    for (const r of rooms as any[]) {
      const zid = r.zoneId || 'unzoned';
      const zname = r.zoneName || 'Unzoned';
      if (r.systemId === selectedSystem.id || r.zoneId === selectedSystem.id) continue; // already in this system
      if (!groups.has(zid)) groups.set(zid, { zoneId: zid, zoneName: zname, roomCount: 0, totalTR: 0 });
      const g = groups.get(zid)!;
      g.roomCount++;
      g.totalTR += Number(r._calcOverallRequiredTR ?? r._calcRequiredTR ?? 0);
    }
    return [...groups.values()].filter(g => g.roomCount > 0);
  }, [selectedSystem, rooms]);

  // Per-zone breakdown for Chiller terminal unit selection
  const systemZonesData = useMemo(() => {
    if (!selectedSystem || selectedSystem.type !== 'Chiller') return [];
    type ZoneEntry = { zoneId: string; zoneName: string; roomIds: string[]; totalTR: number; totalCFM: number; needsHumidifier: boolean };
    const zoneMap = new Map<string, ZoneEntry>();
    for (const roomId of systemRoomIds) {
      const room = rooms.find(r => r.id === roomId) as any;
      if (!room) continue;
      const zId = room.zoneId ?? selectedSystem.id;
      const zName = room.zoneName ?? selectedSystem.name;
      if (!zoneMap.has(zId)) zoneMap.set(zId, { zoneId: zId, zoneName: zName, roomIds: [], totalTR: 0, totalCFM: 0, needsHumidifier: false });
      const z = zoneMap.get(zId)!;
      z.roomIds.push(roomId);
      const reqs = getRoomReqs(roomId);
      z.totalTR += reqs.overallRequiredTR;
      z.totalCFM += reqs.isTfaOnly ? 0 : reqs.overallDesignCFM; // TFA-only air is DOAS-side
    }
    return Array.from(zoneMap.values());
  }, [selectedSystem, systemRoomIds, rooms]);

  // Per-zone data for SpecSheet AHU unit-wise breakdown (all system types)
  const zoneUnitsForSpec = useMemo(() => {
    if (!selectedSystem) return [];
    type ZEntry = {
      zoneId: string;
      zoneName: string;
      requiredTR: number;
      designCFM: number;
      oaCFM: number;
      ahuConfig?: AHUConfig;
      selectedAHUTotalTR?: number;
      selectedAHUTotalCFM?: number;
      selectedAHUQty?: number;
      selectedAHUPerUnitTR?: number;
      selectedAHUPerUnitCFM?: number;
    };
    const zoneMap = new Map<string, ZEntry>();
    for (const roomId of systemRoomIds) {
      const room = rooms.find((r: any) => r.id === roomId) as any;
      if (!room) continue;
      const zId = room.zoneId ?? selectedSystem.id;
      const zName = room.zoneName ?? selectedSystem.name;
      if (!zoneMap.has(zId)) zoneMap.set(zId, { zoneId: zId, zoneName: zName, requiredTR: 0, designCFM: 0, oaCFM: 0 });
      const z = zoneMap.get(zId)!;
      const reqs = getRoomReqs(roomId);
      // Use overallGoverningTR (max of summer/monsoon load — no safety) so that
      // the AHU spec's own 10% safety in buildAHU is applied ONCE. Previously
      // we used overallRequiredTR which already includes per-room safety, so
      // buildAHU's 10% landed on top → ~1.6× double-safety stacking, inflating
      // Zone 1 to 128 TR vs actual monsoon governing 72.78 TR (TEZPUR case).
      z.requiredTR += reqs.overallGoverningTR;
      z.designCFM += reqs.isTfaOnly ? 0 : reqs.overallDesignCFM; // TFA-only air is DOAS-side
      const vol = calculateRoomVolume(room);
      z.oaCFM += vol * (Number(room.facph) || 0) / 60;
    }

    // Enrich with each zone's actually-selected AHU/FCU units so the spec sheet
    // can show per-unit capacity & quantity from the user's picks instead of
    // recomputing from load TR. Sum trCapacity × qty across all selected units
    // in the zone. Per-unit values use the largest unit when models are mixed.
    const sysZones = (selectedSystem.zones ?? []) as EquipmentZone[];
    for (const z of zoneMap.values()) {
      const zoneDoc = sysZones.find(sz => sz.id === z.zoneId);
      // Capture per-zone ahuConfig (mixing box, mounting, fan, coil rows, filters)
      // so the spec sheet honors zone-level overrides like ceiling-hung / no mixing box.
      if (zoneDoc?.ahuConfig) z.ahuConfig = zoneDoc.ahuConfig;
      const units = getZoneUnits(zoneDoc);
      if (units.length === 0) continue;
      const totalTR  = units.reduce((s, u) => s + (u.trCapacity ?? 0) * (u.quantity ?? 1), 0);
      const totalCFM = units.reduce((s, u) => s + (u.cfmRated  ?? 0) * (u.quantity ?? 1), 0);
      const totalQty = units.reduce((s, u) => s + (u.quantity ?? 1), 0);
      if (totalTR <= 0 || totalQty <= 0) continue;
      const distinct = new Set(units.map(u => `${u.brand}|${u.modelSeries}|${u.trCapacity}`));
      const homogeneous = distinct.size === 1;
      const perTR  = homogeneous ? (units[0].trCapacity ?? 0) : parseFloat((totalTR / totalQty).toFixed(2));
      const perCFM = homogeneous ? (units[0].cfmRated  ?? 0) : Math.round(totalCFM / totalQty);
      z.selectedAHUTotalTR     = totalTR;
      z.selectedAHUTotalCFM    = totalCFM;
      z.selectedAHUQty         = totalQty;
      z.selectedAHUPerUnitTR   = perTR;
      z.selectedAHUPerUnitCFM  = perCFM;
    }

    return Array.from(zoneMap.values());
  }, [selectedSystem, systemRoomIds, rooms]);

  // Psychrometric analysis for the selected system
  const systemPsychro = useMemo(() => {
    if (!selectedSystem || systemRoomIds.length === 0) return null;

    const assignedRooms = systemRoomIds
      .map(id => rooms.find(r => r.id === id))
      .filter(Boolean) as any[];

    let totalSen = 0;
    let totalLat = 0;
    let hasEstimates = false;

    let totalDehumidLbsHr = 0;
    let totalHumidLbsHr   = 0;
    let totalReheatBTU    = 0;

    const roomBreakdown = assignedRooms.map(r => {
      let sen: number;
      let lat: number;
      if (r._calcSensibleBTUH != null && r._calcLatentBTUH != null) {
        sen = Number(r._calcSensibleBTUH);
        lat = Number(r._calcLatentBTUH);
      } else if (r.analysis?.totals?.ersh != null) {
        sen = Number(r.analysis.totals.ersh);
        lat = Number(r.analysis.totals.erlh ?? 0);
      } else {
        const totalBTUH = (Number(r._calcRequiredTR) || 0) * 12000;
        sen = totalBTUH * 0.75;
        lat = totalBTUH * 0.25;
        hasEstimates = true;
      }
      totalSen += sen;
      totalLat += lat;

      const moisture = r.analysis?.moisture;
      const dehumid  = moisture?.action === 'Dehumidify' ? (Number(moisture.rate) || 0) : 0;
      const humid    = moisture?.action === 'Humidify'   ? (Number(moisture.rate) || 0) : 0;
      // Reheat sized against ROOM SHF (sen/lat are room-effective values).
      // Computed live here rather than read from r.analysis.reheat — the cached
      // value may have been written by an older code path that used coil/grand
      // SHF, which inflates reheat by 10-15x for over-ventilated rooms.
      const tSHR = 0.75;
      const roomTot = sen + lat;
      const rSHR = roomTot > 0 ? sen / roomTot : 1;
      const reheatBTU = rSHR < tSHR ? Math.max(0, (lat * tSHR) / (1 - tSHR) - sen) : 0;
      totalDehumidLbsHr += dehumid;
      totalHumidLbsHr   += humid;
      totalReheatBTU    += reheatBTU;

      const summerReqTR = Number(r._calcRequiredTR) || 0;
      return {
        id: r.id, name: r.name ?? r.id, zoneName: r.zoneName ?? '',
        sen, lat,
        reqTR:          Number(r._calcOverallRequiredTR) || summerReqTR,
        summerReqTR,
        monsoonReqTR:   Number(r._calcMonsoonRequiredTR) || 0,
        monsoonLoadTR:  Number(r._calcMonsoonLoadTR) || 0,
        loadTR:  Number(r._calcLoadTR) || (sen + lat) / 12000,
        cfmTR:   Number(r._calcCfmTR) || 0,
        dehumid, humid, reheatBTU,
      };
    });

    const totalBTUH = totalSen + totalLat;
    const shr = totalBTUH > 0 ? totalSen / totalBTUH : 0.75;

    // Design conditions from project
    const indoorTemp = Number(project?.insideSummerTemp ?? project?.data?.insideSummerTemp ?? 75);
    const indoorRH   = Number(project?.insideSummerHumidity ?? project?.data?.insideSummerHumidity ?? 50);
    const altitude   = Number(project?.altitude ?? project?.data?.altitude ?? 0);
    const minAdp     = getMinAdp(project?.systemType, project?.adpBasis ?? project?.data?.adpBasis);

    let coil = null;
    if (totalSen > 0 && totalLat > 0) {
      try {
        coil = calculateCoilParameters(totalSen, totalLat, indoorTemp, indoorRH, altitude, 0.15, 35, 65, minAdp);
        const adpPsychro = calculatePsychrometrics(coil.selectedADP, 100, altitude);
        const supplyTemp = coil.selectedADP + coil.bypassFactor * (indoorTemp - coil.selectedADP);
        const supplyRH = Math.min(100, Math.round(
          (adpPsychro.humidityRatio + coil.bypassFactor * (
            calculatePsychrometrics(indoorTemp, indoorRH, altitude).humidityRatio - adpPsychro.humidityRatio
          )) / calculatePsychrometrics(supplyTemp, 100, altitude).humidityRatio * 100
        ));
        (coil as any).supplyTemp = parseFloat(supplyTemp.toFixed(1));
        (coil as any).supplyRH   = supplyRH;
      } catch { /* ignore psychro errors */ }
    }

    return {
      roomBreakdown, totalSen, totalLat, totalBTUH, shr, coil, hasEstimates, indoorTemp, indoorRH,
      totalDehumidLbsHr, totalHumidLbsHr, totalReheatBTU,
    };
  }, [selectedSystem?.id, systemRoomIds, rooms, project]);

  // ── Dehumidifier sizing — total LPH and per-zone breakdown (AHU) ─────────
  // Catalog dehumidifier models, computed once.
  const dehumidifierModels = useMemo(
    () => EQUIPMENT_CATALOG.filter(m => m.type === 'Dehumidifier' && (m.capacityLPH ?? 0) > 0),
    [],
  );

  // Per-zone moisture-removal map — works for any system that has zones (AHU, Chiller AHU
  // terminals, zoned VRF, etc.). For systems without zones, the system-level picker takes
  // over and uses systemTotalRoomDehumidLbsHr below.
  //
  // Sizes the dehumidifier as a SUPPLEMENTAL device alongside the AHU coil:
  //   ROOM latent (erlh, includes the small BF × OA leak past the coil, with safety factor)
  //   ÷ 1050 BTU·lb⁻¹ latent heat of vaporization.
  // We do NOT use the saved `moisture.rate` here — that's coil total (room + OA) and would
  // oversize a supplemental dehumidifier by 5–10× because the AHU coil handles OA latent.
  const dehumidByZone = useMemo(() => {
    const result = new Map<string, { name: string; lbsHr: number }>();
    if (!selectedSystem) return result;
    const zones = (selectedSystem.zones ?? (selectedSystem as any).ahuGroups ?? []) as EquipmentZone[];
    for (const zone of zones) {
      let lbsHr = 0;
      for (const roomId of zone.roomIds ?? []) {
        const room = rooms.find((r: any) => r.id === roomId) as any;
        const erlh = Number(room?.analysis?.totals?.erlh) || 0;
        if (erlh > 0) lbsHr += erlh / 1050;
      }
      result.set(zone.id, { name: zone.name, lbsHr });
    }
    return result;
  }, [selectedSystem, rooms]);

  // System-level room-only dehumid load — used by zoneless systems (Package, single-unit Split,
  // DOAS) that don't have a per-zone breakdown.
  const systemTotalRoomDehumidLbsHr = useMemo(() => {
    if (!selectedSystem) return 0;
    let lbsHr = 0;
    for (const roomId of systemRoomIds) {
      const room = rooms.find((r: any) => r.id === roomId) as any;
      const erlh = Number(room?.analysis?.totals?.erlh) || 0;
      if (erlh > 0) lbsHr += erlh / 1050;
    }
    return lbsHr;
  }, [selectedSystem, systemRoomIds, rooms]);

  // Reheat capacity (BTU/h) computed per zone and per system, matching the same room-SHF basis
  // the engine uses (target SHR = 0.75 — see lib/hvac/reheat.ts). For methods 1/2/3, this is
  // the heat the AHU/duct-heater must add to bring overcooled air back up to setpoint.
  const computeRoomReheatBTU = (room: any): number => {
    const sen = Number(room?.analysis?.totals?.ersh) || 0;
    const lat = Number(room?.analysis?.totals?.erlh) || 0;
    const tot = sen + lat;
    const rSHR = tot > 0 ? sen / tot : 1;
    const tSHR = 0.75;
    if (rSHR >= tSHR) return 0;
    return Math.max(0, (lat * tSHR) / (1 - tSHR) - sen);
  };

  const reheatByZone = useMemo(() => {
    const result = new Map<string, number>();
    if (!selectedSystem) return result;
    const zones = (selectedSystem.zones ?? (selectedSystem as any).ahuGroups ?? []) as EquipmentZone[];
    for (const zone of zones) {
      let btu = 0;
      for (const roomId of zone.roomIds ?? []) {
        const room = rooms.find((r: any) => r.id === roomId);
        btu += computeRoomReheatBTU(room);
      }
      result.set(zone.id, btu);
    }
    return result;
  }, [selectedSystem, rooms]);

  const systemTotalReheatBTU = useMemo(() => {
    if (!selectedSystem) return 0;
    let btu = 0;
    for (const roomId of systemRoomIds) {
      const room = rooms.find((r: any) => r.id === roomId);
      btu += computeRoomReheatBTU(room);
    }
    return btu;
  }, [selectedSystem, systemRoomIds, rooms]);

  // Chiller plant load tracks the persisted (Load Calculator) thermal load — NOT ES's in-component
  // live recalc, which can diverge from LC. Used for the displayed "Cooling Load" and for choosing
  // the governing season of the OA term.
  const chillerStoredSummerTR = totalSummerThermalTR; // Σ room._calcLoadTR (stored)
  const chillerStoredMonsoonTR = systemRoomIds.reduce((s, rid) => {
    const r = rooms.find((x: any) => x.id === rid) as any;
    return s + (Number(r?._calcMonsoonLoadTR) || 0);
  }, 0);
  const chillerMonsoonGoverns = includeMonsoon && chillerStoredMonsoonTR > chillerStoredSummerTR;
  const chillerThermalTR = chillerMonsoonGoverns ? chillerStoredMonsoonTR : chillerStoredSummerTR;

  // Outdoor-air (fresh-air / ventilation) tonnage carried inside each room's load TR.
  // Diversity is applied to the INDOOR portion only — fresh air is continuous, so it is
  // added back un-diversified. (Decision 2026-06-11; mirrors reportService plant calc.)
  // Per room: prefer the persisted _calcOaTR; for rooms calculated before that field
  // existed, fall back to load − indoor (summer), scaled by the summer OA fraction for
  // the monsoon season.
  const sumRoomOaTR = (season: 'summer' | 'monsoon') => systemRoomIds.reduce((s, rid) => {
    const r = rooms.find((x: any) => x.id === rid) as any;
    if (!r) return s;
    const loadTR = Number(season === 'monsoon' ? r._calcMonsoonLoadTR : r._calcLoadTR) || 0;
    let oaTR = Number(season === 'monsoon' ? r._calcMonsoonOaTR : r._calcOaTR);
    if (!Number.isFinite(oaTR)) {
      const summerLoadTR = Number(r._calcLoadTR) || 0;
      const indoorSummerTR = ((Number(r._calcSensibleBTUH) || 0) + (Number(r._calcLatentBTUH) || 0)) / 12000;
      const summerOaTR = Math.max(0, summerLoadTR - indoorSummerTR);
      oaTR = season === 'monsoon'
        ? (summerLoadTR > 0 ? loadTR * (summerOaTR / summerLoadTR) : 0)
        : summerOaTR;
    }
    return s + Math.min(Math.max(0, oaTR), loadTR);
  }, 0);
  const chillerOaTR = selectedSystem?.type === 'Chiller'
    ? (chillerMonsoonGoverns ? sumRoomOaTR('monsoon') : sumRoomOaTR('summer'))
    : 0;
  // Plant is sized from the SELECTED AHU/IDU capacity that the chiller actually serves
  // (engineer decision 2026-06-19), not the raw space load. Before any unit is selected, fall
  // back to the required coil duty (Σ zone overall-required TR) so a target still shows.
  const chillerCoilDutyTR = systemRoomIds.reduce((s, rid) => {
    const r = rooms.find((x: any) => x.id === rid) as any;
    const stored = Number(r?._calcOverallRequiredTR);
    const live = Number((getRoomReqs(rid) as any)?.overallRequiredTR);
    return s + (Number.isFinite(stored) && stored > 0 ? stored : (Number.isFinite(live) && live > 0 ? live : 0));
  }, 0);
  const chillerConnectedTR = selectedSystem?.type === 'Chiller'
    ? (totalIDU_TR > 0 ? totalIDU_TR : chillerCoilDutyTR)
    : 0;

  // Indoor (diversifiable) portion of the connected capacity = connected − fresh-air OA share.
  const chillerIndoorTR = Math.max(0, chillerConnectedTR - chillerOaTR);

  // Diversity-adjusted chiller plant capacity (not all zones peak simultaneously) —
  // applied to the INDOOR portion only; fresh-air OA is added back below un-diversified.
  const chillerDiverseTR = selectedSystem?.type === 'Chiller'
    ? chillerIndoorTR * (selectedSystem.diversityFactor ?? 0.75)
    : 0;

  // TFA/DOAS coil load that lands on THIS chiller plant: only DOAS units explicitly
  // marked tfaCoolingSource === 'chiller-plant' that serve rooms on this chiller.
  // Outdoor-air load is non-diverse (fresh air runs continuously), so it is NOT
  // multiplied by the diversity factor — it adds on top of the diversified space load.
  const chillerTfaCoilTR = selectedSystem?.type === 'Chiller'
    ? systemRoomIds.reduce((s, rid) => {
        const room = rooms.find((r: any) => r.id === rid) as any;
        const doas = room ? findDoasForRoom(room) : null;
        if (!doas || (doas as any).tfaCoolingSource !== 'chiller-plant') return s;
        const reqs: any = getRoomReqs(rid);
        // Governing (higher of summer / monsoon) TFA coil TR for this room.
        return s + Math.max(Number(reqs?.tfaCoilTR) || 0, Number(reqs?.monsoonTfaCoilTR) || 0);
      }, 0)
    : 0;

  // Plant required = diversified indoor load + room fresh-air OA (non-diverse)
  // + any chiller-fed TFA coil (also non-diverse).
  const chillerPlantRequiredTR = chillerDiverseTR + chillerOaTR + chillerTfaCoilTR;

  // Effective chiller units — combines new chillerUnits[] with legacy unitSelection for display
  const effectiveChillerUnits = useMemo((): ODUCombinationUnit[] => {
    if (!selectedSystem || selectedSystem.type !== 'Chiller') return [];
    const units: ODUCombinationUnit[] = (selectedSystem as any).chillerUnits ?? [];
    if (units.length > 0) return units;
    const leg = selectedSystem.unitSelection;
    if (leg) return [{ modelId: leg.modelId, brand: leg.brand, modelSeries: leg.modelSeries, trCapacity: leg.trCapacity, quantity: leg.quantity ?? 1 }];
    return [];
  }, [selectedSystem]);

  // Plant sizing uses Actual TR (OEM-confirmed at site conditions) when provided, else
  // falls back to Nominal TR. Catalog/AHRI ratings overstate real capacity in hot/humid
  // sites — see methodology note in Step 7.
  const effTR = (u: ODUCombinationUnit) => (u.actualTR != null && u.actualTR > 0 ? u.actualTR : u.trCapacity);
  const chillerTotalInstalledTR = effectiveChillerUnits.reduce((s, u) => s + effTR(u) * u.quantity, 0);
  const chillerWorkingTR = effectiveChillerUnits.filter(u => (u.role ?? 'working') === 'working').reduce((s, u) => s + effTR(u) * u.quantity, 0);
  const chillerStandbyTR = effectiveChillerUnits.filter(u => u.role === 'standby').reduce((s, u) => s + effTR(u) * u.quantity, 0);

  // ── IDU → Plant diversity check ──────────────────────────────────────────────
  // Achieved diversity = installed WORKING plant TR ÷ installed indoor-unit (AHU/FCU/
  // IDU) TR. The plant must meet at least the design diversity factor applied to the
  // connected indoor units; if achieved < design DF the plant is undersized for what
  // is hung on it. (Decision 2026-06-11.)
  const chillerInstalledIduTR = useMemo(() => {
    if (!selectedSystem || selectedSystem.type !== 'Chiller') return 0;
    let tr = 0;
    for (const z of ((selectedSystem.zones ?? []) as EquipmentZone[])) {
      for (const u of getZoneUnits(z)) tr += (u.trCapacity ?? 0) * (u.quantity ?? 1);
    }
    const idu = (selectedSystem as any).iduSelections;
    if (idu) Object.values(idu).forEach((val: any) => normalizeIDUList(val).forEach((u: any) => { tr += (u.trCapacity ?? 0) * (u.quantity ?? 1); }));
    return tr;
  }, [selectedSystem]);
  // Carve the chiller-fed TFA coil OUT of the plant first — diversity is NOT applied to
  // TFA. Only the SPACE AHUs (chillerInstalledIduTR, which excludes the separate TFA unit)
  // vs the remaining plant get the diversity ratio. (Decision 2026-06-11.)
  const chillerPlantSpaceTR = Math.max(0, chillerWorkingTR - chillerTfaCoilTR);
  // Diversity = Indoor (connected IDU) capacity ÷ Plant capacity (after TFA carve-out).
  // Up to 25% diversity is acceptable — i.e. connected indoor may exceed the plant by 25%
  // (a 125% ratio). Not a hard industry rule; just the practical upper guideline.
  const chillerDiversityDisplayPct = chillerPlantSpaceTR > 0 ? (chillerInstalledIduTR / chillerPlantSpaceTR) * 100 : 0;
  // Only meaningful once both the indoor units AND the (space) plant are present.
  const chillerDiversityActive = selectedSystem?.type === 'Chiller' && chillerInstalledIduTR > 0 && chillerPlantSpaceTR > 0;
  // Flag only when diversity goes beyond 25% (ratio > 125%) — plant small for the IDU.
  const chillerOverDiversityLimit = chillerDiversityActive && chillerDiversityDisplayPct > 125.05;

  // Effective cooling tower units — merges new ctUnits[] with legacy ctSelection
  const effectiveCTUnits = useMemo((): ODUCombinationUnit[] => {
    if (!selectedSystem || selectedSystem.type !== 'Chiller') return [];
    const units: ODUCombinationUnit[] = (selectedSystem as any).ctUnits ?? [];
    if (units.length > 0) return units;
    const leg = selectedSystem.ctSelection;
    if (leg) return [{ modelId: leg.modelId, brand: leg.brand, modelSeries: leg.modelSeries, trCapacity: leg.trCapacity, quantity: leg.quantity ?? 1 }];
    return [];
  }, [selectedSystem]);

  const ctTotalInstalledTR = effectiveCTUnits.reduce((s, u) => s + u.trCapacity * u.quantity, 0);
  const ctWorkingTR = effectiveCTUnits.filter(u => (u.role ?? 'working') === 'working').reduce((s, u) => s + u.trCapacity * u.quantity, 0);
  const ctStandbyTR = effectiveCTUnits.filter(u => u.role === 'standby').reduce((s, u) => s + u.trCapacity * u.quantity, 0);
  // Heat rejection duty ≈ chiller plant × 1.25 (accounts for compressor heat at COP ≈ 5).
  // Uses the FULL plant duty (space + any chiller-fed TFA coil) — the condenser water
  // rejects the entire refrigeration load. Standby CTs are redundancy and don't count
  // toward duty coverage — compare against working only.
  const ctRequiredTR = chillerPlantRequiredTR * 1.25;

  // All equipment selected across systems — drives the Library tab schedule
  const projectEquipmentSchedule = useMemo(() => {
    type Row = {
      key: string; type: string; systemName: string;
      roomName: string; brand: string; model: string;
      subType?: string; tr: number; qty: number;
    };
    const rows: Row[] = [];
    for (const sys of equipSystems) {
      for (const [roomId, val] of Object.entries(sys.iduSelections as any)) {
        const room = rooms.find((r: any) => r.id === roomId);
        const units = normalizeIDUList(val as any);
        for (const sel of units) {
          rows.push({
            key: `${sys.id}-idu-${roomId}-${sel.modelId ?? sel.modelSeries}`,
            type: 'VRF-IDU', systemName: sys.name,
            roomName: room?.name ?? '—',
            brand: sel.brand, model: sel.modelSeries, subType: sel.subType,
            tr: sel.trCapacity, qty: sel.quantity ?? 1,
          });
        }
      }
      for (const zone of (sys.zones ?? (sys as any).ahuGroups ?? [])) {
        if (!zone.selection) continue;
        const roomNames = zone.roomIds
          .map((id: string) => rooms.find((r: any) => r.id === id)?.name ?? id)
          .join(', ');
        rows.push({
          key: `${sys.id}-zone-${zone.id}`,
          type: sys.type === 'VRF' ? 'VRF-IDU' : 'AHU/FCU', systemName: sys.name,
          roomName: roomNames,
          brand: zone.selection.brand, model: zone.selection.modelSeries,
          subType: zone.selection.subType,
          tr: zone.selection.trCapacity, qty: 1,
        });
      }
      if (sys.oduSelection) {
        rows.push({
          key: `${sys.id}-odu`,
          type: 'VRF-ODU', systemName: sys.name, roomName: '—',
          brand: sys.oduSelection.brand, model: sys.oduSelection.modelSeries,
          tr: sys.oduSelection.trCapacity, qty: 1,
        });
      }
      if (sys.unitSelection) {
        rows.push({
          key: `${sys.id}-unit`,
          type: sys.type, systemName: sys.name, roomName: '—',
          brand: sys.unitSelection.brand, model: sys.unitSelection.modelSeries,
          subType: sys.unitSelection.subType,
          tr: sys.unitSelection.trCapacity, qty: sys.unitSelection.quantity ?? 1,
        });
      }
      // FAHU accessories (VRF ductable zones)
      for (const zone of (sys.zones ?? (sys as any).ahuGroups ?? [])) {
        if (!zone.fahu) continue;
        if (zone.fahu.hasElectricHeater && zone.fahu.electricHeaterKW > 0) {
          rows.push({
            key: `${sys.id}-fahu-heater-${zone.id}`,
            type: 'Heater', systemName: sys.name, roomName: zone.name,
            brand: 'Electric', model: `${zone.fahu.electricHeaterKW} kW Heater`,
            subType: 'Reheat', tr: 0, qty: 1,
          });
        }
        if (zone.fahu.hasHumidifier && zone.fahu.humidifierKgHr > 0) {
          const hm = zone.fahu as any;
          rows.push({
            key: `${sys.id}-fahu-humid-${zone.id}`,
            type: 'Humidifier', systemName: sys.name, roomName: zone.name,
            brand: hm.humidifierModel ? hm.humidifierModel.split(' ')[0] : 'Steam/Electric',
            model: hm.humidifierModel
              ? `${hm.humidifierModel.split(' ').slice(1).join(' ')} · ${zone.fahu.humidifierKgHr} kg/hr`
              : `${zone.fahu.humidifierKgHr} kg/hr Humidifier`,
            subType: hm.humidifierSubType || 'Humidification', tr: 0, qty: 1,
          });
        }
      }
    }
    return rows;
  }, [equipSystems, rooms]);

  // ── Project-wide system summary (Phase 7) ─────────────────────────────────
  // Per-system chiller PLANT required TR — mirrors the on-screen System-Design number
  // (chillerPlantRequiredTR): diversified indoor (connected AHU/IDU less on-unit OA) + OA
  // (non-diverse) + chiller-fed TFA coil. The Summary previously summed only room space-TR,
  // which omitted the chiller-fed TFA coil entirely (understating a chiller-fed plant by >½).
  const chillerPlantRequiredForSystem = (sys: any, rids: string[]): number => {
    const sumLoad = (field: string) => rids.reduce((s, rid) => {
      const r = rooms.find((x: any) => x.id === rid) as any; return s + (Number(r?.[field]) || 0);
    }, 0);
    const monGoverns = includeMonsoon && sumLoad('_calcMonsoonLoadTR') > sumLoad('_calcLoadTR');
    const season = monGoverns ? 'monsoon' : 'summer';
    const oa = rids.reduce((s, rid) => {
      const r = rooms.find((x: any) => x.id === rid) as any; if (!r) return s;
      const loadTR = Number(season === 'monsoon' ? r._calcMonsoonLoadTR : r._calcLoadTR) || 0;
      let oaTR = Number(season === 'monsoon' ? r._calcMonsoonOaTR : r._calcOaTR);
      if (!Number.isFinite(oaTR)) {
        const sLoad = Number(r._calcLoadTR) || 0;
        const sIndoor = ((Number(r._calcSensibleBTUH) || 0) + (Number(r._calcLatentBTUH) || 0)) / 12000;
        const sOa = Math.max(0, sLoad - sIndoor);
        oaTR = season === 'monsoon' ? (sLoad > 0 ? loadTR * (sOa / sLoad) : 0) : sOa;
      }
      return s + Math.min(Math.max(0, oaTR), loadTR);
    }, 0);
    const iduTR = Object.values(sys.iduSelections ?? {}).reduce((s: number, x: any) => s + normalizeIDUList(x).reduce((ss: number, u: any) => ss + u.trCapacity * (u.quantity ?? 1), 0), 0) as number;
    const ahuTR = ((sys.zones ?? sys.ahuGroups ?? []) as EquipmentZone[]).reduce((s: number, z: any) => s + (z.selection ? z.selection.trCapacity * (z.selection.quantity ?? 1) : 0), 0);
    const connectedIdu = iduTR + ahuTR;
    const coilDuty = rids.reduce((s, rid) => {
      const r = rooms.find((x: any) => x.id === rid) as any;
      const stored = Number(r?._calcOverallRequiredTR);
      const live = Number((getRoomReqs(rid) as any)?.overallRequiredTR);
      return s + (Number.isFinite(stored) && stored > 0 ? stored : (Number.isFinite(live) && live > 0 ? live : 0));
    }, 0);
    const connected = connectedIdu > 0 ? connectedIdu : coilDuty;
    const indoorDiverse = Math.max(0, connected - oa) * (sys.diversityFactor ?? 0.75);
    const tfa = rids.reduce((s, rid) => {
      const r = rooms.find((x: any) => x.id === rid) as any;
      const doas = r ? findDoasForRoom(r) : null;
      if (!doas || (doas as any).tfaCoolingSource !== 'chiller-plant') return s;
      const reqs: any = getRoomReqs(rid);
      return s + Math.max(Number(reqs?.tfaCoilTR) || 0, Number(reqs?.monsoonTfaCoilTR) || 0);
    }, 0);
    return indoorDiverse + oa + tfa;
  };

  const systemSummaries = useMemo(() => {
    const effUnitTR = (u: any) => (u.actualTR != null && u.actualTR > 0 ? u.actualTR : (u.trCapacity ?? 0));
    return equipSystems.map(sys => {
      const sysRooms = (rooms as any[]).filter(r => r.zoneId === sys.id || r.systemId === sys.id);
      const roomCount = sysRooms.length;

      // Chiller-fed plants must carry the TFA coil too, so use the full plant requirement
      // (matches System Design); other system types use the summed room duty.
      const requiredTR = sys.type === 'Chiller'
        ? chillerPlantRequiredForSystem(sys, sysRooms.map((r: any) => r.id))
        : sysRooms.reduce((sum: number, r: any) => sum + Number(r._calcOverallRequiredTR ?? r._calcRequiredTR ?? 0), 0);

      // Working vs standby: standby units are N+1 redundancy and DON'T count toward coverage.
      let workingTR = 0, standbyTR = 0;
      if (sys.type === 'Chiller') {
        const units: any[] = (sys as any).chillerUnits?.length
          ? (sys as any).chillerUnits
          : (sys.unitSelection ? [{ ...sys.unitSelection, quantity: sys.unitSelection.quantity ?? 1 }] : []);
        for (const u of units) {
          const tr = effUnitTR(u) * (u.quantity ?? 1);
          if (u.role === 'standby') standbyTR += tr; else workingTR += tr;
        }
      }

      let installedTR = 0;
      if (sys.type === 'VRF') {
        const odu = sys.oduSelection as any;
        if (odu?.combination?.length > 0) {
          installedTR = odu.combination.reduce((s: number, u: any) => s + u.trCapacity * (u.quantity ?? 1), 0);
        } else {
          installedTR = ((odu?.effectiveTR ?? odu?.trCapacity ?? 0) as number) * ((odu?.modules ?? 1) as number);
        }
        if (installedTR === 0) {
          installedTR = Object.values(sys.iduSelections as any).reduce((s: number, x: any) => s + normalizeIDUList(x).reduce((ss: number, u: any) => ss + u.trCapacity * (u.quantity ?? 1), 0), 0) as number;
        }
      } else if (sys.type === 'Chiller') {
        // Coverage is against WORKING capacity — standby (N+1) is redundancy, not duty.
        installedTR = workingTR;
      } else if (sys.type === 'Split') {
        const roomSel: Record<string, IDUSelection[]> = (sys as any).roomSelections ?? {};
        installedTR = Object.values(roomSel).reduce((s, units) => s + units.reduce((ss, u) => ss + u.trCapacity, 0), 0);
      } else if (sys.unitSelection) {
        installedTR = sys.unitSelection.trCapacity * (sys.unitSelection.quantity ?? 1);
      }

      let status: 'ok' | 'undersized' | 'no-equipment' | 'no-rooms';
      if (roomCount === 0) status = 'no-rooms';
      else if (installedTR === 0) status = 'no-equipment';
      else if (requiredTR > 0 && installedTR < requiredTR * 0.97) status = 'undersized';
      else status = 'ok';

      return { id: sys.id, name: sys.name, type: sys.type as SystemType, roomCount, requiredTR, installedTR, workingTR, standbyTR, status };
    });
  }, [equipSystems, rooms]);

  // ── Guard: no project ──────────────────────────────────────────────────────

  if (!project) {
    return (
      <div className="space-y-4 px-1">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Equipment Selection</h2>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap">Project:</span>
            <Select value="" onValueChange={async val => {
              const snap = await getDoc(doc(db, 'projects', val));
              if (snap.exists()) onProjectChange?.({ id: snap.id, ...snap.data() });
            }}>
              <SelectTrigger className="h-9 w-56 text-sm font-medium border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 text-blue-800 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/30 focus:ring-blue-300">
                <span className="flex-1 text-left truncate text-muted-foreground">Select project…</span>
              </SelectTrigger>
              <SelectContent>
                {allProjects.map(p => (
                  <SelectItem key={p.id} value={p.id} className="text-sm">
                    <span className="font-medium">{p.name}</span>
                    {p.location && <span className="text-slate-400 ml-1.5 text-xs">{p.location}</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center h-64 rounded-xl border-2 border-dashed border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-400 dark:text-slate-500 gap-3">
          <Box className="w-10 h-10 opacity-30" />
          <p className="text-sm font-medium">Use the Project dropdown above to open a project.</p>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 px-1">
      {/* Header + tabs row — single line, no wasted vertical space */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Equipment Selection</h2>
          {/* Project-level DOAS / TFA status chip. Optional system — chip is
              always shown so the user can confirm at a glance which mode this
              project is in. Clicking the active chip jumps to the DOAS unit. */}
          {projectDoasAggregate.hasDoas ? (
            <button
              type="button"
              onClick={() => projectDoasAggregate.firstDoasId && setSelectedSystemId(projectDoasAggregate.firstDoasId)}
              className="self-center inline-flex items-center gap-1.5 rounded-full border border-teal-300 dark:border-teal-700 bg-teal-50 dark:bg-teal-950/30 px-2.5 py-0.5 text-[11px] font-semibold text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors"
              title={`Project uses ${projectDoasAggregate.doasCount} TFA/DOAS unit${projectDoasAggregate.doasCount === 1 ? '' : 's'} serving ${projectDoasAggregate.primaryCount} primary system${projectDoasAggregate.primaryCount === 1 ? '' : 's'} and ${projectDoasAggregate.roomCount} room${projectDoasAggregate.roomCount === 1 ? '' : 's'} (${Math.round(projectDoasAggregate.totalOACFM).toLocaleString()} CFM OA). Click to open the TFA/DOAS unit.`}
            >
              <Wind className="w-3 h-3" />
              TFA/DOAS Active
              <span className="font-mono font-normal opacity-80">
                · {projectDoasAggregate.doasCount} unit{projectDoasAggregate.doasCount === 1 ? '' : 's'} · {projectDoasAggregate.primaryCount} prim · {projectDoasAggregate.roomCount} room{projectDoasAggregate.roomCount === 1 ? '' : 's'}
              </span>
            </button>
          ) : (
            <span
              className="self-center inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400"
              title="No TFA/DOAS unit configured for this project — outdoor air is conditioned by the primary system(s). Add a TFA/DOAS system if you want a separate fresh-air handler."
            >
              <Wind className="w-3 h-3 opacity-60" />
              No TFA/DOAS — OA on primary
            </span>
          )}
        </div>
        {/* Project Switcher */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap">Project:</span>
          <Select
            value={project?.id ?? ''}
            onValueChange={async val => {
              const snap = await getDoc(doc(db, 'projects', val));
              if (snap.exists()) onProjectChange?.({ id: snap.id, ...snap.data() });
            }}
          >
            <SelectTrigger className="h-9 w-56 text-sm font-medium border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 text-blue-800 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/30 focus:ring-blue-300">
              <span className="flex-1 text-left truncate">
                {allProjects.find(p => p.id === project?.id)?.name ?? project?.name ?? 'Select project…'}
              </span>
            </SelectTrigger>
            <SelectContent>
              {allProjects.length === 0 && (
                <SelectItem value="" disabled>No projects found</SelectItem>
              )}
              {allProjects.map(p => (
                <SelectItem key={p.id} value={p.id} className="text-sm">
                  <span className="font-medium">{p.name}</span>
                  {p.location && <span className="text-slate-400 ml-1.5 text-xs">{p.location}</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Navigation cards — click to open section below ── */}
      <div className="grid grid-cols-4 gap-3">
        {([
          { value: 'systems', icon: Wind,       label: 'System Design',     desc: 'Zones, units & selection' },
          { value: 'summary', icon: LayoutGrid, label: 'Summary',           desc: 'Load overview by system'  },
          { value: 'library', icon: BookOpen,   label: 'Equipment Library', desc: 'Catalog & specifications' },
          { value: 'drawings',icon: FileText,   label: 'Drawings & Docs',   desc: 'Schematics & documents'  },
        ] as { value: string; icon: React.ElementType; label: string; desc: string }[]).map(({ value, icon: Icon, label, desc }) => (
          <button
            key={value}
            type="button"
            onClick={() => setActiveTab(value)}
            className={cn(
              'flex flex-col items-start gap-1.5 p-4 rounded-xl border-2 text-left transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
              activeTab === value
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20 shadow-md'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-slate-50 dark:hover:bg-slate-700 hover:shadow-sm',
            )}
          >
            <Icon className={cn('w-5 h-5', activeTab === value ? 'text-blue-600' : 'text-slate-400 dark:text-slate-500')} />
            <span className={cn('text-sm font-bold leading-tight', activeTab === value ? 'text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300')}>{label}</span>
            <span className="text-xs text-slate-400 dark:text-slate-500 leading-snug">{desc}</span>
          </button>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">

        {/* ── System Design Tab ── */}
        <TabsContent value="systems">

          {/* Zone ↔ System Sync dialog */}
          {syncDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center gap-2 sticky top-0 bg-white dark:bg-slate-900 pb-2 -mt-2 pt-2 border-b border-slate-100 dark:border-slate-800 z-10">
                  <ArrowLeftRight className="w-5 h-5 text-blue-600" />
                  <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Bulk Re-map / Recovery</h3>
                  <button
                    type="button"
                    className="ml-auto text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-lg leading-none"
                    onClick={() => setSyncDialog(false)}
                    title="Close"
                  >
                    ×
                  </button>
                </div>
                <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  <strong>Day-to-day sync is automatic now</strong> — adding/moving rooms or zones in LC writes back to ES live, and vice-versa. Use this dialog only to bulk-remap a legacy project (by zone-name pattern) or to repair a desync.
                </div>

                {/* Pull direction */}
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <ArrowLeft className="w-4 h-4 text-emerald-700" />
                    <span className="text-sm font-bold text-emerald-800 dark:text-emerald-300">Pull: Map LC Zones → Systems</span>
                  </div>
                  <p className="text-sm text-emerald-700 dark:text-emerald-300">
                    For each zone in Load Calculator, choose which system its rooms belong to. Rooms with the same zone will be assigned to that system.
                  </p>
                  <div className="bg-white dark:bg-slate-800 rounded border border-emerald-200 dark:border-emerald-800 divide-y divide-emerald-100 dark:divide-emerald-900">
                    {(() => {
                      const zoneGroups = rooms.reduce((m: Record<string, number>, r: any) => {
                        const k = (r.zoneName || 'Zone').trim(); m[k] = (m[k] || 0) + 1; return m;
                      }, {});
                      const entries = Object.entries(zoneGroups);
                      if (entries.length === 0) return (
                        <p className="text-xs text-slate-400 px-2 py-2 text-center">No rooms loaded</p>
                      );
                      return entries.map(([z, n]) => (
                        <div key={z} className="flex items-center gap-2 px-2 py-1.5">
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">{z}</span>
                            <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">({n as number} room{(n as number) === 1 ? '' : 's'})</span>
                          </div>
                          <select
                            className="text-xs border border-emerald-200 dark:border-emerald-800 rounded px-1 py-0.5 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 max-w-[130px]"
                            value={zoneMapping[z] ?? ''}
                            onChange={e => setZoneMapping(prev => ({ ...prev, [z]: e.target.value }))}
                          >
                            <option value="">— skip —</option>
                            {equipSystems.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </div>
                      ));
                    })()}
                  </div>
                  <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800 gap-1 text-xs w-full mt-1"
                    disabled={syncBusy || Object.values(zoneMapping).every(v => !v)}
                    onClick={pullZonesToSystems}>
                    <ArrowLeft className="w-3 h-3" /> {syncBusy ? 'Syncing…' : 'Pull: Assign Rooms to Systems'}
                  </Button>
                </div>

                {/* Push direction */}
                {(() => {
                  const totalAssigned = equipSystems.reduce((n, s) => n + s.assignedRoomIds.length, 0);
                  return (
                    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <ArrowRight className="w-4 h-4 text-blue-700" />
                        <span className="text-sm font-bold text-blue-800 dark:text-blue-300">Push: Systems → LC Zones</span>
                      </div>
                      <p className="text-sm text-blue-700 dark:text-blue-300">
                        Updates each room's zone in Load Calculator to match its assigned system here. Assign rooms to systems first (select a system → Assign Rooms tab).
                      </p>
                      <div className="bg-white dark:bg-slate-800 rounded border border-blue-200 dark:border-blue-800 divide-y divide-blue-100 dark:divide-blue-900">
                        {equipSystems.map(s => {
                          const liveCount = s.assignedRoomIds.filter(id => rooms.some((r: any) => r.id === id)).length;
                          return (
                            <div key={s.id} className="flex items-center gap-2 px-2 py-1.5">
                              <Badge variant="outline" className="text-xs px-1 py-0 shrink-0">{s.type}</Badge>
                              <span className="text-xs font-medium text-slate-700 dark:text-slate-300 flex-1 truncate">{s.name}</span>
                              {liveCount > 0
                                ? <span className="text-xs text-blue-600 dark:text-blue-400">{liveCount} room{liveCount !== 1 ? 's' : ''} →</span>
                                : <span className="text-xs text-amber-500 dark:text-amber-400 italic">no rooms assigned</span>}
                            </div>
                          );
                        })}
                      </div>
                      {totalAssigned === 0 && (
                        <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded px-2 py-1.5">
                          No rooms are assigned to any system. Select a system and use the Assign Rooms section to add rooms, then Push.
                        </p>
                      )}
                      <Button size="sm" className="bg-blue-700 hover:bg-blue-800 gap-1 text-xs w-full mt-1"
                        disabled={syncBusy || totalAssigned === 0}
                        onClick={pushSystemsToZones}>
                        <ArrowRight className="w-3 h-3" /> {syncBusy ? 'Syncing…' : 'Push: Update LC Zones from Systems'}
                      </Button>
                    </div>
                  );
                })()}

                {/* Cleanup orphan data */}
                <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/20 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Trash2 className="w-4 h-4 text-rose-700 dark:text-rose-400" />
                    <span className="text-sm font-bold text-rose-800 dark:text-rose-300">Clean Up Orphan Data</span>
                  </div>
                  <p className="text-sm text-rose-700 dark:text-rose-300 leading-relaxed">
                    Removes stale data that causes phantom zones / duplicate rows in LC:
                  </p>
                  <ul className="text-xs text-rose-700 dark:text-rose-300 list-disc pl-5 space-y-0.5">
                    <li><strong>Duplicate <code className="text-xs">/equipmentSystems</code> docs</strong> that no room references (hidden by name-dedup but still present)</li>
                    <li><code className="text-xs">system.zones[].roomIds[]</code> entries pointing to deleted rooms</li>
                    <li><code className="text-xs">system.zones[].roomIds[]</code> entries claimed by other systems</li>
                    <li>ES sub-zones whose <code className="text-xs">roomIds</code> is empty after cleanup</li>
                    <li><code className="text-xs">/zones/{`{id}`}</code> docs with no rooms or ES sub-zone using them</li>
                    <li>Legacy <code className="text-xs">/systems/.../zones</code> docs with no rooms</li>
                  </ul>
                  <p className="text-xs text-rose-600 dark:text-rose-400 italic">
                    Idempotent. Safe to run repeatedly. <strong>Never deletes rooms, room geometry, envelope elements, or load calc results.</strong>
                  </p>
                  <Button size="sm" className="bg-rose-700 hover:bg-rose-800 gap-1 text-xs w-full mt-1"
                    disabled={syncBusy}
                    onClick={() => void cleanOrphanZones()}>
                    <Trash2 className="w-3 h-3" /> {syncBusy ? 'Cleaning…' : 'Clean Orphan Data'}
                  </Button>
                </div>

                <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setSyncDialog(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {/* HVAC System Category — project-level selector */}
          <div className="mb-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Box className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
              <div>
                <span className="text-sm font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Project HVAC System Type</span>
                {!hvacSystemCategory && (
                  <span className="ml-2 text-xs text-amber-600 dark:text-amber-400 italic">Not set — select to get guided setup</span>
                )}
                {hvacSystemCategory && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-sm font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700">
                    {hvacSystemCategory}
                  </span>
                )}
              </div>
            </div>
            <Select value={hvacSystemCategory || 'none'} onValueChange={v => saveHvacSystemCategory(v === 'none' ? '' : v)}>
              <SelectTrigger className="h-8 w-60 text-xs shrink-0">
                <SelectValue placeholder="Set system type…" />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="none" className="text-slate-400 text-xs italic">Not specified</SelectItem>
                <SelectSeparator />

                {/* ── DX Refrigerant Systems ── */}
                <SelectGroup>
                  <SelectLabel className="text-sm font-bold uppercase tracking-wider text-slate-500 px-1.5 pt-1.5 pb-0.5">DX Refrigerant Systems</SelectLabel>
                  <SelectItemWithDesc value="VRF"
                    label="VRF — Variable Refrigerant Flow"
                    desc="Multi-split refrigerant; one ODU → many IDUs (hi-wall, cassette, ductable). Best for distributed zones." />
                  <SelectItemWithDesc value="Package"
                    label="Package Units"
                    desc="Self-contained DX unit (rooftop/floor-standing). Compressor + coil + blower in one casing. Multiple units can serve one zone." />
                  <SelectItemWithDesc value="DuctableSplit"
                    label="Ductable Split"
                    desc="DX split with ducted indoor cassette. Non-modular; outdoor compressor + indoor blower. Suited for small–medium zones with concealed ducts." />
                  <SelectItemWithDesc value="Split"
                    label="Split Units (room-by-room)"
                    desc="Dedicated wall-mounted split per room. Simplest option; fully independent room control and service." />
                </SelectGroup>
                <SelectSeparator />

                {/* ── Chilled Water ── */}
                <SelectGroup>
                  <SelectLabel className="text-sm font-bold uppercase tracking-wider text-blue-600 px-1.5 pt-1.5 pb-0.5">Chilled Water (Hydronic)</SelectLabel>
                  <SelectItemWithDesc value="Chiller WC"
                    label="Chiller WC — Water-Cooled"
                    desc="Water-cooled chiller + cooling tower. Serves all hydronic indoor types: AHU, TFA, FCU, cassette, hi-wall fan coils. Highest system COP." />
                  <SelectItemWithDesc value="Chiller AC"
                    label="Chiller AC — Air-Cooled"
                    desc="Air-cooled chiller — no cooling tower. Same indoor flexibility as WC (AHU, TFA, FCU, cassette, hi-wall). Simpler plant room; slightly lower COP." />
                </SelectGroup>
                <SelectSeparator />

                {/* ── Hybrid / Mixed ── */}
                <SelectGroup>
                  <SelectLabel className="text-sm font-bold uppercase tracking-wider text-slate-500 px-1.5 pt-1.5 pb-0.5">Mixed</SelectLabel>
                  <SelectItemWithDesc value="Hybrid"
                    label="Hybrid / Mixed Systems"
                    desc="Multiple system types in one project — e.g. VRF for offices, Chiller+AHU for halls, Split for server rooms. Maximum flexibility." />
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* Guided Setup Checklist */}
          {hvacSystemCategory && SYSTEM_GUIDES[hvacSystemCategory] && (
            <div className="mb-4 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 px-4 py-3">
              <p className="text-sm font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider mb-1">
                Setup Guide — {hvacSystemCategory}
              </p>
              {SYSTEM_GUIDES[hvacSystemCategory].note && (
                <p className="text-sm text-blue-600 dark:text-blue-400 mb-2 leading-snug">{SYSTEM_GUIDES[hvacSystemCategory].note}</p>
              )}
              <ol className="space-y-1">
                {SYSTEM_GUIDES[hvacSystemCategory].steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-blue-800 dark:text-blue-300">
                    <span className="text-blue-400 dark:text-blue-500 font-bold shrink-0 mt-0.5">{i + 1}.</span>
                    {step}
                  </li>
                ))}
              </ol>
              {hvacSystemCategory !== 'Split' && hvacSystemCategory !== 'Hybrid' && (
                <div className="mt-2 pt-2 border-t border-blue-200 dark:border-blue-800 flex items-start gap-1.5 text-sm text-blue-600 dark:text-blue-400">
                  <Info className="w-3 h-3 shrink-0 mt-0.5" />
                  <span><strong>Special rooms</strong> (server room, UPS room, generator area) should be placed in their own zone and assigned to a separate <strong>Split</strong> system — never on VRF or chilled water.</span>
                </div>
              )}
            </div>
          )}

          {/* Toolbar for single-system project types (Chiller, Package, AHU, etc.)
              where the sidebar that hosts these buttons is hidden. Add System is
              required here so secondary systems (notably DOAS) can be created on
              top of the auto-created primary. When more than one system exists,
              a chip row appears so the user can switch between them. */}
          {!showSidebar && (
            <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
              {equipSystems.length > 1 ? (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {equipSystems.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedSystemId(s.id)}
                      className={cn(
                        'inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium transition-colors',
                        s.id === selectedSystemId
                          ? s.type === 'DOAS'
                            ? 'bg-teal-100 dark:bg-teal-900/40 border-teal-400 dark:border-teal-600 text-teal-800 dark:text-teal-200'
                            : 'bg-blue-100 dark:bg-blue-900/40 border-blue-400 dark:border-blue-600 text-blue-800 dark:text-blue-200'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-400 hover:text-slate-700',
                      )}>
                      {s.name}
                      <span className="text-xs opacity-60">{s.type}</span>
                    </button>
                  ))}
                </div>
              ) : <div />}
              <div className="flex gap-2">
                <Button size="sm" className="h-8 text-xs gap-1.5"
                  onClick={() => {
                    // Default the new system to DOAS on Chiller / AHU / Package layouts —
                    // those are the project types most likely to add a second system.
                    setNewType('DOAS');
                    setShowNewSystem(true);
                  }}>
                  <Plus className="w-3.5 h-3.5" /> Add System
                </Button>
                {equipSystems.length > 0 && (
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                    onClick={() => {
                      const initMap: Record<string, string> = {};
                      const zNames = [...new Set(rooms.map((r: any) => (r.zoneName || 'Zone').trim()))];
                      for (const z of zNames) {
                        const match = equipSystems.find(s =>
                          s.name.toLowerCase() === z.toLowerCase() ||
                          s.name.toLowerCase().includes(z.toLowerCase()) ||
                          z.toLowerCase().includes(s.name.toLowerCase()),
                        );
                        if (match) initMap[z] = match.id;
                      }
                      setZoneMapping(initMap);
                      setSyncDialog(true);
                    }}>
                    <ArrowLeftRight className="w-3.5 h-3.5" /> Bulk Re-map / Recovery
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className={cn('border dark:border-slate-700 rounded-xl overflow-hidden min-h-[700px] bg-white dark:bg-slate-900 shadow-sm', showSidebar && 'flex')}>

            {/* Left sidebar — shown only for VRF and Hybrid */}
            {showSidebar && <div className="w-72 border-r dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 flex flex-col shrink-0">
              <div className="p-4 border-b dark:border-slate-700 bg-white dark:bg-slate-800">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-base font-bold uppercase text-slate-600 dark:text-slate-400 tracking-wide">Systems</span>
                  {unassignedRooms.length > 0 && (
                    <Badge className="text-sm bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-700 gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />{unassignedRooms.length} unassigned
                    </Badge>
                  )}
                </div>
                <Button size="sm" className="w-full h-9 text-sm gap-1.5" onClick={() => {
                  if (hvacSystemCategory && SYSTEM_GUIDES[hvacSystemCategory]) {
                    setNewType(SYSTEM_GUIDES[hvacSystemCategory].defaultType);
                  }
                  setShowNewSystem(true);
                }}>
                  <Plus className="w-3.5 h-3.5" /> Add System
                </Button>
                {equipSystems.length > 0 && (
                  <Button size="sm" variant="outline" className="w-full h-9 text-sm gap-1.5 mt-1.5"
                    onClick={() => {
                      // Pre-populate zoneMapping with auto-matches when dialog opens
                      const initMap: Record<string, string> = {};
                      const zNames = [...new Set(rooms.map((r: any) => (r.zoneName || 'Zone').trim()))];
                      for (const z of zNames) {
                        const match = equipSystems.find(s =>
                          s.name.toLowerCase() === z.toLowerCase() ||
                          s.name.toLowerCase().includes(z.toLowerCase()) ||
                          z.toLowerCase().includes(s.name.toLowerCase()),
                        );
                        if (match) initMap[z] = match.id;
                      }
                      setZoneMapping(initMap);
                      setSyncDialog(true);
                    }}>
                    <ArrowLeftRight className="w-3.5 h-3.5" /> Bulk Re-map / Recovery
                  </Button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {equipSystems.length === 0 && (
                  <p className="text-sm text-slate-400 text-center mt-8 px-3">No systems yet. Click "Add System" to begin.</p>
                )}
                {equipSystems.map(sys => {
                  const { label, color } = systemStatusInfo(sys, rooms);
                  const isSelected = sys.id === selectedSystemId;
                  const isEditing = editingSystemId === sys.id;

                  if (isEditing) {
                    return (
                      <div key={sys.id} className="rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/20 p-2 space-y-1.5">
                        <Input
                          autoFocus
                          className="h-8 text-sm"
                          value={editingSystemName}
                          onChange={e => setEditingSystemName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') renameSystem(sys.id); if (e.key === 'Escape') setEditingSystemId(null); }}
                        />
                        <Select value={editingSystemType} onValueChange={v => setEditingSystemType(v as SystemType)}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(['VRF','AHU','Chiller','Package','DuctableSplit','Split'] as SystemType[]).map(t => (
                              <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex gap-1">
                          <Button size="sm" className="h-8 text-sm px-2 flex-1" onClick={() => renameSystem(sys.id)}>Save</Button>
                          <Button size="sm" variant="ghost" className="h-8 text-sm px-2" onClick={() => setEditingSystemId(null)}>Cancel</Button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={sys.id} className={cn(
                      'rounded-lg transition-colors group',
                      isSelected ? 'bg-blue-600 text-white shadow-sm' : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300',
                    )}>
                      <div className="flex items-center gap-1">
                        <button
                          className="flex-1 text-left px-3 py-3 min-w-0"
                          onClick={() => setSelectedSystemId(sys.id)}>
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-base font-semibold truncate">{sys.name}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className={cn('text-sm px-1.5 py-0 font-normal', isSelected ? 'border-white/30 text-white/80' : 'border-slate-200 dark:border-slate-600')}>
                              {sys.type}
                            </Badge>
                            <span className={cn('text-sm', isSelected ? 'text-white/70' : color)}>{label}</span>
                          </div>
                        </button>
                        <div className={cn('flex shrink-0 pr-1.5 gap-1 opacity-0 group-hover:opacity-100 transition-opacity', isSelected && 'opacity-100')}>
                          <button
                            title="Rename / change type"
                            className={cn('w-7 h-8 rounded flex items-center justify-center hover:bg-white/20', isSelected ? 'text-white/70 hover:text-white' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/20')}
                            onClick={e => { e.stopPropagation(); setEditingSystemId(sys.id); setEditingSystemName(sys.name); setEditingSystemType(sys.type); }}>
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            title="Delete system"
                            className={cn('w-7 h-8 rounded flex items-center justify-center', isSelected ? 'text-white/70 hover:text-white hover:bg-white/20' : 'text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30')}
                            onClick={e => { e.stopPropagation(); deleteSystem(sys.id); }}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {rooms.length > 0 && (
                <div className="p-4 border-t dark:border-slate-700 bg-white/60 dark:bg-slate-800/60">
                  <p className="text-sm text-slate-400 dark:text-slate-500">{rooms.length} rooms total · {allAssignedIds.size} assigned</p>
                </div>
              )}
            </div>}

            {/* Right content */}
            <div className={showSidebar ? 'flex-1 overflow-y-auto min-w-0' : 'w-full overflow-y-auto'}>
              {!selectedSystem ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                  <Wind className="w-12 h-12 opacity-20" />
                  <p className="text-sm font-medium">Select a system or create a new one</p>
                  <p className="text-xs">Each system groups rooms and selects equipment for them.</p>
                </div>
              ) : (
                <div className="p-6 space-y-6">

                  {/* System header */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">{selectedSystem.name}</h3>
                        <Badge className={cn('text-xs',
                          selectedSystem.type === 'VRF'     ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700' :
                          selectedSystem.type === 'AHU'     ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-700' :
                          selectedSystem.type === 'Chiller' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700' :
                          selectedSystem.type === 'Split'   ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700' :
                          selectedSystem.type === 'DOAS'    ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-700' :
                          'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700')}>
                          {hvacSystemCategory || selectedSystem.type}
                          {selectedSystem.condenserType ? ` · ${selectedSystem.condenserType}` :
                           selectedSystem.packageSubType  ? ` (${selectedSystem.packageSubType})` : ''}
                        </Badge>
                        {selectedSystem.brandLocked && selectedSystem.brand && (
                          <Badge variant="outline" className="gap-1 text-xs text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20">
                            <Lock className="w-2.5 h-2.5" />{selectedSystem.brand} locked
                          </Badge>
                        )}
                      </div>
                      {selectedSystem.type === 'VRF' && (
                        <div className="flex items-center gap-3 mt-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-slate-500 dark:text-slate-400">Diversity factor:</span>
                            <input
                              key={`div-${selectedSystem.id}-${selectedSystem.diversityFactor ?? 0.75}`}
                              type="text" inputMode="decimal"
                              className="h-7 w-16 text-xs text-center p-1 rounded-md border border-input bg-transparent outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-input/30"
                              defaultValue={String(selectedSystem.diversityFactor ?? 0.75)}
                              onBlur={e => {
                                const n = parseFloat(e.target.value);
                                if (!Number.isFinite(n) || n <= 0 || n > 1) {
                                  e.target.value = String(selectedSystem.diversityFactor ?? 0.75);
                                  return;
                                }
                                void updateSystemField(selectedSystem.id, { diversityFactor: n });
                              }}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            />
                          </div>
                          {selectedSystem.brandLocked && (
                            <Button size="sm" variant="ghost" className="h-8 text-sm gap-1 text-slate-500 hover:text-red-600"
                              onClick={() => unlockBrand(selectedSystem)}>
                              <Unlock className="w-3 h-3" /> Change brand (clears IDUs)
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="ghost" className="h-8 text-sm gap-1 text-slate-400 hover:text-blue-600 shrink-0"
                        title="Rename / change type"
                        onClick={() => { setEditingSystemId(selectedSystem.id); setEditingSystemName(selectedSystem.name); setEditingSystemType(selectedSystem.type); }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* ── DOAS Section ──────────────────────────────────────── */}
                  {selectedSystem.type === 'DOAS' && (
                    <div className="rounded-xl border border-teal-200 dark:border-teal-800 overflow-hidden shadow-sm">
                      <div className="bg-teal-50 dark:bg-teal-950/30 px-5 py-3 border-b border-teal-200 dark:border-teal-800 flex items-center gap-2">
                        <Wind className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                        <span className="text-sm font-bold uppercase text-teal-700 dark:text-teal-300 tracking-wide">TFA/DOAS Configuration</span>
                        <span className="text-xs text-teal-500 dark:text-teal-500 ml-1">Dedicated Outdoor Air System</span>
                      </div>
                      <div className="p-5 space-y-5">
                        {/* Phase D — TFA-only rooms whose sensible load exceeds the supply-air
                            carrying capacity at the designed CFM + supply temp. Warning only. */}
                        {doasUndersizedRooms.length > 0 && (
                          <div className="rounded-lg border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/30 px-4 py-3">
                            <p className="text-sm font-semibold text-rose-800 dark:text-rose-300">
                              TFA undersized — {doasUndersizedRooms.length} TFA-only room{doasUndersizedRooms.length === 1 ? '' : 's'} exceed{doasUndersizedRooms.length === 1 ? 's' : ''} carrying capacity
                            </p>
                            <p className="text-xs text-rose-700 dark:text-rose-400 mt-0.5">
                              {doasUndersizedRooms.map(r => `${r.name} (+${Math.round(r.deficit).toLocaleString()} BTU/h)`).join(', ')}.
                              The TFA supply can&rsquo;t absorb the room sensible at the designed CFM and supply temp. Increase OA CFM (raise <code>facph</code>), lower the TFA supply temp, or add a small DX assist. The engine sizes the calc as-is — it does not auto-correct.
                            </p>
                          </div>
                        )}
                        {/* OA CFM + TFA coil summary. Reheat card only shows when the
                            supply setpoint actually demands meaningful reheat (>500 BTU/h)
                            — i.e. a neutral/warm-dry supply. Cold-TFA leaves the coil near
                            its dew point, so reheat ≈ 0 and the card stays hidden. */}
                        {(() => {
                          const showReheat = doasTFAAggregate.reheatBTUH > 0;
                          const cols = 3 + (doasTfaWinterHeatingBTUH > 0 ? 1 : 0) + (showReheat ? 1 : 0);
                          const colClass = cols >= 5 ? 'sm:grid-cols-5' : cols === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3';
                          return (
                        <div className={cn('grid grid-cols-1 gap-3', colClass)}>
                          <div className="rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50/60 dark:bg-teal-950/20 px-4 py-3">
                            <p className="text-xs font-bold uppercase tracking-wide text-teal-600 dark:text-teal-400">OA Flow Required</p>
                            <p className="mt-1 font-mono text-xl font-bold text-teal-900 dark:text-teal-200">{Math.round(doasOACFM).toLocaleString()}</p>
                            <p className="text-xs text-teal-500 dark:text-teal-400">CFM fresh air</p>
                          </div>
                          <div className="rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50/60 dark:bg-teal-950/20 px-4 py-3">
                            <p className="text-xs font-bold uppercase tracking-wide text-teal-600 dark:text-teal-400">TFA Coil Load</p>
                            <p className="mt-1 font-mono text-xl font-bold text-teal-900 dark:text-teal-200">{doasTFAAggregate.governingCoilTR.toFixed(1)}</p>
                            <p className="text-xs text-teal-500 dark:text-teal-400">TR · {doasTFAAggregate.governs} governs (cooling)</p>
                          </div>
                          {showReheat && (
                            <div
                              className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3"
                              title={`Cool-to-ADP then reheat. The coil over-cools OA to its apparatus dew point (${doasTFAAggregate.coilADP.toFixed(0)}°F, saturated) to dry it to the supply humidity ratio, then a reheat coil sensibly warms it back up to ${Math.round((selectedSystem as any)?.tfaSupplyTemp ?? 55)}°F supply. Reheat = 1.08 × ${Math.round(doasOACFM).toLocaleString()} CFM × (supply − ADP).`}
                            >
                              <p className="text-xs font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">TFA Reheat Coil</p>
                              <p className="mt-1 font-mono text-xl font-bold text-amber-900 dark:text-amber-200">{Math.round(doasTFAAggregate.reheatBTUH).toLocaleString()}</p>
                              <p className="text-xs text-amber-500 dark:text-amber-400">BTU/h · ADP {doasTFAAggregate.coilADP.toFixed(0)}°F → supply</p>
                            </div>
                          )}
                          {doasTfaWinterHeatingBTUH > 0 && (
                            <div className="rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-950/20 px-4 py-3">
                              <p className="text-xs font-bold uppercase tracking-wide text-sky-600 dark:text-sky-400">TFA Heating Coil</p>
                              <p className="mt-1 font-mono text-xl font-bold text-sky-900 dark:text-sky-200">{Math.round(doasTfaWinterHeatingBTUH).toLocaleString()}</p>
                              <p className="text-xs text-sky-500 dark:text-sky-400">BTU/h · winter OA temper</p>
                            </div>
                          )}
                          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3">
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Rooms Served</p>
                            <p className="mt-1 font-mono text-xl font-bold text-slate-800 dark:text-slate-200">{doasServedRoomIds.length}</p>
                            <p className="text-xs text-slate-400">TFA-served rooms</p>
                          </div>
                        </div>
                          );
                        })()}

                        {/* Advanced TFA settings — collapsed by default. Fresh air is set
                            per-room in the Load Calculator; these are tuning / legacy controls. */}
                        <button
                          type="button"
                          onClick={() => setShowDoasAdvanced(v => !v)}
                          className="text-xs font-semibold text-teal-700 dark:text-teal-300 hover:underline self-start"
                        >
                          {showDoasAdvanced ? '▾ Hide advanced TFA settings' : '▸ Advanced TFA settings — supply temp, ERV, cooling source, zone links'}
                        </button>
                        {showDoasAdvanced && (<>
                        {/* TFA coil cooling source — decides whether the TFA coil load is
                            added to the linked chiller plant's required capacity. */}
                        {(() => {
                          const source = ((selectedSystem as any).tfaCoolingSource as string | undefined) ?? 'own-unit';
                          const onPlant = source === 'chiller-plant';
                          return (
                            <div className="rounded-lg border border-teal-200 dark:border-teal-800 bg-white dark:bg-slate-900 p-4">
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">TFA Coil Cooling Source</p>
                                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                    {onPlant
                                      ? 'Chilled-water Fresh-Air coil on the main plant — this TFA coil load is ADDED to the linked chiller plant capacity.'
                                      : 'Self-contained DX / packaged unit — TFA coil load is sized on the DOAS unit only, not on the chiller plant.'}
                                  </p>
                                </div>
                                <div className="inline-flex rounded-md border border-teal-300 dark:border-teal-700 overflow-hidden shrink-0">
                                  <button
                                    type="button"
                                    className={cn('text-xs px-3 py-1.5 font-medium', !onPlant ? 'bg-teal-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300')}
                                    onClick={() => void updateSystemField(selectedSystem.id, { tfaCoolingSource: 'own-unit' })}>
                                    Own unit (DX/packaged)
                                  </button>
                                  <button
                                    type="button"
                                    className={cn('text-xs px-3 py-1.5 font-medium border-l border-teal-300 dark:border-teal-700', onPlant ? 'bg-teal-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300')}
                                    onClick={() => void updateSystemField(selectedSystem.id, { tfaCoolingSource: 'chiller-plant' })}>
                                    Fed by main chiller plant
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* TFA Supply & Heat Recovery — editable */}
                        <div className="rounded-lg border border-teal-200 dark:border-teal-800 bg-white dark:bg-slate-900 p-4">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
                            <div>
                              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">TFA Supply & Heat Recovery</p>
                              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Lower supply temp = more sensible offload to primary. Higher ERV effectiveness = less TFA/DOAS coil load. Defaults: 55°F / 90% RH / 0% ERV.</p>
                            </div>
                            <div className="flex gap-1.5 shrink-0">
                              <button
                                type="button"
                                className="text-xs px-2.5 py-1 rounded-md bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-700 text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/40 font-medium"
                                title="Cold-TFA: 55°F / 90% RH — TFA/DOAS handles all latent + OA sensible; primary becomes sensible-only"
                                onClick={() => void updateSystemField(selectedSystem.id, { tfaSupplyTemp: 55, tfaSupplyHumidity: 90 })}>
                                Cold-TFA
                              </button>
                              <button
                                type="button"
                                className="text-xs px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 font-medium"
                                title="Neutral-TFA: 75°F / 60% RH — TFA/DOAS conditions OA to near room conditions; primary still handles indoor latent"
                                onClick={() => void updateSystemField(selectedSystem.id, { tfaSupplyTemp: 75, tfaSupplyHumidity: 60 })}>
                                Neutral-TFA
                              </button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <label className="block">
                              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                                Supply Temp (°F)
                                <span className="inline-flex cursor-help" title={
                                    "Temperature at which the TFA/DOAS unit delivers conditioned air to the rooms.\n\n" +
                                    "Typical values:\n" +
                                    "• 55 °F  Cold-TFA — handles all latent + OA sensible; primary becomes sensible-only\n" +
                                    "• 65–70 °F  Mid — partial latent handled by primary\n" +
                                    "• 75 °F  Neutral-TFA — OA near room conditions; primary handles indoor latent\n\n" +
                                    "Lower temp = more offload from primary, but supply duct may need re-heat if too cold for direct delivery.\n" +
                                    "Range: 45–85 °F."
                                  }>
                                  <Info className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                                </span>
                              </span>
                              <input
                                type="number"
                                min={45}
                                max={85}
                                step={1}
                                key={`tfaTemp-${selectedSystem.id}-${(selectedSystem as any).tfaSupplyTemp ?? 55}`}
                                defaultValue={(selectedSystem as any).tfaSupplyTemp ?? 55}
                                onBlur={e => {
                                  const v = parseFloat(e.target.value);
                                  if (Number.isFinite(v) && v >= 45 && v <= 85) {
                                    void updateSystemField(selectedSystem.id, { tfaSupplyTemp: v });
                                  } else {
                                    e.target.value = String((selectedSystem as any).tfaSupplyTemp ?? 55);
                                  }
                                }}
                                className="mt-1 w-full text-sm border border-slate-200 dark:border-slate-600 rounded-md px-2 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-teal-400"
                              />
                            </label>
                            {/* Winter fresh-air heating coil. This duty belongs to the DOAS, NOT to the
                                recirc AHU — the DOAS is what conditions the outdoor air, and the AHU only
                                ever sees space transmission + infiltration. Section 3B of the load report
                                schedules them as separate rows and verifies this figure against the
                                calculated OA temper duty. */}
                            <label className="block">
                              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                                Heating Coil (kW)
                                <span className="inline-flex cursor-help" title={
                                    "Winter fresh-air heating coil on THIS DOAS unit — tempers outdoor air up to the winter supply setpoint.\n\n" +
                                    "Belongs here, not on the recirculating AHU: the AHU carries only space transmission and infiltration.\n\n" +
                                    "Leave blank until selected — the Heating Equipment Schedule reports NOT SELECTED rather than assuming a capacity."
                                  }>
                                  <Info className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                                </span>
                              </span>
                              <input
                                type="number"
                                min={0}
                                step={0.1}
                                key={`tfaHeatKW-${selectedSystem.id}-${(selectedSystem as any).heatingCapacityKW ?? ''}`}
                                defaultValue={(selectedSystem as any).heatingCapacityKW ?? ''}
                                placeholder="not selected"
                                onBlur={e => {
                                  const raw = e.target.value.trim();
                                  const v = parseFloat(raw);
                                  if (raw === '') {
                                    void updateSystemField(selectedSystem.id, { heatingCapacityKW: deleteField() });
                                  } else if (Number.isFinite(v) && v >= 0) {
                                    void updateSystemField(selectedSystem.id, { heatingCapacityKW: v });
                                  } else {
                                    e.target.value = String((selectedSystem as any).heatingCapacityKW ?? '');
                                  }
                                }}
                                className="mt-1 w-full text-sm border border-slate-200 dark:border-slate-600 rounded-md px-2 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-teal-400"
                              />
                              {doasTfaWinterHeatingBTUH > 0 && (() => {
                                const reqKW = Math.ceil((doasTfaWinterHeatingBTUH / 3412) * 10) / 10;
                                const sel = Number((selectedSystem as any).heatingCapacityKW) || 0;
                                return (
                                  <span className="mt-1 flex items-center gap-2 flex-wrap">
                                    <button type="button"
                                      onClick={() => void updateSystemField(selectedSystem.id, { heatingCapacityKW: reqKW })}
                                      title={`Fresh-air temper duty ${Math.round(doasTfaWinterHeatingBTUH).toLocaleString()} BTU/h ÷ 3412`}
                                      className="text-xs px-2 py-0.5 rounded border border-teal-300 dark:border-teal-700 text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors">
                                      use required {reqKW} kW
                                    </button>
                                    {sel === 0 && <span className="text-xs text-red-500 dark:text-red-400 italic">not selected</span>}
                                    {sel > 0 && sel < reqKW && <span className="text-xs text-red-500 dark:text-red-400 italic">undersized</span>}
                                  </span>
                                );
                              })()}
                            </label>
                            <label className="block">
                              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                                Supply RH (%)
                                <span className="inline-flex cursor-help" title={
                                    "Relative humidity of the TFA/DOAS supply air at the supply temperature.\n\n" +
                                    "Typical values:\n" +
                                    "• 90 % RH at 55 °F — saturated cold-DOAS; maximum dehumidification\n" +
                                    "• 50–60 % RH at 75 °F — neutral-TFA delivering near room conditions\n\n" +
                                    "Lower RH at any supply temp = more latent removed at the TFA coil = smaller residual latent on primary.\n" +
                                    "Range: 30–95 %."
                                  }>
                                  <Info className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                                </span>
                              </span>
                              <input
                                type="number"
                                min={30}
                                max={95}
                                step={1}
                                key={`tfaRH-${selectedSystem.id}-${(selectedSystem as any).tfaSupplyHumidity ?? 90}`}
                                defaultValue={(selectedSystem as any).tfaSupplyHumidity ?? 90}
                                onBlur={e => {
                                  const v = parseFloat(e.target.value);
                                  if (Number.isFinite(v) && v >= 30 && v <= 95) {
                                    void updateSystemField(selectedSystem.id, { tfaSupplyHumidity: v });
                                  } else {
                                    e.target.value = String((selectedSystem as any).tfaSupplyHumidity ?? 90);
                                  }
                                }}
                                className="mt-1 w-full text-sm border border-slate-200 dark:border-slate-600 rounded-md px-2 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-teal-400"
                              />
                            </label>
                            <label className="block">
                              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                                ERV Sensible Eff (%)
                                <span className="inline-flex cursor-help" title={
                                    "Sensible energy recovery effectiveness of the ERV / HRV between exhaust and incoming OA streams.\n\n" +
                                    "Typical values:\n" +
                                    "• 0 %  No recovery (plain TFA without ERV)\n" +
                                    "• 65–75 %  Plate / fixed-plate heat exchanger\n" +
                                    "• 70–80 %  Enthalpy wheel (rotary)\n\n" +
                                    "Higher value = less sensible load on TFA coil = smaller chiller plant. Effect is strongest when ΔT between OA and indoor is large.\n" +
                                    "Range: 0–95 %."
                                  }>
                                  <Info className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                                </span>
                              </span>
                              <input
                                type="number"
                                min={0}
                                max={95}
                                step={1}
                                key={`ervS-${selectedSystem.id}-${(selectedSystem as any).ervSensibleEffectiveness ?? 0}`}
                                defaultValue={Math.round(((selectedSystem as any).ervSensibleEffectiveness ?? 0) * 100)}
                                onBlur={e => {
                                  const v = parseFloat(e.target.value);
                                  if (Number.isFinite(v) && v >= 0 && v <= 95) {
                                    void updateSystemField(selectedSystem.id, { ervSensibleEffectiveness: v / 100 });
                                  } else {
                                    e.target.value = String(Math.round(((selectedSystem as any).ervSensibleEffectiveness ?? 0) * 100));
                                  }
                                }}
                                className="mt-1 w-full text-sm border border-slate-200 dark:border-slate-600 rounded-md px-2 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-teal-400"
                              />
                            </label>
                            <label className="block">
                              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                                ERV Latent Eff (%)
                                <span className="inline-flex cursor-help" title={
                                    "Latent (moisture) recovery effectiveness between exhaust and incoming OA streams.\n\n" +
                                    "Typical values:\n" +
                                    "• 0 %  HRV / plate exchanger (sensible-only — no moisture transfer)\n" +
                                    "• 65–75 %  Enthalpy wheel with desiccant coating\n" +
                                    "• 50–70 %  Membrane-type plate enthalpy exchanger\n\n" +
                                    "Critical in humid Indian climates — high latent recovery dramatically reduces TFA dehumidification load in monsoon design.\n" +
                                    "Range: 0–95 %."
                                  }>
                                  <Info className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                                </span>
                              </span>
                              <input
                                type="number"
                                min={0}
                                max={95}
                                step={1}
                                key={`ervL-${selectedSystem.id}-${(selectedSystem as any).ervLatentEffectiveness ?? 0}`}
                                defaultValue={Math.round(((selectedSystem as any).ervLatentEffectiveness ?? 0) * 100)}
                                onBlur={e => {
                                  const v = parseFloat(e.target.value);
                                  if (Number.isFinite(v) && v >= 0 && v <= 95) {
                                    void updateSystemField(selectedSystem.id, { ervLatentEffectiveness: v / 100 });
                                  } else {
                                    e.target.value = String(Math.round(((selectedSystem as any).ervLatentEffectiveness ?? 0) * 100));
                                  }
                                }}
                                className="mt-1 w-full text-sm border border-slate-200 dark:border-slate-600 rounded-md px-2 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-teal-400"
                              />
                            </label>
                          </div>
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-3 italic">
                            Changing these values updates TFA/DOAS sizing live. To refresh the primary system's room loads, use <strong>Recompute &amp; save all</strong> (or change a design condition) in Load Calculator — Equipment Selection reads those saved values.
                          </p>
                        </div>

                        {/* Linked zones (Phase B) — TFA/DOAS links to specific zones,
                            not whole systems. Real practice: TFA serves selected zones
                            of a system, not every zone. Legacy whole-system links are
                            preserved and shown with a convert-to-zone button. */}
                        <div>
                          <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Linked Zones</p>
                          <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
                            Pick the zones this TFA/DOAS unit serves. Leave specific zones unselected if they handle their own ventilation (e.g. server-room split, kitchen exhaust-driven).
                          </p>
                          {(() => {
                            const primarySystems = equipSystems.filter(s => s.id !== selectedSystem.id && s.type !== 'DOAS');
                            if (primarySystems.length === 0) {
                              return <p className="text-xs text-slate-400 italic">No other systems — create a primary system first.</p>;
                            }
                            const sysLinks = ((selectedSystem as any).doasLinkedSystemIds ?? []) as string[];
                            const zoneLinks = ((selectedSystem as any).doasLinkedZoneIds ?? []) as string[];
                            return (
                              <div className="space-y-2.5">
                                {primarySystems.map(sys => {
                                  const sysIsLegacyLinked = sysLinks.includes(sys.id);
                                  const sysZones = ((sys as any).zones ?? []) as { id: string; name: string; roomIds?: string[] }[];
                                  const hasZones = sysZones.length > 0;
                                  const toggleZone = (zoneId: string) => {
                                    const isLinked = zoneLinks.includes(zoneId);
                                    const updated = isLinked
                                      ? zoneLinks.filter(id => id !== zoneId)
                                      : [...zoneLinks, zoneId];
                                    void updateSystemField(selectedSystem.id, { doasLinkedZoneIds: updated });
                                  };
                                  return (
                                    <div key={sys.id} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-900/40 p-3">
                                      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{sys.name}</span>
                                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 font-mono">{sys.type}</span>
                                          {sysIsLegacyLinked && (
                                            <span
                                              className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700"
                                              title="Legacy whole-system link active. All zones in this system are served as a group. Convert to zone-level links to pick specific zones."
                                            >
                                              Legacy: whole system
                                            </span>
                                          )}
                                        </div>
                                        {sysIsLegacyLinked && hasZones && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const newZoneLinks = Array.from(new Set([...zoneLinks, ...sysZones.map(z => z.id)]));
                                              const newSysLinks = sysLinks.filter(id => id !== sys.id);
                                              void updateSystemField(selectedSystem.id, {
                                                doasLinkedSystemIds: newSysLinks,
                                                doasLinkedZoneIds: newZoneLinks,
                                              });
                                            }}
                                            className="text-[10px] px-2 py-0.5 rounded bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-700 text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/40 font-semibold"
                                          >
                                            Convert to zone links
                                          </button>
                                        )}
                                      </div>
                                      <div className="flex flex-wrap gap-1.5">
                                        {hasZones ? sysZones.map(z => {
                                          const zoneLinked = zoneLinks.includes(z.id);
                                          const effective = zoneLinked || sysIsLegacyLinked;
                                          // Count rooms by live room.zoneId (source of truth) — NOT
                                          // by system.zones[].roomIds[] which can drift stale when
                                          // rooms are reassigned. Matches what the TFA engine actually
                                          // serves: rooms.filter(r => linked.has(r.zoneId)).
                                          const roomCount = (rooms as any[]).filter(r => r.zoneId === z.id).length;
                                          const staleRoomIdCount = (z.roomIds ?? []).length;
                                          const isStale = staleRoomIdCount !== roomCount;
                                          const locked = sysIsLegacyLinked && !zoneLinked;
                                          // Phase E: zone default TFA mode — only meaningful when zone is effectively linked.
                                          const zoneDoc = zoneDocs.find((zd: any) => zd.id === z.id);
                                          const zoneDefaultMode = ((zoneDoc as any)?.tfaDefaultMode as string | undefined) ?? 'inherit';
                                          return (
                                            <div key={z.id} className="inline-flex items-center gap-1">
                                              <button
                                                type="button"
                                                disabled={locked}
                                                onClick={() => !locked && toggleZone(z.id)}
                                                title={
                                                  locked
                                                    ? 'Locked by legacy system-link — Convert to zone links to edit individually'
                                                    : isStale
                                                      ? `Live room count: ${roomCount} (room.zoneId match). SD system.zones[].roomIds[] is stale (says ${staleRoomIdCount}). Engine uses live count.`
                                                      : undefined
                                                }
                                                className={cn(
                                                  'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium transition-colors',
                                                  effective
                                                    ? 'bg-teal-100 dark:bg-teal-900/40 border-teal-400 dark:border-teal-600 text-teal-800 dark:text-teal-200'
                                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-teal-300 hover:text-teal-700',
                                                  locked && 'opacity-60 cursor-not-allowed',
                                                )}
                                              >
                                                {effective && <Check className="w-3 h-3" />}
                                                {z.name}
                                                <span className="opacity-60">({roomCount} room{roomCount === 1 ? '' : 's'})</span>
                                                {isStale && (
                                                  <span
                                                    className="text-[9px] px-1 py-0 rounded bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 font-semibold"
                                                    title={`SD says ${staleRoomIdCount}, live is ${roomCount} — run Clean Orphan Data to fix the system.zones[].roomIds[] drift`}
                                                  >
                                                    ⚠ SD drift
                                                  </span>
                                                )}
                                              </button>
                                              {effective && (
                                                <select
                                                  value={zoneDefaultMode}
                                                  onChange={e => void updateZoneTfaDefaultMode(z.id, e.target.value as any)}
                                                  title="Default TFA mode for rooms in this zone. Individual rooms can override."
                                                  className={cn(
                                                    'h-6 text-[10px] px-1 py-0 rounded border font-semibold uppercase tracking-wide cursor-pointer',
                                                    zoneDefaultMode === 'tfa-only'
                                                      ? 'border-violet-300 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                                                      : 'border-teal-300 bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300',
                                                  )}
                                                >
                                                  <option value="inherit">Default: TFA-served</option>
                                                  <option value="tfa-served">All TFA-served</option>
                                                  <option value="tfa-only">All TFA-only (corridor)</option>
                                                </select>
                                              )}
                                            </div>
                                          );
                                        }) : (
                                          (() => {
                                            // Zoneless system (e.g. Split, single-AHU Package) — system itself is the unit of TFA linkage.
                                            const sysIdLinked = zoneLinks.includes(sys.id);
                                            const effective = sysIdLinked || sysIsLegacyLinked;
                                            const locked = sysIsLegacyLinked && !sysIdLinked;
                                            return (
                                              <button
                                                type="button"
                                                disabled={locked}
                                                onClick={() => !locked && toggleZone(sys.id)}
                                                title={locked ? 'Locked by legacy system-link — already TFA-served' : undefined}
                                                className={cn(
                                                  'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium transition-colors',
                                                  effective
                                                    ? 'bg-teal-100 dark:bg-teal-900/40 border-teal-400 dark:border-teal-600 text-teal-800 dark:text-teal-200'
                                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-teal-300 hover:text-teal-700',
                                                  locked && 'opacity-60 cursor-not-allowed',
                                                )}
                                              >
                                                {effective && <Check className="w-3 h-3" />}
                                                Whole system (no zones)
                                              </button>
                                            );
                                          })()
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>
                        </>)}

                        {/* Unit selection */}
                        <div>
                          <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">TFA/DOAS Unit Selection</p>
                          {selectedSystem.unitSelection ? (
                            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 px-4 py-3">
                              <div className="flex-1">
                                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                                  {selectedSystem.unitSelection.brand} {selectedSystem.unitSelection.modelSeries}
                                  {selectedSystem.unitSelection.subType && <span className="ml-2 text-xs font-bold px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-700">{selectedSystem.unitSelection.subType}</span>}
                                </p>
                                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                                  {selectedSystem.unitSelection.trCapacity > 0 && <span>{selectedSystem.unitSelection.trCapacity} TR · </span>}
                                  {selectedSystem.unitSelection.cfmRated > 0 && <span>{Math.round(selectedSystem.unitSelection.cfmRated).toLocaleString()} CFM · </span>}
                                  Qty: {selectedSystem.unitSelection.quantity ?? 1}
                                </p>
                              </div>
                              <Button size="sm" variant="outline" className="h-8 text-sm px-3 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                onClick={() => setUnitPicker(true)}>
                                Change
                              </Button>
                              <button className="text-slate-400 hover:text-red-500 p-1.5"
                                onClick={() => void removeUnit(selectedSystem.id)}>
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <div className="rounded-lg border border-dashed border-teal-300 dark:border-teal-700 bg-teal-50/40 dark:bg-teal-950/10 p-4 flex flex-col items-center gap-2 text-center">
                              <p className="text-sm text-slate-500 dark:text-slate-400">No unit selected</p>
                              <p className="text-xs text-slate-400 dark:text-slate-500">Pick an ERV, HRV, or FAHU sized for <strong>{doasTFAAggregate.governingCoilTR.toFixed(1)} TR</strong> · <strong>{Math.round(doasOACFM).toLocaleString()} CFM</strong> OA</p>
                              <Button size="sm" className="mt-1 h-8 text-sm px-4 bg-teal-600 hover:bg-teal-700"
                                onClick={() => setUnitPicker(true)}>
                                Select TFA/DOAS Unit
                              </Button>
                            </div>
                          )}
                        </div>

                        {/* Notes */}
                        <div>
                          <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-1.5">Design Notes</p>
                          <textarea
                            className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-slate-200 resize-none focus:outline-none focus:ring-1 focus:ring-teal-400"
                            rows={2}
                            placeholder="e.g. TFA serves office floors 1–3; ERV with enthalpy wheel; supply at neutral air (55 °F / 90 % RH)"
                            value={(selectedSystem as any).notes ?? ''}
                            onChange={e => void updateSystemField(selectedSystem.id, { notes: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Zone Manager — Project → System → Zone → Room */}
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                    <div className="bg-slate-50 dark:bg-slate-800 px-5 py-3.5 border-b dark:border-slate-700 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wide">Zones</span>
                        <span className="text-sm text-slate-400 dark:text-slate-500">{(selectedSystem.zones ?? []).length} zone{(selectedSystem.zones ?? []).length !== 1 ? 's' : ''} · {systemRoomIds.length} rooms</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {availableLcZones.length > 0 && (
                          <Button size="sm" variant="outline"
                            className="h-8 text-sm px-3 gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                            onClick={() => setShowLcZonePicker(v => !v)}>
                            <ArrowLeft className="w-3.5 h-3.5" /> From LC Zone
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="h-8 text-sm px-3 gap-1.5 border-teal-300 text-teal-700 hover:bg-teal-50"
                          onClick={handleAddZone}>
                          + Add Zone
                        </Button>
                      </div>
                    </div>

                    {/* LC Zone quick-assign panel */}
                    {showLcZonePicker && availableLcZones.length > 0 && (
                      <div className="mx-3 mt-3 mb-0 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-emerald-200 dark:border-emerald-800 bg-emerald-100/50 dark:bg-emerald-900/20">
                          <div className="flex items-center gap-1.5">
                            <ArrowLeft className="w-3.5 h-3.5 text-emerald-700" />
                            <span className="text-sm font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wide">Assign from LC Zone</span>
                          </div>
                          <button onClick={() => setShowLcZonePicker(false)} className="text-emerald-500 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-200 text-sm leading-none font-bold px-1">×</button>
                        </div>
                        <div className="divide-y divide-emerald-100 dark:divide-emerald-900">
                          {availableLcZones.map(lz => (
                            <div key={lz.zoneId} className="flex items-center gap-3 px-3 py-2 hover:bg-emerald-100/50 dark:hover:bg-emerald-900/20">
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{lz.zoneName}</span>
                                <span className="text-xs text-slate-400 dark:text-slate-500 ml-1.5">{lz.roomCount} room{lz.roomCount !== 1 ? 's' : ''}</span>
                              </div>
                              {lz.totalTR > 0 && (
                                <span className="text-sm font-mono text-slate-500">{lz.totalTR.toFixed(2)} TR</span>
                              )}
                              <Button size="sm" className="h-8 text-sm px-2 bg-emerald-700 hover:bg-emerald-800 gap-1 shrink-0"
                                onClick={() => void assignLcZoneAsNewZone(lz.zoneId, lz.zoneName)}>
                                Assign All
                              </Button>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-emerald-700 dark:text-emerald-400 px-3 py-1.5 border-t border-emerald-200 dark:border-emerald-800">
                          Creates a new zone in this system and assigns all rooms from the selected LC zone.
                        </p>
                      </div>
                    )}

                    {/* ASHRAE 62.1 System OA Summary */}
                    {systemVent62 && systemVent62.Vs > 0 && (
                      <div className="mx-3 mt-3 mb-0 bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-800 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-sm font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400">ASHRAE 62.1 System OA</span>
                          <span className="text-xs text-sky-500 dark:text-sky-500">Multi-space equation §6.2.2</span>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-center">
                          {[
                            { label: 'Vou (zone sum)', value: `${Math.round(systemVent62.Vou)} cfm` },
                            { label: 'Ev (efficiency)', value: systemVent62.Ev.toFixed(3), highlight: systemVent62.Ev < 0.6 ? 'warn' : '' },
                            { label: 'Vot (system OA)', value: `${Math.round(systemVent62.Vot)} cfm`, highlight: 'blue' },
                            { label: 'Supply (Vs)', value: `${Math.round(systemVent62.Vs)} cfm` },
                            { label: 'OA %', value: `${systemVent62.oaPct.toFixed(1)} %`, highlight: 'blue' },
                            { label: 'Critical Zone', value: (systemVent62.zones.find(z => z.isCritical)?.zoneName ?? '—').slice(0, 12), highlight: 'warn' },
                          ].map(item => (
                            <div key={item.label} className={cn('rounded px-2 py-1.5 border', item.highlight === 'blue' ? 'bg-sky-100 dark:bg-sky-900/30 border-sky-300 dark:border-sky-700' : item.highlight === 'warn' ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700')}>
                              <div className="text-xs text-slate-500 dark:text-slate-400 leading-tight">{item.label}</div>
                              <div className={cn('text-sm font-bold font-mono mt-0.5', item.highlight === 'blue' ? 'text-sky-800 dark:text-sky-300' : item.highlight === 'warn' ? 'text-amber-700 dark:text-amber-300' : 'text-slate-700 dark:text-slate-300')}>{item.value}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {rooms.length === 0 ? (
                      <p className="text-xs text-slate-400 p-4">No rooms found — create rooms in Load Calculator first.</p>
                    ) : (selectedSystem.zones ?? []).length === 0 ? (
                      <div className="p-6 text-center text-slate-400">
                        <p className="text-sm font-medium">No zones yet</p>
                        <p className="text-xs mt-1">Click &ldquo;+ Add Zone&rdquo; to create the first zone, then assign rooms to it.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100 dark:divide-slate-700">
                        {((selectedSystem.zones ?? []) as EquipmentZone[]).map((zone: EquipmentZone) => {
                          const zoneRooms = zone.roomIds.map(id => rooms.find((r: any) => r.id === id)).filter(Boolean) as any[];
                          // Use getRoomReqs (live recalc when available, stored otherwise) so the
                          // picker dialog shows the same TR/CFM the LC card is showing — previously
                          // we read stored _calc* fields directly which went stale after any DC /
                          // ACH / occupancy edit until the user re-persisted from LC.
                          const zoneRoomReqs = zoneRooms.map((r: any) => ({ r, reqs: getRoomReqs(r.id) }));
                          const zoneTR  = zoneRoomReqs.reduce((s, { reqs }) => s + (reqs.overallRequiredTR || 0), 0);
                          const zoneCFM = zoneRoomReqs.reduce((s, { reqs }) => s + (reqs.isTfaOnly ? 0 : (reqs.overallDesignCFM  || 0)), 0);
                          // Coil Duty = the Load Calculator's "REQUIRED EQUIPMENT CAPACITY":
                          // the max-season grand-total load WITH the room's overall safety factor
                          // (e.g. monsoon 69.41 TR × 1.03 = 71.49 TR), no cfmTR floor. AHU coils
                          // are custom-built to this duty, not catalog-rated TR.
                          // Coil Duty = Load Calculator's "REQUIRED EQUIPMENT CAPACITY"
                          // (max-season grand-total load × overall safety). LC is the single
                          // authoritative engine and persists this as _calcOverallRequiredTR;
                          // ES mirrors that saved value rather than recomputing, so the two
                          // screens can never disagree. Fall back to the live recalc only for a
                          // brand-new room LC hasn't persisted yet.
                          const zoneCoilTR = zoneRoomReqs.reduce((s, { r, reqs }) => {
                            const stored = Number((r as any)._calcOverallRequiredTR);
                            const live   = Number((reqs as any).overallRequiredTR);
                            const required = Number.isFinite(stored) && stored > 0
                              ? stored
                              : (Number.isFinite(live) && live > 0 ? live : 0);
                            return s + required;
                          }, 0);
                          const zoneHeatingBTUH = zoneRooms.reduce((s: number, r: any) => s + (Number(r._calcWinterHeatingBTUH) || 0), 0);
                          const zoneNeedsHumidifier = zoneRooms.some((r: any) => r.includeHumidifier);
                          const isRenaming = renamingZoneId === zone.id;

                          // Sizing check: compare installed IDU/AHU TR against required zone TR.
                          // Includes primary zone.selection AND any additional units in zone.unitSelections[]
                          // so multi-AHU zones (e.g. Banquet Hall + Exercise Room split across 2 AHUs)
                          // are scored correctly. Per-Room mode sums each room's IDU stack instead.
                          let zoneInstalledTR = 0;
                          if (zone.roomMode === 'per-room') {
                            for (const room of zoneRooms) {
                              const iduList = (selectedSystem as any).iduSelections?.[room.id];
                              const list = Array.isArray(iduList) ? iduList : iduList ? [iduList] : [];
                              zoneInstalledTR += list.reduce((s: number, i: any) => s + (Number(i.trCapacity) || 0) * (Number(i.quantity) || 1), 0);
                            }
                          } else {
                            if (zone.selection) {
                              zoneInstalledTR += (Number(zone.selection.trCapacity) || 0) * (Number(zone.selection.quantity) || 1);
                            }
                            zoneInstalledTR += (zone.unitSelections ?? []).reduce(
                              (s: number, u: any) => s + (Number(u.trCapacity) || 0) * (Number(u.quantity) || 1),
                              0,
                            );
                          }
                          const zoneSizingRequiredTR = selectedSystem.type === 'Chiller' ? zoneCoilTR : zoneTR;
                          const zoneSizing: 'ok' | 'undersized' | 'no-equipment' =
                            zoneInstalledTR === 0 ? 'no-equipment'
                            : zoneInstalledTR < zoneSizingRequiredTR * 0.98 ? 'undersized'
                            : 'ok';

                          return (
                            <div key={zone.id} className="p-5 space-y-4">
                              {/* Zone header */}
                              <div className="flex items-center justify-between">
                                {isRenaming ? (
                                  <input autoFocus
                                    className="text-base font-semibold border border-blue-300 dark:border-blue-600 rounded px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 w-48 dark:bg-slate-800 dark:text-slate-100"
                                    value={renamingZoneName}
                                    onChange={e => setRenamingZoneName(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') { void handleRenameZone(zone.id, renamingZoneName); setRenamingZoneId(null); }
                                      if (e.key === 'Escape') setRenamingZoneId(null);
                                    }}
                                    onBlur={() => { void handleRenameZone(zone.id, renamingZoneName); setRenamingZoneId(null); }}
                                  />
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <span className="text-base font-bold text-slate-800 dark:text-slate-100">{zone.name}</span>
                                    <button className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 p-0.5 rounded"
                                      onClick={() => { setRenamingZoneId(zone.id); setRenamingZoneName(zone.name); }}>
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                  </div>
                                )}
                                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                  {zoneNeedsHumidifier && (
                                    <span className="text-xs px-2.5 py-1 rounded-full bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-700 font-semibold">
                                      💧 Humidifier Required
                                    </span>
                                  )}
                                  {zoneSizing === 'undersized' && (
                                    <span
                                      className="text-xs px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 font-semibold"
                                      title={`Required ${zoneSizingRequiredTR.toFixed(2)} TR · Installed ${zoneInstalledTR.toFixed(2)} TR — review IDU sizing after recent load changes`}>
                                      ⚠ Undersized · {zoneInstalledTR.toFixed(1)} / {zoneSizingRequiredTR.toFixed(1)} TR
                                    </span>
                                  )}
                                  {zoneTR > 0 && (
                                    selectedSystem.type === 'Chiller' ? (
                                      <span
                                        className="text-sm px-3 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-mono font-semibold"
                                        title="Chiller AHU sizing — Coil Duty (thermal load) and Design CFM (dehumidified airflow) are independent. The 400 CFM/TR rule does not apply.">
                                        Coil {zoneCoilTR.toFixed(2)} TR · {Math.round(zoneCFM).toLocaleString()} CFM
                                      </span>
                                    ) : (
                                      <span className="text-sm px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 font-mono font-semibold">
                                        {zoneTR.toFixed(2)} TR · {Math.round(zoneCFM).toLocaleString()} CFM
                                      </span>
                                    )
                                  )}
                                  {zoneHeatingBTUH > 0 && (
                                    <span
                                      className="text-sm px-3 py-1.5 rounded-full bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 font-mono font-semibold"
                                      title="Winter heating load (sum of room totalHeatingLoad)">
                                      {Math.round(zoneHeatingBTUH).toLocaleString()} BTU/h heat
                                    </span>
                                  )}
                                  <button title="Delete zone" onClick={() => void handleDeleteZoneNew(zone.id)}
                                    className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-red-500 rounded">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              {/* Rooms in zone */}
                              <div className="flex flex-wrap gap-2">
                                {zoneRooms.map((r: any) => {
                                  // Per-room undersized check (only meaningful in per-room IDU mode)
                                  let roomUndersized = false;
                                  if (zone.roomMode === 'per-room') {
                                    const required = Number(r._calcOverallRequiredTR) || Number(r._calcRequiredTR) || 0;
                                    const iduList = (selectedSystem as any).iduSelections?.[r.id];
                                    const list = Array.isArray(iduList) ? iduList : iduList ? [iduList] : [];
                                    const installed = list.reduce((s: number, i: any) => s + (Number(i.trCapacity) || 0) * (Number(i.quantity) || 1), 0);
                                    roomUndersized = installed > 0 && installed < required * 0.98;
                                  }
                                  // Per-room TFA mode is now SET in the Load Calculator. Here we
                                  // only show a read-only badge of the effective mode (when served).
                                  const roomDoasChip = findDoasForRoom(r);
                                  const effectiveModeChip = getEffectiveTfaMode(r, roomDoasChip);
                                  return (
                                    <span key={r.id} className={cn(
                                      'inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-full font-medium border',
                                      roomUndersized
                                        ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300'
                                        : 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300',
                                    )}>
                                      {roomUndersized && <span title="Room IDU under-rated for current load — review">⚠</span>}
                                      {r.name}
                                      {r.floor && <span className={cn('text-sm', roomUndersized ? 'text-amber-500' : 'text-blue-400 dark:text-blue-500')}>{r.floor}</span>}
                                      {roomDoasChip && effectiveModeChip !== 'no-tfa' && (
                                        <span
                                          title={`Fresh air is set per-room in the Load Calculator. Effective: ${effectiveModeChip}.`}
                                          className={cn(
                                            'h-5 text-[10px] px-1.5 py-0 rounded border font-semibold uppercase tracking-wide inline-flex items-center',
                                            effectiveModeChip === 'tfa-only' ? 'border-violet-300 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                                                                             : 'border-teal-300 bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300',
                                          )}
                                        >
                                          {effectiveModeChip === 'tfa-only' ? 'TFA-only' : 'TFA'}
                                        </span>
                                      )}
                                      <button onClick={() => void handleRemoveRoomFromZone(zone.id, r.id)}
                                        className={cn('leading-none ml-0.5 text-base font-bold hover:text-red-500', roomUndersized ? 'text-amber-400' : 'text-blue-400')}>×</button>
                                    </span>
                                  );
                                })}
                                <button
                                  className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-600 transition-colors font-medium"
                                  onClick={() => { setAddRoomsZoneId(zone.id); setAddRoomsSelected(new Set()); }}>
                                  + Add Rooms
                                </button>
                              </div>

                              {/* Zone terminal equipment — type-specific */}
                              {selectedSystem.type === 'VRF' || selectedSystem.type === 'Chiller' || selectedSystem.type === 'AHU' ? (
                                // Single or per-room terminal unit selection
                                <div className="bg-slate-50/60 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                                  {/* Mode toggle */}
                                  <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                                    <span className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wide shrink-0">
                                      {selectedSystem.type === 'VRF' ? 'IDU' : 'Terminal Unit'}:
                                    </span>
                                    <div className="flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden ml-1">
                                      <button type="button"
                                        className={cn('px-3.5 py-1.5 text-sm font-semibold transition-colors',
                                          zone.roomMode !== 'per-room' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-600')}
                                        onClick={() => zone.roomMode === 'per-room' && void handleSetZoneRoomMode(zone.id, 'single')}>
                                        Single Unit
                                      </button>
                                      <button type="button"
                                        className={cn('px-3.5 py-1.5 text-sm font-semibold transition-colors border-l border-slate-200 dark:border-slate-600',
                                          zone.roomMode === 'per-room' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-600')}
                                        onClick={() => zone.roomMode !== 'per-room' && void handleSetZoneRoomMode(zone.id, 'per-room')}>
                                        Per Room
                                      </button>
                                    </div>
                                  </div>

                                  {zone.roomMode !== 'per-room' ? (
                                  <div className="px-4 py-4 space-y-3">
                                  <div className="flex items-center gap-3 flex-wrap">
                                    {zone.selection ? (
                                      <>
                                        <span className="text-base font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-2 flex-wrap">
                                          {zone.selection.brand} {zone.selection.modelSeries} · {zone.selection.trCapacity} TR each
                                          {zone.selection.isCustom && <span className="text-sm font-bold px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-700">Custom</span>}
                                        </span>
                                        {/* Quantity stepper — for same-spec multi-AHU zones (duct height / space constraint).
                                            Each AHU has its OWN dedicated duct; total CFM is split across N units. */}
                                        <div className="inline-flex items-center gap-1 shrink-0 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-1">
                                          <button type="button"
                                            onClick={() => void updateZoneSelectionQty(zone.id, (zone.selection?.quantity ?? 1) - 1)}
                                            disabled={(zone.selection.quantity ?? 1) <= 1}
                                            className="w-7 h-7 text-slate-600 dark:text-slate-300 flex items-center justify-center text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-700 rounded disabled:opacity-40"
                                            title="Reduce AHU quantity">−</button>
                                          <span className="w-7 text-center text-sm font-bold font-mono text-indigo-700 dark:text-indigo-400">{zone.selection.quantity ?? 1}</span>
                                          <button type="button"
                                            onClick={() => void updateZoneSelectionQty(zone.id, (zone.selection?.quantity ?? 1) + 1)}
                                            className="w-7 h-7 text-slate-600 dark:text-slate-300 flex items-center justify-center text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                                            title="Add another AHU (same spec, dedicated duct each)">+</button>
                                        </div>
                                        {(zone.selection.quantity ?? 1) > 1 && (
                                          <span className="text-sm font-bold text-indigo-700 dark:text-indigo-400">
                                            = {((zone.selection.trCapacity ?? 0) * (zone.selection.quantity ?? 1)).toFixed(1)} TR total
                                          </span>
                                        )}
                                        <span className="flex-1" />
                                        <Button size="sm" variant="outline" className="h-9 text-sm px-3"
                                          onClick={() => setZoneEquipPicker({ zoneId: zone.id, zoneName: zone.name, totalTR: zoneTR, totalCFM: zoneCFM, coilTR: zoneCoilTR, systemType: selectedSystem.type })}>
                                          Change
                                        </Button>
                                        <button className="text-slate-400 hover:text-red-500 p-1.5"
                                          onClick={() => void handleClearZoneEquip(zone.id)}>
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </>
                                    ) : (
                                      <Button size="sm" variant="default" className="h-9 text-sm px-4"
                                        onClick={() => setZoneEquipPicker({ zoneId: zone.id, zoneName: zone.name, totalTR: zoneTR, totalCFM: zoneCFM, coilTR: zoneCoilTR, systemType: selectedSystem.type })}>
                                        Select {selectedSystem.type === 'VRF' ? 'IDU' : selectedSystem.type === 'AHU' ? 'AHU (DX)' : 'AHU / FCU'}
                                      </Button>
                                    )}
                                  </div>
                                  {/* Hint for multi-AHU zones */}
                                  {zone.selection && (zone.selection.quantity ?? 1) > 1 && (
                                    <p className="text-xs text-slate-500 dark:text-slate-400 italic leading-relaxed">
                                      ⓘ {zone.selection.quantity} × same-spec AHUs, <strong>each with its own dedicated duct</strong>. Used when duct height or space constraint prevents a single large AHU. AHU Configuration below (filters, ESP, mounting, coil) applies to every unit; the BOM lists {zone.selection.quantity} of each accessory.
                                    </p>
                                  )}

                                  {/* FAHU Accessories — VRF ductable/AHU zones only */}
                                  {selectedSystem.type === 'VRF' && zone.selection && FAHU_CAPABLE_SUBTYPES.has(zone.selection.subType ?? '') && (() => {
                                    const fahu = zone.fahu ?? { hasElectricHeater: false, electricHeaterKW: 0, hasHumidifier: false, humidifierKgHr: 0 };
                                    const humidSizing = calcSuggestedHumidifier(zoneRooms, project);
                                    const suggestedHumidKgHr = humidSizing.kgHr;
                                    const humidSizingTitle = humidSizing.kgHr > 0
                                      ? `ASHRAE Fundamentals Ch.6 + HVAC S&E Ch.22\n` +
                                        `Base: ${humidSizing.oaCFM} CFM OA × ΔW ${humidSizing.deltaW_gPerKg} g/kg → ${humidSizing.baseKgHr} kg/hr\n` +
                                        `+${humidSizing.safetyPct}% safety (steam dispersion / duct losses) → ${humidSizing.kgHr} kg/hr`
                                      : 'Winter design conditions or OA flow not set — cannot suggest';
                                    return (
                                      <div className="border-t border-orange-100 dark:border-orange-900/40 pt-3 space-y-2.5">
                                        <span className="text-sm font-bold uppercase tracking-wider text-orange-700 dark:text-orange-400 flex items-center gap-1.5">
                                          <Wind className="w-3 h-3" /> FAHU Accessories
                                        </span>
                                        {/* Electric Heater */}
                                        <div className="flex items-center gap-3 flex-wrap">
                                          <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                            <input type="checkbox"
                                              checked={fahu.hasElectricHeater}
                                              onChange={e => void handleUpdateZoneFahu(zone.id, { ...fahu, hasElectricHeater: e.target.checked })}
                                              className="rounded border-slate-300 dark:border-slate-600" />
                                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Electric Heater</span>
                                          </label>
                                          {fahu.hasElectricHeater && (
                                            <div className="flex items-center gap-1.5">
                                              <NumericInput min={0}
                                                value={fahu.electricHeaterKW || undefined}
                                                onChange={(n) => void handleUpdateZoneFahu(zone.id, { ...fahu, electricHeaterKW: n ?? 0 })}
                                                className="w-16 h-8 text-sm font-mono border border-slate-300 dark:border-slate-600 rounded px-1.5 bg-white dark:bg-slate-800 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-orange-400"
                                                placeholder="kW" />
                                              <span className="text-xs text-slate-500 dark:text-slate-400">kW</span>
                                              <span className="text-xs text-slate-400 dark:text-slate-500 italic">· reheat / dehumidification</span>
                                            </div>
                                          )}
                                        </div>
                                        {/* Humidifier — only when room(s) in zone require it */}
                                        {zoneNeedsHumidifier && (
                                        <div className="space-y-1.5">
                                          <div className="flex items-center gap-3 flex-wrap">
                                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                              <input type="checkbox"
                                                checked={fahu.hasHumidifier}
                                                onChange={e => void handleUpdateZoneFahu(zone.id, { ...fahu, hasHumidifier: e.target.checked })}
                                                className="rounded border-slate-300 dark:border-slate-600" />
                                              <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Humidifier</span>
                                            </label>
                                            {fahu.hasHumidifier && (
                                              <div className="flex items-center gap-1.5 flex-wrap">
                                                <NumericInput min={0}
                                                  value={fahu.humidifierKgHr || undefined}
                                                  onChange={(n) => void handleUpdateZoneFahu(zone.id, { ...fahu, humidifierKgHr: n ?? 0 })}
                                                  className="w-16 h-8 text-sm font-mono border border-slate-300 dark:border-slate-600 rounded px-1.5 bg-white dark:bg-slate-800 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                                  placeholder="kg/hr" />
                                                <span className="text-xs text-slate-500 dark:text-slate-400">kg/hr</span>
                                                {suggestedHumidKgHr > 0 && !fahu.humidifierKgHr && (
                                                  <button type="button"
                                                    className="text-xs text-blue-600 hover:underline"
                                                    title={humidSizingTitle}
                                                    onClick={() => void handleUpdateZoneFahu(zone.id, { ...fahu, humidifierKgHr: suggestedHumidKgHr })}>
                                                    Use est. {suggestedHumidKgHr} kg/hr (incl. {humidSizing.safetyPct}% safety)
                                                  </button>
                                                )}
                                                <button type="button"
                                                  className="text-xs px-2 py-0.5 rounded border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                                                  onClick={() => setHumidPicker({ zoneId: zone.id, suggestedKgHr: fahu.humidifierKgHr || suggestedHumidKgHr })}>
                                                  Select model
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                          {fahu.humidifierModel && (
                                            <div className="text-xs text-slate-500 dark:text-slate-400 pl-1">
                                              Selected: <span className="font-semibold text-slate-700 dark:text-slate-300">{fahu.humidifierModel}</span>
                                              {fahu.humidifierSubType && <span className="ml-1 text-slate-400">· {fahu.humidifierSubType}</span>}
                                            </div>
                                          )}
                                        </div>
                                        )}
                                      </div>
                                    );
                                  })()}

                                  {/* AHU config — Chiller terminal, AHU DX terminal, and VRF zones with AHU-type IDU */}
                                  {((selectedSystem.type === 'Chiller' || selectedSystem.type === 'AHU') ||
                                    (selectedSystem.type === 'VRF' && FAHU_CAPABLE_SUBTYPES.has(zone.selection?.subType ?? ''))) && zone.selection && (() => {
                                    const ahuCfg: AHUConfig = zone.ahuConfig ?? (selectedSystem as any).ahuConfig ?? DEFAULT_AHU_CONFIG;
                                    const updateAHUCfg = async (updates: Partial<AHUConfig>) => {
                                      const next = { ...ahuCfg, ...updates };
                                      const updatedZones = ((selectedSystem.zones ?? []) as EquipmentZone[]).map((z: EquipmentZone) =>
                                        z.id === zone.id ? { ...z, ahuConfig: next } : z
                                      );
                                      const docUpdates: Record<string, any> = { zones: updatedZones, updatedAt: serverTimestamp() };
                                      if (selectedSystem.type !== 'VRF') {
                                        docUpdates.ahuConfig = next;
                                      }
                                      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), docUpdates);
                                    };
                                    const toggleFilter = async (key: 'pre' | 'fine' | 'hepa', val: boolean) => {
                                      await updateAHUCfg({ filters: { ...ahuCfg.filters, [key]: val } });
                                    };
                                    const PRE_GRADES  = ['G3', 'G4 (EU4 / MERV-8)', 'M5 (EU5 / MERV-9)', 'M6 (EU6 / MERV-11)'];
                                    const FINE_GRADES = ['F7 (EU7 / MERV-13)', 'F8 (EU8 / MERV-14)', 'F9 (EU9 / MERV-15)'];
                                    const HEPA_GRADES = ['H10', 'H11', 'H12', 'H13', 'H14 (ULPA)'];
                                    const isDXCoil = selectedSystem.type === 'VRF' || selectedSystem.type === 'AHU';
                                    const isConfigExpanded = expandedZoneConfigIds.has(zone.id);
                                    return (
                                      <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">

                                        {/* AHU Config toggle — all settings inside */}
                                        <button type="button"
                                          onClick={() => setExpandedZoneConfigIds(prev => {
                                            const next = new Set(prev);
                                            next.has(zone.id) ? next.delete(zone.id) : next.add(zone.id);
                                            return next;
                                          })}
                                          className={cn(
                                            'flex items-center gap-2 w-full text-left px-3 py-2 rounded-md border transition-all',
                                            isConfigExpanded
                                              ? 'bg-sky-50 dark:bg-sky-900/30 border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300'
                                              : 'bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 hover:border-slate-400'
                                          )}
                                        >
                                          {isConfigExpanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                                          <span className="text-sm font-semibold">AHU Configuration</span>
                                          {!isConfigExpanded && <span className="text-sm text-slate-400 dark:text-slate-500 font-normal ml-0.5">— mounting, coil type, fan, ESP, filtration</span>}
                                          {isConfigExpanded && <span className="text-sm text-sky-500 dark:text-sky-400 font-normal ml-0.5">— click to collapse</span>}
                                        </button>

                                        {isConfigExpanded && (
                                          <div className="space-y-3 pt-1">
                                            {/* Row 1: Mounting + Coil Type */}
                                            <div className="grid grid-cols-2 gap-3">
                                              <div>
                                                <label className="block text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Mounting</label>
                                                <select
                                                  value={zone.selection!.mountingType ?? ''}
                                                  onChange={e => void handleUpdateZoneEquipProps(zone.id, { mountingType: e.target.value as IDUSelection['mountingType'] })}
                                                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-md px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                                >
                                                  <option value="">— Select —</option>
                                                  <option value="floor-standing">Floor Standing</option>
                                                  <option value="ceiling-hung">Ceiling Hung</option>
                                                </select>
                                              </div>
                                              <div>
                                                <label className="block text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                                                  {isDXCoil ? 'DX Coil' : 'Coil Type'}
                                                </label>
                                                <select
                                                  value={zone.selection!.coilType ?? ''}
                                                  onChange={async e => {
                                                    const newCoilType = e.target.value as IDUSelection['coilType'];
                                                    const hasHeat = isDXCoil
                                                      ? newCoilType === 'cooling-heating'
                                                      : newCoilType === 'cooling-heating' || ((selectedSystem.zones ?? []) as EquipmentZone[]).some(z => z.id !== zone.id && z.selection?.coilType === 'cooling-heating');
                                                    // Merge coilType + hasHeatingCoil in one write — two sequential writes both
                                                    // rebuild from stale selectedSystem.zones and the second overwrites the first
                                                    const nextAhuCfg = { ...ahuCfg, hasHeatingCoil: hasHeat };
                                                    const updatedZones = ((selectedSystem.zones ?? []) as EquipmentZone[]).map((z: EquipmentZone) =>
                                                      z.id === zone.id
                                                        ? { ...z, selection: z.selection ? { ...z.selection, coilType: newCoilType } : z.selection, ahuConfig: nextAhuCfg }
                                                        : z
                                                    );
                                                    const docUpdates: Record<string, any> = { zones: updatedZones, updatedAt: serverTimestamp() };
                                                    if (selectedSystem.type !== 'VRF') docUpdates.ahuConfig = nextAhuCfg;
                                                    await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), docUpdates);
                                                  }}
                                                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-md px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                                >
                                                  <option value="">— Select —</option>
                                                  {isDXCoil ? (
                                                    <>
                                                      <option value="cooling-only">Cooling Only</option>
                                                      <option value="cooling-heating">Heat Pump — Reversible Coil</option>
                                                    </>
                                                  ) : (
                                                    <>
                                                      <option value="cooling-only">Cooling Coil Only</option>
                                                      <option value="cooling-heating">Cooling + Heating Coil</option>
                                                    </>
                                                  )}
                                                </select>
                                                {isDXCoil && (
                                                  <p className="text-xs text-slate-400 dark:text-slate-500 italic mt-1">Single refrigerant coil — cools in summer, heats in winter (heat pump)</p>
                                                )}
                                              </div>
                                            </div>

                                            {/* Row 2: Fan Wheel + Drive */}
                                            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                                              <div className="flex items-center gap-2">
                                                <span className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 w-20 shrink-0">Fan Wheel</span>
                                                {(['backward-curved', 'forward-curved'] as const).map(v => (
                                                  <button key={v}
                                                    onClick={() => void updateAHUCfg({ fanCurve: v })}
                                                    className={cn('text-xs px-2.5 py-1 rounded border font-medium transition-colors',
                                                      ahuCfg.fanCurve === v ? 'bg-sky-600 border-sky-600 text-white' : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-sky-400')}>
                                                    {v === 'backward-curved' ? 'Backward Curved' : 'Forward Curved'}
                                                  </button>
                                                ))}
                                              </div>
                                              <div className="flex items-center gap-2">
                                                <span className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 w-12 shrink-0">Drive</span>
                                                {(['belt-driven', 'plug-fan'] as const).map(v => (
                                                  <button key={v}
                                                    onClick={() => void updateAHUCfg({ fanDrive: v })}
                                                    className={cn('text-xs px-2.5 py-1 rounded border font-medium transition-colors',
                                                      ahuCfg.fanDrive === v ? 'bg-sky-600 border-sky-600 text-white' : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-sky-400')}>
                                                    {v === 'belt-driven' ? 'Belt Driven' : 'Plug Fan'}
                                                  </button>
                                                ))}
                                              </div>
                                            </div>

                                            {/* Row 3: ESP input */}
                                            <div className="flex flex-wrap items-center gap-2.5">
                                              <span className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 w-10 shrink-0">ESP</span>
                                              <NumericInput
                                                integer min={0}
                                                value={paToMmWg(ahuCfg.extStaticPa ?? 150)}
                                                onChange={(n) => void updateAHUCfg({ extStaticPa: Math.max(0, mmWgToPa(n) ?? 0) })}
                                                className="w-24 h-8 text-sm font-mono border border-slate-300 dark:border-slate-600 rounded-md px-2.5 bg-white dark:bg-slate-800 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-400"
                                              />
                                              <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">mm WG</span>
                                              <span className="text-xs text-slate-400 dark:text-slate-500 italic">· TSP (total static) by manufacturer</span>
                                            </div>

                                            {/* Row 4: Mixing Box + Coil Rows */}
                                            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                                              <div className="flex items-center gap-2">
                                                <span className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 w-24 shrink-0">Mixing Box</span>
                                                {([true, false] as const).map(v => (
                                                  <button key={String(v)}
                                                    onClick={() => void updateAHUCfg({ hasMixingBox: v })}
                                                    className={cn('text-xs px-2.5 py-1 rounded border font-medium transition-colors',
                                                      (ahuCfg.hasMixingBox ?? true) === v
                                                        ? 'bg-sky-600 border-sky-600 text-white'
                                                        : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-sky-400')}>
                                                    {v ? 'Yes' : 'No'}
                                                  </button>
                                                ))}
                                                <span className="text-xs text-slate-400 dark:text-slate-500 italic">· adds ~600 mm length</span>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                <span className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 w-24 shrink-0">
                                                  {isDXCoil ? 'Coil Rows' : 'Cooling Coil'}
                                                </span>
                                                {([4, 6, 8] as const).map(v => (
                                                  <button key={v}
                                                    onClick={() => void updateAHUCfg({ coolingCoilRows: v })}
                                                    className={cn('text-xs px-2.5 py-1 rounded border font-mono font-semibold transition-colors',
                                                      (ahuCfg.coolingCoilRows ?? 6) === v
                                                        ? 'bg-indigo-600 border-indigo-600 text-white'
                                                        : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-indigo-400')}>
                                                    {v}R
                                                  </button>
                                                ))}
                                                <span className="text-xs text-slate-400 dark:text-slate-500">rows</span>
                                                {isDXCoil && (
                                                  <span className="text-xs text-slate-400 dark:text-slate-500 italic">· evaporator / condenser</span>
                                                )}
                                              </div>
                                              {!isDXCoil && ahuCfg.hasHeatingCoil && (
                                                <div className="flex items-center gap-2">
                                                  <span className="text-sm font-semibold uppercase tracking-wide text-orange-500 dark:text-orange-400 w-24 shrink-0">Heating Coil</span>
                                                  {([1, 2] as const).map(v => (
                                                    <button key={v}
                                                      onClick={() => void updateAHUCfg({ heatingCoilRows: v })}
                                                      className={cn('text-xs px-2.5 py-1 rounded border font-mono font-semibold transition-colors',
                                                        (ahuCfg.heatingCoilRows ?? 2) === v
                                                          ? 'bg-orange-500 border-orange-500 text-white'
                                                          : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-orange-400')}>
                                                      {v}R
                                                    </button>
                                                  ))}
                                                  <span className="text-xs text-orange-400 dark:text-orange-500">rows</span>
                                                </div>
                                              )}
                                              {/* Heating duty. The coil-type dropdown only declares that a heating coil
                                                  EXISTS; nothing stored a capacity, so the report's Heating Equipment
                                                  Schedule had nothing to verify and every project read NOT SELECTED.
                                                  Suggestion is the zone's own calculated winter duty (space + DOAS
                                                  temper coil) from the persisted room fields — recompute the project
                                                  first if it looks stale. */}
                                              {!isDXCoil && ahuCfg.hasHeatingCoil && (() => {
                                                // SPACE heating only — transmission + infiltration, which is all a
                                                // recirculating AHU is responsible for. The fresh-air temper duty
                                                // (_calcTfaWinterHeatingBTUH) belongs to the DOAS and has its own
                                                // field on that unit; including it here suggested 60 kW for GURT
                                                // Complex A against the 39 kW its AHU actually carries.
                                                const zoneWinterBTUH = (zone.roomIds ?? []).reduce((sum: number, id: string) => {
                                                  const r: any = rooms.find((x: any) => x.id === id);
                                                  return sum + (Number(r?._calcWinterHeatingBTUH) || 0);
                                                }, 0);
                                                const suggestedKW = zoneWinterBTUH > 0 ? Math.ceil((zoneWinterBTUH / 3412) * 10) / 10 : 0;
                                                const selectedKW = Number(ahuCfg.heatingCapacityKW) || 0;
                                                const short = selectedKW > 0 && suggestedKW > 0 && selectedKW < suggestedKW;
                                                return (
                                                  <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-sm font-semibold uppercase tracking-wide text-orange-500 dark:text-orange-400 w-24 shrink-0">Heating Duty</span>
                                                    <NumericInput min={0}
                                                      value={ahuCfg.heatingCapacityKW ?? undefined}
                                                      onChange={(n) => void updateAHUCfg({ heatingCapacityKW: n ?? undefined })}
                                                      className="w-20 h-8 text-sm font-mono border border-slate-300 dark:border-slate-600 rounded px-1.5 bg-white dark:bg-slate-800 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-orange-400"
                                                      placeholder="kW" />
                                                    <span className="text-xs text-orange-400 dark:text-orange-500">kW</span>
                                                    {suggestedKW > 0 && (
                                                      <button type="button"
                                                        onClick={() => void updateAHUCfg({ heatingCapacityKW: suggestedKW })}
                                                        title={`Zone winter duty ${Math.round(zoneWinterBTUH).toLocaleString()} BTU/h ÷ 3412`}
                                                        className="text-xs px-2 py-1 rounded border border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors">
                                                        use required {suggestedKW} kW
                                                      </button>
                                                    )}
                                                    {selectedKW === 0 && (
                                                      <span className="text-xs text-red-500 dark:text-red-400 italic">not selected — schedule reports the gap</span>
                                                    )}
                                                    {short && (
                                                      <span className="text-xs text-red-500 dark:text-red-400 italic">undersized vs {suggestedKW} kW required</span>
                                                    )}
                                                  </div>
                                                );
                                              })()}
                                            </div>

                                            {/* Row 5: Filtration */}
                                            <div className="grid grid-cols-3 gap-2">
                                              {([
                                                { key: 'pre'  as const, label: 'Pre Filter',  grades: PRE_GRADES,  grade: ahuCfg.preFilterGrade,  gradeKey: 'preFilterGrade'  as const },
                                                { key: 'fine' as const, label: 'Fine Filter', grades: FINE_GRADES, grade: ahuCfg.fineFilterGrade, gradeKey: 'fineFilterGrade' as const },
                                                { key: 'hepa' as const, label: 'HEPA Filter', grades: HEPA_GRADES, grade: ahuCfg.hepaFilterGrade, gradeKey: 'hepaFilterGrade' as const },
                                              ]).map(f => (
                                                <div key={f.key} className={cn('rounded-md px-2.5 py-2 border', ahuCfg.filters[f.key] ? 'bg-sky-50 dark:bg-sky-900/30 border-sky-300 dark:border-sky-700' : 'bg-slate-50 dark:bg-slate-700 border-slate-200 dark:border-slate-600')}>
                                                  <label className="flex items-center gap-2 cursor-pointer">
                                                    <input type="checkbox" checked={ahuCfg.filters[f.key]}
                                                      onChange={e => void toggleFilter(f.key, e.target.checked)}
                                                      className="accent-sky-600 shrink-0 w-3.5 h-3.5" />
                                                    <span className={cn('text-sm font-semibold', ahuCfg.filters[f.key] ? 'text-sky-700 dark:text-sky-300' : 'text-slate-500 dark:text-slate-400')}>{f.label}</span>
                                                  </label>
                                                  {ahuCfg.filters[f.key] && (
                                                    <select value={f.grade}
                                                      onChange={e => void updateAHUCfg({ [f.gradeKey]: e.target.value })}
                                                      className="mt-1.5 w-full text-xs border border-sky-200 dark:border-sky-700 rounded px-1.5 py-1 bg-white dark:bg-slate-800 dark:text-slate-300 focus:outline-none">
                                                      {f.grades.map(g => <option key={g} value={g}>{g}</option>)}
                                                    </select>
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}

                                        {zoneNeedsHumidifier && (() => {
                                          const ahuFahu = zone.fahu ?? { hasElectricHeater: false, electricHeaterKW: 0, hasHumidifier: false, humidifierKgHr: 0 };
                                          const humidSizingAhu = calcSuggestedHumidifier(zoneRooms, project);
                                          const suggestedKgHr = humidSizingAhu.kgHr;
                                          const humidSizingAhuTitle = humidSizingAhu.kgHr > 0
                                            ? `ASHRAE Fundamentals Ch.6 + HVAC S&E Ch.22\n` +
                                              `Base: ${humidSizingAhu.oaCFM} CFM OA × ΔW ${humidSizingAhu.deltaW_gPerKg} g/kg → ${humidSizingAhu.baseKgHr} kg/hr\n` +
                                              `+${humidSizingAhu.safetyPct}% safety (steam dispersion / duct losses) → ${humidSizingAhu.kgHr} kg/hr`
                                            : 'Winter design conditions or OA flow not set — cannot suggest';
                                          return (
                                            <div className="border border-sky-200 dark:border-sky-700 rounded-md bg-sky-50 dark:bg-sky-900/30 px-3 py-2.5 space-y-2">
                                              <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300">💧 AHU Humidifier</span>
                                                <span className="text-xs text-sky-600 dark:text-sky-400 italic">· rooms in this zone require humidification</span>
                                              </div>
                                              <div className="flex items-center gap-3 flex-wrap">
                                                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                                  <input type="checkbox"
                                                    checked={ahuFahu.hasHumidifier}
                                                    onChange={e => void handleUpdateZoneFahu(zone.id, { ...ahuFahu, hasHumidifier: e.target.checked })}
                                                    className="rounded border-slate-300 dark:border-slate-600 accent-sky-600" />
                                                  <span className="text-sm font-semibold text-sky-800 dark:text-sky-200">Include Steam / Electric Humidifier</span>
                                                </label>
                                                {ahuFahu.hasHumidifier && (
                                                  <div className="flex items-center gap-1.5 flex-wrap">
                                                    <NumericInput min={0}
                                                      value={ahuFahu.humidifierKgHr || undefined}
                                                      onChange={(n) => void handleUpdateZoneFahu(zone.id, { ...ahuFahu, humidifierKgHr: n ?? 0 })}
                                                      className="w-16 h-8 text-sm font-mono border border-sky-300 dark:border-sky-700 rounded px-1.5 bg-white dark:bg-slate-800 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-sky-400"
                                                      placeholder="kg/hr" />
                                                    <span className="text-xs text-slate-500 dark:text-slate-400">kg/hr</span>
                                                    {suggestedKgHr > 0 && !ahuFahu.humidifierKgHr && (
                                                      <button type="button"
                                                        className="text-xs text-sky-600 dark:text-sky-400 hover:underline"
                                                        title={humidSizingAhuTitle}
                                                        onClick={() => void handleUpdateZoneFahu(zone.id, { ...ahuFahu, humidifierKgHr: suggestedKgHr })}>
                                                        Use est. {suggestedKgHr} kg/hr (incl. {humidSizingAhu.safetyPct}% safety)
                                                      </button>
                                                    )}
                                                    <button type="button"
                                                      className="text-xs px-2 py-0.5 rounded border border-sky-300 dark:border-sky-700 text-sky-600 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/50"
                                                      onClick={() => setHumidPicker({ zoneId: zone.id, suggestedKgHr: ahuFahu.humidifierKgHr || suggestedKgHr })}>
                                                      Select model
                                                    </button>
                                                  </div>
                                                )}
                                              </div>
                                              {ahuFahu.humidifierModel && (
                                                <div className="text-xs text-sky-700 dark:text-sky-300 pl-1">
                                                  Selected: <span className="font-semibold">{ahuFahu.humidifierModel}</span>
                                                  {ahuFahu.humidifierSubType && <span className="ml-1 text-sky-500">· {ahuFahu.humidifierSubType}</span>}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })()}

                                        {/* Per-zone Dehumidification strategy — 4 methods, zone-scoped.
                                            Renders for any zoned system (AHU, Chiller AHU terminals, zoned
                                            VRF). Visible when this zone has dehumid load, a chosen method,
                                            or already-picked dehumidifier units. */}
                                        {(() => {
                                          const zoneDehumidLbsHr = dehumidByZone.get(zone.id)?.lbsHr ?? 0;
                                          const zoneDehumidUnits: DehumidifierUnit[] = (zone as any).dehumidifierUnits ?? [];
                                          const zoneMethod: DehumidMethod | null = (zone as any).dehumidMethod ?? null;
                                          const zoneReheatKWOverride: number | undefined = (zone as any).dehumidReheatKW;
                                          const zoneReheatBTU = reheatByZone.get(zone.id) ?? 0;
                                          if (zoneDehumidLbsHr <= 0 && zoneReheatBTU <= 0 && !zoneMethod && zoneDehumidUnits.length === 0) return null;
                                          // Zone-level AHU config drives whether HW coil reheat is available.
                                          const zoneAhuCfg: AHUConfig = zone.ahuConfig ?? (selectedSystem as any).ahuConfig ?? DEFAULT_AHU_CONFIG;
                                          return (
                                            <DehumidificationStrategySection
                                              scopeLabel={`Zone ${zone.name}`}
                                              latentLbsHr={zoneDehumidLbsHr}
                                              reheatBTU={zoneReheatBTU}
                                              method={zoneMethod}
                                              reheatKWOverride={zoneReheatKWOverride}
                                              units={zoneDehumidUnits}
                                              isVRF={selectedSystem.type === 'VRF'}
                                              hasHeatingCoilInAHU={!!zoneAhuCfg.hasHeatingCoil}
                                              isSystemLevel={false}
                                              models={dehumidifierModels}
                                              onChangeMethod={(m) => setZoneDehumidMethod(selectedSystem.id, zone.id, m, zoneReheatBTU / BTUH_PER_KW)}
                                              onChangeReheatKWOverride={(kw) => setZoneDehumidReheatKW(selectedSystem.id, zone.id, kw)}
                                              onAddDehumidifier={(model) => addZoneDehumidifier(selectedSystem.id, zone.id, model)}
                                              onRemoveDehumidifier={(idx) => removeZoneDehumidifier(selectedSystem.id, zone.id, idx)}
                                              onUpdateDehumidifierQty={(idx, qty) => updateZoneDehumidifierQty(selectedSystem.id, zone.id, idx, qty)}
                                            />
                                          );
                                        })()}
                                      </div>
                                    );
                                  })()}
                                  </div>
                                  ) : (
                                    <div className="divide-y divide-slate-100 dark:divide-slate-700">
                                      {zoneRooms.length === 0 ? (
                                        <p className="text-xs text-slate-400 italic px-3 py-3">No rooms in this zone yet.</p>
                                      ) : zoneRooms.map((r: any) => {
                                        const reqs = getRoomReqs(r.id);
                                        const idus = normalizeIDUList((selectedSystem.iduSelections as any)[r.id]);
                                        const reqTR = reqs.overallRequiredTR || reqs.requiredTR || 0;
                                        const reqCFM = reqs.overallDesignCFM || reqs.designCFM || 0;
                                        const roomDoas = findDoasForRoom(r);
                                        const effectiveMode = getEffectiveTfaMode(r, roomDoas);
                                        return (
                                          <div key={r.id} className="flex items-start gap-2.5 px-3 py-2">
                                            <div className="flex-1 min-w-0">
                                              <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{r.name}</span>
                                                {r.floor && <span className="text-xs text-slate-400 dark:text-slate-500">{r.floor}</span>}
                                                {reqTR > 0 && <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">{reqTR.toFixed(2)} TR req.</span>}
                                                {roomDoas && effectiveMode !== 'no-tfa' && (
                                                  <span
                                                    title={`Fresh air is set per-room in the Load Calculator. Effective: ${effectiveMode}.`}
                                                    className={cn(
                                                      'h-5 text-[10px] px-1.5 py-0 rounded border font-semibold uppercase tracking-wide inline-flex items-center',
                                                      effectiveMode === 'tfa-only' ? 'border-violet-300 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                                                                                   : 'border-teal-300 bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300',
                                                    )}
                                                  >
                                                    {effectiveMode === 'tfa-only' ? 'TFA-only' : 'TFA'}
                                                  </span>
                                                )}
                                              </div>
                                              {idus.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                  {idus.map((u, idx) => (
                                                    <span key={idx} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs">
                                                      {(u.quantity ?? 1) > 1 && <span className="text-blue-600 dark:text-blue-400 font-bold">{u.quantity}×</span>}
                                                      {u.brand} {u.modelSeries} · {u.trCapacity} TR
                                                      <button className="text-emerald-400 hover:text-red-500" onClick={() => void removeIDUAtIndex(selectedSystem.id, r.id, idx)}>×</button>
                                                    </span>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                            <Button size="sm" variant="outline" className="h-8 text-sm px-2 shrink-0"
                                              onClick={() => setIduPicker({ roomId: r.id, roomName: r.name, reqTR, reqCFM })}>
                                              + Add IDU
                                            </Button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              ) : (selectedSystem.type === 'Package' || selectedSystem.type === 'DuctableSplit') ? (
                                // Multiple units per zone — different models allowed
                                <div className="bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 border border-slate-100 dark:border-slate-700 space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wide">
                                      {selectedSystem.type === 'Package' ? 'Package Units' : 'Indoor Units'}
                                    </span>
                                    <Button size="sm" variant="outline" className="h-5 text-xs px-1.5 gap-0.5 border-teal-300 text-teal-700 hover:bg-teal-50"
                                      onClick={() => setZoneMultiUnitPicker({ zoneId: zone.id, zoneName: zone.name, totalTR: zoneTR, totalCFM: zoneCFM, coilTR: zoneCoilTR, systemType: selectedSystem.type })}>
                                      + Add Unit
                                    </Button>
                                  </div>
                                  {(zone.unitSelections ?? []).length === 0 ? (
                                    <p className="text-xs text-slate-400 dark:text-slate-500 italic">No units selected — click + Add Unit</p>
                                  ) : (
                                    <div className="space-y-1">
                                      {(zone.unitSelections ?? []).map((u: IDUSelection, idx: number) => (
                                        <div key={idx} className="flex items-center gap-2 text-sm">
                                          <span className="flex-1 font-semibold text-emerald-700 dark:text-emerald-400">
                                            {u.brand} {u.modelSeries} · {u.trCapacity} TR
                                            {u.cfmRated > 0 && <span className="font-normal text-slate-500 dark:text-slate-400 ml-1">· {Math.round(u.cfmRated).toLocaleString()} CFM</span>}
                                          </span>
                                          <button className="text-slate-400 hover:text-red-500"
                                            onClick={() => void handleRemoveZoneUnit(zone.id, idx)}>
                                            <Trash2 className="w-3 h-3" />
                                          </button>
                                        </div>
                                      ))}
                                      <div className="text-xs text-slate-500 dark:text-slate-400 font-mono pt-0.5 border-t border-slate-100 dark:border-slate-700">
                                        Total: {(zone.unitSelections ?? []).reduce((s: number, u: IDUSelection) => s + u.trCapacity, 0).toFixed(1)} TR
                                        {zoneTR > 0 && <span className={cn('ml-2', (zone.unitSelections ?? []).reduce((s: number, u: IDUSelection) => s + u.trCapacity, 0) >= zoneTR ? 'text-emerald-600' : 'text-amber-600')}>
                                          (need {zoneTR.toFixed(1)} TR)
                                        </span>}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : null}

                              {/* ASHRAE 62.1 Zone OA — central air types only */}
                              {systemVent62 && (() => {
                                const zv = systemVent62.zones.find(z => z.zoneId === zone.id);
                                if (!zv) return null;
                                return (
                                  <div className="bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-lg px-3 py-2">
                                    <div className="flex items-center justify-between mb-1.5">
                                      <span className="text-sm font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">
                                        62.1 Zone OA
                                        {zv.isCritical && <span className="ml-1.5 text-sm font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">Critical Zone</span>}
                                      </span>
                                      <div className="flex items-center gap-1">
                                        <span className="text-xs text-slate-500 dark:text-slate-400">Ez:</span>
                                        <select
                                          value={zone.ezId ?? 'ceiling_cool'}
                                          onChange={e => void handleSetZoneEz(zone.id, e.target.value)}
                                          className="text-xs border border-sky-200 dark:border-sky-700 rounded px-1 py-0.5 bg-white dark:bg-slate-800 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-sky-400"
                                        >
                                          {EZ_OPTIONS.map(o => (
                                            <option key={o.id} value={o.id}>{o.label} (Ez={o.Ez})</option>
                                          ))}
                                        </select>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-4 gap-1.5 text-center">
                                      {[
                                        { label: 'Vbz (breathing zone)', value: `${Math.round(zv.Vbz)} cfm` },
                                        { label: 'Voz (zone OA)', value: `${Math.round(zv.Voz)} cfm`, highlight: true },
                                        { label: 'Vpz (supply)', value: `${Math.round(zv.Vpz)} cfm` },
                                        { label: 'Zpz (OA fraction)', value: `${(zv.Zpz * 100).toFixed(1)} %`, highlight: zv.isCritical },
                                      ].map(item => (
                                        <div key={item.label} className={cn('rounded px-1.5 py-1 border', item.highlight ? 'bg-sky-100 dark:bg-sky-900/30 border-sky-300 dark:border-sky-700' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700')}>
                                          <div className="text-xs text-slate-500 dark:text-slate-400 leading-tight">{item.label}</div>
                                          <div className={cn('text-sm font-bold font-mono mt-0.5', item.highlight ? 'text-sky-800 dark:text-sky-300' : 'text-slate-700 dark:text-slate-300')}>{item.value}</div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Unassigned rooms pool — only rooms that are (a) globally unassigned,
                        or (b) assigned to THIS system but not yet placed in any sub-zone.
                        Rooms belonging to OTHER systems are deliberately hidden. */}
                    {(() => {
                      const zoneRoomSet = new Set(((selectedSystem.zones ?? []) as EquipmentZone[]).flatMap((z: EquipmentZone) => z.roomIds));
                      const isInOtherSystem = (r: any) => {
                        const sysId = r.systemId ?? r.zoneId;
                        if (!sysId) return false;
                        if (sysId === selectedSystem.id) return false;
                        return equipSystems.some((s: any) => s.id === sysId);
                      };
                      const unassigned = rooms.filter((r: any) => !zoneRoomSet.has(r.id) && !isInOtherSystem(r));
                      if (unassigned.length === 0) return null;
                      return (
                        <div className="border-t border-dashed border-amber-200 dark:border-amber-800 p-3 bg-amber-50/40 dark:bg-amber-950/20">
                          <div className="text-sm font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-2">
                            Unassigned Rooms ({unassigned.length})
                          </div>
                          <div className="flex flex-wrap gap-1.5 mb-1.5">
                            {(unassigned as any[]).map((r: any) => (
                              <span key={r.id} className="text-sm px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 bg-white dark:bg-slate-800">
                                {r.name}
                                {r.floor && <span className="ml-1 text-xs text-amber-400 dark:text-amber-500">{r.floor}</span>}
                              </span>
                            ))}
                          </div>
                          {(selectedSystem.zones ?? []).length > 0 && (
                            <p className="text-xs text-amber-500 dark:text-amber-400 italic">Use &ldquo;+ Add Rooms&rdquo; inside a zone above to assign these rooms.</p>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Chiller: Plant-level equipment (Chiller units + CT) — after zones so user sizes terminal first */}
                  {selectedSystem.type === 'Chiller' && (
                    <div className="rounded-lg border border-blue-200 dark:border-blue-800 overflow-hidden">
                      <div className="bg-blue-50 dark:bg-blue-900/30 px-4 py-2.5 border-b border-blue-200 dark:border-blue-800 flex items-center justify-between gap-2">
                        <span className="text-sm font-bold uppercase text-blue-700 dark:text-blue-300 tracking-wide">Chiller Plant Equipment</span>
                      </div>
                      <div className="p-4 space-y-3">

                        {/* Diversity calculation */}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs items-center">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500 dark:text-slate-400">Σ Indoor Load:</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200">{chillerIndoorTR.toFixed(2)} TR</span>
                          </div>
                          <span className="text-slate-300 dark:text-slate-600">×</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500 dark:text-slate-400">Diversity:</span>
                            <input
                              key={`div-${selectedSystem.id}-${selectedSystem.diversityFactor ?? 0.75}`}
                              type="text" inputMode="decimal"
                              className="h-7 w-14 text-xs text-center p-1 rounded-md border border-input bg-transparent outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-input/30"
                              defaultValue={String(selectedSystem.diversityFactor ?? 0.75)}
                              onBlur={e => {
                                const n = parseFloat(e.target.value);
                                if (!Number.isFinite(n) || n <= 0 || n > 1) {
                                  e.target.value = String(selectedSystem.diversityFactor ?? 0.75);
                                  return;
                                }
                                void updateSystemField(selectedSystem.id, { diversityFactor: n });
                              }}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            />
                            <span className="font-bold text-indigo-700 dark:text-indigo-400">{chillerDiverseTR.toFixed(2)} TR</span>
                            <span className="text-slate-400 dark:text-slate-500 italic">{(chillerOaTR > 0.005 || chillerTfaCoilTR > 0.005) ? 'indoor (diversified)' : 'plant capacity required'}</span>
                          </div>
                          {chillerOaTR > 0.005 && (
                            <>
                              <span className="text-slate-300 dark:text-slate-600">+</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-teal-600 dark:text-teal-400">Fresh air (OA):</span>
                                <span className="font-bold text-teal-700 dark:text-teal-300">{chillerOaTR.toFixed(2)} TR</span>
                                <span className="text-slate-400 dark:text-slate-500 italic">non-diverse</span>
                              </div>
                            </>
                          )}
                          {chillerTfaCoilTR > 0.005 && (
                            <>
                              <span className="text-slate-300 dark:text-slate-600">+</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-teal-600 dark:text-teal-400">TFA coil (on this plant):</span>
                                <span className="font-bold text-teal-700 dark:text-teal-300">{chillerTfaCoilTR.toFixed(2)} TR</span>
                              </div>
                            </>
                          )}
                          {(chillerOaTR > 0.005 || chillerTfaCoilTR > 0.005) && (
                            <>
                              <span className="text-slate-300 dark:text-slate-600">=</span>
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-indigo-700 dark:text-indigo-400">{chillerPlantRequiredTR.toFixed(2)} TR</span>
                                <span className="text-slate-400 dark:text-slate-500 italic">plant capacity required</span>
                              </div>
                            </>
                          )}
                          {chillerTotalInstalledTR > 0 && (
                            <>
                              <span className="text-slate-300 dark:text-slate-600">→</span>
                              <span className={cn('font-semibold text-xs', chillerWorkingTR >= chillerPlantRequiredTR * 0.98 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                                Working: {chillerWorkingTR.toFixed(1)} TR
                                {chillerWorkingTR >= chillerPlantRequiredTR * 0.98 ? ' ✓' : ` (need ${(chillerPlantRequiredTR - chillerWorkingTR).toFixed(1)} TR more)`}
                              </span>
                              {chillerStandbyTR > 0 && (
                                <span className="font-semibold text-xs text-amber-600 dark:text-amber-400">
                                  + {chillerStandbyTR.toFixed(1)} TR Standby
                                </span>
                              )}
                            </>
                          )}
                        </div>

                        {/* IDU → Plant diversity check: installed plant vs connected indoor units */}
                        {chillerDiversityActive && (
                          <div className={cn(
                            'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mt-1.5 px-2.5 py-1.5 rounded-md border',
                            chillerOverDiversityLimit
                              ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300'
                              : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300',
                          )}>
                            <span className="font-semibold uppercase tracking-wide text-[10px]">Diversity Applied</span>
                            <span>Installed IDU: <strong>{chillerInstalledIduTR.toFixed(1)} TR</strong></span>
                            {chillerTfaCoilTR > 0.005
                              ? <span>/ Plant (working): <strong>{chillerPlantSpaceTR.toFixed(1)} TR</strong> ({chillerWorkingTR.toFixed(1)} − {chillerTfaCoilTR.toFixed(1)} TFA)</span>
                              : <span>/ Plant (working): <strong>{chillerPlantSpaceTR.toFixed(1)} TR</strong></span>}
                            <span>= Diversity <strong>{chillerDiversityDisplayPct.toFixed(0)}%</strong></span>
                            {chillerOverDiversityLimit
                              ? <span className="inline-flex items-center gap-1 font-semibold"><AlertTriangle className="w-3.5 h-3.5" /> Exceeds 125% diversity limit</span>
                              : <span className="inline-flex items-center gap-1 font-semibold"><CheckCircle2 className="w-3.5 h-3.5" /> Within 125% limit</span>}
                          </div>
                        )}

                        {/* Chiller unit list */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Chillers:</span>
                            <Button size="sm" variant="default" className="h-8 text-xs px-3 gap-1.5 bg-indigo-600 hover:bg-indigo-700"
                              onClick={() => setUnitPicker(true)}>
                              <Plus className="w-3.5 h-3.5" /> Add Chiller
                            </Button>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                            <span className="font-semibold">Nom. TR</span> = catalog rating at AHRI 550/590 conditions.{' '}
                            <span className="font-semibold">Act. TR</span> = our minimum required capacity at this project's site conditions
                            (entering CW/air temp, LCW temp, altitude, fouling) — <span className="italic">OEM to confirm in technical proposal</span>.{' '}
                            Plant sizing uses <span className="font-semibold">Actual TR</span> when entered; leave blank to fall back to Nominal.
                          </p>
                          {effectiveChillerUnits.length === 0 ? (
                            <p className="text-sm text-slate-400 dark:text-slate-500 italic py-1">No chillers selected — click Add Chiller above.</p>
                          ) : (
                            <div className="space-y-2">
                              {effectiveChillerUnits.map((u, idx) => {
                                const isLegacy = ((selectedSystem as any).chillerUnits ?? []).length === 0;
                                return (
                                  <div key={idx} className="flex items-center gap-3 bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-800 rounded-md px-3 py-2">
                                    {/* Quantity stepper */}
                                    <div className="inline-flex items-center gap-1 shrink-0">
                                      <button onClick={() => void updateChillerUnitQty(selectedSystem.id, idx, u.quantity - 1)}
                                        className="w-6 h-7 rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 flex items-center justify-center text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40"
                                        disabled={u.quantity <= 1}>−</button>
                                      <span className="w-6 text-center text-sm font-bold font-mono text-indigo-700 dark:text-indigo-400">{u.quantity}</span>
                                      <button onClick={() => void updateChillerUnitQty(selectedSystem.id, idx, u.quantity + 1)}
                                        className="w-6 h-7 rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 flex items-center justify-center text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-700">+</button>
                                    </div>
                                    <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 flex-1 flex flex-wrap items-center gap-1.5">
                                      <span>{u.brand} {u.modelSeries}</span>
                                      <span className="text-slate-500 dark:text-slate-400">·</span>
                                      <span title="Nominal TR — OEM catalog rating at AHRI 550/590 standard conditions">
                                        Nom. <span className="font-mono">{u.trCapacity}</span> TR
                                      </span>
                                      <span className="text-slate-500 dark:text-slate-400">·</span>
                                      <span className="inline-flex items-center gap-1" title="Actual TR — minimum required capacity at this project's site conditions. OEM must confirm in technical proposal. Plant sizing uses this when entered.">
                                        Act.
                                        <input
                                          type="text" inputMode="decimal"
                                          className="w-14 h-6 rounded border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-slate-900 px-1.5 text-xs font-mono text-indigo-700 dark:text-indigo-400 text-right focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                          defaultValue={u.actualTR != null ? String(u.actualTR) : ''}
                                          placeholder={String(u.trCapacity)}
                                          onBlur={(e) => void updateChillerUnitActualTR(selectedSystem.id, idx, e.target.value)}
                                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                          disabled={isLegacy}
                                        />
                                        TR
                                      </span>
                                      {u.quantity > 1 && <span className="text-indigo-700 dark:text-indigo-400 font-bold">= {(effTR(u) * u.quantity).toFixed(1)} TR total</span>}
                                      {isLegacy && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">legacy</span>}
                                    </span>
                                    {/* Working / Standby role toggle — only for new (non-legacy) units */}
                                    {!isLegacy && (
                                      <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden shrink-0 text-xs font-semibold">
                                        <button
                                          onClick={() => void updateChillerUnitRole(selectedSystem.id, idx, 'working')}
                                          className={cn('px-2 py-1 transition-colors', (u.role ?? 'working') === 'working'
                                            ? 'bg-emerald-500 text-white'
                                            : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20')}>
                                          Working
                                        </button>
                                        <button
                                          onClick={() => void updateChillerUnitRole(selectedSystem.id, idx, 'standby')}
                                          className={cn('px-2 py-1 transition-colors border-l border-slate-200 dark:border-slate-700', u.role === 'standby'
                                            ? 'bg-amber-500 text-white'
                                            : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-amber-50 dark:hover:bg-amber-950/20')}>
                                          Standby
                                        </button>
                                      </div>
                                    )}
                                    <button className="text-slate-400 hover:text-red-500 shrink-0 p-1"
                                      onClick={() => void removeChillerUnit(selectedSystem.id, idx)}>
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* CT section (WC only) */}
                        {(selectedSystem.condenserType === 'water-cooled' || selectedSystem.packageSubType === 'water-cooled' || ['Chiller WC', 'Chiller+AHU', 'Chiller+FCU'].includes(hvacSystemCategory)) && (
                          <div className="space-y-2 border-t border-blue-100 dark:border-blue-900/40 pt-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Cooling Towers:</span>
                                {ctTotalInstalledTR > 0 && (
                                  <>
                                    <span className={cn('text-xs font-semibold', ctWorkingTR >= ctRequiredTR * 0.98 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                                      {ctWorkingTR.toFixed(1)} TR Working
                                      {ctWorkingTR >= ctRequiredTR * 0.98 ? ' ✓' : ` · need ${(ctRequiredTR - ctWorkingTR).toFixed(1)} TR more`}
                                    </span>
                                    {ctStandbyTR > 0 && (
                                      <span className="font-semibold text-xs text-amber-600 dark:text-amber-400">
                                        + {ctStandbyTR.toFixed(1)} TR Standby
                                      </span>
                                    )}
                                  </>
                                )}
                                <span className="text-xs text-slate-400 dark:text-slate-500 italic">duty ≈ {ctRequiredTR.toFixed(1)} TR</span>
                              </div>
                              <Button size="sm" variant="outline"
                                className="h-8 text-xs px-3 gap-1.5 border-cyan-300 dark:border-cyan-700 text-cyan-700 dark:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-950/20 shrink-0"
                                onClick={() => { setCtForm({ brand: '', modelSeries: '', trCapacity: 0, quantity: 1 }); setCtFormOpen(true); }}>
                                <Plus className="w-3.5 h-3.5" /> Add CT
                              </Button>
                            </div>
                            {effectiveCTUnits.length === 0 ? (
                              <p className="text-sm text-slate-400 dark:text-slate-500 italic py-1">No cooling towers selected — click Add CT above.</p>
                            ) : (
                              <div className="space-y-2">
                                {effectiveCTUnits.map((u, idx) => {
                                  const isLegacyCT = ((selectedSystem as any).ctUnits ?? []).length === 0;
                                  return (
                                    <div key={idx} className="flex items-center gap-3 bg-white dark:bg-slate-800 border border-cyan-200 dark:border-cyan-800 rounded-md px-3 py-2">
                                      <div className="inline-flex items-center gap-1 shrink-0">
                                        <button onClick={() => void updateCTUnitQty(selectedSystem.id, idx, u.quantity - 1)}
                                          className="w-6 h-7 rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 flex items-center justify-center text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40"
                                          disabled={u.quantity <= 1}>−</button>
                                        <span className="w-6 text-center text-sm font-bold font-mono text-cyan-700 dark:text-cyan-400">{u.quantity}</span>
                                        <button onClick={() => void updateCTUnitQty(selectedSystem.id, idx, u.quantity + 1)}
                                          className="w-6 h-7 rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 flex items-center justify-center text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-700">+</button>
                                      </div>
                                      <span className="text-sm font-semibold text-cyan-700 dark:text-cyan-400 flex-1 flex flex-wrap items-center gap-1.5">
                                        <span>{u.brand} {u.modelSeries} · {u.trCapacity} TR each</span>
                                        {u.quantity > 1 && <span className="text-blue-600 dark:text-blue-400 font-bold">= {(u.trCapacity * u.quantity).toFixed(0)} TR total</span>}
                                        {isLegacyCT && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">legacy</span>}
                                      </span>
                                      {/* Working / Standby role toggle — only for new (non-legacy) units */}
                                      {!isLegacyCT && (
                                        <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden shrink-0 text-xs font-semibold">
                                          <button
                                            onClick={() => void updateCTUnitRole(selectedSystem.id, idx, 'working')}
                                            className={cn('px-2 py-1 transition-colors', (u.role ?? 'working') === 'working'
                                              ? 'bg-emerald-500 text-white'
                                              : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20')}>
                                            Working
                                          </button>
                                          <button
                                            onClick={() => void updateCTUnitRole(selectedSystem.id, idx, 'standby')}
                                            className={cn('px-2 py-1 transition-colors border-l border-slate-200 dark:border-slate-700', u.role === 'standby'
                                              ? 'bg-amber-500 text-white'
                                              : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-amber-50 dark:hover:bg-amber-950/20')}>
                                            Standby
                                          </button>
                                        </div>
                                      )}
                                      <button className="text-slate-400 hover:text-red-500 shrink-0 p-1"
                                        onClick={() => void removeCTUnit(selectedSystem.id, idx)}>
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* AHU DX: Condensing unit selection — multi-unit */}
                  {selectedSystem.type === 'AHU' && (() => {
                    const ahuUnits: SingleUnitSelection[] = (selectedSystem as any).ahuUnits?.length
                      ? (selectedSystem as any).ahuUnits
                      : selectedSystem.unitSelection ? [selectedSystem.unitSelection] : [];
                    const installedAHU_TR = ahuUnits.reduce((s, u) => s + u.trCapacity * (u.quantity ?? 1), 0);
                    const ahuFit = installedAHU_TR > 0
                      ? installedAHU_TR >= totalRequiredTR * 0.97 ? 'ok' : 'low'
                      : 'none';
                    return (
                    <div className="rounded-lg border border-sky-200 dark:border-sky-800 overflow-hidden">
                      <div className="bg-sky-50 dark:bg-sky-900/30 px-4 py-2.5 border-b border-sky-200 dark:border-sky-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Wind className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                          <span className="text-sm font-bold uppercase tracking-wide text-sky-600 dark:text-sky-400">DX Condensing Unit(s)</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                          <span>Req: <span className="font-bold text-slate-700 dark:text-slate-300">{totalRequiredTR.toFixed(2)} TR</span></span>
                          {installedAHU_TR > 0 && (
                            <span className={ahuFit === 'ok' ? 'font-semibold text-green-600 dark:text-green-400' : 'font-semibold text-red-500 dark:text-red-400'}>
                              {installedAHU_TR.toFixed(2)} TR installed {ahuFit === 'ok' ? '✓' : '⚠'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="p-4 space-y-3">
                        {ahuUnits.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {ahuUnits.map((u, idx) => (
                              <span key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-300 text-sm font-medium">
                                {(u.quantity ?? 1) > 1 && <span className="text-blue-600 dark:text-blue-400 font-bold">{u.quantity}×</span>}
                                {u.brand} {u.modelSeries} · {u.trCapacity} TR
                                {u.staticPressurePa && <span className="text-orange-600 dark:text-orange-400 text-xs ml-0.5">{paToMmWg(u.staticPressurePa)} mm WG</span>}
                                <div className="inline-flex items-center gap-0.5 ml-1 border-l border-sky-200 dark:border-sky-700 pl-1">
                                  <button className="w-4 h-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs flex items-center justify-center" onClick={() => updateAHUUnitQty(selectedSystem.id, idx, (u.quantity ?? 1) - 1)} disabled={(u.quantity ?? 1) <= 1}>−</button>
                                  <span className="w-4 text-center text-xs font-bold">{u.quantity ?? 1}</span>
                                  <button className="w-4 h-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs flex items-center justify-center" onClick={() => updateAHUUnitQty(selectedSystem.id, idx, (u.quantity ?? 1) + 1)}>+</button>
                                </div>
                                <button className="text-sky-400 hover:text-red-500 ml-0.5" onClick={() => void removeAHUUnit(selectedSystem.id, idx)}>×</button>
                              </span>
                            ))}
                          </div>
                        )}
                        <Button variant="outline" className="gap-2 border-sky-300 text-sky-700 hover:bg-sky-50" onClick={() => setUnitPicker(true)}>
                          <Plus className="w-4 h-4" />
                          {ahuUnits.length > 0 ? '+ Add Another Condensing Unit' : 'Select DX Condensing Unit'}
                        </Button>
                      </div>
                    </div>
                    );
                  })()}

                  {/* Split: flat room → unit list (no zone level) */}
                  {selectedSystem.type === 'Split' && (
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                      <div className="bg-slate-50 dark:bg-slate-800 px-4 py-2.5 border-b dark:border-slate-700 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wide">Rooms & Units</span>
                          <span className="text-xs text-slate-400 dark:text-slate-500">{rooms.length} rooms</span>
                        </div>
                      </div>
                      {rooms.length === 0 ? (
                        <p className="text-xs text-slate-400 dark:text-slate-500 p-4">No rooms found — create rooms in Load Calculator first.</p>
                      ) : (
                        <div className="divide-y divide-slate-100 dark:divide-slate-700">
                          {(rooms as any[]).map((room: any) => {
                            const reqs = getRoomReqs(room.id);
                            // Governing (max summer/monsoon) — the season the unit must satisfy.
                            const reqTR  = reqs.overallRequiredTR || reqs.requiredTR;
                            const reqCFM = reqs.overallDesignCFM || reqs.designCFM;
                            const units: IDUSelection[] = (selectedSystem.roomSelections ?? {})[room.id] ?? [];
                            const totalUnitTR = units.reduce((s, u) => s + u.trCapacity, 0);
                            const fits = totalUnitTR >= reqTR * 0.98;
                            return (
                              <div key={room.id} className="p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{room.name}</span>
                                    {room.floor && <span className="text-xs text-slate-400 dark:text-slate-500">{room.floor}</span>}
                                    {reqTR > 0 && (
                                      <span className="text-sm font-mono text-slate-500 dark:text-slate-400">{reqTR.toFixed(2)} TR req.</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {units.length > 0 && (
                                      <span className={cn('text-sm font-mono font-semibold', fits ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                                        {totalUnitTR.toFixed(1)} TR fitted
                                      </span>
                                    )}
                                    <Button size="sm" variant="outline" className="h-8 text-sm px-2 gap-0.5 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20"
                                      onClick={() => setRoomUnitPicker({ roomId: room.id, roomName: room.name, reqTR, reqCFM })}>
                                      + Add Unit
                                    </Button>
                                  </div>
                                </div>
                                {units.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {units.map((u: IDUSelection, idx: number) => (
                                      <span key={idx} className="inline-flex items-center gap-1.5 text-sm px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
                                        {u.brand} {u.modelSeries} · {u.trCapacity} TR
                                        <button className="text-emerald-400 hover:text-red-500"
                                          onClick={() => void handleRemoveRoomUnit(room.id, idx)}>×</button>
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Psychrometric Analysis */}
                  {systemPsychro && systemPsychro.totalBTUH > 0 && (
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                      <div className="bg-slate-50 dark:bg-slate-800 px-4 py-2.5 border-b dark:border-slate-700 flex items-center gap-2">
                        <Droplets className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                        <span className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wide">Psychrometric Analysis</span>
                        {systemPsychro.hasEstimates && (
                          <span className="text-xs italic text-amber-600 dark:text-amber-400 ml-1">· estimated (save rooms in Load Calculator for exact values)</span>
                        )}
                      </div>
                      <div className="p-4 space-y-4">
                        {/* Load summary row */}
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                          <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-100 dark:border-orange-900/40 rounded-lg px-3 py-2">
                            <div className="text-sm font-semibold uppercase text-orange-600 dark:text-orange-400 mb-0.5">Sensible</div>
                            <div className="font-bold text-orange-800 dark:text-orange-300">{Math.round(systemPsychro.totalSen).toLocaleString()} BTU/h</div>
                            <div className="text-xs text-orange-500 dark:text-orange-400">{(systemPsychro.totalSen / 12000).toFixed(2)} TR</div>
                          </div>
                          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-lg px-3 py-2">
                            <div className="text-sm font-semibold uppercase text-blue-600 dark:text-blue-400 mb-0.5">Latent</div>
                            <div className="font-bold text-blue-800 dark:text-blue-300">{Math.round(systemPsychro.totalLat).toLocaleString()} BTU/h</div>
                            <div className="text-xs text-blue-500 dark:text-blue-400">{(systemPsychro.totalLat / 12000).toFixed(2)} TR</div>
                          </div>
                          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                            <div className="text-sm font-semibold uppercase text-amber-700 dark:text-amber-300 mb-0.5">
                              {selectedSystem.type === 'Chiller' ? 'Cooling Load' : 'Governing TR'}
                            </div>
                            <div className="font-bold text-amber-900 dark:text-amber-300">
                              {selectedSystem.type === 'Chiller'
                                ? chillerThermalTR.toFixed(2)
                                : totalRequiredTR.toFixed(2)} TR
                            </div>
                            <div className="text-xs text-amber-600 dark:text-amber-400">
                              {selectedSystem.type === 'Chiller'
                                ? <>{includeMonsoon && <span className="mr-1">{governingSeason} ·</span>}Plant (indoor ×{(selectedSystem.diversityFactor ?? 0.75).toFixed(2)} div.{(chillerOaTR > 0.005 || chillerTfaCoilTR > 0.005) ? ' + OA' : ''}): <span className="font-semibold text-indigo-700 dark:text-indigo-400">{chillerPlantRequiredTR.toFixed(1)} TR</span></>
                                : <>
                                    {includeMonsoon && <span className="mr-1">{governingSeason} ·</span>}
                                    {totalRequiredTR > totalSummerRequiredTR * 1.05 ? 'CFM governs' : 'Load governs'}
                                    {' · '}Summer: {totalSummerRequiredTR.toFixed(2)} TR
                                  </>
                              }
                            </div>
                          </div>
                          <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 rounded-lg px-3 py-2">
                            <div className="text-sm font-semibold uppercase text-emerald-600 dark:text-emerald-400 mb-0.5">SHR</div>
                            <div className="font-bold text-emerald-800 dark:text-emerald-300">{systemPsychro.shr.toFixed(2)}</div>
                            <div className="text-xs text-emerald-500 dark:text-emerald-400">{Math.round(systemPsychro.shr * 100)}% sensible</div>
                          </div>
                          <div className="bg-violet-50 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/40 rounded-lg px-3 py-2">
                            <div className="text-sm font-semibold uppercase text-violet-600 dark:text-violet-400 mb-0.5">
                              {selectedSystem.type === 'Chiller' ? 'Room Air Circ.' : 'Design CFM'}
                            </div>
                            <div className="font-bold text-violet-800 dark:text-violet-300">{Math.round(totalDesignCFM).toLocaleString()}</div>
                            <div className="text-xs text-violet-500 dark:text-violet-400">
                              {selectedSystem.type === 'Chiller' ? 'For AHU / FCU sizing' : 'w/o Reheat'}
                            </div>
                          </div>
                        </div>

                        {/* Seasonal load comparison — shown only when monsoon is enabled */}
                        {includeMonsoon && totalMonsoonRequiredTR > 0 && (
                          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400">Seasonal Comparison</span>
                              <span className={`px-1.5 py-0.5 rounded text-sm font-bold ${governingSeason === 'Monsoon' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'}`}>
                                {governingSeason} governs
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className={`rounded px-2.5 py-1.5 border ${governingSeason === 'Summer' ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700' : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600'}`}>
                                <div className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-0.5">Summer</div>
                                <div className={`font-bold text-sm ${governingSeason === 'Summer' ? 'text-amber-800 dark:text-amber-300' : 'text-slate-600 dark:text-slate-300'}`}>
                                  {totalSummerRequiredTR.toFixed(2)} TR
                                </div>
                                <div className="text-xs text-slate-400 dark:text-slate-500">{Math.round(totalSummerDesignCFM).toLocaleString()} CFM</div>
                              </div>
                              <div className={`rounded px-2.5 py-1.5 border ${governingSeason === 'Monsoon' ? 'bg-blue-50 dark:bg-blue-950/20 border-blue-300 dark:border-blue-700' : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600'}`}>
                                <div className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-0.5">Monsoon</div>
                                <div className={`font-bold text-sm ${governingSeason === 'Monsoon' ? 'text-blue-800 dark:text-blue-300' : 'text-slate-600 dark:text-slate-300'}`}>
                                  {totalMonsoonRequiredTR.toFixed(2)} TR
                                </div>
                                <div className="text-xs text-slate-400 dark:text-slate-500">{Math.round(totalMonsoonDesignCFM).toLocaleString()} CFM</div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Coil parameters — only for central air systems */}
                        {systemPsychro.coil && selectedSystem.type !== 'VRF' && selectedSystem.type !== 'Split' && (
                          <div className="rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-900/20 px-4 py-3">
                            <div className="text-sm font-bold uppercase text-sky-700 dark:text-sky-300 mb-2">
                              {selectedSystem.type === 'Chiller' ? 'Terminal Unit Coil Conditions' : 'Coil Conditions'} (BF = {systemPsychro.coil.bypassFactor})
                            </div>
                            <div className="flex flex-wrap gap-5 text-xs">
                              <div>
                                <span className="text-slate-500 dark:text-slate-400">Room conditions: </span>
                                <span className="font-semibold dark:text-slate-300">{systemPsychro.indoorTemp}°F / {systemPsychro.indoorRH}% RH</span>
                              </div>
                              <div>
                                <span className="text-slate-500 dark:text-slate-400">Coil ADP: </span>
                                <span className="font-bold text-sky-800 dark:text-sky-300">{systemPsychro.coil.selectedADP}°F</span>
                                {systemPsychro.coil.indicatedADP !== systemPsychro.coil.selectedADP && (
                                  <span className="text-slate-400 dark:text-slate-500 text-xs ml-1">(indicated {systemPsychro.coil.indicatedADP.toFixed(1)}°F)</span>
                                )}
                              </div>
                              {(systemPsychro.coil as any).supplyTemp != null && (
                                <div>
                                  <span className="text-slate-500 dark:text-slate-400">Supply air: </span>
                                  <span className="font-bold text-sky-800 dark:text-sky-300">{(systemPsychro.coil as any).supplyTemp}°F</span>
                                  {(systemPsychro.coil as any).supplyRH != null && (
                                    <span className="text-slate-500 dark:text-slate-400"> / {(systemPsychro.coil as any).supplyRH}% RH</span>
                                  )}
                                </div>
                              )}
                              <div>
                                <span className="text-slate-500 dark:text-slate-400">Dehumidified CFM: </span>
                                <span className="font-semibold dark:text-slate-300">{Math.round(systemPsychro.coil.dehumidifiedCFM).toLocaleString()}</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Moisture management sizing */}
                        {(systemPsychro.totalDehumidLbsHr > 0 || systemPsychro.totalHumidLbsHr > 0 || systemPsychro.totalReheatBTU > 0) && (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                            {systemPsychro.totalDehumidLbsHr > 0 && (
                              <div className="rounded-lg border border-cyan-200 dark:border-cyan-800 bg-cyan-50 dark:bg-cyan-950/20 px-3 py-2">
                                <div className="text-sm font-bold uppercase text-cyan-700 dark:text-cyan-300 mb-1">Dehumidifier Sizing</div>
                                <div className="font-bold text-cyan-900 dark:text-cyan-300">
                                  {(systemPsychro.totalDehumidLbsHr * 0.4536).toFixed(1)} kg/h
                                </div>
                                <div className="text-xs text-cyan-600 dark:text-cyan-400">
                                  {systemPsychro.totalDehumidLbsHr.toFixed(1)} lbs/hr moisture removal
                                </div>
                              </div>
                            )}
                            {systemPsychro.totalHumidLbsHr > 0 && (
                              <div className="rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/20 px-3 py-2">
                                <div className="text-sm font-bold uppercase text-sky-700 dark:text-sky-300 mb-1">Humidifier Sizing</div>
                                <div className="font-bold text-sky-900 dark:text-sky-300">
                                  {(systemPsychro.totalHumidLbsHr * 0.4536).toFixed(1)} kg/h
                                </div>
                                <div className="text-xs text-sky-600 dark:text-sky-400">
                                  {systemPsychro.totalHumidLbsHr.toFixed(1)} lbs/hr moisture addition
                                </div>
                              </div>
                            )}
                            {systemPsychro.totalReheatBTU > 0 && (
                              <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/20 px-3 py-2">
                                <div className="text-sm font-bold uppercase text-rose-700 dark:text-rose-300 mb-1">Reheat Coil Sizing</div>
                                <div className="font-bold text-rose-900 dark:text-rose-300">
                                  {Math.round(systemPsychro.totalReheatBTU).toLocaleString()} BTU/h
                                </div>
                                <div className="text-xs text-rose-600 dark:text-rose-400">
                                  {(systemPsychro.totalReheatBTU / 3412).toFixed(2)} kW HW coil capacity
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* ── Dehumidification strategy (system-level, zoneless only) ─────
                            Systems with zones render the strategy block per-zone inside the zone
                            (right under AHU Humidifier). This system-level row is the fallback for
                            zoneless systems (Package, DuctableSplit, single-unit Split, DOAS) so
                            the user can still pick a method + dehumidifier for the whole system.
                            HW coil and AHU electric heater methods are hidden here — no zone AHU. */}
                        {(() => {
                          const hasZones = ((selectedSystem.zones ?? (selectedSystem as any).ahuGroups ?? []) as EquipmentZone[]).length > 0;
                          if (hasZones) return null;
                          const sysUnits: DehumidifierUnit[] = (selectedSystem as any).dehumidifierUnits ?? [];
                          const sysMethod: DehumidMethod | null = (selectedSystem as any).dehumidMethod ?? null;
                          const sysReheatKWOverride: number | undefined = (selectedSystem as any).dehumidReheatKW;
                          if (systemTotalRoomDehumidLbsHr <= 0 && systemTotalReheatBTU <= 0 && !sysMethod && sysUnits.length === 0) return null;
                          return (
                            <DehumidificationStrategySection
                              scopeLabel={selectedSystem.name}
                              latentLbsHr={systemTotalRoomDehumidLbsHr}
                              reheatBTU={systemTotalReheatBTU}
                              method={sysMethod}
                              reheatKWOverride={sysReheatKWOverride}
                              units={sysUnits}
                              isVRF={selectedSystem.type === 'VRF'}
                              hasHeatingCoilInAHU={false}
                              isSystemLevel={true}
                              models={dehumidifierModels}
                              onChangeMethod={(m) => setSystemDehumidMethod(selectedSystem.id, m)}
                              onChangeReheatKWOverride={(kw) => setSystemDehumidReheatKW(selectedSystem.id, kw)}
                              onAddDehumidifier={(model) => addSystemDehumidifier(selectedSystem.id, model)}
                              onRemoveDehumidifier={(idx) => removeSystemDehumidifier(selectedSystem.id, idx)}
                              onUpdateDehumidifierQty={(idx, qty) => updateSystemDehumidifierQty(selectedSystem.id, idx, qty)}
                            />
                          );
                        })()}

                        {/* Per-room breakdown table */}
                        <details className="group">
                          <summary className="text-xs text-slate-400 dark:text-slate-500 cursor-pointer hover:text-slate-600 dark:hover:text-slate-300 select-none list-none flex items-center gap-1">
                            <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                            Room breakdown
                          </summary>
                          <div className="mt-2 overflow-x-auto">
                            <table className="w-full text-xs border-collapse">
                              <thead>
                                <tr className="text-xs text-slate-400 dark:text-slate-500 uppercase border-b dark:border-slate-700">
                                  <th className="text-left py-1 pr-3 font-semibold">Room</th>
                                  <th className="text-right py-1 px-2 font-semibold">Sensible BTU/h</th>
                                  <th className="text-right py-1 px-2 font-semibold">Latent BTU/h</th>
                                  <th className="text-right py-1 px-2 font-semibold">Load TR</th>
                                  {includeMonsoon && <th className="text-right py-1 px-2 font-semibold text-blue-500">Monsoon TR</th>}
                                  <th className="text-right py-1 px-2 font-semibold">Req. TR</th>
                                  <th className="text-right py-1 pl-2 font-semibold">SHR</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                {systemPsychro.roomBreakdown.map(rb => {
                                  const roomTotal = rb.sen + rb.lat;
                                  const roomSHR = roomTotal > 0 ? rb.sen / roomTotal : 0;
                                  const cfmDriven = rb.cfmTR > rb.loadTR * 1.05;
                                  const monsoonGoverns = includeMonsoon && (rb.monsoonReqTR ?? 0) > rb.summerReqTR * 1.01;
                                  return (
                                    <tr key={rb.id}>
                                      <td className="py-1 pr-3 font-medium dark:text-slate-300">
                                        {rb.name}
                                        {rb.zoneName && <span className="text-slate-400 dark:text-slate-500 text-xs ml-1">· {rb.zoneName}</span>}
                                      </td>
                                      <td className="text-right px-2 font-mono dark:text-slate-300">{Math.round(rb.sen).toLocaleString()}</td>
                                      <td className="text-right px-2 font-mono dark:text-slate-300">{Math.round(rb.lat).toLocaleString()}</td>
                                      <td className="text-right px-2 font-mono text-slate-600 dark:text-slate-400">{rb.loadTR.toFixed(2)}</td>
                                      {includeMonsoon && (
                                        <td className="text-right px-2 font-mono text-blue-600 dark:text-blue-400">
                                          {(rb.monsoonLoadTR ?? 0) > 0 ? (rb.monsoonLoadTR ?? 0).toFixed(2) : '—'}
                                        </td>
                                      )}
                                      <td className="text-right px-2 font-mono">
                                        <span className={monsoonGoverns ? 'text-blue-700 dark:text-blue-400 font-semibold' : cfmDriven ? 'text-amber-700 dark:text-amber-400 font-semibold' : 'dark:text-slate-300'}>
                                          {rb.reqTR.toFixed(2)}
                                        </span>
                                        {monsoonGoverns && <span className="text-xs text-blue-500 dark:text-blue-400 ml-1">(M↑)</span>}
                                        {!monsoonGoverns && cfmDriven && <span className="text-xs text-amber-500 dark:text-amber-400 ml-1">(CFM↑)</span>}
                                      </td>
                                      <td className="text-right pl-2 font-mono dark:text-slate-300">{roomSHR.toFixed(2)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      </div>
                    </div>
                  )}

                  {/* VRF: IDU table removed — IDU selection is now per-zone in the Zone Manager above */}
                  {false && selectedSystem.type === 'VRF' && (
                    <div className="rounded-lg border border-slate-200 overflow-hidden">
                      <div className="bg-slate-50 px-4 py-2.5 border-b flex items-center justify-between">
                        <span className="text-sm font-bold uppercase text-slate-500 tracking-wide">Indoor Units (IDU)</span>
                        <div className="flex items-center gap-2">
                          {!zoneMode && (
                            <Button size="sm" variant="outline" className="h-8 text-sm px-2 gap-1 border-teal-300 text-teal-700 hover:bg-teal-50"
                              onClick={() => { setZoneMode(true); setZoneSelected(new Set()); }}>
                              + Zone
                            </Button>
                          )}
                          {zoneMode && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-slate-500">{zoneSelected.size} selected</span>
                              <Button size="sm" className="h-8 text-sm px-2 bg-teal-600 hover:bg-teal-700"
                                onClick={createZone} disabled={zoneSelected.size < 2}>Create Zone</Button>
                              <Button size="sm" variant="ghost" className="h-8 text-sm px-2"
                                onClick={() => { setZoneMode(false); setZoneSelected(new Set()); }}>Cancel</Button>
                            </div>
                          )}
                          {!zoneMode && (
                            <span className="text-xs text-slate-400">
                              {Object.keys(selectedSystem.iduSelections).length} of {systemRoomIds.length} selected
                            </span>
                          )}
                          {!zoneMode && (
                            <span className="text-xs italic text-slate-400">Set Qty for rooms needing multiple IDUs (e.g. banquet hall)</span>
                          )}
                        </div>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50/50 text-xs uppercase">
                            <TableHead>Room</TableHead>
                            <TableHead>Zone</TableHead>
                            <TableHead className="text-right">Req TR</TableHead>
                            <TableHead colSpan={2}>IDU Selected</TableHead>
                            <TableHead className="text-center">Fit</TableHead>
                            <TableHead className="w-[90px]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {/* Zone rows */}
                          {(selectedSystem.zones ?? (selectedSystem as any).ahuGroups ?? []).map((zone: EquipmentZone) => {
                            const zoneRooms = zone.roomIds
                              .map((id: string) => rooms.find((r: any) => r.id === id))
                              .filter(Boolean) as any[];
                            // Governing (max summer/monsoon) required TR & design CFM — the season
                            // the equipment must actually satisfy. Using the summer-only _calc*
                            // here under-sized monsoon-governing zones (picker + fit badge).
                            const totalTR = zoneRooms.reduce((s: number, r: any) => s + (Number(r._calcOverallRequiredTR ?? r._calcRequiredTR) || 0), 0);
                            const totalCFM = zoneRooms.reduce((s: number, r: any) => s + (r._calcTfaOnly ? 0 : (Number(r._calcOverallDesignCFM ?? r._calcDesignCFM) || 0)), 0);
                            return (
                              <React.Fragment key={zone.id}>
                                <TableRow className="bg-teal-50/60 border-t-2 border-teal-200">
                                  <TableCell colSpan={7} className="py-1.5 px-3">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold text-teal-700 uppercase tracking-wide">{zone.name}</span>
                                        <span className="text-xs text-teal-600">({zone.roomIds.length} rooms · {totalTR.toFixed(2)} TR combined)</span>
                                        <span className="text-xs text-slate-400">{zoneRooms.map((r: any) => r.name).join(', ')}</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {zone.selection ? (
                                          <span className="text-sm font-semibold text-emerald-700 flex items-center gap-1">
                                            {zone.selection.brand} {zone.selection.modelSeries} · {zone.selection.trCapacity} TR
                                            {zone.selection.isCustom && <span className="text-sm font-bold px-1 py-0.5 rounded bg-violet-100 text-violet-700 border border-violet-200">Custom</span>}
                                          </span>
                                        ) : null}
                                        <Button size="sm" variant={zone.selection ? 'outline' : 'default'} className="h-8 text-sm px-2"
                                          onClick={() => setZonePicker({ zoneId: zone.id, zoneName: zone.name, totalTR, totalCFM, systemType: selectedSystem.type })}>
                                          {zone.selection ? 'Change IDU/AHU' : 'Select IDU/AHU'}
                                        </Button>
                                        <Button size="sm" variant="ghost" className="h-7 w-6 p-0 text-slate-400 hover:text-red-500"
                                          onClick={() => deleteZone(selectedSystem.id, zone.id)}>
                                          <Trash2 className="w-3 h-3" />
                                        </Button>
                                      </div>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              </React.Fragment>
                            );
                          })}
                          {systemRoomIds
                            .filter(roomId => !(selectedSystem.zones ?? (selectedSystem as any).ahuGroups ?? []).some((z: EquipmentZone) => z.roomIds.includes(roomId)))
                            .map(roomId => {
                            const room    = rooms.find(r => r.id === roomId);
                            const reqs    = getRoomReqs(roomId);
                            // Governing (max summer/monsoon) — the season the unit must satisfy.
                            const reqTR   = reqs.overallRequiredTR || reqs.requiredTR;
                            const reqCFM  = reqs.overallDesignCFM || reqs.designCFM;
                            const qty     = roomQuantities[roomId] ?? 1;
                            const trPerUnit = reqTR > 0 ? reqTR / qty : 0;
                            const cfmPerUnit = reqCFM > 0 ? reqCFM / qty : 0;
                            const idus  = normalizeIDUList((selectedSystem.iduSelections as any)[roomId]);
                            const totalInstalledTR = idus.reduce((s, u) => s + u.trCapacity * (u.quantity ?? 1), 0);
                            const fit   = idus.length > 0 ? getFitStatus(totalInstalledTR, 0, reqTR, 0) : 'unknown';
                            return room ? (
                              <TableRow key={roomId}
                                className={cn(idus.length === 0 && 'bg-amber-50/30', zoneMode && zoneSelected.has(roomId) && 'bg-teal-50')}
                                onClick={zoneMode ? () => {
                                  setZoneSelected(prev => {
                                    const next = new Set(prev);
                                    if (next.has(roomId)) next.delete(roomId); else next.add(roomId);
                                    return next;
                                  });
                                } : undefined}
                                style={zoneMode ? { cursor: 'pointer' } : undefined}
                              >
                                <TableCell className="font-medium text-xs">
                                  <div className="flex items-center gap-2">
                                    {zoneMode && (
                                      <div className={cn('w-4 h-4 rounded border-2 flex items-center justify-center shrink-0',
                                        zoneSelected.has(roomId) ? 'bg-teal-600 border-teal-600' : 'border-slate-300')}>
                                        {zoneSelected.has(roomId) && <span className="text-white text-sm font-bold">✓</span>}
                                      </div>
                                    )}
                                    {room?.name ?? roomId}
                                  </div>
                                </TableCell>
                                <TableCell className="text-xs text-slate-400">{room?.zoneName ?? '—'}</TableCell>
                                <TableCell className="text-right font-mono text-sm">{reqTR > 0 ? reqTR.toFixed(2) : '—'}</TableCell>
                                <TableCell className="text-xs" colSpan={2}>
                                  {idus.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {idus.map((u, idx) => (
                                        <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
                                          {(u.quantity ?? 1) > 1 && <span className="text-blue-600 font-bold">{u.quantity}×</span>}
                                          {u.brand} {u.modelSeries} · {u.trCapacity} TR
                                          {u.isCustom && <span className="ml-0.5 px-1 rounded bg-violet-100 text-violet-700 border border-violet-200 text-[10px]">Custom</span>}
                                          <button className="text-emerald-400 hover:text-red-500 ml-0.5" onClick={() => void removeIDUAtIndex(selectedSystem.id, roomId, idx)}>×</button>
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-amber-600 italic">Not selected</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-center">{idus.length > 0 && <FitBadge status={fit} />}</TableCell>
                                <TableCell>
                                  <div className="flex gap-1 justify-end">
                                    <Button size="sm" variant="outline" className="h-8 text-sm px-2"
                                      onClick={() => setIduPicker({ roomId, roomName: room?.name ?? roomId, reqTR, reqCFM })}>
                                      + Add IDU
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ) : null;
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {/* VRF: ODU Summary + Selection */}
                  {selectedSystem.type === 'VRF' && ((selectedSystem.zones ?? []) as EquipmentZone[]).some((z: EquipmentZone) => z.roomIds.length > 0) && (
                    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/20 overflow-hidden">
                      <div className="bg-blue-50 dark:bg-blue-900/30 px-4 py-2.5 border-b border-blue-200 dark:border-blue-800 flex items-center gap-2">
                        <Zap className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span className="text-sm font-bold uppercase text-blue-600 dark:text-blue-400 tracking-wide">Outdoor Unit (ODU)</span>
                      </div>
                      <div className="p-4 space-y-3">
                        {/* Diversity calculation */}
                        <div className="flex flex-wrap gap-4 text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500 dark:text-slate-400">Σ IDU capacity:</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200">{totalIDU_TR.toFixed(2)} TR</span>
                          </div>
                          <span className="text-slate-300 dark:text-slate-600">×</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500 dark:text-slate-400">Diversity {selectedSystem.diversityFactor ?? 0.75}:</span>
                            <span className="font-bold text-blue-700 dark:text-blue-400">{requiredODU_TR.toFixed(2)} TR required</span>
                          </div>
                          {oduCapTR > 0 && (
                            <>
                              <span className="text-slate-300 dark:text-slate-600">→</span>
                              <div className={cn('flex items-center gap-1.5', connOK ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                                <span>Connection ratio: {connectionPct.toFixed(0)}%</span>
                                <span className="text-xs italic">(50–130% allowed)</span>
                                {connOK ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                              </div>
                            </>
                          )}
                        </div>

                        {/* ODU card or CTA */}
                        {selectedSystem.oduSelection ? (
                          <div className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-800">
                            <div>
                              {selectedSystem.oduSelection.combination && selectedSystem.oduSelection.combination.length > 1 ? (
                                <>
                                  <span className="font-bold text-sm text-slate-800 dark:text-slate-200">
                                    {selectedSystem.oduSelection.combination.length}-Unit ODU Combination
                                  </span>
                                  <div className="mt-1 space-y-0.5">
                                    {selectedSystem.oduSelection.combination.map((u, i) => (
                                      <div key={i} className="text-sm text-slate-600 dark:text-slate-400">
                                        {u.quantity > 1 ? `${u.quantity} × ` : ''}{u.brand} {u.modelSeries} — {u.trCapacity} TR
                                      </div>
                                    ))}
                                    <div className="text-sm font-bold text-purple-700 dark:text-purple-400 mt-0.5">
                                      Total: {selectedSystem.oduSelection.effectiveTR ?? oduCapTR} TR
                                    </div>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <span className="font-bold text-sm text-slate-800 dark:text-slate-200">
                                    {selectedSystem.oduSelection.modules && selectedSystem.oduSelection.modules > 1
                                      ? `${selectedSystem.oduSelection.modules} × `
                                      : ''}
                                    {selectedSystem.oduSelection.brand} {selectedSystem.oduSelection.modelSeries}
                                    {selectedSystem.oduSelection.isCustom && (
                                      <span className="ml-1.5 text-sm font-bold px-1 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-700">Custom</span>
                                    )}
                                  </span>
                                  <div className="flex gap-3 text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                                    {selectedSystem.oduSelection.modules && selectedSystem.oduSelection.modules > 1 ? (
                                      <span className="font-semibold text-purple-700 dark:text-purple-400">
                                        {selectedSystem.oduSelection.trCapacity} TR × {selectedSystem.oduSelection.modules} = {selectedSystem.oduSelection.effectiveTR ?? selectedSystem.oduSelection.trCapacity * selectedSystem.oduSelection.modules} TR
                                      </span>
                                    ) : (
                                      <span>{selectedSystem.oduSelection.trCapacity} TR</span>
                                    )}
                                    <span className="capitalize">{selectedSystem.oduSelection.dischargeType} discharge</span>
                                    <span className="capitalize">{selectedSystem.oduSelection.compressorType === 'heat-pump' ? 'Heat Pump' : 'Cooling Only'}</span>
                                  </div>
                                </>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" className="h-8 text-sm" onClick={() => setOduPicker(true)}>Change</Button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-600" onClick={() => removeODU(selectedSystem.id)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button variant="outline" className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
                            disabled={totalIDU_TR === 0}
                            onClick={() => setOduPicker(true)}>
                            <Plus className="w-4 h-4" /> Select ODU
                            {totalIDU_TR === 0 && <span className="text-xs italic text-slate-400 dark:text-slate-500 ml-1">(add IDUs first)</span>}
                          </Button>
                        )}

                        {oduCapTR > 0 && !connOK && (
                          <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Connection ratio {connectionPct.toFixed(0)}% is outside 50–130%. Select a different ODU or adjust IDU count.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Equipment Specification Sheet ── */}
                  {selectedSystem && (() => {
                    const showSpec = ['AHU', 'Chiller', 'Package', 'DuctableSplit'].includes(selectedSystem.type) ||
                      (selectedSystem.type === 'VRF' && ((selectedSystem.zones ?? []) as EquipmentZone[]).some(z => FAHU_CAPABLE_SUBTYPES.has(z.selection?.subType ?? '')));
                    if (!showSpec) return null;
                    const vrfAHUZones = selectedSystem.type === 'VRF'
                      ? ((selectedSystem.zones ?? []) as EquipmentZone[]).filter(z => FAHU_CAPABLE_SUBTYPES.has(z.selection?.subType ?? ''))
                      : [];
                    const specAhuConfig: AHUConfig = (() => {
                      if (selectedSystem.type === 'VRF') {
                        const firstZone = vrfAHUZones[0];
                        return firstZone?.ahuConfig ?? DEFAULT_AHU_CONFIG;
                      }
                      const base: AHUConfig = (selectedSystem as any).ahuConfig ?? DEFAULT_AHU_CONFIG;
                      const anyZoneHasHeat = ((selectedSystem.zones ?? []) as EquipmentZone[]).some(z => z.selection?.coilType === 'cooling-heating');
                      return anyZoneHasHeat ? { ...base, hasHeatingCoil: true } : base;
                    })();
                    const specAHUSelections: SingleUnitSelection[] = (() => {
                      if (selectedSystem.type !== 'AHU') return [];
                      const arr: SingleUnitSelection[] = (selectedSystem as any).ahuUnits ?? [];
                      if (arr.length > 0) return arr;
                      return selectedSystem.unitSelection ? [selectedSystem.unitSelection] : [];
                    })();
                    const specPackageUnit = (selectedSystem.type === 'Package' || selectedSystem.type === 'DuctableSplit')
                      ? (selectedSystem.unitSelection ?? null)
                      : null;
                    return (
                    <SpecSheet
                      system={selectedSystem}
                      project={project}
                      systemPsychro={systemPsychro}
                      totalRequiredTR={totalRequiredTR}
                      totalDesignCFM={totalDesignCFM}
                      hvacCategory={hvacSystemCategory}
                      systemNeedsHumidifier={!!(systemPsychro && systemPsychro.totalHumidLbsHr > 0) || systemHasHumidifierFlag}
                      humidifierCapacityKgHr={
                        systemPsychro && systemPsychro.totalHumidLbsHr > 0
                          ? systemPsychro.totalHumidLbsHr * 0.4536
                          : systemHasHumidifierFlag ? totalDesignCFM * 0.0002 : 0
                      }
                      systemOACFM={totalSystemOACFM}
                      ahuConfig={specAhuConfig}
                      systemVentHeatingKW={systemVentHeatingKW}
                      systemReheatKW={(systemPsychro?.totalReheatBTU ?? 0) / 3412}
                      chillerPlantTR={selectedSystem.type === 'Chiller' ? chillerPlantRequiredTR : 0}
                      zoneUnits={zoneUnitsForSpec}
                      selectedChillerUnits={selectedSystem.type === 'Chiller' ? effectiveChillerUnits : undefined}
                      selectedCTUnits={selectedSystem.type === 'Chiller' ? effectiveCTUnits : undefined}
                      selectedPackageUnit={specPackageUnit}
                      selectedAHUUnits={specAHUSelections}
                      onSave={async (spec) => {
                        await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', selectedSystem.id), {
                          customSpec: spec,
                          updatedAt: serverTimestamp(),
                        });
                      }}
                    />
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Summary Tab ── */}
        <TabsContent value="summary" className="w-full space-y-8">

          {/* System Status Table */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">System Load Summary</h3>
                <p className="text-slate-500 dark:text-slate-400 text-xs">Required TR from Load Calculator's saved loads. Edit rooms / conditions in Load Calculator to update these.</p>
              </div>
              <span className="text-sm text-slate-400 dark:text-slate-500">{equipSystems.length} system{equipSystems.length !== 1 ? 's' : ''}</span>
            </div>
            {equipSystems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400 dark:text-slate-500 gap-2 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700">
                <Wind className="w-8 h-8 opacity-20" />
                <p className="text-sm font-medium">No systems yet</p>
                <p className="text-xs">Create systems in the System Design tab first.</p>
              </div>
            ) : (
              <div className="w-full rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
                <Table className="w-full">
                  <TableHeader>
                    <TableRow className="bg-slate-50 dark:bg-slate-800 text-xs uppercase">
                      <TableHead className="w-8">#</TableHead>
                      <TableHead className="w-full">System</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Rooms</TableHead>
                      <TableHead className="text-right">Required TR</TableHead>
                      <TableHead className="text-right">Installed TR</TableHead>
                      <TableHead className="text-right">Coverage</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-10 text-center"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {systemSummaries.map((s, idx) => {
                      const coverage = s.requiredTR > 0 && s.installedTR > 0 ? (s.installedTR / s.requiredTR) * 100 : 0;
                      return (
                        <TableRow key={s.id}
                          className="text-xs hover:bg-blue-50/40 dark:hover:bg-blue-950/20 cursor-pointer transition-colors"
                          onClick={() => { setSelectedSystemId(s.id); setActiveTab('systems'); }}>
                          <TableCell className="text-slate-400 dark:text-slate-500 font-mono">{idx + 1}</TableCell>
                          <TableCell className="font-semibold text-slate-800 dark:text-slate-200">{s.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn('text-xs',
                              s.type === 'VRF'           ? 'bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800' :
                              s.type === 'Chiller'       ? 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800' :
                              s.type === 'AHU'           ? 'bg-teal-50 dark:bg-teal-950/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800' :
                              s.type === 'Package' || s.type === 'DuctableSplit' ? 'bg-sky-50 dark:bg-sky-950/20 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800' :
                              s.type === 'Split'         ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' :
                              s.type === 'DOAS'          ? 'bg-teal-50 dark:bg-teal-950/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800' :
                              'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                            )}>
                              {s.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">{s.roomCount}</TableCell>
                          <TableCell className="text-right font-mono font-bold">
                            {s.requiredTR > 0 ? s.requiredTR.toFixed(2) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono font-bold">
                            {s.installedTR > 0 ? s.installedTR.toFixed(2) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                            {s.standbyTR > 0 && (
                              <span className="ml-1 text-[10px] font-normal text-slate-400 dark:text-slate-500">+{s.standbyTR.toFixed(0)} SB</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {coverage > 0 ? (
                              <span className={cn('font-mono text-sm',
                                coverage >= 97 && coverage <= 130 ? 'text-emerald-700 dark:text-emerald-400 font-bold' :
                                coverage < 97 ? 'text-red-600 dark:text-red-400 font-bold' : 'text-amber-600 dark:text-amber-400 font-bold'
                              )}>
                                {coverage.toFixed(0)}%
                              </span>
                            ) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                          </TableCell>
                          <TableCell>
                            {s.status === 'ok'           && <span className="text-sm font-bold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">✓ OK</span>}
                            {s.status === 'undersized'   && <span className="text-sm font-bold px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">⚠ Undersized</span>}
                            {s.status === 'no-equipment' && <span className="text-sm font-bold px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">✗ No Equipment</span>}
                            {s.status === 'no-rooms'     && <span className="text-xs text-slate-400 dark:text-slate-500 italic">— No Rooms</span>}
                          </TableCell>
                          <TableCell className="text-center">
                            <button
                              type="button"
                              title="Delete system"
                              className="w-7 h-7 rounded inline-flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                              onClick={e => {
                                e.stopPropagation();
                                if (window.confirm(`Delete system "${s.name}"? This removes the system and any equipment selections on it. Rooms assigned to this system will be unassigned but not deleted.`)) {
                                  void deleteSystem(s.id);
                                }
                              }}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {systemSummaries.length > 1 && (
                      <TableRow className="bg-slate-50 dark:bg-slate-800 text-sm font-bold border-t-2 border-slate-200 dark:border-slate-700">
                        <TableCell colSpan={3} className="text-slate-500 dark:text-slate-400 uppercase text-xs tracking-wide py-2">Project Total</TableCell>
                        <TableCell className="text-right font-mono py-2">{systemSummaries.reduce((s, x) => s + x.roomCount, 0)}</TableCell>
                        <TableCell className="text-right font-mono py-2">{systemSummaries.reduce((s, x) => s + x.requiredTR, 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono py-2">{systemSummaries.reduce((s, x) => s + x.installedTR, 0).toFixed(2)}</TableCell>
                        <TableCell colSpan={3} />
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                <p className="text-xs text-slate-400 dark:text-slate-500 px-4 py-2 border-t border-slate-100 dark:border-slate-700 italic">
                  Click any row to jump to that system in System Design.
                </p>
              </div>
            )}
          </div>

          {/* Equipment Schedule grouped by system */}
          {projectEquipmentSchedule.length > 0 && (
            <div>
              <div className="mb-3">
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">Equipment Schedule</h3>
                <p className="text-slate-500 dark:text-slate-400 text-xs">All selected equipment grouped by system.</p>
              </div>
              <div className="w-full rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
                <Table className="w-full">
                  <TableHeader>
                    <TableRow className="bg-slate-50 dark:bg-slate-800 text-xs uppercase">
                      <TableHead>Type</TableHead>
                      <TableHead>Room / Zone</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead className="w-full">Model</TableHead>
                      <TableHead>Sub-Type</TableHead>
                      <TableHead className="text-right">TR Each</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Total TR</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {equipSystems.map(sys => {
                      const sysRows = projectEquipmentSchedule.filter(r => r.key.startsWith(sys.id + '-'));
                      if (sysRows.length === 0) return null;
                      const sysInstalledTR = sysRows.reduce((s, r) => s + r.tr * r.qty, 0);
                      const sysSummary = systemSummaries.find(s => s.id === sys.id);
                      return (
                        <React.Fragment key={sys.id}>
                          <TableRow className="bg-slate-100/70 dark:bg-slate-800/70 border-t border-slate-200 dark:border-slate-700">
                            <TableCell colSpan={8} className="py-2 px-4">
                              <div className="flex items-center gap-2.5 flex-wrap">
                                <Badge variant="outline" className={cn('text-xs',
                                  sys.type === 'VRF'     ? 'bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800' :
                                  sys.type === 'Chiller' ? 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800' :
                                  sys.type === 'AHU'     ? 'bg-teal-50 dark:bg-teal-950/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800' :
                                  sys.type === 'Package' || sys.type === 'DuctableSplit' ? 'bg-sky-50 dark:bg-sky-950/20 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800' :
                                  sys.type === 'Split'   ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' :
                                  'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-600'
                                )}>
                                  {sys.type}
                                </Badge>
                                <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{sys.name}</span>
                                {sysSummary && sysSummary.roomCount > 0 && (
                                  <span className="text-xs text-slate-400 dark:text-slate-500">{sysSummary.roomCount} room{sysSummary.roomCount !== 1 ? 's' : ''}</span>
                                )}
                                <span className="ml-auto text-sm font-mono font-bold text-slate-600 dark:text-slate-400">
                                  {sysInstalledTR.toFixed(2)} TR installed
                                  {sysSummary && sysSummary.requiredTR > 0 && (
                                    <span className={cn('ml-1.5 font-normal',
                                      sysInstalledTR >= sysSummary.requiredTR * 0.97 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                                    )}>
                                      / {sysSummary.requiredTR.toFixed(2)} TR req.
                                    </span>
                                  )}
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                          {sysRows.map(row => (
                            <TableRow key={row.key} className="text-xs hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                              <TableCell>
                                <Badge variant="outline" className={cn('text-xs',
                                  row.type === 'VRF-IDU' ? 'bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800' :
                                  row.type === 'VRF-ODU' ? 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800' :
                                  row.type === 'AHU'     ? 'bg-teal-50 dark:bg-teal-950/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800' :
                                  row.type === 'Chiller' ? 'bg-cyan-50 dark:bg-cyan-950/20 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800' :
                                  'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-600'
                                )}>
                                  {row.type}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-slate-500 dark:text-slate-400">{row.roomName || '—'}</TableCell>
                              <TableCell className="font-semibold dark:text-slate-300">{row.brand}</TableCell>
                              <TableCell>{row.model}</TableCell>
                              <TableCell className="text-slate-500 dark:text-slate-400">{IDU_SUBTYPE_LABELS[row.subType ?? ''] ?? row.subType ?? '—'}</TableCell>
                              <TableCell className="text-right font-mono dark:text-slate-300">{row.tr.toFixed(2)}</TableCell>
                              <TableCell className="text-right font-mono dark:text-slate-300">{row.qty}</TableCell>
                              <TableCell className="text-right font-mono font-bold dark:text-slate-200">{(row.tr * row.qty).toFixed(2)}</TableCell>
                            </TableRow>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

        </TabsContent>

        {/* ── Equipment Library Tab ── */}
        <TabsContent value="library" className="space-y-6">

          {/* ── Project Equipment Schedule ─────────────────────────────────── */}
          <div>
            <div className="mb-3">
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">Project Equipment Schedule</h3>
              <p className="text-slate-500 dark:text-slate-400 text-xs">Auto-populated from system selections. Updates whenever you pick or change equipment.</p>
            </div>
            {projectEquipmentSchedule.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400 dark:text-slate-500 gap-2 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700">
                <Package className="w-8 h-8 opacity-20" />
                <p className="text-sm font-medium">No equipment selected yet</p>
                <p className="text-xs">Select IDU / ODU / units in the System Design tab to populate this schedule.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 dark:bg-slate-800 text-xs uppercase">
                      <TableHead>Type</TableHead>
                      <TableHead>System</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Sub-Type</TableHead>
                      <TableHead className="text-right">TR</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projectEquipmentSchedule.map(row => (
                      <TableRow key={row.key} className="text-xs hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                        <TableCell>
                          <Badge variant="outline" className={cn('text-xs',
                            row.type === 'VRF-IDU' && 'bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
                            row.type === 'VRF-ODU' && 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
                            row.type === 'AHU'     && 'bg-teal-50 dark:bg-teal-950/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800',
                            row.type === 'Chiller' && 'bg-cyan-50 dark:bg-cyan-950/20 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800',
                          )}>
                            {row.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium text-slate-700 dark:text-slate-300">{row.systemName}</TableCell>
                        <TableCell className="text-slate-500 dark:text-slate-400">{row.roomName}</TableCell>
                        <TableCell className="font-semibold dark:text-slate-300">{row.brand}</TableCell>
                        <TableCell className="dark:text-slate-300">{row.model}</TableCell>
                        <TableCell className="text-slate-500 dark:text-slate-400">{IDU_SUBTYPE_LABELS[row.subType ?? ''] ?? row.subType ?? '—'}</TableCell>
                        <TableCell className="text-right font-mono font-bold dark:text-slate-200">{row.tr}</TableCell>
                        <TableCell className="text-right font-mono dark:text-slate-300">{row.qty}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 dark:border-slate-700 pt-2" />

          {/* ── Global Equipment Library ───────────────────────────────────── */}
          <div className="mb-2">
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">Global Equipment Library</h3>
            <p className="text-slate-500 dark:text-slate-400 text-xs">App-wide catalog stored in Firestore. Add, edit, import, or export equipment available across all projects.</p>
          </div>
          <GlobalEquipmentLibrary />

        </TabsContent>

        {/* ── Drawings Tab ── */}
        <TabsContent value="drawings" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Project Drawings & Documents</h3>
            <Button variant="outline" className="gap-2" disabled={uploadingDrawing} onClick={() => drawingFileRef.current?.click()}>
              {uploadingDrawing ? <><Upload className="w-4 h-4 animate-bounce" /> Uploading…</> : <><Upload className="w-4 h-4" /> Upload Drawing</>}
            </Button>
            <input ref={drawingFileRef} type="file" accept=".pdf,.dwg,.dxf,.png,.jpg,.jpeg,.xlsx,.docx" className="hidden" onChange={handleDrawingUpload} />
          </div>
          <Card>
            <CardContent className="p-0">
              {drawings.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500 gap-2">
                  <FileText className="w-10 h-10 opacity-20" />
                  <p className="text-sm">No drawings uploaded yet</p>
                  <p className="text-xs">Click "Upload Drawing" to add files</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/50 dark:bg-slate-800/50 text-xs uppercase">
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Format</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Size (MB)</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drawings.map(d => {
                      const dateMs = d.uploadedAt?.toMillis?.() ?? null;
                      const dateStr = dateMs
                        ? new Date(dateMs).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                        : '—';
                      const sizeStr = typeof d.sizeBytes === 'number'
                        ? (d.sizeBytes / (1024 * 1024)).toFixed(2)
                        : '—';
                      return (
                        <TableRow key={d.id}>
                          <TableCell className="font-medium dark:text-slate-200">{d.name}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{d.type}</Badge></TableCell>
                          <TableCell className="text-sm text-slate-500 dark:text-slate-400">{d.format}</TableCell>
                          <TableCell className="text-sm text-slate-500 dark:text-slate-400">{d.version}</TableCell>
                          <TableCell className="text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">{dateStr}</TableCell>
                          <TableCell className="text-sm text-slate-500 dark:text-slate-400 text-right tabular-nums">{sizeStr}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <a href={d.downloadURL} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 h-8 px-3 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300">
                                <ExternalLink className="w-3.5 h-3.5" /> View
                              </a>
                              <Button size="sm" variant="ghost"
                                className="h-8 w-8 p-0 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                                onClick={() => handleDrawingDelete(d)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── New System Dialog ── */}
      <Dialog open={showNewSystem} onOpenChange={v => { if (!v) setShowNewSystem(false); }}>
        <DialogContent className="max-w-sm dark:bg-slate-900">
          <DialogHeader><DialogTitle className="text-sm font-bold dark:text-slate-100">Create New System</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-1">
            <div>
              <Label className="text-sm font-semibold uppercase text-slate-600 dark:text-slate-400">System Name *</Label>
              <Input className="mt-1 h-9 text-sm" placeholder="e.g. VRF System 1, AHU-GF"
                value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createSystem(); }} />
            </div>
            <div>
              <Label className="text-sm font-semibold uppercase text-slate-600 dark:text-slate-400">System Type *</Label>
              <Select value={newType} onValueChange={v => setNewType(v as SystemType)}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="VRF">VRF (Multi-split)</SelectItem>
                  <SelectItem value="Package">Package Unit</SelectItem>
                  <SelectItem value="DuctableSplit">Ductable Split</SelectItem>
                  <SelectItem value="AHU">AHU (Air Handling Unit)</SelectItem>
                  <SelectItem value="Chiller">Chiller Plant</SelectItem>
                  <SelectItem value="Split">Split Unit (dedicated room)</SelectItem>
                  <SelectItem value="DOAS">TFA / DOAS (Treated Fresh Air / Dedicated Outdoor Air System)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newType === 'Package' && (
              <div>
                <Label className="text-sm font-semibold uppercase text-slate-600 dark:text-slate-400">Package Type</Label>
                <Select value={newPkgSubType} onValueChange={v => setNewPkgSubType(v as any)}>
                  <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="air-cooled">Air Cooled</SelectItem>
                    <SelectItem value="water-cooled">Water Cooled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {newType === 'VRF' && (
              <div>
                <Label className="text-sm font-semibold uppercase text-slate-600 dark:text-slate-400">Brand <span className="text-slate-400 dark:text-slate-500 font-normal normal-case">(optional — locks IDU/ODU picker)</span></Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {VRF_DEFAULT_BRANDS.map(b => (
                    <button key={b} type="button"
                      className={cn(
                        'px-3 py-1.5 text-xs rounded-md border transition-colors',
                        newBrand === b
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-blue-400 hover:text-blue-600',
                      )}
                      onClick={() => { setNewBrand(newBrand === b ? '' : b); setNewBrandCustom(''); }}>
                      {b}
                    </button>
                  ))}
                  <button type="button"
                    className={cn(
                      'px-3 py-1.5 text-xs rounded-md border transition-colors',
                      newBrand === '__other__'
                        ? 'bg-slate-700 text-white border-slate-700'
                        : 'border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-500',
                    )}
                    onClick={() => { setNewBrand('__other__'); setNewBrandCustom(''); }}>
                    + Other
                  </button>
                </div>
                {newBrand === '__other__' && (
                  <Input className="mt-2 h-8 text-xs" placeholder="Enter brand name…"
                    value={newBrandCustom} onChange={e => setNewBrandCustom(e.target.value)} />
                )}
                {newBrand && newBrand !== '__other__' && (
                  <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">IDU/ODU picker will be locked to {newBrand}.</p>
                )}
              </div>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" className="text-xs" onClick={() => { setShowNewSystem(false); setNewBrand(''); setNewBrandCustom(''); }}>Cancel</Button>
              <Button className="text-xs gap-1.5" onClick={createSystem} disabled={creatingSystem}>
                <Plus className="w-3.5 h-3.5" />{creatingSystem ? 'Creating…' : 'Create System'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Zone Equipment Picker (unified — IDU / AHU / FCU per zone for any system type) ── */}
      {zoneEquipPicker && selectedSystem && (
        <IDUPickerDialog
          open={!!zoneEquipPicker}
          onClose={() => setZoneEquipPicker(null)}
          roomName={zoneEquipPicker.systemType === 'Chiller' && (zoneEquipPicker.coilTR ?? 0) > 0
            ? `${zoneEquipPicker.zoneName} (Coil ${(zoneEquipPicker.coilTR ?? 0).toFixed(2)} TR · ${Math.round(zoneEquipPicker.totalCFM).toLocaleString()} CFM)`
            : `${zoneEquipPicker.zoneName} (${zoneEquipPicker.totalTR.toFixed(2)} TR)`}
          requiredTR={zoneEquipPicker.totalTR}
          designCFM={zoneEquipPicker.totalCFM}
          lockedBrand={null}
          onSelect={sel => handleSelectZoneEquip(zoneEquipPicker.zoneId, sel)}
          systemType={zoneEquipPicker.systemType}
          coilDutyTR={zoneEquipPicker.coilTR}
        />
      )}

      {/* ── Add Rooms to Zone Dialog ── */}
      <Dialog open={!!addRoomsZoneId} onOpenChange={open => { if (!open) { setAddRoomsZoneId(null); setAddRoomsSelected(new Set()); } }}>
        <DialogContent className="max-w-sm dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold dark:text-slate-100">
              Add Rooms to {selectedSystem ? ((selectedSystem.zones ?? []) as EquipmentZone[]).find((z: EquipmentZone) => z.id === addRoomsZoneId)?.name ?? 'Zone' : 'Zone'}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto py-1">
            {(() => {
              const sdZone = selectedSystem ? ((selectedSystem.zones ?? []) as EquipmentZone[]).find((z: EquipmentZone) => z.id === addRoomsZoneId) : null;
              const alreadyInZone = new Set(sdZone?.roomIds ?? []);

              // Group rooms by LC zone
              const lcGroups = new Map<string, { zoneId: string; zoneName: string; roomList: any[] }>();
              for (const r of rooms as any[]) {
                const key = r.zoneId || 'unzoned';
                const name = r.zoneName || 'Unzoned Rooms';
                if (!lcGroups.has(key)) lcGroups.set(key, { zoneId: key, zoneName: name, roomList: [] });
                lcGroups.get(key)!.roomList.push(r);
              }

              return [...lcGroups.values()].map(group => {
                const selectableIds = group.roomList.map((r: any) => r.id).filter(id => !alreadyInZone.has(id));
                const allGroupSelected = selectableIds.length > 0 && selectableIds.every(id => addRoomsSelected.has(id));
                const someGroupSelected = selectableIds.some(id => addRoomsSelected.has(id));
                const groupTR = group.roomList.reduce((s: number, r: any) => s + (Number(r._calcOverallRequiredTR ?? r._calcRequiredTR) || 0), 0);

                return (
                  <div key={group.zoneId} className="mb-1">
                    {/* LC Zone group header */}
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100/80 dark:bg-slate-700/80 sticky top-0">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={allGroupSelected}
                        disabled={selectableIds.length === 0}
                        onChange={e => {
                          setAddRoomsSelected(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) selectableIds.forEach(id => next.add(id));
                            else selectableIds.forEach(id => next.delete(id));
                            return next;
                          });
                        }}
                        ref={el => { if (el) el.indeterminate = someGroupSelected && !allGroupSelected; }}
                      />
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex-1 truncate">{group.zoneName}</span>
                      {groupTR > 0 && <span className="text-sm font-mono text-slate-500 dark:text-slate-400">{groupTR.toFixed(1)} TR</span>}
                      <span className="text-xs text-slate-400 dark:text-slate-500">{group.roomList.length} rooms</span>
                    </div>
                    {/* Rooms in group */}
                    {group.roomList.map((r: any) => {
                      const inZone = alreadyInZone.has(r.id);
                      const tr = Number(r._calcOverallRequiredTR ?? r._calcRequiredTR ?? 0);
                      return (
                        <label key={r.id} className={cn(
                          'flex items-center gap-2.5 px-5 py-1.5 cursor-pointer transition-colors',
                          inZone ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-50 dark:hover:bg-slate-800',
                        )}>
                          <input type="checkbox" className="rounded"
                            disabled={inZone}
                            checked={inZone || addRoomsSelected.has(r.id)}
                            onChange={e => {
                              setAddRoomsSelected(prev => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(r.id); else next.delete(r.id);
                                return next;
                              });
                            }}
                          />
                          <span className="text-sm flex-1 dark:text-slate-300">{r.name}</span>
                          {r.floor && <span className="text-xs text-slate-400 dark:text-slate-500">{r.floor}</span>}
                          {tr > 0 && <span className="text-sm font-mono text-slate-500 dark:text-slate-400">{tr.toFixed(2)} TR</span>}
                        </label>
                      );
                    })}
                  </div>
                );
              });
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" className="text-xs" onClick={() => { setAddRoomsZoneId(null); setAddRoomsSelected(new Set()); }}>Cancel</Button>
            <Button className="text-xs" disabled={addRoomsSelected.size === 0}
              onClick={() => addRoomsZoneId && void handleAssignRoomsToZone(addRoomsZoneId)}>
              Add {addRoomsSelected.size > 0 ? addRoomsSelected.size : ''} Room{addRoomsSelected.size !== 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Zone Multi-Unit Picker (Package / DuctableSplit — multiple units per zone) ── */}
      {zoneMultiUnitPicker && selectedSystem && (
        <IDUPickerDialog
          open={!!zoneMultiUnitPicker}
          onClose={() => setZoneMultiUnitPicker(null)}
          roomName={`${zoneMultiUnitPicker.zoneName} — Add Unit (${zoneMultiUnitPicker.totalTR.toFixed(2)} TR needed)`}
          requiredTR={zoneMultiUnitPicker.totalTR}
          designCFM={zoneMultiUnitPicker.totalCFM}
          lockedBrand={null}
          onSelect={sel => void handleAddZoneUnit(zoneMultiUnitPicker.zoneId, sel)}
          systemType={zoneMultiUnitPicker.systemType}
          coilDutyTR={zoneMultiUnitPicker.coilTR}
        />
      )}

      {/* ── Room Unit Picker (Split) ── */}
      {roomUnitPicker && selectedSystem && (
        <IDUPickerDialog
          open={!!roomUnitPicker}
          onClose={() => setRoomUnitPicker(null)}
          roomName={`${roomUnitPicker.roomName} — Add Split Unit (${roomUnitPicker.reqTR.toFixed(2)} TR)`}
          requiredTR={roomUnitPicker.reqTR}
          designCFM={roomUnitPicker.reqCFM}
          lockedBrand={null}
          onSelect={sel => void handleAddRoomUnit(roomUnitPicker.roomId, sel)}
        />
      )}

      {/* ── Legacy zone pickers kept for backward compat with old VRF IDU table (now hidden) ── */}
      {zonePicker && selectedSystem && (
        <IDUPickerDialog open={!!zonePicker} onClose={() => setZonePicker(null)}
          roomName={`${zonePicker.zoneName} (${zonePicker.totalTR.toFixed(2)} TR combined)`}
          requiredTR={zonePicker.totalTR} designCFM={zonePicker.totalCFM} lockedBrand={null}
          onSelect={sel => selectZoneIDU(selectedSystem.id, zonePicker.zoneId, sel)} />
      )}
      {zoneTerminalPicker && selectedSystem && (
        <IDUPickerDialog open={!!zoneTerminalPicker} onClose={() => setZoneTerminalPicker(null)}
          roomName={`${zoneTerminalPicker.zoneName} — Terminal Unit (${zoneTerminalPicker.totalTR.toFixed(2)} TR)`}
          requiredTR={zoneTerminalPicker.totalTR} designCFM={zoneTerminalPicker.totalCFM} lockedBrand={null}
          onSelect={sel => selectZoneTerminalUnit(selectedSystem.id, zoneTerminalPicker.zoneId, sel)} />
      )}

      {/* ── Cooling Tower Form Dialog ── */}
      {selectedSystem && (
        <Dialog open={ctFormOpen} onOpenChange={v => { if (!v) setCtFormOpen(false); }}>
          <DialogContent className="max-w-sm dark:bg-slate-900">
            <DialogHeader>
              <DialogTitle className="text-sm font-bold flex items-center gap-2 dark:text-slate-100">
                <Droplets className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                Add Cooling Tower
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-1">
              <div className="bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800 rounded px-3 py-2 text-xs text-cyan-700 dark:text-cyan-300">
                Computed duty: <span className="font-bold">{(chillerPlantRequiredTR * 1.25).toFixed(1)} TR</span>
                <span className="text-cyan-500 dark:text-cyan-400 ml-1">({(chillerPlantRequiredTR * 1.25 * 3.517).toFixed(0)} kW heat rejection, assuming COP ≈ 5)</span>
              </div>
              <div>
                <Label className="text-sm font-semibold uppercase text-slate-600 dark:text-slate-400">Brand *</Label>
                <Input className="mt-1 h-9 text-sm" placeholder="e.g. Paharpur, Cooling India, SPX"
                  value={ctForm.brand} onChange={e => setCtForm(f => ({ ...f, brand: e.target.value }))} />
              </div>
              <div>
                <Label className="text-sm font-semibold uppercase text-slate-600 dark:text-slate-400">Model / Series *</Label>
                <Input className="mt-1 h-9 text-sm" placeholder="e.g. FRP-1000, IDCT-500"
                  value={ctForm.modelSeries} onChange={e => setCtForm(f => ({ ...f, modelSeries: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm font-semibold uppercase text-slate-600 dark:text-slate-400">Duty TR *</Label>
                  <NumericInput className="mt-1 h-9 text-sm" min={0}
                    value={ctForm.trCapacity}
                    onChange={(n) => setCtForm(f => ({ ...f, trCapacity: n ?? 0 }))} />
                </div>
                <div>
                  <Label className="text-sm font-semibold uppercase text-slate-600 dark:text-slate-400">Quantity</Label>
                  <NumericInput className="mt-1 h-9 text-sm" integer min={1} max={10}
                    value={ctForm.quantity}
                    onChange={(n) => setCtForm(f => ({ ...f, quantity: n ?? 1 }))} />
                </div>
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button variant="outline" className="text-xs" onClick={() => setCtFormOpen(false)}>Cancel</Button>
              <Button className="text-xs gap-1.5 bg-cyan-600 hover:bg-cyan-700"
                disabled={!ctForm.brand || !ctForm.modelSeries || ctForm.trCapacity <= 0}
                onClick={() => void addCTUnit(selectedSystem.id)}>
                <Plus className="w-3.5 h-3.5" />Add CT
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── IDU Picker ── */}
      {iduPicker && selectedSystem && (
        <IDUPickerDialog
          open={!!iduPicker}
          onClose={() => setIduPicker(null)}
          roomName={iduPicker.roomName}
          requiredTR={iduPicker.reqTR}
          designCFM={iduPicker.reqCFM}
          lockedBrand={null}
          onSelect={sel => selectIDU(selectedSystem, iduPicker.roomId, sel)}
        />
      )}

      {/* ── ODU Picker ── */}
      {selectedSystem && (
        <ODUPickerDialog
          open={oduPicker}
          onClose={() => setOduPicker(false)}
          requiredTR={requiredODU_TR}
          lockedBrand={selectedSystem.brandLocked ? selectedSystem.brand : null}
          onSelect={sel => { selectODU(selectedSystem.id, sel); setOduPicker(false); }}
        />
      )}

      {/* ── Unit Picker — AHU (DX condensing unit), Chiller, and DOAS ── */}
      {selectedSystem && (selectedSystem.type === 'AHU' || selectedSystem.type === 'Chiller' || selectedSystem.type === 'DOAS') && (
        <UnitPickerDialog
          open={unitPicker}
          onClose={() => setUnitPicker(false)}
          systemType={selectedSystem.type as 'AHU' | 'Chiller' | 'DOAS'}
          packageSubType={selectedSystem.packageSubType}
          requiredTR={
            selectedSystem.type === 'Chiller'
              ? Math.max(0.5, chillerPlantRequiredTR - chillerTotalInstalledTR)
              : selectedSystem.type === 'DOAS'
              // DOAS sized off the aggregated TFA coil load across served rooms
              // (governing summer/monsoon). Falls back to the OA-CFM heuristic
              // only when no rooms are linked yet (e.g., user just created the
              // DOAS system and hasn't picked primaries).
              ? Math.max(0.5, doasTFAAggregate.governingCoilTR || (doasOACFM / 600))
              : (unitQuantity > 1 ? totalRequiredTR / unitQuantity : totalRequiredTR)
          }
          designCFM={selectedSystem.type === 'DOAS' ? doasOACFM : (unitQuantity > 1 ? totalDesignCFM / unitQuantity : totalDesignCFM)}
          customItems={customEquipment}
          systemName={selectedSystem.name}
          onSaveToLibrary={async (item) => { await saveCustomEquipment_item(item); }}
          onSelect={sel => {
            if (selectedSystem.type === 'Chiller') {
              void addChillerUnit(selectedSystem.id, sel);
            } else if (selectedSystem.type === 'DOAS') {
              void selectUnit(selectedSystem.id, sel);
            } else {
              void addAHUUnit(selectedSystem.id, sel);
            }
            setUnitPicker(false);
          }}
        />
      )}

      {/* ── Per-system type change confirmation ── */}
      <Dialog open={!!typeChangeConfirm} onOpenChange={open => { if (!open) setTypeChangeConfirm(null); }}>
        <DialogContent className="max-w-sm dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4" /> Change System Type?
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-slate-700 dark:text-slate-300 space-y-2 py-1">
            <p>
              Changing from <span className="font-semibold">{typeChangeConfirm?.oldType}</span> to{' '}
              <span className="font-semibold text-blue-700 dark:text-blue-400">{typeChangeConfirm?.newType}</span> will clear:
            </p>
            <ul className="list-disc pl-5 space-y-0.5 text-slate-600 dark:text-slate-400 text-xs">
              <li>All IDU / ODU / unit selections</li>
              <li>Zone groupings and 62.1 Ez settings</li>
              <li>Brand lock</li>
            </ul>
            <p className="text-xs text-slate-500 dark:text-slate-400">Room assignments will be kept — only equipment choices are reset.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="text-xs" onClick={() => setTypeChangeConfirm(null)}>
              Cancel
            </Button>
            <Button className="text-xs bg-amber-600 hover:bg-amber-700" onClick={() => void confirmSystemTypeChange()}>
              Change &amp; Reset Equipment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── HVAC category (project-level) System Type Change Warning ── */}
      <Dialog open={categoryWarnOpen} onOpenChange={open => { if (!open && !categoryWarnBusy) { setCategoryWarnOpen(false); setPendingCategory(null); } }}>
        <DialogContent className="max-w-md dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-2 text-red-700 dark:text-red-400">
              <AlertTriangle className="w-4 h-4" /> Change System Type?
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-slate-700 dark:text-slate-300 space-y-3 py-2">
            <p>Changing the system type to <span className="font-semibold text-blue-700 dark:text-blue-400">{pendingCategory}</span> will permanently delete:</p>
            <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
              <li><span className="font-semibold">{equipSystems.length}</span> existing system{equipSystems.length !== 1 ? 's' : ''} and all zone assignments</li>
              <li>All equipment selections (IDU, ODU, AHU, chillers)</li>
              <li>All 62.1 ventilation settings</li>
            </ul>
            <p className="text-amber-700 dark:text-amber-300 font-semibold bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded px-3 py-2 text-xs">
              This cannot be undone. You will need to redo the complete system design from scratch.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="text-xs" disabled={categoryWarnBusy}
              onClick={() => { setCategoryWarnOpen(false); setPendingCategory(null); }}>
              Keep Current Design
            </Button>
            <Button className="text-xs gap-1.5 bg-red-600 hover:bg-red-700" disabled={categoryWarnBusy}
              onClick={() => void confirmCategoryChange()}>
              {categoryWarnBusy ? 'Deleting…' : 'Yes, Start Fresh'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Humidifier Model Picker ── */}
      {humidPicker && (
        <Dialog open={!!humidPicker} onOpenChange={v => { if (!v) setHumidPicker(null); }}>
          <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col p-0 dark:bg-slate-900">
            <DialogHeader className="px-5 pt-5 pb-3 border-b dark:border-slate-700">
              <DialogTitle className="text-sm font-bold dark:text-slate-100">Select Humidifier Model</DialogTitle>
              {humidPicker.suggestedKgHr > 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Required: <span className="font-semibold text-sky-700 dark:text-sky-300">{humidPicker.suggestedKgHr} kg/hr</span> · select a model at or above this capacity
                </p>
              )}
            </DialogHeader>
            <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3">
              {(['Ultrasonic', 'Heater-Based'] as const).map(subType => {
                const rawItems = EQUIPMENT_CATALOG.filter(m => m.type === 'Humidifier' && m.subType === subType);
                if (!rawItems.length) return null;
                // Sort: adequate models first by ascending capacity (smallest fit at top),
                // then inadequate models by descending capacity (largest under-spec next).
                const sorted = [...rawItems].sort((a, b) => {
                  const aCap = a.capacityLPH ?? 0;
                  const bCap = b.capacityLPH ?? 0;
                  const aAdeq = aCap >= humidPicker.suggestedKgHr;
                  const bAdeq = bCap >= humidPicker.suggestedKgHr;
                  if (aAdeq !== bAdeq) return aAdeq ? -1 : 1;
                  return aAdeq ? aCap - bCap : bCap - aCap;
                });
                // Recommended = smallest adequate model (top-of-list after sort, if any).
                const recommendedId = sorted.find(m => (m.capacityLPH ?? 0) >= humidPicker.suggestedKgHr)?.id;
                // If no single model fits, suggest a multi-unit combination using the largest available.
                const biggest = rawItems.reduce((b, m) => ((m.capacityLPH ?? 0) > (b?.capacityLPH ?? 0) ? m : b), rawItems[0]);
                const noFit = !recommendedId && humidPicker.suggestedKgHr > 0;
                const comboQty = noFit && biggest?.capacityLPH ? Math.ceil(humidPicker.suggestedKgHr / biggest.capacityLPH) : 0;
                return (
                  <div key={subType}>
                    <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                      {subType === 'Ultrasonic' ? 'Ultrasonic (Cool Mist — low power)' : 'Heater-Based (Steam — higher power)'}
                    </div>
                    {noFit && comboQty > 1 && (
                      <div className="mb-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300 space-y-1.5">
                        <p>
                          <strong>No single model in this category covers {humidPicker.suggestedKgHr} kg/hr.</strong>{' '}
                          Indian market catalog typically tops out near 30 kg/hr per unit — large loads use multiple units in parallel or direct plant-steam injection.
                        </p>
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <span className="font-mono text-amber-900 dark:text-amber-200">
                            Suggested: <strong>{comboQty} × {biggest.brand} {biggest.modelSeries}</strong> ({biggest.capacityLPH} kg/hr each = {comboQty * (biggest.capacityLPH ?? 0)} kg/hr total)
                          </span>
                          <button
                            className="px-2.5 py-1 text-[11px] rounded bg-amber-600 text-white hover:bg-amber-700 font-semibold whitespace-nowrap"
                            onClick={() => void handleSelectHumidifier(humidPicker.zoneId, biggest, comboQty)}>
                            Use {comboQty} × Combo
                          </button>
                        </div>
                        {humidPicker.suggestedKgHr > 60 && (
                          <p className="text-[10.5px] italic text-amber-700 dark:text-amber-400 leading-snug pt-0.5">
                            ⓘ For loads above ~60 kg/hr, consider <strong>direct steam injection</strong> from a central boiler (lance-type dispersion tube in the AHU). More efficient than electric humidifiers at this scale and standard practice in Indian pharma / hospital projects.
                          </p>
                        )}
                      </div>
                    )}
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-slate-800 text-xs uppercase text-slate-500 dark:text-slate-400">
                            <th className="text-left px-3 py-1.5 font-semibold">Model</th>
                            <th className="text-right px-3 py-1.5 font-semibold">Capacity</th>
                            <th className="text-right px-3 py-1.5 font-semibold">Power</th>
                            <th className="px-2 py-1.5"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                          {sorted.map(item => {
                            const adequate = (item.capacityLPH ?? 0) >= humidPicker.suggestedKgHr;
                            const isRecommended = item.id === recommendedId;
                            return (
                              <tr key={item.id} className={cn(
                                'hover:bg-sky-50 dark:hover:bg-sky-900/20',
                                isRecommended ? 'bg-emerald-50/60 dark:bg-emerald-950/20' : '',
                                !adequate ? 'opacity-60' : '',
                              )}>
                                <td className="px-3 py-1.5 font-medium dark:text-slate-300">
                                  {item.brand} {item.modelSeries}
                                  {isRecommended && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[9px] font-bold uppercase tracking-wide">★ Recommended</span>}
                                  {adequate && !isRecommended && <span className="ml-1.5 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold">✓ Fits</span>}
                                  {!adequate && <span className="ml-1.5 text-red-600 dark:text-red-400 text-[10px] font-bold">✕ Under</span>}
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono dark:text-slate-300">{item.capacityLPH} kg/hr</td>
                                <td className="px-3 py-1.5 text-right font-mono text-slate-500 dark:text-slate-400">{item.powerInputKW} kW</td>
                                <td className="px-2 py-1.5 text-right">
                                  <button
                                    className={cn(
                                      'px-2.5 py-1 text-xs rounded font-medium',
                                      isRecommended
                                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                        : 'bg-sky-600 text-white hover:bg-sky-700',
                                    )}
                                    onClick={() => void handleSelectHumidifier(humidPicker.zoneId, item)}>
                                    Select
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
