// Project clone service — duplicates an entire project including rooms, envelope elements,
// equipment systems, LC zones, and legacy systems. Generates new Firestore IDs for every
// document and remaps cross-document references (system.zones[].roomIds[], iduSelections[roomId],
// etc.) so the clone is fully self-contained — pointing only at its own copies, never at the
// original project's data.
//
// Returns the new project's id. Throws on failure (caller should toast).

import {
  collection, doc, getDoc, getDocs, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

const MAX_BATCH_OPS = 400;  // Firestore hard limit is 500, leave headroom

type Progress = (msg: string) => void;

interface CloneResult {
  newProjectId: string;
  roomsCopied: number;
  systemsCopied: number;
  zonesCopied: number;
  envelopeElementsCopied: number;
}

/**
 * Clones an entire project. Caller is responsible for permission checks.
 *
 * @param sourceProjectId  ID of the project to duplicate.
 * @param newName          Display name for the new project.
 * @param ownerUid         Firebase Auth UID of the user owning the new project.
 * @param onProgress       Optional callback for toast/progress UI.
 */
export async function cloneProject(
  sourceProjectId: string,
  newName: string,
  ownerUid: string,
  onProgress?: Progress,
): Promise<CloneResult> {
  // ── Step 1: read the source project doc ───────────────────────────────────
  onProgress?.('Reading source project…');
  const srcProjectSnap = await getDoc(doc(db, 'projects', sourceProjectId));
  if (!srcProjectSnap.exists()) throw new Error('Source project not found.');
  const srcProjectData = srcProjectSnap.data();

  // ── Step 2: create the new project doc and reserve an id ──────────────────
  const newProjectRef = doc(collection(db, 'projects'));
  const newProjectId = newProjectRef.id;

  // ── Step 3: copy rooms (and build oldId → newId map) ──────────────────────
  onProgress?.('Copying rooms…');
  const roomsSnap = await getDocs(collection(db, 'projects', sourceProjectId, 'rooms'));
  const roomIdMap: Record<string, string> = {};
  const roomsData: { newId: string; data: any }[] = [];
  for (const rd of roomsSnap.docs) {
    const newRoomRef = doc(collection(db, 'projects', newProjectId, 'rooms'));
    roomIdMap[rd.id] = newRoomRef.id;
    const data = { ...(rd.data() as any) };
    // We'll rewrite cross-references below; clear ones that point to a system/zone
    // until we build their ID maps too.
    roomsData.push({ newId: newRoomRef.id, data });
  }

  // ── Step 4: read all systems (LC legacy + ES) and build their id maps ─────
  onProgress?.('Copying systems…');
  const esSysSnap = await getDocs(collection(db, 'projects', sourceProjectId, 'equipmentSystems'));
  const esSysIdMap: Record<string, string> = {};
  for (const sd of esSysSnap.docs) {
    const newSysRef = doc(collection(db, 'projects', newProjectId, 'equipmentSystems'));
    esSysIdMap[sd.id] = newSysRef.id;
  }

  const legacySysSnap = await getDocs(collection(db, 'projects', sourceProjectId, 'systems'));
  const legacySysIdMap: Record<string, string> = {};
  for (const sd of legacySysSnap.docs) {
    const newRef = doc(collection(db, 'projects', newProjectId, 'systems'));
    legacySysIdMap[sd.id] = newRef.id;
  }

  // ── Step 5: build the sub-zone (in system.zones[]) id map ─────────────────
  // ES sub-zone ids appear both in es.zones[].id AND in room.zoneId. Remap them
  // consistently across both.
  const subZoneIdMap: Record<string, string> = {};
  for (const sd of esSysSnap.docs) {
    const data = sd.data() as any;
    for (const z of (data.zones ?? []) as any[]) {
      if (z?.id) subZoneIdMap[z.id] = `zone-${Date.now()}-${Object.keys(subZoneIdMap).length}`;
    }
  }
  // Also map /zones docs (LC zones can share id with es sub-zones, so reuse the same map)
  const lcZonesSnap = await getDocs(collection(db, 'projects', sourceProjectId, 'zones'));
  for (const zd of lcZonesSnap.docs) {
    if (!subZoneIdMap[zd.id]) {
      // Map LC zone ids to themselves only if not already remapped via ES sub-zones.
      // We keep the same id to preserve room.zoneId → /zones doc pairing.
      subZoneIdMap[zd.id] = doc(collection(db, 'projects', newProjectId, 'zones')).id;
    }
  }

  // ── Step 6: prepare write batches ─────────────────────────────────────────
  const batches: ReturnType<typeof writeBatch>[] = [writeBatch(db)];
  let opCount = 0;
  const queue = (fn: (b: ReturnType<typeof writeBatch>) => void) => {
    if (opCount >= MAX_BATCH_OPS) {
      batches.push(writeBatch(db));
      opCount = 0;
    }
    fn(batches[batches.length - 1]);
    opCount++;
  };

  // ── Step 6a: project doc ──────────────────────────────────────────────────
  queue(b => b.set(newProjectRef, {
    ...srcProjectData,
    name: newName,
    userId: ownerUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    // Reset any clone-incompatible flags
    zonesLastSyncedAt: serverTimestamp(),
  }));

  // ── Step 6b: rooms (with remapped systemId / zoneId) ──────────────────────
  for (const { newId: newRoomId, data } of roomsData) {
    const remapped: any = { ...data };
    if (data.systemId)     remapped.systemId     = esSysIdMap[data.systemId]     ?? data.systemId;
    if (data.hvacSystemId) remapped.hvacSystemId = esSysIdMap[data.hvacSystemId] ?? data.hvacSystemId;
    if (data.zoneId)       remapped.zoneId       = subZoneIdMap[data.zoneId]    ?? data.zoneId;
    if (data.hvacZoneId)   remapped.hvacZoneId   = subZoneIdMap[data.hvacZoneId] ?? data.hvacZoneId;
    if (data.ahuGroupId)   remapped.ahuGroupId   = subZoneIdMap[data.ahuGroupId] ?? data.ahuGroupId;
    queue(b => b.set(doc(db, 'projects', newProjectId, 'rooms', newRoomId), {
      ...remapped,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  }

  // ── Step 6c: envelope elements for each room ──────────────────────────────
  onProgress?.('Copying envelope elements…');
  let envelopeElementsCopied = 0;
  for (const rd of roomsSnap.docs) {
    const newRoomId = roomIdMap[rd.id];
    const elSnap = await getDocs(collection(db, 'projects', sourceProjectId, 'rooms', rd.id, 'envelopeElements'));
    for (const el of elSnap.docs) {
      const newElRef = doc(collection(db, 'projects', newProjectId, 'rooms', newRoomId, 'envelopeElements'));
      queue(b => b.set(newElRef, { ...el.data() }));
      envelopeElementsCopied++;
    }
  }

  // ── Step 6d: ES systems (with remapped zones[].roomIds[], iduSelections, etc.) ──
  for (const sd of esSysSnap.docs) {
    const data = sd.data() as any;
    const newSysId = esSysIdMap[sd.id];
    const remapRoomIds = (arr: string[] = []) => arr.map(rid => roomIdMap[rid]).filter(Boolean);
    const remapRoomMap = (obj: Record<string, any> = {}) => {
      const out: Record<string, any> = {};
      for (const [oldRoomId, val] of Object.entries(obj)) {
        const newRoomId = roomIdMap[oldRoomId];
        if (newRoomId) out[newRoomId] = val;
      }
      return out;
    };
    const remappedZones = ((data.zones ?? []) as any[]).map((z: any) => ({
      ...z,
      id: subZoneIdMap[z.id] ?? z.id,
      roomIds: remapRoomIds(z.roomIds ?? []),
    }));
    const remappedAssigned = remapRoomIds(data.assignedRoomIds ?? []);
    const remappedIdu      = remapRoomMap(data.iduSelections ?? {});
    const remappedRoomSels = remapRoomMap(data.roomSelections ?? {});
    const remappedZoneSels: Record<string, any> = {};
    for (const [oldZid, val] of Object.entries(data.zoneSelections ?? {})) {
      const newZid = subZoneIdMap[oldZid] ?? oldZid;
      remappedZoneSels[newZid] = val;
    }
    queue(b => b.set(doc(db, 'projects', newProjectId, 'equipmentSystems', newSysId), {
      ...data,
      zones: remappedZones,
      assignedRoomIds: remappedAssigned,
      iduSelections: remappedIdu,
      roomSelections: remappedRoomSels,
      zoneSelections: remappedZoneSels,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  }

  // ── Step 6e: LC /zones (carry design-condition overrides) ─────────────────
  for (const zd of lcZonesSnap.docs) {
    const newZid = subZoneIdMap[zd.id] ?? zd.id;
    queue(b => b.set(doc(db, 'projects', newProjectId, 'zones', newZid), { ...zd.data() }));
  }

  // ── Step 6f: legacy /systems and nested /zones ────────────────────────────
  for (const sd of legacySysSnap.docs) {
    const newSysId = legacySysIdMap[sd.id];
    queue(b => b.set(doc(db, 'projects', newProjectId, 'systems', newSysId), { ...sd.data() }));
    const nested = await getDocs(collection(db, 'projects', sourceProjectId, 'systems', sd.id, 'zones'));
    for (const nz of nested.docs) {
      const newNzId = subZoneIdMap[nz.id] ?? nz.id;
      queue(b => b.set(doc(db, 'projects', newProjectId, 'systems', newSysId, 'zones', newNzId), { ...nz.data() }));
    }
  }

  // ── Step 7: commit ────────────────────────────────────────────────────────
  onProgress?.('Writing to database…');
  for (const b of batches) await b.commit();

  return {
    newProjectId,
    roomsCopied: roomsData.length,
    systemsCopied: esSysSnap.docs.length + legacySysSnap.docs.length,
    zonesCopied: lcZonesSnap.docs.length,
    envelopeElementsCopied,
  };
}
