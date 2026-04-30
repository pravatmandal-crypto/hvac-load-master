import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc,
  serverTimestamp, arrayUnion, arrayRemove, deleteField,
} from 'firebase/firestore';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import {
  EQUIPMENT_CATALOG, IDU_SUBTYPE_LABELS,
} from '../../constants/equipment-catalog';
import type {
  EquipmentSystem, IDUSelection, ODUSelection, SingleUnitSelection, SystemType,
} from '../../types/equipment-systems';
import {
  Plus, Trash2, Package, FileText, Search, Lock, Unlock, Box,
  AlertTriangle, CheckCircle2, Wind, Zap, ExternalLink, Upload,
  ChevronRight, Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';

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
  if (status === 'ok')         return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">✅ Fits</span>;
  if (status === 'oversized')  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">🟡 Oversized</span>;
  if (status === 'undersized') return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">🔴 Under</span>;
  return null;
}

function systemStatusInfo(sys: EquipmentSystem, rooms: any[]) {
  const assignedCount = sys.assignedRoomIds.length;
  if (assignedCount === 0) return { label: 'No rooms', color: 'text-slate-400' };
  if (sys.type === 'VRF') {
    const iduCount = Object.keys(sys.iduSelections).length;
    const hasODU = !!sys.oduSelection;
    if (iduCount < assignedCount) return { label: `IDU missing (${assignedCount - iduCount})`, color: 'text-amber-600' };
    if (!hasODU) return { label: 'ODU not selected', color: 'text-orange-600' };
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
  const [filterSubType, setFilterSubType] = useState('all');
  const [filterBrand, setFilterBrand] = useState(lockedBrand ?? 'all');

  useEffect(() => { setFilterBrand(lockedBrand ?? 'all'); }, [lockedBrand]);

  const items = EQUIPMENT_CATALOG
    .filter(m => m.type === 'VRF-IDU')
    .filter(m => lockedBrand ? m.brand === lockedBrand : (filterBrand === 'all' || m.brand === filterBrand))
    .filter(m => filterSubType === 'all' || m.subType === filterSubType)
    .filter(m => !search || m.modelSeries.toLowerCase().includes(search.toLowerCase()) || m.brand.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const order = { ok: 0, oversized: 1, undersized: 2, unknown: 3 };
      return order[getFitStatus(a.capacityTR, a.ratedAirflowCFM, requiredTR, designCFM)]
           - order[getFitStatus(b.capacityTR, b.ratedAirflowCFM, requiredTR, designCFM)];
    });

  const allBrands = [...new Set(EQUIPMENT_CATALOG.filter(m => m.type === 'VRF-IDU').map(m => m.brand))];
  const allSubTypes = [...new Set(EQUIPMENT_CATALOG.filter(m => m.type === 'VRF-IDU').map(m => m.subType).filter(Boolean))];

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-sm font-bold flex items-center gap-2">
            Select IDU — <span className="text-blue-600">{roomName}</span>
            {lockedBrand && <Badge variant="outline" className="gap-1 text-[10px] text-amber-700 border-amber-300 bg-amber-50"><Lock className="w-2.5 h-2.5" />{lockedBrand}</Badge>}
          </DialogTitle>
          {requiredTR > 0 && (
            <div className="mt-2 flex flex-wrap gap-3 p-2 rounded-lg bg-violet-50 border border-violet-200 text-xs">
              <Info className="w-3.5 h-3.5 text-violet-500 mt-0.5" />
              <span className="text-violet-700">Required: <strong>{requiredTR.toFixed(2)} TR</strong></span>
              {designCFM > 0 && <span className="text-violet-700">Design CFM: <strong>{Math.round(designCFM).toLocaleString()}</strong></span>}
              <span className="text-slate-400 italic">Fits: {requiredTR.toFixed(2)}–{(requiredTR * 1.3).toFixed(2)} TR</span>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
              <Input className="pl-8 h-8 text-xs" placeholder="Search model…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {!lockedBrand && (
              <Select value={filterBrand} onValueChange={v => setFilterBrand(v ?? 'all')}>
                <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Brand" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Brands</SelectItem>
                  {allBrands.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={filterSubType} onValueChange={v => setFilterSubType(v ?? 'all')}>
              <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {allSubTypes.map(s => <SelectItem key={s} value={s!}>{IDU_SUBTYPE_LABELS[s!] ?? s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </DialogHeader>
        <div className="overflow-y-auto flex-1">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="bg-slate-50 text-[10px] uppercase">
                <TableHead>Brand</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">TR</TableHead>
                <TableHead className="text-right">CFM</TableHead>
                <TableHead className="text-center">Fit</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-sm text-slate-400">No IDU models match.</TableCell></TableRow>
              )}
              {items.map(item => {
                const fit = getFitStatus(item.capacityTR, item.ratedAirflowCFM, requiredTR, designCFM);
                return (
                  <TableRow key={item.id} className={cn('hover:bg-blue-50/30', fit === 'ok' && 'bg-emerald-50/20', fit === 'undersized' && 'opacity-60')}>
                    <TableCell className="font-bold text-xs">{item.brand}</TableCell>
                    <TableCell className="text-xs text-slate-500">{IDU_SUBTYPE_LABELS[item.subType ?? ''] ?? item.subType}</TableCell>
                    <TableCell className="font-medium text-xs">{item.modelSeries}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{item.capacityTR}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{item.ratedAirflowCFM ? Math.round(item.ratedAirflowCFM).toLocaleString() : '—'}</TableCell>
                    <TableCell className="text-center"><FitBadge status={fit} /></TableCell>
                    <TableCell>
                      <Button size="sm" variant={fit === 'ok' ? 'default' : 'outline'} className="h-7 text-xs px-2"
                        disabled={fit === 'undersized'}
                        onClick={() => {
                          onSelect({ modelId: item.id, brand: item.brand, modelSeries: item.modelSeries, subType: item.subType ?? '', trCapacity: item.capacityTR, cfmRated: item.ratedAirflowCFM ?? 0 });
                          onClose();
                        }}>
                        Select
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

// ─── ODU Picker Dialog ────────────────────────────────────────────────────────

function ODUPickerDialog({
  open, onClose, requiredTR, lockedBrand, onSelect,
}: {
  open: boolean; onClose: () => void;
  requiredTR: number; lockedBrand: string | null;
  onSelect: (sel: ODUSelection) => void;
}) {
  const [search, setSearch] = useState('');
  const [filterDischarge, setFilterDischarge] = useState('all');
  const [filterCompressor, setFilterCompressor] = useState('all');

  const items = EQUIPMENT_CATALOG
    .filter(m => m.type === 'VRF-ODU')
    .filter(m => !lockedBrand || m.brand === lockedBrand)
    .filter(m => filterDischarge === 'all' || m.dischargeType === filterDischarge)
    .filter(m => filterCompressor === 'all' || m.compressorType === filterCompressor)
    .filter(m => !search || m.modelSeries.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (a.capacityTR < requiredTR && b.capacityTR >= requiredTR) return 1;
      if (b.capacityTR < requiredTR && a.capacityTR >= requiredTR) return -1;
      return a.capacityTR - b.capacityTR;
    });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-sm font-bold">
            Select ODU
            {lockedBrand && <Badge variant="outline" className="ml-2 gap-1 text-[10px] text-amber-700 border-amber-300 bg-amber-50"><Lock className="w-2.5 h-2.5" />{lockedBrand}</Badge>}
          </DialogTitle>
          <div className="mt-1.5 flex items-center gap-3 p-2 rounded-lg bg-blue-50 border border-blue-200 text-xs">
            <Info className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-blue-700">Required ODU capacity (after diversity): <strong>{requiredTR.toFixed(2)} TR</strong></span>
            <span className="text-slate-400 italic">Select ODU ≥ {requiredTR.toFixed(2)} TR</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
              <Input className="pl-8 h-8 text-xs" placeholder="Search model…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
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
        <div className="overflow-y-auto flex-1">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="bg-slate-50 text-[10px] uppercase">
                <TableHead>Brand</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Discharge</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">TR</TableHead>
                <TableHead className="text-right">EER</TableHead>
                <TableHead className="text-right">kW</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-sm text-slate-400">No ODU models match.</TableCell></TableRow>
              )}
              {items.map(item => {
                const sufficient = item.capacityTR >= requiredTR;
                return (
                  <TableRow key={item.id} className={cn('hover:bg-blue-50/30', sufficient && 'bg-emerald-50/20', !sufficient && 'opacity-50')}>
                    <TableCell className="font-bold text-xs">{item.brand}</TableCell>
                    <TableCell className="font-medium text-xs">{item.modelSeries}</TableCell>
                    <TableCell className="text-xs capitalize">{item.dischargeType ?? '—'}</TableCell>
                    <TableCell className="text-xs capitalize">{item.compressorType === 'heat-pump' ? 'Heat Pump' : 'Cooling Only'}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold">{item.capacityTR}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{item.eer ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{item.powerInputKW ?? '—'}</TableCell>
                    <TableCell>
                      <Button size="sm" variant={sufficient ? 'default' : 'outline'} className="h-7 text-xs px-2"
                        disabled={!sufficient}
                        onClick={() => {
                          onSelect({ modelId: item.id, brand: item.brand, modelSeries: item.modelSeries, trCapacity: item.capacityTR, dischargeType: item.dischargeType, compressorType: item.compressorType });
                          onClose();
                        }}>
                        Select
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

// ─── Unit Picker Dialog (Package / DuctableSplit) ─────────────────────────────

function UnitPickerDialog({
  open, onClose, systemType, packageSubType, requiredTR, designCFM, onSelect,
}: {
  open: boolean; onClose: () => void;
  systemType: 'Package' | 'DuctableSplit';
  packageSubType?: string;
  requiredTR: number; designCFM: number;
  onSelect: (sel: SingleUnitSelection) => void;
}) {
  const [search, setSearch] = useState('');

  const items = EQUIPMENT_CATALOG
    .filter(m => m.type === systemType)
    .filter(m => systemType !== 'Package' || !packageSubType || packageSubType === 'all' || m.subType === packageSubType)
    .filter(m => !search || m.modelSeries.toLowerCase().includes(search.toLowerCase()) || m.brand.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const order = { ok: 0, oversized: 1, undersized: 2, unknown: 3 };
      return order[getFitStatus(a.capacityTR, a.ratedAirflowCFM, requiredTR, designCFM)]
           - order[getFitStatus(b.capacityTR, b.ratedAirflowCFM, requiredTR, designCFM)];
    });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-sm font-bold">{systemType === 'Package' ? 'Select Package Unit' : 'Select Ductable Split Unit'}</DialogTitle>
          {requiredTR > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-3 p-2 rounded-lg bg-violet-50 border border-violet-200 text-xs">
              <Info className="w-3.5 h-3.5 text-violet-500" />
              <span className="text-violet-700">Total required: <strong>{requiredTR.toFixed(2)} TR</strong></span>
              {designCFM > 0 && <span className="text-violet-700">Design CFM: <strong>{Math.round(designCFM).toLocaleString()}</strong></span>}
            </div>
          )}
          <div className="mt-2 relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
            <Input className="pl-8 h-8 text-xs" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </DialogHeader>
        <div className="overflow-y-auto flex-1">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="bg-slate-50 text-[10px] uppercase">
                <TableHead>Brand</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Sub-Type</TableHead>
                <TableHead className="text-right">TR</TableHead>
                <TableHead className="text-right">CFM</TableHead>
                <TableHead className="text-center">Fit</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-sm text-slate-400">No units found.</TableCell></TableRow>
              )}
              {items.map(item => {
                const fit = getFitStatus(item.capacityTR, item.ratedAirflowCFM, requiredTR, designCFM);
                return (
                  <TableRow key={item.id} className={cn('hover:bg-blue-50/30', fit === 'ok' && 'bg-emerald-50/20', fit === 'undersized' && 'opacity-60')}>
                    <TableCell className="font-bold text-xs">{item.brand}</TableCell>
                    <TableCell className="font-medium text-xs">{item.modelSeries}</TableCell>
                    <TableCell className="text-xs text-slate-500 capitalize">{item.subType ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{item.capacityTR}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{item.ratedAirflowCFM ? Math.round(item.ratedAirflowCFM).toLocaleString() : '—'}</TableCell>
                    <TableCell className="text-center"><FitBadge status={fit} /></TableCell>
                    <TableCell>
                      <Button size="sm" variant={fit === 'ok' ? 'default' : 'outline'} className="h-7 text-xs px-2"
                        disabled={fit === 'undersized'}
                        onClick={() => {
                          onSelect({ modelId: item.id, brand: item.brand, modelSeries: item.modelSeries, subType: item.subType, trCapacity: item.capacityTR, cfmRated: item.ratedAirflowCFM ?? 0 });
                          onClose();
                        }}>
                        Select
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function EquipmentSelection({ project, userProfile }: { project: any; userProfile: any }) {
  const [equipSystems, setEquipSystems] = useState<EquipmentSystem[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);

  // New system form state
  const [showNewSystem, setShowNewSystem] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<SystemType>('VRF');
  const [newPkgSubType, setNewPkgSubType] = useState<'air-cooled' | 'water-cooled'>('air-cooled');
  const [creatingSystem, setCreatingSystem] = useState(false);

  // Picker dialog state
  const [iduPicker, setIduPicker] = useState<{ roomId: string; roomName: string; reqTR: number; reqCFM: number } | null>(null);
  const [oduPicker, setOduPicker] = useState(false);
  const [unitPicker, setUnitPicker] = useState(false);

  // Mock drawings
  const drawings = [
    { id: '1', name: 'Ground Floor Civil Layout', type: 'Civil', format: 'PDF', version: 'V1.0' },
    { id: '2', name: 'HVAC Ducting Layout - Zone A', type: 'HVAC', format: 'DWG', version: 'V2.1' },
  ];

  // ── Firestore listeners ────────────────────────────────────────────────────

  useEffect(() => {
    setEquipSystems([]);
    setRooms([]);
    setSelectedSystemId(null);
  }, [project?.id]);

  useEffect(() => {
    if (!project?.id) return;
    const unsub = onSnapshot(
      collection(db, 'projects', project.id, 'equipmentSystems'),
      snap => setEquipSystems(snap.docs.map(d => ({ id: d.id, ...d.data() } as EquipmentSystem))),
    );
    return () => unsub();
  }, [project?.id]);

  useEffect(() => {
    if (!project?.id) return;
    const roomUnsubByZone: Record<string, () => void> = {};
    const unsubscribes: (() => void)[] = [];

    const unsubZones = onSnapshot(collection(db, 'projects', project.id, 'zones'), snap => {
      snap.docs.forEach(zoneDoc => {
        if (roomUnsubByZone[zoneDoc.id]) return;
        const u = onSnapshot(collection(db, 'projects', project.id, 'zones', zoneDoc.id, 'rooms'), roomSnap => {
          const data = roomSnap.docs.map(d => ({ id: d.id, zoneId: zoneDoc.id, zoneName: zoneDoc.data().name, ...d.data() }));
          setRooms(prev => [...prev.filter(r => r.zoneId !== zoneDoc.id), ...data]);
        });
        roomUnsubByZone[zoneDoc.id] = u;
        unsubscribes.push(u);
      });
    });
    unsubscribes.push(unsubZones);
    return () => unsubscribes.forEach(u => u());
  }, [project?.id]);

  // ── System CRUD ────────────────────────────────────────────────────────────

  const createSystem = async () => {
    if (!newName.trim()) { toast.error('System name required'); return; }
    setCreatingSystem(true);
    try {
      const ref = await addDoc(collection(db, 'projects', project.id, 'equipmentSystems'), {
        name: newName.trim(),
        type: newType,
        ...(newType === 'Package' ? { packageSubType: newPkgSubType } : {}),
        brand: null,
        brandLocked: false,
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
    const assigned = system.assignedRoomIds.includes(roomId);
    const updates: Record<string, any> = {
      assignedRoomIds: assigned ? arrayRemove(roomId) : arrayUnion(roomId),
      updatedAt: serverTimestamp(),
    };
    if (assigned) {
      // Also remove IDU selection if room is unassigned
      updates[`iduSelections.${roomId}`] = deleteField();
    }
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', system.id), updates);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${system.id}`);
    }
  };

  const selectIDU = async (system: EquipmentSystem, roomId: string, sel: IDUSelection) => {
    const updates: Record<string, any> = {
      [`iduSelections.${roomId}`]: sel,
      updatedAt: serverTimestamp(),
    };
    // Lock brand on first IDU selection
    if (!system.brandLocked) {
      updates.brand = sel.brand;
      updates.brandLocked = true;
    }
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', system.id), updates);
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
  };

  const selectODU = async (systemId: string, sel: ODUSelection) => {
    await updateSystemField(systemId, { oduSelection: sel });
  };

  const removeODU = async (systemId: string) => {
    await updateSystemField(systemId, { oduSelection: null });
  };

  const selectUnit = async (systemId: string, sel: SingleUnitSelection) => {
    await updateSystemField(systemId, { unitSelection: sel });
  };

  const removeUnit = async (systemId: string) => {
    await updateSystemField(systemId, { unitSelection: null });
  };

  const unlockBrand = async (system: EquipmentSystem) => {
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipmentSystems', system.id), {
        brand: null,
        brandLocked: false,
        iduSelections: {},
        oduSelection: null,
        updatedAt: serverTimestamp(),
      });
      toast.success('Brand unlocked — IDU selections cleared');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipmentSystems/${system.id}`);
    }
  };

  // ── Computed values ────────────────────────────────────────────────────────

  const getRoomReqs = (roomId: string) => {
    const r = rooms.find(x => x.id === roomId);
    return {
      requiredTR: Number(r?._calcRequiredTR) || 0,
      governingTR: Number(r?._calcGoverningTR) || 0,
      designCFM: Number(r?._calcDesignCFM) || 0,
    };
  };

  const allAssignedIds = new Set(equipSystems.flatMap(s => s.assignedRoomIds));
  const unassignedRooms = rooms.filter(r => !allAssignedIds.has(r.id));

  const selectedSystem = equipSystems.find(s => s.id === selectedSystemId) ?? null;

  // VRF diversity calculation
  const totalIDU_TR = selectedSystem ? Object.values(selectedSystem.iduSelections).reduce((s, x) => s + x.trCapacity, 0) : 0;
  const requiredODU_TR = selectedSystem ? totalIDU_TR * (selectedSystem.diversityFactor ?? 0.75) : 0;

  // Connection ratio check
  const oduCapTR = selectedSystem?.oduSelection?.trCapacity ?? 0;
  const connectionPct = oduCapTR > 0 ? (totalIDU_TR / oduCapTR) * 100 : 0;
  const connOK = oduCapTR > 0 && connectionPct >= 50 && connectionPct <= 130;

  // Package / DuctableSplit totals (sum of all assigned room requirements)
  const assignedRoomReqs = selectedSystem?.assignedRoomIds.map(rid => getRoomReqs(rid)) ?? [];
  const totalRequiredTR = assignedRoomReqs.reduce((s, r) => s + r.requiredTR, 0);
  const totalDesignCFM  = assignedRoomReqs.reduce((s, r) => s + r.designCFM, 0);

  // ── Guard: no project ──────────────────────────────────────────────────────

  if (!project) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Equipment Selection</h2>
          <p className="text-gray-500">Select a project from the Dashboard first.</p>
        </div>
        <div className="flex flex-col items-center justify-center h-64 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 text-gray-400 gap-3">
          <Box className="w-10 h-10 opacity-30" />
          <p className="text-sm font-medium">No project open — go to Dashboard and open a project.</p>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Equipment Selection</h2>
        <p className="text-gray-500">{project.name} — define mechanical systems and select equipment.</p>
      </div>

      <Tabs defaultValue="systems" className="w-full">
        <TabsList className="grid w-full max-w-sm grid-cols-2 mb-6">
          <TabsTrigger value="systems" className="gap-2"><Wind className="w-4 h-4" />System Design</TabsTrigger>
          <TabsTrigger value="drawings" className="gap-2"><FileText className="w-4 h-4" />Drawings & Docs</TabsTrigger>
        </TabsList>

        {/* ── System Design Tab ── */}
        <TabsContent value="systems">
          <div className="flex border rounded-xl overflow-hidden min-h-[640px] bg-white shadow-sm">

            {/* Left sidebar */}
            <div className="w-64 border-r bg-slate-50 flex flex-col shrink-0">
              <div className="p-3 border-b bg-white">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase text-slate-500 tracking-wide">Systems</span>
                  {unassignedRooms.length > 0 && (
                    <Badge className="text-[10px] bg-orange-100 text-orange-700 border border-orange-200 gap-1">
                      <AlertTriangle className="w-3 h-3" />{unassignedRooms.length} unassigned
                    </Badge>
                  )}
                </div>
                <Button size="sm" className="w-full h-8 text-xs gap-1.5" onClick={() => setShowNewSystem(true)}>
                  <Plus className="w-3.5 h-3.5" /> Add System
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {equipSystems.length === 0 && (
                  <p className="text-xs text-slate-400 text-center mt-8 px-3">No systems yet. Click "Add System" to begin.</p>
                )}
                {equipSystems.map(sys => {
                  const { label, color } = systemStatusInfo(sys, rooms);
                  const isSelected = sys.id === selectedSystemId;
                  return (
                    <button key={sys.id}
                      onClick={() => setSelectedSystemId(sys.id)}
                      className={cn(
                        'w-full text-left rounded-lg px-3 py-2.5 transition-colors group',
                        isSelected ? 'bg-blue-600 text-white' : 'hover:bg-slate-100 text-slate-700',
                      )}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold truncate">{sys.name}</span>
                        <ChevronRight className={cn('w-3 h-3 shrink-0', isSelected ? 'text-white/70' : 'text-slate-400')} />
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge variant="outline" className={cn('text-[9px] px-1 py-0 font-normal', isSelected ? 'border-white/30 text-white/80' : 'border-slate-200')}>
                          {sys.type}
                        </Badge>
                        <span className={cn('text-[10px]', isSelected ? 'text-white/70' : color)}>{label}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {rooms.length > 0 && (
                <div className="p-3 border-t">
                  <p className="text-[10px] text-slate-400">{rooms.length} rooms total · {allAssignedIds.size} assigned</p>
                </div>
              )}
            </div>

            {/* Right content */}
            <div className="flex-1 overflow-y-auto">
              {!selectedSystem ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                  <Wind className="w-12 h-12 opacity-20" />
                  <p className="text-sm font-medium">Select a system or create a new one</p>
                  <p className="text-xs">Each system groups rooms and selects equipment for them.</p>
                </div>
              ) : (
                <div className="p-5 space-y-5">

                  {/* System header */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold text-slate-800">{selectedSystem.name}</h3>
                        <Badge className={cn('text-[10px]', selectedSystem.type === 'VRF' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200')}>
                          {selectedSystem.type}{selectedSystem.packageSubType ? ` (${selectedSystem.packageSubType})` : ''}
                        </Badge>
                        {selectedSystem.brandLocked && selectedSystem.brand && (
                          <Badge variant="outline" className="gap-1 text-[10px] text-amber-700 border-amber-300 bg-amber-50">
                            <Lock className="w-2.5 h-2.5" />{selectedSystem.brand} locked
                          </Badge>
                        )}
                      </div>
                      {selectedSystem.type === 'VRF' && (
                        <div className="flex items-center gap-3 mt-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-slate-500">Diversity factor:</span>
                            <Input
                              type="number" min="0.5" max="1.0" step="0.05"
                              className="h-7 w-16 text-xs text-center p-1"
                              value={selectedSystem.diversityFactor ?? 0.75}
                              onChange={e => updateSystemField(selectedSystem.id, { diversityFactor: parseFloat(e.target.value) || 0.75 })}
                            />
                          </div>
                          {selectedSystem.brandLocked && (
                            <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1 text-slate-500 hover:text-red-600"
                              onClick={() => unlockBrand(selectedSystem)}>
                              <Unlock className="w-3 h-3" /> Change brand (clears IDUs)
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-600 h-8 w-8 p-0 shrink-0"
                      onClick={() => deleteSystem(selectedSystem.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Room Assignment */}
                  <div className="rounded-lg border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-4 py-2.5 border-b">
                      <span className="text-xs font-bold uppercase text-slate-500 tracking-wide">Assign Rooms</span>
                      <span className="ml-2 text-xs text-slate-400">{selectedSystem.assignedRoomIds.length} assigned</span>
                    </div>
                    {rooms.length === 0 ? (
                      <p className="text-xs text-slate-400 p-4">No rooms found — create rooms in Load Calculator first.</p>
                    ) : (
                      <div className="p-3 flex flex-wrap gap-2">
                        {rooms.map(r => {
                          const assigned = selectedSystem.assignedRoomIds.includes(r.id);
                          const inOtherSystem = !assigned && allAssignedIds.has(r.id);
                          return (
                            <button key={r.id}
                              disabled={inOtherSystem}
                              onClick={() => toggleRoomAssignment(selectedSystem, r.id)}
                              className={cn(
                                'text-[11px] px-2.5 py-1 rounded-full border transition-colors',
                                assigned ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-600 hover:border-blue-400 hover:bg-blue-50',
                                inOtherSystem && 'opacity-40 cursor-not-allowed',
                              )}>
                              {r.name}
                              {r.zoneName && <span className="opacity-60 ml-0.5 text-[9px]">·{r.zoneName}</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* VRF: IDU Selection table */}
                  {selectedSystem.type === 'VRF' && selectedSystem.assignedRoomIds.length > 0 && (
                    <div className="rounded-lg border border-slate-200 overflow-hidden">
                      <div className="bg-slate-50 px-4 py-2.5 border-b flex items-center justify-between">
                        <span className="text-xs font-bold uppercase text-slate-500 tracking-wide">Indoor Units (IDU)</span>
                        <span className="text-xs text-slate-400">{Object.keys(selectedSystem.iduSelections).length} of {selectedSystem.assignedRoomIds.length} selected</span>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50/50 text-[10px] uppercase">
                            <TableHead>Room</TableHead>
                            <TableHead>Zone</TableHead>
                            <TableHead className="text-right">Req TR</TableHead>
                            <TableHead className="text-right">Req CFM</TableHead>
                            <TableHead>IDU Selected</TableHead>
                            <TableHead className="text-center">Fit</TableHead>
                            <TableHead className="w-[90px]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedSystem.assignedRoomIds.map(roomId => {
                            const room = rooms.find(r => r.id === roomId);
                            const reqs = getRoomReqs(roomId);
                            const idu = selectedSystem.iduSelections[roomId];
                            const fit = idu ? getFitStatus(idu.trCapacity, idu.cfmRated, reqs.requiredTR, reqs.designCFM) : 'unknown';
                            return (
                              <TableRow key={roomId} className={cn(!idu && 'bg-amber-50/30')}>
                                <TableCell className="font-medium text-xs">{room?.name ?? roomId}</TableCell>
                                <TableCell className="text-xs text-slate-400">{room?.zoneName ?? '—'}</TableCell>
                                <TableCell className="text-right font-mono text-xs">{reqs.requiredTR > 0 ? reqs.requiredTR.toFixed(2) : '—'}</TableCell>
                                <TableCell className="text-right font-mono text-xs">{reqs.designCFM > 0 ? Math.round(reqs.designCFM).toLocaleString() : '—'}</TableCell>
                                <TableCell className="text-xs">
                                  {idu ? (
                                    <div>
                                      <span className="font-semibold">{idu.brand} {idu.modelSeries}</span>
                                      <span className="block text-[10px] text-slate-400">{IDU_SUBTYPE_LABELS[idu.subType] ?? idu.subType} · {idu.trCapacity} TR</span>
                                    </div>
                                  ) : (
                                    <span className="text-amber-600 text-[10px] italic">Not selected</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-center">{idu && <FitBadge status={fit} />}</TableCell>
                                <TableCell>
                                  <div className="flex gap-1 justify-end">
                                    <Button size="sm" variant="outline" className="h-7 text-[10px] px-2"
                                      onClick={() => setIduPicker({ roomId, roomName: room?.name ?? roomId, reqTR: reqs.requiredTR, reqCFM: reqs.designCFM })}>
                                      {idu ? 'Change' : 'Select IDU'}
                                    </Button>
                                    {idu && (
                                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                                        onClick={() => removeIDU(selectedSystem.id, roomId)}>
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {/* VRF: ODU Summary + Selection */}
                  {selectedSystem.type === 'VRF' && selectedSystem.assignedRoomIds.length > 0 && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50/30 overflow-hidden">
                      <div className="bg-blue-50 px-4 py-2.5 border-b border-blue-200 flex items-center gap-2">
                        <Zap className="w-3.5 h-3.5 text-blue-600" />
                        <span className="text-xs font-bold uppercase text-blue-600 tracking-wide">Outdoor Unit (ODU)</span>
                      </div>
                      <div className="p-4 space-y-3">
                        {/* Diversity calculation */}
                        <div className="flex flex-wrap gap-4 text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500">Σ IDU capacity:</span>
                            <span className="font-bold text-slate-800">{totalIDU_TR.toFixed(2)} TR</span>
                          </div>
                          <span className="text-slate-300">×</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500">Diversity {selectedSystem.diversityFactor ?? 0.75}:</span>
                            <span className="font-bold text-blue-700">{requiredODU_TR.toFixed(2)} TR required</span>
                          </div>
                          {oduCapTR > 0 && (
                            <>
                              <span className="text-slate-300">→</span>
                              <div className={cn('flex items-center gap-1.5', connOK ? 'text-emerald-700' : 'text-red-600')}>
                                <span>Connection ratio: {connectionPct.toFixed(0)}%</span>
                                <span className="text-[10px] italic">(50–130% allowed)</span>
                                {connOK ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                              </div>
                            </>
                          )}
                        </div>

                        {/* ODU card or CTA */}
                        {selectedSystem.oduSelection ? (
                          <div className="flex items-center justify-between p-3 rounded-lg bg-white border border-blue-200">
                            <div>
                              <span className="font-bold text-sm text-slate-800">{selectedSystem.oduSelection.brand} {selectedSystem.oduSelection.modelSeries}</span>
                              <div className="flex gap-3 text-[11px] text-slate-500 mt-0.5">
                                <span>{selectedSystem.oduSelection.trCapacity} TR</span>
                                <span className="capitalize">{selectedSystem.oduSelection.dischargeType} discharge</span>
                                <span className="capitalize">{selectedSystem.oduSelection.compressorType === 'heat-pump' ? 'Heat Pump' : 'Cooling Only'}</span>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOduPicker(true)}>Change</Button>
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
                            {totalIDU_TR === 0 && <span className="text-xs italic text-slate-400 ml-1">(add IDUs first)</span>}
                          </Button>
                        )}

                        {oduCapTR > 0 && !connOK && (
                          <p className="text-xs text-red-600 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Connection ratio {connectionPct.toFixed(0)}% is outside 50–130%. Select a different ODU or adjust IDU count.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Package / DuctableSplit: Single unit selection */}
                  {(selectedSystem.type === 'Package' || selectedSystem.type === 'DuctableSplit') && selectedSystem.assignedRoomIds.length > 0 && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/30 overflow-hidden">
                      <div className="bg-emerald-50 px-4 py-2.5 border-b border-emerald-200 flex items-center gap-2">
                        <Package className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-xs font-bold uppercase text-emerald-600 tracking-wide">Unit Selection</span>
                      </div>
                      <div className="p-4 space-y-3">
                        <div className="flex flex-wrap gap-4 text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500">Total required TR:</span>
                            <span className="font-bold text-slate-800">{totalRequiredTR.toFixed(2)} TR</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500">Total design CFM:</span>
                            <span className="font-bold text-slate-800">{Math.round(totalDesignCFM).toLocaleString()}</span>
                          </div>
                        </div>

                        {selectedSystem.unitSelection ? (
                          <div className="flex items-center justify-between p-3 rounded-lg bg-white border border-emerald-200">
                            <div>
                              <span className="font-bold text-sm text-slate-800">{selectedSystem.unitSelection.brand} {selectedSystem.unitSelection.modelSeries}</span>
                              <div className="flex gap-3 text-[11px] text-slate-500 mt-0.5">
                                <span>{selectedSystem.unitSelection.trCapacity} TR</span>
                                <span>{selectedSystem.unitSelection.cfmRated > 0 ? `${Math.round(selectedSystem.unitSelection.cfmRated).toLocaleString()} CFM` : ''}</span>
                                {selectedSystem.unitSelection.subType && <span className="capitalize">{selectedSystem.unitSelection.subType}</span>}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setUnitPicker(true)}>Change</Button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-600" onClick={() => removeUnit(selectedSystem.id)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button variant="outline" className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => setUnitPicker(true)}>
                            <Plus className="w-4 h-4" /> Select Unit
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Drawings Tab ── */}
        <TabsContent value="drawings" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-800">Project Drawings & Documents</h3>
            <Button variant="outline" className="gap-2" disabled><Upload className="w-4 h-4" /> Upload Drawing</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/50 text-[10px] uppercase">
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
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{d.type}</Badge></TableCell>
                      <TableCell className="text-sm text-slate-500">{d.format}</TableCell>
                      <TableCell className="text-sm text-slate-500">{d.version}</TableCell>
                      <TableCell className="text-right">
                        <a href="#" className="inline-flex items-center gap-1.5 h-8 px-3 text-sm text-blue-600 hover:text-blue-800">
                          <ExternalLink className="w-3.5 h-3.5" /> View
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── New System Dialog ── */}
      <Dialog open={showNewSystem} onOpenChange={v => { if (!v) setShowNewSystem(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm font-bold">Create New System</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-1">
            <div>
              <Label className="text-xs font-semibold uppercase text-slate-600">System Name *</Label>
              <Input className="mt-1 h-9 text-sm" placeholder="e.g. VRF System 1, AHU-GF"
                value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createSystem(); }} />
            </div>
            <div>
              <Label className="text-xs font-semibold uppercase text-slate-600">System Type *</Label>
              <Select value={newType} onValueChange={v => setNewType(v as SystemType)}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="VRF">VRF (Multi-split)</SelectItem>
                  <SelectItem value="Package">Package Unit</SelectItem>
                  <SelectItem value="DuctableSplit">Ductable Split</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newType === 'Package' && (
              <div>
                <Label className="text-xs font-semibold uppercase text-slate-600">Package Type</Label>
                <Select value={newPkgSubType} onValueChange={v => setNewPkgSubType(v as any)}>
                  <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="air-cooled">Air Cooled</SelectItem>
                    <SelectItem value="water-cooled">Water Cooled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" className="text-xs" onClick={() => setShowNewSystem(false)}>Cancel</Button>
              <Button className="text-xs gap-1.5" onClick={createSystem} disabled={creatingSystem}>
                <Plus className="w-3.5 h-3.5" />{creatingSystem ? 'Creating…' : 'Create System'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── IDU Picker ── */}
      {iduPicker && selectedSystem && (
        <IDUPickerDialog
          open={!!iduPicker}
          onClose={() => setIduPicker(null)}
          roomName={iduPicker.roomName}
          requiredTR={iduPicker.reqTR}
          designCFM={iduPicker.reqCFM}
          lockedBrand={selectedSystem.brandLocked ? selectedSystem.brand : null}
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

      {/* ── Unit Picker ── */}
      {selectedSystem && (selectedSystem.type === 'Package' || selectedSystem.type === 'DuctableSplit') && (
        <UnitPickerDialog
          open={unitPicker}
          onClose={() => setUnitPicker(false)}
          systemType={selectedSystem.type}
          packageSubType={selectedSystem.packageSubType}
          requiredTR={totalRequiredTR}
          designCFM={totalDesignCFM}
          onSelect={sel => { selectUnit(selectedSystem.id, sel); setUnitPicker(false); }}
        />
      )}
    </div>
  );
}
