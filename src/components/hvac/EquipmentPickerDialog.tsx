/**
 * EquipmentPickerDialog
 * Catalog dialog for picking equipment per room/zone, with inline custom equipment creator.
 */

import { useState, useEffect } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, addDoc, onSnapshot, serverTimestamp, doc, deleteDoc } from 'firebase/firestore';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { EQUIPMENT_CATALOG, EquipmentModel } from '../../constants/equipment-catalog';
import { Search, Plus, Info, Trash2, X, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';

interface EquipmentPickerDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  roomId?: string;
  roomName?: string;
  zoneId?: string;
  zoneName?: string;
  requiredTR?: number;
  loadTR?: number;
  cfmTR?: number;
  governingTR?: number;
  designCFM?: number;
  achGovernsAirflow?: boolean;
  // Re-frames the sizing pill for chiller-fed AHU/FCU selection: Coil Duty + Design CFM
  // are independent — the 400 CFM/TR conversion shown for packaged DX is misleading here.
  systemType?: string;
}

// ── Fit helpers ───────────────────────────────────────────────────────────────

const getAirflow = (item: EquipmentModel): number | null =>
  item.type === 'Pump' ? null : (item.ratedAirflowCFM ?? null);

const getFitStatus = (
  item: EquipmentModel,
  requiredTR?: number,
  designCFM?: number,
): 'ok' | 'oversized' | 'undersized' | 'unknown' => {
  if (!requiredTR && !designCFM) return 'unknown';
  if (requiredTR && item.capacityTR < requiredTR) return 'undersized';
  if (designCFM) {
    const cfm = getAirflow(item);
    if (cfm === null) return 'unknown';
    if (cfm < designCFM) return 'undersized';
  }
  if (requiredTR && item.capacityTR > requiredTR * 1.3) return 'oversized';
  return 'ok';
};

const FitBadge = ({ status }: { status: ReturnType<typeof getFitStatus> }) => {
  if (status === 'ok')         return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">✓ Fits</span>;
  if (status === 'oversized')  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">▲ Over</span>;
  if (status === 'undersized') return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">✕ Under</span>;
  return null;
};

// ── Blank form state ──────────────────────────────────────────────────────────

const BLANK_FORM = {
  brand: '',
  type: 'AHU',
  subType: '',
  modelSeries: '',
  capacityTR: '',
  ratedAirflowCFM: '',
  staticPressurePa: '',
  powerInputKW: '',
  eer: '',
  refrigerant: '',
};

const PREDEFINED_TYPES: string[] = [
  'AHU', 'FCU', 'Package', 'DuctableSplit', 'Chiller', 'VRF-IDU', 'VRF-ODU', 'Split', 'Pump',
];

const TYPE_SUGGESTIONS: string[] = [
  'AHU', 'FCU', 'Package', 'DuctableSplit', 'Chiller', 'VRF-IDU', 'VRF-ODU', 'Split',
  'Pump', 'Humidifier', 'Dehumidifier', 'Fan Coil', 'Cassette',
];

const BRAND_SUGGESTIONS: string[] = [
  'Blue Star', 'Voltas', 'Carrier', 'Daikin', 'Samsung', 'LG', 'Mitsubishi', 'Hitachi', 'Johnson Controls',
];

// ── Main component ────────────────────────────────────────────────────────────

export default function EquipmentPickerDialog({
  open, onClose, projectId,
  roomId, roomName, zoneId, zoneName,
  requiredTR, loadTR, cfmTR, governingTR,
  designCFM, achGovernsAirflow, systemType,
}: EquipmentPickerDialogProps) {
  const isChillerAHU = String(systemType ?? '').toLowerCase() === 'chiller';

  // ── Catalog state ─────────────────────────────────────────────────────────
  const [searchTerm, setSearchTerm]   = useState('');
  const [filterType, setFilterType]   = useState('all');
  const [customCatalog, setCustomCatalog] = useState<EquipmentModel[]>([]);
  const [discontinuedIds, setDiscontinuedIds] = useState<Set<string>>(new Set());
  const [adding, setAdding]           = useState<string | null>(null);

  // ── Custom creator state ──────────────────────────────────────────────────
  const [showForm, setShowForm]       = useState(false);
  const [form, setForm]               = useState(BLANK_FORM);
  const [savingCustom, setSavingCustom] = useState(false);
  const [deletingId, setDeletingId]   = useState<string | null>(null);
  const [showCatalogSection, setShowCatalogSection] = useState<'all' | 'custom'>('all');

  // ── Load custom catalog + overrides from Firestore ────────────────────────
  useEffect(() => {
    if (!open) return;
    const cached = localStorage.getItem('customEquipmentCatalog');
    if (cached) setCustomCatalog(JSON.parse(cached));
    const cachedDisc = localStorage.getItem('equipmentDiscontinuedIds');
    if (cachedDisc) setDiscontinuedIds(new Set(JSON.parse(cachedDisc)));

    const u1 = onSnapshot(collection(db, 'customEquipmentCatalog'), snap => {
      const data = snap.docs.map(d => ({ id: d.id, isCustom: true, ...d.data() } as any));
      setCustomCatalog(data);
      localStorage.setItem('customEquipmentCatalog', JSON.stringify(data));
    });
    const u2 = onSnapshot(collection(db, 'equipmentOverrides'), snap => {
      const ids = new Set<string>();
      snap.docs.forEach(d => { if (d.data().discontinued) ids.add(d.id); });
      setDiscontinuedIds(ids);
      localStorage.setItem('equipmentDiscontinuedIds', JSON.stringify(Array.from(ids)));
    });
    return () => { u1(); u2(); };
  }, [open]);

  // ── Merged + filtered catalog ─────────────────────────────────────────────
  const allItems: EquipmentModel[] = [
    ...(showCatalogSection === 'custom' ? [] : EQUIPMENT_CATALOG),
    ...customCatalog,
  ];

  const filtered = allItems
    .filter(item => {
      if (discontinuedIds.has(item.id)) return false;
      if (filterType !== 'all' && item.type !== filterType) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        return item.modelSeries.toLowerCase().includes(q) || item.brand.toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      if (!requiredTR && !designCFM) return 0;
      const order = { ok: 0, oversized: 1, undersized: 2, unknown: 3 };
      return order[getFitStatus(a, requiredTR, designCFM)] - order[getFitStatus(b, requiredTR, designCFM)];
    });
  const showEspCol = filtered.some(item => item.staticPressurePa != null || item.type === 'AHU' || item.type === 'DuctableSplit');

  // ── Add equipment to project room ─────────────────────────────────────────
  const handleAdd = async (item: EquipmentModel) => {
    if (adding) return;
    setAdding(item.id);
    try {
      await addDoc(collection(db, 'projects', projectId, 'equipment'), {
        projectId,
        roomId: roomId || '',
        zoneId: zoneId || '',
        type: item.type,
        model: item.modelSeries,
        brand: item.brand,
        capacityBTU: item.capacityBTU,
        capacityTR: item.capacityTR,
        ratedAirflowCFM: item.ratedAirflowCFM ?? null,
        status: 'Selected',
        createdAt: serverTimestamp(),
      });
      toast.success(`${item.brand} ${item.modelSeries} added${roomName ? ` to ${roomName}` : zoneName ? ` to ${zoneName}` : ''}`);
      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `projects/${projectId}/equipment`);
    } finally {
      setAdding(null);
    }
  };

  // ── Save new custom equipment to global catalog ───────────────────────────
  const handleSaveCustom = async () => {
    if (!form.brand.trim())       { toast.error('Brand is required'); return; }
    if (!form.modelSeries.trim()) { toast.error('Model name is required'); return; }
    const tr = parseFloat(form.capacityTR);
    if (isNaN(tr) || tr <= 0)    { toast.error('Enter a valid capacity (TR)'); return; }

    setSavingCustom(true);
    try {
      const payload: Record<string, any> = {
        brand:       form.brand.trim(),
        type:        form.type,
        modelSeries: form.modelSeries.trim(),
        capacityTR:  tr,
        capacityBTU: Math.round(tr * 12000),
        userId:      auth.currentUser?.uid ?? null,
        createdAt:   serverTimestamp(),
      };
      if (form.subType.trim())       payload.subType        = form.subType.trim();
      if (form.refrigerant.trim())   payload.refrigerant    = form.refrigerant.trim();
      const cfm = parseFloat(form.ratedAirflowCFM);
      if (!isNaN(cfm) && cfm > 0)   payload.ratedAirflowCFM  = cfm;
      const esp = parseFloat(form.staticPressurePa);
      if (!isNaN(esp) && esp > 0)   payload.staticPressurePa = esp;
      const kw  = parseFloat(form.powerInputKW);
      if (!isNaN(kw)  && kw  > 0)   payload.powerInputKW     = kw;
      const eer = parseFloat(form.eer);
      if (!isNaN(eer) && eer > 0)    payload.eer              = eer;

      await addDoc(collection(db, 'customEquipmentCatalog'), payload);
      toast.success(`${payload.brand} ${payload.modelSeries} saved to catalog`);
      setForm(BLANK_FORM);
      setShowForm(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'customEquipmentCatalog');
    } finally {
      setSavingCustom(false);
    }
  };

  // ── Delete custom equipment from global catalog ───────────────────────────
  const handleDeleteCustom = async (id: string, name: string) => {
    if (!confirm(`Remove "${name}" from the custom catalog?`)) return;
    setDeletingId(id);
    try {
      await deleteDoc(doc(db, 'customEquipmentCatalog', id));
      toast.success('Removed from catalog');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `customEquipmentCatalog/${id}`);
    } finally {
      setDeletingId(null);
    }
  };

  const setF = (k: keyof typeof BLANK_FORM, v: string) =>
    setForm(p => ({ ...p, [k]: v }));

  const label = roomName ? `Room: ${roomName}` : zoneName ? `Zone: ${zoneName}` : 'Project';

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0">

        {/* ── Header ── */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="text-base font-bold flex items-center justify-between">
            <span>Equipment — <span className="text-blue-600">{label}</span></span>
            <div className="flex items-center gap-1 text-xs font-normal">
              <button
                type="button"
                onClick={() => setShowCatalogSection(showCatalogSection === 'custom' ? 'all' : 'custom')}
                className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-600"
              >
                {showCatalogSection === 'custom' ? 'Show All' : `My Catalog (${customCatalog.length})`}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(v => !v); }}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded border font-semibold",
                  showForm
                    ? "border-slate-300 bg-white text-slate-600"
                    : "border-violet-300 bg-violet-600 text-white hover:bg-violet-700"
                )}
              >
                {showForm ? <><X className="w-3.5 h-3.5" /> Cancel</> : <><Plus className="w-3.5 h-3.5" /> Add Custom</>}
              </button>
            </div>
          </DialogTitle>

          {/* Sizing requirements — Coil Duty (TR) and Design CFM are independent
              properties. Equipment must satisfy both: rated TR ≥ requiredTR AND
              rated CFM ≥ designCFM. (2026-05-20: 400 CFM/TR governance dropped;
              CFM/TR is now a sanity ratio only, not a sizing input.) */}
          {isChillerAHU ? (
            (requiredTR && requiredTR > 0) || (designCFM && designCFM > 0) ? (
              <div className="mt-2 flex flex-wrap items-start gap-3 p-2.5 rounded-lg bg-indigo-50 border border-indigo-200 text-xs">
                <Info className="w-3.5 h-3.5 text-indigo-500 mt-0.5 shrink-0" />
                <div className="flex flex-col gap-0.5">
                  <div className="flex flex-wrap gap-3">
                    {loadTR != null && loadTR > 0 && (
                      <span className="text-slate-700">Coil Duty: <strong className="text-indigo-800">{loadTR.toFixed(2)} TR</strong></span>
                    )}
                    {loadTR != null && loadTR > 0 && (
                      <span className="text-slate-700">Required (×1.10): <strong className="text-orange-700">{(loadTR * 1.10).toFixed(2)} TR</strong></span>
                    )}
                    {designCFM != null && designCFM > 0 && (
                      <span className="text-slate-700">Design CFM: <strong className="text-indigo-800">{Math.round(designCFM).toLocaleString()}</strong></span>
                    )}
                  </div>
                  <span className="text-[10.5px] text-slate-500 italic leading-snug">
                    Chiller AHU — Coil Duty (thermal load) and Design CFM (dehumidified airflow) are independent.
                    OEM builds the coil to the duty; selected catalog model should meet the Required value (10% selection margin).
                  </span>
                </div>
              </div>
            ) : null
          ) : (
            <>
              {requiredTR && requiredTR > 0 && (
                <div className="mt-2 flex flex-wrap gap-3 p-2.5 rounded-lg bg-violet-50 border border-violet-200 text-xs">
                  <Info className="w-3.5 h-3.5 text-violet-500 mt-0.5 shrink-0" />
                  <span className="font-bold text-orange-700">Required (with safety): {requiredTR.toFixed(2)} TR</span>
                  <span className="text-slate-400 italic">Fits range: {requiredTR.toFixed(2)}–{(requiredTR * 1.3).toFixed(2)} TR</span>
                </div>
              )}
              {designCFM && designCFM > 0 && (
                <div className={cn(
                  "mt-1.5 flex flex-wrap gap-3 p-2.5 rounded-lg text-xs border",
                  achGovernsAirflow ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-slate-50 border-slate-200 text-slate-600"
                )}>
                  {achGovernsAirflow && <span className="font-bold">⚠ ACH governs:</span>}
                  <span>Design Supply CFM: <strong>{Math.round(designCFM)}</strong></span>
                  {achGovernsAirflow && <span className="italic">Select unit with rated airflow ≥ {Math.round(designCFM)} CFM</span>}
                </div>
              )}
            </>
          )}

          {/* ── Custom equipment creator form ── */}
          {showForm && (
            <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/60 p-3 space-y-2.5">
              <p className="text-[11px] font-bold text-violet-700 uppercase tracking-wider">New Custom Equipment</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-500 mb-0.5 block">Brand *</label>
                  <Input placeholder="Type or pick below…" value={form.brand} onChange={e => setF('brand', e.target.value)} className="h-7 text-xs" />
                  <div className="flex flex-wrap gap-1 mt-1">
                    {BRAND_SUGGESTIONS.map(b => (
                      <button key={b} type="button" onClick={() => setF('brand', b)}
                        className={cn(
                          "px-1.5 py-0.5 rounded text-[9px] border transition-colors",
                          form.brand === b
                            ? "bg-violet-600 text-white border-violet-600"
                            : "bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-700"
                        )}>
                        {b}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-0.5 block">Model Name *</label>
                  <Input placeholder="e.g. FTKM50 Inverter" value={form.modelSeries} onChange={e => setF('modelSeries', e.target.value)} className="h-7 text-xs" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-slate-500 mb-0.5 block">Type * <span className="text-slate-400">(free text)</span></label>
                  <Input
                    placeholder="Type or pick below…"
                    value={form.type}
                    onChange={e => setF('type', e.target.value)}
                    className="h-7 text-xs"
                  />
                  <div className="flex flex-wrap gap-1 mt-1">
                    {TYPE_SUGGESTIONS.map(t => (
                      <button key={t} type="button" onClick={() => setF('type', t)}
                        className={cn(
                          "px-1.5 py-0.5 rounded text-[9px] border transition-colors",
                          form.type === t
                            ? "bg-blue-600 text-white border-blue-600"
                            : t === 'AHU' || t === 'FCU'
                              ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                              : "bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-700"
                        )}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-0.5 block">Sub-type</label>
                  <Input placeholder="e.g. air-cooled" value={form.subType} onChange={e => setF('subType', e.target.value)} className="h-7 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-0.5 block">Capacity TR *</label>
                  <Input placeholder="e.g. 3.5" type="text" inputMode="decimal" min="0" step="0.25" value={form.capacityTR} onChange={e => setF('capacityTR', e.target.value)} className="h-7 text-xs" />
                </div>
              </div>
              <div className="grid grid-cols-5 gap-2">
                <div>
                  <label className="text-[10px] text-slate-500 mb-0.5 block">Airflow CFM</label>
                  <Input placeholder="e.g. 4000" type="text" inputMode="decimal" min="0" value={form.ratedAirflowCFM} onChange={e => setF('ratedAirflowCFM', e.target.value)} className="h-7 text-xs" />
                </div>
                <div>
                  <label className={`text-[10px] mb-0.5 block font-medium ${['AHU','DuctableSplit','VRF-IDU','FCU'].includes(form.type) ? 'text-orange-600' : 'text-slate-500'}`}>
                    ESP (Pa){['AHU','DuctableSplit','VRF-IDU'].includes(form.type) ? ' *' : ''}
                  </label>
                  <Input
                    placeholder={form.type === 'AHU' ? 'e.g. 150' : form.type === 'FCU' ? 'e.g. 30' : 'e.g. 60'}
                    type="text" inputMode="decimal" min="0" value={form.staticPressurePa}
                    onChange={e => setF('staticPressurePa', e.target.value)}
                    className={`h-7 text-xs ${['AHU','DuctableSplit','VRF-IDU'].includes(form.type) ? 'border-orange-300 focus:border-orange-400' : ''}`}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-0.5 block">Power kW</label>
                  <Input placeholder="e.g. 3.2" type="text" inputMode="decimal" min="0" step="0.1" value={form.powerInputKW} onChange={e => setF('powerInputKW', e.target.value)} className="h-7 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-0.5 block">EER</label>
                  <Input placeholder="e.g. 11.5" type="text" inputMode="decimal" min="0" step="0.1" value={form.eer} onChange={e => setF('eer', e.target.value)} className="h-7 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-0.5 block">
                    {['AHU','FCU'].includes(form.type) ? 'Coil / Medium' : 'Refrigerant'}
                  </label>
                  <Input
                    placeholder={['AHU','FCU'].includes(form.type) ? 'e.g. CHW / DX' : 'e.g. R32'}
                    value={form.refrigerant} onChange={e => setF('refrigerant', e.target.value)} className="h-7 text-xs" />
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-[10px] text-slate-400">
                  {form.capacityTR && !isNaN(parseFloat(form.capacityTR))
                    ? `= ${Math.round(parseFloat(form.capacityTR) * 12000).toLocaleString()} BTU/h`
                    : 'BTU/h auto-computed from TR'}
                </span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setShowForm(false); setForm(BLANK_FORM); }}
                    className="h-7 rounded border border-slate-200 bg-white px-2.5 text-xs text-slate-600 hover:bg-slate-50">
                    Cancel
                  </button>
                  <button type="button" onClick={handleSaveCustom} disabled={savingCustom}
                    className="h-7 rounded border border-violet-300 bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-60">
                    {savingCustom ? 'Saving…' : 'Save to My Catalog'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Search + type filter */}
          <div className="mt-3 flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
              <Input placeholder="Search brand or model…" className="pl-8 h-8 text-xs"
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <Select value={filterType} onValueChange={v => setFilterType(v ?? 'all')}>
              <SelectTrigger className="h-8 min-w-max text-xs"><SelectValue placeholder="All Types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="AHU" className="text-xs font-semibold text-blue-700">AHU</SelectItem>
                <SelectItem value="FCU" className="text-xs font-semibold text-blue-700">FCU</SelectItem>
                <SelectItem value="Chiller" className="text-xs">Chiller</SelectItem>
                <SelectItem value="Package" className="text-xs">Package</SelectItem>
                <SelectItem value="DuctableSplit" className="text-xs">Ductable Split</SelectItem>
                <SelectItem value="VRF-IDU" className="text-xs">VRF-IDU</SelectItem>
                <SelectItem value="VRF-ODU" className="text-xs">VRF-ODU</SelectItem>
                <SelectItem value="Split" className="text-xs">Split</SelectItem>
                {Array.from(new Set(allItems.map(i => i.type).filter(t => !PREDEFINED_TYPES.includes(t)))).map(t => (
                  <SelectItem key={t} value={t} className="text-xs text-violet-700">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="self-center text-xs text-slate-400 shrink-0">{filtered.length} model{filtered.length !== 1 ? 's' : ''}</span>
          </div>
        </DialogHeader>

        {/* ── Equipment table ── */}
        <div className="overflow-y-auto flex-1">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10 shadow-sm">
              <TableRow className="bg-slate-50">
                <TableHead className="text-[10px] uppercase py-2">Brand</TableHead>
                <TableHead className="text-[10px] uppercase py-2">Type</TableHead>
                <TableHead className="text-[10px] uppercase py-2">Model</TableHead>
                <TableHead className="text-[10px] uppercase py-2 text-right">TR</TableHead>
                <TableHead className="text-[10px] uppercase py-2 text-right">BTU/h</TableHead>
                {designCFM && <TableHead className="text-[10px] uppercase py-2 text-right">CFM</TableHead>}
                {showEspCol && <TableHead className="text-[10px] uppercase py-2 text-right">ESP Pa</TableHead>}
                {(requiredTR || designCFM) && <TableHead className="text-[10px] uppercase py-2 text-center">Fit</TableHead>}
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10 text-sm text-slate-400">
                    {showCatalogSection === 'custom' && customCatalog.length === 0
                      ? 'No custom equipment yet — click "Add Custom" above to create your first entry.'
                      : 'No equipment matches your search.'}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map(item => {
                const fit     = getFitStatus(item, requiredTR, designCFM);
                const cfm     = getAirflow(item);
                const isCustom = !!(item as any).isCustom;
                return (
                  <TableRow key={item.id} className={cn(
                    "transition-colors hover:bg-blue-50/30",
                    fit === 'ok'         && "bg-emerald-50/20",
                    fit === 'undersized' && "opacity-55",
                  )}>
                    <TableCell className="py-1.5">
                      <span className="font-bold text-xs">{item.brand}</span>
                      {isCustom && <span className="block text-[9px] text-violet-500 font-semibold uppercase tracking-wider">Custom</span>}
                    </TableCell>
                    <TableCell className="py-1.5">
                      <span className="text-[10px] border border-slate-200 rounded px-1.5 py-0.5 text-slate-600">
                        {item.type}{item.subType ? ` · ${item.subType}` : ''}
                      </span>
                    </TableCell>
                    <TableCell className="py-1.5 font-medium text-xs">{item.modelSeries}</TableCell>
                    <TableCell className="py-1.5 text-right font-mono text-xs">{item.capacityTR}</TableCell>
                    <TableCell className="py-1.5 text-right font-mono text-xs">{item.capacityBTU.toLocaleString()}</TableCell>
                    {designCFM && (
                      <TableCell className="py-1.5 text-right font-mono text-xs">
                        {cfm !== null ? cfm.toLocaleString() : <span className="text-slate-300">—</span>}
                      </TableCell>
                    )}
                    {showEspCol && (
                      <TableCell className="py-1.5 text-right font-mono text-xs">
                        {item.staticPressurePa != null
                          ? <span className="text-orange-700 font-semibold">{item.staticPressurePa}</span>
                          : <span className="text-slate-300">—</span>}
                      </TableCell>
                    )}
                    {(requiredTR || designCFM) && (
                      <TableCell className="py-1.5 text-center"><FitBadge status={fit} /></TableCell>
                    )}
                    <TableCell className="py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {isCustom && (
                          <button
                            type="button"
                            title="Remove from catalog"
                            disabled={deletingId === item.id}
                            onClick={() => handleDeleteCustom(item.id, `${item.brand} ${item.modelSeries}`)}
                            className="p-1 text-slate-300 hover:text-red-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={!!adding || fit === 'undersized' || (!!designCFM && fit === 'unknown')}
                          onClick={() => handleAdd(item)}
                          className={cn(
                            "h-7 px-2.5 rounded text-xs font-semibold flex items-center gap-1",
                            fit === 'ok'
                              ? "bg-blue-600 text-white hover:bg-blue-700 border border-blue-600"
                              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                            (!!adding || fit === 'undersized') && "opacity-40 cursor-not-allowed",
                          )}
                        >
                          {adding === item.id ? '…' : <><Plus className="w-3 h-3" />Select</>}
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Footer hint */}
        <div className="px-5 py-2 border-t bg-slate-50 shrink-0">
          <p className="text-[10px] text-slate-400">
            ✓ Fits = TR within {requiredTR ? `${requiredTR?.toFixed(1)}–${(requiredTR * 1.3)?.toFixed(1)} TR` : 'required range'}.
            {' '}Custom equipment you add here is saved to your account catalog and available on all projects.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
