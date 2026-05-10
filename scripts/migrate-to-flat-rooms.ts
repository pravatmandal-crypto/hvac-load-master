/**
 * Firestore Migration — Flat Room Storage
 * ──────────────────────────────────────────────────────────────
 * SAFE: Only ADDS documents. Never deletes or overwrites anything.
 *
 * Copies all rooms from their old paths to a single flat path:
 *   OLD (VRF):    projects/{id}/systems/{sysId}/rooms/{roomId}
 *   OLD (Hybrid): projects/{id}/systems/{sysId}/zones/{zoneId}/rooms/{roomId}
 *   OLD (Others): projects/{id}/zones/{zoneId}/rooms/{roomId}
 *   NEW (all):    projects/{id}/rooms/{roomId}
 *
 * Also copies envelope elements:
 *   NEW: projects/{id}/rooms/{roomId}/envelopeElements/{elemId}
 *
 * Added fields on each room:
 *   zoneId      — original zone/system ID (for grouping display)
 *   zoneName    — human-readable zone/system name
 *   _sourcePath — audit trail of where room came from
 *
 * Usage:
 *   npm run migrate
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin') as typeof import('firebase-admin');
import * as fs from 'fs';
import * as path from 'path';

// ── Init ─────────────────────────────────────────────────────────────────────

const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'service-account.json'), 'utf8'),
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ── Counters ─────────────────────────────────────────────────────────────────

let totalRoomsMigrated = 0;
let totalElementsMigrated = 0;
let totalSkipped = 0;

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) { process.stdout.write(`    ${msg}\n`); }

/**
 * Copy a single room document + its envelopeElements to the flat path.
 * Skips if the destination already exists (safe to re-run).
 */
async function migrateRoom(
  projectId: string,
  roomId: string,
  roomData: FirebaseFirestore.DocumentData,
  elementsSourcePath: string,
  zoneId: string,
  zoneName: string,
  sourcePath: string,
) {
  const destRef = db.doc(`projects/${projectId}/rooms/${roomId}`);

  // Skip if already migrated
  const existing = await destRef.get();
  if (existing.exists) {
    totalSkipped++;
    return;
  }

  // Write room with added fields
  await destRef.set({
    ...roomData,
    zoneId,
    zoneName,
    _sourcePath: sourcePath,
  });
  totalRoomsMigrated++;

  // Copy envelope elements
  try {
    const elemSnap = await db.collection(elementsSourcePath).get();
    for (const elemDoc of elemSnap.docs) {
      await db
        .doc(`projects/${projectId}/rooms/${roomId}/envelopeElements/${elemDoc.id}`)
        .set(elemDoc.data());
      totalElementsMigrated++;
    }
  } catch {
    // No envelope elements — that's fine
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function migrate() {
  const startTime = Date.now();

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   HVAC Load Master — Room Migration      ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log('SAFE MODE: Only adding documents. Nothing deleted.\n');

  const projectsSnap = await db.collection('projects').get();
  console.log(`Found ${projectsSnap.docs.length} projects.\n`);

  for (const projectDoc of projectsSnap.docs) {
    const projectId = projectDoc.id;
    const projectData = projectDoc.data();
    const projectName = projectData.name ?? projectId;
    const systemType  = projectData.systemType ?? 'unknown';

    console.log(`▶ "${projectName}" [${systemType}] — ${projectId}`);

    if (systemType === 'VRF') {
      // ── VRF: rooms directly under each system ──────────────────────────────
      const systemsSnap = await db
        .collection(`projects/${projectId}/systems`)
        .get();

      for (const sysDoc of systemsSnap.docs) {
        const sysId   = sysDoc.id;
        const sysName = (sysDoc.data().name as string) ?? 'System';
        const roomsSnap = await db
          .collection(`projects/${projectId}/systems/${sysId}/rooms`)
          .get();

        log(`system "${sysName}": ${roomsSnap.docs.length} room(s)`);

        for (const roomDoc of roomsSnap.docs) {
          await migrateRoom(
            projectId, roomDoc.id, roomDoc.data(),
            `projects/${projectId}/systems/${sysId}/rooms/${roomDoc.id}/envelopeElements`,
            sysId, sysName,
            `systems/${sysId}/rooms`,
          );
        }
      }

    } else if (systemType === 'Hybrid') {
      // ── Hybrid: direct zones + system zones ───────────────────────────────

      // Direct zones
      const zonesSnap = await db
        .collection(`projects/${projectId}/zones`)
        .get();

      for (const zoneDoc of zonesSnap.docs) {
        const zoneId   = zoneDoc.id;
        const zoneName = (zoneDoc.data().name as string) ?? 'Zone';
        const roomsSnap = await db
          .collection(`projects/${projectId}/zones/${zoneId}/rooms`)
          .get();

        log(`zone "${zoneName}": ${roomsSnap.docs.length} room(s)`);

        for (const roomDoc of roomsSnap.docs) {
          await migrateRoom(
            projectId, roomDoc.id, roomDoc.data(),
            `projects/${projectId}/zones/${zoneId}/rooms/${roomDoc.id}/envelopeElements`,
            zoneId, zoneName,
            `zones/${zoneId}/rooms`,
          );
        }
      }

      // System zones (Hybrid has zones nested under systems too)
      const systemsSnap = await db
        .collection(`projects/${projectId}/systems`)
        .get();

      for (const sysDoc of systemsSnap.docs) {
        const sysId = sysDoc.id;
        const sysZonesSnap = await db
          .collection(`projects/${projectId}/systems/${sysId}/zones`)
          .get();

        for (const zoneDoc of sysZonesSnap.docs) {
          const zoneId   = zoneDoc.id;
          const zoneName = (zoneDoc.data().name as string) ?? 'Zone';
          const roomsSnap = await db
            .collection(`projects/${projectId}/systems/${sysId}/zones/${zoneId}/rooms`)
            .get();

          log(`system "${sysId}" → zone "${zoneName}": ${roomsSnap.docs.length} room(s)`);

          for (const roomDoc of roomsSnap.docs) {
            await migrateRoom(
              projectId, roomDoc.id, roomDoc.data(),
              `projects/${projectId}/systems/${sysId}/zones/${zoneId}/rooms/${roomDoc.id}/envelopeElements`,
              zoneId, zoneName,
              `systems/${sysId}/zones/${zoneId}/rooms`,
            );
          }
        }
      }

    } else {
      // ── Standard (Chiller, Package, DuctableSplit, CAC, etc.): zones ───────
      const zonesSnap = await db
        .collection(`projects/${projectId}/zones`)
        .get();

      for (const zoneDoc of zonesSnap.docs) {
        const zoneId   = zoneDoc.id;
        const zoneName = (zoneDoc.data().name as string) ?? 'Zone';
        const roomsSnap = await db
          .collection(`projects/${projectId}/zones/${zoneId}/rooms`)
          .get();

        log(`zone "${zoneName}": ${roomsSnap.docs.length} room(s)`);

        for (const roomDoc of roomsSnap.docs) {
          await migrateRoom(
            projectId, roomDoc.id, roomDoc.data(),
            `projects/${projectId}/zones/${zoneId}/rooms/${roomDoc.id}/envelopeElements`,
            zoneId, zoneName,
            `zones/${zoneId}/rooms`,
          );
        }
      }
    }

    console.log(`  └─ Done\n`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('╔══════════════════════════════════════════╗');
  console.log('║           MIGRATION COMPLETE             ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Rooms migrated  : ${totalRoomsMigrated}`);
  console.log(`  Elements copied : ${totalElementsMigrated}`);
  console.log(`  Skipped (exist) : ${totalSkipped}`);
  console.log(`  Time            : ${elapsed}s`);
  console.log('\n  Old data untouched. New flat path: projects/{id}/rooms/\n');
  console.log('  Next step: update Load Calculator to read from new path.\n');
}

migrate().catch(err => {
  console.error('\n✖ Migration failed:', err);
  process.exit(1);
});
