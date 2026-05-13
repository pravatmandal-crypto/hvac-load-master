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

/**
 * Fetch library items for one or more equipment types.
 * Falls back to the static EQUIPMENT_CATALOG if the library is empty (not seeded yet).
 */
export async function getLibraryItemsByType(types: string | string[]): Promise<EquipmentModel[]> {
  const typeSet = new Set(Array.isArray(types) ? types : [types]);
  const snap = await getDocs(collection(db, GLOBAL_LIB_COLLECTION));
  if (snap.empty) {
    return EQUIPMENT_CATALOG.filter(m => typeSet.has(m.type as string));
  }
  const raw = snap.docs
    .map(d => ({ id: d.id, ...d.data() } as EquipmentModel))
    .filter(m => typeSet.has(m.type as string));

  // Deduplicate: if the library was seeded multiple times, identical models get
  // multiple Firestore docs. Keep the first occurrence per natural key.
  const seen = new Set<string>();
  const deduped: EquipmentModel[] = [];
  for (const item of raw) {
    const key = `${item.brand.toLowerCase()}|${String(item.type).toLowerCase()}|${(item.subType ?? '').toLowerCase()}|${item.modelSeries.toLowerCase()}|${item.capacityTR ?? ''}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(item); }
  }

  deduped.sort((a, b) => {
    const brandCmp = a.brand.localeCompare(b.brand);
    if (brandCmp !== 0) return brandCmp;
    const subCmp = (a.subType ?? '').localeCompare(b.subType ?? '');
    if (subCmp !== 0) return subCmp;
    return (a.capacityTR ?? 0) - (b.capacityTR ?? 0);
  });
  return deduped;
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

/**
 * Adds only catalog items not already present in the library (by natural key).
 * Safe to call at any time — never creates duplicates.
 */
export async function syncNewCatalogItems(userId?: string): Promise<number> {
  const snap = await getDocs(collection(db, GLOBAL_LIB_COLLECTION));
  const existingKeys = new Set<string>();
  snap.docs.forEach(d => {
    const item = d.data() as EquipmentModel;
    const key = `${String(item.brand ?? '').toLowerCase()}|${String(item.type ?? '').toLowerCase()}|${String(item.subType ?? '').toLowerCase()}|${String(item.modelSeries ?? '').toLowerCase()}|${item.capacityTR ?? ''}`;
    existingKeys.add(key);
  });

  const newItems = EQUIPMENT_CATALOG.filter(item => {
    const key = `${item.brand.toLowerCase()}|${String(item.type).toLowerCase()}|${(item.subType ?? '').toLowerCase()}|${item.modelSeries.toLowerCase()}|${item.capacityTR ?? ''}`;
    return !existingKeys.has(key);
  });

  if (newItems.length === 0) return 0;

  const BATCH_SIZE = 400;
  let added = 0;
  for (let i = 0; i < newItems.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const item of newItems.slice(i, i + BATCH_SIZE)) {
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
    added += newItems.slice(i, i + BATCH_SIZE).length;
  }
  return added;
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
  mode?: 'template' | 'manufacturer';
}

// ── Header aliases: maps our internal field name → possible CSV column headers ─
const HEADER_ALIASES: Record<string, string[]> = {
  brand:         ['brand'],
  manufacturer:  ['manufacturer'],                     // fallback for brand
  type:          ['type', 'equipment_type', 'product_type'],
  subType:       ['sub-type', 'subtype', 'sub_type'],
  modelSeries:   ['model/series', 'model_series', 'modelseries', 'series'],
  modelNo:       ['model_no', 'model_number', 'model', 'part_no', 'part_number'],
  productSeries: ['product_series', 'product_line'],   // manufacturer series → derive type/subType
  capacityTR:    ['capacity(tr)', 'capacity_tr', 'capacitytr', 'nominal_capacity_tr', 'tr_capacity', 'tr'],
  airflowCFM:    ['airflow(cfm)', 'airflow_cfm', 'total_cfm', 'cfm', 'airflowcfm'],
  staticPa:      ['esp(pa)', 'esp_pa', 'static_pressure_pa', 'staticpressure'],
  powerKW:       ['power(kw)', 'power_kw', 'powerkw', 'power_input_kw'],
  eer:           ['eer'],
  cop:           ['cop'],
  refrigerant:   ['refrigerant'],
  discharge:     ['discharge', 'dischargetype', 'discharge_type'],
  compressor:    ['compressor', 'compressortype', 'compressor_type'],
  minConn:       ['minconn%', 'minconn_pct', 'min_connection_pct', 'min_connection_percentage'],
  maxConn:       ['maxconn%', 'maxconn_pct', 'max_connection_pct', 'max_connection_percentage'],
  description:   ['description', 'desc', 'notes'],
};

function buildHeaderIndex(headerRow: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  headerRow.forEach((h, i) => { idx[h.toLowerCase().trim()] = i; });
  return idx;
}

function resolveCol(idx: Record<string, number>, field: string): number {
  for (const alias of (HEADER_ALIASES[field] ?? [])) {
    if (alias in idx) return idx[alias];
  }
  return -1;
}

function getCol(cols: string[], colIdx: number): string {
  return colIdx >= 0 ? (cols[colIdx] ?? '').trim() : '';
}

// Derive equipment type from a manufacturer product_series string
function deriveType(series: string): string {
  const s = series.toLowerCase();
  if (s.includes('chiller'))                     return 'Chiller';
  if (s.includes('cooling tower'))               return 'CoolingTower';
  if (s.includes('vrf') || s.includes('vrv'))    return 'VRF-ODU';
  if (s.includes('package'))                     return 'Package';
  if (s.includes('ductable') || s.includes('cassette') || s.includes('hi-wall') || s.includes('hi wall')) return 'VRF-IDU';
  if (s.includes('split'))                       return 'Split';
  return 'Split';
}

// Derive sub-type from a manufacturer product_series string
function deriveSubType(series: string): string {
  const s = series.toLowerCase();
  if (s.includes('air-cooled scroll') || s.includes('air cooled scroll')) return 'Air Cooled Scroll';
  if (s.includes('water-cooled scroll') || s.includes('water cooled scroll')) return 'Water Cooled Scroll';
  if (s.includes('air-cooled screw') || s.includes('air cooled screw')) return 'Air Cooled Screw';
  if (s.includes('water-cooled screw') || s.includes('water cooled screw')) return 'Water Cooled Screw';
  if (s.includes('air-cooled') || s.includes('air cooled')) return 'Air Cooled';
  if (s.includes('water-cooled') || s.includes('water cooled')) return 'Water Cooled';
  if (s.includes('scroll')) return 'Scroll';
  if (s.includes('screw')) return 'Screw';
  return '';
}

// Derive a human-readable model series from manufacturer fields (product_series + refrigerant)
function deriveModelSeries(productSeries: string, refrigerant: string, modelNo: string): string {
  // Extract alpha prefix from model number (e.g. "ACDS012DPMN1X1" → "ACDS")
  const prefix = modelNo.replace(/[^A-Za-z]/g, '').slice(0, 6) || '';
  const refPart = refrigerant ? ` ${refrigerant}` : '';
  // Derive short descriptor from product_series
  const s = productSeries.toLowerCase();
  const typePart = s.includes('scroll') ? ' Scroll' : s.includes('screw') ? ' Screw' : '';
  return `${prefix}${refPart}${typePart}`.trim() || productSeries || modelNo;
}

export async function importFromCSV(
  csvText: string,
  userId?: string,
): Promise<CSVImportResult> {
  const lines = csvText.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return { added: 0, errors: ['CSV has no data rows'] };

  const headerCols = parseCSVLine(lines[0]);
  const headerIdx  = buildHeaderIndex(headerCols);

  // Detect format: if first column header is 'brand' (our template format) use positional parsing;
  // otherwise use header-name mapping to support manufacturer-format CSVs.
  const isTemplateFormat = headerCols[0]?.toLowerCase().trim() === 'brand';

  const errors: string[] = [];
  const valid: Omit<EquipmentModel, 'id'>[] = [];

  if (isTemplateFormat) {
    // ── Template format: existing positional parser ────────────────────────
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
      valid.push({
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
      });
    }
  } else {
    // ── Manufacturer format: map by header name ────────────────────────────
    const cBrand         = resolveCol(headerIdx, 'brand');
    const cMfr           = resolveCol(headerIdx, 'manufacturer');
    const cType          = resolveCol(headerIdx, 'type');
    const cSubType       = resolveCol(headerIdx, 'subType');
    const cModelSeries   = resolveCol(headerIdx, 'modelSeries');
    const cModelNo       = resolveCol(headerIdx, 'modelNo');
    const cProductSeries = resolveCol(headerIdx, 'productSeries');
    const cCapTR         = resolveCol(headerIdx, 'capacityTR');
    const cCFM           = resolveCol(headerIdx, 'airflowCFM');
    const cESP           = resolveCol(headerIdx, 'staticPa');
    const cKW            = resolveCol(headerIdx, 'powerKW');
    const cEER           = resolveCol(headerIdx, 'eer');
    const cCOP           = resolveCol(headerIdx, 'cop');
    const cRefrig        = resolveCol(headerIdx, 'refrigerant');
    const cDischarge     = resolveCol(headerIdx, 'discharge');
    const cCompressor    = resolveCol(headerIdx, 'compressor');
    const cMinConn       = resolveCol(headerIdx, 'minConn');
    const cMaxConn       = resolveCol(headerIdx, 'maxConn');
    const cDesc          = resolveCol(headerIdx, 'description');

    if (cCapTR < 0) {
      return { added: 0, errors: [
        'Could not find a Capacity(TR) column. Expected a column named "nominal_capacity_tr", "capacity_tr", or "Capacity(TR)".',
        'For manufacturer CSVs use the Download Template to see the required column names.',
      ], mode: 'manufacturer' };
    }

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);

      const brandVal        = getCol(cols, cBrand) || getCol(cols, cMfr) || 'Unknown';
      const productSeries   = getCol(cols, cProductSeries);
      const modelNoVal      = getCol(cols, cModelNo);
      const refrigerantVal  = getCol(cols, cRefrig);

      // Derive type and subType from product_series if not directly mapped
      const typeVal    = getCol(cols, cType) || (productSeries ? deriveType(productSeries) : 'Split');
      const subTypeVal = getCol(cols, cSubType) || (productSeries ? deriveSubType(productSeries) : '');

      // Model/Series: prefer direct column, fall back to deriving from product_series + refrigerant
      const modelSeriesVal = getCol(cols, cModelSeries)
        || (productSeries ? deriveModelSeries(productSeries, refrigerantVal, modelNoVal) : modelNoVal);

      if (!modelSeriesVal) {
        errors.push(`Row ${i + 1}: could not determine Model/Series — skipped`);
        continue;
      }
      const tr = parseFloat(getCol(cols, cCapTR));
      if (isNaN(tr) || tr <= 0) {
        errors.push(`Row ${i + 1} (${modelSeriesVal}): Capacity(TR) must be a positive number — skipped`);
        continue;
      }

      const cfmStr = getCol(cols, cCFM);
      const espStr = getCol(cols, cESP);
      const kwStr  = getCol(cols, cKW);
      const eerStr = getCol(cols, cEER);
      const copStr = getCol(cols, cCOP);
      const minStr = getCol(cols, cMinConn);
      const maxStr = getCol(cols, cMaxConn);
      const descVal = getCol(cols, cDesc) || (modelNoVal ? `Model: ${modelNoVal}` : '');

      valid.push({
        brand:       brandVal,
        type:        typeVal as EquipmentModel['type'],
        modelSeries: modelSeriesVal,
        capacityTR:  tr,
        capacityBTU: Math.round(tr * 12000),
        ...(subTypeVal           && { subType: subTypeVal }),
        ...(cfmStr               && { ratedAirflowCFM: parseFloat(cfmStr) || undefined }),
        ...(espStr               && { staticPressurePa: parseFloat(espStr) || undefined }),
        ...(kwStr                && { powerInputKW: parseFloat(kwStr) || undefined }),
        ...(eerStr               && { eer: parseFloat(eerStr) || undefined }),
        ...(copStr               && { cop: parseFloat(copStr) || undefined }),
        ...(refrigerantVal       && { refrigerant: refrigerantVal }),
        ...(getCol(cols, cDischarge)  && { dischargeType: getCol(cols, cDischarge) as 'top' | 'side' }),
        ...(getCol(cols, cCompressor) && { compressorType: getCol(cols, cCompressor) as 'heat-pump' | 'cooling-only' }),
        ...(minStr               && { minConnectionPct: parseFloat(minStr) || undefined }),
        ...(maxStr               && { maxConnectionPct: parseFloat(maxStr) || undefined }),
        ...(descVal              && { description: descVal }),
      });
    }
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

  return { added, errors, mode: isTemplateFormat ? 'template' : 'manufacturer' };
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

// ─── Legacy Cleanup ──────────────────────────────────────────────────────────

/**
 * Deletes all documents from the two legacy equipment collections.
 * Call only after migrating any items you want to keep.
 * Returns { deleted } count.
 */
export async function deleteAllLegacyEquipment(): Promise<{ deleted: number }> {
  const LEGACY_COLLECTIONS = ['customEquipmentCatalog', 'customEquipment'];
  const BATCH_SIZE = 400;
  let deleted = 0;

  for (const col of LEGACY_COLLECTIONS) {
    let snap;
    try {
      snap = await getDocs(collection(db, col));
    } catch {
      continue;
    }
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
      await batch.commit();
      deleted += docs.slice(i, i + BATCH_SIZE).length;
    }
  }
  return { deleted };
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
