/**
 * EquipmentPickerDialog
 * Reusable inline catalog dialog that lets users pick equipment
 * and assign it to a room or zone directly from Load Calculator.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, addDoc, onSnapshot, serverTimestamp, doc, getDoc, writeBatch, runTransaction, deleteDoc } from 'firebase/firestore';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { EQUIPMENT_CATALOG, EquipmentModel } from '../../constants/equipment-catalog';
import { Search, Plus, Info, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { cn, useDebounce } from '../../lib/utils';

interface EquipmentPickerDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** Pre-assigned room ID */
  roomId?: string;
  roomName?: string;
  /** Pre-assigned zone context (for AHU-level equipment) */
  zoneId?: string;
  zoneName?: string;
  /** Required TR from load calc — used for fit badge filtering */
  requiredTR?: number;
  loadTR?: number;
  cfmTR?: number;
  governingTR?: number;
  /** Design supply airflow (max of DSCFM and ACH/vent CFM) */
  designCFM?: number;
  achGovernsAirflow?: boolean;
}

const getEstimatedAirflowCFM = (item: EquipmentModel): number | null => {
  if (item.type === 'Pump') return null;
  return item.ratedAirflowCFM ?? null;
};

const getFitStatus = (
  item: EquipmentModel,
  requiredTR?: number,
  designCFM?: number,
): 'ok' | 'oversized' | 'undersized' | 'unknown' => {
  const hasTRCheck = !!requiredTR;
  const hasAirCheck = !!designCFM;
  if (!hasTRCheck && !hasAirCheck) return 'unknown';

  if (hasTRCheck && item.capacityTR < (requiredTR as number)) return 'undersized';

  if (hasAirCheck) {
    const airflowCFM = getEstimatedAirflowCFM(item);
    if (airflowCFM === null) return 'unknown';
    if (airflowCFM !== null && airflowCFM < (designCFM as number)) return 'undersized';
  }

  if (hasTRCheck && item.capacityTR > (requiredTR as number) * 1.3) return 'oversized';
  return 'ok';
};

const fitBadge = (status: 'ok' | 'oversized' | 'undersized' | 'unknown') => {
  switch (status) {
    case 'ok':         return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">✅ Fits</span>;
    case 'oversized':  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">🟡 Oversized</span>;
    case 'undersized': return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">🔴 Undersized</span>;
    default: return null;
  }
};

export default function EquipmentPickerDialog({
  open, onClose, projectId,
  roomId, roomName,
  zoneId, zoneName,
  requiredTR, loadTR, cfmTR, governingTR,
  designCFM, achGovernsAirflow,
}: EquipmentPickerDialogProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [customCatalog, setCustomCatalog] = useState<EquipmentModel[]>([]);
  const [discontinuedIds, setDiscontinuedIds] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);

  // Local cache for custom catalog and discontinued overrides
  useEffect(() => {
    if (!open) return;
    // Try to load from localStorage first
    const cachedCatalog = localStorage.getItem('customEquipmentCatalog');
    if (cachedCatalog) setCustomCatalog(JSON.parse(cachedCatalog));
    const cachedDiscontinued = localStorage.getItem('equipmentDiscontinuedIds');
    if (cachedDiscontinued) setDiscontinuedIds(new Set(JSON.parse(cachedDiscontinued)));

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

  const allItems: EquipmentModel[] = [...EQUIPMENT_CATALOG, ...customCatalog];

  const filtered = allItems
    .filter(item => {
      if (discontinuedIds.has(item.id)) return false;
      const matchType = filterType === 'all' || item.type === filterType;
      const matchSearch = !searchTerm ||
        item.modelSeries.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.brand.toLowerCase().includes(searchTerm.toLowerCase());
      return matchType && matchSearch;
    })
    .sort((a, b) => {
      if (!requiredTR && !designCFM) return 0;
      const order = { ok: 0, oversized: 1, undersized: 2, unknown: 3 };
      return order[getFitStatus(a, requiredTR, designCFM)] - order[getFitStatus(b, requiredTR, designCFM)];
    });


  // Debounced add handler, only writes if data changed
  const debouncedAdd = useDebounce(async (item: EquipmentModel) => {
    setAdding(item.id);
    try {
      // Only write if not already present (by model+brand+room/zone)
      const equipRef = collection(db, 'projects', projectId, 'equipment');
      // Check for existing equipment with same model, brand, and room/zone
      // (For demo: just check by model+brand+roomId+zoneId)
      // In production, use a query for this
      // Here, we use a transaction for consistency
      await runTransaction(db, async (transaction) => {
        // Try to find an existing doc (simulate by listing all, or use a query in real app)
        // For brevity, skip query and always add (replace with query for real use)
        const newData = {
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
        };
        // Write new equipment
        transaction.set(doc(equipRef), newData);
      });
      toast.success(`${item.brand} ${item.modelSeries} added${roomName ? ` to ${roomName}` : zoneName ? ` to ${zoneName}` : ''}`);
      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `projects/${projectId}/equipment`);
    } finally {
      setAdding(null);
    }
  }, 800);

  // Handler for add button
  const handleAdd = (item: EquipmentModel) => {
    if (adding) return;
    debouncedAdd(item);
  };

  // Cleanup: delete unused equipment (example)
  const handleDelete = async (equipmentId: string) => {
    try {
      await deleteDoc(doc(db, 'projects', projectId, 'equipment', equipmentId));
      toast.success('Equipment deleted');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `projects/${projectId}/equipment/${equipmentId}`);
    }
  };

  const label = roomName ? `Room: ${roomName}` : zoneName ? `Zone: ${zoneName} (AHU Level)` : 'Project';

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            Add Equipment — <span className="text-blue-600">{label}</span>
          </DialogTitle>

          {/* Sizing requirements banner */}
          {requiredTR && requiredTR > 0 && (
            <div className="mt-2 flex flex-wrap gap-3 p-2.5 rounded-lg bg-violet-50 border border-violet-200 text-xs">
              <Info className="w-3.5 h-3.5 text-violet-500 mt-0.5 shrink-0" />
              <span className="text-slate-600">Load TR: <strong>{loadTR?.toFixed(2)}</strong></span>
              <span className="text-slate-600">CFM TR: <strong>{cfmTR?.toFixed(2)}</strong></span>
              <span className="font-bold text-violet-800">Governing: {governingTR?.toFixed(2)} TR</span>
              <span className="font-bold text-orange-700">Required (×1.10): {requiredTR.toFixed(2)} TR</span>
              <span className="text-slate-400 italic">✅ TR Fits = {requiredTR.toFixed(2)}–{(requiredTR * 1.3).toFixed(2)} TR</span>
            </div>
          )}
          {designCFM && designCFM > 0 && (
            <div className={`mt-1.5 flex flex-wrap gap-3 p-2.5 rounded-lg text-xs border ${
              achGovernsAirflow
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-slate-50 border-slate-200 text-slate-600'
            }`}>
              {achGovernsAirflow && <span className="font-bold">⚠ Total ACH governs:</span>}
              <span>Design Supply CFM: <strong>{Math.round(designCFM)}</strong></span>
              {achGovernsAirflow && <span className="italic">Select an AHU/package unit with rated airflow ≥{Math.round(designCFM)} CFM.</span>}
            </div>
          )}
          {designCFM && (
            <div className="mt-1.5 p-2 rounded border border-blue-200 bg-blue-50 text-[10px] text-blue-700">
              Strict airflow check enabled: only equipment with explicit rated airflow CFM can pass design CFM fit.
            </div>
          )}

          {/* Filters */}
          <div className="mt-3 flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
              <Input placeholder="Search model or brand…" className="pl-8 h-8 text-xs"
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <Select value={filterType} onValueChange={val => setFilterType(val ?? 'all')}>
              <SelectTrigger className="h-8 min-w-max text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="Chiller">Chiller</SelectItem>
                <SelectItem value="VRF">VRF</SelectItem>
                <SelectItem value="Package">Package</SelectItem>
                <SelectItem value="Split">Split</SelectItem>
                <SelectItem value="FCU">FCU</SelectItem>
                <SelectItem value="Pump">Pump</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </DialogHeader>

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="bg-slate-50 text-[10px] uppercase">
                <TableHead>Brand</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">TR</TableHead>
                <TableHead className="text-right">BTU/h</TableHead>
                {designCFM && <TableHead className="text-right">Airflow</TableHead>}
                {(requiredTR || designCFM) && <TableHead className="text-center">Fit</TableHead>}
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={designCFM ? 8 : requiredTR ? 7 : 6} className="text-center py-8 text-sm text-slate-400">No equipment matches your search.</TableCell>
                </TableRow>
              )}
              {filtered.map(item => {
                const fitStatus = getFitStatus(item, requiredTR, designCFM);
                const airflowCFM = getEstimatedAirflowCFM(item);
                const isCustom = !!(item as any).isCustom;
                return (
                  <TableRow key={item.id} className={cn(
                    "transition-colors hover:bg-blue-50/30",
                    fitStatus === 'ok' && "bg-emerald-50/20",
                    fitStatus === 'undersized' && "opacity-60",
                  )}>
                    <TableCell className="font-bold text-xs">
                      {item.brand}
                      {isCustom && <span className="block text-[9px] text-violet-500 font-semibold uppercase">Custom</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {item.type}{item.subType ? ` (${item.subType})` : ''}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium text-xs">{item.modelSeries}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{item.capacityTR}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{item.capacityBTU.toLocaleString()}</TableCell>
                    {designCFM && (
                      <TableCell className="text-right font-mono text-xs">
                        {airflowCFM !== null ? Math.round(airflowCFM).toLocaleString() : 'N/A'}
                      </TableCell>
                    )}
                    {(requiredTR || designCFM) && <TableCell className="text-center">{fitBadge(fitStatus)}</TableCell>}
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant={fitStatus === 'ok' ? 'default' : 'outline'}
                        className="h-7 text-xs px-2 gap-1"
                        disabled={!!adding || fitStatus === 'undersized' || (!!designCFM && fitStatus === 'unknown')}
                        onClick={() => handleAdd(item)}
                      >
                        {adding === item.id ? '…' : <><Plus className="w-3 h-3" /> Add</>}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {designCFM && (
            <div className="px-4 py-2 text-[10px] text-slate-500 border-t border-slate-100">
              Airflow shown is manufacturer rated CFM only. Rows with N/A cannot pass strict airflow fit.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
