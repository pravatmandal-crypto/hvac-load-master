
import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, addDoc, query, onSnapshot, deleteDoc, doc, updateDoc, serverTimestamp, setDoc, getDoc, limit as fsLimit, startAfter, getDocs, orderBy } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { EQUIPMENT_CATALOG, EquipmentModel } from '../../constants/equipment-catalog';
import { 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Package, 
  Truck, 
  Settings, 
  Search, 
  Info, 
  FileText, 
  Upload, 
  ExternalLink,
  Box,
  AlertTriangle,
  Ban,
  PenLine,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';

interface Equipment {
  id: string;
  projectId: string;
  systemId?: string;
  roomId?: string;
  type: string;
  model: string;
  brand: string;
  capacityBTU: number;
  capacityTR?: number;
  ratedAirflowCFM?: number;
  cfm?: number;
  status: 'Selected' | 'Ordered' | 'Installed' | 'Commissioned';
  installationDate?: string;
  notes?: string;
}

// Custom equipment created by users (stored in Firestore global catalog)
interface CustomEquipmentModel extends EquipmentModel {
  isCustom: true;
  createdBy?: string;
  createdAt?: any;
}

interface Drawing {
  id: string;
  name: string;
  type: 'Civil' | 'HVAC' | 'Electrical' | 'As-Built';
  format: 'PDF' | 'DWG' | 'Image';
  url: string;
  uploadedAt: any;
  version: string;
}

// Blank form for creating custom equipment
const BLANK_CUSTOM: Omit<CustomEquipmentModel, 'id' | 'isCustom'> = {
  brand: 'Blue Star' as any,
  type: 'Split' as any,
  subType: '',
  modelSeries: '',
  capacityTR: 1.5,
  capacityBTU: 18000,
  ratedAirflowCFM: undefined,
  refrigerant: '',
  powerInputKW: undefined,
  eer: undefined,
  description: '',
};

export default function EquipmentSelection({ project, userProfile }: { project: any, userProfile: any }) {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [equipmentPage, setEquipmentPage] = useState(1);
  const [equipmentPageSize] = useState(10);
  const [equipmentLastDoc, setEquipmentLastDoc] = useState<any>(null);
  const [equipmentHasMore, setEquipmentHasMore] = useState(true);
  const [rooms, setRooms] = useState<any[]>([]);
  const [systems, setSystems] = useState<any[]>([]);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  
  const [isAdding, setIsAdding] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [customCatalog, setCustomCatalog] = useState<CustomEquipmentModel[]>([]);
  const [discontinuedIds, setDiscontinuedIds] = useState<Set<string>>(new Set());
  const [customForm, setCustomForm] = useState<typeof BLANK_CUSTOM>({ ...BLANK_CUSTOM });
  const [savingCustom, setSavingCustom] = useState(false);

  const canEdit = true;
  const canUpdateStatus = true;
  const [filterBrand, setFilterBrand] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRoomForCatalog, setSelectedRoomForCatalog] = useState<string>('');

  // Get the governing TR requirements for a room from its Firestore-persisted calc values
  const getRoomRequirements = (roomId: string) => {
    const room = rooms.find(r => r.id === roomId);
    if (!room) return null;
    return {
      loadTR:      Number(room._calcLoadTR)      || 0,
      cfmTR:       Number(room._calcCfmTR)       || 0,
      governingTR: Number(room._calcGoverningTR) || 0,
      requiredTR:  Number(room._calcRequiredTR)  || 0,
      designCFM:   Number(room._calcDesignCFM)   || 0,
    };
  };

  const getRatedAirflow = (item: EquipmentModel): number | null => {
    if (item.type === 'Pump') return null;
    return item.ratedAirflowCFM ?? null;
  };

  // Sizing fit status for a catalog item against TR + design airflow requirements.
  const getFitStatus = (
    item: EquipmentModel,
    requiredTR: number,
    designCFM?: number,
  ): 'ok' | 'oversized' | 'undersized' | 'unknown' => {
    if (!requiredTR && !designCFM) return 'unknown';
    if (requiredTR && item.capacityTR < requiredTR) return 'undersized';
    if (designCFM) {
      const ratedAirflow = getRatedAirflow(item);
      if (ratedAirflow === null) return 'unknown';
      if (ratedAirflow < designCFM) return 'undersized';
    }
    if (requiredTR && item.capacityTR > requiredTR * 1.3) return 'oversized';
    return 'ok';
  };

  const fitBadge = (status: 'ok' | 'oversized' | 'undersized' | 'unknown') => {
    switch (status) {
      case 'ok':         return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">✅ Fits</span>;
      case 'oversized':  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">🟡 Oversized</span>;
      case 'undersized': return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">🔴 Undersized</span>;
      default:           return null;
    }
  };

  // Clear stale data immediately when project changes
  useEffect(() => {
    setEquipment([]);
    setRooms([]);
    setSystems([]);
  }, [project?.id]);

  // Fetch Rooms
  useEffect(() => {
    if (!project?.id || !userProfile) return;
    
    const unsubscribes: (() => void)[] = [];
    // Track room listeners by zoneId so we can replace them on zone change
    const roomUnsubByZone: Record<string, () => void> = {};

    const q = query(collection(db, 'projects', project.id, 'zones'));
    const unsubZones = onSnapshot(q, (snapshot) => {
      snapshot.docs.forEach(zoneDoc => {
        // Avoid duplicate room subscriptions for same zone
        if (roomUnsubByZone[zoneDoc.id]) return;
        const roomsQ = query(collection(db, 'projects', project.id, 'zones', zoneDoc.id, 'rooms'));
        const unsubRooms = onSnapshot(roomsQ, (roomSnap) => {
          const roomData = roomSnap.docs.map(d => ({ id: d.id, zoneId: zoneDoc.id, ...d.data() }));
          setRooms(prev => {
            const otherRooms = prev.filter(r => r.zoneId !== zoneDoc.id);
            return [...otherRooms, ...roomData];
          });
        });
        roomUnsubByZone[zoneDoc.id] = unsubRooms;
        unsubscribes.push(unsubRooms);
      });
    });
    
    unsubscribes.push(unsubZones);
    
    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [project?.id, userProfile]);

  // Fetch Systems
  useEffect(() => {
    if (!project?.id || !userProfile) return;
    const q = query(collection(db, 'projects', project.id, 'systems'));
    const unsub = onSnapshot(q, (snapshot) => {
      setSystems(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [project?.id]);

  // Equipment caching and pagination
  useEffect(() => {
    if (!project?.id || !userProfile) return;
    // Try to load from localStorage first
    const cacheKey = `equipment_${project.id}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        setEquipment(JSON.parse(cached));
      } catch (e) {
        console.warn('[EquipmentSelection] Failed to parse cached equipment:', e);
        localStorage.removeItem(cacheKey);
      }
    }
    // Fetch first page from Firestore
    fetchEquipmentPage(1, null);
    // eslint-disable-next-line
  }, [project?.id, userProfile]);

  // Fetch a page of equipment from Firestore
  const fetchEquipmentPage = async (page: number, lastDoc: any) => {
    if (!project?.id) return;
    let q = query(
      collection(db, 'projects', project.id, 'equipment'),
      orderBy('createdAt', 'desc'),
      fsLimit(equipmentPageSize)
    );
    if (lastDoc) {
      q = query(
        collection(db, 'projects', project.id, 'equipment'),
        orderBy('createdAt', 'desc'),
        startAfter(lastDoc),
        fsLimit(equipmentPageSize)
      );
    }
    try {
      const snap = await getDocs(q);
      const equipData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Equipment));
      if (page === 1) {
        setEquipment(equipData);
      } else {
        setEquipment(prev => [...prev, ...equipData]);
      }
      setEquipmentLastDoc(snap.docs[snap.docs.length - 1] || null);
      setEquipmentHasMore(snap.docs.length === equipmentPageSize);
      try {
        localStorage.setItem(`equipment_${project.id}`, JSON.stringify(page === 1 ? equipData : [...equipment, ...equipData]));
      } catch (e) {
        console.warn('[EquipmentSelection] Failed to cache equipment:', e);
      }
    } catch (err: any) {
      console.error('[EquipmentSelection] Failed to fetch equipment:', err);
      toast.error(err?.code === 'permission-denied' ? 'No access to equipment list.' : 'Failed to load equipment.');
    }
  };

  // Pagination controls
  const handleLoadMoreEquipment = () => {
    if (equipmentHasMore && equipmentLastDoc) {
      const nextPage = equipmentPage + 1;
      setEquipmentPage(nextPage);
      fetchEquipmentPage(nextPage, equipmentLastDoc);
    }
  };

  // Fetch Drawings (Mock for now, as we don't have storage setup yet)
  useEffect(() => {
    setDrawings([
      { id: '1', name: 'Ground Floor Civil Layout', type: 'Civil', format: 'PDF', url: '#', uploadedAt: new Date(), version: 'V1.0' },
      { id: '2', name: 'HVAC Ducting Layout - Zone A', type: 'HVAC', format: 'DWG', url: '#', uploadedAt: new Date(), version: 'V2.1' },
    ]);
  }, []);

  // Fetch global custom equipment catalog
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'customEquipmentCatalog'), (snapshot) => {
      setCustomCatalog(snapshot.docs.map(d => ({ id: d.id, isCustom: true, ...d.data() } as CustomEquipmentModel)));
    });
    return () => unsub();
  }, []);

  // Fetch discontinued product overrides
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'equipmentOverrides'), (snapshot) => {
      const ids = new Set<string>();
      snapshot.docs.forEach(d => { if (d.data().discontinued) ids.add(d.id); });
      setDiscontinuedIds(ids);
    });
    return () => unsub();
  }, []);

  const addEquipment = async (model: EquipmentModel, roomId?: string, systemId?: string) => {
    if (discontinuedIds.has(model.id)) {
      toast.error(`⚠️ "${model.brand} ${model.modelSeries}" has been discontinued and cannot be selected.`);
      return;
    }
    try {
      await addDoc(collection(db, 'projects', project.id, 'equipment'), {
        projectId: project.id,
        systemId: systemId || '',
        roomId: roomId || '',
        type: model.type,
        model: model.modelSeries,
        brand: model.brand,
        capacityBTU: model.capacityBTU,
        capacityTR: model.capacityTR,
        ratedAirflowCFM: model.ratedAirflowCFM ?? null,
        cfm: model.ratedAirflowCFM ?? null,
        status: 'Selected',
        createdAt: serverTimestamp(),
      });
      toast.success(`${model.brand} ${model.modelSeries} added to project`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `projects/${project.id}/equipment`);
    }
  };

  const toggleDiscontinued = async (modelId: string, currentlyDiscontinued: boolean) => {
    try {
      await setDoc(doc(db, 'equipmentOverrides', modelId), {
        discontinued: !currentlyDiscontinued,
        updatedBy: userProfile?.uid || '',
        updatedAt: serverTimestamp(),
      }, { merge: true });
      toast.success(currentlyDiscontinued ? 'Product reactivated' : 'Product marked as discontinued');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `equipmentOverrides/${modelId}`);
    }
  };

  const saveCustomEquipment = async () => {
    if (!customForm.modelSeries.trim()) { toast.error('Model name is required'); return; }
    if (!customForm.capacityTR || customForm.capacityTR <= 0) { toast.error('Capacity (TR) must be greater than 0'); return; }
    if (customForm.type !== 'Pump' && (!customForm.ratedAirflowCFM || customForm.ratedAirflowCFM <= 0)) {
      toast.error('Rated airflow CFM is required for strict airflow selection');
      return;
    }
    setSavingCustom(true);
    try {
      const btu = Math.round(customForm.capacityTR * 12000);
      await addDoc(collection(db, 'customEquipmentCatalog'), {
        ...customForm,
        capacityBTU: btu,
        capacityTR: Number(customForm.capacityTR),
        ratedAirflowCFM: customForm.type === 'Pump' ? undefined : Number(customForm.ratedAirflowCFM),
        isCustom: true,
        createdBy: userProfile?.uid || '',
        createdAt: serverTimestamp(),
      });
      toast.success(`Custom equipment "${customForm.modelSeries}" added to catalog`);
      setCustomForm({ ...BLANK_CUSTOM });
      setShowCreateForm(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'customEquipmentCatalog');
    } finally {
      setSavingCustom(false);
    }
  };

  const deleteCustomEquipment = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'customEquipmentCatalog', id));
      toast.success('Custom equipment removed from catalog');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `customEquipmentCatalog/${id}`);
    }
  };

  const updateStatus = async (id: string, status: Equipment['status']) => {
    try {
      await updateDoc(doc(db, 'projects', project.id, 'equipment', id), { status });
      toast.success(`Status updated to ${status}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `projects/${project.id}/equipment/${id}`);
    }
  };

  const deleteEquipment = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'projects', project.id, 'equipment', id));
      toast.success('Equipment removed');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `projects/${project.id}/equipment/${id}`);
    }
  };

  const roomRequirements = selectedRoomForCatalog ? getRoomRequirements(selectedRoomForCatalog) : null;

  // Merge static catalog + custom catalog
  const allCatalogItems: EquipmentModel[] = [...EQUIPMENT_CATALOG, ...customCatalog];

  const filteredCatalog = allCatalogItems.filter(item => {
    const matchesBrand = filterBrand === 'all' || item.brand === filterBrand;
    const matchesType = filterType === 'all' || item.type === filterType;
    const matchesSearch = item.modelSeries.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         item.brand.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesBrand && matchesType && matchesSearch;
  }).sort((a, b) => {
    // Discontinued items always go to bottom
    const aDisc = discontinuedIds.has(a.id) ? 1 : 0;
    const bDisc = discontinuedIds.has(b.id) ? 1 : 0;
    if (aDisc !== bDisc) return aDisc - bDisc;
    // When a room is selected, sort: Fits first, then Oversized, then Undersized
    if (!roomRequirements?.requiredTR && !roomRequirements?.designCFM) return 0;
    const order = { ok: 0, oversized: 1, undersized: 2, unknown: 3 };
    return order[getFitStatus(a, roomRequirements.requiredTR, roomRequirements.designCFM)] - order[getFitStatus(b, roomRequirements.requiredTR, roomRequirements.designCFM)];
  });

  const getStatusIcon = (status: Equipment['status']) => {
    switch (status) {
      case 'Selected': return <CheckCircle2 className="w-4 h-4 text-blue-500" />;
      case 'Ordered': return <Truck className="w-4 h-4 text-orange-500" />;
      case 'Installed': return <Package className="w-4 h-4 text-purple-500" />;
      case 'Commissioned': return <Settings className="w-4 h-4 text-green-500" />;
    }
  };

  const getStatusColor = (status: Equipment['status']) => {
    switch (status) {
      case 'Selected': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'Ordered': return 'bg-orange-50 text-orange-700 border-orange-200';
      case 'Installed': return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'Commissioned': return 'bg-green-50 text-green-700 border-green-200';
    }
  };

  if (!project) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Equipment & Execution</h2>
            <p className="text-gray-500">Select a project from the Dashboard to manage equipment.</p>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center h-64 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 text-gray-400 gap-3">
          <Box className="w-10 h-10 opacity-30" />
          <p className="text-sm font-medium">No project open — go to Dashboard and open a project first.</p>
          <p className="text-xs text-gray-400">Once a project is opened, Equipment Selection will load automatically.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Equipment & Execution</h2>
          <p className="text-gray-500">Manage {project.name} equipment selection and site drawings.</p>
        </div>
      </div>

      <Tabs defaultValue="equipment" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2 mb-8">
          <TabsTrigger value="equipment" className="gap-2">
            <Package className="w-4 h-4" /> Equipment Selection
          </TabsTrigger>
          <TabsTrigger value="drawings" className="gap-2">
            <FileText className="w-4 h-4" /> Drawings & Docs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="equipment" className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-800">
              {showCreateForm ? 'Create Custom Equipment' : isAdding ? 'Product Catalog' : 'Selected Equipment'}
            </h3>
            <div className="flex gap-2">
              {canEdit && isAdding && !showCreateForm && (
                <Button onClick={() => setShowCreateForm(true)} variant="outline" className="gap-2 border-violet-200 text-violet-700 hover:bg-violet-50">
                  <PenLine className="w-4 h-4" /> Create Custom
                </Button>
              )}
              {canEdit && (
                <Button onClick={() => { setIsAdding(!isAdding); setShowCreateForm(false); }} variant="outline" className="gap-2">
                  {isAdding ? 'View Project Equipment' : 'Add New Equipment'}
                </Button>
              )}
            </div>
          </div>

          {/* ── Create Custom Equipment Form ── */}
          {showCreateForm && (
            <Card className="border-violet-200 shadow-sm">
              <CardHeader className="bg-violet-50 border-b border-violet-100">
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-violet-700 flex items-center gap-2">
                  <PenLine className="w-4 h-4" /> New Custom Equipment
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <Label className="text-xs font-semibold text-slate-600 uppercase">Brand *</Label>
                    <Input className="mt-1 h-9 text-xs" placeholder="e.g. Daikin"
                      value={customForm.brand}
                      onChange={e => setCustomForm(f => ({ ...f, brand: e.target.value as any }))} />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-slate-600 uppercase">Type *</Label>
                    <Select value={customForm.type} onValueChange={val => setCustomForm(f => ({ ...f, type: val as any }))}>
                      <SelectTrigger className="mt-1 h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Chiller">Chiller</SelectItem>
                        <SelectItem value="VRF">VRF</SelectItem>
                        <SelectItem value="Package">Package</SelectItem>
                        <SelectItem value="Split">Split</SelectItem>
                        <SelectItem value="FCU">FCU</SelectItem>
                        <SelectItem value="Pump">Pump</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-slate-600 uppercase">Sub Type</Label>
                    <Input className="mt-1 h-9 text-xs" placeholder="e.g. Inverter Cassette"
                      value={customForm.subType || ''}
                      onChange={e => setCustomForm(f => ({ ...f, subType: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-slate-600 uppercase">Model Series *</Label>
                    <Input className="mt-1 h-9 text-xs" placeholder="e.g. FTXS Series"
                      value={customForm.modelSeries}
                      onChange={e => setCustomForm(f => ({ ...f, modelSeries: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-slate-600 uppercase">Capacity (TR) *</Label>
                    <Input className="mt-1 h-9 text-xs" type="number" min="0.1" step="0.5" placeholder="1.5"
                      value={customForm.capacityTR}
                      onChange={e => setCustomForm(f => ({ ...f, capacityTR: parseFloat(e.target.value) || 0 }))} />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-slate-600 uppercase">Refrigerant</Label>
                    <Input className="mt-1 h-9 text-xs" placeholder="e.g. R32"
                      value={customForm.refrigerant || ''}
                      onChange={e => setCustomForm(f => ({ ...f, refrigerant: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-slate-600 uppercase">Power Input (kW)</Label>
                    <Input className="mt-1 h-9 text-xs" type="number" min="0" step="0.1" placeholder="1.2"
                      value={customForm.powerInputKW || ''}
                      onChange={e => setCustomForm(f => ({ ...f, powerInputKW: parseFloat(e.target.value) || undefined }))} />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-slate-600 uppercase">Rated Airflow (CFM){customForm.type !== 'Pump' ? ' *' : ''}</Label>
                    <Input className="mt-1 h-9 text-xs" type="number" min="0" step="10" placeholder="e.g. 600"
                      value={customForm.ratedAirflowCFM || ''}
                      onChange={e => setCustomForm(f => ({ ...f, ratedAirflowCFM: parseFloat(e.target.value) || undefined }))} />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-slate-600 uppercase">EER</Label>
                    <Input className="mt-1 h-9 text-xs" type="number" min="0" step="0.1" placeholder="3.5"
                      value={customForm.eer || ''}
                      onChange={e => setCustomForm(f => ({ ...f, eer: parseFloat(e.target.value) || undefined }))} />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-slate-600 uppercase">Description</Label>
                    <Input className="mt-1 h-9 text-xs" placeholder="Optional notes"
                      value={customForm.description || ''}
                      onChange={e => setCustomForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-5">
                  <Button variant="outline" className="text-xs" onClick={() => { setShowCreateForm(false); setCustomForm({ ...BLANK_CUSTOM }); }}>
                    Cancel
                  </Button>
                  <Button className="text-xs bg-violet-600 hover:bg-violet-700 text-white gap-2" onClick={saveCustomEquipment} disabled={savingCustom}>
                    <Plus className="w-3.5 h-3.5" /> {savingCustom ? 'Saving…' : 'Save to Catalog'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {isAdding ? (
            <Card className="border-blue-100 shadow-sm">
              <CardHeader className="bg-slate-50 border-b">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-600">Browse Catalog</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                      <Input 
                        placeholder="Search models..." 
                        className="pl-9 w-48 h-9 text-xs"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>
                    <Select value={filterBrand} onValueChange={(val) => setFilterBrand(val ?? 'all')}>
                      <SelectTrigger className="h-9 w-32 text-xs"><SelectValue placeholder="Brand" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Brands</SelectItem>
                        <SelectItem value="Blue Star">Blue Star</SelectItem>
                        <SelectItem value="Voltas">Voltas</SelectItem>
                        <SelectItem value="Samsung">Samsung</SelectItem>
                        <SelectItem value="Fujitsu">Fujitsu</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={filterType} onValueChange={(val) => setFilterType(val ?? 'all')}>
                      <SelectTrigger className="h-9 w-32 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="Chiller">Chillers</SelectItem>
                        <SelectItem value="VRF">VRF Systems</SelectItem>
                        <SelectItem value="Package">Package Units</SelectItem>
                        <SelectItem value="Split">Split Units</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={selectedRoomForCatalog} onValueChange={(val) => setSelectedRoomForCatalog(val ?? '')}>
                      <SelectTrigger className="h-9 w-40 text-xs"><SelectValue placeholder="Filter by room…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">No room filter</SelectItem>
                        {rooms.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Room requirements banner */}
                {roomRequirements && roomRequirements.requiredTR > 0 && (
                  <div className="mt-3 flex flex-wrap gap-3 p-3 rounded-lg bg-violet-50 border border-violet-200">
                    <Info className="w-4 h-4 text-violet-500 mt-0.5 shrink-0" />
                    <span className="text-xs font-semibold text-violet-700">
                      {rooms.find(r => r.id === selectedRoomForCatalog)?.name} — Sizing Requirements:
                    </span>
                    <span className="text-xs text-slate-600">Load TR: <strong>{roomRequirements.loadTR.toFixed(2)}</strong></span>
                    <span className="text-xs text-slate-600">CFM TR: <strong>{roomRequirements.cfmTR.toFixed(2)}</strong></span>
                    <span className="text-xs text-slate-600">Design CFM: <strong>{Math.round(roomRequirements.designCFM).toLocaleString()}</strong></span>
                    <span className="text-xs font-bold text-violet-800">Governing: {roomRequirements.governingTR.toFixed(2)} TR</span>
                    <span className="text-xs font-bold text-orange-700">Required (×1.10): {roomRequirements.requiredTR.toFixed(2)} TR</span>
                    <span className="text-[10px] text-slate-400 italic">✅ Fits = {roomRequirements.requiredTR.toFixed(2)}–{(roomRequirements.requiredTR * 1.3).toFixed(2)} TR</span>
                  </div>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/50 text-[10px] uppercase">
                      <TableHead>Brand</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Model Series</TableHead>
                      <TableHead className="text-right">Capacity (TR)</TableHead>
                      <TableHead className="text-right">Capacity (BTU/h)</TableHead>
                      <TableHead className="text-right">Rated CFM</TableHead>
                      {roomRequirements && <TableHead className="text-center">Fit</TableHead>}
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCatalog.map((item) => {
                      const isDiscontinued = discontinuedIds.has(item.id);
                      const isCustom = !!(item as any).isCustom;
                      const fitStatus = roomRequirements ? getFitStatus(item, roomRequirements.requiredTR, roomRequirements.designCFM) : 'unknown';
                      const ratedCfm = getRatedAirflow(item);
                      const cannotAddForStrictAirflow = !!roomRequirements?.designCFM && fitStatus === 'unknown';
                      return (
                        <TableRow key={item.id} className={cn(
                          "transition-colors",
                          isDiscontinued ? "bg-red-50/40 opacity-60" : "hover:bg-blue-50/30",
                          !isDiscontinued && fitStatus === 'ok' && "bg-emerald-50/20",
                          !isDiscontinued && fitStatus === 'undersized' && "opacity-60"
                        )}>
                          <TableCell className="font-bold">
                            <div className="flex flex-col gap-0.5">
                              {item.brand}
                              {isCustom && <span className="text-[9px] font-semibold text-violet-600 uppercase tracking-wide">Custom</span>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <Badge variant="outline" className="text-[10px] font-normal w-fit">
                                {item.type} {item.subType && `(${item.subType})`}
                              </Badge>
                              {isDiscontinued && (
                                <Badge className="text-[9px] bg-red-100 text-red-700 border-red-200 gap-1 w-fit">
                                  <Ban className="w-3 h-3" /> Discontinued
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-medium">{item.modelSeries}</TableCell>
                          <TableCell className="text-right font-mono">{item.capacityTR}</TableCell>
                          <TableCell className="text-right font-mono">{item.capacityBTU.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono">{ratedCfm !== null ? Math.round(ratedCfm).toLocaleString() : 'N/A'}</TableCell>
                          {roomRequirements && (
                            <TableCell className="text-center">{isDiscontinued ? null : fitBadge(fitStatus)}</TableCell>
                          )}
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1.5">
                              {!isDiscontinued ? (
                                <>
                                  <Select onValueChange={(val: any) => { if (typeof val === 'string') addEquipment(item, val); }}>
                                    <SelectTrigger className="h-8 w-32 text-[10px]" disabled={cannotAddForStrictAirflow || fitStatus === 'undersized'}><SelectValue placeholder="Assign to Room" /></SelectTrigger>
                                    <SelectContent>
                                      {rooms.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                  <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => addEquipment(item)} title="Add to project" disabled={cannotAddForStrictAirflow || fitStatus === 'undersized'}>
                                    <Plus className="w-4 h-4" />
                                  </Button>
                                </>
                              ) : (
                                <span className="text-[10px] text-red-500 italic mr-2">Not available</span>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                title={isDiscontinued ? 'Reactivate product' : 'Mark as discontinued'}
                                className={cn("h-8 w-8 p-0", isDiscontinued ? "text-green-500 hover:text-green-700" : "text-red-400 hover:text-red-600")}
                                onClick={() => toggleDiscontinued(item.id, isDiscontinued)}
                              >
                                {isDiscontinued ? <CheckCircle2 className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                              </Button>
                              {isCustom && (
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-red-500" title="Delete custom equipment" onClick={() => deleteCustomEquipment(item.id)}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              <Card className="border-slate-200 shadow-sm">
                <CardContent className="p-0">
                  {equipment.length === 0 ? (
                    <div className="p-12 text-center">
                      <div className="bg-slate-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Settings className="w-8 h-8 text-slate-400" />
                      </div>
                      <h3 className="text-lg font-medium text-slate-900">No equipment selected yet</h3>
                      <p className="text-slate-500 max-w-xs mx-auto mt-2">Start by browsing the catalog and assigning units to your rooms.</p>
                      <Button onClick={() => setIsAdding(true)} variant="outline" className="mt-6">
                        Browse Catalog
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50/50 text-[10px] uppercase">
                            <TableHead>Status</TableHead>
                            <TableHead>Brand & Model</TableHead>
                            <TableHead>Assigned To</TableHead>
                            <TableHead className="text-right">Capacity</TableHead>
                            <TableHead className="text-right">CFM</TableHead>
                            <TableHead className="text-center">Sizing</TableHead>
                            <TableHead className="text-right">Update Status</TableHead>
                            <TableHead className="w-[50px]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {equipment.map((item) => {
                            const room = rooms.find(r => r.id === item.roomId);
                            const system = systems.find(s => s.id === item.systemId);
                            const itemTR = item.capacityTR ?? (item.capacityBTU / 12000);
                            const roomReqs = item.roomId ? getRoomRequirements(item.roomId) : null;
                            const sizingStatus = roomReqs && (roomReqs.requiredTR > 0 || roomReqs.designCFM > 0)
                              ? getFitStatus({
                                  id: item.id,
                                  brand: item.brand as any,
                                  type: item.type as any,
                                  modelSeries: item.model,
                                  capacityTR: itemTR,
                                  capacityBTU: item.capacityBTU,
                                  ratedAirflowCFM: item.ratedAirflowCFM,
                                } as EquipmentModel, roomReqs.requiredTR, roomReqs.designCFM)
                              : 'unknown';
                            return (
                              <TableRow key={item.id}>
                                <TableCell>
                                  <Badge variant="outline" className={cn("gap-1.5 px-2 py-0.5 text-[10px]", getStatusColor(item.status))}>
                                    {getStatusIcon(item.status)}
                                    {item.status}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-col">
                                    <span className="font-bold text-slate-900">{item.brand}</span>
                                    <span className="text-xs text-slate-500">{item.model} ({item.type})</span>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-col">
                                    <span className="text-sm font-medium">{room?.name || 'Unassigned'}</span>
                                    <span className="text-[10px] text-slate-400">{system?.name || 'Direct Zone'}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs">
                                  {item.capacityBTU.toLocaleString()} BTU/h
                                  <span className="block text-[10px] text-slate-400">{itemTR.toFixed(2)} TR</span>
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs">
                                  {item.ratedAirflowCFM ? `${Math.round(item.ratedAirflowCFM).toLocaleString()} CFM` : 'N/A'}
                                </TableCell>
                                <TableCell className="text-center">
                                  {sizingStatus !== 'unknown' ? fitBadge(sizingStatus) : (
                                    <span className="text-[10px] text-slate-400 italic">No calc</span>
                                  )}
                                  {roomReqs && roomReqs.requiredTR > 0 && (
                                    <span className="block text-[10px] text-slate-400 mt-0.5">Need {roomReqs.requiredTR.toFixed(2)} TR</span>
                                  )}
                                  {roomReqs && roomReqs.designCFM > 0 && (
                                    <span className="block text-[10px] text-slate-400 mt-0.5">Need {Math.round(roomReqs.designCFM).toLocaleString()} CFM</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Select 
                                    value={item.status}
                                    onValueChange={(val) => { if (val) updateStatus(item.id, val); }}
                                    disabled={!canUpdateStatus}
                                  >
                                    <SelectTrigger className="h-8 w-32 ml-auto text-[10px]"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="Selected">Selected</SelectItem>
                                      <SelectItem value="Ordered">Ordered</SelectItem>
                                      <SelectItem value="Installed">Installed</SelectItem>
                                      <SelectItem value="Commissioned">Commissioned</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell>
                                  {canEdit && (
                                    <Button variant="ghost" size="icon" onClick={() => deleteEquipment(item.id)} className="h-8 w-8 text-red-400 hover:text-red-600">
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                      {equipmentHasMore && (
                        <div className="flex justify-center my-4">
                          <Button variant="outline" onClick={handleLoadMoreEquipment} className="text-xs">Load More</Button>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="border-blue-100 bg-blue-50/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-blue-700">Total Equipment</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-blue-900">{equipment.length}</p>
                    <p className="text-xs text-blue-600 mt-1">units selected for this project</p>
                  </CardContent>
                </Card>
                <Card className="border-green-100 bg-green-50/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-green-700">Total Capacity</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-green-900">
                      {(equipment.reduce((sum, e) => sum + e.capacityBTU, 0) / 1000).toFixed(0)}k
                    </p>
                    <p className="text-xs text-green-600 mt-1">BTU/h across all units</p>
                  </CardContent>
                </Card>
                <Card className="border-purple-100 bg-purple-50/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-purple-700">Commissioned</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-purple-900">
                      {equipment.filter(e => e.status === 'Commissioned').length}
                    </p>
                    <p className="text-xs text-purple-600 mt-1">
                      of {equipment.length} units fully commissioned
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="drawings" className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-800">Project Drawings & Documents</h3>
            {canEdit && (
              <Button variant="outline" className="gap-2" disabled>
                <Upload className="w-4 h-4" /> Upload Drawing
              </Button>
            )}
          </div>
          {drawings.length === 0 ? (
            <div className="p-12 text-center">
              <div className="bg-slate-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-lg font-medium text-slate-900">No drawings uploaded</h3>
              <p className="text-slate-500 max-w-xs mx-auto mt-2">Upload project drawings and documents to share with the team.</p>
            </div>
          ) : (
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
                    {drawings.map((drawing) => (
                      <TableRow key={drawing.id}>
                        <TableCell className="font-medium">{drawing.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">{drawing.type}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">{drawing.format}</TableCell>
                        <TableCell className="text-sm text-slate-500">{drawing.version}</TableCell>
                        <TableCell className="text-right">
                          <a href={drawing.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-8 px-3 text-sm text-blue-600 hover:text-blue-800">
                            <ExternalLink className="w-3.5 h-3.5" /> View
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}