/**
 * OFFLINE-FIRST CODE MIGRATION EXAMPLES
 * 
 * Before/After examples showing how to update existing
 * Firebase-dependent code to use offline-first patterns
 */

// ============================================================================
// EXAMPLE 1: Saving a Project
// ============================================================================

// ❌ BEFORE: Cloud-first (requires internet)
async function saveProjectCloudFirst(projectData: Project) {
  try {
    const projectRef = doc(db, 'projects', projectData.id || '');
    const docId = await setDoc(projectRef, {
      ...projectData,
      updatedAt: serverTimestamp(),
    });
    toast.success('Project saved');
    return projectData.id;
  } catch (error) {
    toast.error('Failed to save: ' + error.message);
    throw error;
  }
}

// ✅ AFTER: Offline-first (works immediately, syncs later)
import { saveDataOfflineFirst } from '@/lib/db/hooks';

async function saveProjectOfflineFirst(projectData: Project) {
  try {
    const projectId = await saveDataOfflineFirst(
      projectData,
      'project',
      projectData.id ? 'update' : 'create'
    );
    toast.success('Project saved locally');
    
    // Data automatically queued for cloud sync when online
    console.log('Will sync to cloud when connection restored');
    
    return projectId;
  } catch (error) {
    toast.error('Failed to save locally: ' + error.message);
    throw error;
  }
}

// ============================================================================
// EXAMPLE 2: Loading All Projects
// ============================================================================

// ❌ BEFORE: Cloud-first with loading state
import { collection, getDocs, query, where } from 'firebase/firestore';

function ProjectList({ userId }: { userId: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadProjects = async () => {
      try {
        setLoading(true);
        const q = query(
          collection(db, 'projects'),
          where('userId', '==', userId)
        );
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as Project[];
        setProjects(data);
        setError(null);
      } catch (err) {
        setError('Failed to load projects: ' + err.message);
        setProjects([]);
      } finally {
        setLoading(false);
      }
    };

    loadProjects();
  }, [userId]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div className="text-red-600">{error}</div>;
  if (projects.length === 0) return <div>No projects yet</div>;

  return (
    <div>
      {projects.map(p => (
        <ProjectCard key={p.id} project={p} />
      ))}
    </div>
  );
}

// ✅ AFTER: Offline-first with fallback
import { loadDataOfflineSafe, useOfflineStatus } from '@/lib/db/hooks';

function ProjectList({ userId }: { userId: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const { isOnline } = useOfflineStatus();

  useEffect(() => {
    const loadProjects = async () => {
      try {
        setLoading(true);
        
        // Load from local DB first, fetch from cloud if online
        const data = await loadDataOfflineSafe(
          { 
            userId,
            scope: 'userProjects',
          },
          'projects'
        );
        
        setProjects(data || []);
      } catch (err) {
        console.error('Failed to load projects:', err);
        setProjects([]); // Fail gracefully, show empty
      } finally {
        setLoading(false);
      }
    };

    loadProjects();
  }, [userId]);

  // Much simpler error handling
  if (loading) return <div>Loading...</div>;
  if (projects.length === 0) {
    return (
      <div>
        No projects yet
        {!isOnline && ' (offline - no sync available)'}
      </div>
    );
  }

  return (
    <div>
      {projects.map(p => (
        <ProjectCard key={p.id} project={p} />
      ))}
    </div>
  );
}

// ============================================================================
// EXAMPLE 3: Real-time Updates with Sync Status
// ============================================================================

// ❌ BEFORE: Real-time listener (requires internet)
import { onSnapshot } from 'firebase/firestore';

function ProjectDetails({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [synced, setSynced] = useState(true);

  useEffect(() => {
    const projectRef = doc(db, 'projects', projectId);
    
    const unsubscribe = onSnapshot(projectRef, (snapshot) => {
      if (snapshot.exists()) {
        setProject(snapshot.data() as Project);
        setSynced(true);
      }
    }, (error) => {
      console.error('Listener error:', error);
      setSynced(false); // Lost connection
    });

    return () => unsubscribe();
  }, [projectId]);

  return (
    <div>
      {project && (
        <>
          <h2>{project.name}</h2>
          <p>{synced ? '✓ Synced' : '⚠ Out of sync'}</p>
        </>
      )}
    </div>
  );
}

// ✅ AFTER: Local-first with offline status
import { useOfflineStatus } from '@/lib/db/hooks';
import { getLocalDatabase } from '@/lib/db';

function ProjectDetails({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const { isOnline, isSyncing, pendingCount } = useOfflineStatus();

  useEffect(() => {
    const loadProject = async () => {
      const db = getLocalDatabase();
      const data = await db.getProject(projectId);
      setProject(data);
      
      // If online, reload from cloud
      if (isOnline) {
        // Cloud fetch here (optional enhancement)
      }
    };

    loadProject();
  }, [projectId, isOnline]);

  return (
    <div>
      {project && (
        <>
          <h2>{project.name}</h2>
          {isOnline && !isSyncing ? (
            <p className="text-green-600">✓ Synced</p>
          ) : !isOnline ? (
            <p className="text-amber-600">
              ⚠ Offline • {pendingCount} pending changes
            </p>
          ) : (
            <p className="text-blue-600">↻ Syncing...</p>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// EXAMPLE 4: Form Save with Offline Queue
// ============================================================================

// ❌ BEFORE: Simple try/catch with cloud sync
function ProjectForm({ projectId }: { projectId?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (formData: Project) => {
    try {
      setLoading(true);
      setError(null);
      
      const ref = doc(db, 'projects', projectId || '');
      await setDoc(ref, formData);
      
      toast.success('Project saved');
      // Redirect etc.
    } catch (err) {
      setError('Save failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form>
      {error && <div className="text-red-600">{error}</div>}
      <input type="text" placeholder="Project name" />
      <button disabled={loading}>
        {loading ? 'Saving...' : 'Save'}
      </button>
    </form>
  );
}

// ✅ AFTER: Offline-first with sync feedback
import { saveDataOfflineFirst, useOfflineStatus } from '@/lib/db/hooks';

function ProjectForm({ projectId }: { projectId?: string }) {
  const [loading, setLoading] = useState(false);
  const { isOnline, pendingCount } = useOfflineStatus();

  const handleSubmit = async (formData: Project) => {
    try {
      setLoading(true);
      
      // Always saves locally first
      const id = await saveDataOfflineFirst(
        { id: projectId, ...formData },
        'project',
        projectId ? 'update' : 'create'
      );
      
      // Provide immediate feedback
      if (isOnline) {
        toast.success('Project saved and syncing...');
      } else {
        toast.success('Project saved locally (will sync when online)');
      }
      
      // Can redirect immediately - data persists locally
      // Navigation/redirect here
    } catch (err) {
      toast.error('Failed to save: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form>
      <input type="text" placeholder="Project name" />
      <button disabled={loading}>
        {loading ? 'Saving...' : 'Save'}
      </button>
      {!isOnline && (
        <p className="text-xs text-amber-600">
          Working offline • {pendingCount} changes pending
        </p>
      )}
    </form>
  );
}

// ============================================================================
// EXAMPLE 5: Calculation Results Persistence
// ============================================================================

// ❌ BEFORE: Only cloud storage
import { addDoc, collection } from 'firebase/firestore';

function LoadCalculator({ projectId, roomId }: CalculatorProps) {
  const handleCalculate = async (inputs: CalculationInputs) => {
    const result = computeLoad(inputs);
    
    try {
      const docRef = await addDoc(
        collection(db, 'calculations'),
        {
          projectId,
          roomId,
          result,
          timestamp: serverTimestamp(),
          inputs,
        }
      );
      toast.success('Calculation saved');
      return docRef.id;
    } catch (err) {
      toast.error('Failed to save calculation');
      // User loses their calculation if offline!
      throw err;
    }
  };

  return <LoadCalculatorUI onCalculate={handleCalculate} />;
}

// ✅ AFTER: Local persistence with cloud sync
import { saveDataOfflineFirst } from '@/lib/db/hooks';

function LoadCalculator({ projectId, roomId }: CalculatorProps) {
  const [calculations, setCalculations] = useState<Calculation[]>([]);
  const { isOnline } = useOfflineStatus();

  const handleCalculate = async (inputs: CalculationInputs) => {
    const result = computeLoad(inputs);
    
    const calculation: Calculation = {
      id: crypto.randomUUID(),
      projectId,
      roomId,
      result,
      timestamp: Date.now(),
      inputs,
    };
    
    try {
      // Always saves locally first
      const id = await saveDataOfflineFirst(
        calculation,
        'calculation',
        'create'
      );
      
      // Add to local UI immediately
      setCalculations([...calculations, { ...calculation, id }]);
      
      // Feedback depends on connection
      if (isOnline) {
        toast.success('Calculation saved and syncing...');
      } else {
        toast.success('Calculation saved (will sync when online)');
      }
      
      return id;
    } catch (err) {
      toast.error('Failed to save calculation');
      // Calculation preserved in IndexedDB even if error
      throw err;
    }
  };

  return (
    <>
      <LoadCalculatorUI onCalculate={handleCalculate} />
      <div>
        {calculations.map(calc => (
          <CalculationResult 
            key={calc.id} 
            calculation={calc}
            synced={isOnline}
          />
        ))}
      </div>
    </>
  );
}

// ============================================================================
// EXAMPLE 6: Batch Operations
// ============================================================================

// ❌ BEFORE: Try to save multiple items (risky if any fails)
async function importProjects(projects: Project[]) {
  for (const project of projects) {
    const docRef = doc(db, 'projects', project.id || '');
    await setDoc(docRef, project); // Fails mid-import if network drops
  }
}

// ✅ AFTER: Local batch with queued sync
import { saveDataOfflineFirst } from '@/lib/db/hooks';

async function importProjects(projects: Project[]) {
  const results: { id: string; error?: string }[] = [];

  for (const project of projects) {
    try {
      const id = await saveDataOfflineFirst(
        project,
        'project',
        'create'
      );
      results.push({ id });
    } catch (err) {
      results.push({ 
        id: project.id || 'unknown',
        error: err.message 
      });
    }
  }
  
  // All saved to local DB, will sync when online
  // Even if some had issues, data persists
  return results;
}

// ============================================================================
// CHEAT SHEET - Quick Reference
// ============================================================================

/*
PATTERN: Save data
```typescript
const id = await saveDataOfflineFirst(data, 'project', 'create');
```

PATTERN: Load data
```typescript
const data = await loadDataOfflineSafe({ userId }, 'projects');
```

PATTERN: Check offline status
```typescript
const { isOnline, pendingCount } = useOfflineStatus();
if (!isOnline) { /* show offline indicator */ }
```

PATTERN: Show sync status
```typescript
{isOnline ? '✓ Synced' : `⚠ ${pendingCount} pending`}
```

PATTERN: Handle forms
```typescript
onSubmit: async (data) => {
  await saveDataOfflineFirst(data, entityType, 'create');
  toast.success('Saved locally' + (isOnline ? ' and syncing' : ''));
}
```

KEY DIFFERENCES:
- Cloud-first: Internet required, failures = lost data
- Offline-first: Always saves locally, syncs when possible
- Cloud-first: Real-time updates via listeners
- Offline-first: Eventual consistency, manual refresh if needed
- Cloud-first: Less code, less reliability
- Offline-first: More robust, works on sites with poor internet
*/

// MIGRATION EFFORT ESTIMATE:
//
// Component counts: ~20 components likely affected
// Per component: 15-30 minutes to update
// Total estimate: 5-10 hours for full migration
// 
// Priority order:
// 1. Dashboard (project list/save) - 1 hour
// 2. LoadCalculator - 45 min
// 3. ProjectForm - 45 min
// 4. Other calculation components - 2 hours
// 5. Settings/management pages - 2 hours
// 6. Confirmation dialogs/status - 1 hour
// 7. Testing & refinement - 2 hours
//
// Recommended: 1-2 hours per day, complete in 3-5 days
