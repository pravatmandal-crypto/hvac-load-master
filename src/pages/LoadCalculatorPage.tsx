import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { User } from 'firebase/auth';
import { db } from '../lib/firebase';
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, orderBy, query, where, serverTimestamp,
} from 'firebase/firestore';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Separator } from '../components/ui/separator';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import {
  Plus, Search, Pencil, Trash2, ChevronRight,
  MapPin, Thermometer, Droplets, ArrowLeft, Loader2, FileText,
  UserPlus, Users, Check,
} from 'lucide-react';
import LoadCalculator, { type LoadCalculatorHandle } from '../components/hvac/LoadCalculator';
import { resolveDesignMode, type DesignMode } from '../lib/hvac/supplyCfm';
import { fetchLocationData } from '../services/geminiService';

// ─── Psychrometric helpers ────────────────────────────────────────────────────

function satPressurePsia(TF: number): number {
  const TC = (TF - 32) / 1.8;
  const logP = 8.10765 - 1750.286 / (235.0 + TC);
  return Math.pow(10, logP) / 51.715;
}

function calcHumidityRatio(TF: number, RH: number): number {
  const Pws = satPressurePsia(TF);
  const Pw = (RH / 100) * Pws;
  return parseFloat((0.622 * Pw / (14.696 - Pw)).toFixed(5));
}

function calcEnthalpy(TF: number, W: number): number {
  return parseFloat((0.240 * TF + W * (1061 + 0.444 * TF)).toFixed(2));
}

function psychro(TF: number, RH: number) {
  const W = calcHumidityRatio(TF, RH);
  return { humidityRatio: W, enthalpy: calcEnthalpy(TF, W) };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  location: string;
  userId?: string;
  /** Team members (uids) this project is SHARED with — owner keeps access; assignees also see/edit it. */
  assignedUserIds?: string[];
  longitude?: number;
  latitude?: number;
  altitude?: number;
  systemType: string;
  /** Unified project Design Mode (single selector). Derives adpBasis + default supplyBasis. */
  designMode?: DesignMode;
  /** Derived from designMode (denormalized for getMinAdp): 'comfort' (54°F) vs 'dehumidification' (44/42°F). */
  adpBasis?: 'comfort' | 'dehumidification';
  /** Derived from designMode (denormalized): the default room supply-air basis. */
  supplyBasis?: 'dscfm' | 'ach';
  /** Stable report identity — auto-assigned once, carried on every report to flag duplicates. */
  reportId?: string;
  /** Report revision integer (0,1,2…); printed as R0/R1/… */
  reportRev?: number;
  /** Engineer-controlled report date as 'YYYY-MM-DD'; falls back to today when unset. */
  reportDate?: string;
  /** Free-text client rules / agreed deviations, printed in the report executive summary. */
  specialConditions?: string;
  includeMonsoon: boolean;
  includeWinter: boolean;
  // Outside
  summerDesignTemp: number;
  summerDesignHumidity: number;
  monsoonDesignTemp?: number;
  monsoonDesignHumidity?: number;
  winterDesignTemp: number;
  winterDesignHumidity: number;
  // Inside
  insideSummerTemp: number;
  insideSummerHumidity: number;
  insideMonsoonTemp?: number;
  insideMonsoonHumidity?: number;
  insideWinterTemp: number;
  insideWinterHumidity: number;
  // Calculated
  summerEnthalpy?: number;
  summerHumidityRatio?: number;
  monsoonEnthalpy?: number;
  monsoonHumidityRatio?: number;
  winterEnthalpy?: number;
  winterHumidityRatio?: number;
  insideSummerEnthalpy?: number;
  insideSummerHumidityRatio?: number;
  insideMonsoonEnthalpy?: number;
  insideMonsoonHumidityRatio?: number;
  createdAt: Date;
  updatedAt: Date;
  data?: any;
}

const EMPTY_FORM = {
  name: '',
  location: '',
  latitude: '',
  longitude: '',
  altitude: '',
  designMode: 'comfort' as DesignMode,
  // Report identity — stable ID auto-assigned on first save; date + revision engineer-controlled.
  reportId: '',
  reportDate: '',     // 'YYYY-MM-DD'; blank = today on save
  reportRev: '0',
  includeMonsoon: false,
  includeWinter: false,
  // Outside
  summerTemp: '',
  summerRH: '',
  monsoonTemp: '',
  monsoonRH: '',
  winterTemp: '',
  winterRH: '',
  // Inside
  insideSummerTemp: '',
  insideSummerRH: '',
  insideMonsoonTemp: '',
  insideMonsoonRH: '',
  insideWinterTemp: '',
  insideWinterRH: '',
};

type FormState = typeof EMPTY_FORM;

// Local date as 'YYYY-MM-DD' (no UTC shift — matches the <input type="date"> value).
function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// Stable per-project report number: HLM-<up to 3 name letters>-<4-char base36>.
// Generated once on first save and reused forever so a re-issue keeps the same No.
function genReportId(name: string): string {
  const letters = (name.match(/[A-Za-z]/g) || []).slice(0, 3).join('').toUpperCase().padEnd(3, 'X');
  const suffix = (Math.random().toString(36) + '0000').slice(2, 6).toUpperCase();
  return `HLM-${letters}-${suffix}`;
}

// ─── Geocoding ────────────────────────────────────────────────────────────────

async function geocodeAddress(address: string): Promise<{ lat: number; lon: number; display: string } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    if (data.length > 0) {
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), display: data[0].display_name };
    }
  } catch (e) {
    console.error('Geocode error', e);
  }
  return null;
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  currentUser: User;
  initialProjectId?: string;
  userRole?: string | null;
  pendingPageChange?: string | null;
  onPageChangeResolved?: (page: string | null) => void;
  onProjectChange?: (project: any) => void;
}

// Map a Firestore project doc → Project view model. Shared by the owner query and the
// "shared with me" (assignedUserIds) query so both produce identical shapes.
function mapProjectDoc(d: any): Project {
  const p: any = d.data();
  const data = p.data || {};
  return {
    // Carry the raw document through FIRST, so a field nobody thought to list still
    // round-trips. This used to be a pure allow-list: anything absent was silently dropped
    // between Firestore and the app, and since the write itself succeeded it read as "it
    // isn't saving" with nothing to debug. `specialConditions` was lost that way.
    //
    // Every explicit mapping below still overrides it, so defaults, the `data.*` reads and
    // the Timestamp → Date conversions all keep winning. This only ADDS what would
    // otherwise have been discarded — it changes no existing field.
    ...p,
    id: d.id,
    name: p.name || '',
    location: p.location || '',
    userId: p.userId,
    assignedUserIds: Array.isArray(p.assignedUserIds) ? p.assignedUserIds : [],
    longitude: data.longitude,
    latitude: data.latitude,
    altitude: data.altitude,
    systemType: p.systemType || 'CAC',
    designMode: p.designMode ?? data.designMode,
    adpBasis: p.adpBasis ?? data.adpBasis,
    supplyBasis: p.supplyBasis ?? data.supplyBasis,
    reportId: p.reportId ?? data.reportId,
    reportRev: p.reportRev ?? data.reportRev,
    reportDate: p.reportDate ?? data.reportDate,
    // mapProjectDoc is an explicit allow-list — a field missing here is silently dropped
    // between Firestore and the app, which reads to the user as "it did not save" even
    // though the write succeeded. Add new project fields HERE as well as to the writer.
    specialConditions: p.specialConditions ?? data.specialConditions,
    includeMonsoon: p.includeMonsoon ?? false,
    includeWinter: p.includeWinter ?? true,
    summerDesignTemp: data.summerDesignTemp ?? 95,
    summerDesignHumidity: data.summerDesignHumidity ?? 50,
    monsoonDesignTemp: data.monsoonDesignTemp ?? 85,
    monsoonDesignHumidity: data.monsoonDesignHumidity ?? 85,
    winterDesignTemp: data.winterDesignTemp ?? 40,
    winterDesignHumidity: data.winterDesignHumidity ?? 30,
    insideSummerTemp: data.insideSummerTemp ?? 75,
    insideSummerHumidity: data.insideSummerHumidity ?? 50,
    insideMonsoonTemp: data.insideMonsoonTemp ?? data.insideSummerTemp ?? 75,
    insideMonsoonHumidity: data.insideMonsoonHumidity ?? 55,
    insideWinterTemp: data.insideWinterTemp ?? 70,
    insideWinterHumidity: data.insideWinterHumidity ?? 30,
    summerEnthalpy: data.summerEnthalpy,
    summerHumidityRatio: data.summerHumidityRatio,
    monsoonEnthalpy: data.monsoonEnthalpy,
    monsoonHumidityRatio: data.monsoonHumidityRatio,
    winterEnthalpy: data.winterEnthalpy,
    winterHumidityRatio: data.winterHumidityRatio,
    insideSummerEnthalpy: data.insideSummerEnthalpy,
    insideSummerHumidityRatio: data.insideSummerHumidityRatio,
    insideMonsoonEnthalpy: data.insideMonsoonEnthalpy,
    insideMonsoonHumidityRatio: data.insideMonsoonHumidityRatio,
    createdAt: p.createdAt?.toDate?.() ?? new Date(),
    updatedAt: p.updatedAt?.toDate?.() ?? new Date(),
    zonesLastSyncedAt: p.zonesLastSyncedAt ?? null,
    data,
  } as Project;
}

export default function LoadCalculatorPage({ currentUser, initialProjectId, userRole = null, pendingPageChange, onPageChangeResolved, onProjectChange }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [ownerEmails, setOwnerEmails] = useState<Record<string, string>>({});
  const [initialHandled, setInitialHandled] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [systemFilter, setSystemFilter] = useState<'all' | string>('all');
  const [reloadKey, setReloadKey] = useState(0);
  // Assign / share (Super only): Design-Team members a project can be shared with, and the
  // open assign-dialog state.
  const [teamMembers, setTeamMembers] = useState<{ uid: string; email: string; role: string }[]>([]);
  const [assignTarget, setAssignTarget] = useState<Project | null>(null);
  const [assignSel, setAssignSel] = useState<string[]>([]);
  const [assignSaving, setAssignSaving] = useState(false);

  // Stable reference — prevents the data-loading effect in LoadCalculator
  // from re-triggering when LoadCalculatorPage re-renders.
  const userProfile = useMemo(
    () => ({ uid: currentUser.uid, email: currentUser.email }),
    [currentUser.uid, currentUser.email],
  );

  // Increment reloadKey when Equipment Selection pushes zone assignments so that
  // LoadCalculator re-fetches rooms even if it's already mounted (e.g. separate browser tab).
  useEffect(() => {
    const syncedAt = (activeProject as any)?.zonesLastSyncedAt?.seconds;
    if (syncedAt) setReloadKey(k => k + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(activeProject as any)?.zonesLastSyncedAt?.seconds]);

  // ── Unsaved-changes navigation guard ─────────────────────────────────────
  const calculatorRef = useRef<LoadCalculatorHandle>(null);
  // Ref instead of state — dirty-flag changes must not re-render LoadCalculatorPage
  // (which would cascade into a LoadCalculator re-render on every keystroke).
  const calculatorHasUnsavedRef = useRef(false);
  const handleCalculatorUnsaved = useCallback((has: boolean) => {
    calculatorHasUnsavedRef.current = has;
  }, []);
  const [pendingNavAction, setPendingNavAction] = useState<(() => void) | null>(null);
  const [isSavingAll, setIsSavingAll] = useState(false);

  const guardedNavigate = (action: () => void) => {
    if (calculatorHasUnsavedRef.current) {
      setPendingNavAction(() => action);
    } else {
      action();
    }
  };

  // Intercept sidebar page-change requests from App.tsx
  useEffect(() => {
    if (!pendingPageChange) return;
    const action = () => onPageChangeResolved?.(pendingPageChange);
    if (calculatorHasUnsavedRef.current) {
      setPendingNavAction(() => action);
    } else {
      action();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPageChange]);

  // ── Load projects from Firestore ──────────────────────────────────────────
  useEffect(() => {
    const uid = currentUser.uid;
    const onErr = (err: any) => { console.error('[LoadCalculatorPage]', err); toast.error('Failed to load projects'); };
    const sortByUpdated = (list: Project[]) =>
      [...list].sort((a, b) => (b.updatedAt?.getTime?.() ?? 0) - (a.updatedAt?.getTime?.() ?? 0));

    // Super sees every project.
    if (userRole === 'Super') {
      const unsub = onSnapshot(
        query(collection(db, 'projects'), orderBy('updatedAt', 'desc')),
        (snap) => setProjects(snap.docs.map(mapProjectDoc)),
        onErr,
      );
      return () => unsub();
    }

    // Everyone else sees their OWN projects + any SHARED with them (assignedUserIds contains
    // their uid). Two listeners merged & de-duped; sorted in memory so the shared query needs
    // no array-contains+updatedAt composite index.
    let own: Project[] = [], shared: Project[] = [];
    const merge = () => {
      const byId = new Map<string, Project>();
      [...own, ...shared].forEach((p) => byId.set(p.id, p));
      setProjects(sortByUpdated([...byId.values()]));
    };
    const unsubOwn = onSnapshot(
      query(collection(db, 'projects'), where('userId', '==', uid), orderBy('updatedAt', 'desc')),
      (snap) => { own = snap.docs.map(mapProjectDoc); merge(); },
      onErr,
    );
    const unsubShared = onSnapshot(
      query(collection(db, 'projects'), where('assignedUserIds', 'array-contains', uid)),
      (snap) => { shared = snap.docs.map(mapProjectDoc); merge(); },
      onErr,
    );
    return () => { unsubOwn(); unsubShared(); };
  }, [currentUser.uid, userRole]);

  useEffect(() => {
    if (userRole !== 'Super') {
      setOwnerEmails({});
      return;
    }

    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      const next: Record<string, string> = {};
      const members: { uid: string; email: string; role: string }[] = [];
      snap.docs.forEach((d) => {
        const data: any = d.data();
        if (data?.email) next[d.id] = data.email;
        // Assignable = a real login user (uid-keyed doc, not an email invite) on the Design Team —
        // the rules already let Design Team edit any project, so sharing just makes it visible.
        if (data?.email && !d.id.includes('@') && data.role === 'Design Team') {
          members.push({ uid: d.id, email: data.email, role: data.role });
        }
      });
      setOwnerEmails(next);
      setTeamMembers(members.sort((a, b) => a.email.localeCompare(b.email)));
    });

    return () => unsub();
  }, [userRole]);

  // ── Assign / share a project with team members (Super only) ───────────────
  const openAssign = (project: Project) => {
    setAssignTarget(project);
    setAssignSel(project.assignedUserIds ?? []);
  };
  const toggleAssignee = (uid: string) =>
    setAssignSel((prev) => (prev.includes(uid) ? prev.filter((u) => u !== uid) : [...prev, uid]));
  const saveAssignment = async () => {
    if (!assignTarget) return;
    setAssignSaving(true);
    try {
      await updateDoc(doc(db, 'projects', assignTarget.id), { assignedUserIds: assignSel });
      toast.success(assignSel.length
        ? `Shared with ${assignSel.length} team member${assignSel.length === 1 ? '' : 's'}`
        : 'Sharing removed');
      setAssignTarget(null);
    } catch (e) {
      console.error('[assign]', e);
      toast.error('Failed to update sharing');
    } finally {
      setAssignSaving(false);
    }
  };

  // ── Sync activeProject when projects list updates ─────────────────────────
  useEffect(() => {
    setActiveProject(prev => {
      if (!prev) return prev;
      const updated = projects.find((p) => p.id === prev.id);
      return updated ?? prev;
    });
  }, [projects]);

  // ── Auto-open project from initialProjectId ───────────────────────────────
  useEffect(() => {
    if (initialProjectId && !initialHandled && projects.length > 0) {
      const found = projects.find((p) => p.id === initialProjectId);
      if (found) {
        setActiveProject(found);
        onProjectChange?.(found);
        setInitialHandled(true);
      }
    }
  }, [initialProjectId, initialHandled, projects]);

  // ── Dialog helpers ────────────────────────────────────────────────────────
  const openCreateDialog = () => {
    setEditingProject(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEditDialog = (project: Project) => {
    setEditingProject(project);
    const p = project as any;
    setForm({
      name: project.name ?? '',
      location: project.location ?? p.place ?? '',
      latitude: project.latitude != null ? String(project.latitude) : '',
      longitude: project.longitude != null ? String(project.longitude) : '',
      altitude: project.altitude != null ? String(project.altitude) : '',
      designMode: (project.designMode ?? 'comfort') as DesignMode,
      reportId: project.reportId ?? '',
      reportDate: project.reportDate ?? todayISO(),
      reportRev: String(project.reportRev ?? 0),
      includeMonsoon: project.includeMonsoon ?? false,
      includeWinter: project.includeWinter ?? false,
      summerTemp: String(project.summerDesignTemp ?? p.summerDesignTemp ?? 95),
      summerRH: String(project.summerDesignHumidity ?? p.summerDesignHumidity ?? 50),
      monsoonTemp: String(project.monsoonDesignTemp ?? 85),
      monsoonRH: String(project.monsoonDesignHumidity ?? 85),
      winterTemp: String(project.winterDesignTemp ?? p.winterDesignTemp ?? 40),
      winterRH: String(project.winterDesignHumidity ?? p.winterDesignHumidity ?? 30),
      insideSummerTemp: String(project.insideSummerTemp ?? p.summerIndoorTemp ?? p.insideSummerTemp ?? 75),
      insideSummerRH: String(project.insideSummerHumidity ?? p.summerIndoorHumidity ?? p.insideSummerHumidity ?? 50),
      insideMonsoonTemp: String(project.insideMonsoonTemp ?? project.insideSummerTemp ?? 75),
      insideMonsoonRH: String(project.insideMonsoonHumidity ?? 55),
      insideWinterTemp: String(project.insideWinterTemp ?? p.winterIndoorTemp ?? p.insideWinterTemp ?? 70),
      insideWinterRH: String(project.insideWinterHumidity ?? p.winterIndoorHumidity ?? p.insideWinterHumidity ?? 30),
    });
    setDialogOpen(true);
  };

  const f = (key: keyof FormState, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // ── Geocode ───────────────────────────────────────────────────────────────
  const handleGeocode = async () => {
    const location = form.location.trim();
    if (!location) { toast.error('Enter an address first'); return; }
    const normalizeLocation = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').replace(/,+/g, ',').trim();
    const locationKey = normalizeLocation(location);

    const savedProjectMatch = projects
      .filter((p) => !editingProject || p.id !== editingProject.id)
      .find((p) => {
        const projectLocation = normalizeLocation(p.location || '');
        return projectLocation === locationKey || projectLocation.includes(locationKey) || locationKey.includes(projectLocation);
      });

    setGeocoding(true);
    try {
      // Try Gemini first — returns lat/lon + altitude + design conditions
      const locationData = await fetchLocationData(location);
      if (locationData) {
        setForm((prev) => ({
          ...prev,
          location,
          latitude: String(locationData.latitude),
          longitude: String(locationData.longitude),
          altitude: String(locationData.altitude),
          summerTemp: String(locationData.summerDesignTemp),
          summerRH: String(locationData.summerDesignHumidity),
          monsoonTemp: String(locationData.monsoonDesignTemp ?? (prev.monsoonTemp || '85')),
          monsoonRH: String(locationData.monsoonDesignHumidity ?? (prev.monsoonRH || '85')),
          winterTemp: String(locationData.winterDesignTemp ?? (prev.winterTemp || '40')),
          winterRH: String(locationData.winterDesignHumidity ?? (prev.winterRH || '30')),
          includeMonsoon: locationData.monsoonDesignTemp != null || locationData.monsoonDesignHumidity != null
            ? true
            : prev.includeMonsoon,
          includeWinter: locationData.winterDesignTemp != null || locationData.winterDesignHumidity != null
            ? true
            : prev.includeWinter,
          insideMonsoonTemp: prev.insideMonsoonTemp || prev.insideSummerTemp || '75',
          insideMonsoonRH: prev.insideMonsoonRH || '55',
          insideWinterTemp: prev.insideWinterTemp || '70',
          insideWinterRH: prev.insideWinterRH || '30',
        }));
        toast.success('Location and design conditions auto-filled');
        setGeocoding(false);
        return;
      }
    } catch {
      // Gemini unavailable — fall back to Nominatim for coordinates only
    }

    if (savedProjectMatch) {
      setForm((prev) => ({
        ...prev,
        location: savedProjectMatch.location || location,
        latitude: savedProjectMatch.latitude != null ? String(savedProjectMatch.latitude) : prev.latitude,
        longitude: savedProjectMatch.longitude != null ? String(savedProjectMatch.longitude) : prev.longitude,
        altitude: savedProjectMatch.altitude != null ? String(savedProjectMatch.altitude) : prev.altitude,
        includeMonsoon: savedProjectMatch.includeMonsoon ?? prev.includeMonsoon,
        includeWinter: savedProjectMatch.includeWinter ?? prev.includeWinter,
        summerTemp: String(savedProjectMatch.summerDesignTemp ?? prev.summerTemp),
        summerRH: String(savedProjectMatch.summerDesignHumidity ?? prev.summerRH),
        monsoonTemp: String(savedProjectMatch.monsoonDesignTemp ?? prev.monsoonTemp),
        monsoonRH: String(savedProjectMatch.monsoonDesignHumidity ?? prev.monsoonRH),
        winterTemp: String(savedProjectMatch.winterDesignTemp ?? prev.winterTemp),
        winterRH: String(savedProjectMatch.winterDesignHumidity ?? prev.winterRH),
        insideSummerTemp: String(savedProjectMatch.insideSummerTemp ?? prev.insideSummerTemp),
        insideSummerRH: String(savedProjectMatch.insideSummerHumidity ?? prev.insideSummerRH),
        insideMonsoonTemp: String(savedProjectMatch.insideMonsoonTemp ?? prev.insideMonsoonTemp),
        insideMonsoonRH: String(savedProjectMatch.insideMonsoonHumidity ?? prev.insideMonsoonRH),
        insideWinterTemp: String(savedProjectMatch.insideWinterTemp ?? prev.insideWinterTemp),
        insideWinterRH: String(savedProjectMatch.insideWinterHumidity ?? prev.insideWinterRH),
      }));
      toast.success(`Loaded design conditions from saved project: ${savedProjectMatch.name}`);
      setGeocoding(false);
      return;
    }

    const result = await geocodeAddress(location);
    if (result) {
      setForm((prev) => ({
        ...prev,
        location: result.display || location,
        latitude: String(result.lat),
        longitude: String(result.lon),
      }));
      toast.success('Coordinates found — enter design conditions manually');
    } else {
      toast.error('Address not found — check spelling or enter manually');
    }
    setGeocoding(false);
  };

  // ── Save project ──────────────────────────────────────────────────────────
  const saveProject = async () => {
    if (!form.name.trim()) { toast.error('Project name is required'); return; }

    const sumT = parseFloat(form.summerTemp) || 95;
    const sumRH = parseFloat(form.summerRH) || 50;
    const monT = parseFloat(form.monsoonTemp) || 85;
    const monRH = parseFloat(form.monsoonRH) || 85;
    const winT = parseFloat(form.winterTemp) || 40;
    const winRH = parseFloat(form.winterRH) || 30;
    const inSumT = parseFloat(form.insideSummerTemp) || 75;
    const inSumRH = parseFloat(form.insideSummerRH) || 50;
    const inMonT = parseFloat(form.insideMonsoonTemp) || inSumT;
    const inMonRH = parseFloat(form.insideMonsoonRH) || 55;
    const inWinT = parseFloat(form.insideWinterTemp) || 70;
    const inWinRH = parseFloat(form.insideWinterRH) || 30;

    const outsideSummer = psychro(sumT, sumRH);
    const outsideMonsoon = psychro(monT, monRH);
    const outsideWinter = form.includeWinter ? psychro(winT, winRH) : null;
    const insideSummer = psychro(inSumT, inSumRH);
    const insideMonsoon = psychro(inMonT, inMonRH);

    const data: Record<string, any> = {
      longitude: form.longitude !== '' ? parseFloat(form.longitude) : undefined,
      latitude: form.latitude !== '' ? parseFloat(form.latitude) : undefined,
      altitude: form.altitude !== '' ? parseFloat(form.altitude) : 0,
      summerDesignTemp: sumT,
      summerDesignHumidity: sumRH,
      ...(form.includeMonsoon && {
        monsoonDesignTemp: monT,
        monsoonDesignHumidity: monRH,
        insideMonsoonTemp: inMonT,
        insideMonsoonHumidity: inMonRH,
        monsoonEnthalpy: outsideMonsoon.enthalpy,
        monsoonHumidityRatio: outsideMonsoon.humidityRatio,
        insideMonsoonEnthalpy: insideMonsoon.enthalpy,
        insideMonsoonHumidityRatio: insideMonsoon.humidityRatio,
      }),
      ...(form.includeWinter && outsideWinter && {
        winterDesignTemp: winT,
        winterDesignHumidity: winRH,
        insideWinterTemp: inWinT,
        insideWinterHumidity: inWinRH,
        winterEnthalpy: outsideWinter.enthalpy,
        winterHumidityRatio: outsideWinter.humidityRatio,
      }),
      insideSummerTemp: inSumT,
      insideSummerHumidity: inSumRH,
      summerEnthalpy: outsideSummer.enthalpy,
      summerHumidityRatio: outsideSummer.humidityRatio,
      insideSummerEnthalpy: insideSummer.enthalpy,
      insideSummerHumidityRatio: insideSummer.humidityRatio,
    };

    const payload = {
      name: form.name.trim(),
      location: (form.location ?? '').trim(),
      systemType: editingProject?.systemType || 'CAC',
      designMode: form.designMode,
      adpBasis: resolveDesignMode(form.designMode).adpBasis ?? 'comfort',
      supplyBasis: resolveDesignMode(form.designMode).supplyBasis,
      // Report identity: keep the existing No. (stable), else mint one now.
      reportId: editingProject?.reportId || form.reportId || genReportId(form.name),
      reportDate: form.reportDate || todayISO(),
      reportRev: parseInt(form.reportRev, 10) || 0,
      includeMonsoon: form.includeMonsoon,
      includeWinter: form.includeWinter,
      userId: editingProject ? (editingProject.userId ?? currentUser.uid) : currentUser.uid,
      data,
    };

    try {
      setSaving(true);
      if (editingProject) {
        await updateDoc(doc(db, 'projects', editingProject.id), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
        toast.success('Project updated');
      } else {
        await addDoc(collection(db, 'projects'), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        toast.success('Project created');
      }
      setDialogOpen(false);
    } catch (err: any) {
      const code = err?.code as string | undefined;
      if (code === 'permission-denied') {
        toast.error('Missing access profile for this account. Ask admin to whitelist your UID and try again.');
      } else {
        toast.error(err.message || 'Failed to save project');
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const deleteProject = async (id: string) => {
    if (!confirm('Delete this project? This cannot be undone.')) return;
    try {
      await deleteDoc(doc(db, 'projects', id));
      if (activeProject?.id === id) setActiveProject(null);
      toast.success('Project deleted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete project');
    }
  };

  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      const normalizedSearch = searchText.trim().toLowerCase();
      const matchesSearch =
        normalizedSearch.length === 0 ||
        project.name.toLowerCase().includes(normalizedSearch) ||
        project.location.toLowerCase().includes(normalizedSearch);
      const matchesSystem = systemFilter === 'all' || project.systemType === systemFilter;
      return matchesSearch && matchesSystem;
    });
  }, [projects, searchText, systemFilter]);

  const projectStats = useMemo(() => {
    const total = projects.length;
    const bySystem = projects.reduce((acc, p) => {
      acc[p.systemType] = (acc[p.systemType] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const dominantSystem = Object.entries(bySystem).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'N/A';
    const averageSummerTemp =
      total > 0
        ? (projects.reduce((sum, p) => sum + (p.summerDesignTemp || 95), 0) / total).toFixed(1)
        : '0.0';
    return {
      total,
      dominantSystem,
      averageSummerTemp,
    };
  }, [projects]);

  // ── Calculator view ───────────────────────────────────────────────────────
  if (activeProject) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => guardedNavigate(() => setActiveProject(null))}
            className="gap-1"
          >
            <ArrowLeft className="h-4 w-4" />
            Projects
          </Button>
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <span>Load Calculator</span>
            <ChevronRight className="h-4 w-4" />
            <span className="font-semibold text-slate-900 dark:text-slate-100">{activeProject.name}</span>
          </div>
          {userRole === 'Super' && activeProject.userId && (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-300">
              Owned by: {ownerEmails[activeProject.userId] || activeProject.userId}
            </Badge>
          )}
          <Badge variant="outline" className="ml-auto">{activeProject.systemType}</Badge>
        </div>

        <LoadCalculator
          ref={calculatorRef}
          project={activeProject}
          userProfile={userProfile}
          onUnsavedChangesChange={handleCalculatorUnsaved}
          reloadKey={reloadKey}
        />

        {/* Edit dialog accessible from calculator view */}
        <ProjectDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          form={form}
          setField={f}
          onSave={saveProject}
          onGeocode={handleGeocode}
          saving={saving}
          geocoding={geocoding}
          editing={!!editingProject}
        />

        {/* Unsaved changes guard dialog */}
        {pendingNavAction && (
          <UnsavedChangesDialog
            isSaving={isSavingAll}
            onSaveAndLeave={async () => {
              setIsSavingAll(true);
              try {
                await calculatorRef.current?.saveAllDirty();
                calculatorHasUnsavedRef.current = false;
                const action = pendingNavAction;
                setPendingNavAction(null);
                action();
              } catch {
                toast.error('Failed to save changes. Please try again.');
              } finally {
                setIsSavingAll(false);
              }
            }}
            onDiscardAndLeave={() => {
              const action = pendingNavAction;
              setPendingNavAction(null);
              action();
            }}
            onStay={() => {
              onPageChangeResolved?.(null);
              setPendingNavAction(null);
            }}
          />
        )}
      </div>
    );
  }

  // ── Project list view ─────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Load Calculator</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">Select a project or create a new one to begin</p>
        </div>
        <Button onClick={openCreateDialog} className="gap-2 bg-teal-600 hover:bg-teal-700 text-white">
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="border-teal-100 bg-teal-50 dark:border-teal-900 dark:bg-teal-950/20">
          <CardContent className="pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-600 dark:text-teal-400">Total Projects</p>
            <p className="mt-1 text-2xl font-bold text-teal-900 dark:text-teal-200">{projectStats.total}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
          <CardContent className="pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Primary System</p>
            <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{projectStats.dominantSystem}</p>
          </CardContent>
        </Card>
        <Card className="border-orange-100 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/20">
          <CardContent className="pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-orange-600 dark:text-orange-400">Avg Summer Temp</p>
            <p className="mt-1 text-2xl font-bold text-orange-900 dark:text-orange-200">{projectStats.averageSummerTemp}°F</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search by project name or location"
                className="pl-9"
              />
            </div>
            <Select value={systemFilter} onValueChange={(v) => setSystemFilter(v || 'all')}>
              <SelectTrigger>
                <SelectValue placeholder="Filter system" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Systems</SelectItem>
                {Array.from(new Set(projects.map((p) => p.systemType))).sort().map((system) => (
                  <SelectItem key={system} value={system}>{system}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Showing {filteredProjects.length} of {projects.length} projects
          </p>
        </CardContent>
      </Card>

      {/* Project grid */}
      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 py-24 text-center dark:bg-slate-900/50">
          <Thermometer className="mx-auto mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
          <h3 className="font-semibold text-slate-700 dark:text-slate-300">No projects yet</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Create your first project to start a load calculation</p>
          <Button onClick={openCreateDialog} className="mt-4 gap-2 bg-teal-600 hover:bg-teal-700 text-white">
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 dark:border-slate-700 dark:bg-slate-900 py-16 text-center">
          <p className="text-sm font-semibold text-gray-700 dark:text-slate-300">No matching projects</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Try a different search term or clear system filter.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              ownerLabel={userRole === 'Super' && project.userId ? (ownerEmails[project.userId] || project.userId) : undefined}
              canAssign={userRole === 'Super'}
              onAssign={() => openAssign(project)}
              sharedWithMe={userRole !== 'Super' && !!project.userId && project.userId !== currentUser.uid}
              onOpen={() => guardedNavigate(() => { setActiveProject(project); onProjectChange?.(project); })}
              onEdit={() => openEditDialog(project)}
              onDelete={() => deleteProject(project.id)}
            />
          ))}
        </div>
      )}

      <ProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        form={form}
        setField={f}
        onSave={saveProject}
        onGeocode={handleGeocode}
        saving={saving}
        geocoding={geocoding}
        editing={!!editingProject}
      />

      {/* Assign / share dialog (Super only) */}
      <Dialog open={!!assignTarget} onOpenChange={(o) => { if (!o) setAssignTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-teal-600" /> Share “{assignTarget?.name}”
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Pick the Design-Team members who should see and work on this project. You (the owner) keep full access.
          </p>
          <div className="max-h-72 space-y-1 overflow-y-auto py-1">
            {teamMembers.filter((m) => m.uid !== assignTarget?.userId).length === 0 ? (
              <p className="px-1 py-6 text-center text-sm text-slate-400">No other Design-Team members found.</p>
            ) : (
              teamMembers
                .filter((m) => m.uid !== assignTarget?.userId)
                .map((m) => {
                  const on = assignSel.includes(m.uid);
                  return (
                    <button
                      key={m.uid}
                      type="button"
                      onClick={() => toggleAssignee(m.uid)}
                      className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                        on
                          ? 'border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-700 dark:bg-teal-950/30 dark:text-teal-200'
                          : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="truncate">{m.email}</span>
                      {on && <Check className="h-4 w-4 shrink-0 text-teal-600" />}
                    </button>
                  );
                })
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignTarget(null)} disabled={assignSaving}>Cancel</Button>
            <Button onClick={saveAssignment} disabled={assignSaving} className="gap-1 bg-teal-600 hover:bg-teal-700 text-white">
              {assignSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Save sharing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Project Card ─────────────────────────────────────────────────────────────

function ProjectCard({
  project, ownerLabel, canAssign, sharedWithMe, onAssign, onOpen, onEdit, onDelete,
}: {
  project: Project;
  ownerLabel?: string;
  canAssign?: boolean;
  sharedWithMe?: boolean;
  onAssign?: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const assignedCount = project.assignedUserIds?.length ?? 0;
  return (
    <Card className="group transition-all hover:shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{project.name}</CardTitle>
            {project.location && (
              <p className="mt-1 flex items-center gap-1 truncate text-xs text-slate-500 dark:text-slate-400">
                <MapPin className="h-3 w-3 shrink-0" />
                {project.location}
              </p>
            )}
          </div>
          <Badge variant="outline" className="shrink-0 text-xs">{project.systemType}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Conditions grid */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <ConditionBox
            label="Summer Outside"
            color="red"
            temp={project.summerDesignTemp}
            rh={project.summerDesignHumidity}
            enthalpy={project.summerEnthalpy}
            hr={project.summerHumidityRatio}
          />
          <ConditionBox
            label="Summer Inside"
            color="blue"
            temp={project.insideSummerTemp}
            rh={project.insideSummerHumidity}
            enthalpy={project.insideSummerEnthalpy}
            hr={project.insideSummerHumidityRatio}
          />
          {project.includeMonsoon && (
          <>
          <ConditionBox
            label="Monsoon Outside"
            color="teal"
            temp={project.monsoonDesignTemp ?? 85}
            rh={project.monsoonDesignHumidity ?? 85}
            enthalpy={project.monsoonEnthalpy}
            hr={project.monsoonHumidityRatio}
          />
          <ConditionBox
            label="Monsoon Inside"
            color="cyan"
            temp={project.insideMonsoonTemp ?? project.insideSummerTemp}
            rh={project.insideMonsoonHumidity ?? 55}
            enthalpy={project.insideMonsoonEnthalpy}
            hr={project.insideMonsoonHumidityRatio}
          />
          </>
          )}
          {project.includeWinter && (
            <>
              <ConditionBox
                label="Winter Outside"
                color="indigo"
                temp={project.winterDesignTemp}
                rh={project.winterDesignHumidity}
                enthalpy={project.winterEnthalpy}
                hr={project.winterHumidityRatio}
              />
              <ConditionBox
                label="Winter Inside"
                color="purple"
                temp={project.insideWinterTemp}
                rh={project.insideWinterHumidity}
              />
            </>
          )}
        </div>

        {(project.latitude || project.longitude) && (
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {project.latitude?.toFixed(4)}°, {project.longitude?.toFixed(4)}°
            {project.altitude ? ` · ${project.altitude} ft` : ''}
          </p>
        )}

        <p className="text-xs text-slate-400 dark:text-slate-500">
          Updated {new Date(project.updatedAt).toLocaleDateString()}
        </p>

        <div className="flex flex-wrap gap-1.5">
          {ownerLabel && (
            <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-300">
              Owned by: {ownerLabel}
            </span>
          )}
          {sharedWithMe && (
            <span className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-800 dark:border-teal-700 dark:bg-teal-950/20 dark:text-teal-300">
              <Users className="h-3 w-3" /> Shared with you
            </span>
          )}
          {canAssign && assignedCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-800 dark:border-teal-700 dark:bg-teal-950/20 dark:text-teal-300">
              <Users className="h-3 w-3" /> Shared with {assignedCount}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button onClick={onOpen} size="sm" className="flex-1 gap-1 bg-teal-600 hover:bg-teal-700 text-white">
            Open <ChevronRight className="h-3 w-3" />
          </Button>
          {canAssign && (
            <Button onClick={onAssign} variant="outline" size="sm" title="Assign to team members">
              <UserPlus className="h-4 w-4" />
            </Button>
          )}
          <Button onClick={onEdit} variant="outline" size="sm">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button onClick={onDelete} variant="destructive" size="sm">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ConditionBox({
  label, color, temp, rh, enthalpy, hr,
}: {
  label: string; color: string;
  temp: number; rh: number;
  enthalpy?: number; hr?: number;
}) {
  const bg: Record<string, string> = {
    red: 'bg-red-50 border-red-100 dark:bg-red-950/20 dark:border-red-900',
    blue: 'bg-blue-50 border-blue-100 dark:bg-blue-950/20 dark:border-blue-900',
    teal: 'bg-teal-50 border-teal-100 dark:bg-teal-950/20 dark:border-teal-900',
    cyan: 'bg-cyan-50 border-cyan-100 dark:bg-cyan-950/20 dark:border-cyan-900',
    indigo: 'bg-indigo-50 border-indigo-100 dark:bg-indigo-950/20 dark:border-indigo-900',
    purple: 'bg-purple-50 border-purple-100 dark:bg-purple-950/20 dark:border-purple-900',
  };
  const text: Record<string, string> = {
    red: 'text-red-700 dark:text-red-300',
    blue: 'text-blue-700 dark:text-blue-300',
    teal: 'text-teal-700 dark:text-teal-300',
    cyan: 'text-cyan-700 dark:text-cyan-300',
    indigo: 'text-indigo-700 dark:text-indigo-300',
    purple: 'text-purple-700 dark:text-purple-300',
  };
  return (
    <div className={`rounded border p-2 ${bg[color]}`}>
      <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`font-bold ${text[color]}`}>{temp}°F / {rh}% RH</p>
      {enthalpy != null && (
        <p className="text-[10px] text-gray-500 dark:text-slate-400">
          h={enthalpy} BTU/lb · W={hr?.toFixed(4)}
        </p>
      )}
    </div>
  );
}

// ─── Create / Edit Dialog ─────────────────────────────────────────────────────

interface DialogProps {
  open: boolean;
  onClose: () => void;
  form: FormState;
  setField: (key: keyof FormState, value: string | boolean) => void;
  onSave: () => void;
  onGeocode: () => void;
  saving: boolean;
  geocoding: boolean;
  editing: boolean;
}

function ConditionPair({
  tempVal, rhVal,
  onTempChange, onRhChange,
  tempPlaceholder, rhPlaceholder,
}: {
  tempVal: string; rhVal: string;
  onTempChange: (v: string) => void; onRhChange: (v: string) => void;
  tempPlaceholder: string; rhPlaceholder: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <Label className="text-[11px] text-slate-500 dark:text-slate-400">Temp (°F)</Label>
        <Input
          type="text" inputMode="decimal" placeholder={tempPlaceholder}
          value={tempVal}
          onChange={(e) => onTempChange(e.target.value)}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-slate-500 dark:text-slate-400">RH (%)</Label>
        <Input
          type="text" inputMode="decimal" placeholder={rhPlaceholder}
          value={rhVal}
          onChange={(e) => onRhChange(e.target.value)}
          className="h-8 text-sm"
        />
      </div>
    </div>
  );
}

function ProjectDialog({
  open, onClose, form, setField, onSave, onGeocode, saving, geocoding, editing,
}: DialogProps) {
  const activeSeasonsCount = 1 + (form.includeMonsoon ? 1 : 0) + (form.includeWinter ? 1 : 0);
  const gridCols = activeSeasonsCount === 1 ? 'grid-cols-1' : activeSeasonsCount === 2 ? 'grid-cols-2' : 'grid-cols-3';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] w-[95vw] sm:max-w-6xl overflow-y-auto p-0">

        {/* Header */}
        <div className="sticky top-0 z-10 rounded-t-lg border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500/10 dark:bg-teal-500/20">
              <Thermometer className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">
                {editing ? 'Edit Project' : 'New Project'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {editing ? 'Update project settings and design conditions' : 'Set up project details and climate design conditions'}
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-6">

          {/* ── Project Info ─────────────────────────────────────────── */}
          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Project Information</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-1.5">
                <Label className="text-sm font-medium">Project Name <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="e.g. Office Building — East Tower"
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  className="h-9"
                />
              </div>

              {/* Location + geocode */}
              <div className="sm:col-span-2 space-y-1.5">
                <Label className="text-sm font-medium">Project Location</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. Connaught Place, New Delhi, India"
                    value={form.location}
                    onChange={(e) => setField('location', e.target.value)}
                    className="flex-1 h-9"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onGeocode}
                    disabled={geocoding}
                    className="shrink-0 h-9 gap-1.5 px-3"
                  >
                    {geocoding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                    <span className="text-sm">{geocoding ? 'Searching…' : 'Search'}</span>
                  </Button>
                </div>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  Search auto-fills coordinates, altitude, and all design conditions via AI.
                </p>
              </div>

              {/* Lat / Lon / Alt */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-slate-400" /> Latitude
                </Label>
                <Input type="text" inputMode="decimal" step="0.0001" placeholder="e.g. 28.6315"
                  value={form.latitude} onChange={(e) => setField('latitude', e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-slate-400" /> Longitude
                </Label>
                <Input type="text" inputMode="decimal" step="0.0001" placeholder="e.g. 77.2167"
                  value={form.longitude} onChange={(e) => setField('longitude', e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Altitude (ft)</Label>
                <Input type="text" inputMode="decimal" step="1" placeholder="e.g. 745"
                  value={form.altitude} onChange={(e) => setField('altitude', e.target.value)} className="h-9" />
              </div>
            </div>
          </div>

          <Separator className="dark:bg-slate-700" />

          {/* ── Design Mode (unified: coil ADP + default airflow basis) ── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Thermometer className="h-4 w-4 text-sky-500" />
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Design Mode</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              <select
                value={form.designMode}
                onChange={(e) => setField('designMode', e.target.value)}
                className="h-9 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 text-sm"
              >
                <option value="comfort">Comfort — DSCFM @ 54°F ADP (7°C CHW, ~55°F supply)</option>
                <option value="dehumidification">Dehumidification — DSCFM @ 44/42°F ADP (chase a cold coil)</option>
                <option value="air-change">Air-change — ACH airflow @ 54°F ADP</option>
              </select>
              <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                Sets the coil ADP floor <em>and</em> the default room airflow basis in one choice.
                <span className="font-semibold"> Comfort</span> = standard Indian practice (~400 CFM/TR).
                <span className="font-semibold"> Dehumidification</span> = humid / latent-driven / process spaces.
                <span className="font-semibold"> Air-change</span> = size on ACH. Any room can still override its supply basis (DSCFM/ACH) individually.
              </p>
            </div>
          </div>

          <Separator className="dark:bg-slate-700" />

          {/* ── Report identity (date + stable No. + revision) ── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-indigo-500" />
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Report Identity</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Report Date</Label>
                <Input
                  type="date"
                  value={form.reportDate}
                  onChange={(e) => setField('reportDate', e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Report No.</Label>
                <Input
                  type="text"
                  value={form.reportId}
                  readOnly
                  placeholder="auto-assigned on save"
                  title="Stable per-project report number. Assigned automatically on first save and reused on every re-issue."
                  className="h-9 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 cursor-default"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Revision (R#)</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={form.reportRev}
                  onChange={(e) => setField('reportRev', e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
            <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              The <span className="font-semibold">Report No.</span> stays fixed for this project; bump the
              <span className="font-semibold"> Revision</span> each time you re-issue. Both, plus the
              <span className="font-semibold"> Report Date</span> you set here, print on every page so duplicate
              copies are easy to tell apart.
            </p>
          </div>

          <Separator className="dark:bg-slate-700" />

          {/* ── Season Toggles ───────────────────────────────────────── */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Design Seasons</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Monsoon toggle */}
              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all ${
                form.includeMonsoon
                  ? 'border-teal-400/60 bg-teal-50 dark:border-teal-600/50 dark:bg-teal-900/20'
                  : 'border-slate-200 dark:border-slate-700 hover:border-teal-300 dark:hover:border-teal-700'
              }`}>
                <input
                  type="checkbox"
                  checked={form.includeMonsoon}
                  onChange={(e) => setField('includeMonsoon', e.target.checked)}
                  className="mt-0.5 h-4 w-4 cursor-pointer accent-teal-500"
                />
                <div>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Include Monsoon</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Calculate peak load at monsoon conditions (high humidity)
                  </p>
                </div>
              </label>

              {/* Winter toggle */}
              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all ${
                form.includeWinter
                  ? 'border-blue-400/60 bg-blue-50 dark:border-blue-600/50 dark:bg-blue-900/20'
                  : 'border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700'
              }`}>
                <input
                  type="checkbox"
                  checked={form.includeWinter}
                  onChange={(e) => setField('includeWinter', e.target.checked)}
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

          {/* ── Outside Design Conditions ─────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Thermometer className="h-4 w-4 text-orange-500" />
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Outside Design Conditions</h3>
            </div>
            <div className={`grid gap-3 ${gridCols}`}>
              {/* Summer — always shown */}
              <div className="rounded-xl border border-orange-200 dark:border-orange-800/50 bg-orange-50 dark:bg-orange-900/15 p-4 space-y-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-orange-400" />
                  <p className="text-xs font-bold text-orange-700 dark:text-orange-300 uppercase tracking-wide">Summer</p>
                </div>
                <ConditionPair
                  tempVal={form.summerTemp} rhVal={form.summerRH}
                  onTempChange={(v) => setField('summerTemp', v)} onRhChange={(v) => setField('summerRH', v)}
                  tempPlaceholder="95" rhPlaceholder="50"
                />
              </div>

              {/* Monsoon — conditional */}
              {form.includeMonsoon && (
                <div className="rounded-xl border border-teal-200 dark:border-teal-700/50 bg-teal-50 dark:bg-teal-900/15 p-4 space-y-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-teal-400" />
                    <p className="text-xs font-bold text-teal-700 dark:text-teal-300 uppercase tracking-wide">Monsoon</p>
                  </div>
                  <ConditionPair
                    tempVal={form.monsoonTemp} rhVal={form.monsoonRH}
                    onTempChange={(v) => setField('monsoonTemp', v)} onRhChange={(v) => setField('monsoonRH', v)}
                    tempPlaceholder="85" rhPlaceholder="85"
                  />
                </div>
              )}

              {/* Winter — conditional */}
              {form.includeWinter && (
                <div className="rounded-xl border border-blue-200 dark:border-blue-700/50 bg-blue-50 dark:bg-blue-900/15 p-4 space-y-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-blue-400" />
                    <p className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wide">Winter</p>
                  </div>
                  <ConditionPair
                    tempVal={form.winterTemp} rhVal={form.winterRH}
                    onTempChange={(v) => setField('winterTemp', v)} onRhChange={(v) => setField('winterRH', v)}
                    tempPlaceholder="40" rhPlaceholder="30"
                  />
                </div>
              )}
            </div>
          </div>

          {/* ── Inside Design Conditions ──────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Droplets className="h-4 w-4 text-sky-500" />
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Inside Design Conditions</h3>
            </div>
            <div className={`grid gap-3 ${gridCols}`}>
              {/* Summer inside — always shown */}
              <div className="rounded-xl border border-sky-200 dark:border-sky-700/50 bg-sky-50 dark:bg-sky-900/15 p-4 space-y-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-sky-400" />
                  <p className="text-xs font-bold text-sky-700 dark:text-sky-300 uppercase tracking-wide">Summer (Cooling)</p>
                </div>
                <ConditionPair
                  tempVal={form.insideSummerTemp} rhVal={form.insideSummerRH}
                  onTempChange={(v) => setField('insideSummerTemp', v)} onRhChange={(v) => setField('insideSummerRH', v)}
                  tempPlaceholder="75" rhPlaceholder="50"
                />
              </div>

              {/* Monsoon inside — conditional */}
              {form.includeMonsoon && (
                <div className="rounded-xl border border-cyan-200 dark:border-cyan-700/50 bg-cyan-50 dark:bg-cyan-900/15 p-4 space-y-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-cyan-400" />
                    <p className="text-xs font-bold text-cyan-700 dark:text-cyan-300 uppercase tracking-wide">Monsoon (Cooling)</p>
                  </div>
                  <ConditionPair
                    tempVal={form.insideMonsoonTemp} rhVal={form.insideMonsoonRH}
                    onTempChange={(v) => setField('insideMonsoonTemp', v)} onRhChange={(v) => setField('insideMonsoonRH', v)}
                    tempPlaceholder="75" rhPlaceholder="55"
                  />
                </div>
              )}

              {/* Winter inside — conditional */}
              {form.includeWinter && (
                <div className="rounded-xl border border-indigo-200 dark:border-indigo-700/50 bg-indigo-50 dark:bg-indigo-900/15 p-4 space-y-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-indigo-400" />
                    <p className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wide">Winter (Heating)</p>
                  </div>
                  <ConditionPair
                    tempVal={form.insideWinterTemp} rhVal={form.insideWinterRH}
                    onTempChange={(v) => setField('insideWinterTemp', v)} onRhChange={(v) => setField('insideWinterRH', v)}
                    tempPlaceholder="70" rhPlaceholder="30"
                  />
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
          <Button variant="outline" onClick={onClose} disabled={saving} className="h-9">Cancel</Button>
          <Button onClick={onSave} disabled={saving} className="h-9 bg-teal-600 hover:bg-teal-500 text-white min-w-[130px]">
            {saving
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
              : editing ? 'Update Project' : 'Create Project'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Unsaved Changes Guard Dialog ─────────────────────────────────────────────

function UnsavedChangesDialog({
  isSaving,
  onSaveAndLeave,
  onDiscardAndLeave,
  onStay,
}: {
  isSaving: boolean;
  onSaveAndLeave: () => void;
  onDiscardAndLeave: () => void;
  onStay: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onStay(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Unsaved Changes</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          You have unsaved room or envelope changes. Save them to the database before leaving, or discard them.
        </p>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="ghost" onClick={onStay} disabled={isSaving} className="sm:mr-auto">
            Stay
          </Button>
          <Button
            variant="outline"
            onClick={onDiscardAndLeave}
            disabled={isSaving}
            className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/20"
          >
            Discard &amp; Leave
          </Button>
          <Button
            onClick={onSaveAndLeave}
            disabled={isSaving}
            className="bg-teal-600 hover:bg-teal-700 text-white"
          >
            {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : 'Save & Leave'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
