# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start Vite dev server (port 3000)
npm run build      # Production bundle
npm run lint       # TypeScript type-check (tsc --noEmit) — run after every change
npm run preview    # Preview production build locally
```

After editing Firestore rules, deploy with:
```bash
npx firebase deploy --only firestore:rules
```

No automated test suite exists. Verify changes manually in the browser.

## Architecture

**HVAC Load Master** is an HVAC load calculation and equipment selection tool built on React + Firebase, following ASHRAE 2017 standards.

### Layer Map

```
src/pages/          → Page-level composition (Dashboard, LoadCalculatorPage, AuthPage)
src/components/     → Presentation layer (do not put calculation logic here)
  hvac/             → All HVAC UI components
  ui/               → shadcn/base-ui primitives — reuse before writing new controls
src/lib/hvac/       → Pure HVAC calculation functions (no React dependencies)
src/lib/electrical/ → Pure electrical calculation functions
src/services/       → Firebase read/write + domain services (PDF, Excel, reports)
src/lib/db/         → IndexedDB offline store + sync manager
src/lib/firebase.ts → Shared Firebase init, auth, error helpers
src/constants/      → Static equipment catalog (448 items), equipment type defs
src/types/          → Equipment system interfaces (IDUSelection, ODUSelection, etc.)
```

### Load Calculation Flow

`loadCalculationService.ts:calculateAndPersistRoom()` drives everything:

1. **Envelope** (`lib/hvac/envelope.ts`) — CLTD method per ASHRAE 2017 Ch.18: wall/roof/glass/partition gains, solar SHGF × SHGC for glass
2. **Internal gains** (`lib/hvac/internalGains.ts`) — people (sensible + latent by activity), lighting W/ft², equipment kW
3. **Ventilation load** (`lib/hvac/ventilation.ts`) — outdoor air conditioning based on ACH; ASHRAE 62.1 for distribution (`ventilation62.ts`)
4. **Parasitic gains** (`lib/hvac/parasitic.ts`) — duct and fan heat as percentage of ER sensible
5. **Safety factors** — applied to sensible, latent, and overall totals separately
6. **Psychrometrics** (`lib/hvac/psychrometrics.ts`) — RSHF → indicated ADP → selected ADP (min 44°F Chiller / 42°F VRF) → `minAdpSensibleCFM` at fixed system ADP → coil parameters
7. **CFM sizing** — `designSupplyCFM = max(minAdpSensibleCFM, totalACPH_CFM)`; `cfmTR = designSupplyCFM / 400` (Carrier 400 CFM/TR rule); `governingTR = max(loadTR, cfmTR)`
8. **Monsoon** — full recalculation at monsoon conditions; final TR = max(summer, monsoon)
9. **Persist** — results written to `projects/{id}/rooms/{roomId}` in Firestore

**Critical invariant:** Always use `minAdpSensibleCFM` (CFM at the fixed system design ADP) for the 400 CFM/TR checkpoint — never `sensibleCFM` (which uses the floating `indicatedADP` and inflates for high-sensible rooms). This was an intentional fix; do not revert it.

### Equipment Selection

`EquipmentSelection.tsx` is the main equipment UI (~2700 lines). It reads room load results (`_calcRequiredTR`, `designSupplyCFM`) and lets users assign VRF / Chiller / Package / DOAS systems. Equipment systems are stored in `projects/{id}/hvacSystems/{systemId}`.

The **Global Equipment Library** (`GlobalEquipmentLibrary.tsx` + `services/equipmentLibraryService.ts`) is a project-agnostic Firestore-backed catalog at collection `globalEquipmentLibrary`. It seeds from the static `EQUIPMENT_CATALOG` in `constants/equipment-catalog.ts`. The library has cascading filters (brand → type → sub-type → refrigerant) — filter option lists are derived from `useMemo` chains over upstream-filtered items, not from all items.

### Firestore Collections

| Collection | Purpose |
|---|---|
| `projects/{id}/rooms/{id}` | Room geometry, loads, calc results, envelope elements |
| `projects/{id}/hvacSystems/{id}` | Equipment system definitions (new unified path) |
| `projects/{id}/equipmentSystems/{id}` | Legacy VRF/Package system definitions |
| `projects/{id}/zones/{id}` | Design condition overrides per zone |
| `users/{uid}` | User profile + role |
| `globalEquipmentLibrary` | App-wide equipment catalog (project-agnostic) |
| `customEquipment` | Legacy user-added equipment (older library UI) |
| `customEquipmentCatalog` | Legacy equipment used by IDU/ODU picker dialogs |
| `u_assemblies` | User-defined U-value wall/roof assemblies |

### Firebase / Firestore Patterns

- Use `onSnapshot` for real-time listeners; always return the unsubscribe function for cleanup
- Use `handleFirestoreError(err, OperationType.X, 'collectionPath')` — never ad hoc `console.error`
- Batch writes (max 400 ops per batch, Firestore hard limit is 500) for bulk operations
- New Firestore collections require explicit rules in `firestore.rules` — no collection is open by default; missing rules = "permission denied"
- `orderBy` on multiple fields requires a composite index; prefer in-memory sort to avoid index creation

### Auth & Roles

Roles live in `users/{uid}.role`: `Super`, `Admin A` (Procurement), `Admin B` (HR), `Design Team`, `Accounts`, `Technician`, `Pending`. Super admin is additionally hardcoded to `pravat04@gmail.com` in `firestore.rules`. Most write operations require `isDesignTeam()` or higher.

### Offline-First

The app targets offline operation: `src/lib/db/` is the primary store (IndexedDB via Dexie), with Firestore as the sync target. When adding new data operations, save locally first then queue sync. See `OFFLINE_ARCHITECTURE.md` for the full model.

### Key Constraints

- Do **not** modify the HMR / COOP headers in `vite.config.ts` — required for Firebase Auth popup and AI Studio
- Do **not** use `orderBy` across multiple Firestore fields without creating a composite index first (or sort in JS instead)
- `GEMINI_API_KEY` must be set in `.env.local` for AI features
- Prefer extending `src/lib/hvac/` modules over adding logic to the legacy `src/lib/hvac-logic.ts`
