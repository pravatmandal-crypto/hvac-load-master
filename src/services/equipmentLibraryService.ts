/**
 * Global Equipment Library — Firestore-backed, project-agnostic.
 *
 * Collection: globalEquipmentLibrary
 * Every document maps 1-to-1 with EquipmentModel, extended with
 * audit fields (source, addedBy, createdAt, updatedAt).
 */

import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs,
  writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { EQUIPMENT_CATALOG } from '../constants/equipment-catalog';
import type { EquipmentModel } from '../constants/equipment-catalog';

export const GLOBAL_LIB_COLLECTION = 'globalEquipmentLibrary';

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function isLibrarySeeded(): Promise<boolean> {
  const snap = await getDocs(collection(db, GLOBAL_LIB_COLLECTION));
  return !snap.empty;
}

export async function getAllLibraryItems(): Promise<EquipmentModel[]> {
  const snap = await getDocs(collection(db, GLOBAL_LIB_COLLECTION));
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as EquipmentModel));
  // Sort in memory — avoids needing a composite Firestore index
  items.sort((a, b) => {
    const brandCmp = a.brand.localeCompare(b.brand);
    if (brandCmp !== 0) return brandCmp;
    return String(a.type).localeCompare(String(b.type));
  });
  return items;
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

/**
 * One-time migration: writes every item from the static catalog to Firestore.
 * Safe to call multiple times — call only after confirming the library is empty.
 */
export async function seedLibraryFromCatalog(userId?: string): Promise<number> {
  const BATCH_SIZE = 400; // Firestore hard limit is 500
  let seeded = 0;

  for (let i = 0; i < EQUIPMENT_CATALOG.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = EQUIPMENT_CATALOG.slice(i, i + BATCH_SIZE);
    for (const item of chunk) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _staticId, ...rest } = item;
      const ref = doc(collection(db, GLOBAL_LIB_COLLECTION));
      batch.set(ref, {
        ...rest,
        source: 'catalog',
        addedBy: userId ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    seeded += chunk.length;
  }
  return seeded;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function addLibraryItem(
  item: Omit<EquipmentModel, 'id'>,
  userId?: string,
): Promise<string> {
  const ref = await addDoc(collection(db, GLOBAL_LIB_COLLECTION), {
    ...stripUndefined(item),
    source: 'user',
    addedBy: userId ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateLibraryItem(
  id: string,
  updates: Partial<EquipmentModel>,
): Promise<void> {
  await updateDoc(doc(db, GLOBAL_LIB_COLLECTION, id), {
    ...stripUndefined(updates),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteLibraryItem(id: string): Promise<void> {
  await deleteDoc(doc(db, GLOBAL_LIB_COLLECTION, id));
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

export const CSV_HEADERS = [
  'Brand', 'Type', 'Sub-Type', 'Model/Series',
  'Capacity(TR)', 'Airflow(CFM)', 'ESP(Pa)', 'Power(kW)',
  'EER', 'COP', 'Refrigerant', 'Discharge', 'Compressor',
  'MinConn%', 'MaxConn%', 'Description',
];

export function getCSVTemplate(): string {
  const example = [
    'Blue Star', 'VRF-IDU', 'cassette-4way', 'BI18DB',
    '1.5', '600', '', '1.2',
    '3.5', '', 'R32', '', '',
    '', '', '4-way cassette',
  ];
  return [CSV_HEADERS.join(','), example.join(',')].join('\n');
}

export function exportToCSV(items: EquipmentModel[]): string {
  const rows: string[] = [CSV_HEADERS.join(',')];
  for (const item of items) {
    const vals = [
      item.brand ?? '',
      item.type ?? '',
      item.subType ?? '',
      item.modelSeries ?? '',
      item.capacityTR ?? '',
      item.ratedAirflowCFM ?? '',
      item.staticPressurePa ?? '',
      item.powerInputKW ?? '',
      item.eer ?? '',
      item.cop ?? '',
      item.refrigerant ?? '',
      item.dischargeType ?? '',
      item.compressorType ?? '',
      item.minConnectionPct ?? '',
      item.maxConnectionPct ?? '',
      item.description ?? '',
    ];
    rows.push(vals.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  }
  return rows.join('\n');
}

export interface CSVImportResult {
  added: number;
  errors: string[];
}

export async function importFromCSV(
  csvText: string,
  userId?: string,
): Promise<CSVImportResult> {
  const lines = csvText.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return { added: 0, errors: ['CSV has no data rows'] };

  const errors: string[] = [];
  const valid: Omit<EquipmentModel, 'id'>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const [brand, type, subType, modelSeries, capTR, cfm, esp, kw,
           eer, cop, refrigerant, discharge, compressor, minConn, maxConn, desc] = cols;

    if (!modelSeries?.trim()) {
      errors.push(`Row ${i + 1}: Model/Series is required — skipped`);
      continue;
    }
    const tr = parseFloat(capTR);
    if (isNaN(tr) || tr <= 0) {
      errors.push(`Row ${i + 1} (${modelSeries}): Capacity(TR) must be a positive number — skipped`);
      continue;
    }

    const item: Omit<EquipmentModel, 'id'> = {
      brand: brand?.trim() || 'Unknown',
      type: (type?.trim() || 'Split') as EquipmentModel['type'],
      modelSeries: modelSeries.trim(),
      capacityTR: tr,
      capacityBTU: Math.round(tr * 12000),
      ...(subType?.trim()    && { subType: subType.trim() }),
      ...(cfm                && { ratedAirflowCFM: parseFloat(cfm) || undefined }),
      ...(esp                && { staticPressurePa: parseFloat(esp) || undefined }),
      ...(kw                 && { powerInputKW: parseFloat(kw) || undefined }),
      ...(eer                && { eer: parseFloat(eer) || undefined }),
      ...(cop                && { cop: parseFloat(cop) || undefined }),
      ...(refrigerant?.trim()&& { refrigerant: refrigerant.trim() }),
      ...(discharge?.trim()  && { dischargeType: discharge.trim() as 'top' | 'side' }),
      ...(compressor?.trim() && { compressorType: compressor.trim() as 'heat-pump' | 'cooling-only' }),
      ...(minConn            && { minConnectionPct: parseFloat(minConn) || undefined }),
      ...(maxConn            && { maxConnectionPct: parseFloat(maxConn) || undefined }),
      ...(desc?.trim()       && { description: desc.trim() }),
    };
    valid.push(item);
  }

  const BATCH_SIZE = 400;
  let added = 0;
  for (let i = 0; i < valid.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const item of valid.slice(i, i + BATCH_SIZE)) {
      batch.set(doc(collection(db, GLOBAL_LIB_COLLECTION)), {
        ...item,
        source: 'user',
        addedBy: userId ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    added += valid.slice(i, i + BATCH_SIZE).length;
  }

  return { added, errors };
}

// ─── Migration ───────────────────────────────────────────────────────────────

/**
 * One-time migration: copies all documents from the two legacy collections
 * (`customEquipmentCatalog` and `customEquipment`) into globalEquipmentLibrary.
 * Skips items whose brand+modelSeries already exist to avoid duplicates.
 * Returns counts: { migrated, skipped, errors }.
 */
export async function migrateFromLegacyCollections(
  userId?: string,
): Promise<{ migrated: number; skipped: number; errors: string[] }> {
  const LEGACY_COLLECTIONS = ['customEquipmentCatalog', 'customEquipment'];
  const errors: string[] = [];

  // Build a set of existing brand+model keys to detect duplicates
  const existingSnap = await getDocs(collection(db, GLOBAL_LIB_COLLECTION));
  const existingKeys = new Set<string>();
  existingSnap.docs.forEach(d => {
    const data = d.data();
    if (data.brand && data.modelSeries) {
      existingKeys.add(`${String(data.brand).toLowerCase()}|${String(data.modelSeries).toLowerCase()}`);
    }
  });

  const toWrite: Omit<EquipmentModel, 'id'>[] = [];

  for (const col of LEGACY_COLLECTIONS) {
    let snap;
    try {
      snap = await getDocs(collection(db, col));
    } catch {
      continue; // collection may not exist — skip silently
    }
    for (const d of snap.docs) {
      const data = d.data() as Partial<EquipmentModel>;
      if (!data.brand || !data.modelSeries) {
        errors.push(`${col}/${d.id}: missing brand or modelSeries — skipped`);
        continue;
      }
      const key = `${data.brand.toLowerCase()}|${data.modelSeries.toLowerCase()}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key); // mark so a duplicate in the second collection is also skipped
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, source: _src, addedBy: _ab, createdAt: _ca, updatedAt: _ua, ...rest } = data as any;
      toWrite.push({
        brand: data.brand,
        type: (data.type ?? 'VRF-IDU') as EquipmentModel['type'],
        modelSeries: data.modelSeries,
        capacityTR: data.capacityTR ?? 0,
        capacityBTU: data.capacityBTU ?? Math.round((data.capacityTR ?? 0) * 12000),
        ...rest,
      });
    }
  }

  // Write in batches
  const BATCH_SIZE = 400;
  let migrated = 0;
  for (let i = 0; i < toWrite.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const item of toWrite.slice(i, i + BATCH_SIZE)) {
      batch.set(doc(collection(db, GLOBAL_LIB_COLLECTION)), {
        ...item,
        source: 'user',
        addedBy: userId ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    migrated += toWrite.slice(i, i + BATCH_SIZE).length;
  }

  return { migrated, skipped: existingSnap.docs.length, errors };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as T;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim()); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}
