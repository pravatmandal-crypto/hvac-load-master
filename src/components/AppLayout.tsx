import { ReactNode } from 'react';
import { User, signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { Button } from './ui/button';
import {
  Menu,
  LogOut,
  Home,
  Calculator,
  Wrench,
  FileText,
  Settings,
  Users,
  X,
  Zap,
  Wind,
  Droplets,
  BookOpen,
  Layers,
  Sun,
  Moon,
  Thermometer,
} from 'lucide-react';
import { useState } from 'react';
import { useTheme } from '../hooks/useTheme';

interface AppLayoutProps {
  children: ReactNode;
  currentUser: User;
  currentPage?: string;
  activeProject?: any;
  onLogout: () => void;
  onPageChange?: (page: string) => void;
  userRole: string | null;
}

export default function AppLayout({
  children,
  currentUser,
  currentPage,
  activeProject,
  onLogout,
  onPageChange,
  userRole,
}: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { isDark, toggle: toggleTheme } = useTheme();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      onLogout();
    } catch (error) {
      console.error('Logout failed:', error);
      onLogout();
    }
  };

  const menuItems = [
    { icon: Home,         label: 'Dashboard',          page: 'dashboard' },
    { icon: Calculator,   label: 'Load Calculator',     page: 'calculator' },
    { icon: Zap,          label: 'Cable & MCB Sizing',  page: 'cable' },
    { icon: Wind,         label: 'Duct Sizer',          page: 'duct' },
    { icon: Droplets,     label: 'Hydronic Pipe Sizer', page: 'pipe' },
    { icon: Wrench,       label: 'Equipment Selection', page: 'equipment' },
    { icon: FileText,     label: 'Material Takeoff',    page: 'takeoff' },
    { icon: Layers,       label: 'U Builder',           page: 'ubuilder' },
    { icon: FileText,     label: 'Reports',             page: 'reports' },
    { icon: Users,        label: 'Team',                page: 'team' },
    { icon: BookOpen,     label: 'Methodology',         page: 'methodology' },
    { icon: BookOpen,     label: 'User Manual',         page: 'manual' },
  ];

  const visibleMenuItems = menuItems.filter(
    (item) => item.page !== 'team' || userRole === 'Super',
  );

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950">

      {/* ── Sidebar ────────────────────────────────────────────── */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-16'
        } bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-white shadow-2xl transition-all duration-300 flex flex-col flex-shrink-0`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          {sidebarOpen && (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500 shadow">
                <Thermometer size={16} className="text-white" />
              </div>
              <div>
                <h1 className="text-[13px] font-bold leading-tight text-white">HVAC Master</h1>
                <p className="text-[10px] text-slate-400 leading-tight">Load Calculator</p>
              </div>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-lg p-1.5 hover:bg-white/10 transition-colors ml-auto"
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {/* Active project banner */}
        {activeProject && sidebarOpen && (
          <div className="mx-3 mt-3 rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-2">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-teal-400">
              Active Project
            </p>
            <p className="truncate text-xs font-semibold text-white mt-0.5">{activeProject.name}</p>
            {activeProject.location && (
              <p className="truncate text-[10px] text-slate-400">{activeProject.location}</p>
            )}
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 p-3 overflow-y-auto">
          {visibleMenuItems.map((item, i) => {
            const isActive = currentPage === item.page;
            return (
              <button
                key={i}
                onClick={() => onPageChange?.(item.page)}
                title={!sidebarOpen ? item.label : undefined}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 transition-all text-left text-sm ${
                  isActive
                    ? 'bg-teal-500/20 text-teal-300 font-semibold border border-teal-500/30'
                    : 'text-slate-300 hover:bg-white/8 hover:text-white border border-transparent'
                }`}
              >
                <item.icon
                  size={17}
                  className={`shrink-0 ${isActive ? 'text-teal-400' : 'text-slate-400'}`}
                />
                {sidebarOpen && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* User Profile */}
        <div className="border-t border-white/10 p-3">
          <div className="mb-2.5 flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs font-bold">
              {currentUser.email?.charAt(0).toUpperCase()}
            </div>
            {sidebarOpen && (
              <div className="flex-1 overflow-hidden">
                <p className="truncate text-xs font-semibold text-white">
                  {currentUser.displayName || 'User'}
                </p>
                <p className="truncate text-[10px] text-slate-400">{currentUser.email}</p>
              </div>
            )}
          </div>
          <Button
            onClick={handleLogout}
            variant="destructive"
            size="sm"
            className="w-full h-7 text-xs"
          >
            <LogOut size={13} />
            {sidebarOpen && <span className="ml-1.5">Logout</span>}
          </Button>
        </div>
      </aside>

      {/* ── Main Content ────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">

        {/* Header */}
        <header className="flex-shrink-0 border-b border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 shadow-sm">
          <div className="flex items-center justify-between px-6 py-3">
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
              {menuItems.find(m => m.page === currentPage)?.label ?? 'HVAC Load Master'}
            </h2>
            <div className="flex items-center gap-2">
              {/* Dark / Light toggle */}
              <button
                onClick={toggleTheme}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors
                  text-slate-600 dark:text-slate-300
                  hover:bg-slate-100 dark:hover:bg-slate-800
                  border border-slate-200 dark:border-slate-700"
                aria-label="Toggle dark mode"
                title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {isDark
                  ? <><Sun size={14} className="text-amber-400" /><span className="hidden sm:inline">Light</span></>
                  : <><Moon size={14} className="text-slate-500" /><span className="hidden sm:inline">Dark</span></>
                }
              </button>
              <button
                className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="Settings"
                title="Settings"
              >
                <Settings size={18} />
              </button>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-950 p-6">
          {children}
        </main>

        {/* Footer */}
        <footer className="flex-shrink-0 border-t border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 px-6 py-1.5 flex items-center justify-center">
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            &copy; {new Date().getFullYear()} Creative Concept. All rights reserved.
          </p>
        </footer>
      </div>
    </div>
  );
}
