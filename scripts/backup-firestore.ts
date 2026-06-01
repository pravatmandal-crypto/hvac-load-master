/**
 * Firestore Backup Script
 * ──────────────────────────────────────────────────────────────
 * READ-ONLY. Never writes to or deletes from Firestore.
 *
 * Backs up all project data covering every room-storage path:
 *   • projects/{id}/rooms                                (CURRENT — flat rooms, since 2026-05-02)
 *   • projects/{id}/zones/{zoneId}/rooms                 (legacy CAC / Package)
 *   • projects/{id}/systems/{sysId}/rooms                (legacy VRF)
 *   • projects/{id}/systems/{sysId}/zones/{zoneId}/rooms (legacy Hybrid)
 *   • projects/{id}/equipmentSystems                     (Equipment Selection)
 *   • users collection
 *
 * Each room's envelopeElements subcollection is captured inline.
 *
 * Usage:
 *   npx tsx scripts/backup-firestore.ts
 *
 * Output:
 *   backups/backup-YYYY-MM-DD-HH-MM-SS.json
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// firebase-admin is CommonJS — must require() in ESM context
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  process.stdout.write(`  ${msg}\n`);
}

/** Read all docs from a collection path. Returns [] if collection is empty. */
async function readCollection(colPath: string): Promise<Record<string, any>[]> {
  try {
    const snap = await db.collection(colPath).get();
    return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

/** Read a single subcollection for each doc in a parent collection. */
async function readSubCollection(
  docs: Record<string, any>[],
  parentPath: string,
  subName: string,
): Promise<Record<string, Record<string, any>[]>> {
  const result: Record<string, Record<string, any>[]> = {};
  for (const doc of docs) {
    const sub = await readCollection(`${parentPath}/${doc._id}/${subName}`);
    if (sub.length > 0) result[doc._id] = sub;
  }
  return result;
}

// ── Main backup ───────────────────────────────────────────────────────────────

async function backup() {
  const startTime = Date.now();
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   HVAC Load Master — Firestore Backup    ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log('READ-ONLY — no data will be modified.\n');

  const output: Record<string, any> = {
    _meta: {
      backupDate: new Date().toISOString(),
      projectId: serviceAccount.project_id,
    },
  };

  // ── Users ──────────────────────────────────────────────────────────────────
  console.log('▶ Reading users…');
  const users = await readCollection('users');
  output.users = users;
  log(`${users.length} user(s) saved`);

  // ── Projects ───────────────────────────────────────────────────────────────
  console.log('\n▶ Reading projects…');
  const projects = await readCollection('projects');
  log(`${projects.length} project(s) found`);

  output.projects = [];

  for (const project of projects) {
    console.log(`\n  ┌─ Project: "${project.name ?? project._id}" (${project.systemType ?? '?'}) [${project._id}]`);

    const projectData: Record<string, any> = { ...project };

    // ── Equipment Systems (our new Equipment Selection data) ─────────────────
    const equipSystems = await readCollection(`projects/${project._id}/equipmentSystems`);
    projectData.equipmentSystems = equipSystems;
    log(`│  equipmentSystems: ${equipSystems.length}`);

    // ── Flat rooms (CURRENT canonical path since the 2026-05-02 migration) ────
    // All rooms now live at projects/{id}/rooms/{roomId} with their geometry,
    // envelope, and _calc* results. The legacy zone/system sub-paths below are
    // retained only for projects that predate the migration. This block is the
    // one that actually captures live room data — do not remove it.
    const flatRooms = await readCollection(`projects/${project._id}/rooms`);
    if (flatRooms.length > 0) {
      log(`│  rooms (flat): ${flatRooms.length}`);
      for (const room of flatRooms) {
        const elements = await readCollection(
          `projects/${project._id}/rooms/${room._id}/envelopeElements`,
        );
        if (elements.length > 0) room.envelopeElements = elements;
      }
      projectData.rooms = flatRooms;
    }

    // ── Standard zones → rooms (CAC / Package / DuctableSplit / AHU / Chiller)
    const zones = await readCollection(`projects/${project._id}/zones`);
    if (zones.length > 0) {
      log(`│  zones: ${zones.length}`);
      for (const zone of zones) {
        const rooms = await readCollection(`projects/${project._id}/zones/${zone._id}/rooms`);
        zone.rooms = rooms;
        log(`│    zone "${zone.name ?? zone._id}": ${rooms.length} room(s)`);

        // Envelope elements per room
        for (const room of rooms) {
          const elements = await readCollection(
            `projects/${project._id}/zones/${zone._id}/rooms/${room._id}/envelopeElements`,
          );
          if (elements.length > 0) room.envelopeElements = elements;
        }
      }
      projectData.zones = zones;
    }

    // ── VRF / Hybrid systems → rooms ─────────────────────────────────────────
    const systems = await readCollection(`projects/${project._id}/systems`);
    if (systems.length > 0) {
      log(`│  systems (VRF/Hybrid): ${systems.length}`);
      for (const sys of systems) {
        // VRF: rooms directly under system
        const vrfRooms = await readCollection(`projects/${project._id}/systems/${sys._id}/rooms`);
        if (vrfRooms.length > 0) {
          log(`│    system "${sys.name ?? sys._id}": ${vrfRooms.length} VRF room(s)`);
          for (const room of vrfRooms) {
            const elements = await readCollection(
              `projects/${project._id}/systems/${sys._id}/rooms/${room._id}/envelopeElements`,
            );
            if (elements.length > 0) room.envelopeElements = elements;
          }
          sys.rooms = vrfRooms;
        }

        // Hybrid: zones under system
        const sysZones = await readCollection(`projects/${project._id}/systems/${sys._id}/zones`);
        if (sysZones.length > 0) {
          log(`│    system "${sys.name ?? sys._id}": ${sysZones.length} zone(s) (Hybrid)`);
          for (const zone of sysZones) {
            const rooms = await readCollection(
              `projects/${project._id}/systems/${sys._id}/zones/${zone._id}/rooms`,
            );
            zone.rooms = rooms;
            log(`│      zone "${zone.name ?? zone._id}": ${rooms.length} room(s)`);
            for (const room of rooms) {
              const elements = await readCollection(
                `projects/${project._id}/systems/${sys._id}/zones/${zone._id}/rooms/${room._id}/envelopeElements`,
              );
              if (elements.length > 0) room.envelopeElements = elements;
            }
          }
          sys.zones = sysZones;
        }
      }
      projectData.systems = systems;
    }

    console.log(`  └─ Done`);
    output.projects.push(projectData);
  }

  // ── Write to file ─────────────────────────────────────────────────────────
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '-')
    .slice(0, 19);

  const filename = `backups/backup-${timestamp}.json`;
  const filepath = path.join(process.cwd(), filename);

  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(output, null, 2), 'utf8');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const sizekb = (fs.statSync(filepath).size / 1024).toFixed(1);

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║              BACKUP COMPLETE             ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  File    : ${filename}`);
  console.log(`  Size    : ${sizekb} KB`);
  console.log(`  Time    : ${elapsed}s`);
  console.log(`  Projects: ${projects.length}`);
  console.log(`  Users   : ${users.length}`);
  console.log('\n  Keep this file safe — it is your full database snapshot.\n');
}

backup().catch(err => {
  console.error('\n✖ Backup failed:', err);
  process.exit(1);
});
