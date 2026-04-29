# HVAC Load Master - Offline-First Architecture Guide

## Overview

This application is designed for **site/field deployment in areas with unreliable or no internet connectivity**. The architecture uses a **local-first, cloud-optional** approach where:

1. **All data is stored locally** in IndexedDB (50+ MB per device)
2. **All technical standards are embedded** (ASHRAE, NEC, IEC, BS 7909)
3. **Cloud sync is optional** - data syncs when internet becomes available
4. **Calculations work offline** - no API calls required for engineering logic

## Architecture Components

### 1. Local Database Layer (`src/lib/db/index.ts`)

**Purpose**: Abstract IndexedDB complexity into a simple async API

**Object Stores**:
- `projects` - Top-level project records (name, location, date, status)
- `zones` - Building zones within projects (name, description, design conditions)
- `rooms` - Individual rooms within zones (dimensions, occupancy, equipment)
- `calculations` - Load calculation results with full metadata
- `technicalData` - Embedded standards and reference data (ASHRAE, NEC, IEC)
- `syncStatus` - Tracking of what needs syncing to cloud

**Key Methods**:
```typescript
// Projects
saveProject(project: Project) → Promise<string>  // Returns project ID
getProject(id: string) → Promise<Project | null>
getAllProjects() → Promise<Project[]>
deleteProject(id: string) → Promise<void>

// Rooms
saveRoom(room: Room) → Promise<string>
getRoomsByZone(zoneId: string) → Promise<Room[]>

// Calculations
saveCalculation(calc: Calculation) → Promise<string>
getCalculationsByProject(projectId: string) → Promise<Calculation[]>

// Technical Data
saveTechnicalData(key: string, data: any) → Promise<void>
getTechnicalData(key: string) → Promise<any>

// Sync Status
saveSyncStatus(item: SyncQueueItem) → Promise<void>
getSyncStatus(id: string) → Promise<SyncQueueItem | null>
getPendingSyncItems() → Promise<SyncQueueItem[]>

// Lifecycle
clear() → Promise<void>  // Wipe all local data
```

**Usage Example**:
```typescript
import { getLocalDatabase } from '@/lib/db';

const db = getLocalDatabase();

// Save a project locally
const projectId = await db.saveProject({
  id:,
  name: 'Hospital Wing Expansion',
  location: 'Denver, CO',
  createdAt: new Date(),
  updatedAt: new Date(),
});

// Load it back
const project = await db.getProject(projectId);
```

### 2. Embedded Technical Standards (`src/lib/data/embedded-standards.ts`)

**Purpose**: All design constants bundled in code - no API calls needed

**Embedded Standards**:

#### ASHRAE 2017 Fundamentals (`ASHRAE_STANDARDS`)
- **Summer Design Conditions** (99th percentile):
  - Dry bulb, wet bulb, humidity ratio by location type
  - Solar altitude angles for 12 directions
  - Clear sky radiation model constants
  
- **Convection Coefficients**:
  - Interior surfaces (walls, ceiling, floor)
  - Exterior surfaces (wind speed dependent)
  - Duct/pipe internal/external
  
- **Internal Design Loads**:
  - People sensible/latent gains (75-100 BTU/hr)
  - Lighting power density (0.5-3 W/ft²)
  - Equipment load multipliers by room type
  - Ventilation rates (0.15-0.3 CFM/ft² or 15 CFM/person)

#### Solar Data (`SOLAR_DATA`)
- **Clear Sky Peak Radiation** (BTU/hr·ft²):
  - By orientation: North, NE, East, SE, South, SW, West, NW, Horizontal
  - Peak solar intensity: ~250-400 BTU/hr·ft² depending on latitude
  - Time of peak: typically 2 PM Standard Time
  
- **Solar Heat Gain Coefficients** by glass type:
  - Single pane: 0.78-0.88
  - Double Low-E: 0.25-0.35
  - Tinted: 0.40-0.60

#### Duct Sizing Standards (`DUCT_STANDARDS`)
- **Equivalent Lengths** for friction loss (at design velocity):
  - 90° elbow: 15 ft equivalent
  - 45° elbow: 8 ft equivalent
  - 90° tee (cross): 25 ft equivalent
  - Transitions, dampers, etc.
  
- **Velocity Limits** (ft/min):
  - Supply main: 500-800 fpm
  - Branch supply: 400-600 fpm
  - Return: 300-500 fpm
  - Critical for noise/energy efficiency

#### Psychrometric Constants (`PSYCHROMETRIC_CONSTANTS`)
- Gas properties for humid air calculations
- Altitude correction factors (in Pa): -11.6 Pa/meter
- Latent heat of vaporization: ~1050 BTU/lbm
- Dry bulb heat capacity: 0.24 BTU/lbm·°F
- Humidity ratio equations and coefficients

#### Electrical Standards (`NEC_STANDARDS`, `IEC_STANDARDS`)

**NEC 2023** (US):
- Voltage drop limits:
  - Feeder (source to panel): 3% max
  - Branch circuit: 2.5% max
  - Combined: 5% max
  
- Overcurrent protection ratios:
  - Motors: 125-175% of nameplate FLA
  - Heaters: 125% of nameplate
  - General load: 100-125% available capacity

**IEC 60364** (International):
- Cable derating factors:
  - Temperature: -5% per 10°C above reference
  - Grouping: 1.0 (single) → 0.45 (10+ bundles)
  - Installation method multipliers
  
- Voltage drop: 3-5% depending on circuit type

#### BS 7909 (Temporary Systems)
- Used for construction site power, rental equipment
- Higher safety factors than permanent installations
- 3-phase temporary: 50A, 63A, 125A typical amperes

#### Equipment Sizing (`EQUIPMENT_STANDARDS`)
- **Chiller**: 1.15× peak sensible + latent loads
- **Boiler/Heater**: 1.20× peak heating load
- **Cooling Tower**: 1.15× condenser water load
- **Pump**: 1.10× design flow

#### System Defaults (`SYSTEM_DEFAULTS`)
- **Summer Design**: 95°F / 50% RH (exterior), 75°F / 50% RH (interior)
- **Winter Design**: 20°F / 30% RH (exterior), 72°F / 30% RH (interior)
- **Indoor Winter Humidity**: 30% minimum (comfort/health)
- **Ventilation Minimum**: 0.2 CFM/ft² (office), 15 CFM/person
- **Occupancy Density**: 100-400 ft²/person depending on space type

### 3. Sync Manager (`src/lib/db/sync-manager.ts`)

**Purpose**: Manage offline/online transitions with queued sync strategy

**Sync Queue Item**:
```typescript
interface SyncQueueItem {
  id: string;                    // Unique ID
  entityType: 'project' | 'zone' | 'room' | 'calculation';
  action: 'create' | 'update' | 'delete';
  data: any;                     // The actual data to sync
  timestamp: number;             // When this change occurred
  retries: number;               // Retry counter (0-3)
  lastError?: string;            // Last sync error message
}
```

**Key Methods**:

```typescript
// Queue a change for eventual sync
queueChange(item: SyncQueueItem) → Promise<void>

// Sync all pending items (called when online)
syncAll() → Promise<void>
  // Retries up to 3 times per item
  // Uses last-write-wins conflict resolution
  // Removes successful items from queue

// Sync a single item  
syncItem(item: SyncQueueItem) → Promise<void>
  // Connects to Firebase (currently mocked)
  // Updates sync status

// Pull from cloud
pullFromCloud() → Promise<void>
  // Fetch from Firebase
  // Merge with local using timestamp comparison

// Get current sync status
getStatus() → Promise<SyncStatus>
  // Returns: { isOnline, isSyncing, pendingCount, pendingItems }

// Listen for status changes
onStatusChange(callback: (status: SyncStatus) => void) → void
```

**Sync Behavior**:

1. **When offline**: Changes queue locally, no sync attempt
2. **When online**: Automatically retries queued changes (3 attempts max)
3. **Conflict resolution**: Timestamp comparison (last write wins)
4. **Error recovery**: Exponential backoff, user notification on persistent error

**Example**:
```typescript
const syncMgr = getSyncManager();

// Queue a project update
await syncMgr.queueChange({
  id: 'proj-123',
  entityType: 'project',
  action: 'update',
  data: projectData,
  timestamp: Date.now(),
  retries: 0,
});

// Manual sync (auto-triggered when online)
await syncMgr.syncAll();

// Check status
const status = await syncMgr.getStatus();
console.log(`${status.pendingCount} changes pending`);

// Listen for changes
syncMgr.onStatusChange((status) => {
  console.log(`Online: ${status.isOnline}, Syncing: ${status.isSyncing}`);
});
```

### 4. React Hooks (`src/lib/db/hooks.ts`)

**Purpose**: Bridge offline infrastructure to React components

**Hook 1: `useOfflineStatus()`**
- **Returns**: `{ isOnline, isSyncing, pendingCount, pendingItems }`
- **Usage**: Display offline indicator, show pending sync count
- **Updates**: Automatically re-renders on status change

```typescript
import { useOfflineStatus } from '@/lib/db/hooks';

function Dashboard() {
  const { isOnline, pendingCount } = useOfflineStatus();
  
  return (
    <>
      <h1>Dashboard</h1>
      {isOnline ? (
        <p>Online ✓</p>
      ) : (
        <p>Working offline • {pendingCount} changes pending</p>
      )}
    </>
  );
}
```

**Hook 2: `saveDataOfflineFirst()`**
- **Purpose**: Save data with automatic sync queueing
- **Input**: Data object, entity type, action
- **Behavior**: Saves to local DB first, queues for cloud sync

```typescript
import { saveDataOfflineFirst } from '@/lib/db/hooks';

async function saveProject(projectData) {
  const projectId = await saveDataOfflineFirst(
    projectData,
    'project',
    'create'
  );
  console.log('Saved locally, will sync when online');
}
```

**Hook 3: `loadDataOfflineSafe()`**
- **Purpose**: Load data with cloud fallback
- **Behavior**: 
  - If online: Try cloud first, fall back to local
  - If offline: Use local only
- **Returns**: Data object or null if not found

```typescript
import { loadDataOfflineSafe } from '@/lib/db/hooks';

async function loadProject(projectId) {
  const project = await loadDataOfflineSafe(
    { loadType: 'project', id: projectId },
    'projects'
  );
  if (!project) {
    console.log('Project not found locally or in cloud');
  }
}
```

---

## Implementation Steps

### Step 1: Initialize Embedded Data on App Startup

Add to `App.tsx`:
```typescript
import { useEffect } from 'react';
import { initializeEmbeddedData } from '@/lib/data/embedded-standards';
import { getSyncManager } from '@/lib/db/sync-manager';

export default function App() {
  useEffect(() => {
    // Initialize offline database with embedded standards
    initializeEmbeddedData().catch(err => {
      console.error('Failed to initialize offline DB:', err);
    });

    // Start sync manager
    getSyncManager().init();
  }, []);

  return (
    // ... rest of app
  );
}
```

### Step 2: Add Offline Status Indicator

In `AppLayout.tsx` header:
```typescript
import { OfflineStatusIndicator } from '@/components/OfflineStatusIndicator';

export function AppLayout() {
  return (
    <div className="border-b">
      <div className="flex justify-between items-center p-4">
        <h1>HVAC Load Master</h1>
        <OfflineStatusIndicator />
      </div>
    </div>
  );
}
```

### Step 3: Use Offline Hooks in Components

In `Dashboard.tsx`:
```typescript
import { saveDataOfflineFirst, loadDataOfflineSafe } from '@/lib/db/hooks';

function Dashboard() {
  const handleSaveProject = async (projectData) => {
    const id = await saveDataOfflineFirst(projectData, 'project', 'create');
    // Auto-syncs when online
  };

  const handleLoadProjects = async () => {
    const projects = await loadDataOfflineSafe(
      { scope: 'all' },
      'projects'
    );
    return projects;
  };

  return (
    // ... component
  );
}
```

### Step 4: Connect Firebase Sync (Optional)

Replace mock in `SyncManager.syncItem()`:
```typescript
private async syncItem(item: SyncQueueItem): Promise<void> {
  try {
    // MOCK: Currently logs. Replace with actual Firebase:
    const result = await pushToFirebase(item);
    
    // On success:
    await this.db.getSyncStatus(item.id); // Already saved
  } catch (error) {
    // Retry logic already handled by caller
    throw error;
  }
}
```

---

## Field Deployment Considerations

### Desktop-First UI

The app is designed for **desktop/tablet field use** (Windows tablets common on construction sites):

- **Sidebar**: Collapsible for tablet orientation
- **Tables**: Horizontal scroll for large data sets
- **Touch-friendly**: Large buttons (min 44px)
- **Responsive**: Works on 7"+ tablets to 27"+ monitors

### Data Backup & Export

For critical projects, users should **regularly export data**:

```typescript
async function exportProjectData(projectId: string) {
  const project = await db.getProject(projectId);
  const zones = await db.getRoomsByZone(projectId);
  const calcs = await db.getCalculationsByProject(projectId);
  
  const backup = {
    project,
    zones,
    calcs,
    exportedAt: new Date().toISOString(),
  };
  
  // Download as JSON
  const blob = new Blob([JSON.stringify(backup, null, 2)]);
  const url = URL.createObjectURL(blob);
  // ... trigger download
}
```

### Offline Duration

The app supports:
- **Days/weeks offline** - All data stored locally, no cloud required
- **Eventual sync** - When internet returns, all changes sync to cloud
- **Multi-device** - Sync ensures consistency across devices

### Limitations

⚠️ **Currently offline-only (no real-time collab)**:
- Each device has its own copy
- Changes eventually sync (not instant)
- Last-write-wins conflict resolution (simpler than operational transforms)

Future enhancement: Operational Transform for real-time multi-user collaboration.

---

## Storage & Performance

### IndexedDB Storage

Per browser/domain:
- **Chrome/Edge**: 50MB+ (can request persistent storage)
- **Firefox**: 50MB+ 
- **Safari**: 50MB+

For 1000+ projects with full calculation history: **30-40 MB typical**

### Database Indexes

Create indexes on frequently accessed fields:
```typescript
// In LocalDatabase constructor:
projectStore.createIndex('location', 'location');
projectStore.createIndex('createdAt', 'createdAt');
roomStore.createIndex('zoneId', 'zoneId');
calculationStore.createIndex('projectId', 'projectId');
```

### Optimization Tips

1. **Archive old projects** to move out of active IndexedDB
2. **Batch load** - Load calculations on demand, not all at once
3. **Cache calculation results** - Don't recalculate on every load
4. **Cleanup sync queue** - Remove old successful items weekly

---

## Troubleshooting

### "IndexedDB not available"

Browser storage is disabled. Check:
- Private/incognito mode (many browsers disable local DB)
- Clear Sites Storage setting in browser
- Some corporate firewalls block local storage

**Fix**: Ask user to use normal browsing mode or different browser

### "Sync failed repeatedly"

Network issue or Firebase misconfiguration. Check:
- `console.log()` in SyncManager.syncItem()
- Verify Firebase credentials in `.env`
- Check Firebase network tab for 401/403 errors
- Inspect `pendingItems` in sync queue

**Fix**: Clear browser cookies, log out/back in, or factory reset app

### "Data missing after offline session"

IndexedDB cleared (browser cache clear, private mode, etc.).

**Prevention**:
- Periodically export projects
- Warn users before clearing browser data
- Consider Service Worker with Cache API backup

---

## Future Enhancements

1. **Service Worker** - Advanced caching, background sync, offline app shell
2. **Database Migrations** - Version embedded standards, auto-update design constants
3. **Peer Sync** - Share calculations via QR code or Bluetooth on site
4. **Operational Transform** - Real-time multi-user editing (complex, not MVP)
5. **Full-Text Search** - Index all project data for quick lookup
6. **Data Compression** - Store more data in same 50 MB limit
7. **Analytics** - Track offline usage patterns for improvements

---

## Reference Documentation

- **IndexedDB API**: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- **ASHRAE 2017 Fundamentals**: Chapter 6, 18, 21-22
- **NEC 2023**: Articles 210, 430, 600
- **IEC 60364**: Parts 5, 8
- **React Hooks**: https://react.dev/reference/react/hooks

---

**Version**: 1.0  
**Last Updated**: 2024  
**Embedded Standards**: ASHRAE 2017, NEC 2023, IEC 60364, BS 7909
