import { useState, useEffect } from 'react';
import { Toaster } from 'sonner';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './lib/firebase';
import { db } from './lib/firebase';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import AppLayout from './components/AppLayout';
import Dashboard from './pages/Dashboard';
import AuthPage from './pages/AuthPage';
import ErrorBoundary from './components/ErrorBoundary';
import LoadCalculatorPage from './pages/LoadCalculatorPage';
import { CableMCBSelectorV2 } from './components/ElectricalTools/CableMCBSelectorV2';
import DuctSizer from './components/hvac/DuctSizer';
import PipeSizer from './components/hvac/PipeSizer';
import EquipmentSelection from './components/hvac/EquipmentSelection';
import MaterialTakeoff from './components/hvac/MaterialTakeoff';
import UserManagement from './components/hvac/UserManagement';
import Methodology from './components/hvac/Methodology';
import UBuilder from './components/ubuilder/UBuilder';
import HvacSystems from './components/hvac/HvacSystems';
import UserManual from './components/hvac/UserManual';

type Page = 'dashboard' | 'auth' | 'calculator' | 'cable' | 'equipment' | 'takeoff' | 'ubuilder' | 'team' | 'duct' | 'pipe' | 'methodology' | 'systems' | 'manual';

async function syncUserProfile(user: User) {
  if (!user?.uid) return;

  const email = user.email?.toLowerCase().trim();
  const uidRef = doc(db, 'users', user.uid);

  try {
    const uidSnap = await getDoc(uidRef);
    if (uidSnap.exists()) {
      await setDoc(uidRef, {
        email: email ?? uidSnap.data()?.email,
        displayName: user.displayName ?? uidSnap.data()?.displayName ?? 'User',
        photoURL: user.photoURL ?? uidSnap.data()?.photoURL ?? '',
        lastLogin: serverTimestamp(),
      }, { merge: true });
      return;
    }

    let invitedRole = 'Pending';
    let invitedDisplayName = 'Invited User';
    let invitedCreatedAt: unknown = serverTimestamp();

    if (email) {
      const inviteSnap = await getDoc(doc(db, 'users', email));
      if (inviteSnap.exists()) {
        const inviteData = inviteSnap.data();
        invitedRole = (inviteData?.role as string | undefined) ?? 'Pending';
        invitedDisplayName = (inviteData?.displayName as string | undefined) ?? 'Invited User';
        invitedCreatedAt = inviteData?.createdAt ?? serverTimestamp();
      }
    }

    await setDoc(uidRef, {
      email: email ?? '',
      displayName: user.displayName ?? invitedDisplayName,
      photoURL: user.photoURL ?? '',
      role: invitedRole,
      isInvited: false,
      createdAt: invitedCreatedAt,
      lastLogin: serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    console.warn('[App] Failed to sync user profile:', error);
  }
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState<Page>('auth');
  const [pendingProjectId, setPendingProjectId] = useState<string | undefined>(undefined);
  const [pendingPage, setPendingPage] = useState<string | null>(null);

  // Persist activeProject across navigation so Equipment Selection always has context
  const [activeProject, setActiveProject] = useState<any>(() => {
    try {
      const stored = localStorage.getItem('activeProject');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const setAndPersistProject = (project: any) => {
    setActiveProject(project);
    try {
      if (project) localStorage.setItem('activeProject', JSON.stringify(project));
      else localStorage.removeItem('activeProject');
    } catch { /* ignore */ }
  };

  useEffect(() => {
    let unsubscribeAuth: (() => void) | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    try {
      timeout = setTimeout(() => setLoading(false), 3000);
      unsubscribeAuth = onAuthStateChanged(auth, (user) => {
        if (timeout) clearTimeout(timeout);
        if (user) {
          setCurrentUser(user);
          void (async () => {
            await syncUserProfile(user);
            setCurrentPage('dashboard');
            setLoading(false);
          })();
          return;
        }

        setCurrentUser(null);
        setUserRole(null);
        setLoading(false);
      });
    } catch (error) {
      console.warn('Firebase auth unavailable');
      setLoading(false);
    }

    return () => {
      if (timeout) clearTimeout(timeout);
      if (unsubscribeAuth) unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    if (!currentUser) { setUserRole(null); return; }

    const uidRef = doc(db, 'users', currentUser.uid);

    const resolveFromEmail = async () => {
      if (!currentUser.email) { setUserRole(null); return; }
      try {
        const snap = await getDoc(doc(db, 'users', currentUser.email.toLowerCase()));
        setUserRole((snap.data()?.role as string | undefined) ?? null);
      } catch { setUserRole(null); }
    };

    const unsub = onSnapshot(
      uidRef,
      (snap) => {
        if (snap.exists()) setUserRole((snap.data()?.role as string | undefined) ?? null);
        else void resolveFromEmail();
      },
      () => void resolveFromEmail(),
    );

    return () => unsub();
  }, [currentUser]);

  const handlePageChange = (page: string) => {
    if (currentPage === 'calculator' && page !== 'calculator') {
      setPendingPage(page);
    } else {
      setCurrentPage(page as Page);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-slate-900 to-teal-900">
        <div className="text-center">
          <div className="mb-4 flex justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-teal-800 border-t-teal-400" />
          </div>
          <p className="text-base font-semibold text-slate-300">Loading HVAC Load Master…</p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      {!currentUser ? (
        <AuthPage
          onAuthSuccess={() => setCurrentPage('dashboard')}
        />
      ) : (
        <AppLayout
          currentUser={currentUser}
          userRole={userRole}
          currentPage={currentPage}
          activeProject={activeProject}
          onLogout={() => {
            localStorage.removeItem('demo-user');
            localStorage.removeItem('demo-mode');
            localStorage.removeItem('activeProject');
            setCurrentUser(null);
            setCurrentPage('auth');
          }}
          onPageChange={handlePageChange}
        >
          {currentPage === 'dashboard' && (
            <Dashboard
              currentUser={currentUser}
              userRole={userRole}
              onProjectOpen={(project) => {
                setPendingProjectId(project.id);
                setAndPersistProject(project);
                setCurrentPage('calculator');
              }}
              onPageChange={handlePageChange}
            />
          )}
          {currentPage === 'calculator' && (
            <LoadCalculatorPage
              currentUser={currentUser}
              userRole={userRole}
              initialProjectId={pendingProjectId}
              pendingPageChange={pendingPage}
              onPageChangeResolved={(page) => {
                setPendingPage(null);
                if (page) setCurrentPage(page as Page);
              }}
              onProjectChange={(p) => setAndPersistProject(p)}
            />
          )}
          {currentPage === 'cable' && <CableMCBSelectorV2 />}
          {currentPage === 'duct' && <DuctSizer />}
          {currentPage === 'pipe' && <PipeSizer />}
          {currentPage === 'equipment' && (
            <EquipmentSelection
              project={activeProject}
              userProfile={{ uid: currentUser.uid, email: currentUser.email }}
              userRole={userRole}
              onProjectChange={setAndPersistProject}
            />
          )}
          {currentPage === 'takeoff' && <MaterialTakeoff />}
          {currentPage === 'ubuilder' && <UBuilder currentUser={currentUser} />}
          {currentPage === 'team' && <UserManagement currentUser={currentUser} />}
          {currentPage === 'methodology' && <Methodology userRole={userRole} />}
          {currentPage === 'manual' && <UserManual />}
          {currentPage === 'systems' && (
            <HvacSystems
              project={activeProject}
              userProfile={currentUser ? { uid: currentUser.uid, email: currentUser.email } : null}
              userRole={userRole}
              onProjectChange={setAndPersistProject}
            />
          )}
        </AppLayout>
      )}
      <Toaster />
    </ErrorBoundary>
  );
}
