# HVAC Load Master — Migration & Completion Plan
## For Claude Code — Read this first, then execute in order

---

## Context (read carefully before touching any file)

This is a React + Firebase Firestore app built by a non-coder using Claude.
- **Live projects exist in Firestore. Never delete any document.**
- The user has no coding experience — all changes must be made by Claude directly.
- A full Firestore backup exists at `backups/backup-2026-05-01-14-35-50.json` (950 KB, all 12 projects).

### What this app does
HVAC load calculation + equipment selection tool for HVAC engineers.
- **Load Calculator** — room-by-room heat gain/loss calculations
- **Equipment Selection** — assign HVAC equipment (VRF, AHU, Chiller, Package, Split) to rooms

### Current problem being solved
Firestore stores rooms in 3 different paths depending on `project.systemType`:
- VRF:     `projects/{id}/systems/{sysId}/rooms/{roomId}`
- Hybrid:  `projects/{id}/systems/{sysId}/zones/{zoneId}/rooms/{roomId}`
- Others:  `projects/{id}/zones/{zoneId}/rooms/{roomId}`

This makes every component that reads rooms complicated and fragile.

### Target: flat room storage
**New path for ALL project types:** `projects/{id}/rooms/{roomId}`

Zone/System becomes a field on the room document, not a subcollection path.

---

## Current State (as of 2026-05-01)

### ✅ Already done — do NOT redo these
- `src/components/hvac/EquipmentSelection.tsx` — fully built with:
  - VRF IDU/ODU selection, Package/AHU/Chiller/Split unit selection
  - Quantity support (multi-IDU rooms like banquet halls)
  - Diversity factor calculation
  - System category guidance with guided setup
  - Project switcher dropdown (reads all user projects)
  - Room loading handles all 3 path variants (temporary fix, will be simplified after migration)
- `src/App.tsx` — activeProject syncs across pages, passed to AppLayout
- `src/pages/LoadCalculatorPage.tsx` — onProjectChange callback added
- `src/components/AppLayout.tsx` — receives activeProject (sidebar shows active project)
- `scripts/backup-firestore.ts` — backup script, run with `npm run backup`
- `.gitignore` — backups/ and service-account.json excluded

### ⏳ Not yet done — execute these in order below

---

## PHASE 1 — Run a fresh backup before starting
```
npm run backup
```
Verify output shows all projects before touching any code.

---

## PHASE 2 — Migration script (write + run)

Create `scripts/migrate-to-flat-rooms.ts`.

This script must:
1. Read ALL rooms from all 3 path variants for every project
2. Write each room to `projects/{id}/rooms/{roomId}` — adding `zoneId`, `zoneName` fields
3. NEVER delete or overwrite the original documents
4. Print progress and a summary

### Room document fields to preserve (all existing fields +):
```typescript
{
  // NEW fields added during migration
  zoneId: string,        // original zone or system ID (for grouping display)
  zoneName: string,      // human-readable zone/system name
  _sourcePath: string,   // e.g. "systems/sys1/rooms" — for audit trail

  // ALL existing fields preserved exactly as-is:
  name: string,
  width: number, length: number, height: number,
  occupants: number, lighting: number, equipment: number,
  // ... all calc fields, envelope elements reference, etc.
  _calcRequiredTR: number,
  _calcDesignCFM: number,
  _calcGoverningTR: number,
  // etc.
}
```

### Migration logic:
```typescript
for each project in projects/:
  systemType = project.systemType
  
  if systemType === 'VRF':
    for each system in projects/{id}/systems/:
      for each room in projects/{id}/systems/{sysId}/rooms/:
        write to projects/{id}/rooms/{roomId} with:
          zoneId = sysId
          zoneName = system.name
          _sourcePath = `systems/${sysId}/rooms`
          
  else if systemType === 'Hybrid':
    // direct zones
    for each zone in projects/{id}/zones/:
      for each room in projects/{id}/zones/{zoneId}/rooms/:
        write to projects/{id}/rooms/{roomId} with:
          zoneId = zoneId
          zoneName = zone.name
          _sourcePath = `zones/${zoneId}/rooms`
    // system zones
    for each system in projects/{id}/systems/:
      for each zone in projects/{id}/systems/{sysId}/zones/:
        for each room in that zone:
          write to projects/{id}/rooms/{roomId} with:
            zoneId = zoneId
            zoneName = zone.name
            _sourcePath = `systems/${sysId}/zones/${zoneId}/rooms`
            
  else: // CAC, Package, DuctableSplit, AHU, Chiller, Split
    for each zone in projects/{id}/zones/:
      for each room in projects/{id}/zones/{zoneId}/rooms/:
        write to projects/{id}/rooms/{roomId} with:
          zoneId = zoneId
          zoneName = zone.name
          _sourcePath = `zones/${zoneId}/rooms`

// Envelope elements: copy from old path to new:
// projects/{id}/rooms/{roomId}/envelopeElements/{elemId}
```

Add migration script to package.json:
```json
"migrate": "npx tsx scripts/migrate-to-flat-rooms.ts"
```

Run: `npm run migrate`
Verify: open Firebase Console, check a project's `rooms/` subcollection has data.

---

## PHASE 3 — Update LoadCalculator.tsx

**File:** `src/components/hvac/LoadCalculator.tsx`

### Change 1: `getRoomRef` function (around line 226)
OLD (conditional paths):
```typescript
const getRoomRef = (zoneId: string, roomId: string, systemId?: string) => {
  if (isVRF && systemId) {
    return doc(db, 'projects', project.id, 'systems', systemId, 'rooms', roomId);
  }
  return systemId
    ? doc(db, 'projects', project.id, 'systems', systemId, 'zones', zoneId, 'rooms', roomId)
    : doc(db, 'projects', project.id, 'zones', zoneId, 'rooms', roomId);
};
```
NEW (single path):
```typescript
const getRoomRef = (_zoneId: string, roomId: string, _systemId?: string) => {
  return doc(db, 'projects', project.id, 'rooms', roomId);
};
```

### Change 2: Data loading (around line 764)
The large block that conditionally reads from `systems/` or `zones/` subcollections
needs to be replaced with a single flat read:
```typescript
const roomsSnap = await getDocs(collection(db, 'projects', project.id, 'rooms'));
const rList = roomsSnap.docs.map(d => normalizeRoom({ id: d.id, ...d.data() }));
// Group by zoneId field for existing zone-based display
const allRooms: Record<string, Room[]> = {};
for (const room of rList) {
  const key = room.zoneId ?? 'default';
  if (!allRooms[key]) allRooms[key] = [];
  allRooms[key].push(room);
}
```

### Change 3: Zone loading
Zones are now derived from unique `zoneId` values on rooms, not from subcollections.
Build zone list from the room data instead of querying `zones/` subcollection.

### Change 4: Room write (save/update operations)
Any `updateDoc` or `setDoc` that uses the old path should use:
```typescript
doc(db, 'projects', project.id, 'rooms', roomId)
```

### Change 5: Inside conditions per room
Add optional per-room override fields:
- `insideSummerTempOverride?: number`
- `insideSummerRHOverride?: number`
- `insideWinterTempOverride?: number`
- `insideWinterRHOverride?: number`

In the calculation, if room has override use it, else use project default.
This replaces zone-level inside conditions with room-level control.

---

## PHASE 4 — Update ZoneList.tsx and RoomTable.tsx

These components display rooms grouped by zone. After migration, zones are
derived from the `zoneId` field on each room — NOT from a Firestore subcollection.

### ZoneList.tsx
- Remove `onSnapshot(collection(db, ..., 'zones'), ...)` listener
- Derive zones from `Object.groupBy(rooms, r => r.zoneId)` or equivalent
- Zone name comes from room's `zoneName` field
- Adding a new zone = creating a room with a new `zoneId` string
- These files should NOT need major structural changes — mostly the data source changes

### RoomTable.tsx
- Room reads/writes now use flat `projects/{id}/rooms/{roomId}` path
- All existing room fields, calculations, UI — unchanged

---

## PHASE 5 — Simplify EquipmentSelection.tsx room loader

**File:** `src/components/hvac/EquipmentSelection.tsx`

Replace the current 80-line conditional room loader (handles 3 path variants)
with a single flat listener:

```typescript
useEffect(() => {
  if (!project?.id) return;
  const unsub = onSnapshot(
    collection(db, 'projects', project.id, 'rooms'),
    snap => {
      setRooms(snap.docs.map(d => ({
        id: d.id,
        zoneId: d.data().zoneId ?? 'default',
        zoneName: d.data().zoneName ?? 'Zone',
        ...d.data(),
      })));
    },
  );
  return () => unsub();
}, [project?.id]);
```

This replaces approximately lines 563–645 in the current file.

---

## PHASE 6 — Run TypeScript check + test

```
npx tsc --noEmit
```

Must pass with zero errors before considering done.

Then test in browser:
1. Open each project type (VRF, Chiller, Package) in Load Calculator
2. Verify rooms show correctly grouped by zone
3. Open Equipment Selection — verify rooms appear for each project
4. Assign a room to a system, select an IDU — verify it saves
5. Check that load calculations still work (TR values show correctly)

---

## PHASE 7 (Future, separate session) — Zone Analysis in Equipment Selection

Once the flat room structure is working, Equipment Selection can add:
- Per-system psychrometric analysis (supply air conditions, coil selection)
- AHU sizing (coil TR, latent/sensible split, bypass factor)
- Per-room inside condition overrides in the room assignment panel

This is a new feature addition, not a migration concern.

---

## Important Notes for Executing Claude

1. **Run `npm run backup` first** — always before touching any code
2. **Never delete Firestore documents** — migration only ADDS new documents
3. **Old paths stay intact** until the user explicitly decides to clean them up
4. **Run `npx tsc --noEmit` after every file change** — catch errors immediately
5. **Test in browser after each phase** — don't batch all phases then test once
6. The user has no coding experience — explain what each step does in plain language
7. LoadCalculator.tsx is a large, complex file — read it fully before editing
8. Use parallel agents for Phases 3+4+5 (independent files, safe to parallelize)

---

## File Reference

| File | Purpose | Phase |
|---|---|---|
| `scripts/backup-firestore.ts` | Backup script | Done ✅ |
| `scripts/migrate-to-flat-rooms.ts` | Migration script | Phase 2 |
| `src/components/hvac/LoadCalculator.tsx` | Main calc engine | Phase 3 |
| `src/components/hvac/ZoneList.tsx` | Zone display | Phase 4 |
| `src/components/hvac/RoomTable.tsx` | Room display/edit | Phase 4 |
| `src/components/hvac/EquipmentSelection.tsx` | Equipment assignment | Phase 5 |
| `src/App.tsx` | Already updated ✅ | Done |
| `src/pages/LoadCalculatorPage.tsx` | Already updated ✅ | Done |
| `src/types/equipment-systems.ts` | Already updated ✅ | Done |

---

*Plan written: 2026-05-01. Backup taken same day (950 KB, 12 projects, all rooms safe).*
