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
} from 'lucide-react';
import { useState } from 'react';

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

  const handleLogout = async () => {
    try {
      await signOut(auth);
      onLogout();
    } catch (error) {
      console.error('Logout failed:', error);
      // Force logout even if signOut fails (e.g., offline / demo mode)
      onLogout();
    }
  };

  const menuItems = [
    { icon: Home, label: 'Dashboard', page: 'dashboard' },
    { icon: Calculator, label: 'Load Calculator', page: 'calculator' },
    { icon: Zap, label: 'Cable & MCB Sizing', page: 'cable' },
    { icon: Wind, label: 'Duct Sizer', page: 'duct' },
    { icon: Droplets, label: 'Hydronic Pipe Sizer', page: 'pipe' },
    { icon: Wrench, label: 'Equipment Selection', page: 'equipment' },
    { icon: FileText, label: 'Material Takeoff', page: 'takeoff' },
    { icon: FileText, label: 'Reports', page: 'reports' },
    { icon: Users, label: 'Team', page: 'team' },
    { icon: BookOpen, label: 'Methodology', page: 'methodology' },
  ];

  const visibleMenuItems = menuItems.filter((item) => item.page !== 'team' || userRole === 'Super');

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-16'
        } bg-gradient-to-b from-blue-900 to-blue-800 text-white shadow-xl transition-all duration-300 flex flex-col`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between border-b border-blue-700 p-4">
          {sidebarOpen && (
            <div>
              <h1 className="text-xl font-bold">HVAC Master</h1>
              <p className="text-xs text-blue-200">Load Calculator</p>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded p-1 hover:bg-blue-700 ml-auto"
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Active project banner */}
        {activeProject && sidebarOpen && (
          <div className="mx-3 mt-3 rounded-lg bg-blue-700/60 px-3 py-2">
            <p className="text-[10px] text-blue-300 uppercase tracking-wider">Active Project</p>
            <p className="truncate text-sm font-semibold text-white">{activeProject.name}</p>
            <p className="truncate text-[10px] text-blue-200">{activeProject.systemType}</p>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-3 overflow-y-auto">
          {visibleMenuItems.map((item, i) => {
            const isActive = currentPage === item.page;
            return (
              <button
                key={i}
                onClick={() => onPageChange?.(item.page)}
                title={!sidebarOpen ? item.label : undefined}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 transition-colors text-left text-sm ${
                  isActive
                    ? 'bg-white/20 text-white font-semibold'
                    : 'text-blue-100 hover:bg-blue-700 hover:text-white'
                }`}
              >
                <item.icon size={18} className="shrink-0" />
                {sidebarOpen && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* User Profile */}
        <div className="border-t border-blue-700 p-3">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-700">
              <span className="text-sm font-bold">
                {currentUser.email?.charAt(0).toUpperCase()}
              </span>
            </div>
            {sidebarOpen && (
              <div className="flex-1 overflow-hidden">
                <p className="truncate text-sm font-medium">{currentUser.displayName || 'User'}</p>
                <p className="truncate text-xs text-blue-200">{currentUser.email}</p>
              </div>
            )}
          </div>
          <Button
            onClick={handleLogout}
            variant="destructive"
            size="sm"
            className="w-full"
          >
            <LogOut size={16} />
            {sidebarOpen && <span className="ml-2">Logout</span>}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="border-b bg-white shadow-sm">
          <div className="flex items-center justify-between px-8 py-4">
            <h2 className="text-2xl font-bold text-gray-900">
              {menuItems.find(m => m.page === currentPage)?.label ?? 'HVAC Load Master'}
            </h2>
            <div className="flex items-center gap-4">
              <button
                className="rounded-lg p-2 hover:bg-gray-100"
                aria-label="Open settings"
                title="Open settings"
              >
                <Settings size={20} className="text-gray-600" />
              </button>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto bg-gray-50 p-8">
          {children}
        </main>

        {/* Footer */}
        <footer className="border-t bg-white px-8 py-2 flex items-center justify-center">
          <p className="text-xs text-gray-400">
            &copy; {new Date().getFullYear()} Creative Concept. All rights reserved.
          </p>
        </footer>
      </div>
    </div>
  );
}
