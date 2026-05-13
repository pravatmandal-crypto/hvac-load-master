/**
 * Global Equipment Library UI
 * Manages the Firestore-backed global equipment catalog (project-agnostic).
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { auth } from '../../lib/firebase';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/table';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import {
  getAllLibraryItems, addLibraryItem, updateLibraryItem, deleteLibraryItem,
  seedLibraryFromCatalog, syncNewCatalogItems, importFromCSV, exportToCSV, getCSVTemplate,
  migrateFromLegacyCollections, deleteAllLegacyEquipment,
} from '../../services/equipmentLibraryService';
import type { EquipmentModel } from '../../constants/equipment-catalog';
import { IDU_SUBTYPE_LABELS } from '../../constants/equipment-catalog';
import {
  Plus, Trash2, Pencil, Search, Download, Upload, Database, BookOpen,
  RefreshCw, ChevronLeft, ChevronRight, X, AlertTriangle, CheckCircle2,
  Package, Filter,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { ComboboxInput } from '../ui/combobox-input';

// ─── Types ────────────────────────────────────────────────────────────────────

type FormState = Partial<EquipmentModel>;

const EQUIPMENT_TYPES = [
  'VRF-ODU', 'VRF-IDU', 'Chiller', 'ChillerIDU', 'Package',
  'DuctableSplit', 'AHU', 'FCU', 'Humidifier', 'Dehumidifier',
  'CoolingTower', 'Boiler', 'Split', 'Pump', 'VRF',
];

const PAGE_SIZE = 50;

const BLANK_FORM: FormState = {
  brand: '',
  type: 'VRF-IDU',
  subType: '',
  modelSeries: '',
  capacityTR: undefined,
  ratedAirflowCFM: undefined,
  staticPressurePa: undefined,
  powerInputKW: undefined,
  eer: undefined,
  cop: undefined,
  refrigerant: '',
  dischargeType: undefined,
  compressorType: undefined,
  minConnectionPct: undefined,
  maxConnectionPct: undefined,
  description: '',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function numField(v: number | undefined | null) { return v != null ? String(v) : ''; }
function parseNum(s: string) { const n = parseFloat(s); return isNaN(n) ? undefined : n; }

function TypeBadge({ type }: { type: string }) {
  const cls =
    type === 'VRF-IDU'  ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800' :
    type === 'VRF-ODU'  ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800' :
    type === 'Chiller'  ? 'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800' :
    type === 'AHU'      ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800' :
    type === 'FCU'      ? 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800' :
    type === 'Package'  ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800' :
    'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600';
  return <Badge variant="outline" className={cn('text-xs whitespace-nowrap', cls)}>{type}</Badge>;
}

// ─── Form constants ───────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  'VRF-ODU':      'VRF Outdoor Unit',
  'VRF-IDU':      'VRF Indoor Unit',
  'Chiller':      'Chiller',
  'ChillerIDU':   'Chiller Indoor Unit (AHU/FCU)',
  'CoolingTower': 'Cooling Tower',
  'Package':      'Package Unit',
  'DuctableSplit':'Ductable Split',
  'AHU':          'Air Handling Unit (AHU)',
  'FCU':          'Fan Coil Unit (FCU)',
  'Split':        'Split AC',
  'Humidifier':   'Humidifier',
  'Dehumidifier': 'Dehumidifier',
  'Boiler':       'Boiler / Heater',
  'Pump':         'Pump',
  'DOAS':         'DOAS / Fresh Air Unit',
};

const SUBTYPE_BY_TYPE: Record<string, string[]> = {
  'VRF-IDU':      ['Hi-Wall', 'Ductable (Low Static)', 'Ductable (Mid Static)', 'Ductable (High Static)', '1-Way Cassette', '2-Way Cassette', '4-Way Cassette', '360° Cassette', 'AHU with DX Coil', 'Fresh Air (TFA)'],
  'VRF-ODU':      ['Heat Pump', 'Cooling Only', 'Heat Recovery'],
  'Chiller':      ['Air Cooled Scroll', 'Water Cooled Scroll', 'Air Cooled Screw', 'Water Cooled Screw', 'Air Cooled Scroll Modular', 'Centrifugal', 'Absorption'],
  'ChillerIDU':   ['AHU-Hydro', 'FCU', 'Floor Standing FCU', 'Ceiling Hung FCU'],
  'CoolingTower': ['FRP Induced Draft', 'FRP Forced Draft', 'Galvanized Induced Draft', 'Galvanized Forced Draft', 'Hybrid'],
  'Package':      ['Air Cooled', 'Water Cooled', 'Rooftop'],
  'DuctableSplit':['Inverter', 'Fixed Speed'],
  'AHU':          ['Draw-Through', 'Blow-Through', 'Horizontal', 'Vertical'],
  'FCU':          ['Floor Standing', 'Ceiling Hung', '2-Pipe', '4-Pipe'],
  'Split':        ['Hi-Wall Inverter', 'Hi-Wall Fixed', 'Window', 'Portable'],
  'Humidifier':   ['Ultrasonic', 'Heater-Based', 'Steam', 'Evaporative'],
  'Dehumidifier': ['Refrigerant-Based', 'Desiccant'],
  'Boiler':       ['Gas Fired', 'Electric', 'Oil Fired', 'Heat Pump'],
  'Pump':         ['Chilled Water', 'Condenser Water', 'Hot Water'],
  'DOAS':         ['Energy Recovery', 'Without ERV', 'Rotary Wheel', 'Plate HX'],
};

const REFRIGERANT_OPTIONS = ['R32', 'R410A', 'R407C', 'R22', 'R134a', 'R1234ze', 'R290', 'R600a', 'NH3 (R717)'];

// Types where static pressure (ESP) is relevant
const ESP_TYPES = new Set(['VRF-IDU', 'DuctableSplit', 'AHU', 'Package', 'DOAS', 'ChillerIDU']);
// Types where EER/COP are relevant
const PERF_TYPES = new Set(['VRF-IDU', 'VRF-ODU', 'Chiller', 'Package', 'DuctableSplit', 'Split', 'AHU', 'DOAS']);

// ─── Form Panel ───────────────────────────────────────────────────────────────

function EquipmentForm({
  form, setForm, onSave, onCancel, saving, isEdit, brandOptions,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isEdit: boolean;
  brandOptions: string[];
}) {
  function field(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }));
  }
  function numInput(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [key]: parseNum(e.target.value) }));
  }

  const t = form.type ?? '';
  const isVrfOdu  = t === 'VRF-ODU';
  const showEsp   = ESP_TYPES.has(t);
  const showPerf  = PERF_TYPES.has(t);
  const subTypeOpts = SUBTYPE_BY_TYPE[t] ?? [];

  function F({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-1.5">
          <Label className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
            {label}{required && <span className="text-red-500 ml-0.5">*</span>}
          </Label>
          {hint && <span className="text-[10px] text-slate-400 dark:text-slate-500">{hint}</span>}
        </div>
        {children}
      </div>
    );
  }

  function UnitInput({ unit, ...props }: React.ComponentProps<typeof Input> & { unit: string }) {
    return (
      <div className="relative">
        <Input {...props} className={cn('h-9 text-sm pr-10', props.className)} />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400 dark:text-slate-500">{unit}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0">

      {/* ── Section 1: Equipment Type ─────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-4 rounded-full bg-blue-500" />
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Equipment Type</span>
          <span className="text-red-500 text-xs ml-0.5">*</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {EQUIPMENT_TYPES.map(tp => (
            <button
              key={tp}
              type="button"
              onClick={() => setForm(f => ({ ...f, type: tp as any, subType: '' }))}
              className={cn(
                'px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
                form.type === tp
                  ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-300 dark:hover:border-blue-700 hover:text-blue-700 dark:hover:text-blue-300',
              )}
            >
              {TYPE_LABELS[tp] ?? tp}
            </button>
          ))}
        </div>
      </div>

      {/* ── Section 2: Identity ───────────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 rounded-full bg-indigo-500" />
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Identity</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <F label="Brand" required>
            <ComboboxInput inputClassName="h-9 text-sm" placeholder="e.g. Blue Star, Voltas, Daikin"
              value={form.brand ?? ''} onChange={v => setForm(f => ({ ...f, brand: v }))}
              options={brandOptions} />
          </F>
          <F label="Model / Series" required hint="(series name, not individual model number)">
            <Input className="h-9 text-sm" placeholder="e.g. XAC R407C Scroll" value={form.modelSeries ?? ''} onChange={field('modelSeries')} />
          </F>
          <F label="Sub-Type" hint={subTypeOpts.length ? '(select or type your own)' : ''}>
            <ComboboxInput inputClassName="h-9 text-sm" placeholder={subTypeOpts.length ? 'Select sub-type…' : 'e.g. Air Cooled Scroll'}
              value={form.subType ?? ''} onChange={v => setForm(f => ({ ...f, subType: v }))}
              options={subTypeOpts} />
          </F>
        </div>
      </div>

      {/* ── Section 3: Capacity & Airflow ────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 rounded-full bg-emerald-500" />
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Capacity</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <F label="Cooling Capacity" required hint="(TR)">
            <UnitInput type="number" unit="TR" placeholder="e.g. 1.5" value={numField(form.capacityTR)} onChange={numInput('capacityTR')} />
          </F>
          <F label="Rated Airflow" hint="(CFM)">
            <UnitInput type="number" unit="CFM" placeholder="e.g. 600" value={numField(form.ratedAirflowCFM)} onChange={numInput('ratedAirflowCFM')} />
          </F>
          {showEsp && (
            <F label="Static Pressure" hint="(external)">
              <UnitInput type="number" unit="Pa" placeholder="e.g. 80" value={numField(form.staticPressurePa)} onChange={numInput('staticPressurePa')} />
            </F>
          )}
          <F label="Power Input" hint="(kW)">
            <UnitInput type="number" unit="kW" placeholder="e.g. 4.5" value={numField(form.powerInputKW)} onChange={numInput('powerInputKW')} />
          </F>
        </div>
      </div>

      {/* ── Section 4: Performance & Refrigerant ─────────────────────────── */}
      <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 rounded-full bg-violet-500" />
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Performance & Refrigerant</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {showPerf && (
            <F label="EER" hint="(energy efficiency ratio)">
              <Input type="number" className="h-9 text-sm" placeholder="e.g. 11.8" value={numField(form.eer)} onChange={numInput('eer')} />
            </F>
          )}
          {showPerf && (
            <F label="COP" hint="(coeff. of performance)">
              <Input type="number" className="h-9 text-sm" placeholder="e.g. 3.5" value={numField(form.cop)} onChange={numInput('cop')} />
            </F>
          )}
          <F label="Refrigerant">
            <ComboboxInput inputClassName="h-9 text-sm" placeholder="e.g. R32"
              value={form.refrigerant ?? ''} onChange={v => setForm(f => ({ ...f, refrigerant: v }))}
              options={REFRIGERANT_OPTIONS} />
          </F>
          <F label="Notes / Description">
            <Input className="h-9 text-sm" placeholder="Optional — any notes" value={form.description ?? ''} onChange={field('description')} />
          </F>
        </div>
      </div>

      {/* ── Section 5: VRF-ODU specifics (conditional) ───────────────────── */}
      {isVrfOdu && (
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full bg-amber-500" />
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">VRF ODU Details</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <F label="Discharge Direction">
              <Select value={form.dischargeType ?? ''} onValueChange={v => setForm(f => ({ ...f, dischargeType: v as any || undefined }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— Not specified</SelectItem>
                  <SelectItem value="top">Top Discharge</SelectItem>
                  <SelectItem value="side">Side Discharge</SelectItem>
                </SelectContent>
              </Select>
            </F>
            <F label="Compressor Mode">
              <Select value={form.compressorType ?? ''} onValueChange={v => setForm(f => ({ ...f, compressorType: v as any || undefined }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— Not specified</SelectItem>
                  <SelectItem value="heat-pump">Heat Pump (Heating + Cooling)</SelectItem>
                  <SelectItem value="cooling-only">Cooling Only</SelectItem>
                </SelectContent>
              </Select>
            </F>
            <F label="Min IDU Connection" hint="(% of ODU capacity)">
              <UnitInput type="number" unit="%" placeholder="e.g. 50" value={numField(form.minConnectionPct)} onChange={numInput('minConnectionPct')} />
            </F>
            <F label="Max IDU Connection" hint="(% of ODU capacity)">
              <UnitInput type="number" unit="%" placeholder="e.g. 130" value={numField(form.maxConnectionPct)} onChange={numInput('maxConnectionPct')} />
            </F>
          </div>
          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
            Min/Max Connection % = total IDU capacity that can be connected to this ODU (e.g. 50–130 means 50% to 130% of ODU TR).
          </p>
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div className="px-6 py-4 flex items-center justify-between bg-slate-50/60 dark:bg-slate-800/40">
        <p className="text-xs text-slate-400 dark:text-slate-500"><span className="text-red-500">*</span> Required fields</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button className="gap-1.5 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600" onClick={onSave} disabled={saving}>
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {isEdit ? 'Save Changes' : 'Add to Library'}
          </Button>
        </div>
      </div>

    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function GlobalEquipmentLibrary() {
  const [items, setItems] = useState<EquipmentModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [search, setSearch] = useState('');
  const [filterBrand, setFilterBrand] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterSubType, setFilterSubType] = useState('all');
  const [filterRefrigerant, setFilterRefrigerant] = useState('all');
  const [filterSource, setFilterSource] = useState('all');
  const [filterMinTR, setFilterMinTR] = useState('');
  const [filterMaxTR, setFilterMaxTR] = useState('');
  const [page, setPage] = useState(0);

  // Form / modal state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...BLANK_FORM });
  const [saving, setSaving] = useState(false);

  // CSV import
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<{ added: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const userId = auth.currentUser?.uid;

  // ── Load items ──────────────────────────────────────────────────────────────
  async function loadItems() {
    setLoading(true);
    try {
      const data = await getAllLibraryItems();
      setItems(data);
    } catch (e: any) {
      toast.error('Failed to load library: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadItems();
    // Migrate any user-created equipment from legacy collections into the Global Library
    // so it is preserved and available across all projects, then remove the old collections.
    migrateFromLegacyCollections()
      .then(() => deleteAllLegacyEquipment())
      .catch(() => {});
  }, []);

  // ── Migrate legacy ──────────────────────────────────────────────────────────
  async function handleMigrate() {
    setMigrating(true);
    try {
      const result = await migrateFromLegacyCollections(userId);
      if (result.migrated > 0) {
        toast.success(`Migrated ${result.migrated} items from existing catalog`);
        await loadItems();
      } else {
        toast.info('No new items found to migrate (all already present or collections empty)');
      }
      if (result.errors.length > 0) {
        console.warn('Migration errors:', result.errors);
      }
    } catch (e: any) {
      toast.error('Migration failed: ' + e.message);
    } finally {
      setMigrating(false);
    }
  }

  // ── Seed ────────────────────────────────────────────────────────────────────
  async function handleSeed() {
    setSeeding(true);
    try {
      const count = await seedLibraryFromCatalog(userId);
      toast.success(`Seeded ${count} items from the built-in catalog`);
      await loadItems();
    } catch (e: any) {
      toast.error('Seed failed: ' + e.message);
    } finally {
      setSeeding(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const count = await syncNewCatalogItems(userId);
      if (count === 0) {
        toast.info('Library is already up to date — no new items found');
      } else {
        toast.success(`Added ${count} new item${count !== 1 ? 's' : ''} from the built-in catalog`);
        await loadItems();
      }
    } catch (e: any) {
      toast.error('Sync failed: ' + e.message);
    } finally {
      setSyncing(false);
    }
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────
  function openAdd() {
    setForm({ ...BLANK_FORM });
    setEditingId(null);
    setShowForm(true);
  }

  function openEdit(item: EquipmentModel) {
    setForm({ ...item });
    setEditingId(item.id);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setForm({ ...BLANK_FORM });
    setEditingId(null);
  }

  async function handleSave() {
    if (!form.brand?.trim()) { toast.error('Brand is required'); return; }
    if (!form.modelSeries?.trim()) { toast.error('Model/Series is required'); return; }
    if (!form.capacityTR || form.capacityTR <= 0) { toast.error('Capacity (TR) must be a positive number'); return; }
    if (!form.type) { toast.error('Type is required'); return; }

    setSaving(true);
    try {
      // For ADD: only include fields that have a value (sparse write).
      // For EDIT: write every field explicitly so cleared values overwrite old ones in Firestore.
      const base = {
        brand: form.brand!.trim(),
        type: form.type as any,
        modelSeries: form.modelSeries!.trim(),
        capacityTR: form.capacityTR!,
        capacityBTU: Math.round(form.capacityTR! * 12000),
      };

      const optionals = editingId
        ? {
            // Edit: always write every optional field — empty/falsy clears the Firestore value
            subType: form.subType?.trim() || null,
            ratedAirflowCFM: form.ratedAirflowCFM ?? null,
            staticPressurePa: form.staticPressurePa ?? null,
            powerInputKW: form.powerInputKW ?? null,
            eer: form.eer ?? null,
            cop: form.cop ?? null,
            refrigerant: form.refrigerant?.trim() || null,
            dischargeType: form.dischargeType || null,
            compressorType: form.compressorType || null,
            minConnectionPct: form.minConnectionPct ?? null,
            maxConnectionPct: form.maxConnectionPct ?? null,
            description: form.description?.trim() || null,
          }
        : {
            // Add: sparse — only include fields with a value
            ...(form.subType?.trim()     && { subType: form.subType.trim() }),
            ...(form.ratedAirflowCFM    !== undefined && { ratedAirflowCFM: form.ratedAirflowCFM }),
            ...(form.staticPressurePa   !== undefined && { staticPressurePa: form.staticPressurePa }),
            ...(form.powerInputKW       !== undefined && { powerInputKW: form.powerInputKW }),
            ...(form.eer                !== undefined && { eer: form.eer }),
            ...(form.cop                !== undefined && { cop: form.cop }),
            ...(form.refrigerant?.trim() && { refrigerant: form.refrigerant.trim() }),
            ...(form.dischargeType      && { dischargeType: form.dischargeType }),
            ...(form.compressorType     && { compressorType: form.compressorType }),
            ...(form.minConnectionPct   !== undefined && { minConnectionPct: form.minConnectionPct }),
            ...(form.maxConnectionPct   !== undefined && { maxConnectionPct: form.maxConnectionPct }),
            ...(form.description?.trim() && { description: form.description.trim() }),
          };

      const payload: Omit<EquipmentModel, 'id'> = { ...base, ...optionals } as any;

      if (editingId) {
        await updateLibraryItem(editingId, payload);
        toast.success('Equipment updated');
      } else {
        await addLibraryItem(payload, userId);
        toast.success('Equipment added to library');
      }
      closeForm();
      await loadItems();
    } catch (e: any) {
      toast.error('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, label: string) {
    if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
    try {
      await deleteLibraryItem(id);
      toast.success('Equipment deleted');
      setItems(prev => prev.filter(i => i.id !== id));
    } catch (e: any) {
      toast.error('Delete failed: ' + e.message);
    }
  }

  // ── CSV Export ──────────────────────────────────────────────────────────────
  function handleExport() {
    const csv = exportToCSV(filtered);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'equipment-library.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDownloadTemplate() {
    const csv = getCSVTemplate();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'equipment-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── CSV Import ──────────────────────────────────────────────────────────────
  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const text = await file.text();
    setImportErrors([]);
    setImportResult(null);
    try {
      const result = await importFromCSV(text, userId);
      setImportResult({ added: result.added });
      setImportErrors(result.errors);
      if (result.added > 0) {
        toast.success(`Imported ${result.added} equipment items`);
        await loadItems();
      } else {
        toast.warning('No items imported — check errors below');
      }
    } catch (e: any) {
      toast.error('Import failed: ' + e.message);
    }
  }

  // ── Cascading filter options ────────────────────────────────────────────────
  // Each level filters the items that pass all upstream selections.

  // Brand — always full list
  const brands = useMemo(() => {
    const set = new Set(items.map(i => i.brand));
    return Array.from(set).sort();
  }, [items]);

  // Type — only types that exist for the selected brand
  const afterBrand = useMemo(
    () => filterBrand === 'all' ? items : items.filter(i => i.brand === filterBrand),
    [items, filterBrand],
  );
  const types = useMemo(() => {
    const set = new Set(afterBrand.map(i => i.type));
    return Array.from(set).sort();
  }, [afterBrand]);

  // Sub-Type — only sub-types that exist for brand + type
  const afterType = useMemo(
    () => filterType === 'all' ? afterBrand : afterBrand.filter(i => i.type === filterType),
    [afterBrand, filterType],
  );
  const subTypes = useMemo(() => {
    const set = new Set(afterType.map(i => i.subType).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [afterType]);

  // Refrigerant — only refrigerants that exist for brand + type + sub-type
  const afterSubType = useMemo(
    () => filterSubType === 'all' ? afterType : afterType.filter(i => (i.subType ?? '') === filterSubType),
    [afterType, filterSubType],
  );
  const refrigerants = useMemo(() => {
    const set = new Set(afterSubType.map(i => i.refrigerant).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [afterSubType]);

  // Capacity TR range hint — min/max available for current brand+type+subtype selection
  const trRange = useMemo(() => {
    const trs = afterSubType.map(i => i.capacityTR).filter(n => n > 0);
    if (trs.length === 0) return null;
    return { min: Math.min(...trs), max: Math.max(...trs) };
  }, [afterSubType]);

  // Auto-reset downstream filters when their value is no longer in the available options
  useEffect(() => {
    if (filterType !== 'all' && !types.includes(filterType)) setFilterType('all');
  }, [types, filterType]);
  useEffect(() => {
    if (filterSubType !== 'all' && !subTypes.includes(filterSubType)) setFilterSubType('all');
  }, [subTypes, filterSubType]);
  useEffect(() => {
    if (filterRefrigerant !== 'all' && !refrigerants.includes(filterRefrigerant)) setFilterRefrigerant('all');
  }, [refrigerants, filterRefrigerant]);

  // ── Final filtered list (applies all active filters + search) ──────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const minTR = parseFloat(filterMinTR);
    const maxTR = parseFloat(filterMaxTR);
    return afterSubType.filter(i => {
      if (filterRefrigerant !== 'all' && (i.refrigerant ?? '') !== filterRefrigerant) return false;
      if (filterSource !== 'all' && ((i as any).source ?? 'catalog') !== filterSource) return false;
      if (!isNaN(minTR) && i.capacityTR < minTR) return false;
      if (!isNaN(maxTR) && i.capacityTR > maxTR) return false;
      if (q) {
        const haystack = `${i.brand} ${i.type} ${i.subType ?? ''} ${i.modelSeries} ${i.refrigerant ?? ''} ${i.description ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [afterSubType, search, filterRefrigerant, filterSource, filterMinTR, filterMaxTR]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const activeFilterCount = [
    filterBrand !== 'all', filterType !== 'all', filterSubType !== 'all',
    filterRefrigerant !== 'all', filterSource !== 'all',
    filterMinTR !== '', filterMaxTR !== '',
  ].filter(Boolean).length;

  function clearFilters() {
    setSearch(''); setFilterBrand('all'); setFilterType('all');
    setFilterSubType('all'); setFilterRefrigerant('all');
    setFilterSource('all'); setFilterMinTR(''); setFilterMaxTR('');
  }

  // Reset to page 0 when filters change
  useEffect(() => { setPage(0); }, [search, filterBrand, filterType, filterSubType, filterRefrigerant, filterSource, filterMinTR, filterMaxTR]);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total: items.length,
    brands: brands.length,
    userAdded: items.filter(i => (i as any).source === 'user').length,
    catalog: items.filter(i => (i as any).source === 'catalog').length,
  }), [items, brands]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Stats header */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Equipment', value: stats.total, color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-950/40 border-blue-100 dark:border-blue-900' },
          { label: 'Brands', value: stats.brands, color: 'text-indigo-700 dark:text-indigo-300', bg: 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-100 dark:border-indigo-900' },
          { label: 'From Catalog', value: stats.catalog, color: 'text-teal-700 dark:text-teal-300', bg: 'bg-teal-50 dark:bg-teal-950/40 border-teal-100 dark:border-teal-900' },
          { label: 'User Added', value: stats.userAdded, color: 'text-violet-700 dark:text-violet-300', bg: 'bg-violet-50 dark:bg-violet-950/40 border-violet-100 dark:border-violet-900' },
        ].map(s => (
          <div key={s.label} className={cn('rounded-xl border p-4', s.bg)}>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{s.label}</p>
            <p className={cn('text-2xl font-bold mt-0.5', s.color)}>
              {loading ? '…' : s.value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {/* Seed banner — shown when library is empty and not loading */}
      {!loading && items.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-5 space-y-4">
          <div className="flex items-start gap-4">
            <Database className="w-8 h-8 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-amber-800 dark:text-amber-300">Library is empty</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                Choose one or both options below to populate the library.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Option 1 — Migrate previously added equipment */}
            <div className="flex flex-col gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-800 p-4">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Migrate existing equipment</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Copies all equipment you previously added (across projects) into this global library.</p>
              <Button onClick={handleMigrate} disabled={migrating} variant="outline" className="gap-2 self-start border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/40">
                {migrating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                {migrating ? 'Migrating…' : 'Migrate from Old Catalog'}
              </Button>
            </div>
            {/* Option 2 — Seed built-in catalog */}
            <div className="flex flex-col gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-800 p-4">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Seed built-in catalog</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Loads the 448-item catalog (Blue Star, Samsung, Voltas, Trane…) into the library as a starting point.</p>
              <Button onClick={handleSeed} disabled={seeding} className="bg-amber-600 hover:bg-amber-700 text-white gap-2 self-start">
                {seeding ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                {seeding ? 'Seeding…' : 'Seed from Catalog'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Action row ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            className="pl-9 h-10 text-sm"
            placeholder="Search brand, model, refrigerant…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              onClick={() => setSearch('')}>
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex-1" />

        <Button variant="outline" className="h-10 gap-2 text-sm" onClick={openAdd}>
          <Plus className="w-4 h-4" /> Add Equipment
        </Button>
        <Button variant="outline" className="h-10 gap-2 text-sm" onClick={() => fileRef.current?.click()}>
          <Upload className="w-4 h-4" /> Import CSV
        </Button>
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
        <Button variant="outline" className="h-10 gap-2 text-sm" onClick={handleExport} disabled={filtered.length === 0}>
          <Download className="w-4 h-4" /> Export
        </Button>
        <Button variant="ghost" className="h-10 gap-2 text-sm text-slate-500" onClick={handleDownloadTemplate}>
          <Download className="w-4 h-4" /> Template
        </Button>
        {items.length > 0 && (
          <Button variant="ghost" className="h-10 gap-2 text-sm text-slate-500 hover:text-violet-700"
            onClick={handleMigrate} disabled={migrating} title="Copy items from old project catalogs">
            {migrating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
            Migrate
          </Button>
        )}
        {items.length > 0 && (
          <Button variant="ghost" className="h-10 gap-2 text-sm text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
            onClick={handleSync} disabled={syncing} title="Add new catalog items not yet in the library">
            {syncing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Sync New Items
          </Button>
        )}
        {items.length > 0 && (
          <Button variant="ghost" className="h-10 gap-2 text-sm text-amber-600 hover:text-amber-700"
            onClick={handleSeed} disabled={seeding}>
            {seeding ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
            Re-seed
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-10 w-10 p-0 text-slate-400" onClick={loadItems} disabled={loading}>
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </Button>
      </div>

      {/* ── Filter strip ── */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 px-4 py-3">
        <Filter className="w-4 h-4 text-slate-400 shrink-0 mt-1 self-center" />

        {/* Brand */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 pl-0.5">Brand</span>
          <Select value={filterBrand} onValueChange={setFilterBrand}>
            <SelectTrigger className="h-9 text-sm w-[145px] bg-white dark:bg-slate-900">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Brands</SelectItem>
              {brands.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Type */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 pl-0.5">Type</span>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-9 text-sm w-[140px] bg-white dark:bg-slate-900">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {types.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Sub-Type */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 pl-0.5">Sub-Type</span>
          <Select value={filterSubType} onValueChange={setFilterSubType}>
            <SelectTrigger className="h-9 text-sm w-[165px] bg-white dark:bg-slate-900">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sub-Types</SelectItem>
              {subTypes.map(s => (
                <SelectItem key={s} value={s}>
                  {IDU_SUBTYPE_LABELS[s] ?? s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Refrigerant */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 pl-0.5">Refrigerant</span>
          <Select value={filterRefrigerant} onValueChange={setFilterRefrigerant}>
            <SelectTrigger className="h-9 text-sm w-[120px] bg-white dark:bg-slate-900">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {refrigerants.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Capacity range */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 pl-0.5">
            Capacity TR{trRange ? <span className="font-normal text-slate-400 ml-1">({trRange.min}–{trRange.max})</span> : ''}
          </span>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              className="h-9 text-sm w-[72px] bg-white dark:bg-slate-900"
              placeholder={trRange ? String(trRange.min) : 'Min'}
              value={filterMinTR}
              onChange={e => setFilterMinTR(e.target.value)}
            />
            <span className="text-slate-400 text-xs">—</span>
            <Input
              type="number"
              className="h-9 text-sm w-[72px] bg-white dark:bg-slate-900"
              placeholder={trRange ? String(trRange.max) : 'Max'}
              value={filterMaxTR}
              onChange={e => setFilterMaxTR(e.target.value)}
            />
          </div>
        </div>

        {/* Source */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 pl-0.5">Source</span>
          <Select value={filterSource} onValueChange={setFilterSource}>
            <SelectTrigger className="h-9 text-sm w-[130px] bg-white dark:bg-slate-900">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="catalog">Catalog</SelectItem>
              <SelectItem value="user">User Added</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Clear filters */}
        {activeFilterCount > 0 && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition-colors self-end">
            <X className="w-3.5 h-3.5" />
            Clear ({activeFilterCount})
          </button>
        )}
      </div>

      {/* Import result / error banner */}
      {importResult && (
        <div className={cn('flex items-start gap-3 rounded-xl border p-4 text-sm',
          importResult.added > 0 ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900 text-green-800 dark:text-green-300' : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300',
        )}>
          {importResult.added > 0
            ? <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-green-600" />
            : <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />}
          <div className="flex-1">
            <p className="font-semibold">{importResult.added} items imported successfully</p>
            {importErrors.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs opacity-80">
                {importErrors.map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            )}
          </div>
          <button onClick={() => { setImportResult(null); setImportErrors([]); }}>
            <X className="w-4 h-4 opacity-60 hover:opacity-100" />
          </button>
        </div>
      )}

      {/* Add / Edit Modal */}
      <Dialog open={showForm} onOpenChange={open => { if (!open) closeForm(); }}>
        <DialogContent className="sm:max-w-5xl max-h-[92vh] flex flex-col p-0 gap-0 dark:bg-slate-900 overflow-hidden">
          {/* Header */}
          <DialogHeader className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-blue-50 to-slate-50 dark:from-blue-950/30 dark:to-slate-900 shrink-0">
            <DialogTitle className="text-base font-bold flex items-center gap-2.5 dark:text-slate-100">
              {editingId
                ? <><Pencil className="w-4 h-4 text-blue-500" />Edit — <span className="text-blue-600 dark:text-blue-400">{form.brand} {form.modelSeries}</span></>
                : <><Plus className="w-4 h-4 text-blue-500" />Add Equipment to Library</>}
            </DialogTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {editingId ? 'Update the specs for this equipment entry.' : 'New equipment is saved to the Global Library and available across all projects.'}
            </p>
          </DialogHeader>
          {/* Scrollable body */}
          <div className="overflow-y-auto flex-1 min-h-0">
            {/* key forces a full remount each time a different item is opened for edit */}
            <EquipmentForm
              key={editingId ?? '__new__'}
              form={form}
              setForm={setForm}
              onSave={handleSave}
              onCancel={closeForm}
              saving={saving}
              isEdit={!!editingId}
              brandOptions={brands}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400 gap-3">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading library…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500 gap-2 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700">
          <BookOpen className="w-10 h-10 opacity-20" />
          <p className="text-sm font-medium">
            {items.length === 0 ? 'Library is empty' : 'No items match your search'}
          </p>
          {items.length > 0 && (
            <button className="text-xs text-blue-500 hover:underline" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Result count */}
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length} items
              {filtered.length < items.length && ` (filtered from ${items.length})`}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                  disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="px-2">Page {page + 1} / {totalPages}</span>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                  disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-100 dark:bg-slate-800 text-xs uppercase tracking-wider">
                  <TableHead className="py-3">Type</TableHead>
                  <TableHead className="py-3">Brand</TableHead>
                  <TableHead className="py-3">Model / Series</TableHead>
                  <TableHead className="py-3">Sub-Type</TableHead>
                  <TableHead className="py-3 text-right">TR</TableHead>
                  <TableHead className="py-3 text-right">CFM</TableHead>
                  <TableHead className="py-3 text-right">ESP Pa</TableHead>
                  <TableHead className="py-3 text-right">kW</TableHead>
                  <TableHead className="py-3 text-right">EER</TableHead>
                  <TableHead className="py-3">Refrigerant</TableHead>
                  <TableHead className="py-3 text-center">Source</TableHead>
                  <TableHead className="py-3 w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map(item => (
                  <TableRow key={item.id} className="text-sm hover:bg-slate-50/60 dark:hover:bg-slate-800/60">
                    <TableCell className="py-3">
                      <TypeBadge type={item.type} />
                    </TableCell>
                    <TableCell className="py-3 font-semibold text-slate-800 dark:text-slate-100">{item.brand}</TableCell>
                    <TableCell className="py-3 font-medium dark:text-slate-200">{item.modelSeries}</TableCell>
                    <TableCell className="py-3 text-slate-500 dark:text-slate-400 text-xs">
                      {IDU_SUBTYPE_LABELS[item.subType ?? ''] ?? item.subType ?? '—'}
                    </TableCell>
                    <TableCell className="py-3 text-right font-mono font-bold text-slate-800 dark:text-slate-100">
                      {item.capacityTR}
                    </TableCell>
                    <TableCell className="py-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      {item.ratedAirflowCFM ? item.ratedAirflowCFM.toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="py-3 text-right font-mono text-orange-700 dark:text-orange-400">
                      {item.staticPressurePa ?? '—'}
                    </TableCell>
                    <TableCell className="py-3 text-right font-mono text-slate-500 dark:text-slate-400">
                      {item.powerInputKW ?? '—'}
                    </TableCell>
                    <TableCell className="py-3 text-right font-mono text-green-700 dark:text-green-400">
                      {item.eer ?? '—'}
                    </TableCell>
                    <TableCell className="py-3 text-slate-500 dark:text-slate-400 text-xs">{item.refrigerant ?? '—'}</TableCell>
                    <TableCell className="py-3 text-center">
                      {(item as any).source === 'user'
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 font-medium">User</span>
                        : <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">Catalog</span>
                      }
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-blue-600"
                          onClick={() => openEdit(item)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-red-600"
                          onClick={() => handleDelete(item.id, `${item.brand} ${item.modelSeries}`)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Bottom pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-1">
              <Button variant="outline" size="sm" className="gap-1.5"
                disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="w-4 h-4" /> Previous
              </Button>
              <span className="text-sm text-slate-500 px-3">Page {page + 1} of {totalPages}</span>
              <Button variant="outline" size="sm" className="gap-1.5"
                disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
