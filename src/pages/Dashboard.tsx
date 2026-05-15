import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { MapPin, Play, Calculator, Zap, Wind, Droplets, Wrench, FileText, BookOpen, ArrowRight, FolderOpen, Clock, Thermometer, Copy, Loader2 } from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, doc, getDoc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { toast } from 'sonner';
import { cloneProject } from '../services/cloneProjectService';

interface Project {
  id: string;
  name: string;
  location: string;
  userId?: string;
  systemType: string;
  summerDesignTemp: number;
  summerDesignHumidity: number;
  winterDesignTemp?: number;
  winterDesignHumidity?: number;
  updatedAt: Date;
}

interface DashboardProps {
  currentUser: User;
  onProjectOpen: (project: Project) => void;
  onPageChange?: (page: string) => void;
  userRole: string | null;
}

const TOOLS = [
  { icon: Calculator, label: 'Load Calculator',     page: 'calculator', color: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/20 dark:text-teal-300 dark:border-teal-800',       desc: 'ASHRAE-based cooling & heating load' },
  { icon: Zap,        label: 'Cable & MCB Sizing',  page: 'cable',      color: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800', desc: 'IEC/IS cable and protection sizing' },
  { icon: Wind,       label: 'Duct Sizer',          page: 'duct',       color: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:border-sky-800',             desc: 'Equal friction duct design' },
  { icon: Droplets,   label: 'Hydronic Pipe Sizer', page: 'pipe',       color: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-900/20 dark:text-cyan-300 dark:border-cyan-800',       desc: 'Chilled / hot water pipe sizing' },
  { icon: Wrench,     label: 'Equipment Selection', page: 'equipment',  color: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800', desc: 'Select & schedule HVAC equipment' },
  { icon: FileText,   label: 'Material Takeoff',    page: 'takeoff',    color: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-800', desc: 'BOQ and material schedules' },
  { icon: FileText,   label: 'Reports',             page: 'reports',    color: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:border-rose-800',       desc: 'PDF & Excel report generation' },
  { icon: BookOpen,   label: 'Methodology',         page: 'methodology',color: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-800', desc: 'ASHRAE calculation references' },
];

export default function Dashboard({ currentUser, onProjectOpen, onPageChange, userRole }: DashboardProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [ownerEmails, setOwnerEmails] = useState<Record<string, string>>({});
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  const handleDuplicate = async (project: Project) => {
    if (duplicatingId) return;
    setDuplicatingId(project.id);
    const newName = `Copy of ${project.name}`;
    const toastId = toast.loading(`Duplicating "${project.name}"…`);
    try {
      const result = await cloneProject(project.id, newName, currentUser.uid, (msg) => {
        toast.loading(msg, { id: toastId });
      });
      toast.success(
        `Duplicated — ${result.roomsCopied} room${result.roomsCopied === 1 ? '' : 's'}, ${result.systemsCopied} system${result.systemsCopied === 1 ? '' : 's'}, ${result.envelopeElementsCopied} envelope element${result.envelopeElementsCopied === 1 ? '' : 's'} copied.`,
        { id: toastId, duration: 6000 },
      );
      // Auto-open the new project. Fetch the freshly-written doc directly so the
      // LoadCalculator receives the clone's own data — not the source project's data
      // shallow-spread with a swapped id (which made Edit-dialog values appear stale
      // until the parent's onSnapshot listener caught up).
      let newProject: Project;
      try {
        const newSnap = await getDoc(doc(db, 'projects', result.newProjectId));
        const np: any = newSnap.exists() ? newSnap.data() : {};
        const npData = np.data || {};
        newProject = {
          id: result.newProjectId,
          name: np.name ?? newName,
          location: np.location ?? '',
          userId: np.userId,
          systemType: np.systemType || 'CAC',
          summerDesignTemp: npData.summerDesignTemp ?? 95,
          summerDesignHumidity: npData.summerDesignHumidity ?? 50,
          winterDesignTemp: npData.winterDesignTemp,
          winterDesignHumidity: npData.winterDesignHumidity,
          updatedAt: np.updatedAt?.toDate ? np.updatedAt.toDate() : new Date(),
        };
      } catch {
        // Fallback: pass through with new id and let the parent's onSnapshot reconcile.
        newProject = { ...project, id: result.newProjectId, name: newName, updatedAt: new Date() };
      }
      onProjectOpen(newProject);
    } catch (err: any) {
      toast.error(`Duplicate failed: ${err?.message ?? 'unknown error'}`, { id: toastId });
    } finally {
      setDuplicatingId(null);
    }
  };

  useEffect(() => {
    const q = userRole === 'Super'
      ? query(collection(db, 'projects'), orderBy('updatedAt', 'desc'))
      : query(
          collection(db, 'projects'),
          where('userId', '==', currentUser.uid),
          orderBy('updatedAt', 'desc'),
        );
    const unsub = onSnapshot(q, (snap) => {
      setProjects(
        snap.docs.map((d) => {
          const p: any = d.data();
          const data = p.data || {};
          return {
            id: d.id,
            name: p.name || '',
            location: p.location || '',
            userId: p.userId,
            systemType: p.systemType || 'CAC',
            summerDesignTemp: data.summerDesignTemp ?? 95,
            summerDesignHumidity: data.summerDesignHumidity ?? 50,
            winterDesignTemp: data.winterDesignTemp,
            winterDesignHumidity: data.winterDesignHumidity,
            updatedAt: p.updatedAt?.toDate ? p.updatedAt.toDate() : new Date(),
          };
        }),
      );
    }, (err) => {
      console.error('[Dashboard] load error:', err);
      toast.error('Failed to load projects.');
    });
    return () => unsub();
  }, [currentUser.uid, userRole]);

  useEffect(() => {
    if (userRole !== 'Super') { setOwnerEmails({}); return; }
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

  const recent = projects.slice(0, 6);

  const systemTypeBadge = (t: string) => {
    switch (t) {
      case 'VRF':     return 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300';
      case 'Hybrid':  return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300';
      case 'Chiller': return 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300';
      case 'VAV':     return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300';
      default:        return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
    }
  };

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="space-y-8 max-w-7xl">

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl shadow-lg">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-teal-700 to-teal-900" />
        {/* Decorative pattern */}
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)', backgroundSize: '40px 40px' }}
        />
        <div className="relative p-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Thermometer className="h-4 w-4 text-teal-300" />
                <p className="text-teal-200 text-sm font-medium">{greeting()},</p>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white">
                {currentUser.displayName || currentUser.email?.split('@')[0]}
              </h1>
              <p className="mt-2 text-slate-300 text-sm max-w-md">
                {projects.length === 0
                  ? 'No projects yet — head to Load Calculator to create your first one.'
                  : `${projects.length} project${projects.length !== 1 ? 's' : ''} — pick up where you left off.`}
              </p>
            </div>
            <Button
              onClick={() => onPageChange?.('calculator')}
              className="bg-teal-500 hover:bg-teal-400 text-white font-semibold shadow-lg w-fit flex-shrink-0 border border-teal-400/50"
            >
              <Calculator className="mr-2 h-4 w-4" />
              Open Load Calculator
            </Button>
          </div>

          {/* Stat pills */}
          <div className="mt-6 flex flex-wrap gap-3">
            {[
              { label: 'Total Projects', value: projects.length,                                                                    color: 'bg-white/15' },
              { label: 'VRF / Hybrid',   value: projects.filter(p => p.systemType === 'VRF' || p.systemType === 'Hybrid').length,   color: 'bg-violet-500/20' },
              { label: 'Chiller',        value: projects.filter(p => p.systemType === 'Chiller').length,                            color: 'bg-teal-500/20' },
              { label: 'CAC / VAV',      value: projects.filter(p => ['CAC','VAV','WSHP'].includes(p.systemType)).length,           color: 'bg-amber-500/20' },
            ].map(s => (
              <div key={s.label} className={`rounded-xl ${s.color} backdrop-blur-sm border border-white/10 px-4 py-2.5 text-center min-w-[90px]`}>
                <p className="text-xl font-bold text-white">{s.value}</p>
                <p className="text-[10px] text-slate-300 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Recent Projects ─────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Clock className="h-4 w-4 text-teal-500" />
            Recent Projects
          </h2>
          <button
            onClick={() => onPageChange?.('calculator')}
            className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 flex items-center gap-1 font-medium"
          >
            All projects <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        {recent.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center py-12 text-center">
            <FolderOpen className="h-10 w-10 text-slate-300 dark:text-slate-600 mb-3" />
            <p className="font-semibold text-slate-500 dark:text-slate-400">No projects yet</p>
            <p className="text-sm text-slate-400 dark:text-slate-500 mt-1 mb-4">
              Create your first project in the Load Calculator
            </p>
            <Button size="sm" onClick={() => onPageChange?.('calculator')}>
              <Calculator className="mr-2 h-4 w-4" /> Go to Load Calculator
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((project) => (
              <div
                key={project.id}
                className="group rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-4 hover:shadow-md hover:border-teal-300 dark:hover:border-teal-700 transition-all cursor-pointer"
                onClick={() => onProjectOpen(project)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 dark:text-slate-100 truncate group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">
                      {project.name}
                    </p>
                    {project.location && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1 truncate">
                        <MapPin className="h-3 w-3 flex-shrink-0" />{project.location}
                      </p>
                    )}
                  </div>
                  <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 flex-shrink-0 ${systemTypeBadge(project.systemType)}`}>
                    {project.systemType}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-1.5 text-[10px]">
                  <div className="rounded bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-800/40 px-2 py-1">
                    <span className="text-orange-500 font-medium">Summer</span>
                    <span className="text-slate-600 dark:text-slate-300 ml-1">{project.summerDesignTemp}°F / {project.summerDesignHumidity}%</span>
                  </div>
                  {project.winterDesignTemp != null ? (
                    <div className="rounded bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 px-2 py-1">
                      <span className="text-blue-500 font-medium">Winter</span>
                      <span className="text-slate-600 dark:text-slate-300 ml-1">{project.winterDesignTemp}°F</span>
                    </div>
                  ) : (
                    <div className="rounded bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700 px-2 py-1 text-slate-400">
                      {project.updatedAt ? new Date(project.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : ''}
                    </div>
                  )}
                </div>
                {userRole === 'Super' && project.userId && (
                  <div className="mt-2">
                    <span className="inline-flex items-center rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                      {ownerEmails[project.userId] || project.userId}
                    </span>
                  </div>
                )}
                <div className="mt-3 flex items-stretch gap-1.5">
                  <Button
                    size="sm"
                    className="flex-1 text-xs h-7 bg-teal-600 hover:bg-teal-500 text-white"
                    onClick={(e) => { e.stopPropagation(); onProjectOpen(project); }}
                  >
                    <Play className="mr-1.5 h-3 w-3" /> Open
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 px-2"
                    disabled={duplicatingId !== null}
                    title={`Duplicate "${project.name}"`}
                    onClick={(e) => { e.stopPropagation(); void handleDuplicate(project); }}
                  >
                    {duplicatingId === project.id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Engineering Tools ──────────────────────────────────────────── */}
      <div>
        <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-4">Engineering Tools</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {TOOLS.map((tool) => (
            <button
              key={tool.page}
              type="button"
              onClick={() => onPageChange?.(tool.page)}
              className={`rounded-xl border p-4 text-left hover:shadow-md hover:-translate-y-0.5 transition-all group ${tool.color}`}
            >
              <tool.icon className="h-5 w-5 mb-2.5 opacity-80" />
              <p className="font-semibold text-[13px] leading-tight">{tool.label}</p>
              <p className="text-[11px] mt-1 opacity-65 leading-tight">{tool.desc}</p>
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}
