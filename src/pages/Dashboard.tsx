import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { MapPin, Play, Calculator, Zap, Wind, Droplets, Wrench, FileText, BookOpen, ArrowRight, FolderOpen, Clock } from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { toast } from 'sonner';

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
  { icon: Calculator, label: 'Load Calculator',     page: 'calculator', color: 'bg-blue-50 text-blue-700 border-blue-200',    desc: 'ASHRAE-based cooling & heating load' },
  { icon: Zap,        label: 'Cable & MCB Sizing',  page: 'cable',      color: 'bg-yellow-50 text-yellow-700 border-yellow-200', desc: 'IEC/IS cable and protection sizing' },
  { icon: Wind,       label: 'Duct Sizer',          page: 'duct',       color: 'bg-sky-50 text-sky-700 border-sky-200',         desc: 'Equal friction duct design' },
  { icon: Droplets,   label: 'Hydronic Pipe Sizer', page: 'pipe',       color: 'bg-teal-50 text-teal-700 border-teal-200',      desc: 'Chilled / hot water pipe sizing' },
  { icon: Wrench,     label: 'Equipment Selection', page: 'equipment',  color: 'bg-orange-50 text-orange-700 border-orange-200', desc: 'Select & schedule HVAC equipment' },
  { icon: FileText,   label: 'Material Takeoff',    page: 'takeoff',    color: 'bg-purple-50 text-purple-700 border-purple-200', desc: 'BOQ and material schedules' },
  { icon: FileText,   label: 'Reports',             page: 'reports',    color: 'bg-rose-50 text-rose-700 border-rose-200',       desc: 'PDF & Excel report generation' },
  { icon: BookOpen,   label: 'Methodology',         page: 'methodology',color: 'bg-indigo-50 text-indigo-700 border-indigo-200', desc: 'ASHRAE calculation references' },
];

export default function Dashboard({ currentUser, onProjectOpen, onPageChange, userRole }: DashboardProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [ownerEmails, setOwnerEmails] = useState<Record<string, string>>({});

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

  const recent = projects.slice(0, 5);

  const systemTypeColor = (t: string) => {
    switch (t) {
      case 'VRF':    return 'bg-purple-100 text-purple-700';
      case 'Hybrid': return 'bg-indigo-100 text-indigo-700';
      case 'Chiller':return 'bg-blue-100 text-blue-700';
      case 'VAV':    return 'bg-teal-100 text-teal-700';
      default:       return 'bg-gray-100 text-gray-600';
    }
  };

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="space-y-8">

      {/* ── Hero ──────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-600 p-8 text-white shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-blue-200 text-sm font-medium">{greeting()},</p>
            <h1 className="text-2xl sm:text-3xl font-bold mt-0.5">
              {currentUser.displayName || currentUser.email?.split('@')[0]}
            </h1>
            <p className="mt-2 text-blue-100 text-sm">
              {projects.length === 0
                ? 'No projects yet — head to Load Calculator to create your first one.'
                : `You have ${projects.length} project${projects.length !== 1 ? 's' : ''}. Pick up where you left off.`}
            </p>
          </div>
          <Button
            onClick={() => onPageChange?.('calculator')}
            className="bg-white text-blue-700 hover:bg-blue-50 font-semibold shadow w-fit flex-shrink-0"
          >
            <Calculator className="mr-2 h-4 w-4" />
            Open Load Calculator
          </Button>
        </div>

        {/* stat pills */}
        <div className="mt-6 flex flex-wrap gap-3">
          {[
            { label: 'Total Projects', value: projects.length },
            { label: 'VRF / Hybrid',  value: projects.filter(p => p.systemType === 'VRF' || p.systemType === 'Hybrid').length },
            { label: 'Chiller',       value: projects.filter(p => p.systemType === 'Chiller').length },
            { label: 'CAC / VAV',     value: projects.filter(p => ['CAC','VAV','WSHP'].includes(p.systemType)).length },
          ].map(s => (
            <div key={s.label} className="rounded-xl bg-white/15 backdrop-blur px-4 py-2 text-center min-w-[90px]">
              <p className="text-xl font-bold">{s.value}</p>
              <p className="text-[11px] text-blue-200">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Recent Projects ───────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Clock className="h-4 w-4 text-gray-400" /> Recent Projects
          </h2>
          <button
            onClick={() => onPageChange?.('calculator')}
            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            All projects <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        {recent.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center py-12 text-center">
            <FolderOpen className="h-10 w-10 text-gray-300 mb-3" />
            <p className="font-semibold text-gray-500">No projects yet</p>
            <p className="text-sm text-gray-400 mt-1 mb-4">Create your first project in the Load Calculator</p>
            <Button size="sm" onClick={() => onPageChange?.('calculator')}>
              <Calculator className="mr-2 h-4 w-4" /> Go to Load Calculator
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((project) => (
              <div
                key={project.id}
                className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md transition-shadow cursor-pointer group"
                onClick={() => onProjectOpen(project)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate group-hover:text-blue-700 transition-colors">{project.name}</p>
                    {project.location && (
                      <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1 truncate">
                        <MapPin className="h-3 w-3 flex-shrink-0" />{project.location}
                      </p>
                    )}
                  </div>
                  <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 flex-shrink-0 ${systemTypeColor(project.systemType)}`}>
                    {project.systemType}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-[11px] text-gray-400">
                    {project.summerDesignTemp}°F / {project.summerDesignHumidity}% RH
                  </p>
                  <p className="text-[11px] text-gray-400">
                    {project.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : ''}
                  </p>
                </div>
                {userRole === 'Super' && project.userId && (
                  <div className="mt-2">
                    <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">
                      Owned by: {ownerEmails[project.userId] || project.userId}
                    </span>
                  </div>
                )}
                <div className="mt-3">
                  <Button
                    size="sm"
                    className="w-full text-xs h-7"
                    onClick={(e) => { e.stopPropagation(); onProjectOpen(project); }}
                  >
                    <Play className="mr-1.5 h-3 w-3" /> Open
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Tools ────────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 mb-4">Engineering Tools</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {TOOLS.map((tool) => (
            <button
              key={tool.page}
              type="button"
              onClick={() => onPageChange?.(tool.page)}
              className={`rounded-xl border p-4 text-left hover:shadow-md transition-all group ${tool.color}`}
            >
              <tool.icon className="h-6 w-6 mb-2 opacity-80" />
              <p className="font-semibold text-sm leading-tight">{tool.label}</p>
              <p className="text-[11px] mt-1 opacity-70 leading-tight">{tool.desc}</p>
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}
