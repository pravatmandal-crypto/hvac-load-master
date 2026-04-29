import { useState, useEffect, useMemo } from 'react';
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
  MapPin, Thermometer, Droplets, ArrowLeft, Loader2,
} from 'lucide-react';
import LoadCalculator from '../components/hvac/LoadCalculator';
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
  longitude?: number;
  latitude?: number;
  altitude?: number;
  systemType: string;
  includeMonsoon: boolean;
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
  systemType: 'CAC',
  includeMonsoon: false,
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
}

export default function LoadCalculatorPage({ currentUser, initialProjectId, userRole = null }: Props) {
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

  // ── Load projects from Firestore ──────────────────────────────────────────
  useEffect(() => {
    const q = userRole === 'Super'
      ? query(collection(db, 'projects'), orderBy('updatedAt', 'desc'))
      : query(
          collection(db, 'projects'),
          where('userId', '==', currentUser.uid),
          orderBy('updatedAt', 'desc'),
        );
    const unsub = onSnapshot(q, (snap) => {
      setProjects(snap.docs.map((d) => {
        const p: any = d.data();
        const data = p.data || {};
        return {
          id: d.id,
          name: p.name || '',
          location: p.location || '',
          userId: p.userId,
          longitude: data.longitude,
          latitude: data.latitude,
          altitude: data.altitude,
          systemType: p.systemType || 'CAC',
          includeMonsoon: p.includeMonsoon ?? false,
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
          data,
        } as Project;
      }));
    }, (err) => {
      console.error('[LoadCalculatorPage]', err);
      toast.error('Failed to load projects');
    });
    return () => unsub();
  }, [currentUser.uid, userRole]);

  useEffect(() => {
    if (userRole !== 'Super') {
      setOwnerEmails({});
      return;
    }

    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      const next: Record<string, string> = {};
      snap.docs.forEach((d) => {
        const data: any = d.data();
        if (data?.email) next[d.id] = data.email;
      });
      setOwnerEmails(next);
    });

    return () => unsub();
  }, [userRole]);

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
    setForm({
      name: project.name,
      location: project.location,
      latitude: project.latitude != null ? String(project.latitude) : '',
      longitude: project.longitude != null ? String(project.longitude) : '',
      altitude: project.altitude != null ? String(project.altitude) : '',
      systemType: project.systemType,
      includeMonsoon: project.includeMonsoon,
      summerTemp: String(project.summerDesignTemp),
      summerRH: String(project.summerDesignHumidity),
      monsoonTemp: String(project.monsoonDesignTemp ?? 85),
      monsoonRH: String(project.monsoonDesignHumidity ?? 85),
      winterTemp: String(project.winterDesignTemp),
      winterRH: String(project.winterDesignHumidity),
      insideSummerTemp: String(project.insideSummerTemp),
      insideSummerRH: String(project.insideSummerHumidity),
      insideMonsoonTemp: String(project.insideMonsoonTemp ?? project.insideSummerTemp ?? 75),
      insideMonsoonRH: String(project.insideMonsoonHumidity ?? 55),
      insideWinterTemp: String(project.insideWinterTemp),
      insideWinterRH: String(project.insideWinterHumidity),
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
          monsoonTemp: String(locationData.monsoonDesignTemp ?? 85),
          monsoonRH: String(locationData.monsoonDesignHumidity ?? 85),
          winterTemp: String(locationData.winterDesignTemp),
          winterRH: String(locationData.winterDesignHumidity),
          includeMonsoon: locationData.monsoonDesignTemp != null || locationData.monsoonDesignHumidity != null
            ? true
            : prev.includeMonsoon,
          insideMonsoonTemp: prev.insideMonsoonTemp || prev.insideSummerTemp || '75',
          insideMonsoonRH: prev.insideMonsoonRH || '55',
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
        systemType: savedProjectMatch.systemType || prev.systemType,
        includeMonsoon: savedProjectMatch.includeMonsoon ?? prev.includeMonsoon,
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
    const outsideWinter = psychro(winT, winRH);
    const insideSummer = psychro(inSumT, inSumRH);
    const insideMonsoon = psychro(inMonT, inMonRH);

    const data = {
      longitude: form.longitude !== '' ? parseFloat(form.longitude) : undefined,
      latitude: form.latitude !== '' ? parseFloat(form.latitude) : undefined,
      altitude: form.altitude !== '' ? parseFloat(form.altitude) : 0,
      summerDesignTemp: sumT,
      summerDesignHumidity: sumRH,
      monsoonDesignTemp: monT,
      monsoonDesignHumidity: monRH,
      winterDesignTemp: winT,
      winterDesignHumidity: winRH,
      insideSummerTemp: inSumT,
      insideSummerHumidity: inSumRH,
      insideMonsoonTemp: inMonT,
      insideMonsoonHumidity: inMonRH,
      insideWinterTemp: inWinT,
      insideWinterHumidity: inWinRH,
      summerEnthalpy: outsideSummer.enthalpy,
      summerHumidityRatio: outsideSummer.humidityRatio,
      monsoonEnthalpy: outsideMonsoon.enthalpy,
      monsoonHumidityRatio: outsideMonsoon.humidityRatio,
      winterEnthalpy: outsideWinter.enthalpy,
      winterHumidityRatio: outsideWinter.humidityRatio,
      insideSummerEnthalpy: insideSummer.enthalpy,
      insideSummerHumidityRatio: insideSummer.humidityRatio,
      insideMonsoonEnthalpy: insideMonsoon.enthalpy,
      insideMonsoonHumidityRatio: insideMonsoon.humidityRatio,
    };

    const payload = {
      name: form.name.trim(),
      location: form.location.trim(),
      systemType: form.systemType,
      includeMonsoon: form.includeMonsoon,
      userId: currentUser.uid,
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
            onClick={() => setActiveProject(null)}
            className="gap-1"
          >
            <ArrowLeft className="h-4 w-4" />
            Projects
          </Button>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>Load Calculator</span>
            <ChevronRight className="h-4 w-4" />
            <span className="font-semibold text-gray-900">{activeProject.name}</span>
          </div>
          {userRole === 'Super' && activeProject.userId && (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
              Owned by: {ownerEmails[activeProject.userId] || activeProject.userId}
            </Badge>
          )}
          <Badge variant="outline" className="ml-auto">{activeProject.systemType}</Badge>
        </div>

        <LoadCalculator
          project={activeProject}
          userProfile={{ uid: currentUser.uid, email: currentUser.email }}
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
      </div>
    );
  }

  // ── Project list view ─────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Load Calculator</h1>
          <p className="text-sm text-gray-500">Select a project or create a new one to begin</p>
        </div>
        <Button onClick={openCreateDialog} className="gap-2 bg-blue-600 hover:bg-blue-700">
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="border-blue-100 bg-blue-50">
          <CardContent className="pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Total Projects</p>
            <p className="mt-1 text-2xl font-bold text-blue-900">{projectStats.total}</p>
          </CardContent>
        </Card>
        <Card className="border-indigo-100 bg-indigo-50">
          <CardContent className="pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Primary System</p>
            <p className="mt-1 text-2xl font-bold text-indigo-900">{projectStats.dominantSystem}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-100 bg-emerald-50">
          <CardContent className="pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Avg Summer Temp</p>
            <p className="mt-1 text-2xl font-bold text-emerald-900">{projectStats.averageSummerTemp}°F</p>
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
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 py-24 text-center">
          <Thermometer className="mx-auto mb-4 h-12 w-12 text-gray-300" />
          <h3 className="font-semibold text-gray-700">No projects yet</h3>
          <p className="mt-1 text-sm text-gray-500">Create your first project to start a load calculation</p>
          <Button onClick={openCreateDialog} className="mt-4 gap-2">
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 py-16 text-center">
          <p className="text-sm font-semibold text-gray-700">No matching projects</p>
          <p className="mt-1 text-xs text-gray-500">Try a different search term or clear system filter.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              ownerLabel={userRole === 'Super' && project.userId ? (ownerEmails[project.userId] || project.userId) : undefined}
              onOpen={() => setActiveProject(project)}
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
    </div>
  );
}

// ─── Project Card ─────────────────────────────────────────────────────────────

function ProjectCard({
  project, ownerLabel, onOpen, onEdit, onDelete,
}: {
  project: Project;
  ownerLabel?: string;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="group transition-all hover:shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{project.name}</CardTitle>
            {project.location && (
              <p className="mt-1 flex items-center gap-1 truncate text-xs text-gray-500">
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
        </div>

        {(project.latitude || project.longitude) && (
          <p className="text-xs text-gray-400">
            {project.latitude?.toFixed(4)}°, {project.longitude?.toFixed(4)}°
            {project.altitude ? ` · ${project.altitude} ft` : ''}
          </p>
        )}

        <p className="text-xs text-gray-400">
          Updated {new Date(project.updatedAt).toLocaleDateString()}
        </p>

        {ownerLabel && (
          <div>
            <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">
              Owned by: {ownerLabel}
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button onClick={onOpen} size="sm" className="flex-1 gap-1 bg-blue-600 hover:bg-blue-700">
            Open <ChevronRight className="h-3 w-3" />
          </Button>
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
    red: 'bg-red-50 border-red-100',
    blue: 'bg-blue-50 border-blue-100',
    teal: 'bg-teal-50 border-teal-100',
    cyan: 'bg-cyan-50 border-cyan-100',
    indigo: 'bg-indigo-50 border-indigo-100',
    purple: 'bg-purple-50 border-purple-100',
  };
  const text: Record<string, string> = {
    red: 'text-red-700',
    blue: 'text-blue-700',
    teal: 'text-teal-700',
    cyan: 'text-cyan-700',
    indigo: 'text-indigo-700',
    purple: 'text-purple-700',
  };
  return (
    <div className={`rounded border p-2 ${bg[color]}`}>
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`font-bold ${text[color]}`}>{temp}°F / {rh}% RH</p>
      {enthalpy != null && (
        <p className="text-[10px] text-gray-500">
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

function ProjectDialog({
  open, onClose, form, setField, onSave, onGeocode, saving, geocoding, editing,
}: DialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Project' : 'New Project'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Name */}
          <div className="space-y-1">
            <Label>Project Name *</Label>
            <Input
              placeholder="e.g. Office Building — East Tower"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
            />
          </div>

          {/* Address + geocode */}
          <div className="space-y-1">
            <Label>Project Address / Location</Label>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. Connaught Place, New Delhi, India"
                value={form.location}
                onChange={(e) => setField('location', e.target.value)}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={onGeocode}
                disabled={geocoding}
                className="shrink-0 gap-1"
              >
                {geocoding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {geocoding ? 'Searching...' : 'Search'}
              </Button>
            </div>
            <p className="text-xs text-gray-400">
              Click Search to auto-fill coordinates <strong>and design conditions</strong> (altitude, temperature, humidity) from address.
            </p>
          </div>

          {/* Coordinates + System */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label>Latitude</Label>
              <Input
                type="number" step="0.0001" placeholder="e.g. 28.6315"
                value={form.latitude}
                onChange={(e) => setField('latitude', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Longitude</Label>
              <Input
                type="number" step="0.0001" placeholder="e.g. 77.2167"
                value={form.longitude}
                onChange={(e) => setField('longitude', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Altitude (ft)</Label>
              <Input
                type="number" step="1" placeholder="e.g. 745"
                value={form.altitude}
                onChange={(e) => setField('altitude', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>System Type</Label>
              <Select value={form.systemType} onValueChange={(v) => v && setField('systemType', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['CAC', 'VRF', 'Hybrid', 'Chiller', 'VAV', 'WSHP'].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Include Monsoon */}
          <div className="flex items-center gap-3 rounded-lg bg-teal-50 p-3">
            <input
              type="checkbox"
              id="includeMonsoon"
              checked={form.includeMonsoon}
              onChange={(e) => setField('includeMonsoon', e.target.checked)}
              className="h-4 w-4 cursor-pointer rounded border-gray-300"
            />
            <label htmlFor="includeMonsoon" className="flex-1 cursor-pointer">
              <p className="text-sm font-semibold text-teal-800">Include Monsoon Calculation</p>
              <p className="text-xs text-teal-700">Show monsoon season conditions in reports and exports</p>
            </label>
          </div>

          <Separator />

          {/* Outside conditions */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Thermometer className="h-4 w-4 text-red-500" />
              <Label className="text-sm font-semibold">Outside Design Conditions</Label>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-3 rounded-lg bg-red-50 p-3">
                <p className="text-xs font-semibold text-red-700">Summer</p>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Temp (°F)</Label>
                    <Input
                      type="text" inputMode="decimal" placeholder="95"
                      value={form.summerTemp}
                      onChange={(e) => setField('summerTemp', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">RH (%)</Label>
                    <Input
                      type="text" inputMode="decimal" placeholder="50"
                      value={form.summerRH}
                      onChange={(e) => setField('summerRH', e.target.value)}
                    />
                  </div>
                </div>
              </div>
              {form.includeMonsoon && (
              <div className="space-y-3 rounded-lg bg-teal-50 p-3">
                <p className="text-xs font-semibold text-teal-700">Monsoon</p>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Temp (°F)</Label>
                    <Input
                      type="text" inputMode="decimal" placeholder="85"
                      value={form.monsoonTemp}
                      onChange={(e) => setField('monsoonTemp', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">RH (%)</Label>
                    <Input
                      type="text" inputMode="decimal" placeholder="85"
                      value={form.monsoonRH}
                      onChange={(e) => setField('monsoonRH', e.target.value)}
                    />
                  </div>
                </div>
              </div>
              )}
              <div className="space-y-3 rounded-lg bg-indigo-50 p-3">
                <p className="text-xs font-semibold text-indigo-700">Winter</p>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Temp (°F)</Label>
                    <Input
                      type="text" inputMode="decimal" placeholder="40"
                      value={form.winterTemp}
                      onChange={(e) => setField('winterTemp', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">RH (%)</Label>
                    <Input
                      type="text" inputMode="decimal" placeholder="30"
                      value={form.winterRH}
                      onChange={(e) => setField('winterRH', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Inside conditions */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Droplets className="h-4 w-4 text-blue-500" />
              <Label className="text-sm font-semibold">Inside Design Conditions</Label>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-3 rounded-lg bg-blue-50 p-3">
                <p className="text-xs font-semibold text-blue-700">Summer (Cooling)</p>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Temp (°F)</Label>
                    <Input
                      type="text" inputMode="decimal" placeholder="75"
                      value={form.insideSummerTemp}
                      onChange={(e) => setField('insideSummerTemp', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">RH (%)</Label>
                    <Input
                      type="text" inputMode="decimal" placeholder="50"
                      value={form.insideSummerRH}
                      onChange={(e) => setField('insideSummerRH', e.target.value)}
                    />
                  </div>
                </div>
              </div>
              {form.includeMonsoon && (
              <div className="space-y-3 rounded-lg bg-cyan-50 p-3">
                <p className="text-xs font-semibold text-cyan-700">Monsoon (Cooling)</p>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Temp (°F)</Label>
                    <Input
                      type="text" inputMode="decimal" placeholder="75"
                      value={form.insideMonsoonTemp}
                      onChange={(e) => setField('insideMonsoonTemp', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">RH (%)</Label>
                    <Input
                      type="text" inputMode="decimal" placeholder="55"
                      value={form.insideMonsoonRH}
                      onChange={(e) => setField('insideMonsoonRH', e.target.value)}
                    />
                  </div>
                </div>
              </div>
              )}
              <div className="space-y-3 rounded-lg bg-purple-50 p-3">
                <p className="text-xs font-semibold text-purple-700">Winter (Heating)</p>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Temp (°F)</Label>
                    <Input
                      type="text" inputMode="decimal" placeholder="70"
                      value={form.insideWinterTemp}
                      onChange={(e) => setField('insideWinterTemp', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">RH (%)</Label>
                    <Input
                      type="text" inputMode="decimal" placeholder="30"
                      value={form.insideWinterRH}
                      onChange={(e) => setField('insideWinterRH', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              Enthalpy and Humidity Ratio will be calculated automatically on save.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={onSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : editing ? 'Update Project' : 'Create Project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
