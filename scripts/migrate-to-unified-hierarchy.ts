/**
 * Migration — Unified HVAC Hierarchy  (Phase 1)
 * ──────────────────────────────────────────────────────────────────────────────
 * SAFE  : Additive only. Never deletes or modifies existing collections.
 * IDEMPOTENT : Can be re-run — skips docs that were already migrated.
 *
 * What it does (per project):
 *
 *  Step 1 — Copy each /equipmentSystems/{id} doc to /hvacSystems/{id},
 *            preserving all existing fields + adding migration markers.
 *
 *  Step 2 — For each equipment system, create zone docs at
 *            /hvacSystems/{sysId}/zones/{zoneId}.
 *            Zone IDs are preserved verbatim from the embedded zones[] array.
 *            If a system has no zones[], a single default zone is created.
 *            Design-condition overrides are merged in from the legacy /zones
 *            collection where the IDs match.
 *
 *  Step 3 — For each room, stamp hvacSystemId + hvacZoneId by looking up
 *            which zone the room belongs to (via zone.roomIds).
 *            Falls back to ahuGroupId / default zone as needed.
 *            Rooms that have no equipment system assignment are skipped
 *            (they keep zoneId only; handled in Phase 2 UI).
 *
 * Usage:
 *   npm run migrate:unified                          (all projects)
 *   npm run migrate:unified -- --dry-run             (preview, no writes)
 *   npm run migrate:unified -- --project=<projectId> (single project)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin') as typeof import('firebase-admin');
import * as fs from 'fs';
import * as path from 'path';

// ── Init ──────────────────────────────────────────────────────────────────────

const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'service-account.json'), 'utf8'),
);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SINGLE_PROJECT = args.find(a => a.startsWith('--project='))?.split('=')[1];

// ── Counters ──────────────────────────────────────────────────────────────────

const counts = {
  projects: 0,
  systemsCreated: 0,
  systemsSkipped: 0,
  zonesCreated: 0,
  zonesSkipped: 0,
  roomsStamped: 0,
  roomsSkipped: 0,
  roomsNoSystem: 0,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const log  = (msg: string) => process.stdout.write(`  ${msg}\n`);
const info = (msg: string) => process.stdout.write(`    » ${msg}\n`);

async function writeOrDry(
  ref: FirebaseFirestore.DocumentReference,
  data: object,
  label: string,
) {
  if (DRY_RUN) {
    info(`[DRY] would write ${ref.path}`);
  } else {
    await ref.set(data, { merge: false });
  }
  log(label);
}

async function updateOrDry(
  ref: FirebaseFirestore.DocumentReference,
  data: object,
  label: string,
) {
  if (DRY_RUN) {
    info(`[DRY] would update ${ref.path}`);
  } else {
    await ref.update(data);
  }
  log(label);
}

// ── Per-project migration ─────────────────────────────────────────────────────

async function migrateProject(projectId: string) {
  log(`\n── Project: ${projectId}`);
  counts.projects++;

  // Load equipment systems
  const eqSnap = await db.collection(`projects/${projectId}/equipmentSystems`).get();
  if (eqSnap.empty) {
    info('No equipmentSystems — nothing to migrate');
    return;
  }

  // Load legacy LC zones (for design-condition overrides keyed by zone ID)
  const lcZoneSnap = await db.collection(`projects/${projectId}/zones`).get();
  const lcZoneMap: Record<string, FirebaseFirestore.DocumentData> = {};
  lcZoneSnap.docs.forEach(d => { lcZoneMap[d.id] = d.data(); });

  // Load all rooms
  const roomSnap = await db.collection(`projects/${projectId}/rooms`).get();
  const rooms = roomSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

  for (const eqDoc of eqSnap.docs) {
    const es = eqDoc.data() as any;
    const sysId = eqDoc.id;

    // ── Step 1: Create /hvacSystems/{sysId} ─────────────────────────────────
    const hvacSysRef = db.doc(`projects/${projectId}/hvacSystems/${sysId}`);
    const existingSys = await hvacSysRef.get();

    if (existingSys.exists) {
      info(`hvacSystems/${sysId} already exists — skipping system`);
      counts.systemsSkipped++;
    } else {
      // Strip embedded zones[] — those go into the subcollection
      const { zones: _zones, ...sysFields } = es;
      await writeOrDry(hvacSysRef, {
        ...sysFields,
        migratedFromEquipmentSystem: true,
        migratedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, `    ✓ hvacSystems/${sysId}  (${es.name ?? 'unnamed'})`);
      counts.systemsCreated++;
    }

    // ── Step 2: Create zone subcollection docs ───────────────────────────────
    const embeddedZones: any[] = Array.isArray(es.zones) ? es.zones : [];

    // Map from zone ID → zone name for room-stamping lookup later
    const zoneIdToName: Record<string, string> = {};
    // Map from room ID → zone ID (built from zone.roomIds)
    const roomToZoneId: Record<string, string> = {};

    let defaultZoneId = `${sysId}_zone`;

    if (embeddedZones.length === 0) {
      // No zones — create a single default zone for the system
      const defZoneRef = db.doc(`projects/${projectId}/hvacSystems/${sysId}/zones/${defaultZoneId}`);
      const existingDef = await defZoneRef.get();
      if (!existingDef.exists) {
        await writeOrDry(defZoneRef, {
          id: defaultZoneId,
          systemId: sysId,
          name: es.name ?? 'Zone',
          roomIds: Array.isArray(es.assignedRoomIds) ? es.assignedRoomIds : [],
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, `      ✓ zones/${defaultZoneId}  [default]`);
        counts.zonesCreated++;
      } else {
        counts.zonesSkipped++;
      }
      zoneIdToName[defaultZoneId] = es.name ?? 'Zone';
      // All assigned rooms go to the default zone
      (es.assignedRoomIds ?? []).forEach((rid: string) => {
        roomToZoneId[rid] = defaultZoneId;
      });
    } else {
      for (const zone of embeddedZones) {
        const zoneId: string = zone.id;
        const zoneRef = db.doc(`projects/${projectId}/hvacSystems/${sysId}/zones/${zoneId}`);
        const existingZone = await zoneRef.get();

        if (existingZone.exists) {
          info(`zones/${zoneId} already exists — skipping`);
          counts.zonesSkipped++;
        } else {
          // Merge design-condition overrides from the LC zone if the IDs match
          const lcOverrides: Record<string, any> = {};
          const lcZone = lcZoneMap[zoneId];
          if (lcZone) {
            const dcFields = [
              'indoorTemp', 'indoorHumidity', 'outdoorTemp', 'outdoorHumidity',
              'winterIndoorTemp', 'winterIndoorHumidity',
            ];
            dcFields.forEach(f => {
              if (lcZone[f] !== undefined) lcOverrides[f] = lcZone[f];
            });
          }

          await writeOrDry(zoneRef, {
            ...zone,
            systemId: sysId,
            ...lcOverrides,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, `      ✓ zones/${zoneId}  (${zone.name ?? 'unnamed'})`);
          counts.zonesCreated++;
        }

        zoneIdToName[zoneId] = zone.name ?? 'Zone';
        (zone.roomIds ?? []).forEach((rid: string) => {
          roomToZoneId[rid] = zoneId;
        });
      }
    }

    // ── Step 3: Stamp rooms ──────────────────────────────────────────────────
    for (const room of rooms) {
      // Only process rooms that belong to this system
      if (room.systemId !== sysId) continue;

      // Skip if already stamped
      if (room.hvacSystemId) {
        counts.roomsSkipped++;
        continue;
      }

      // Find which zone this room belongs to
      let hvacZoneId: string | undefined = roomToZoneId[room.id];

      if (!hvacZoneId) {
        // Fallback 1: ahuGroupId — the zone ID set during Equipment Selection assignment
        if (room.ahuGroupId) {
          hvacZoneId = room.ahuGroupId;
        } else {
          // Fallback 2: assign to the default zone
          hvacZoneId = embeddedZones.length > 0
            ? embeddedZones[0].id   // first zone
            : defaultZoneId;
        }
      }

      const hvacZoneName = zoneIdToName[hvacZoneId] ?? room.ahuGroupName ?? room.zoneName ?? 'Zone';

      await updateOrDry(
        db.doc(`projects/${projectId}/rooms/${room.id}`),
        {
          hvacSystemId: sysId,
          hvacSystemName: es.name ?? '',
          hvacZoneId,
          hvacZoneName,
        },
        `      ✓ room/${room.id}  → sys:${sysId.slice(-6)}  zone:${hvacZoneId.slice(-8)}`,
      );
      counts.roomsStamped++;

      // Update local copy so we don't re-process in another system loop
      room.hvacSystemId = sysId;
    }
  }

  // Report rooms with no equipment system (LC-zone-only rooms)
  const unassigned = rooms.filter((r: any) => !r.hvacSystemId && !r.systemId);
  if (unassigned.length > 0) {
    info(`${unassigned.length} room(s) have no equipment system — skipped (LC-zone only)`);
    counts.roomsNoSystem += unassigned.length;
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  console.log('\n════════════════════════════════════════════════════════');
  console.log('  HVAC Master — Unified Hierarchy Migration (Phase 1)');
  console.log('════════════════════════════════════════════════════════');
  if (DRY_RUN) console.log('\n  ⚠  DRY RUN — no writes will be made\n');

  let projectIds: string[];

  if (SINGLE_PROJECT) {
    projectIds = [SINGLE_PROJECT];
  } else {
    const projectsSnap = await db.collection('projects').get();
    projectIds = projectsSnap.docs.map(d => d.id);
  }

  console.log(`\n  Projects to process: ${projectIds.length}\n`);

  for (const pid of projectIds) {
    try {
      await migrateProject(pid);
    } catch (err) {
      console.error(`\n  ERROR processing project ${pid}:`, err);
    }
  }

  console.log('\n════════════════════════════════════════════════════════');
  console.log('  Migration complete\n');
  console.log(`  Projects processed : ${counts.projects}`);
  console.log(`  Systems created    : ${counts.systemsCreated}`);
  console.log(`  Systems skipped    : ${counts.systemsSkipped}`);
  console.log(`  Zones created      : ${counts.zonesCreated}`);
  console.log(`  Zones skipped      : ${counts.zonesSkipped}`);
  console.log(`  Rooms stamped      : ${counts.roomsStamped}`);
  console.log(`  Rooms skipped      : ${counts.roomsSkipped}  (already had hvacSystemId)`);
  console.log(`  Rooms no system    : ${counts.roomsNoSystem}  (LC-zone only — normal)`);
  console.log('════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
