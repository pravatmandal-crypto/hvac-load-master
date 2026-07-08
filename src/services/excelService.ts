// ============================================================================
// excelService.ts — HVAC Load Master
// Professional multi-sheet Excel workbook for client / consultant submission
//
// Sheet order:
//   1. Cover               — project summary, totals, design conditions
//   2. Design Conditions   — full seasonal conditions + safety factors
//   3. Zone Summary        — zone-level aggregated loads + equipment fit
//   4. Equipment Schedule  — all installed equipment (ODU / IDU / Chiller)
//   5. Load Summary        — room-by-room summary table
//   6+. Room sheets        — individual room heat load calculations
// ============================================================================

import * as XLSX from 'xlsx';
import {
  calculatePsychrometrics,
  calculateRoomArea,
  calculateRoomVolume,
  computeRoomLoad,
  type DesignConditions,
  type EnvelopeElement,
  buildAirflowSchedule,
  type AirflowZoneInput,
} from '../lib/hvac';

// ─── Types ────────────────────────────────────────────────────────────────────

type SeasonResult = {
  area: number; volume: number;
  ventCfm: number; ventSensible: number; ventLatent: number;
  internalSensible: number; internalLatent: number;
  envelopeSensible: number; envelopeLatent: number;
  ductGain: number; fanGain: number;
  ersh: number; erlh: number;
  coilSensible: number; coilLatent: number;
  grandTotal: number; totalTR: number;
  totalSupplyCFM: number; designSupplyCFM: number;
  selectedAdp: number; dehumidSensibleCfm: number; latentCfm: number;
  latentShortfallCfm: number; reheatRequiredBtu: number;
  heatingLoad: number;
};

type WinterResult = { total: number; envelope: number; internal: number; vent: number };

type RoomRecord = {
  room: any;
  zoneId: string; zoneName: string; systemName: string;
  sheetName: string;
  elements: EnvelopeElement[];
  zoneOrSystem: any;
  summer: SeasonResult;
  monsoon?: SeasonResult;
  winter: WinterResult;
  governingTR: number;
};

type RoomSheetRefs = {
  sheetName: string;
  zoneName: string; systemName: string;
  roomName: string; floorName: string;
  areaCell: string; heightCell: string; falseCeilingCell: string;
  freshAirCell: string; occupancyCell: string;
  lightingCell: string; equipKwCell: string;
  summerTrCell: string; summerCfmCell: string;
  monsoonTrCell?: string; monsoonCfmCell?: string;
  winterLoadCell: string; governingTrCell: string;
  // TFA/DOAS split — present only on rooms served by a DOAS/TFA unit.
  tfaTrCell?: string; tfaCfmCell?: string;
  tfaWinterHeatCell?: string; // TFA fresh-air winter heating coil (BTU/h)
  iduConfigCell: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const BF = 0.15;
const ORIENTATIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

// ─── Color palette ────────────────────────────────────────────────────────────

const CLR = {
  navyBg: '1F4E79',   navyFg: 'FFFFFF',
  blueBg: '2E75B6',   blueFg: 'FFFFFF',
  tealBg: '17596B',   tealFg: 'FFFFFF',
  greenBg: '375623',  greenFg: 'FFFFFF',
  purpleBg: '7030A0', purpleFg: 'FFFFFF',
  amberBg: 'C55A11',  amberFg: 'FFFFFF',
  headerBg: 'BDD7EE',
  sectionBg: 'DEEAF1',
  inputBg: 'FFF2CC',
  totalBg: 'D9E1F2',
  okBg: 'E2EFDA',    okFg: '375623',
  warnBg: 'FCE4D6',  warnFg: 'C00000',
  overBg: 'FFEB9C',  overFg: '7F6000',
  border: 'B8CCE4',
};

// ─── Number / string helpers ──────────────────────────────────────────────────

const asNum = (v: any, fb = 0): number => { const n = Number(v); return isFinite(n) ? n : fb; };
const r2 = (v: number) => Math.round(v * 100) / 100;
const r0 = (v: number) => Math.round(v);

// Per-zone dehumidification strategy (set in Equipment Selection) — lets the room sheet show a
// latent shortfall as RESOLVED by the engineer's chosen reheat/desiccant instead of an open flag.
const DEHUMID_REHEAT_LABELS: Record<string, string> = {
  'reheat-hwc': 'AHU Heating Coil (HW)',
  'reheat-electric-ahu': 'AHU Electric Heater',
  'reheat-duct': 'Duct Heater',
  'standalone': 'Standalone Desiccant / DX',
};
const isReheatMethod = (m?: string | null): boolean =>
  m === 'reheat-hwc' || m === 'reheat-electric-ahu' || m === 'reheat-duct';
const resolveRoomDehumid = (room: any, systems: any[]): { method: string; reheatKW: number | null; label: string } | null => {
  for (const sys of systems || []) {
    const inSys = room?.systemId === sys.id || room?.zoneId === sys.id || room?.hvacSystemId === sys.id
      || ((sys.zones ?? []) as any[]).some((z: any) => (z.roomIds ?? []).includes(room?.id));
    if (!inSys) continue;
    const zone = ((sys.zones ?? []) as any[]).find((z: any) => z.id === room?.zoneId || (z.roomIds ?? []).includes(room?.id));
    const method = (zone?.dehumidMethod ?? sys.dehumidMethod) as string | null | undefined;
    if (!method) return null;
    const reheatKW = Number(zone?.dehumidReheatKW ?? zone?.fahu?.electricHeaterKW ?? sys.dehumidReheatKW) || null;
    return { method, reheatKW, label: DEHUMID_REHEAT_LABELS[method] ?? method };
  }
  return null;
};
const safeStr = (v: any, fb = ''): string => (v == null || v === '' ? fb : String(v));

// Report identity stamp — engineer-controlled date + stable No./revision, set per export.
// Keeps the Excel workbook consistent with the PDF and makes duplicate copies identifiable.
let excelStamp: { date: Date; id: string; rev: string } = { date: new Date(), id: '', rev: '' };
const buildExcelStamp = (project: any) => {
  const raw = project?.reportDate;
  const parsed = raw ? new Date(`${raw}T00:00:00`) : null;
  excelStamp = {
    date: parsed && !isNaN(parsed.getTime()) ? parsed : new Date(),
    id: safeStr(project?.reportId),
    rev: project?.reportRev != null ? `R${project.reportRev}` : '',
  };
};

const fmtDate = (d = excelStamp.date) =>
  `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
const fmtDateFile = (d = excelStamp.date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const toGR = (hr: number) => hr * 7000;

// ─── Cell / sheet helpers ─────────────────────────────────────────────────────

// 1-based row & col → "A1" address
const rc = (row: number, col: number) => XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });

function putV(ws: XLSX.WorkSheet, row: number, col: number, val: any, sty?: any): void {
  const addr = rc(row, col);
  const t = typeof val === 'number' ? 'n' : 's';
  ws[addr] = { t: (val == null || val === '') ? 's' : t, v: val ?? '', ...(sty ? { s: sty } : {}) };
}

function putF(ws: XLSX.WorkSheet, row: number, col: number, formula: string, t: 'n' | 's' = 'n', sty?: any): void {
  ws[rc(row, col)] = { t, f: formula, ...(sty ? { s: sty } : {}) };
}

function addMerge(ws: XLSX.WorkSheet, r1: number, c1: number, r2: number, c2: number): void {
  if (!ws['!merges']) ws['!merges'] = [];
  ws['!merges'].push({ s: { r: r1 - 1, c: c1 - 1 }, e: { r: r2 - 1, c: c2 - 1 } });
}

function addBorders(ws: XLSX.WorkSheet, r1: number, c1: number, r2: number, c2: number): void {
  const thin = { style: 'thin', color: { rgb: CLR.border } };
  const b = { top: thin, bottom: thin, left: thin, right: thin };
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const addr = rc(r, c);
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      ws[addr].s = { ...(ws[addr].s || {}), border: b };
    }
  }
}

function shRef(sheetName: string, cell: string): string {
  return `'${sheetName.replace(/'/g, "''")}'!${cell}`;
}

function setRef(ws: XLSX.WorkSheet, maxRow: number, maxCol: number): void {
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow - 1, c: maxCol - 1 } });
}

// ─── Style factory ────────────────────────────────────────────────────────────

function mkS(fontOpts: any, fillRgb?: string, align?: any): any {
  const s: any = { font: { name: 'Arial', sz: 10, ...fontOpts }, alignment: align ?? {} };
  if (fillRgb) s.fill = { fgColor: { rgb: fillRgb } };
  return s;
}

const S = {
  titleLg:  mkS({ sz: 16, bold: true,  color: { rgb: CLR.navyFg  } }, CLR.navyBg,   { horizontal: 'center', vertical: 'center', wrapText: true }),
  titleSm:  mkS({ sz: 11, bold: true,  color: { rgb: CLR.navyFg  } }, CLR.navyBg,   { horizontal: 'center', vertical: 'center' }),
  coverSub: mkS({ sz: 11, bold: false, color: { rgb: CLR.navyFg  } }, CLR.navyBg,   { horizontal: 'center' }),
  secHdr:   mkS({ sz: 10, bold: true,  color: { rgb: CLR.blueFg  } }, CLR.blueBg,   { wrapText: true }),
  tealHdr:  mkS({ sz: 10, bold: true,  color: { rgb: CLR.tealFg  } }, CLR.tealBg,   { wrapText: true }),
  greenHdr: mkS({ sz: 10, bold: true,  color: { rgb: CLR.greenFg } }, CLR.greenBg,  { wrapText: true }),
  purpleHdr:mkS({ sz: 10, bold: true,  color: { rgb: CLR.purpleFg} }, CLR.purpleBg, { wrapText: true }),
  amberHdr: mkS({ sz: 10, bold: true,  color: { rgb: CLR.amberFg } }, CLR.amberBg,  { wrapText: true }),
  tableHdr: mkS({ sz: 9,  bold: true  }, CLR.headerBg, { horizontal: 'center', wrapText: true }),
  label:    mkS({ sz: 9,  bold: true  }),
  labelC:   mkS({ sz: 9,  bold: true  }, undefined, { horizontal: 'center' }),
  input:    mkS({ sz: 9,  color: { rgb: '1F4E79' } }, CLR.inputBg),
  calc:     mkS({ sz: 9  }),
  calcC:    mkS({ sz: 9  }, undefined, { horizontal: 'center' }),
  calcR:    mkS({ sz: 9  }, undefined, { horizontal: 'right'  }),
  total:    mkS({ sz: 9,  bold: true  }, CLR.totalBg),
  totalC:   mkS({ sz: 9,  bold: true  }, CLR.totalBg, { horizontal: 'center' }),
  sub:      mkS({ sz: 9              }, CLR.sectionBg),
  ok:       mkS({ sz: 9,  bold: true,  color: { rgb: CLR.okFg   } }, CLR.okBg,   { horizontal: 'center' }),
  warn:     mkS({ sz: 9,  bold: true,  color: { rgb: CLR.warnFg } }, CLR.warnBg, { horizontal: 'center' }),
  over:     mkS({ sz: 9,  bold: true,  color: { rgb: CLR.overFg } }, CLR.overBg, { horizontal: 'center' }),
  note:     mkS({ sz: 8,  italic: true, color: { rgb: '666666'  } }, undefined, { wrapText: true }),
};

// ─── Equipment helpers ────────────────────────────────────────────────────────

function normalizeIDUList(val: any): any[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function getRoomEquipment(roomId: string, equipSystems: any[]): Array<{ role: string; brand: string; model: string; tr: number; cfm: number; qty: number; note: string }> {
  const result: any[] = [];
  for (const sys of equipSystems || []) {
    for (const u of normalizeIDUList((sys.iduSelections as any)?.[roomId])) {
      result.push({ role: 'IDU', brand: safeStr(u.brand), model: safeStr(u.modelId), tr: asNum(u.trCapacity), cfm: asNum(u.cfmRated), qty: asNum(u.quantity, 1), note: '' });
    }
    for (const u of (sys.roomSelections?.[roomId] ?? [])) {
      result.push({ role: 'IDU', brand: safeStr(u.brand), model: safeStr(u.modelId), tr: asNum(u.trCapacity), cfm: asNum(u.cfmRated), qty: asNum(u.quantity, 1), note: '' });
    }
    for (const z of (sys.zones ?? [])) {
      if (!(z.roomIds ?? []).includes(roomId)) continue;
      const n = (z.roomIds ?? []).length;
      const note = n > 1 ? `Zone unit — shared (${n} rooms)` : 'Zone unit';
      const units = (z.unitSelections ?? []).length ? z.unitSelections : z.selection ? [z.selection] : [];
      for (const u of units) {
        result.push({ role: 'IDU/AHU', brand: safeStr(u.brand), model: safeStr(u.modelId), tr: asNum(u.trCapacity), cfm: asNum(u.cfmRated), qty: asNum(u.quantity, 1), note });
      }
    }
  }
  return result;
}

type EqLine = { system: string; zone: string; room: string; role: string; brand: string; model: string; tr: number; cfm: number; qty: number; totalTR: number; totalCFM: number; notes: string };

function buildEquipmentLines(equipSystems: any[], allRooms: Record<string, any[]>): EqLine[] {
  const lines: EqLine[] = [];
  const roomById: Record<string, any> = {};
  for (const rList of Object.values(allRooms || {})) {
    for (const r of rList) { if (r?.id) roomById[r.id] = r; }
  }

  for (const sys of equipSystems || []) {
    const sysName = safeStr(sys.name, 'System');
    const sysType = safeStr(sys.type);

    // ODU (VRF)
    if (sys.oduSelection) {
      const o = sys.oduSelection;
      const qty = asNum(o.modules, 1);
      const tr  = asNum(o.effectiveTR || o.trCapacity);
      lines.push({ system: sysName, zone: '—', room: '—', role: 'ODU', brand: safeStr(o.brand), model: safeStr(o.modelId), tr: asNum(o.trCapacity), cfm: 0, qty, totalTR: tr * qty, totalCFM: 0, notes: safeStr(o.dischargeType) + (o.compressorType ? ` / ${o.compressorType}` : '') });
    }
    // ODU combination (VRF multi-ODU)
    for (const o of (sys.oduSelection?.combination ?? [])) {
      lines.push({ system: sysName, zone: '—', room: '—', role: 'ODU', brand: safeStr(o.brand), model: safeStr(o.modelId), tr: asNum(o.trCapacity), cfm: 0, qty: asNum(o.quantity, 1), totalTR: asNum(o.trCapacity) * asNum(o.quantity, 1), totalCFM: 0, notes: '' });
    }

    // Chiller units
    for (const o of (sys.chillerUnits ?? [])) {
      const roleNote = o.role === 'standby' ? 'Standby' : (o.role === 'working' ? 'Working (Duty)' : '');
      lines.push({ system: sysName, zone: 'Plant', room: '—', role: 'Chiller', brand: safeStr(o.brand), model: safeStr(o.modelId), tr: asNum(o.trCapacity), cfm: 0, qty: asNum(o.quantity, 1), totalTR: asNum(o.trCapacity) * asNum(o.quantity, 1), totalCFM: 0, notes: roleNote });
    }

    // Cooling tower — new ctUnits[] array supersedes legacy ctSelection
    const ctList = ((sys as any).ctUnits?.length ? (sys as any).ctUnits : (sys.ctSelection ? [sys.ctSelection] : []));
    for (const o of ctList) {
      const roleNote = o.role === 'standby' ? 'Standby' : (o.role === 'working' ? 'Working (Duty)' : '');
      lines.push({ system: sysName, zone: 'Plant', room: '—', role: 'Cooling Tower', brand: safeStr(o.brand), model: safeStr(o.modelId), tr: asNum(o.trCapacity), cfm: asNum(o.cfmRated), qty: asNum(o.quantity, 1), totalTR: asNum(o.trCapacity) * asNum(o.quantity, 1), totalCFM: asNum(o.cfmRated) * asNum(o.quantity, 1), notes: roleNote });
    }

    // AHU DX condensing units
    const ahuUnits = (sys as any).ahuUnits?.length ? (sys as any).ahuUnits : sys.unitSelection && sysType === 'AHU' ? [sys.unitSelection] : [];
    for (const o of ahuUnits) {
      lines.push({ system: sysName, zone: 'Plant', room: '—', role: 'AHU Condensing Unit', brand: safeStr(o.brand), model: safeStr(o.modelId), tr: asNum(o.trCapacity), cfm: asNum(o.cfmRated), qty: asNum(o.quantity, 1), totalTR: asNum(o.trCapacity) * asNum(o.quantity, 1), totalCFM: asNum(o.cfmRated) * asNum(o.quantity, 1), notes: '' });
    }

    // Package / DuctableSplit single unit (if not already captured via zones)
    if (!ahuUnits.length && sys.unitSelection && sysType !== 'AHU') {
      const o = sys.unitSelection;
      lines.push({ system: sysName, zone: '—', room: '—', role: `${sysType} Unit`, brand: safeStr(o.brand), model: safeStr(o.modelId), tr: asNum(o.trCapacity), cfm: asNum(o.cfmRated), qty: asNum(o.quantity, 1), totalTR: asNum(o.trCapacity) * asNum(o.quantity, 1), totalCFM: asNum(o.cfmRated) * asNum(o.quantity, 1), notes: '' });
    }

    // Zone-level IDU / AHU (Chiller, Package, DuctableSplit)
    for (const z of (sys.zones ?? [])) {
      const zoneName = safeStr(z.name, 'Zone');
      const units = (z.unitSelections ?? []).length ? z.unitSelections : z.selection ? [z.selection] : [];
      for (const u of units) {
        const qty = asNum(u.quantity, 1);
        lines.push({ system: sysName, zone: zoneName, room: '—', role: 'IDU/AHU', brand: safeStr(u.brand), model: safeStr(u.modelId), tr: asNum(u.trCapacity), cfm: asNum(u.cfmRated), qty, totalTR: asNum(u.trCapacity) * qty, totalCFM: asNum(u.cfmRated) * qty, notes: '' });
      }
    }

    // VRF IDU per room
    for (const [roomId, val] of Object.entries(sys.iduSelections ?? {})) {
      for (const u of normalizeIDUList(val)) {
        const rName = safeStr(roomById[roomId]?.name, roomId);
        const qty = asNum((u as any).quantity, 1);
        lines.push({ system: sysName, zone: '—', room: rName, role: 'VRF IDU', brand: safeStr((u as any).brand), model: safeStr((u as any).modelId), tr: asNum((u as any).trCapacity), cfm: asNum((u as any).cfmRated), qty, totalTR: asNum((u as any).trCapacity) * qty, totalCFM: asNum((u as any).cfmRated) * qty, notes: safeStr((u as any).subType) });
      }
    }

    // Split per room
    for (const [roomId, units] of Object.entries(sys.roomSelections ?? {})) {
      for (const u of (units as any[])) {
        const rName = safeStr(roomById[roomId]?.name, roomId);
        const qty = asNum((u as any).quantity, 1);
        lines.push({ system: sysName, zone: '—', room: rName, role: 'Split IDU', brand: safeStr((u as any).brand), model: safeStr((u as any).modelId), tr: asNum((u as any).trCapacity), cfm: asNum((u as any).cfmRated), qty, totalTR: asNum((u as any).trCapacity) * qty, totalCFM: asNum((u as any).cfmRated) * qty, notes: '' });
      }
    }
  }
  return lines;
}

// ─── Psychrometrics helpers ───────────────────────────────────────────────────

function getProjectPsychro(project: any, season: 'summer' | 'monsoon') {
  const m = season === 'monsoon';
  const odb = asNum(m ? project?.monsoonDesignTemp   : project?.summerDesignTemp,   m ? 95 : 95);
  const orh = asNum(m ? project?.monsoonDesignHumidity : project?.summerDesignHumidity, m ? 85 : 50);
  const idb = asNum(m ? project?.insideMonsoonTemp   : project?.insideSummerTemp,   75);
  const irh = asNum(m ? project?.insideMonsoonHumidity : project?.insideSummerHumidity, m ? 55 : 50);
  const alt = asNum(project?.altitude, 0);
  const owb = asNum(m ? project?.outsideMonsoonWB    : project?.outsideSummerWB,    0);
  const iwb = asNum(m ? project?.insideMonsoonWB     : project?.insideSummerWB,     0);
  const out = calculatePsychrometrics(odb, orh, alt);
  const inn = calculatePsychrometrics(idb, irh, alt);
  return {
    outside: { db: odb, rh: orh, wb: owb, th: r2(out.enthalpy), gr: r2(toGR(out.humidityRatio)) },
    inside:  { db: idb, rh: irh, wb: iwb, th: r2(inn.enthalpy), gr: r2(toGR(inn.humidityRatio)) },
  };
}

function getDesignConditions(project: any, zos: any, season: 'summer' | 'monsoon'): DesignConditions {
  const m = season === 'monsoon';
  return {
    outdoorTemp:      asNum(zos?.outdoorTemp,      asNum(m ? project?.monsoonDesignTemp     : project?.summerDesignTemp,     95)),
    indoorTemp:       asNum(zos?.indoorTemp,       asNum(m ? project?.insideMonsoonTemp     : project?.insideSummerTemp,     75)),
    outdoorHumidity:  asNum(zos?.outdoorHumidity,  asNum(m ? project?.monsoonDesignHumidity : project?.summerDesignHumidity, m ? 85 : 50)),
    indoorHumidity:   asNum(zos?.indoorHumidity,   asNum(m ? project?.insideMonsoonHumidity : project?.insideSummerHumidity, m ? 55 : 50)),
    winterOutdoorTemp:     asNum(project?.winterDesignTemp,    50),
    winterOutdoorHumidity: asNum(project?.winterDesignHumidity, 80),
    winterIndoorTemp:      asNum(zos?.winterIndoorTemp  ?? project?.insideWinterTemp,  72),
    winterIndoorHumidity:  asNum(zos?.winterIndoorHumidity ?? project?.insideWinterHumidity, 40),
    altitude: asNum(project?.altitude, 0),
  };
}

function calcSeason(project: any, zos: any, room: any, elements: EnvelopeElement[], season: 'summer' | 'monsoon', equipSystems: any[] = []): SeasonResult {
  const dc0 = getDesignConditions(project, zos, season);
  // Single shared engine — resolves TFA/DOAS from equipSystems and runs the same
  // envelope→internal→vent→TFA-credit→coil→resolveSupplyCfm sequence as the report/app.
  // (Step-2 consolidation 2026-07-08; was a hand-copied duplicate.)
  const r = computeRoomLoad(room, elements, dc0, { equipSystems, project });
  const oPct = asNum(room.overallSafetyPercent ?? room.grandTotalSafetyFactor, 3);

  const area   = calculateRoomArea(room);
  const volume = calculateRoomVolume(room);
  // Excel's grand total / TR carry the overall safety factor (its "Governing TR" =
  // load ÷ 12,000 × safety = the app's requiredTR). Preserve that presentation.
  const grand  = r.grandTotal * (1 + oPct / 100);

  return {
    area, volume, ventCfm: r.vent.cfm, ventSensible: r.vent.sensible, ventLatent: r.vent.latent,
    internalSensible: r.internal.sensible, internalLatent: r.internal.latent,
    envelopeSensible: r.envelope.sensible, envelopeLatent: r.envelope.latent,
    ductGain: r.parasitic.ductGain, fanGain: r.parasitic.fanGain,
    ersh: r.ersh, erlh: r.erlh, coilSensible: r.coilSensible, coilLatent: r.coilLatent,
    grandTotal: grand, totalTR: grand / 12000,
    totalSupplyCFM: r.totalSupplyCfm, designSupplyCFM: r.designCfm,
    selectedAdp: r.coil.selectedADP,
    dehumidSensibleCfm: r.coil.dehumidifiedCFM,
    latentCfm: r.coil.latentCFM,
    latentShortfallCfm: r.coil.latentShortfallCFM,
    reheatRequiredBtu: r.coil.reheatRequiredBTU,
    heatingLoad: r.heating.totalHeatingLoad,
  };
}

function calcWinter(project: any, zos: any, room: any, elements: EnvelopeElement[], equipSystems: any[] = []): WinterResult {
  const dc: DesignConditions = {
    outdoorTemp:      asNum(project?.winterDesignTemp, 50),
    indoorTemp:       asNum(zos?.winterIndoorTemp  ?? project?.insideWinterTemp,  72),
    outdoorHumidity:  asNum(project?.winterDesignHumidity, 80),
    indoorHumidity:   asNum(zos?.winterIndoorHumidity ?? project?.insideWinterHumidity, 40),
    winterOutdoorTemp:     asNum(project?.winterDesignTemp, 50),
    winterOutdoorHumidity: asNum(project?.winterDesignHumidity, 80),
    winterIndoorTemp:      asNum(zos?.winterIndoorTemp  ?? project?.insideWinterTemp,  72),
    winterIndoorHumidity:  asNum(zos?.winterIndoorHumidity ?? project?.insideWinterHumidity, 40),
    altitude: asNum(project?.altitude, 0),
  };
  // Shared engine so winter heating is TFA-aware: a DOAS-served room heats only genuine
  // infiltration (winterInfiltrationACH), not the full FACPH the DOAS coil already tempers
  // — same correctness fix as the report (R85 #6). Previously this used the raw DC and
  // double-counted the fresh-air heating for DOAS rooms.
  const r = computeRoomLoad(room, elements, dc, { equipSystems, project });
  return { total: r.heating.totalHeatingLoad, envelope: r.envelope.sensible, internal: r.internal.sensible, vent: r.vent.sensible };
}

// ─── Sheet-name deduplication ─────────────────────────────────────────────────

const sanitizeSheetName = (s: string) => s.replace(/[\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim();

function makeUnique(preferred: string, used: Set<string>): string {
  const base = sanitizeSheetName(preferred) || 'Room';
  let candidate = base.slice(0, 31);
  let n = 1;
  while (used.has(candidate)) {
    const sfx = `_${n++}`;
    candidate = `${base.slice(0, 31 - sfx.length)}${sfx}`;
  }
  used.add(candidate);
  return candidate;
}

// ─── toRoomRecords ────────────────────────────────────────────────────────────

function toRoomRecords(
  project: any, systems: any[], zones: any[],
  rooms: Record<string, any[]>, elements: Record<string, EnvelopeElement[]>,
  equipSystems: any[] = [],
): RoomRecord[] {
  const sysById  = new Map((systems || []).map(s => [s.id, s]));
  const zoneById = new Map((zones   || []).map(z => [z.id, z]));
  const FIXED_NAMES = new Set(['Cover', 'Design Conditions', 'Zone Summary', 'Equipment Schedule', 'Load Summary']);
  const used = new Set<string>(FIXED_NAMES);
  const records: RoomRecord[] = [];

  for (const groupId of Object.keys(rooms || {}).sort()) {
    const zone    = zoneById.get(groupId);
    const sys     = sysById.get(groupId);
    const zos     = zone || sys || {};
    const zoneName   = safeStr(zone?.name || sys?.name, 'Unassigned');
    const systemName = safeStr(zone?.systemId ? sysById.get(zone.systemId)?.name || 'Standalone' : sys?.name, 'Standalone');

    for (const room of (rooms[groupId] || [])) {
      const sheetName = makeUnique(`${zoneName}_${safeStr(room?.name, 'Room')}`, used);
      const els = elements?.[room.id] ?? [];
      const sum = calcSeason(project, zos, room, els, 'summer', equipSystems);
      const mon = project?.includeMonsoon ? calcSeason(project, zos, room, els, 'monsoon', equipSystems) : undefined;
      const win = calcWinter(project, zos, room, els, equipSystems);

      // Plant TR is load-only — CFM/TR is a sanity ratio, not a sizing input.
      // (Engine decision: 2026-05-20.)
      const sumGovTR = sum.totalTR;
      const monGovTR = mon ? mon.totalTR : 0;
      const govTR    = Math.max(sumGovTR, monGovTR);

      records.push({ room, zoneId: groupId, zoneName, systemName, sheetName, elements: els, zoneOrSystem: zos, summer: sum, monsoon: mon, winter: win, governingTR: govTR });
    }
  }

  return records.sort((a, b) =>
    `${a.systemName}|${a.zoneName}|${a.room?.name ?? ''}`.localeCompare(`${b.systemName}|${b.zoneName}|${b.room?.name ?? ''}`),
  );
}

// ─── Sheet 1: Cover ───────────────────────────────────────────────────────────

function buildCoverSheet(project: any, records: RoomRecord[], equipSystems: any[], userProfile?: any): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const COLS = 8;
  let row = 1;

  // Title block
  addMerge(ws, row, 1, row + 2, COLS);
  putV(ws, row, 1, safeStr(project?.name, 'PROJECT').toUpperCase(), S.titleLg);
  row += 3;
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, 'Air Conditioning — Heat Load Calculation Report', S.coverSub);
  row++;
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, `Prepared as per ASHRAE 2017 Handbook of Fundamentals — CLTD Method`, S.coverSub);
  row += 2;

  // Project details
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, 'PROJECT DETAILS', S.secHdr);
  row++;

  const engName = safeStr(userProfile?.displayName || userProfile?.email || project?.engineerName || project?.estimatedBy, 'Design Engineer');
  const details: [string, string][] = [
    ['Project Name',     safeStr(project?.name)],
    ['Location',         safeStr(project?.location || project?.place, '—')],
    ['Altitude',         `${asNum(project?.altitude, 0)} m above MSL`],
    ['Activity Hours',   safeStr(project?.activityHours, 'As per occupancy schedule')],
    ['Peak Load Period',  safeStr(project?.peakLoadTime, 'April — 16:00 hrs')],
    ['Design Standard',  'ASHRAE 2017 HoF — CLTD / CSHGF / CLF Method'],
    ['Prepared By',      engName],
    ['Report No.',       excelStamp.id || '—'],
    ['Revision',         excelStamp.rev || 'R0'],
    ['Report Date',      fmtDate()],
  ];
  const detailStart = row;
  for (const [k, v] of details) {
    putV(ws, row, 1, k, S.label);
    addMerge(ws, row, 2, row, 5);
    putV(ws, row, 2, v, S.calc);
    row++;
  }
  addBorders(ws, detailStart, 1, row - 1, 5);
  row++;

  // Design conditions
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, 'DESIGN CONDITIONS SUMMARY', S.secHdr);
  row++;
  const condHdrs = ['Condition', 'DB (°F)', '% RH', 'WB (°F)', 'Enthalpy\n(BTU/lb)', 'Humidity\nRatio (GR/LB)'];
  condHdrs.forEach((h, i) => putV(ws, row, i + 1, h, S.tableHdr));
  row++;
  const condStart = row;

  const sumP = getProjectPsychro(project, 'summer');
  const monP = project?.includeMonsoon ? getProjectPsychro(project, 'monsoon') : null;
  const wODB = asNum(project?.winterDesignTemp, 50);
  const wORH = asNum(project?.winterDesignHumidity, 80);
  const wIDB = asNum(project?.insideWinterTemp,  72);
  const wIRH = asNum(project?.insideWinterHumidity, 40);
  const wOut = calculatePsychrometrics(wODB, wORH, asNum(project?.altitude));
  const wIn  = calculatePsychrometrics(wIDB, wIRH, asNum(project?.altitude));

  const condRows: [string, (number | string)[]][] = [
    ['Summer — Outdoor', [sumP.outside.db, sumP.outside.rh, sumP.outside.wb, sumP.outside.th, sumP.outside.gr]],
    ['Summer — Indoor',  [sumP.inside.db,  sumP.inside.rh,  sumP.inside.wb,  sumP.inside.th,  sumP.inside.gr]],
  ];
  if (monP) {
    condRows.push(['Monsoon — Outdoor', [monP.outside.db, monP.outside.rh, monP.outside.wb, monP.outside.th, monP.outside.gr]]);
    condRows.push(['Monsoon — Indoor',  [monP.inside.db,  monP.inside.rh,  monP.inside.wb,  monP.inside.th,  monP.inside.gr]]);
  }
  condRows.push(['Winter — Outdoor', [wODB, wORH, '—', r2(wOut.enthalpy), r2(toGR(wOut.humidityRatio))]]);
  condRows.push(['Winter — Indoor',  [wIDB, wIRH, '—', r2(wIn.enthalpy),  r2(toGR(wIn.humidityRatio))]]);

  for (const [label, vals] of condRows) {
    putV(ws, row, 1, label, S.label);
    vals.forEach((v, i) => putV(ws, row, i + 2, v, S.calc));
    row++;
  }
  addBorders(ws, condStart, 1, row - 1, 6);
  row++;

  // Load summary
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, 'PROJECT LOAD SUMMARY', S.tealHdr);
  row++;
  putV(ws, row, 1, 'Parameter', S.tableHdr);
  putV(ws, row, 2, 'Value', S.tableHdr);
  putV(ws, row, 3, 'Unit', S.tableHdr);
  putV(ws, row, 4, 'Remarks', S.tableHdr);
  addMerge(ws, row, 4, row, COLS);
  row++;
  const loadStart = row;

  let totSumBTUH = 0, totSumCFM = 0, totMonBTUH = 0, totMonCFM = 0, totWin = 0, totArea = 0, totTfaWinHeat = 0;
  for (const rec of records) {
    totSumBTUH += rec.summer.grandTotal;
    totSumCFM  += rec.summer.designSupplyCFM;
    totMonBTUH += rec.monsoon?.grandTotal ?? 0;
    totMonCFM  += rec.monsoon?.designSupplyCFM ?? 0;
    totWin     += rec.winter.total;
    totTfaWinHeat += Number(rec.room?._calcTfaWinterHeatingBTUH) || 0;
    totArea    += rec.summer.area;
  }
  const sumGovTR = totSumBTUH / 12000;
  const monGovTR = project?.includeMonsoon ? totMonBTUH / 12000 : 0;
  const govTR    = Math.max(sumGovTR, monGovTR);
  const govCFM   = Math.max(totSumCFM, totMonCFM);
  const cfmPerTR = govTR > 0 ? govCFM / govTR : 0;

  const loadRows: [string, any, string, string][] = [
    ['Total Conditioned Area',     r0(totArea),              'Sq.Ft',  ''],
    ['Total No. of Spaces / Rooms', records.length,          'Nos.',   ''],
    ['Summer Cooling Load',         r0(totSumBTUH / 12000),  'TR',     'Load TR = Total BTUh ÷ 12,000'],
    ['Summer Design Airflow',       r0(totSumCFM),            'CFM',   ''],
    ...(project?.includeMonsoon ? [['Monsoon Cooling Load', r0(totMonBTUH / 12000), 'TR', ''] as [string, any, string, string]] : []),
    ['Plant Cooling Capacity',      r2(govTR),                'TR',    'Coil load basis — MAX(Summer, Monsoon)'],
    ['Design Airflow (Plant)',      r0(govCFM),               'CFM',   `Sanity: ${r0(cfmPerTR)} CFM/TR (typical 350–450)`],
    ['Total Winter Heating Load',   r0(totWin),               'BTU/h', 'Space heating (envelope + infiltration)'],
    ...(totTfaWinHeat > 0 ? [['Total TFA Fresh-Air Heating Coil', r0(totTfaWinHeat), 'BTU/h', 'DOAS winter OA-temper duty'] as [string, any, string, string]] : []),
  ];
  for (const [k, v, u, rem] of loadRows) {
    const isBasis = k.includes('Governing');
    putV(ws, row, 1, k,   isBasis ? S.total : S.label);
    putV(ws, row, 2, v,   isBasis ? S.total : S.calc);
    putV(ws, row, 3, u,   isBasis ? S.total : S.calc);
    addMerge(ws, row, 4, row, COLS);
    putV(ws, row, 4, rem, isBasis ? S.total : S.note);
    row++;
  }
  addBorders(ws, loadStart, 1, row - 1, COLS);
  row++;

  // Workbook contents
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, 'WORKBOOK CONTENTS', S.secHdr);
  row++;
  const contStart = row;
  const contents: [string, string][] = [
    ['1. Cover',              'Project summary, design conditions, and total load basis'],
    ['2. Design Conditions',  'Full seasonal outdoor/indoor conditions and safety factors applied'],
    ['3. Zone Summary',       'Zone-level aggregated load with installed equipment fit check'],
    ['4. Equipment Schedule', 'Complete installed equipment list — ODU / IDU / AHU / Chiller'],
    ['5. Load Summary',       'Room-by-room summary table with TR, CFM, and governing load'],
    [`6.+ Room Sheets (${records.length})`, 'Individual CLTD heat load calculation for each conditioned space'],
  ];
  putV(ws, row, 1, 'Sheet', S.tableHdr);
  addMerge(ws, row, 2, row, COLS);
  putV(ws, row, 2, 'Description', S.tableHdr);
  row++;
  for (const [sh, desc] of contents) {
    putV(ws, row, 1, sh, S.label);
    addMerge(ws, row, 2, row, COLS);
    putV(ws, row, 2, desc, S.calc);
    row++;
  }
  addBorders(ws, contStart, 1, row - 1, COLS);
  row += 2;

  // Disclaimer
  addMerge(ws, row, 1, row + 1, COLS);
  putV(ws, row, 1,
    'DISCLAIMER: This report is generated by HVAC Load Master. All calculations are based on ASHRAE 2017 CLTD method using the design conditions and safety factors entered for this project. Verify all inputs before use in final design documents.',
    S.note);

  ws['!cols'] = [{ wch: 32 }, { wch: 18 }, { wch: 10 }, { wch: 32 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  ws['!rows'] = [{ hpt: 55 }, { hpt: 35 }, { hpt: 25 }];
  setRef(ws, row + 2, COLS);
  (ws as any)['!pageSetup'] = { paperSize: 9, orientation: 'portrait', fitToWidth: 1, fitToHeight: 0 };
  return ws;
}

// ─── Sheet 2: Design Conditions ───────────────────────────────────────────────

function buildDesignConditionsSheet(project: any): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const COLS = 7;
  let row = 1;

  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, `DESIGN CONDITIONS — ${safeStr(project?.name, 'PROJECT').toUpperCase()}`, S.titleSm);
  row += 2;

  // Helper: write a 2-col label/value row
  const lv = (lbl: string, val: any, unit = '') => {
    putV(ws, row, 1, lbl, S.label);
    putV(ws, row, 2, val, S.calc);
    if (unit) putV(ws, row, 3, unit, S.calc);
    row++;
  };

  // ── Outdoor Design Conditions ──────────────────────────────────────────────
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, 'OUTDOOR DESIGN CONDITIONS', S.secHdr);
  row++;

  const tblStart1 = row;
  ['Parameter', 'Summer', 'Monsoon', 'Winter'].forEach((h, i) => putV(ws, row, i + 1, h, S.tableHdr));
  row++;

  const sumP = getProjectPsychro(project, 'summer');
  const monP = getProjectPsychro(project, 'monsoon');
  const wODB = asNum(project?.winterDesignTemp, 50);
  const wORH = asNum(project?.winterDesignHumidity, 80);
  const wOut = calculatePsychrometrics(wODB, wORH, asNum(project?.altitude));

  const outRows: [string, any, any, any][] = [
    ['Dry Bulb Temperature (°F)',    sumP.outside.db, monP.outside.db, wODB],
    ['Relative Humidity (%)',        sumP.outside.rh, monP.outside.rh, wORH],
    ['Wet Bulb Temperature (°F)',    sumP.outside.wb, monP.outside.wb, '—'],
    ['Enthalpy (BTU/lb)',            sumP.outside.th, monP.outside.th, r2(wOut.enthalpy)],
    ['Humidity Ratio (GR/LB)',       sumP.outside.gr, monP.outside.gr, r2(toGR(wOut.humidityRatio))],
  ];
  for (const [p, s, m, w] of outRows) {
    putV(ws, row, 1, p, S.label);
    putV(ws, row, 2, s, S.calc);
    putV(ws, row, 3, project?.includeMonsoon ? m : '—', S.calc);
    putV(ws, row, 4, w, S.calc);
    row++;
  }
  addBorders(ws, tblStart1, 1, row - 1, 4);
  row++;

  // ── Indoor Design Conditions ───────────────────────────────────────────────
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, 'INDOOR DESIGN CONDITIONS', S.secHdr);
  row++;

  const tblStart2 = row;
  ['Parameter', 'Summer', 'Monsoon', 'Winter'].forEach((h, i) => putV(ws, row, i + 1, h, S.tableHdr));
  row++;

  const wIDB = asNum(project?.insideWinterTemp, 72);
  const wIRH = asNum(project?.insideWinterHumidity, 40);
  const wIn  = calculatePsychrometrics(wIDB, wIRH, asNum(project?.altitude));

  const inRows: [string, any, any, any][] = [
    ['Dry Bulb Temperature (°F)', sumP.inside.db, monP.inside.db, wIDB],
    ['Relative Humidity (%)',     sumP.inside.rh, monP.inside.rh, wIRH],
    ['Wet Bulb Temperature (°F)', sumP.inside.wb, monP.inside.wb, '—'],
    ['Enthalpy (BTU/lb)',         sumP.inside.th, monP.inside.th, r2(wIn.enthalpy)],
    ['Humidity Ratio (GR/LB)',    sumP.inside.gr, monP.inside.gr, r2(toGR(wIn.humidityRatio))],
  ];
  for (const [p, s, m, w] of inRows) {
    putV(ws, row, 1, p, S.label);
    putV(ws, row, 2, s, S.calc);
    putV(ws, row, 3, project?.includeMonsoon ? m : '—', S.calc);
    putV(ws, row, 4, w, S.calc);
    row++;
  }
  addBorders(ws, tblStart2, 1, row - 1, 4);
  row++;

  // ── Project Parameters ─────────────────────────────────────────────────────
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, 'PROJECT PARAMETERS', S.secHdr);
  row++;
  const paramStart = row;
  lv('Altitude above MSL',          `${asNum(project?.altitude, 0)} m`);
  lv('Activity Hours',               safeStr(project?.activityHours, 'As per occupancy'));
  lv('Peak Load Period',             safeStr(project?.peakLoadTime, 'April — 16:00 hrs'));
  lv('Bypass Factor (BF)',           BF.toFixed(2), '(fixed — ASHRAE standard)');
  addBorders(ws, paramStart, 1, row - 1, 3);
  row++;

  // ── Safety Factors ─────────────────────────────────────────────────────────
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, 'SAFETY FACTORS (project defaults — may vary per room)', S.secHdr);
  row++;
  const sfStart = row;
  putV(ws, row, 1, 'Safety Factor', S.tableHdr);
  putV(ws, row, 2, 'Default Value', S.tableHdr);
  putV(ws, row, 3, 'Applied To', S.tableHdr);
  addMerge(ws, row, 3, row, COLS);
  row++;
  const sfRows: [string, string, string][] = [
    ['Sensible Heat Safety',  '10%', 'ERSH (Effective Room Sensible Heat)'],
    ['Latent Heat Safety',    '5%',  'ERLH (Effective Room Latent Heat)'],
    ['Overall Safety',        '3%',  'Grand Total Heat (Coil Sensible + Coil Latent)'],
    ['Duct Gain',             '2%',  'Duct heat gain as % of ERSH base'],
    ['Fan Gain',              '3%',  'Fan heat gain as % of ERSH base'],
  ];
  for (const [k, v, a] of sfRows) {
    putV(ws, row, 1, k, S.label);
    putV(ws, row, 2, v, S.calcC);
    addMerge(ws, row, 3, row, COLS);
    putV(ws, row, 3, a, S.calc);
    row++;
  }
  addBorders(ws, sfStart, 1, row - 1, COLS);
  row++;

  // ── Assumptions ───────────────────────────────────────────────────────────
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, 'GENERAL ASSUMPTIONS', S.secHdr);
  row++;
  const assStart = row;
  const oDB = asNum(project?.summerDesignTemp, 95);
  const oRH = asNum(project?.summerDesignHumidity, 50);
  const iDB = asNum(project?.insideSummerTemp, 75);
  const iRH = asNum(project?.insideSummerHumidity, 50);
  const assumptions = [
    `Outside design condition (Summer): ${oDB}°F DB / ${oRH}% RH`,
    `Inside design condition: ${iDB}°F DB / ${iRH}% RH`,
    `Fresh air: As per ASHRAE 62.1 — minimum ACH or 7.5 CFM/person, whichever is greater`,
    `Glass U-value: Single-pane with internal venetian blind (default U = 0.56 BTU/h·ft²·°F)`,
    `CFM governing rule: Design CFM ÷ 400 TR — Carrier 400 CFM/TR standard`,
    `ADP selection: Minimum 44°F for Chiller systems, 42°F for VRF systems`,
    `Floor above is considered air-conditioned (no floor heat gain) unless specified`,
    `All values at project altitude: ${asNum(project?.altitude, 0)} m above MSL`,
  ];
  assumptions.forEach((a, i) => {
    addMerge(ws, row, 1, row, COLS);
    putV(ws, row, 1, `${i + 1}. ${a}`, S.calc);
    row++;
  });
  addBorders(ws, assStart, 1, row - 1, COLS);

  ws['!cols'] = [{ wch: 38 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  setRef(ws, row + 1, COLS);
  (ws as any)['!pageSetup'] = { paperSize: 9, orientation: 'portrait', fitToWidth: 1, fitToHeight: 0 };
  return ws;
}

// ─── Sheet 3: Zone Summary ────────────────────────────────────────────────────

function buildZoneSummarySheet(project: any, records: RoomRecord[], equipSystems: any[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const incMon = !!project?.includeMonsoon;
  // Col layout: A-M (13) or A-K (11 without monsoon)
  const COLS = incMon ? 13 : 11;
  let row = 1;

  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, `ZONE LOAD SUMMARY — ${safeStr(project?.name, 'PROJECT').toUpperCase()}`, S.titleSm);
  row++;
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, `Date: ${fmtDate()}  |  Plant Cooling Capacity (TR) = Total BTU/h ÷ 12,000  ·  Design Airflow (CFM) is sized independently`, mkS({ sz: 9, italic: true }, CLR.sectionBg));
  row += 2;

  // Headers
  const hdrRow = row;
  const hdrs: string[] = [
    'Sr.\nNo.', 'System', 'Zone / Area', 'Rooms', 'Area\n(Sq.Ft)',
    'Summer\nTR', 'Summer\nCFM',
    ...(incMon ? ['Monsoon\nTR', 'Monsoon\nCFM'] : []),
    'Governing\nTR ▶', 'Winter\nHeating\n(BTU/h)',
    'Installed\nTR', 'Status',
  ];
  hdrs.forEach((h, i) => putV(ws, row, i + 1, h, S.tableHdr));
  row++;

  // Aggregate per zone
  type ZoneAgg = {
    systemName: string; zoneName: string; zoneId: string;
    rooms: number; area: number;
    sumBTUH: number; sumCFM: number;
    monBTUH: number; monCFM: number;
    winHeat: number;
  };
  const zoneMap = new Map<string, ZoneAgg>();
  for (const rec of records) {
    const key = `${rec.systemName}||${rec.zoneId}`;
    if (!zoneMap.has(key)) {
      zoneMap.set(key, { systemName: rec.systemName, zoneName: rec.zoneName, zoneId: rec.zoneId, rooms: 0, area: 0, sumBTUH: 0, sumCFM: 0, monBTUH: 0, monCFM: 0, winHeat: 0 });
    }
    const agg = zoneMap.get(key)!;
    agg.rooms++;
    agg.area    += rec.summer.area;
    agg.sumBTUH += rec.summer.grandTotal;
    agg.sumCFM  += rec.summer.designSupplyCFM;
    agg.monBTUH += rec.monsoon?.grandTotal ?? 0;
    agg.monCFM  += rec.monsoon?.designSupplyCFM ?? 0;
    agg.winHeat += rec.winter.total;
  }

  const zones = Array.from(zoneMap.values()).sort((a, b) => `${a.systemName}|${a.zoneName}`.localeCompare(`${b.systemName}|${b.zoneName}`));

  let sr = 1;
  let totArea = 0, totSumBTUH = 0, totSumCFM = 0, totMonBTUH = 0, totMonCFM = 0, totWin = 0, totInsTR = 0;
  const dataStart = row;

  // Group by system — emit a system header when system changes
  let lastSystem = '';
  for (const z of zones) {
    if (z.systemName !== lastSystem) {
      lastSystem = z.systemName;
      addMerge(ws, row, 1, row, COLS);
      putV(ws, row, 1, `▶  ${z.systemName}`, S.greenHdr);
      row++;
    }

    const sumTR  = z.sumBTUH / 12000;
    const monTR  = z.monBTUH / 12000;
    const govTR  = incMon ? Math.max(Math.max(sumTR, z.sumCFM / 400), Math.max(monTR, z.monCFM / 400))
                           : Math.max(sumTR, z.sumCFM / 400);
    const govCFM = Math.max(z.sumCFM, z.monCFM);

    // Installed TR for zone
    let insTR = 0;
    for (const sys of equipSystems || []) {
      const eZone = (sys.zones ?? []).find((ez: any) => ez.id === z.zoneId);
      if (eZone) {
        const units = (eZone.unitSelections ?? []).length ? eZone.unitSelections : eZone.selection ? [eZone.selection] : [];
        for (const u of units) insTR += asNum(u.trCapacity) * asNum(u.quantity, 1);
      }
      // VRF: sum iduSelections for rooms in this zone
      const roomsInZone = records.filter(r => r.zoneId === z.zoneId);
      for (const rec of roomsInZone) {
        for (const u of normalizeIDUList((sys.iduSelections as any)?.[rec.room.id])) {
          insTR += asNum(u.trCapacity) * asNum(u.quantity, 1);
        }
        for (const u of (sys.roomSelections?.[rec.room.id] ?? [])) {
          insTR += asNum(u.trCapacity);
        }
      }
    }

    const surplus = insTR > 0 ? insTR - govTR : null;
    const status  = insTR === 0 ? 'Not Set' : surplus! >= -0.1 ? 'OK ✓' : 'Undersized ⚠';

    const rowStyle = (col: number) => col === COLS
      ? (insTR === 0 ? S.calcC : surplus! >= -0.1 ? S.ok : S.warn)
      : S.calc;

    const cols: any[] = [
      sr++, z.systemName, z.zoneName, z.rooms, r0(z.area),
      r2(sumTR), r0(govCFM),
      ...(incMon ? [r2(monTR), r0(z.monCFM)] : []),
      r2(govTR), r0(z.winHeat),
      insTR > 0 ? r2(insTR) : '—', status,
    ];
    cols.forEach((v, i) => putV(ws, row, i + 1, v, i + 1 === COLS ? rowStyle(COLS) : (i >= 5 ? S.calcC : S.calc)));

    totArea    += z.area;
    totSumBTUH += z.sumBTUH;
    totSumCFM  += z.sumCFM;
    totMonBTUH += z.monBTUH;
    totMonCFM  += z.monCFM;
    totWin     += z.winHeat;
    totInsTR   += insTR;
    row++;
  }

  addBorders(ws, dataStart, 1, row - 1, COLS);

  // Totals row
  const totSumTR  = Math.max(totSumBTUH / 12000, totSumCFM / 400);
  const totMonTR  = incMon ? Math.max(totMonBTUH / 12000, totMonCFM / 400) : 0;
  const totGovTR  = Math.max(totSumTR, totMonTR);
  const totGovCFM = Math.max(totSumCFM, totMonCFM);

  const totCols: any[] = [
    'PROJECT TOTAL', '', '', zones.length, r0(totArea),
    r2(totSumBTUH / 12000), r0(totSumCFM),
    ...(incMon ? [r2(totMonBTUH / 12000), r0(totMonCFM)] : []),
    r2(totGovTR), r0(totWin),
    totInsTR > 0 ? r2(totInsTR) : '—', '',
  ];
  addMerge(ws, row, 1, row, 3);
  totCols.forEach((v, i) => putV(ws, row, i + 1, v, S.total));
  addBorders(ws, row, 1, row, COLS);
  row += 2;

  // Legend
  putV(ws, row, 1, 'STATUS LEGEND', S.secHdr);
  addMerge(ws, row, 1, row, 4);
  row++;
  putV(ws, row, 1, 'OK ✓', S.ok);
  putV(ws, row, 2, 'Installed TR ≥ Governing TR (within 10% tolerance)', S.calc);
  addMerge(ws, row, 2, row, 4);
  row++;
  putV(ws, row, 1, 'Undersized ⚠', S.warn);
  putV(ws, row, 2, 'Installed TR < Governing TR — equipment upgrade recommended', S.calc);
  addMerge(ws, row, 2, row, 4);
  row++;
  putV(ws, row, 1, 'Not Set', S.calcC);
  putV(ws, row, 2, 'No equipment assigned to this zone yet', S.calc);
  addMerge(ws, row, 2, row, 4);
  row++;

  ws['!cols'] = [
    { wch: 6 }, { wch: 22 }, { wch: 24 }, { wch: 7 }, { wch: 10 },
    { wch: 10 }, { wch: 10 },
    ...(incMon ? [{ wch: 10 }, { wch: 10 }] : []),
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
  ];
  ws['!rows'] = [{ hpt: 30 }];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: hdrRow - 1, c: 0 }, e: { r: row - 1, c: COLS - 1 } }) };
  (ws as any)['!freeze'] = { xSplit: 0, ySplit: hdrRow };
  setRef(ws, row + 1, COLS);
  (ws as any)['!pageSetup'] = { paperSize: 9, orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 };
  return ws;
}

// ─── Sheet 4: Equipment Schedule ─────────────────────────────────────────────

function buildEquipmentScheduleSheet(project: any, equipSystems: any[], allRooms: Record<string, any[]>): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const COLS = 11;
  let row = 1;

  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, `EQUIPMENT SCHEDULE — ${safeStr(project?.name, 'PROJECT').toUpperCase()}`, S.titleSm);
  row++;
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, `Date: ${fmtDate()}  |  All capacities are nominal rated values at standard conditions`, mkS({ sz: 9, italic: true }, CLR.sectionBg));
  row += 2;

  const hdrRow = row;
  const hdrs = ['Sr.\nNo.', 'System', 'Zone', 'Room', 'Equipment\nType', 'Brand', 'Model / Series', 'Capacity\n(TR)', 'CFM', 'Qty', 'Total\nTR'];
  hdrs.forEach((h, i) => putV(ws, row, i + 1, h, S.tableHdr));
  row++;

  const lines = buildEquipmentLines(equipSystems, allRooms);
  const dataStart = row;
  let sr = 1;
  let lastSystem = '';
  let totTR = 0;

  for (const ln of lines) {
    if (ln.system !== lastSystem) {
      lastSystem = ln.system;
      addMerge(ws, row, 1, row, COLS);
      putV(ws, row, 1, `▶  System: ${ln.system}`, S.purpleHdr);
      row++;
    }
    const isODU     = ['ODU', 'Chiller', 'AHU Condensing Unit', 'Cooling Tower'].includes(ln.role);
    const rowSty    = isODU ? S.sub : S.calc;
    const vals: any[] = [sr++, ln.system, ln.zone, ln.room, ln.role, ln.brand, ln.model, r2(ln.tr), r0(ln.cfm), ln.qty, r2(ln.totalTR)];
    vals.forEach((v, i) => putV(ws, row, i + 1, v, i >= 7 ? S.calcC : rowSty));
    totTR += ln.totalTR;
    row++;
  }

  if (lines.length === 0) {
    addMerge(ws, row, 1, row, COLS);
    putV(ws, row, 1, 'No equipment assigned yet. Use the Equipment Selection module to assign equipment to systems and zones.', S.note);
    row++;
  }

  addBorders(ws, dataStart, 1, row - 1, COLS);

  // Totals
  const totCols = ['TOTAL', '', '', '', '', '', '', '', '', '', r2(totTR)];
  addMerge(ws, row, 1, row, 10);
  totCols.forEach((v, i) => putV(ws, row, i + 1, v, S.total));
  addBorders(ws, row, 1, row, COLS);
  row += 2;

  // Notes
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, 'NOTES', S.secHdr);
  row++;
  const notes = [
    'All capacities are nominal rated values. Derate as required for site elevation and ambient conditions.',
    'VRF ODU diversity factor applied per system design. Effective ODU TR may differ from rated TR.',
    'Chiller capacity at standard ARI conditions (44°F CHW / 85°F CW). Verify at actual design conditions.',
    'Zone-level units (AHU/FCU) serve all rooms within the zone. Individual room TR is not separately verified here — see Zone Summary.',
  ];
  notes.forEach((n, i) => {
    addMerge(ws, row, 1, row, COLS);
    putV(ws, row, 1, `${i + 1}. ${n}`, S.note);
    row++;
  });

  ws['!cols'] = [
    { wch: 6 }, { wch: 22 }, { wch: 20 }, { wch: 18 }, { wch: 20 },
    { wch: 14 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 6 }, { wch: 10 },
  ];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: hdrRow - 1, c: 0 }, e: { r: row - 1, c: COLS - 1 } }) };
  (ws as any)['!freeze'] = { xSplit: 0, ySplit: hdrRow };
  setRef(ws, row + 1, COLS);
  (ws as any)['!pageSetup'] = { paperSize: 9, orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 };
  return ws;
}

// ─── Sheet 5: Load Summary ────────────────────────────────────────────────────

function buildSummarySheet(project: any, refs: RoomSheetRefs[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const incMon = !!project?.includeMonsoon;
  // TFA columns are added only when at least one room in the project is DOAS-served.
  const anyTfa = refs.some(r => r.tfaTrCell);
  // Columns: Sr | System | Zone | Room | Floor | Area | Height | FalseCeiling | FreshAir | Occupancy | Lighting | EquipKW | SumTR | SumCFM | [MonTR | MonCFM] | [TfaTR | TfaCFM] | WinLoad | GovTR | IDUConfig
  // afterCool = index of the last cooling-load column (Summer/Monsoon CFM).
  const afterCool = incMon ? 16 : 14;
  const tfaOff    = anyTfa ? 2 : 0;
  // TFA winter heating coil column — added after the Winter Heating column when any
  // room carries a TFA fresh-air heating coil.
  const anyTfaHeat = refs.some(r => r.tfaWinterHeatCell);
  const tfaHeatOff = anyTfaHeat ? 1 : 0;
  const tfaTrCol  = afterCool + 1;   // only meaningful when anyTfa
  const tfaCfmCol = afterCool + 2;
  const wCol = afterCool + tfaOff + 1;
  const tfaHeatCol = wCol + 1;       // only meaningful when anyTfaHeat
  const gCol = afterCool + tfaOff + 1 + tfaHeatOff + 1;
  const iCol = afterCool + tfaOff + 1 + tfaHeatOff + 2;
  const COLS = iCol;
  let row = 1;

  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, `HEAT LOAD SUMMARY — ${safeStr(project?.name, 'PROJECT').toUpperCase()}`, S.titleSm);
  row++;
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, `Date: ${fmtDate()}  |  Use the System / Zone / Floor filters to group rooms. Plant TR = coil load only; design CFM is sized separately.`, mkS({ sz: 9, italic: true }, CLR.sectionBg));
  row += 2;

  const hdrRow = row;
  const hdrs = [
    'Sr.\nNo.', 'System', 'Zone', 'Room / Space', 'Floor',
    'Area\n(Sq.Ft)', 'Ceiling\nHt (Ft)', 'False\nCeiling (Ft)',
    'Fresh Air\n(CFM)', 'Occupancy\n(Nos.)', 'Lighting\n(W/Sq.Ft)', 'Equip.\nLoad (kW)',
    'Summer\nTR', 'Summer\nCFM',
    ...(incMon ? ['Monsoon\nTR', 'Monsoon\nCFM'] : []),
    ...(anyTfa ? ['TFA Coil\nTR', 'TFA\nCFM'] : []),
    'Winter\nHeating\n(BTU/h)',
    ...(anyTfaHeat ? ['TFA Heat\n(BTU/h)'] : []),
    'Plant\nTR ▶', 'IDU Configuration',
  ];
  hdrs.forEach((h, i) => putV(ws, row, i + 1, h, S.tableHdr));
  row++;

  const dataStart = row;
  refs.forEach((ref, idx) => {
    const r = row;
    // Fixed columns
    putV(ws, r, 1, idx + 1, S.calcC);
    putV(ws, r, 2, ref.systemName, S.calc);
    putV(ws, r, 3, ref.zoneName, S.calc);
    putV(ws, r, 4, ref.roomName, S.calc);
    putV(ws, r, 5, ref.floorName, S.calc);
    // Cross-sheet formula columns
    putF(ws, r, 6,  shRef(ref.sheetName, ref.areaCell),          'n', S.calcC);
    putF(ws, r, 7,  shRef(ref.sheetName, ref.heightCell),        'n', S.calcC);
    putF(ws, r, 8,  shRef(ref.sheetName, ref.falseCeilingCell),  'n', S.calcC);
    putF(ws, r, 9,  shRef(ref.sheetName, ref.freshAirCell),      'n', S.calcC);
    putF(ws, r, 10, shRef(ref.sheetName, ref.occupancyCell),     'n', S.calcC);
    putF(ws, r, 11, shRef(ref.sheetName, ref.lightingCell),      'n', S.calcC);
    putF(ws, r, 12, shRef(ref.sheetName, ref.equipKwCell),       'n', S.calcC);
    putF(ws, r, 13, `ROUND(${shRef(ref.sheetName, ref.summerTrCell)},2)`,  'n', S.calcC);
    putF(ws, r, 14, `ROUND(${shRef(ref.sheetName, ref.summerCfmCell)},0)`, 'n', S.calcC);
    if (incMon) {
      putF(ws, r, 15, ref.monsoonTrCell  ? `ROUND(${shRef(ref.sheetName, ref.monsoonTrCell)},2)`  : '0', 'n', S.calcC);
      putF(ws, r, 16, ref.monsoonCfmCell ? `ROUND(${shRef(ref.sheetName, ref.monsoonCfmCell)},0)` : '0', 'n', S.calcC);
    }
    if (anyTfa) {
      // Non-TFA rooms have no cell ref → contribute 0 so the column totals stay correct.
      putF(ws, r, tfaTrCol,  ref.tfaTrCell  ? `ROUND(${shRef(ref.sheetName, ref.tfaTrCell)},2)`  : '0', 'n', S.calcC);
      putF(ws, r, tfaCfmCol, ref.tfaCfmCell ? `ROUND(${shRef(ref.sheetName, ref.tfaCfmCell)},0)` : '0', 'n', S.calcC);
    }
    putF(ws, r, wCol, `ROUND(${shRef(ref.sheetName, ref.winterLoadCell)},0)`,   'n', S.calcC);
    if (anyTfaHeat) {
      putF(ws, r, tfaHeatCol, ref.tfaWinterHeatCell ? `ROUND(${shRef(ref.sheetName, ref.tfaWinterHeatCell)},0)` : '0', 'n', S.calcC);
    }
    putF(ws, r, gCol, `ROUND(${shRef(ref.sheetName, ref.governingTrCell)},2)`,  'n', S.total);
    putF(ws, r, iCol, shRef(ref.sheetName, ref.iduConfigCell), 's', S.calc);
    row++;
  });

  addBorders(ws, dataStart, 1, row - 1, COLS);

  // Totals row
  const n = refs.length;
  const totR = row;
  putV(ws, totR, 1, 'PROJECT TOTAL', S.total);
  addMerge(ws, totR, 1, totR, 5);
  [6, 9, 10, 13, 14, ...(incMon ? [15, 16] : []), ...(anyTfa ? [tfaTrCol, tfaCfmCol] : [])].forEach(c => {
    putF(ws, totR, c, `SUM(${rc(dataStart, c)}:${rc(row - 1, c)})`, 'n', S.total);
  });
  putF(ws, totR, wCol, `SUM(${rc(dataStart, wCol)}:${rc(row - 1, wCol)})`, 'n', S.total);
  if (anyTfaHeat) putF(ws, totR, tfaHeatCol, `SUM(${rc(dataStart, tfaHeatCol)}:${rc(row - 1, tfaHeatCol)})`, 'n', S.total);
  putF(ws, totR, gCol, `SUM(${rc(dataStart, gCol)}:${rc(row - 1, gCol)})`, 'n', S.total);
  addBorders(ws, totR, 1, totR, COLS);
  row++;

  // Plant-duty line — ONLY when the project has TFA-served rooms. Space coil + TFA
  // coil = total cooling; when the TFA coil is fed by the main chiller this is the
  // plant capacity required. Non-TFA projects get no extra row (no change).
  if (anyTfa) {
    const pdR = row;
    putV(ws, pdR, 1, 'PLANT DUTY  (Space coil + TFA coil)', S.total);
    addMerge(ws, pdR, 1, pdR, gCol - 1);
    putF(ws, pdR, gCol, `${rc(totR, gCol)}+${rc(totR, tfaTrCol)}`, 'n', S.total);
    addMerge(ws, pdR, gCol + 1, pdR, COLS);
    putV(ws, pdR, gCol + 1, 'Space + TFA coil. When the TFA coil is fed by the main chiller plant, this is the plant capacity required.', mkS({ sz: 9, italic: true }, CLR.sectionBg));
    addBorders(ws, pdR, 1, pdR, COLS);
    row++;
  }
  row += 2;

  // Assumptions (from project data)
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, 'GENERAL ASSUMPTIONS & BASIS OF DESIGN', S.secHdr);
  row++;
  const oDB = asNum(project?.summerDesignTemp, 95);
  const oRH = asNum(project?.summerDesignHumidity, 50);
  const iDB = asNum(project?.insideSummerTemp, 75);
  const iRH = asNum(project?.insideSummerHumidity, 50);
  const assumptions = [
    `Outside design condition (Summer): ${oDB}°F DB / ${oRH}% RH`,
    `Inside design condition: ${iDB}°F DB / ${iRH}% RH`,
    `Fresh air: As per ASHRAE 62.1 — minimum ACH or 7.5 CFM/person`,
    `Glass U-value: Single-pane with venetian blind (default U = 0.56 BTU/h·ft²·°F)`,
    `Floor above considered air-conditioned — no floor heat gain unless specified`,
    `Equipment load: As per details provided by consultant/customer`,
    `Design drawing reference: Drawing provided by customer`,
    `Activity hours: ${safeStr(project?.activityHours, '9 AM to 6 PM')}`,
    `Altitude: ${asNum(project?.altitude, 0)} m above MSL — all psychrometric values corrected`,
  ];
  assumptions.forEach((a, i) => {
    addMerge(ws, row, 1, row, COLS);
    putV(ws, row, 1, `${i + 1}. ${a}`, S.calc);
    row++;
  });

  ws['!cols'] = [
    { wch: 6 }, { wch: 22 }, { wch: 20 }, { wch: 22 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    ...(incMon ? [{ wch: 10 }, { wch: 10 }] : []),
    ...(anyTfa ? [{ wch: 10 }, { wch: 10 }] : []),
    { wch: 14 },
    ...(anyTfaHeat ? [{ wch: 13 }] : []),
    { wch: 12 }, { wch: 40 },
  ];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: hdrRow - 1, c: 0 }, e: { r: n + hdrRow, c: COLS - 1 } }) };
  (ws as any)['!freeze'] = { xSplit: 0, ySplit: hdrRow };
  (ws as any)['!pageSetup'] = { paperSize: 9, orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 };
  setRef(ws, row + 1, COLS);
  return ws;
}

// ─── Sheet 6+: Room Sheet ─────────────────────────────────────────────────────

function buildRoomSheet(
  project: any,
  record: RoomRecord,
  equipSystems: any[],
): { ws: XLSX.WorkSheet; refs: RoomSheetRefs } {
  const ws: XLSX.WorkSheet = {};
  const incMon = !!project?.includeMonsoon && !!record.monsoon;
  // Columns: A(1)–J(10) — Summer(A-C) | sep(D) | Monsoon(E-G) | Winter(H-J)
  const COLS = 10;
  let row = 1;

  // ── Title ──────────────────────────────────────────────────────────────────
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, `HEAT LOAD CALCULATION — ${safeStr(record.room?.name, 'ROOM').toUpperCase()}`, S.titleSm);
  row += 2;

  // ── Project header ─────────────────────────────────────────────────────────
  const hdrFields: [string, any, string, any, string, any][] = [
    ['Project', safeStr(record.room?._projectName || project?.name), 'Location', safeStr(project?.location || project?.place), 'Date', fmtDate()],
    ['System',  record.systemName,   'Zone',         record.zoneName,  'Floor', safeStr(record.room?.floor)],
    ['Room',    safeStr(record.room?.name), 'Prepared By', safeStr(project?.engineerName || project?.estimatedBy, 'Design Engineer'), 'Peak Load', safeStr(project?.peakLoadTime, 'April — 16:00 hrs')],
  ];
  for (const [k1, v1, k2, v2, k3, v3] of hdrFields) {
    putV(ws, row, 1, k1, S.label); putV(ws, row, 2, v1, S.calc);
    putV(ws, row, 4, k2, S.label); putV(ws, row, 5, v2, S.calc);
    putV(ws, row, 8, k3, S.label); putV(ws, row, 9, v3, S.calc);
    row++;
  }
  row++;

  // ── Design Conditions ──────────────────────────────────────────────────────
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, 'DESIGN CONDITIONS', S.secHdr);
  row++;

  const dcHdrs = ['Parameter', 'Summer\nOutdoor', 'Summer\nIndoor', 'Diff', 'Monsoon\nOutdoor', 'Monsoon\nIndoor', 'Diff', 'Winter\nOutdoor', 'Winter\nIndoor', 'Diff'];
  dcHdrs.forEach((h, i) => putV(ws, row, i + 1, h, S.tableHdr));
  row++;
  const dcStart = row;

  const sumP  = getProjectPsychro(project, 'summer');
  const monP  = getProjectPsychro(project, 'monsoon');
  const wODB  = asNum(project?.winterDesignTemp, 50);
  const wORH  = asNum(project?.winterDesignHumidity, 80);
  const wIDB  = asNum(project?.insideWinterTemp,  72);
  const wIRH  = asNum(project?.insideWinterHumidity, 40);
  const wOut  = calculatePsychrometrics(wODB, wORH, asNum(project?.altitude));
  const wIn   = calculatePsychrometrics(wIDB, wIRH, asNum(project?.altitude));
  const wOGR  = r2(toGR(wOut.humidityRatio));
  const wIGR  = r2(toGR(wIn.humidityRatio));

  type DCRow = [string, any, any, any, any, any, any, any, any, any];
  const dcRows: DCRow[] = [
    ['DB (°F)',           sumP.outside.db, sumP.inside.db, sumP.outside.db - sumP.inside.db, monP.outside.db, monP.inside.db, monP.outside.db - monP.inside.db, wODB, wIDB, wODB - wIDB],
    ['% RH',             sumP.outside.rh, sumP.inside.rh, sumP.outside.rh - sumP.inside.rh, monP.outside.rh, monP.inside.rh, monP.outside.rh - monP.inside.rh, wORH, wIRH, wORH - wIRH],
    ['Enthalpy (BTU/lb)', sumP.outside.th, sumP.inside.th, r2(sumP.outside.th - sumP.inside.th), monP.outside.th, monP.inside.th, r2(monP.outside.th - monP.inside.th), r2(wOut.enthalpy), r2(wIn.enthalpy), r2(wOut.enthalpy - wIn.enthalpy)],
    ['GR/LB',            sumP.outside.gr, sumP.inside.gr, r2(sumP.outside.gr - sumP.inside.gr), monP.outside.gr, monP.inside.gr, r2(monP.outside.gr - monP.inside.gr), wOGR, wIGR, r2(wOGR - wIGR)],
  ];
  for (const [p, ...vals] of dcRows) {
    putV(ws, row, 1, p, S.label);
    vals.forEach((v, i) => putV(ws, row, i + 2, incMon || i < 2 ? v : (i >= 3 && i <= 5) ? '—' : v, S.calcC));
    row++;
  }
  addBorders(ws, dcStart, 1, row - 1, COLS);
  row++;

  // ── Room Inputs ────────────────────────────────────────────────────────────
  addMerge(ws, row, 1, row, 3);
  putV(ws, row, 1, 'ROOM INPUTS', S.secHdr);
  row++;
  putV(ws, row, 1, 'Parameter', S.tableHdr);
  putV(ws, row, 2, 'Value', S.tableHdr);
  putV(ws, row, 3, 'Unit', S.tableHdr);
  row++;
  const inputStart = row;

  // Record cell addresses for cross-sheet refs
  const areaCell          = rc(row,   2); putV(ws, row, 1, 'Floor Area',                S.label); putV(ws, row, 2, r2(record.summer.area),          S.input); putV(ws, row, 3, 'Sq.Ft', S.calc); row++;
  const heightCell        = rc(row,   2); putV(ws, row, 1, 'Ceiling Height',             S.label); putV(ws, row, 2, asNum(record.room?.height, 0),   S.input); putV(ws, row, 3, 'Ft',    S.calc); row++;
  const falseCeilingCell  = rc(row,   2); putV(ws, row, 1, 'False Ceiling Height',       S.label); putV(ws, row, 2, asNum(record.room?.falseCeilingHeight, 0), S.input); putV(ws, row, 3, 'Ft', S.calc); row++;
  const occupancyCell     = rc(row,   2); putV(ws, row, 1, 'Occupancy',                  S.label); putV(ws, row, 2, asNum(record.room?.peopleCount, 0), S.input); putV(ws, row, 3, 'Persons', S.calc); row++;
  const freshAirCell      = rc(row,   2); putV(ws, row, 1, 'Ventilation / Fresh Air',    S.label); putV(ws, row, 2, r0(record.summer.ventCfm),       S.input); putV(ws, row, 3, 'CFM',  S.calc); row++;
  const lightingCell      = rc(row,   2); putV(ws, row, 1, 'Lighting Load',               S.label); putV(ws, row, 2, asNum(record.room?.lightsWattsPerSqft, 0), S.input); putV(ws, row, 3, 'W/Sq.Ft', S.calc); row++;
  const equipKwCell       = rc(row,   2); putV(ws, row, 1, 'Equipment + Other Load',     S.label); putV(ws, row, 2, r2(asNum(record.room?.equipmentKW, 0) + asNum(record.room?.othersKW, 0)), S.input); putV(ws, row, 3, 'kW', S.calc); row++;
  putV(ws, row, 1, 'Activity Type', S.label); putV(ws, row, 2, safeStr(record.room?.activityType, 'office'), S.input); row++;

  addBorders(ws, inputStart, 1, row - 1, 3);
  row++;

  // ── Building Envelope ──────────────────────────────────────────────────────
  addMerge(ws, row, 1, row, 5);
  putV(ws, row, 1, 'BUILDING ENVELOPE', S.secHdr);
  row++;
  ['Type', 'Orientation', 'Area (Sq.Ft)', 'U-Value\n(BTU/h·ft²·°F)', 'Description'].forEach((h, i) => putV(ws, row, i + 1, h, S.tableHdr));
  row++;
  const envStart = row;

  if (record.elements.length === 0) {
    addMerge(ws, row, 1, row, 5);
    putV(ws, row, 1, 'No envelope elements defined for this room.', S.note);
    row++;
  } else {
    const typeOrder = ['Wall', 'Glass', 'Roof', 'Floor', 'Partition'];
    const sorted = [...record.elements].sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type));
    for (const el of sorted) {
      putV(ws, row, 1, el.type, S.calc);
      putV(ws, row, 2, safeStr(el.orientation, '—'), S.calcC);
      putV(ws, row, 3, r2(asNum(el.area, 0)), S.calcC);
      putV(ws, row, 4, r2(asNum(el.uValue, 0)), S.calcC);
      putV(ws, row, 5, safeStr(el.description), S.calc);
      row++;
    }
  }
  addBorders(ws, envStart, 1, row - 1, 5);
  row++;

  // ── Cooling Load Analysis (Summer | Monsoon | Winter side-by-side) ──────────
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, 'COOLING & HEATING LOAD ANALYSIS', S.tealHdr);
  row++;

  // Sub-headers
  addMerge(ws, row, 1, row, 1); putV(ws, row, 1, 'Load Component', S.tableHdr);
  addMerge(ws, row, 2, row, 3); putV(ws, row, 2, 'SUMMER', S.amberHdr);
  addMerge(ws, row, 4, row, 4); putV(ws, row, 4, '', S.tableHdr);
  addMerge(ws, row, 5, row, 7); putV(ws, row, 5, incMon ? 'MONSOON' : 'MONSOON (N/A)', mkS({ sz: 9, bold: true, color: { rgb: CLR.blueFg } }, incMon ? CLR.blueBg : 'AAAAAA', { horizontal: 'center' }));
  addMerge(ws, row, 8, row, COLS); putV(ws, row, 8, 'WINTER HEATING', S.purpleHdr);
  row++;

  putV(ws, row, 1, 'Component', S.tableHdr);
  putV(ws, row, 2, 'Value', S.tableHdr); putV(ws, row, 3, 'Unit', S.tableHdr);
  putV(ws, row, 4, '', S.tableHdr);
  putV(ws, row, 5, 'Value', S.tableHdr); putV(ws, row, 6, 'Unit', S.tableHdr); putV(ws, row, 7, '', S.tableHdr);
  putV(ws, row, 8, 'Component', S.tableHdr);
  putV(ws, row, 9, 'Value', S.tableHdr); putV(ws, row, 10, 'Unit', S.tableHdr);
  row++;
  const calcStart = row;

  type CalcRow = [string, number, number | null, string, number, string];
  const calcRows: CalcRow[] = [
    ['Envelope Sensible',       record.summer.envelopeSensible, record.monsoon?.envelopeSensible ?? null, 'Envelope Sensible', record.winter.envelope, 'BTU/h'],
    ['Internal Sensible',       record.summer.internalSensible, record.monsoon?.internalSensible ?? null, 'Internal Sensible', record.winter.internal, 'BTU/h'],
    ['Ventilation Sensible',    record.summer.ventSensible,     record.monsoon?.ventSensible ?? null,     'Ventilation Sensible', record.winter.vent, 'BTU/h'],
    ['Ventilation Latent',      record.summer.ventLatent,       record.monsoon?.ventLatent ?? null,       '', 0, ''],
    ['Duct Gain',               record.summer.ductGain,         record.monsoon?.ductGain ?? null,         '', 0, ''],
    ['Fan Gain',                record.summer.fanGain,          record.monsoon?.fanGain ?? null,          '', 0, ''],
    ['ERSH (Eff. Room Sensible)',record.summer.ersh,             record.monsoon?.ersh ?? null,             '', 0, ''],
    ['ERLH (Eff. Room Latent)', record.summer.erlh,             record.monsoon?.erlh ?? null,             '', 0, ''],
    ['Coil Sensible',           record.summer.coilSensible,     record.monsoon?.coilSensible ?? null,     '', 0, ''],
    ['Coil Latent',             record.summer.coilLatent,       record.monsoon?.coilLatent ?? null,       '', 0, ''],
    ['Grand Total (BTUh)',       record.summer.grandTotal,       record.monsoon?.grandTotal ?? null,       'Total Heating Load', record.winter.total, 'BTU/h'],
    // Winter-only row: TFA/DOAS fresh-air heating coil (DOAS duty). Summer/monsoon
    // cells stay blank (comp === '' → blank-rendered below).
    ...(Number(record.room?._calcTfaWinterHeatingBTUH) > 0
      ? [['', 0, null, '+ TFA Fresh-Air Heating Coil', Number(record.room._calcTfaWinterHeatingBTUH), 'BTU/h'] as CalcRow]
      : []),
  ];

  // Captured during the loop so cross-sheet refs don't depend on fragile row math
  // (the optional TFA heating row would otherwise shift the "last row" assumption).
  let winterTotalCell = '';
  let tfaWinterHeatCell: string | undefined;
  for (const [comp, sv, mv, wcomp, wv, wu] of calcRows) {
    const isBold = comp.startsWith('Grand') || comp.startsWith('ERSH') || comp.startsWith('ERLH');
    const sty = isBold ? S.total : S.calc;
    putV(ws, row, 1, comp, isBold ? S.label : S.calc);
    putV(ws, row, 2, comp ? r0(sv) : '', sty); putV(ws, row, 3, comp ? 'BTU/h' : '', sty);
    putV(ws, row, 4, '');
    putV(ws, row, 5, incMon && mv !== null ? r0(mv) : '—', sty);
    putV(ws, row, 6, incMon && mv !== null ? 'BTU/h' : '', sty);
    putV(ws, row, 7, '');
    putV(ws, row, 8, wcomp, wcomp ? S.label : S.calc);
    putV(ws, row, 9, wcomp && wv ? r0(wv) : '', wcomp ? S.total : S.calc);
    putV(ws, row, 10, wu, S.calc);
    if (wcomp === 'Total Heating Load') winterTotalCell = rc(row, 9);
    if (wcomp === '+ TFA Fresh-Air Heating Coil') tfaWinterHeatCell = rc(row, 9);
    row++;
  }

  // Sizing rows
  const sumTR  = r2(record.summer.totalTR);
  const monTR  = record.monsoon ? r2(record.monsoon.totalTR) : null;
  const sumCFM = r0(record.summer.designSupplyCFM);
  const monCFM = record.monsoon ? r0(record.monsoon.designSupplyCFM) : null;

  const sumTRcell  = rc(row, 2);
  const sumCFMcell = rc(row + 1, 2);
  const monTRcell  = rc(row, 5);
  const monCFMcell = rc(row + 1, 5);

  putV(ws, row, 1, 'Cooling Load (TR)',     S.label);
  putV(ws, row, 2, sumTR,  S.total); putV(ws, row, 3, 'TR', S.total);
  putV(ws, row, 4, '');
  putV(ws, row, 5, incMon && monTR !== null ? monTR : '—', S.total);
  putV(ws, row, 6, incMon ? 'TR' : '', S.total);
  row++;

  putV(ws, row, 1, 'Design Supply CFM',    S.label);
  putV(ws, row, 2, sumCFM, S.total); putV(ws, row, 3, 'CFM', S.total);
  putV(ws, row, 4, '');
  putV(ws, row, 5, incMon && monCFM !== null ? monCFM : '—', S.total);
  putV(ws, row, 6, incMon ? 'CFM' : '', S.total);
  row++;

  // Latent / reheat diagnostic — flag only when the ACTUAL design supply air can't carry the
  // latent load (latent need > supplied CFM). The raw latentShortfallCfm is sensible-based, so
  // it false-alarms when the ACH / DSCFM floor already bumps supply above the latent need.
  const sLatShort = (record.summer.latentCfm - record.summer.designSupplyCFM) > 1;
  const mLatShort = !!record.monsoon && ((record.monsoon.latentCfm - record.monsoon.designSupplyCFM) > 1);
  if (sLatShort || mLatShort) {
    const src = sLatShort ? record.summer : record.monsoon!;
    const dh = resolveRoomDehumid(record.room, equipSystems);
    putV(ws, row, 2, r0(src.latentCfm), S.calc); putV(ws, row, 3, 'CFM latent need', S.calc);
    putV(ws, row, 4, '');
    if (dh && isReheatMethod(dh.method)) {
      // Required reheat from RSHF (same basis as the report) — NOT the stored dehumidReheatKW,
      // which can be stale/undersized and differ between identical rooms.
      const roomTot = src.ersh + src.erlh;
      const cSHR = roomTot > 0 ? src.ersh / roomTot : 1;
      const rhBtu = cSHR < 0.75 ? Math.max(0, (src.erlh * 0.75) / 0.25 - src.ersh) : 0;
      // Only describe a reheat coil when one is actually needed (SHR < 0.75). At SHR >= 0.75 the
      // duty is 0 — don't print "then reheats … required reheat duty: 0.00 kW" (self-contradictory).
      if (rhBtu > 0) {
        putV(ws, row, 1, 'Dehumidification (Reheat)', S.label);
        putV(ws, row, 5, `Reheat dehumidification (${dh.label}): coil over-cools below ${r0(src.selectedAdp)}°F ADP to wring out the latent load at ${r0(src.designSupplyCFM)} CFM, then reheats to supply temp. Required reheat duty: ${r2(rhBtu / 3412.142)} kW (${r0(rhBtu)} BTU/h).`, S.calc);
      } else {
        putV(ws, row, 1, 'Dehumidification', S.label);
        putV(ws, row, 5, `Coil @ ${r0(src.selectedAdp)}°F dries this room at ${r0(src.designSupplyCFM)} CFM with no reheat — room SHR ${cSHR.toFixed(2)} is at/above 0.75, so the supply does not over-cool. Reheat not required.`, S.calc);
      }
    } else if (dh && dh.method === 'standalone') {
      putV(ws, row, 1, 'Dehumidification', S.label);
      putV(ws, row, 5, `Standalone desiccant / DX dehumidification selected for this zone — removes the residual latent the cooling coil can't at ${r0(src.designSupplyCFM)} CFM.`, S.calc);
    } else {
      putV(ws, row, 1, 'Latent / Reheat', S.label);
      putV(ws, row, 5, `Coil @ ${r0(src.selectedAdp)}°F can't fully dry — supplied ${r0(src.designSupplyCFM)} CFM. Lower the coil ADP (Dehumidification mode) or add a DOAS / desiccant.`, S.calc);
    }
    row++;
  }

  // Governing TR (key result — typed as value, not formula, to guarantee correctness)
  const govTRcell = rc(row, 2);
  putV(ws, row, 1, 'Plant Cooling Capacity  [coil load TR]', S.label);
  putV(ws, row, 2, r2(record.governingTR), S.total);
  putV(ws, row, 3, 'TR', S.total);
  addMerge(ws, row, 4, row, COLS);
  putV(ws, row, 4, `Plant TR is load-only (coil grand total ÷ 12,000 × safety). CFM/TR is a sanity ratio: Summer ${sumCFM > 0 ? r0(sumCFM / Math.max(sumTR, 0.0001)) : 0} CFM/TR (typical 350–450).`, S.note);
  row++;

  // ── TFA / DOAS coil split ───────────────────────────────────────────────────
  // When the engine flagged this room as DOAS-served, the outdoor-air coil duty
  // is carried by the TFA unit, NOT the primary coil above. Show it separately so
  // the schedule reads as: Plant (space) coil + TFA (OA) coil.
  const roomTfaTR  = Math.max(Number(record.room?._calcTfaCoilTR) || 0, Number(record.room?._calcMonsoonTfaCoilTR) || 0);
  const roomTfaCFM = Number(record.room?._calcTfaCfm) || 0;
  const isTfaRoom  =
    (Number(record.room?._calcTfaCoilBTUH) || 0) > 0 ||
    (Number(record.room?._calcMonsoonTfaCoilBTUH) || 0) > 0 ||
    !!record.room?._calcTfaOnly;
  let tfaTrCell: string | undefined;
  let tfaCfmCell: string | undefined;
  if (isTfaRoom) {
    tfaTrCell = rc(row, 2);
    putV(ws, row, 1, 'TFA / DOAS Coil Capacity  [outdoor-air coil TR]', S.label);
    putV(ws, row, 2, r2(roomTfaTR), S.total);
    putV(ws, row, 3, 'TR', S.total);
    addMerge(ws, row, 4, row, COLS);
    putV(ws, row, 4, record.room?._calcTfaOnly
      ? 'TFA-only room — primary coil carries zero; the TFA supply air is the sole conditioning.'
      : 'Outdoor-air sensible + latent handled by the DOAS/TFA unit, decoupled from the primary coil.', S.note);
    row++;
    tfaCfmCell = rc(row, 2);
    putV(ws, row, 1, 'TFA Design Airflow', S.label);
    putV(ws, row, 2, r0(roomTfaCFM), S.total);
    putV(ws, row, 3, 'CFM', S.total);
    row++;
    // Total air the room receives = space (recirc) coil + DOAS treated fresh. The coil above
    // sizes on the space airflow only. Skip tfa-only rooms (no own coil — supply is the DOAS).
    if (!record.room?._calcTfaOnly) {
      const spaceCFM = Math.max(record.summer.designSupplyCFM, record.monsoon?.designSupplyCFM ?? 0);
      putV(ws, row, 1, 'Total Room Supply  [space coil + DOAS fresh]', S.label);
      putV(ws, row, 2, r0(spaceCFM + roomTfaCFM), S.total);
      putV(ws, row, 3, 'CFM', S.total);
      addMerge(ws, row, 4, row, COLS);
      putV(ws, row, 4, `Total air the room receives = space (recirc) coil ${r0(spaceCFM)} + DOAS treated fresh ${r0(roomTfaCFM)} CFM. Fresh is held at the OA FACPH minimum; recirc floats up with the cooling load.`, S.note);
      row++;
    }
  }

  // Winter total ref cell — captured in the loop above (robust against the optional
  // TFA heating row, which would otherwise be mistaken for the last "Grand Total" row).
  const winterLoadCellFix = winterTotalCell || rc(calcStart + 10, 9);

  addBorders(ws, calcStart, 1, row - 1, COLS);
  row++;

  // IDU config summary cell (text — populated from equipment section below)
  const iduConfigRow = row + 3; // will be on the TOTAL row of equipment section
  let iduConfigCell  = rc(iduConfigRow, 2);

  // ── Selected Equipment ─────────────────────────────────────────────────────
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, 'SELECTED / ASSIGNED EQUIPMENT', S.secHdr);
  row++;
  ['Type', 'Brand', 'Model / Series', 'TR', 'CFM', 'Qty', 'Total TR', 'Total CFM', 'Notes'].forEach((h, i) => putV(ws, row, i + 1, h, S.tableHdr));
  row++;
  const eqStart = row;

  const equip = getRoomEquipment(record.room?.id, equipSystems);
  if (equip.length === 0) {
    addMerge(ws, row, 1, row, COLS);
    putV(ws, row, 1, 'No equipment assigned to this room/zone yet.', S.note);
    row++;
  } else {
    let totalEqTR = 0, totalEqCFM = 0;
    for (const eq of equip) {
      const totTR  = r2(eq.tr * eq.qty);
      const totCFM = r0(eq.cfm * eq.qty);
      putV(ws, row, 1, eq.role,  S.calc);
      putV(ws, row, 2, eq.brand, S.calc);
      putV(ws, row, 3, eq.model, S.calc);
      putV(ws, row, 4, r2(eq.tr),  S.calcC);
      putV(ws, row, 5, r0(eq.cfm), S.calcC);
      putV(ws, row, 6, eq.qty,     S.calcC);
      putV(ws, row, 7, totTR,      S.calcC);
      putV(ws, row, 8, totCFM,     S.calcC);
      putV(ws, row, 9, eq.note,   S.note);
      totalEqTR  += totTR;
      totalEqCFM += totCFM;
      row++;
    }
    // Total row
    putV(ws, row, 1, 'TOTAL', S.total);
    addMerge(ws, row, 1, row, 6);
    putV(ws, row, 7, r2(totalEqTR),  S.total);
    putV(ws, row, 8, r0(totalEqCFM), S.total);
    // Fit check
    const fitTR  = r2(record.governingTR);
    const surplus = r2(totalEqTR - record.governingTR);
    const fitSty = totalEqTR === 0 ? S.calcC : surplus >= -0.1 ? S.ok : S.warn;
    const fitMsg = totalEqTR === 0 ? 'Not assigned' : surplus >= -0.1 ? `OK ✓ (+${surplus} TR)` : `Undersized ⚠ (${surplus} TR)`;
    addMerge(ws, row, 9, row, COLS);
    putV(ws, row, 9, `Required: ${fitTR} TR  |  ${fitMsg}`, fitSty);
    iduConfigCell = rc(row, 9);
    row++;
  }
  addBorders(ws, eqStart, 1, row - 1, COLS);
  row++;

  // ── Column widths, print setup ──────────────────────────────────────────────
  ws['!cols'] = [
    { wch: 32 }, { wch: 14 }, { wch: 10 }, { wch: 4 },
    { wch: 14 }, { wch: 14 }, { wch: 4 },
    { wch: 24 }, { wch: 14 }, { wch: 10 },
  ];
  ws['!margins'] = { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.25, footer: 0.25 };
  (ws as any)['!pageSetup'] = { paperSize: 9, orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 };
  (ws as any)['!freeze'] = { xSplit: 0, ySplit: 2 };
  setRef(ws, row + 1, COLS);

  return {
    ws,
    refs: {
      sheetName:        record.sheetName,
      zoneName:         record.zoneName,
      systemName:       record.systemName,
      roomName:         safeStr(record.room?.name),
      floorName:        safeStr(record.room?.floor),
      areaCell,
      heightCell,
      falseCeilingCell,
      freshAirCell,
      occupancyCell,
      lightingCell,
      equipKwCell,
      summerTrCell:     sumTRcell,
      summerCfmCell:    sumCFMcell,
      monsoonTrCell:    incMon ? monTRcell : undefined,
      monsoonCfmCell:   incMon ? monCFMcell : undefined,
      winterLoadCell:   winterLoadCellFix,
      governingTrCell:  govTRcell,
      tfaTrCell,
      tfaCfmCell,
      tfaWinterHeatCell,
      iduConfigCell,
    },
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

// ─── Sheet: Airflow Schedule (recirc / fresh air, for terminal & duct layout) ──
function buildAirflowScheduleSheet(
  project: any,
  systems: any[],
  zones: any[],
  rooms: Record<string, any[]>,
  envelopeElements: Record<string, EnvelopeElement[]>,
  equipSystems: any[],
): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const incMon = !!project?.includeMonsoon;
  const COLS = 5;
  let row = 1;

  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, `AIRFLOW SCHEDULE (RECIRC / FRESH AIR) — ${safeStr(project?.name, 'PROJECT').toUpperCase()}`, S.titleSm);
  row++;
  addMerge(ws, row, 1, row, COLS);
  putV(ws, row, 1, `Date: ${fmtDate()}  |  Recirc = Total - Fresh.  Total = governing (worst-season) airflow.  Supply diffusers = Total  ·  Return/recirc = Recirc  ·  OA intake or DOAS branch = FACFM`, mkS({ sz: 9, italic: true }, CLR.sectionBg));
  row += 2;

  // Shared TFA-aware builder — same split (Recirc = Total - FACFM) as the app + PDF.
  const zoneInputs: AirflowZoneInput[] = [];
  for (const [zoneId, zoneRooms] of Object.entries(rooms)) {
    const zos = zones.find((z: any) => z.id === zoneId) ?? systems.find((s: any) => s.id === zoneId);
    zoneInputs.push({
      zoneId,
      zoneName: zos?.name ?? 'Zone',
      summerDc: getDesignConditions(project, zos, 'summer'),
      monsoonDc: incMon ? getDesignConditions(project, zos, 'monsoon') : null,
      rooms: (zoneRooms as any[]).map((r) => ({ room: r, elements: envelopeElements[r.id] || [] })),
    });
  }
  const schedule = buildAirflowSchedule({ zones: zoneInputs, project, equipSystems, zoneDocs: zones });

  const hdrRow = row;
  ['Room', 'Fresh Air', 'Recirc CFM', 'Fresh (FACFM)', 'Total Supply CFM'].forEach((h, i) => putV(ws, row, i + 1, h, S.tableHdr));
  row++;
  const dataStart = row;

  let pRe = 0, pFa = 0, pTo = 0;
  for (const z of schedule) {
    addMerge(ws, row, 1, row, COLS);
    putV(ws, row, 1, `▶  ${z.zoneName}`, S.greenHdr);
    row++;
    for (const r of z.rooms) {
      const modeLabel = r.mode === 'tfa-only' ? 'TFA-only' : r.mode === 'tfa-served' ? 'Central TFA' : 'On unit';
      putV(ws, row, 1, r.roomName, S.calc);
      putV(ws, row, 2, modeLabel, S.calc);
      putV(ws, row, 3, r0(r.recirc), S.calcC);
      putV(ws, row, 4, r0(r.facfm), S.calcC);
      putV(ws, row, 5, r0(r.totalSupply), S.calcC);
      row++;
    }
    putV(ws, row, 1, `${z.zoneName} subtotal`, S.total);
    putV(ws, row, 2, '', S.total);
    putV(ws, row, 3, r0(z.recirc), S.total);
    putV(ws, row, 4, r0(z.facfm), S.total);
    putV(ws, row, 5, r0(z.totalSupply), S.total);
    row++;
    pRe += z.recirc; pFa += z.facfm; pTo += z.totalSupply;
  }
  if (row > dataStart) addBorders(ws, dataStart, 1, row - 1, COLS);

  putV(ws, row, 1, 'PROJECT TOTAL', S.total);
  putV(ws, row, 2, '', S.total);
  putV(ws, row, 3, r0(pRe), S.total);
  putV(ws, row, 4, r0(pFa), S.total);
  putV(ws, row, 5, r0(pTo), S.total);
  addBorders(ws, row, 1, row, COLS);
  row++;

  ws['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 13 }, { wch: 15 }, { wch: 17 }];
  ws['!rows'] = [{ hpt: 30 }];
  (ws as any)['!freeze'] = { xSplit: 0, ySplit: hdrRow };
  setRef(ws, row + 1, COLS);
  (ws as any)['!pageSetup'] = { paperSize: 9, orientation: 'portrait', fitToWidth: 1, fitToHeight: 0 };
  return ws;
}

export const generateExcelReport = (
  project: any,
  systems: any[],
  zones: any[],
  rooms: Record<string, any[]>,
  envelopeElements: Record<string, EnvelopeElement[]>,
  equipSystems?: any[],
  userProfile?: any,
) => {
  buildExcelStamp(project);
  const wb = XLSX.utils.book_new();
  const eq = equipSystems ?? [];
  const records = toRoomRecords(project, systems, zones, rooms, envelopeElements, eq);
  const refs: RoomSheetRefs[] = [];

  // Build room sheets first (their cell refs are needed by Load Summary)
  const roomSheets: { ws: XLSX.WorkSheet; sheetName: string }[] = [];
  for (const rec of records) {
    const { ws, refs: r } = buildRoomSheet(project, rec, eq);
    roomSheets.push({ ws, sheetName: rec.sheetName });
    refs.push(r);
  }

  // Add fixed sheets in order
  XLSX.utils.book_append_sheet(wb, buildCoverSheet(project, records, eq, userProfile), 'Cover');
  XLSX.utils.book_append_sheet(wb, buildDesignConditionsSheet(project), 'Design Conditions');
  XLSX.utils.book_append_sheet(wb, buildZoneSummarySheet(project, records, eq), 'Zone Summary');
  XLSX.utils.book_append_sheet(wb, buildAirflowScheduleSheet(project, systems, zones, rooms, envelopeElements, eq), 'Airflow Schedule');
  XLSX.utils.book_append_sheet(wb, buildEquipmentScheduleSheet(project, eq, rooms), 'Equipment Schedule');
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(project, refs), 'Load Summary');

  // Add room sheets
  for (const { ws, sheetName } of roomSheets) {
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // Tab colours (supported by Excel 2010+, silently ignored elsewhere)
  (wb as any).Workbook = {
    Sheets: [
      { Hidden: 0 as 0, TabColor: { rgb: '4472C4' } }, // Cover
      { Hidden: 0 as 0, TabColor: { rgb: '2E75B6' } }, // Design Conditions
      { Hidden: 0 as 0, TabColor: { rgb: '375623' } }, // Zone Summary
      { Hidden: 0 as 0, TabColor: { rgb: '548235' } }, // Airflow Schedule
      { Hidden: 0 as 0, TabColor: { rgb: '7030A0' } }, // Equipment Schedule
      { Hidden: 0 as 0, TabColor: { rgb: 'C55A11' } }, // Load Summary
      ...roomSheets.map(() => ({ Hidden: 0 as 0, TabColor: { rgb: '1F4E79' } })),
    ],
  };

  // File name — use actual system type instead of hardcoded VRF
  const sysLabel = (() => {
    const types = [...new Set((eq as any[]).map((s: any) => safeStr(s.type)).filter(Boolean))];
    if (types.length === 0) return 'HVAC';
    if (types.length === 1) return types[0];
    return 'MULTI_SYS';
  })();

  const projSlug = safeStr(project?.name, 'Project').trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '');
  const revTag = excelStamp.rev ? `_${excelStamp.rev}` : '';
  const idTag = excelStamp.id ? `${excelStamp.id}_` : '';
  const fileName = `${idTag}${sysLabel}_HEAT_LOAD_${projSlug}${revTag}_${fmtDateFile()}.xlsx`;

  const buf  = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url  = window.URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.setAttribute('download', fileName);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};
