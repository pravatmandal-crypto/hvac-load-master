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
import { calculateCoilParameters, calculatePsychrometrics, EZ_OPTIONS, calcZoneVentilation, calcSystemVentilation62, calculateEnvelopeGain, calculateInternalGains, calculateVentilationLoad, calculateParasiticGains, getRecommendedAch } from '../../lib/hvac';
import { calculateRoomVolume } from '../../lib/hvac/geometry';
import SpecSheet from './SpecSheet';
import type {
  EquipmentSystem, IDUSelection, ODUSelection, ODUCombinationUnit, SingleUnitSelection, SystemType, EquipmentZone, AHUConfig,
} from '../../types/equipment-systems';
import {
  Plus, Trash2, Package, FileText, Search, Lock, Unlock, Box, Check, LayoutGrid,
  AlertTriangle, CheckCircle2, Wind, Zap, Droplets, ExternalLink, Upload,
  ChevronRight, ChevronDown, Info, BookOpen, Pencil, ArrowLeftRight, ArrowRight, ArrowLeft,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { envelopeCache } from '../../lib/envelopeCache';

// ─── Constants ───────────────────────────────────────────────────────────────

const VRF_DEFAULT_BRANDS = ['Blue Star', 'Samsung', 'Voltas', 'Trane'];

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
  if (!sys.unitSelection) return { label: 'Unit not selected', color: 'text-orange-600' };
  return { label: 'Complete', color: 'text-emerald-600' };
}

// ─── IDU Picker Dialog ────────────────────────────────────────────────────────

function IDUPickerDialog({
  open, onClose, roomName, requiredTR, designCFM, lockedBrand, onSelect,
}: {
  open: boolean; onClose: () => void;
  roomName: string; requiredTR: number; designCFM: number;
  lockedBrand: string | null;
  onSelect: (sel: IDUSelection) => void;
}) {
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

  // Final visible items
  const items = afterTypeItems
    .filter(m => filterSubType === 'all' || m.subType === filterSubType)
    .filter(m => !search || m.modelSeries.toLowerCase().includes(search.toLowerCase()) || m.brand.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const order = { ok: 0, oversized: 1, undersized: 2, unknown: 3 };
      return order[getFitStatus(a.capacityTR, a.ratedAirflowCFM, requiredTR, designCFM)]
           - order[getFitStatus(b.capacityTR, b.ratedAirflowCFM, requiredTR, designCFM)];
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
      const esp = parseFloat(customStaticPa);
      if (!isNaN(esp) && esp > 0) payload.staticPressurePa = esp;

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
          {requiredTR > 0 && (
            <div className="mt-3 flex flex-wrap gap-4 p-3 rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 text-sm">
              <Info className="w-4 h-4 text-violet-500 mt-0.5 shrink-0" />
              <span className="text-violet-700 dark:text-violet-300">Required: <strong>{requiredTR.toFixed(2)} TR</strong></span>
              {designCFM > 0 && <span className="text-violet-700 dark:text-violet-300">Design CFM: <strong>{Math.round(designCFM).toLocaleString()}</strong></span>}
              <span className="text-slate-400 dark:text-slate-500 italic">Fits: {requiredTR.toFixed(2)}–{(requiredTR * 1.3).toFixed(2)} TR</span>
            </div>
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
                const fit = getFitStatus(item.capacityTR, item.ratedAirflowCFM, requiredTR, designCFM);
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
                  <Input type="number" min="0" step="0.5" className="h-8 text-xs" placeholder="e.g. 1.5" value={customTR} onChange={e => setCustomTR(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-600 dark:text-slate-400">Airflow (CFM)</label>
                  <Input type="number" min="0" className="h-8 text-xs" placeholder="optional" value={customCFM} onChange={e => setCustomCFM(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-600 dark:text-slate-400">Static (Pa)</label>
                  <Input type="number" min="0" className="h-8 text-xs" placeholder="AHU only" value={customStaticPa} onChange={e => setCustomStaticPa(e.target.value)} />
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
                  <Input type="number" min="0" step="0.5" className="h-8 text-xs" placeholder="e.g. 20" value={customODUTR} onChange={e => setCustomODUTR(e.target.value)} />
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
  const safetyFactor = systemType === 'Chiller' ? 1.1 : 1.1;
  const rawTR = requiredTR * safetyFactor;
  const tr = roundUpToStdTR(rawTR);

  const cfmPerTR: Record<string, number> = {
    AHU: 400, Package: 380, DuctableSplit: 350, Split: 450, FCU: 450, Chiller: 0,
  };
  const cfm = systemType === 'Chiller' ? 0 : Math.max(designCFM, tr * (cfmPerTR[systemType] ?? 400));

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
  systemType: 'Package' | 'DuctableSplit' | 'AHU' | 'Chiller' | 'Split';
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

  const [libraryPkgItems, setLibraryPkgItems] = useState<EquipmentModel[]>([]);
  useEffect(() => {
    if (!open) return;
    getLibraryItemsByType(systemType).then(setLibraryPkgItems).catch(() => {
      setLibraryPkgItems(EQUIPMENT_CATALOG.filter(m => m.type === systemType));
    });
  }, [open, systemType]);

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
              <p className="text-xs text-amber-800 dark:text-amber-300">No {systemType} in catalog meets <strong>{requiredTR.toFixed(1)} TR</strong> requirement.</p>
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
              {!isChiller && <div>Airflow: max(Design CFM {Math.round(designCFM).toLocaleString()}, {genSpec.capacityTR} TR × {systemType === 'AHU' ? 400 : 380} CFM/TR) = <strong>{Math.round(genSpec.ratedAirflowCFM ?? 0).toLocaleString()} CFM</strong></div>}
              {(genSpec as any).staticPressurePa > 0 && <div>ESP: standard {systemType} value = <strong>{(genSpec as any).staticPressurePa} Pa</strong></div>}
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
                <Input type="number" className="h-8 text-sm" value={genSpec.capacityTR ?? ''} onChange={e => setGenSpec(s => ({ ...s, capacityTR: parseFloat(e.target.value) || 0, capacityBTU: (parseFloat(e.target.value) || 0) * 12000 }))} />
              </div>
              {!isChiller && (
                <div className="flex flex-col gap-0.5">
                  <label className="text-xs text-slate-500 dark:text-slate-400">Airflow (CFM)</label>
                  <Input type="number" className="h-8 text-sm" value={genSpec.ratedAirflowCFM ?? ''} onChange={e => setGenSpec(s => ({ ...s, ratedAirflowCFM: parseFloat(e.target.value) || 0 }))} />
                </div>
              )}
              {(isAHU || systemType === 'Package' || systemType === 'DuctableSplit') && (
                <div className="flex flex-col gap-0.5">
                  <label className="text-xs text-slate-500 dark:text-slate-400">ESP (Pa)</label>
                  <Input type="number" className="h-8 text-sm" value={(genSpec as any).staticPressurePa ?? ''} onChange={e => setGenSpec(s => ({ ...s, staticPressurePa: parseFloat(e.target.value) || undefined } as any))} />
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                <label className="text-xs text-slate-500 dark:text-slate-400">Power (kW)</label>
                <Input type="number" className="h-8 text-sm" value={genSpec.powerInputKW ?? ''} onChange={e => setGenSpec(s => ({ ...s, powerInputKW: parseFloat(e.target.value) || undefined }))} />
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
                        modelSeries: genSpec.modelSeries ?? '', subType: genSpec.subType,
                        trCapacity: genSpec.capacityTR ?? 0, cfmRated: genSpec.ratedAirflowCFM ?? 0,
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
                    modelSeries: genSpec.modelSeries ?? '', subType: genSpec.subType,
                    trCapacity: genSpec.capacityTR ?? 0, cfmRated: genSpec.ratedAirflowCFM ?? 0,
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
                {isAHU && <TableHead className="text-right hidden sm:table-cell">ESP Pa</TableHead>}
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
                    {isAHU && <TableCell className="text-right font-mono text-sm text-orange-700 font-semibold hidden sm:table-cell">{(item as any).staticPressurePa ?? '—'}</TableCell>}
                    {!isChiller && <TableCell className="text-center"><FitBadge status={fit} /></TableCell>}
                    <TableCell>
                      <Button size="sm" variant={sufficient ? 'default' : 'outline'} className="h-8 text-sm px-2"
                        onClick={() => {
                          const sel: SingleUnitSelection = {
                            modelId: item.id, brand: item.brand, modelSeries: item.modelSeries,
                            subType: item.subType, trCapacity: item.capacityTR, cfmRated: item.ratedAirflowCFM ?? 0,
                          };
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
                    {isAHU && <TableCell className="text-right font-mono text-sm text-orange-700 font-semibold hidden sm:table-cell">{(item as any).staticPressurePa ?? '—'}</TableCell>}
                    {!isChiller && <TableCell className="text-center"><FitBadge status={fit} /></TableCell>}
                    <TableCell>
                      <Button size="sm" variant={sufficient ? 'default' : 'outline'} className="h-8 text-sm px-2"
                        onClick={() => {
                          const sel: SingleUnitSelection = {
                            modelId: item.id, brand: item.brand, modelSeries: item.modelSeries,
                            subType: item.subType, trCapacity: item.capacityTR, cfmRated: item.ratedAirflowCFM ?? 0,
                          };
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

// Minimum ADP temperature by system type (mirrors LoadCalculator)
function getMinAdp(systemType?: string): number {
  const t = String(systemType || '').toLowerCase();
  if (t === 'vrf') return 38;
  if (t === 'chiller' || t === 'hydronic') return 42;
  return 40;
}

// Derive hvacSystemCategory from legacy project.systemType when no explicit category is set
function deriveCategory(projectSystemType?: string): string {
  const map: Record<string, string> = {
    'VRF':      'VRF',
    'Hydronic': 'Chiller WC',
    'Chiller':  'Chiller WC',
    'Hybrid':   'Hybrid',
  };
  return map[projectSystemType ?? ''] ?? '';
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

  // Picker dialog state
  const [iduPicker, setIduPicker] = useState<{ roomId: string; roomName: string; reqTR: number; reqCFM: number } | null>(null);
  const [oduPicker, setOduPicker] = useState(false);
  const [unitPicker, setUnitPicker] = useState(false);
  // Zone state
  const [zoneMode, setZoneMode] = useState(false);
  const [zoneSelected, setZoneSelected] = useState<Set<string>>(new Set());
  const [zonePicker, setZonePicker] = useState<{ zoneId: string; zoneName: string; totalTR: number; totalCFM: number } | null>(null);
  // Non-VRF zone terminal unit picker (Chiller terminal AHU/FCU per zone)
  const [zoneTerminalPicker, setZoneTerminalPicker] = useState<{ zoneId: string; zoneName: string; totalTR: number; totalCFM: number } | null>(null);
  // Cooling Tower form
  const [ctFormOpen, setCtFormOpen] = useState(false);
  const [ctForm, setCtForm] = useState<{ brand: string; modelSeries: string; trCapacity: number; quantity: number }>({ brand: '', modelSeries: '', trCapacity: 0, quantity: 1 });
  // Zone management (universal — VRF / Chiller / Split / DuctableSplit)
  const [addRoomsZoneId, setAddRoomsZoneId] = useState<string | null>(null);
  const [addRoomsSelected, setAddRoomsSelected] = useState<Set<string>>(new Set());
  const [showLcZonePicker, setShowLcZonePicker] = useState(false);
  const [renamingZoneId, setRenamingZoneId] = useState<string | null>(null);
  const [renamingZoneName, setRenamingZoneName] = useState('');
  const [zoneEquipPicker, setZoneEquipPicker] = useState<{ zoneId: string; zoneName: string; totalTR: number; totalCFM: number } | null>(null);
  const [zoneMultiUnitPicker, setZoneMultiUnitPicker] = useState<{ zoneId: string; zoneName: string; totalTR: number; totalCFM: number } | null>(null);
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
  const [recalcResults, setRecalcResults] = useState<Record<string, any>>({});
  const [recalcLoading, setRecalcLoading] = useState(false);

  // Active tab — controlled so Summary tab can jump back to System Design
  const [activeTab, setActiveTab] = useState('systems');

  const [drawings, setDrawings] = useState<{ id: string; name: string; type: string; format: string; version: string; downloadURL: string; uploadedAt?: any }[]>([]);
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
      updateDoc(doc(db, 'projects', project.id), { hvacSystemCategory: cat, updatedAt: serverTimestamp() }).catch(() => {});
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
    }).then(ref => setSelectedSystemId(ref.id)).catch(() => {});
  }, [hvacSystemCategory, equipSystems]);

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
        setEquipSystems(snap.docs.map(d => ({ id: d.id, ...d.data() } as EquipmentSystem)));
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

  // Update AHU/FCU mounting or coil type on an already-selected zone unit
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

  const toggleRoomAssignment = async (system: EquipmentSystem, roomId: string) => {
    // Source of truth is the room document (zoneId/zoneName/systemId/systemName).
    const room = rooms.find((r: any) => r.id === roomId);
    const isAssigned = room && (room.zoneId === system.id || room.systemId === system.id);
    try {
      if (isAssigned) {
        // Unassign: clear system fields; leave zoneId intact so LC zone grouping is preserved
        await updateDoc(doc(db, 'projects', project.id, 'rooms', roomId), {
          systemId: deleteField(),
          systemName: deleteField(),
          hvacSystemId: deleteField(),
          hvacSystemName: deleteField(),
          hvacZoneId: deleteField(),
          hvacZoneName: deleteField(),
          updatedAt: serverTimestamp(),
        });
        // If room was in a sub-zone, remove it from the zone's roomIds
        const existingZones = (system.zones ?? (system as any).ahuGroups ?? []) as EquipmentZone[];
        const zoneContaining = existingZones.find((z: EquipmentZone) => z.roomIds.includes(roomId));
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
      // Stamp room documents with system + AHU group; leave zoneId so LC zone grouping is preserved
      const batch = writeBatch(db);
      for (const roomId of roomIds) {
        batch.update(doc(db, 'projects', project.id, 'rooms', roomId), {
          systemId: selectedSystem.id,
          systemName: selectedSystem.name,
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
      // Reset rooms back to system-level assignment so LC reflects the change
      if (zone?.roomIds?.length) {
        const batch = writeBatch(db);
        for (const roomId of zone.roomIds) {
          batch.update(doc(db, 'projects', project.id, 'rooms', roomId), {
            systemId,
            systemName: sys.name,
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

  const saveCTUnit = async (systemId: string) => {
    if (!ctForm.brand || !ctForm.modelSeries || ctForm.trCapacity <= 0) return;
    const sys = equipSystems.find(s => s.id === systemId);
    const ctSel: SingleUnitSelection = {
      modelId: `ct-${systemId}`,
      brand: ctForm.brand,
      modelSeries: ctForm.modelSeries,
      subType: 'cooling-tower',
      trCapacity: ctForm.trCapacity,
      cfmRated: 0,
      quantity: ctForm.quantity,
      isCustom: true,
    };
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', systemId), {
        ctSelection: ctSel,
        updatedAt: serverTimestamp(),
      });
      void saveEquipmentEntry(`${systemId}-ct`, {
        systemId, systemName: sys?.name ?? '',
        type: 'CT',
        brand: ctSel.brand, modelSeries: ctSel.modelSeries, subType: 'cooling-tower',
        trCapacity: ctSel.trCapacity, quantity: ctSel.quantity ?? 1,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${systemId}`);
    }
    setCtFormOpen(false);
  };

  const clearCTUnit = async (systemId: string) => {
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', systemId), {
        ctSelection: deleteField(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${systemId}`);
    }
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
      const { selection, ...rest } = z;
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

  // ── Live calculation engine (same logic as LoadCalculator.persistRoomAnalysisSnapshot) ──

  const getDesignConditionsForRoom = (room: any) => {
    const zoneId = room.zoneId ?? room.systemId;
    const zone = zoneDocs.find((z: any) => z.id === zoneId);
    const summerTemp = project?.summerDesignTemp ?? project?.data?.summerDesignTemp ?? 95;
    const summerHum  = project?.summerDesignHumidity ?? project?.data?.summerDesignHumidity ?? 50;
    return {
      outdoorTemp:        zone?.outdoorTemp        ?? summerTemp,
      indoorTemp:         zone?.indoorTemp         ?? (project?.insideSummerTemp ?? project?.data?.insideSummerTemp ?? 75),
      outdoorHumidity:    zone?.outdoorHumidity    ?? summerHum,
      indoorHumidity:     zone?.indoorHumidity     ?? (project?.insideSummerHumidity ?? project?.data?.insideSummerHumidity ?? 50),
      altitude:           project?.altitude        ?? project?.data?.altitude ?? 0,
      latitude:           project?.latitude        ?? project?.data?.latitude ?? undefined,
      longitude:          project?.longitude       ?? project?.data?.longitude ?? undefined,
      winterOutdoorTemp:  project?.winterDesignTemp ?? project?.data?.winterDesignTemp ?? 30,
      winterOutdoorHumidity: project?.winterDesignHumidity ?? project?.data?.winterDesignHumidity ?? 30,
    };
  };

  const computeRoomReqs = (room: any, elements: any[]) => {
    const dc = getDesignConditionsForRoom(room);
    const monsoonTemp = project?.monsoonDesignTemp ?? project?.data?.monsoonDesignTemp ?? 85;
    const monsoonHum  = project?.monsoonDesignHumidity ?? project?.data?.monsoonDesignHumidity ?? 85;
    const incMonsoon  = !!(project?.includeMonsoon ?? project?.data?.includeMonsoon);
    const systemType  = project?.systemType ?? project?.data?.systemType;

    const rd = {
      id: room.id, name: room.name ?? '', floor: room.floor ?? 'Ground',
      length: Number(room.length) || 0, width: Number(room.width) || 0, height: Number(room.height) || 0,
      hasFalseCeiling: room.hasFalseCeiling ?? false, falseCeilingHeight: Number(room.falseCeilingHeight) || 0,
      facph: Number(room.facph) || 0, peopleCount: Number(room.peopleCount) || 0,
      activityType: room.activityType ?? 'office',
      lightsWattsPerSqft: Number(room.lightsWattsPerSqft) || 0,
      equipmentKW: Number(room.equipmentKW) || 0, othersKW: Number(room.othersKW) || 0,
    };

    const bf = 0.15;
    const ductPct = Number(room.ductGainPct) || 2;
    const fanPct  = Number(room.fanGainPct) || 3;
    const senSafePct  = Number(room.sensibleSafetyPercent ?? room.sensibleSafetyFactor ?? 10);
    const latSafePct  = Number(room.latentSafetyPercent  ?? room.latentSafetyFactor  ?? 5);
    const ovlSafePct  = Number(room.overallSafetyPercent ?? room.grandTotalSafetyFactor ?? 3);

    const envelope  = calculateEnvelopeGain(elements, dc);
    const internal  = calculateInternalGains(rd);
    const vent      = calculateVentilationLoad(rd, dc);
    const erSens    = envelope.sensible + internal.sensible + vent.sensible * bf;
    const erLat     = internal.latent + vent.latent * bf;
    const parasitic = calculateParasiticGains(erSens, erSens, ductPct, fanPct);
    const ersh = (erSens + parasitic.ductGain + parasitic.fanGain) * (1 + senSafePct / 100);
    const erlh = erLat * (1 + latSafePct / 100);
    const coilSen   = ersh + vent.sensible * (1 - bf);
    const coilLat   = erlh + vent.latent   * (1 - bf);
    const grandTotalTR = (ersh + erlh + vent.sensible * (1 - bf) + vent.latent * (1 - bf)) / 12000;

    const presetACH  = getRecommendedAch(room.achProfile ?? room.activityType);
    const totalACH   = Math.max(presetACH, rd.facph);
    const supplyCFM  = (calculateRoomVolume(rd) * totalACH) / 60;
    const coilParams = calculateCoilParameters(coilSen, coilLat, dc.indoorTemp, dc.indoorHumidity, dc.altitude || 0, bf, 35, 65, getMinAdp(systemType));
    const designCFM  = Math.max(coilParams.dehumidifiedCFM, supplyCFM);
    const cfmTR      = designCFM / 400;
    const governingTR = Math.max(grandTotalTR, cfmTR);
    const requiredTR  = governingTR * (1 + ovlSafePct / 100);

    // Monsoon season
    const mDc = { ...dc, outdoorTemp: monsoonTemp, outdoorHumidity: monsoonHum };
    const mEnv = calculateEnvelopeGain(elements, mDc);
    const mVent = calculateVentilationLoad(rd, mDc);
    const mErSens = mEnv.sensible + internal.sensible + mVent.sensible * bf;
    const mErLat  = internal.latent + mVent.latent * bf;
    const mPara   = calculateParasiticGains(mErSens, mErSens, ductPct, fanPct);
    const mCoilSen = (mErSens + mPara.ductGain + mPara.fanGain) * (1 + senSafePct / 100) + mVent.sensible * (1 - bf);
    const mCoilLat = mErLat * (1 + latSafePct / 100) + mVent.latent * (1 - bf);
    const mTotalTR = (mCoilSen + mCoilLat) / 12000;
    const mCoilP   = calculateCoilParameters(mCoilSen, mCoilLat, dc.indoorTemp, dc.indoorHumidity, dc.altitude || 0, bf, 35, 65, getMinAdp(systemType));
    const mDesignCFM  = Math.max(mCoilP.dehumidifiedCFM, supplyCFM);
    const mCfmTR      = mDesignCFM / 400;
    const monsoonGoverningTR = Math.max(mTotalTR, mCfmTR);
    const monsoonRequiredTR  = monsoonGoverningTR * (1 + ovlSafePct / 100);

    const overallGoverningTR = incMonsoon ? Math.max(governingTR, monsoonGoverningTR) : governingTR;
    const overallRequiredTR  = incMonsoon ? Math.max(requiredTR, monsoonRequiredTR)   : requiredTR;
    const overallDesignCFM   = incMonsoon ? Math.max(designCFM,  mDesignCFM)          : designCFM;

    return {
      requiredTR, governingTR, designCFM,
      monsoonLoadTR: mTotalTR, monsoonGoverningTR, monsoonRequiredTR, monsoonDesignCFM: mDesignCFM,
      overallGoverningTR, overallRequiredTR, overallDesignCFM,
    };
  };

  const recalcSystemRooms = async () => {
    if (!project?.id || !selectedSystemId) return;
    const sysRooms = rooms.filter((r: any) => r.zoneId === selectedSystemId || r.systemId === selectedSystemId);
    if (sysRooms.length === 0) return;
    setRecalcLoading(true);
    try {
      const results: Record<string, any> = {};
      await Promise.all(sysRooms.map(async (room: any) => {
        const cached = envelopeCache.get(project.id, room.id);
        let elements: any[];
        if (cached) {
          elements = cached;
        } else {
          const elemSnap = await getDocs(collection(db, 'projects', project.id, 'rooms', room.id, 'envelopeElements'));
          elements = elemSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          envelopeCache.set(project.id, room.id, elements);
        }
        results[room.id] = computeRoomReqs(room, elements);
      }));
      setRecalcResults(prev => ({ ...prev, ...results }));
    } catch {
      toast.error('Load recalculation failed');
    } finally {
      setRecalcLoading(false);
    }
  };

  // Auto-recalc when selected system changes
  useEffect(() => {
    if (selectedSystemId && project?.id) {
      void recalcSystemRooms();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSystemId, project?.id]);

  // getRoomReqs: prefer live recalculated results over stored _calc* snapshot
  const getRoomReqs = (roomId: string) => {
    const live = recalcResults[roomId];
    if (live) return live;
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
    };
  };

  // Computed from room documents — single source of truth shared with Load Calculator
  const systemRoomIds = useMemo(
    () => selectedSystemId
      ? rooms.filter((r: any) => r.zoneId === selectedSystemId || r.systemId === selectedSystemId).map((r: any) => r.id)
      : [],
    [rooms, selectedSystemId],
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
  const unassignedRooms = rooms.filter(r => !allAssignedIds.has(r.id));

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
  const totalDesignCFM         = assignedRoomReqs.reduce((s, r) => s + r.overallDesignCFM, 0);
  const totalSummerRequiredTR  = assignedRoomReqs.reduce((s, r) => s + r.requiredTR, 0);
  const totalMonsoonRequiredTR = assignedRoomReqs.reduce((s, r) => s + r.monsoonRequiredTR, 0);
  const totalMonsoonThermalTR  = assignedRoomReqs.reduce((s, r) => s + r.monsoonLoadTR, 0);
  const totalSummerDesignCFM   = assignedRoomReqs.reduce((s, r) => s + r.designCFM, 0);
  const totalMonsoonDesignCFM  = assignedRoomReqs.reduce((s, r) => s + r.monsoonDesignCFM, 0);
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
      z.totalCFM += reqs.overallDesignCFM;
    }
    return Array.from(zoneMap.values());
  }, [selectedSystem, systemRoomIds, rooms]);

  // Per-zone data for SpecSheet AHU unit-wise breakdown (all system types)
  const zoneUnitsForSpec = useMemo(() => {
    if (!selectedSystem) return [];
    type ZEntry = { zoneName: string; requiredTR: number; designCFM: number; oaCFM: number };
    const zoneMap = new Map<string, ZEntry>();
    for (const roomId of systemRoomIds) {
      const room = rooms.find((r: any) => r.id === roomId) as any;
      if (!room) continue;
      const zId = room.zoneId ?? selectedSystem.id;
      const zName = room.zoneName ?? selectedSystem.name;
      if (!zoneMap.has(zId)) zoneMap.set(zId, { zoneName: zName, requiredTR: 0, designCFM: 0, oaCFM: 0 });
      const z = zoneMap.get(zId)!;
      const reqs = getRoomReqs(roomId);
      z.requiredTR += reqs.overallRequiredTR;
      z.designCFM += reqs.overallDesignCFM;
      const vol = calculateRoomVolume(room);
      z.oaCFM += vol * (Number(room.facph) || 0) / 60;
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
      const reheat   = r.analysis?.reheat;
      const dehumid  = moisture?.action === 'Dehumidify' ? (Number(moisture.rate) || 0) : 0;
      const humid    = moisture?.action === 'Humidify'   ? (Number(moisture.rate) || 0) : 0;
      const reheatBTU = reheat?.needed ? (Number(reheat.reheatBTU) || 0) : 0;
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
    const sysType    = String(project?.systemType ?? '').toLowerCase();
    const minAdp     = sysType === 'chiller' ? 44 : sysType === 'vrf' ? 42 : 44;

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

  // Chiller sizes on the governing required TR (max of summer and monsoon, considering both thermal and CFM-based loads).
  // The AHU coil must handle all load components, so the chiller must meet the full required TR.
  const chillerSummerThermalTR = totalSummerRequiredTR;
  const chillerThermalTR = includeMonsoon && totalMonsoonRequiredTR > chillerSummerThermalTR
    ? totalMonsoonRequiredTR
    : chillerSummerThermalTR;

  // Diversity-adjusted chiller plant capacity (not all zones peak simultaneously)
  const chillerDiverseTR = selectedSystem?.type === 'Chiller'
    ? chillerThermalTR * (selectedSystem.diversityFactor ?? 0.75)
    : 0;

  // Effective chiller units — combines new chillerUnits[] with legacy unitSelection for display
  const effectiveChillerUnits = useMemo((): ODUCombinationUnit[] => {
    if (!selectedSystem || selectedSystem.type !== 'Chiller') return [];
    const units: ODUCombinationUnit[] = (selectedSystem as any).chillerUnits ?? [];
    if (units.length > 0) return units;
    const leg = selectedSystem.unitSelection;
    if (leg) return [{ modelId: leg.modelId, brand: leg.brand, modelSeries: leg.modelSeries, trCapacity: leg.trCapacity, quantity: leg.quantity ?? 1 }];
    return [];
  }, [selectedSystem]);

  const chillerTotalInstalledTR = effectiveChillerUnits.reduce((s, u) => s + u.trCapacity * u.quantity, 0);

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
          rows.push({
            key: `${sys.id}-fahu-humid-${zone.id}`,
            type: 'Humidifier', systemName: sys.name, roomName: zone.name,
            brand: 'Steam/Electric', model: `${zone.fahu.humidifierKgHr} kg/hr Humidifier`,
            subType: 'Humidification', tr: 0, qty: 1,
          });
        }
      }
    }
    return rows;
  }, [equipSystems, rooms]);

  // ── Project-wide system summary (Phase 7) ─────────────────────────────────
  const systemSummaries = useMemo(() => {
    return equipSystems.map(sys => {
      const sysRooms = (rooms as any[]).filter(r => r.zoneId === sys.id || r.systemId === sys.id);
      const roomCount = sysRooms.length;

      const requiredTR = sysRooms.reduce((sum: number, r: any) => {
        const live = recalcResults[r.id];
        if (live) return sum + (live.overallRequiredTR ?? live.requiredTR ?? 0);
        return sum + Number(r._calcOverallRequiredTR ?? r._calcRequiredTR ?? 0);
      }, 0);

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
        const units: any[] = (sys as any).chillerUnits ?? [];
        installedTR = units.reduce((s: number, u: any) => s + u.trCapacity * ((u.quantity ?? 1) as number), 0);
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

      return { id: sys.id, name: sys.name, type: sys.type as SystemType, roomCount, requiredTR, installedTR, status };
    });
  }, [equipSystems, rooms, recalcResults]);

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
        <div className="flex items-baseline gap-3">
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Equipment Selection</h2>
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
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="w-5 h-5 text-blue-600" />
                  <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Sync: Zones ↔ Systems</h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Equipment systems and Load Calculator zones are separate. Use these actions to keep them in sync for <strong>{project?.name}</strong>.
                </p>

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
                            <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">({n as number} rooms)</span>
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
                    <ArrowLeftRight className="w-3.5 h-3.5" /> Sync with Load Calculator
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
                            <Input
                              type="number" min="0.5" max="1.0" step="0.05"
                              className="h-7 w-16 text-xs text-center p-1"
                              value={selectedSystem.diversityFactor ?? 0.75}
                              onChange={e => updateSystemField(selectedSystem.id, { diversityFactor: parseFloat(e.target.value) || 0.75 })}
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
                      <Button size="sm" variant="ghost"
                        className={cn('h-8 text-sm gap-1 shrink-0', recalcLoading ? 'text-blue-500' : 'text-slate-400 hover:text-emerald-600')}
                        title="Recalculate loads from design engine"
                        disabled={recalcLoading}
                        onClick={() => void recalcSystemRooms()}>
                        <RotateCcw className={cn('w-3.5 h-3.5', recalcLoading && 'animate-spin')} />
                        {recalcLoading ? 'Calculating…' : 'Refresh Loads'}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 text-sm gap-1 text-slate-400 hover:text-blue-600 shrink-0"
                        title="Rename / change type"
                        onClick={() => { setEditingSystemId(selectedSystem.id); setEditingSystemName(selectedSystem.name); setEditingSystemType(selectedSystem.type); }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

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
                          const zoneTR  = zoneRooms.reduce((s: number, r: any) => s + (Number(r._calcOverallRequiredTR) || Number(r._calcRequiredTR) || 0), 0);
                          const zoneCFM = zoneRooms.reduce((s: number, r: any) => s + (Number(r._calcOverallDesignCFM) || Number(r._calcDesignCFM) || 0), 0);
                          const zoneNeedsHumidifier = zoneRooms.some((r: any) => r.includeHumidifier);
                          const isRenaming = renamingZoneId === zone.id;

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
                                  {zoneTR > 0 && (
                                    <span className="text-sm px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 font-mono font-semibold">
                                      {zoneTR.toFixed(2)} TR · {Math.round(zoneCFM).toLocaleString()} CFM
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
                                {zoneRooms.map((r: any) => (
                                  <span key={r.id} className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 font-medium">
                                    {r.name}
                                    {r.floor && <span className="text-sm text-blue-400 dark:text-blue-500">{r.floor}</span>}
                                    <button onClick={() => void handleRemoveRoomFromZone(zone.id, r.id)}
                                      className="text-blue-400 hover:text-red-500 leading-none ml-0.5 text-base font-bold">×</button>
                                  </span>
                                ))}
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
                                  <div className="flex items-center gap-3">
                                    {zone.selection ? (
                                      <>
                                        <span className="text-base font-semibold text-emerald-700 dark:text-emerald-400 flex-1 flex items-center gap-2 flex-wrap">
                                          {zone.selection.brand} {zone.selection.modelSeries} · {zone.selection.trCapacity} TR
                                          {zone.selection.isCustom && <span className="text-sm font-bold px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-700">Custom</span>}
                                        </span>
                                        <Button size="sm" variant="outline" className="h-9 text-sm px-3"
                                          onClick={() => setZoneEquipPicker({ zoneId: zone.id, zoneName: zone.name, totalTR: zoneTR, totalCFM: zoneCFM })}>
                                          Change
                                        </Button>
                                        <button className="text-slate-400 hover:text-red-500 p-1.5"
                                          onClick={() => void handleClearZoneEquip(zone.id)}>
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </>
                                    ) : (
                                      <Button size="sm" variant="default" className="h-9 text-sm px-4"
                                        onClick={() => setZoneEquipPicker({ zoneId: zone.id, zoneName: zone.name, totalTR: zoneTR, totalCFM: zoneCFM })}>
                                        Select {selectedSystem.type === 'VRF' ? 'IDU' : selectedSystem.type === 'AHU' ? 'AHU (DX)' : 'AHU / FCU'}
                                      </Button>
                                    )}
                                  </div>

                                  {/* FAHU Accessories — VRF ductable/AHU zones only */}
                                  {selectedSystem.type === 'VRF' && zone.selection && FAHU_CAPABLE_SUBTYPES.has(zone.selection.subType ?? '') && (() => {
                                    const fahu = zone.fahu ?? { hasElectricHeater: false, electricHeaterKW: 0, hasHumidifier: false, humidifierKgHr: 0 };
                                    const suggestedHumidKgHr = zoneCFM > 0 ? parseFloat((zoneCFM * 0.000091).toFixed(1)) : 0;
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
                                              <input type="number" min={0} step={0.5}
                                                value={fahu.electricHeaterKW || ''}
                                                onChange={e => void handleUpdateZoneFahu(zone.id, { ...fahu, electricHeaterKW: parseFloat(e.target.value) || 0 })}
                                                className="w-16 h-8 text-sm font-mono border border-slate-300 dark:border-slate-600 rounded px-1.5 bg-white dark:bg-slate-800 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-orange-400"
                                                placeholder="kW" />
                                              <span className="text-xs text-slate-500 dark:text-slate-400">kW</span>
                                              <span className="text-xs text-slate-400 dark:text-slate-500 italic">· reheat / dehumidification</span>
                                            </div>
                                          )}
                                        </div>
                                        {/* Humidifier — only when room(s) in zone require it */}
                                        {zoneNeedsHumidifier && (
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
                                              <input type="number" min={0} step={0.1}
                                                value={fahu.humidifierKgHr || ''}
                                                onChange={e => void handleUpdateZoneFahu(zone.id, { ...fahu, humidifierKgHr: parseFloat(e.target.value) || 0 })}
                                                className="w-16 h-8 text-sm font-mono border border-slate-300 dark:border-slate-600 rounded px-1.5 bg-white dark:bg-slate-800 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                                placeholder="kg/hr" />
                                              <span className="text-xs text-slate-500 dark:text-slate-400">kg/hr</span>
                                              {suggestedHumidKgHr > 0 && !fahu.humidifierKgHr && (
                                                <button type="button"
                                                  className="text-xs text-blue-600 hover:underline"
                                                  onClick={() => void handleUpdateZoneFahu(zone.id, { ...fahu, humidifierKgHr: suggestedHumidKgHr })}>
                                                  Use est. {suggestedHumidKgHr} kg/hr
                                                </button>
                                              )}
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
                                                    await handleUpdateZoneEquipProps(zone.id, { coilType: newCoilType });
                                                    const hasHeat = isDXCoil
                                                      ? newCoilType === 'cooling-heating'
                                                      : newCoilType === 'cooling-heating' || ((selectedSystem.zones ?? []) as EquipmentZone[]).some(z => z.id !== zone.id && z.selection?.coilType === 'cooling-heating');
                                                    await updateAHUCfg({ hasHeatingCoil: hasHeat });
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
                                              <input
                                                type="number"
                                                min={0} step={25}
                                                value={ahuCfg.extStaticPa ?? 150}
                                                onChange={e => void updateAHUCfg({ extStaticPa: Math.max(0, parseInt(e.target.value) || 0) })}
                                                className="w-24 h-8 text-sm font-mono border border-slate-300 dark:border-slate-600 rounded-md px-2.5 bg-white dark:bg-slate-800 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-400"
                                              />
                                              <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">Pa</span>
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

                                        {zoneNeedsHumidifier && (
                                          <div className="text-xs text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-900/30 border border-sky-300 dark:border-sky-700 rounded-md px-3 py-2 font-medium">
                                            💧 This zone has rooms requiring a humidifier — include humidifier section in AHU specification.
                                          </div>
                                        )}
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
                                        return (
                                          <div key={r.id} className="flex items-start gap-2.5 px-3 py-2">
                                            <div className="flex-1 min-w-0">
                                              <div className="flex items-center gap-1.5">
                                                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{r.name}</span>
                                                {r.floor && <span className="text-xs text-slate-400 dark:text-slate-500">{r.floor}</span>}
                                                {reqTR > 0 && <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">{reqTR.toFixed(2)} TR req.</span>}
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
                                      onClick={() => setZoneMultiUnitPicker({ zoneId: zone.id, zoneName: zone.name, totalTR: zoneTR, totalCFM: zoneCFM })}>
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

                    {/* Unassigned rooms pool */}
                    {(() => {
                      const zoneRoomSet = new Set(((selectedSystem.zones ?? []) as EquipmentZone[]).flatMap((z: EquipmentZone) => z.roomIds));
                      const unassigned = rooms.filter((r: any) => !zoneRoomSet.has(r.id));
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
                            <span className="text-slate-500 dark:text-slate-400">Σ Zone Load:</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200">{chillerThermalTR.toFixed(2)} TR</span>
                          </div>
                          <span className="text-slate-300 dark:text-slate-600">×</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500 dark:text-slate-400">Diversity:</span>
                            <Input
                              type="number" min="0.5" max="1.0" step="0.05"
                              className="h-7 w-14 text-xs text-center p-1"
                              value={selectedSystem.diversityFactor ?? 0.75}
                              onChange={e => void updateSystemField(selectedSystem.id, { diversityFactor: parseFloat(e.target.value) || 0.75 })}
                            />
                            <span className="font-bold text-indigo-700 dark:text-indigo-400">{chillerDiverseTR.toFixed(2)} TR</span>
                            <span className="text-slate-400 dark:text-slate-500 italic">plant capacity required</span>
                          </div>
                          {chillerTotalInstalledTR > 0 && (
                            <>
                              <span className="text-slate-300 dark:text-slate-600">→</span>
                              <span className={cn('font-semibold text-xs', chillerTotalInstalledTR >= chillerDiverseTR * 0.98 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                                Installed: {chillerTotalInstalledTR.toFixed(1)} TR
                                {chillerTotalInstalledTR >= chillerDiverseTR * 0.98 ? ' ✓' : ` (need ${(chillerDiverseTR - chillerTotalInstalledTR).toFixed(1)} TR more)`}
                              </span>
                            </>
                          )}
                        </div>

                        {/* Chiller unit list */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Chillers:</span>
                            <Button size="sm" variant="default" className="h-8 text-xs px-3 gap-1.5 bg-indigo-600 hover:bg-indigo-700"
                              onClick={() => setUnitPicker(true)}>
                              <Plus className="w-3.5 h-3.5" /> Add Chiller
                            </Button>
                          </div>
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
                                      <span>{u.brand} {u.modelSeries} · {u.trCapacity} TR each</span>
                                      {u.quantity > 1 && <span className="text-indigo-700 dark:text-indigo-400 font-bold">= {(u.trCapacity * u.quantity).toFixed(0)} TR total</span>}
                                      {isLegacy && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">legacy</span>}
                                    </span>
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
                          <div className="flex items-center gap-3 flex-wrap border-t border-blue-100 dark:border-blue-900/40 pt-3">
                            <span className="text-sm font-semibold text-slate-600 dark:text-slate-400 w-10 shrink-0">CT:</span>
                            {selectedSystem.ctSelection ? (
                              <div className="flex items-center gap-2 flex-1">
                                <span className="text-sm font-semibold text-cyan-700 dark:text-cyan-400">
                                  {selectedSystem.ctSelection.quantity && selectedSystem.ctSelection.quantity > 1 && <span className="text-blue-600 mr-1">{selectedSystem.ctSelection.quantity}×</span>}
                                  {selectedSystem.ctSelection.brand} {selectedSystem.ctSelection.modelSeries} · {selectedSystem.ctSelection.trCapacity} TR
                                </span>
                                <Button size="sm" variant="outline" className="h-8 text-sm px-2" onClick={() => setCtFormOpen(true)}>Change</Button>
                                <button className="text-slate-400 hover:text-red-500 p-1" onClick={() => clearCTUnit(selectedSystem.id)}><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                            ) : (
                              <Button size="sm" variant="outline" className="h-8 text-sm px-3 border-cyan-300 text-cyan-700 hover:bg-cyan-50" onClick={() => setCtFormOpen(true)}>
                                + Add Cooling Tower
                              </Button>
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
                                {u.staticPressurePa && <span className="text-orange-600 dark:text-orange-400 text-xs ml-0.5">{u.staticPressurePa} Pa</span>}
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
                            const units: IDUSelection[] = (selectedSystem.roomSelections ?? {})[room.id] ?? [];
                            const totalUnitTR = units.reduce((s, u) => s + u.trCapacity, 0);
                            const fits = totalUnitTR >= reqs.requiredTR * 0.98;
                            return (
                              <div key={room.id} className="p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{room.name}</span>
                                    {room.floor && <span className="text-xs text-slate-400 dark:text-slate-500">{room.floor}</span>}
                                    {reqs.requiredTR > 0 && (
                                      <span className="text-sm font-mono text-slate-500 dark:text-slate-400">{reqs.requiredTR.toFixed(2)} TR req.</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {units.length > 0 && (
                                      <span className={cn('text-sm font-mono font-semibold', fits ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                                        {totalUnitTR.toFixed(1)} TR fitted
                                      </span>
                                    )}
                                    <Button size="sm" variant="outline" className="h-8 text-sm px-2 gap-0.5 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20"
                                      onClick={() => setRoomUnitPicker({ roomId: room.id, roomName: room.name, reqTR: reqs.requiredTR, reqCFM: reqs.designCFM })}>
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
                                ? <>{includeMonsoon && <span className="mr-1">{governingSeason} ·</span>}Plant (×{(selectedSystem.diversityFactor ?? 0.75).toFixed(2)} div.): <span className="font-semibold text-indigo-700 dark:text-indigo-400">{chillerDiverseTR.toFixed(1)} TR</span></>
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
                            const totalTR = zoneRooms.reduce((s: number, r: any) => s + (Number(r._calcRequiredTR) || 0), 0);
                            const totalCFM = zoneRooms.reduce((s: number, r: any) => s + (Number(r._calcDesignCFM) || 0), 0);
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
                                          onClick={() => setZonePicker({ zoneId: zone.id, zoneName: zone.name, totalTR, totalCFM })}>
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
                            const qty     = roomQuantities[roomId] ?? 1;
                            const trPerUnit = reqs.requiredTR > 0 ? reqs.requiredTR / qty : 0;
                            const cfmPerUnit = reqs.designCFM > 0 ? reqs.designCFM / qty : 0;
                            const idus  = normalizeIDUList((selectedSystem.iduSelections as any)[roomId]);
                            const totalInstalledTR = idus.reduce((s, u) => s + u.trCapacity * (u.quantity ?? 1), 0);
                            const fit   = idus.length > 0 ? getFitStatus(totalInstalledTR, 0, reqs.requiredTR, 0) : 'unknown';
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
                                <TableCell className="text-right font-mono text-sm">{reqs.requiredTR > 0 ? reqs.requiredTR.toFixed(2) : '—'}</TableCell>
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
                                      onClick={() => setIduPicker({ roomId, roomName: room?.name ?? roomId, reqTR: reqs.requiredTR, reqCFM: reqs.designCFM })}>
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
                      chillerPlantTR={selectedSystem.type === 'Chiller' ? chillerDiverseTR : 0}
                      zoneUnits={zoneUnitsForSpec}
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
        <TabsContent value="summary" className="space-y-8">

          {/* System Status Table */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">System Load Summary</h3>
                <p className="text-slate-500 dark:text-slate-400 text-xs">Required TR from stored load snapshots. Open each system in System Design and click "Refresh Loads" for live values.</p>
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
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 dark:bg-slate-800 text-xs uppercase">
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>System</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Rooms</TableHead>
                      <TableHead className="text-right">Required TR</TableHead>
                      <TableHead className="text-right">Installed TR</TableHead>
                      <TableHead className="text-right">Coverage</TableHead>
                      <TableHead>Status</TableHead>
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
                        </TableRow>
                      );
                    })}
                    {systemSummaries.length > 1 && (
                      <TableRow className="bg-slate-50 dark:bg-slate-800 text-sm font-bold border-t-2 border-slate-200 dark:border-slate-700">
                        <TableCell colSpan={3} className="text-slate-500 dark:text-slate-400 uppercase text-xs tracking-wide py-2">Project Total</TableCell>
                        <TableCell className="text-right font-mono py-2">{systemSummaries.reduce((s, x) => s + x.roomCount, 0)}</TableCell>
                        <TableCell className="text-right font-mono py-2">{systemSummaries.reduce((s, x) => s + x.requiredTR, 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono py-2">{systemSummaries.reduce((s, x) => s + x.installedTR, 0).toFixed(2)}</TableCell>
                        <TableCell colSpan={2} />
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
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 dark:bg-slate-800 text-xs uppercase">
                      <TableHead>Type</TableHead>
                      <TableHead>Room / Zone</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Model</TableHead>
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
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drawings.map(d => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium dark:text-slate-200">{d.name}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{d.type}</Badge></TableCell>
                        <TableCell className="text-sm text-slate-500 dark:text-slate-400">{d.format}</TableCell>
                        <TableCell className="text-sm text-slate-500 dark:text-slate-400">{d.version}</TableCell>
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
                    ))}
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
          roomName={`${zoneEquipPicker.zoneName} (${zoneEquipPicker.totalTR.toFixed(2)} TR)`}
          requiredTR={zoneEquipPicker.totalTR}
          designCFM={zoneEquipPicker.totalCFM}
          lockedBrand={null}
          onSelect={sel => handleSelectZoneEquip(zoneEquipPicker.zoneId, sel)}
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
                Cooling Tower Specification
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-1">
              <div className="bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800 rounded px-3 py-2 text-xs text-cyan-700 dark:text-cyan-300">
                Computed duty: <span className="font-bold">{(chillerDiverseTR * 1.25).toFixed(1)} TR</span>
                <span className="text-cyan-500 dark:text-cyan-400 ml-1">({(chillerThermalTR * 1.25 * 3.517).toFixed(0)} kW heat rejection, assuming COP ≈ 5)</span>
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
                  <Input className="mt-1 h-9 text-sm" type="number" min="0" step="0.5"
                    value={ctForm.trCapacity}
                    onChange={e => setCtForm(f => ({ ...f, trCapacity: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div>
                  <Label className="text-sm font-semibold uppercase text-slate-600 dark:text-slate-400">Quantity</Label>
                  <Input className="mt-1 h-9 text-sm" type="number" min="1" max="10"
                    value={ctForm.quantity}
                    onChange={e => setCtForm(f => ({ ...f, quantity: parseInt(e.target.value) || 1 }))} />
                </div>
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button variant="outline" className="text-xs" onClick={() => setCtFormOpen(false)}>Cancel</Button>
              <Button className="text-xs gap-1.5 bg-cyan-600 hover:bg-cyan-700"
                disabled={!ctForm.brand || !ctForm.modelSeries || ctForm.trCapacity <= 0}
                onClick={() => saveCTUnit(selectedSystem.id)}>
                <Plus className="w-3.5 h-3.5" />Save CT
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

      {/* ── Unit Picker — AHU (DX condensing unit) and Chiller (plant section) ── */}
      {selectedSystem && (selectedSystem.type === 'AHU' || selectedSystem.type === 'Chiller') && (
        <UnitPickerDialog
          open={unitPicker}
          onClose={() => setUnitPicker(false)}
          systemType={selectedSystem.type as 'AHU' | 'Chiller'}
          packageSubType={selectedSystem.packageSubType}
          requiredTR={
            selectedSystem.type === 'Chiller'
              ? Math.max(0.5, chillerDiverseTR - chillerTotalInstalledTR)
              : (unitQuantity > 1 ? totalRequiredTR / unitQuantity : totalRequiredTR)
          }
          designCFM={unitQuantity > 1 ? totalDesignCFM / unitQuantity : totalDesignCFM}
          customItems={customEquipment}
          systemName={selectedSystem.name}
          onSaveToLibrary={async (item) => { await saveCustomEquipment_item(item); }}
          onSelect={sel => {
            if (selectedSystem.type === 'Chiller') {
              void addChillerUnit(selectedSystem.id, sel);
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
    </div>
  );
}
