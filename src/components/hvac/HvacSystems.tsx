import { useState, useEffect, useRef, useCallback } from 'react';
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { envelopeCache } from '../../lib/envelopeCache';
import {
  calculateAndPersistRoom,
  type RoomCalcDesignConditions,
} from '../../services/loadCalculationService';
import { type HvacSystemDoc, type HvacZoneDoc, type SystemType } from '../../types/equipment-systems';
import { generatePDFReport } from '../../services/reportService';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  Edit2,
  Loader2,
  Building2,
  Download,
} from 'lucide-react';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { NumericInput } from '../ui/numeric-input';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HvacSystemsProps {
  project: any;
  userProfile: { uid: string; email: string | null } | null;
  userRole: string | null;
  onProjectChange?: (project: any) => void;
}

interface RoomDoc {
  id: string;
  name: string;
  floor: string;
  length: number;
  width: number;
  height: number;
  hasFalseCeiling?: boolean;
  falseCeilingHeight?: number;
  facph: number;
  peopleCount: number;
  activityType: string;
  lightsWattsPerSqft: number;
  equipmentKW: number;
  othersKW: number;
  sensibleSafetyPercent: number;
  latentSafetyPercent: number;
  overallSafetyPercent: number;
  ductGainPct: number;
  fanGainPct: number;
  hvacSystemId?: string;
  hvacZoneId?: string;
  hvacSystemName?: string;
  hvacZoneName?: string;
  _calcOverallGoverningTR?: number;
  _calcOverallDesignCFM?: number;
  [key: string]: unknown;
}

type ActivityType =
  | 'office'
  | 'retail'
  | 'restaurant'
  | 'hotel'
  | 'hospital'
  | 'classroom'
  | 'auditorium'
  | 'gym'
  | 'lab'
  | 'custom';

// ─── Design conditions resolver ───────────────────────────────────────────────

function resolveDesignConditions(project: any, zone?: HvacZoneDoc): RoomCalcDesignConditions {
  return {
    outdoorTemp: zone?.outdoorTemp ?? project.summerDesignTemp ?? 95,
    indoorTemp: zone?.indoorTemp ?? project.insideSummerTemp ?? 75,
    outdoorHumidity: zone?.outdoorHumidity ?? project.summerDesignHumidity ?? 60,
    indoorHumidity: zone?.indoorHumidity ?? project.insideSummerHumidity ?? 50,
    altitude: project.altitude ?? 0,
    latitude: project.latitude,
    longitude: project.longitude,
    winterOutdoorTemp: project.winterDesignTemp ?? 45,
    winterOutdoorHumidity: project.winterDesignHumidity ?? 30,
    monsoonOutdoorTemp: project.includeMonsoon ? (project.monsoonDesignTemp ?? 90) : undefined,
    monsoonOutdoorHumidity: project.includeMonsoon ? (project.monsoonDesignHumidity ?? 80) : undefined,
  };
}

// ─── Badge colors ─────────────────────────────────────────────────────────────

const SYSTEM_TYPE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  VRF:           { bg: 'bg-green-100',  text: 'text-green-800',  label: 'VRF' },
  Chiller:       { bg: 'bg-blue-100',   text: 'text-blue-800',   label: 'CHILLER' },
  Package:       { bg: 'bg-purple-100', text: 'text-purple-800', label: 'PACKAGE' },
  DuctableSplit: { bg: 'bg-indigo-100', text: 'text-indigo-800', label: 'DUCTABLE' },
  Split:         { bg: 'bg-orange-100', text: 'text-orange-800', label: 'SPLIT' },
  AHU:           { bg: 'bg-teal-100',   text: 'text-teal-800',   label: 'AHU' },
  DOAS:          { bg: 'bg-gray-100',   text: 'text-gray-700',   label: 'DOAS' },
};

function SystemTypeBadge({ type }: { type: string }) {
  const style = SYSTEM_TYPE_STYLES[type] ?? { bg: 'bg-gray-100', text: 'text-gray-700', label: type };
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  );
}

// ─── Activity type options ─────────────────────────────────────────────────────

const ACTIVITY_TYPES: { value: ActivityType; label: string }[] = [
  { value: 'office',     label: 'Office' },
  { value: 'retail',     label: 'Retail' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'hotel',      label: 'Hotel' },
  { value: 'hospital',   label: 'Hospital' },
  { value: 'classroom',  label: 'Classroom' },
  { value: 'auditorium', label: 'Auditorium' },
  { value: 'gym',        label: 'Gym' },
  { value: 'lab',        label: 'Lab' },
  { value: 'custom',     label: 'Custom' },
];

// ─── Number field helper ───────────────────────────────────────────────────────

function NumField({
  label,
  value,
  onChange,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-gray-500">{label}</Label>
      <NumericInput
        value={value}
        onChange={(n) => onChange(n ?? 0)}
        className="h-8 text-sm"
      />
    </div>
  );
}

// ─── Inline Room Edit Panel ────────────────────────────────────────────────────

interface RoomEditPanelProps {
  room: RoomDoc;
  projectId: string;
  zone: HvacZoneDoc;
  project: any;
  onClose: () => void;
  onSaved: (updatedRoom: RoomDoc) => void;
}

function RoomEditPanel({ room, projectId, zone, project, onClose, onSaved }: RoomEditPanelProps) {
  const [form, setForm] = useState<RoomDoc>({ ...room });
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof RoomDoc>(key: K, value: RoomDoc[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Room name is required'); return; }
    setSaving(true);
    try {
      const roomRef = doc(db, 'projects', projectId, 'rooms', room.id);
      const updatePayload = {
        name: form.name,
        floor: form.floor,
        length: form.length,
        width: form.width,
        height: form.height,
        facph: form.facph,
        peopleCount: form.peopleCount,
        activityType: form.activityType,
        lightsWattsPerSqft: form.lightsWattsPerSqft,
        equipmentKW: form.equipmentKW,
        othersKW: form.othersKW,
        sensibleSafetyPercent: form.sensibleSafetyPercent,
        latentSafetyPercent: form.latentSafetyPercent,
        overallSafetyPercent: form.overallSafetyPercent,
        ductGainPct: form.ductGainPct,
        fanGainPct: form.fanGainPct,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(roomRef, updatePayload);

      // Load envelope elements from cache or Firestore
      let elements = envelopeCache.get(projectId, room.id);
      if (!elements) {
        const snap = await getDocs(
          collection(db, 'projects', projectId, 'rooms', room.id, 'envelopeElements'),
        );
        elements = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        envelopeCache.set(projectId, room.id, elements);
      }

      const dc = resolveDesignConditions(project, zone);
      const result = await calculateAndPersistRoom(
        projectId,
        room.id,
        { ...form },
        elements,
        dc,
        project.systemType,
        (project as any).adpBasis,
        (project as any).supplyBasis,
      );

      const updated: RoomDoc = { ...form, ...result };
      onSaved(updated);
      toast.success('Room saved and recalculated');
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('Failed to save room');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-inner">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-blue-800">Edit Room</h4>
        <button
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-blue-100 hover:text-gray-600"
          aria-label="Close edit panel"
        >
          &times;
        </button>
      </div>

      {/* Row 1: name, floor, dimensions */}
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-gray-500">Room Name</Label>
          <Input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-gray-500">Floor</Label>
          <Input
            value={form.floor}
            onChange={(e) => set('floor', e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <NumField label="Length (ft)" value={form.length} onChange={(v) => set('length', v)} />
        <NumField label="Width (ft)"  value={form.width}  onChange={(v) => set('width', v)} />
        <NumField label="Height (ft)" value={form.height} onChange={(v) => set('height', v)} />
      </div>

      {/* Row 2: occupancy and internal gains */}
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <NumField label="People" value={form.peopleCount} onChange={(v) => set('peopleCount', v)} step={1} />
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-gray-500">Activity Type</Label>
          <Select
            value={form.activityType}
            onValueChange={(v) => set('activityType', v)}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTIVITY_TYPES.map((a) => (
                <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <NumField label="Lights W/ft²"  value={form.lightsWattsPerSqft} onChange={(v) => set('lightsWattsPerSqft', v)} />
        <NumField label="Equipment kW"  value={form.equipmentKW}        onChange={(v) => set('equipmentKW', v)} />
        <NumField label="Others kW"     value={form.othersKW}           onChange={(v) => set('othersKW', v)} />
      </div>

      {/* Row 3: ventilation and safety factors */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <NumField label="FA CPH"           value={form.facph}                  onChange={(v) => set('facph', v)}                  step={0.5} />
        <NumField label="Duct Gain %"      value={form.ductGainPct}            onChange={(v) => set('ductGainPct', v)}            step={0.5} />
        <NumField label="Fan Gain %"       value={form.fanGainPct}             onChange={(v) => set('fanGainPct', v)}             step={0.5} />
        <NumField label="Sensible Safety %" value={form.sensibleSafetyPercent} onChange={(v) => set('sensibleSafetyPercent', v)} step={1} />
        <NumField label="Latent Safety %"  value={form.latentSafetyPercent}    onChange={(v) => set('latentSafetyPercent', v)}    step={1} />
        <NumField label="Overall Safety %" value={form.overallSafetyPercent}   onChange={(v) => set('overallSafetyPercent', v)}   step={1} />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving
            ? <><Loader2 size={14} className="mr-1 animate-spin" />Saving...</>
            : 'Recalculate & Save'}
        </Button>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function HvacSystems({ project, userProfile: _userProfile, userRole }: HvacSystemsProps) {
  const projectId: string = project?.id ?? '';

  const [loading, setLoading] = useState(true);
  const [systems, setSystems] = useState<HvacSystemDoc[]>([]);
  // zones keyed by systemId
  const [zones, setZones] = useState<Record<string, HvacZoneDoc[]>>({});
  // rooms keyed by hvacZoneId
  const [roomsByZone, setRoomsByZone] = useState<Record<string, RoomDoc[]>>({});
  // expanded state
  const [expandedSystems, setExpandedSystems] = useState<Set<string>>(new Set());
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());
  // which room row is being edited: "zoneId:roomId"
  const [editingRoomKey, setEditingRoomKey] = useState<string | null>(null);
  // zones loading in progress
  const [loadingZones, setLoadingZones] = useState<Set<string>>(new Set());

  // ── Dialogs ──────────────────────────────────────────────────────────────
  const [addSystemOpen, setAddSystemOpen] = useState(false);
  const [addSystemName, setAddSystemName] = useState('');
  const [addSystemType, setAddSystemType] = useState<SystemType>('VRF');

  const [addZoneOpen, setAddZoneOpen] = useState(false);
  const [addZoneSystemId, setAddZoneSystemId] = useState('');
  const [addZoneName, setAddZoneName] = useState('');

  const [addRoomOpen, setAddRoomOpen] = useState(false);
  const [addRoomSystemId, setAddRoomSystemId] = useState('');
  const [addRoomZoneId, setAddRoomZoneId] = useState('');
  const [addRoomSystemName, setAddRoomSystemName] = useState('');
  const [addRoomZoneName, setAddRoomZoneName] = useState('');
  const [addRoomName, setAddRoomName] = useState('');
  const [addRoomFloor, setAddRoomFloor] = useState('');

  const [generatingReport, setGeneratingReport] = useState(false);
  const roomsUnsubRef = useRef<(() => void) | null>(null);

  // ── Subscribe to systems ──────────────────────────────────────────────────
  useEffect(() => {
    if (!projectId) { setLoading(false); return; }
    const unsub = onSnapshot(
      collection(db, 'projects', projectId, 'hvacSystems'),
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as HvacSystemDoc));
        setSystems(docs);
        setLoading(false);
      },
      (err) => {
        console.error('hvacSystems snapshot error', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [projectId]);

  // ── Subscribe to all rooms, group by hvacZoneId ───────────────────────────
  useEffect(() => {
    if (!projectId) return;
    if (roomsUnsubRef.current) { roomsUnsubRef.current(); roomsUnsubRef.current = null; }

    const unsub = onSnapshot(
      collection(db, 'projects', projectId, 'rooms'),
      (snap) => {
        const grouped: Record<string, RoomDoc[]> = {};
        snap.docs.forEach((d) => {
          const room = { id: d.id, ...d.data() } as RoomDoc;
          const zoneId = room.hvacZoneId ?? '__unassigned__';
          if (!grouped[zoneId]) grouped[zoneId] = [];
          grouped[zoneId].push(room);
        });
        setRoomsByZone(grouped);
      },
      (err) => console.error('rooms snapshot error', err),
    );
    roomsUnsubRef.current = unsub;
    return () => { unsub(); roomsUnsubRef.current = null; };
  }, [projectId]);

  // ── Load zones for a system (on expand) ──────────────────────────────────
  const loadZonesForSystem = useCallback(async (systemId: string) => {
    if (zones[systemId] !== undefined || loadingZones.has(systemId)) return;
    setLoadingZones((prev) => new Set(prev).add(systemId));
    try {
      const snap = await getDocs(
        collection(db, 'projects', projectId, 'hvacSystems', systemId, 'zones'),
      );
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as HvacZoneDoc));
      setZones((prev) => ({ ...prev, [systemId]: docs }));
    } catch (err) {
      console.error('loadZonesForSystem error', err);
    } finally {
      setLoadingZones((prev) => { const s = new Set(prev); s.delete(systemId); return s; });
    }
  }, [projectId, zones, loadingZones]);

  // ── Load envelope elements for rooms in a zone ────────────────────────────
  const loadEnvelopeForZone = useCallback(async (zoneId: string) => {
    const rooms = roomsByZone[zoneId] ?? [];
    await Promise.all(
      rooms.map(async (room) => {
        if (envelopeCache.get(projectId, room.id)) return;
        try {
          const snap = await getDocs(
            collection(db, 'projects', projectId, 'rooms', room.id, 'envelopeElements'),
          );
          const elements = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          envelopeCache.set(projectId, room.id, elements);
        } catch (err) {
          console.error('loadEnvelopeForZone error for room', room.id, err);
        }
      }),
    );
  }, [projectId, roomsByZone]);

  // ── Toggle system expand ──────────────────────────────────────────────────
  const toggleSystem = async (systemId: string) => {
    const next = new Set(expandedSystems);
    if (next.has(systemId)) {
      next.delete(systemId);
    } else {
      next.add(systemId);
      await loadZonesForSystem(systemId);
    }
    setExpandedSystems(next);
  };

  // ── Toggle zone expand ────────────────────────────────────────────────────
  const toggleZone = async (zoneId: string) => {
    const next = new Set(expandedZones);
    if (next.has(zoneId)) {
      next.delete(zoneId);
    } else {
      next.add(zoneId);
      await loadEnvelopeForZone(zoneId);
    }
    setExpandedZones(next);
  };

  // ── Totals helpers ────────────────────────────────────────────────────────
  const zoneRooms = (zoneId: string): RoomDoc[] => roomsByZone[zoneId] ?? [];

  const zoneTotalTR = (zoneId: string) =>
    zoneRooms(zoneId).reduce((sum, r) => sum + (r._calcOverallGoverningTR ?? 0), 0);

  const zoneTotalCFM = (zoneId: string) =>
    zoneRooms(zoneId).reduce((sum, r) => sum + (r._calcOverallDesignCFM ?? 0), 0);

  const systemTotalTR = (systemId: string) =>
    (zones[systemId] ?? []).reduce((sum, z) => sum + zoneTotalTR(z.id), 0);

  const systemTotalCFM = (systemId: string) =>
    (zones[systemId] ?? []).reduce((sum, z) => sum + zoneTotalCFM(z.id), 0);

  // ── Global summary ────────────────────────────────────────────────────────
  const allRooms = Object.values(roomsByZone).flat();
  const totalSystemsTR = allRooms.reduce((s, r) => s + (r._calcOverallGoverningTR ?? 0), 0);
  const totalSystemsCFM = allRooms.reduce((s, r) => s + (r._calcOverallDesignCFM ?? 0), 0);
  const totalZonesCount = Object.values(zones).flat().length;

  // ── Generate PDF Report ───────────────────────────────────────────────────
  const handleGenerateReport = async () => {
    if (!projectId || !project) { toast.error('No project selected'); return; }
    setGeneratingReport(true);
    try {
      // Ensure all zones are loaded
      const allZonesBySystem: Record<string, HvacZoneDoc[]> = { ...zones };
      for (const sys of systems) {
        if (!allZonesBySystem[sys.id]) {
          const snap = await getDocs(
            collection(db, 'projects', projectId, 'hvacSystems', sys.id, 'zones'),
          );
          allZonesBySystem[sys.id] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as HvacZoneDoc));
        }
      }

      // Collect envelope elements for all rooms (use cache, fetch missing)
      const allEnvelopes: Record<string, any[]> = {};
      for (const room of allRooms) {
        let elements = envelopeCache.get(projectId, room.id);
        if (!elements) {
          try {
            const snap = await getDocs(
              collection(db, 'projects', projectId, 'rooms', room.id, 'envelopeElements'),
            );
            elements = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            envelopeCache.set(projectId, room.id, elements);
          } catch {
            elements = [];
          }
        }
        allEnvelopes[room.id] = elements;
      }

      generatePDFReport(
        project,
        [],   // legacy systems (unused when hvacHierarchy provided)
        [],   // legacy zones  (unused when hvacHierarchy provided)
        {},   // legacy rooms  (unused when hvacHierarchy provided)
        allEnvelopes,
        [],   // equipSystems: hvacHierarchy.systems will be used automatically
        {
          systems,
          zonesBySystem: allZonesBySystem,
          rooms: roomsByZone,
        },
      );
    } catch (err) {
      console.error('Report generation error:', err);
      toast.error('Report generation failed');
    } finally {
      setGeneratingReport(false);
    }
  };

  // ── CRUD: Add System ──────────────────────────────────────────────────────
  const handleAddSystem = async () => {
    if (!addSystemName.trim()) { toast.error('System name is required'); return; }
    const id = uuidv4();
    try {
      await setDoc(doc(db, 'projects', projectId, 'hvacSystems', id), {
        id,
        name: addSystemName.trim(),
        type: addSystemType,
        brand: null,
        brandLocked: false,
        diversityFactor: 0.85,
        assignedRoomIds: [],
        iduSelections: {},
        zones: [],
        oduSelection: null,
        unitSelection: null,
        createdAt: serverTimestamp(),
      });
      toast.success('System added');
      setAddSystemOpen(false);
      setAddSystemName('');
      setAddSystemType('VRF');
    } catch (err) {
      console.error(err);
      toast.error('Failed to add system');
    }
  };

  // ── CRUD: Delete System ───────────────────────────────────────────────────
  const handleDeleteSystem = async (system: HvacSystemDoc) => {
    if ((system.assignedRoomIds?.length ?? 0) > 0) {
      toast.error('Remove all rooms before deleting this system');
      return;
    }
    if (!confirm(`Delete system "${system.name}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'projects', projectId, 'hvacSystems', system.id));
      setZones((prev) => { const n = { ...prev }; delete n[system.id]; return n; });
      toast.success('System deleted');
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete system');
    }
  };

  // ── CRUD: Add Zone ────────────────────────────────────────────────────────
  const handleAddZone = async () => {
    if (!addZoneName.trim()) { toast.error('Zone name is required'); return; }
    const id = uuidv4();
    const zoneData: HvacZoneDoc = {
      id,
      systemId: addZoneSystemId,
      name: addZoneName.trim(),
      roomIds: [],
      createdAt: serverTimestamp() as any,
    };
    try {
      await setDoc(
        doc(db, 'projects', projectId, 'hvacSystems', addZoneSystemId, 'zones', id),
        zoneData,
      );
      // Also update the denormalised zones array on the system doc
      await updateDoc(doc(db, 'projects', projectId, 'hvacSystems', addZoneSystemId), {
        zones: arrayUnion({ id, name: addZoneName.trim(), roomIds: [] }),
      });
      setZones((prev) => ({
        ...prev,
        [addZoneSystemId]: [...(prev[addZoneSystemId] ?? []), zoneData],
      }));
      toast.success('Zone added');
      setAddZoneOpen(false);
      setAddZoneName('');
    } catch (err) {
      console.error(err);
      toast.error('Failed to add zone');
    }
  };

  // ── CRUD: Delete Zone ─────────────────────────────────────────────────────
  const handleDeleteZone = async (zone: HvacZoneDoc) => {
    if ((zone.roomIds?.length ?? 0) > 0) {
      toast.error('Remove all rooms from this zone first');
      return;
    }
    if (!confirm(`Delete zone "${zone.name}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(
        doc(db, 'projects', projectId, 'hvacSystems', zone.systemId, 'zones', zone.id),
      );
      // Remove from system zones denormalised array — match the exact stored entry
      const system = systems.find((s) => s.id === zone.systemId);
      const zoneEntry = system?.zones?.find((z) => z.id === zone.id);
      if (zoneEntry) {
        await updateDoc(doc(db, 'projects', projectId, 'hvacSystems', zone.systemId), {
          zones: arrayRemove(zoneEntry),
        });
      }
      setZones((prev) => ({
        ...prev,
        [zone.systemId]: (prev[zone.systemId] ?? []).filter((z) => z.id !== zone.id),
      }));
      toast.success('Zone deleted');
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete zone');
    }
  };

  // ── CRUD: Add Room ────────────────────────────────────────────────────────
  const handleAddRoom = async () => {
    if (!addRoomName.trim()) { toast.error('Room name is required'); return; }
    const roomId = uuidv4();
    const roomData = {
      id: roomId,
      name: addRoomName.trim(),
      floor: addRoomFloor.trim() || 'Ground',
      length: 0,
      width: 0,
      height: 0,
      hasFalseCeiling: false,
      falseCeilingHeight: 0,
      facph: 0,
      peopleCount: 0,
      activityType: 'office',
      lightsWattsPerSqft: 0,
      equipmentKW: 0,
      othersKW: 0,
      sensibleSafetyPercent: 10,
      latentSafetyPercent: 5,
      overallSafetyPercent: 3,
      // Legacy safety factor aliases — old LC/ES still reads these
      sensibleSafetyFactor: 10,
      latentSafetyFactor: 5,
      grandTotalSafetyFactor: 3,
      ductGainPct: 2,
      fanGainPct: 3,
      // New unified hierarchy fields
      hvacSystemId: addRoomSystemId,
      hvacZoneId: addRoomZoneId,
      hvacSystemName: addRoomSystemName,
      hvacZoneName: addRoomZoneName,
      // Legacy backward-compat fields so old LoadCalculator / EquipmentSelection still works
      systemId: addRoomSystemId,
      zoneId: addRoomZoneId,
      zoneName: addRoomZoneName,
      ahuGroupId: addRoomZoneId,
      createdAt: serverTimestamp(),
    };
    try {
      await setDoc(doc(db, 'projects', projectId, 'rooms', roomId), roomData);
      await updateDoc(
        doc(db, 'projects', projectId, 'hvacSystems', addRoomSystemId, 'zones', addRoomZoneId),
        { roomIds: arrayUnion(roomId) },
      );
      await updateDoc(doc(db, 'projects', projectId, 'hvacSystems', addRoomSystemId), {
        assignedRoomIds: arrayUnion(roomId),
      });
      // Optimistically update local zone roomIds
      setZones((prev) => ({
        ...prev,
        [addRoomSystemId]: (prev[addRoomSystemId] ?? []).map((z) =>
          z.id === addRoomZoneId
            ? { ...z, roomIds: [...(z.roomIds ?? []), roomId] }
            : z,
        ),
      }));
      toast.success('Room added');
      setAddRoomOpen(false);
      setAddRoomName('');
      setAddRoomFloor('');
    } catch (err) {
      console.error(err);
      toast.error('Failed to add room');
    }
  };

  // ── CRUD: Delete Room ─────────────────────────────────────────────────────
  const handleDeleteRoom = async (room: RoomDoc) => {
    if (!confirm(`Delete room "${room.name}"? This cannot be undone.`)) return;
    const systemId = room.hvacSystemId ?? '';
    const zoneId = room.hvacZoneId ?? '';
    try {
      // Batch-delete envelope elements subcollection + the room doc itself
      const elemSnap = await getDocs(
        collection(db, 'projects', projectId, 'rooms', room.id, 'envelopeElements'),
      );
      const batch = writeBatch(db);
      elemSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(db, 'projects', projectId, 'rooms', room.id));
      await batch.commit();

      if (systemId && zoneId) {
        await updateDoc(
          doc(db, 'projects', projectId, 'hvacSystems', systemId, 'zones', zoneId),
          { roomIds: arrayRemove(room.id) },
        );
        await updateDoc(doc(db, 'projects', projectId, 'hvacSystems', systemId), {
          assignedRoomIds: arrayRemove(room.id),
        });
      }
      // Update local zone roomIds
      setZones((prev) => ({
        ...prev,
        [systemId]: (prev[systemId] ?? []).map((z) =>
          z.id === zoneId
            ? { ...z, roomIds: (z.roomIds ?? []).filter((id) => id !== room.id) }
            : z,
        ),
      }));
      envelopeCache.invalidate(projectId, room.id);
      toast.success('Room deleted');
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete room');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (!projectId) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white">
        <p className="text-gray-500">No project selected. Open a project from the Dashboard first.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 size={32} className="animate-spin text-blue-600" />
        <span className="ml-3 text-gray-600">Loading HVAC systems...</span>
      </div>
    );
  }

  const canEdit = userRole === 'Super' || userRole === 'Admin' || userRole === 'Editor';

  return (
    <div className="mx-auto max-w-7xl space-y-4">

      {/* ── Summary bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-blue-100 bg-blue-50 px-5 py-3">
        <div className="flex items-center gap-2 text-blue-700">
          <Building2 size={18} />
          <span className="text-sm font-semibold">
            {systems.length} system{systems.length !== 1 ? 's' : ''}
          </span>
        </div>
        <span className="text-gray-300">|</span>
        <span className="text-sm text-gray-600">
          {totalZonesCount} zone{totalZonesCount !== 1 ? 's' : ''}
        </span>
        <span className="text-gray-300">|</span>
        <span className="text-sm text-gray-600">
          {allRooms.length} room{allRooms.length !== 1 ? 's' : ''}
        </span>
        <span className="text-gray-300">|</span>
        <span className="text-sm font-semibold text-gray-700">
          Total: {totalSystemsTR.toFixed(2)} TR &nbsp;|&nbsp; {Math.round(totalSystemsCFM).toLocaleString()} CFM
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1 bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100"
            onClick={() => void handleGenerateReport()}
            disabled={generatingReport || allRooms.length === 0}
          >
            {generatingReport
              ? <Loader2 size={14} className="animate-spin" />
              : <Download size={14} />}
            PDF Report
          </Button>
          {canEdit && (
            <Button size="sm" onClick={() => setAddSystemOpen(true)}>
              <Plus size={14} className="mr-1" />Add System
            </Button>
          )}
        </div>
      </div>

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {systems.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-20">
          <Building2 size={48} className="mb-4 text-gray-300" />
          <p className="mb-2 text-lg font-semibold text-gray-500">No HVAC Systems yet</p>
          <p className="mb-6 text-sm text-gray-400">Add your first system to get started.</p>
          {canEdit && (
            <Button onClick={() => setAddSystemOpen(true)}>
              <Plus size={16} className="mr-2" />Add System
            </Button>
          )}
        </div>
      )}

      {/* ── Systems list ──────────────────────────────────────────────────── */}
      {systems.map((system) => {
        const isExpanded  = expandedSystems.has(system.id);
        const sysZones    = zones[system.id] ?? [];
        const sysLoading  = loadingZones.has(system.id);
        const trTotal     = systemTotalTR(system.id);
        const cfmTotal    = systemTotalCFM(system.id);

        return (
          <div key={system.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">

            {/* System header */}
            <div className="flex items-center gap-3 bg-gradient-to-r from-gray-50 to-white px-4 py-3">
              <button
                onClick={() => void toggleSystem(system.id)}
                className="shrink-0 rounded p-1 transition-colors hover:bg-gray-200"
                aria-label={isExpanded ? 'Collapse system' : 'Expand system'}
              >
                {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </button>

              <span className="min-w-0 flex-1 truncate font-semibold text-gray-900">{system.name}</span>
              <SystemTypeBadge type={system.type} />

              <div className="hidden shrink-0 items-center gap-4 text-sm text-gray-500 sm:flex">
                <span>{sysZones.length} zone{sysZones.length !== 1 ? 's' : ''}</span>
                {trTotal > 0 && (
                  <>
                    <span className="font-semibold text-gray-700">{trTotal.toFixed(2)} TR</span>
                    <span className="text-gray-400">{Math.round(cfmTotal).toLocaleString()} CFM</span>
                  </>
                )}
              </div>

              {canEdit && (
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setAddZoneSystemId(system.id);
                      setAddZoneOpen(true);
                    }}
                  >
                    <Plus size={13} className="mr-1" />Zone
                  </Button>
                  <button
                    onClick={() => void handleDeleteSystem(system)}
                    className="rounded p-1 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    aria-label="Delete system"
                    title="Delete system"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </div>

            {/* System body */}
            {isExpanded && (
              <div className="space-y-3 border-t border-gray-100 px-4 pb-4 pt-3">

                {sysLoading && (
                  <div className="flex items-center gap-2 py-4 text-gray-400">
                    <Loader2 size={16} className="animate-spin" />
                    <span className="text-sm">Loading zones...</span>
                  </div>
                )}

                {!sysLoading && sysZones.length === 0 && (
                  <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">
                    No zones yet. Add a zone to assign rooms.
                  </div>
                )}

                {!sysLoading && sysZones.map((zone) => {
                  const isZoneExpanded = expandedZones.has(zone.id);
                  const rooms = zoneRooms(zone.id);
                  const zTR   = zoneTotalTR(zone.id);
                  const zCFM  = zoneTotalCFM(zone.id);

                  return (
                    <div key={zone.id} className="rounded-lg border border-gray-200 bg-gray-50">

                      {/* Zone header */}
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        <button
                          onClick={() => void toggleZone(zone.id)}
                          className="shrink-0 rounded p-0.5 transition-colors hover:bg-gray-200"
                          aria-label={isZoneExpanded ? 'Collapse zone' : 'Expand zone'}
                        >
                          {isZoneExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>

                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800">
                          {zone.name}
                        </span>

                        <div className="hidden shrink-0 items-center gap-3 text-xs text-gray-500 sm:flex">
                          <span>{rooms.length} room{rooms.length !== 1 ? 's' : ''}</span>
                          {zTR > 0 && (
                            <>
                              <span className="font-semibold text-gray-700">{zTR.toFixed(2)} TR</span>
                              <span className="text-gray-400">{Math.round(zCFM).toLocaleString()} CFM</span>
                            </>
                          )}
                        </div>

                        {canEdit && (
                          <div className="flex shrink-0 items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => {
                                setAddRoomSystemId(system.id);
                                setAddRoomZoneId(zone.id);
                                setAddRoomSystemName(system.name);
                                setAddRoomZoneName(zone.name);
                                setAddRoomOpen(true);
                              }}
                            >
                              <Plus size={12} className="mr-1" />Room
                            </Button>
                            <button
                              onClick={() => void handleDeleteZone(zone)}
                              className="rounded p-1 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600"
                              aria-label="Delete zone"
                              title="Delete zone"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Zone body */}
                      {isZoneExpanded && (
                        <div className="border-t border-gray-200 bg-white px-4 pb-4 pt-2">
                          {rooms.length === 0 ? (
                            <div className="py-6 text-center text-sm text-gray-400">
                              No rooms yet. Add a room to this zone.
                            </div>
                          ) : (
                            <div>
                              {/* Table header */}
                              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 border-b border-gray-100 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                                <span>Room</span>
                                <span>Floor</span>
                                <span>Area ft²</span>
                                <span>TR</span>
                                <span>CFM</span>
                                <span />
                              </div>

                              {/* Room rows */}
                              {rooms.map((room) => {
                                const editKey  = `${zone.id}:${room.id}`;
                                const isEditing = editingRoomKey === editKey;
                                const area      = (room.length ?? 0) * (room.width ?? 0);

                                return (
                                  <div key={room.id}>
                                    <div
                                      className={`grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] items-center gap-2 border-b border-gray-50 py-2 text-sm ${isEditing ? 'rounded-t-md bg-blue-50' : 'hover:bg-gray-50'}`}
                                    >
                                      <span className="truncate font-medium text-gray-800">{room.name}</span>
                                      <span className="text-gray-500">{room.floor}</span>
                                      <span className="text-gray-600">{area > 0 ? area.toFixed(0) : '—'}</span>
                                      <span className="font-semibold text-blue-700">
                                        {room._calcOverallGoverningTR != null
                                          ? room._calcOverallGoverningTR.toFixed(2)
                                          : '—'}
                                      </span>
                                      <span className="text-gray-600">
                                        {room._calcOverallDesignCFM != null
                                          ? Math.round(room._calcOverallDesignCFM).toLocaleString()
                                          : '—'}
                                      </span>
                                      <div className="flex items-center gap-1">
                                        {canEdit && (
                                          <button
                                            onClick={() => setEditingRoomKey(isEditing ? null : editKey)}
                                            className={`rounded p-1 transition-colors ${isEditing ? 'bg-blue-200 text-blue-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
                                            aria-label="Edit room"
                                            title="Edit room"
                                          >
                                            <Edit2 size={13} />
                                          </button>
                                        )}
                                        {canEdit && (
                                          <button
                                            onClick={() => void handleDeleteRoom(room)}
                                            className="rounded p-1 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                            aria-label="Delete room"
                                            title="Delete room"
                                          >
                                            <Trash2 size={13} />
                                          </button>
                                        )}
                                      </div>
                                    </div>

                                    {/* Inline edit panel */}
                                    {isEditing && (
                                      <RoomEditPanel
                                        room={room}
                                        projectId={projectId}
                                        zone={zone}
                                        project={project}
                                        onClose={() => setEditingRoomKey(null)}
                                        onSaved={(updated) => {
                                          // Optimistic update — the rooms onSnapshot will
                                          // also arrive shortly and will be authoritative.
                                          setRoomsByZone((prev) => ({
                                            ...prev,
                                            [zone.id]: (prev[zone.id] ?? []).map((r) =>
                                              r.id === updated.id ? updated : r,
                                            ),
                                          }));
                                        }}
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Add System Dialog ─────────────────────────────────────────────── */}
      <Dialog open={addSystemOpen} onOpenChange={setAddSystemOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add HVAC System</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>System Name</Label>
              <Input
                placeholder="e.g. Chiller Plant"
                value={addSystemName}
                onChange={(e) => setAddSystemName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleAddSystem()}
              />
            </div>
            <div className="space-y-1">
              <Label>System Type</Label>
              <Select value={addSystemType} onValueChange={(v) => setAddSystemType(v as SystemType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VRF">VRF</SelectItem>
                  <SelectItem value="Chiller">Chiller</SelectItem>
                  <SelectItem value="Package">Package</SelectItem>
                  <SelectItem value="DuctableSplit">Ductable Split</SelectItem>
                  <SelectItem value="Split">Split</SelectItem>
                  <SelectItem value="AHU">AHU</SelectItem>
                  <SelectItem value="DOAS">DOAS</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddSystemOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleAddSystem()}>Add System</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Zone Dialog ───────────────────────────────────────────────── */}
      <Dialog open={addZoneOpen} onOpenChange={setAddZoneOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Zone</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Zone Name</Label>
              <Input
                placeholder="e.g. AHU Zone 1"
                value={addZoneName}
                onChange={(e) => setAddZoneName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleAddZone()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddZoneOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleAddZone()}>Add Zone</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Room Dialog ───────────────────────────────────────────────── */}
      <Dialog open={addRoomOpen} onOpenChange={setAddRoomOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Room</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Room Name</Label>
              <Input
                placeholder="e.g. Conference Room 1"
                value={addRoomName}
                onChange={(e) => setAddRoomName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Floor</Label>
              <Input
                placeholder="e.g. Ground, 1st, Basement"
                value={addRoomFloor}
                onChange={(e) => setAddRoomFloor(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleAddRoom()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddRoomOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleAddRoom()}>Add Room</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
