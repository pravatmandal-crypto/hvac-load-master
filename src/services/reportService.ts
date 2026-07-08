import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  calculateRoomVolume,
  calculateVentilationLoad,
  calculateInternalGains,
  calculateEnvelopeGain,
  calculateHeatingLoad,
  calculateCoilParameters,
  calculateParasiticGains,
  calculatePsychrometrics,
  calculateTFALoad,
  resolveRoomTfa,
  getRecommendedAch,
  getMinAdp,
  calculateSingleElementGain,
} from '../lib/hvac-logic';
import { resolveSupplyCfm, resolveRoomSupplyBasis, resolveTotalSupplyACH, computeAirflowSplit } from '../lib/hvac/supplyCfm';

// DOAS/TFA systems for the report currently being built. Set once at the top of
// each (synchronous) report-generation entry point; read by computeDetailed to
// make the whole report TFA-aware. Synchronous render = no concurrency concern.
let reportEquipSystems: any[] = [];

// Report identity stamp — set once per report build, read by drawFooter + headers.
// Lets the engineer control the printed Report Date and carry a stable Report No.
// + Revision so re-issues are identifiable and accidental duplicates are obvious.
let reportStamp: { id: string; rev: string; dateShort: string; dateLong: string } = {
  id: '', rev: '', dateShort: '', dateLong: '',
};
const buildReportStamp = (project: any) => {
  const raw = project?.reportDate;                       // 'YYYY-MM-DD' or undefined
  const parsed = raw ? new Date(`${raw}T00:00:00`) : null;
  const d = parsed && !isNaN(parsed.getTime()) ? parsed : new Date();   // fall back to today
  reportStamp = {
    id: String(project?.reportId || ''),
    rev: project?.reportRev != null ? `R${project.reportRev}` : '',
    dateShort: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short',  year: 'numeric' }),
    dateLong:  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long',   year: 'numeric' }),
  };
};
// Filename prefix so saved PDFs sort/identify by report No. + revision (blank when no ID yet).
const reportFileTag = () => (reportStamp.id ? `${reportStamp.id}_${reportStamp.rev || 'R0'}_` : '');

// DOAS/TFA system serving a room — delegates to the shared resolver (room.tfaMode
// primary, legacy link fallback) against the report's equip systems.
const findReportDoasForRoom = (room: any): any | null =>
  resolveRoomTfa(room, reportEquipSystems).doas;

// ─── Types ────────────────────────────────────────────────────────────────────

export type HvacHierarchyData = {
  systems: any[];                          // /hvacSystems docs
  zonesBySystem: Record<string, any[]>;    // sysId → HvacZoneDoc[]
  rooms: Record<string, any[]>;            // hvacZoneId → Room[]
};

type SeasonKey = 'summer' | 'monsoon' | 'winter';

type SeasonProfile = {
  key: SeasonKey;
  label: string;
  outdoorTemp: number;
  outdoorHumidity: number;
  indoorTemp: number;
  indoorHumidity: number;
};

type EntityRecord = {
  id: string;
  type: 'System' | 'Zone';
  name: string;
  parentSystem?: string;
  indoorTemp?: number;
  indoorHumidity?: number;
  outdoorTemp?: number;
  outdoorHumidity?: number;
  winterIndoorTemp?: number;
  winterIndoorHumidity?: number;
  rooms: any[];
};

type DC = {
  outdoorTemp: number;
  outdoorHumidity: number;
  indoorTemp: number;
  indoorHumidity: number;
  altitude: number;
  winterOutdoorTemp: number;
  winterOutdoorHumidity: number;
  winterIndoorTemp?: number;
  winterIndoorHumidity?: number;
};

type DetailedMetrics = {
  area: number;
  ventilationCfm: number;
  faCfm: number;
  designCfm: number;
  totalAch: number;
  totalSupplyCfm: number;
  heatingLoad: number;
  // Envelope breakdown
  envWalls: number;
  envRoof: number;
  envGlassTrans: number;
  envGlassSolar: number;
  envPartitions: number;
  envFloor: number;
  envelopeTotal: number;
  // Internal breakdown
  peopleSensible: number;
  peopleLatent: number;
  lightsSensible: number;
  equipmentSensible: number;
  othersSensible: number;
  internalSensible: number;
  internalLatent: number;
  // Ventilation (bypassed room portion)
  ventSensibleBF: number;
  ventLatentBF: number;
  // Parasitic
  ductGain: number;
  fanGain: number;
  // Effective room
  erSensibleRaw: number;
  erLatentRaw: number;
  sSafetyPct: number;
  lSafetyPct: number;
  oSafetyPct: number;
  ersh: number;
  erlh: number;
  erh: number;
  // Outdoor air (unbypassed)
  oaSensible: number;
  oaLatent: number;
  // Coil
  coilSensible: number;
  coilLatent: number;
  grandTotal: number;
  loadTr: number;
  cfmTr: number;
  governingTr: number;
  requiredTr: number;
  // TFA / DOAS (outdoor-air coil handled by the DOAS unit; zero when not DOAS-served)
  isTFA: boolean;
  isTfaOnly: boolean;
  tfaCoilSensible: number;
  tfaCoilLatent: number;
  tfaCoilTr: number;
  tfaCfm: number;
  tfaSupplyOffsetSen: number;
  tfaSupplyOffsetLat: number;
  // Summer dehumidification reheat (cool OA to ADP, then reheat to supply temp).
  // Zero for a cold supply (within bypass of its ADP) — see lib/hvac/ventilation.ts.
  tfaReheat: number;       // BTU/h
  tfaCoilADP: number;      // °F — apparatus dew point at supply W
  // Coil parameters
  indicatedAdp: number;
  selectedAdp: number;
  rshf: number;
  adpUnreachable: boolean;
  dehumidSensibleCfm: number;
  latentCfm: number;
  latentShortfallCfm: number;
  reheatRequiredBtu: number;
  // Heating with safety factors (populated for winter DC calls)
  heatingSafetyPct: number;
  heatingPickupPct: number;
  hTransRaw: number;
  hVentRaw: number;
  hTransSafe: number;
  hVentSafe: number;
  hSlabRaw: number;
  hSlabSafe: number;
  hHumLoad: number;
  heatingSubtotal: number;
  designHeatingLoad: number;
  includeHumidifier: boolean;
  // Winter humidification
  humNeeded: boolean;
  humDeltaWGr: number;
  humWOutGr: number;
  humWInGr: number;
  humRhAfterHeating: number;
  humRateBase: number;
  humRate: number;
  humEnergyBTU: number;
  humEnergyKW: number;
  humExceedsCap62: boolean;
  humFreshCFM: number;
};

// ─── Theme ───────────────────────────────────────────────────────────────────

type Theme = {
  eco:       boolean;
  ink:       [number,number,number];
  subInk:    [number,number,number];
  line:      [number,number,number];
  panel:     [number,number,number];
  panelDark: [number,number,number];
  accent:    [number,number,number];
  accentBg:  [number,number,number];
  total:     [number,number,number];
  grandBg:   [number,number,number];
  grandFg:   [number,number,number];
  headFg:    [number,number,number];
  coverText: [number,number,number];
  adpBg:     [number,number,number];
  summerBg:  [number,number,number];
  winterBg:  [number,number,number];
  monsoonBg: [number,number,number];
};

// Eco mode: no fills, only borderlines. All *Bg / panel / accent fillColors
// resolve to white so rect 'F' draws become invisible on white pages, leaving
// only the table grid borders + dark text. headFg / grandFg / coverText flip
// to dark so text remains legible on the now-white surfaces.
const ECO_WHITE: [number,number,number] = [255, 255, 255];
const makeTheme = (eco: boolean): Theme => ({
  eco,
  ink:       [15,  35,  60],
  subInk:    [75,  90, 110],
  line:      eco ? [120, 120, 120] : [190, 200, 215],
  panel:     eco ? ECO_WHITE : [240, 244, 250],
  panelDark: eco ? ECO_WHITE : [210, 220, 235],
  accent:    eco ? ECO_WHITE : [15,  80, 160],
  accentBg:  eco ? ECO_WHITE : [230, 240, 255],
  total:     eco ? ECO_WHITE : [220, 235, 255],
  grandBg:   eco ? ECO_WHITE : [15,  80, 160],
  grandFg:   eco ? [15, 35, 60] : [255, 255, 255],
  headFg:    eco ? [15, 35, 60] : [255, 255, 255],
  coverText: eco ? [80,  80,  80] : [200, 220, 255],
  adpBg:     eco ? ECO_WHITE : [255, 238, 210],
  summerBg:  eco ? ECO_WHITE : [255, 245, 230],
  winterBg:  eco ? ECO_WHITE : [230, 245, 255],
  monsoonBg: eco ? ECO_WHITE : [230, 255, 245],
});

// Default (colour) theme — used by helper functions that don't receive a theme param
const DEFAULT_THEME = makeTheme(false);

const PAGE = { left: 12, right: 12, top: 20, bottom: 16 };


// ─── Helpers ─────────────────────────────────────────────────────────────────

const asNum = (v: any, fb: number) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };
const n0  = (v: number) => Math.round(v).toLocaleString();
const n1  = (v: number) => v.toFixed(1);
const n2  = (v: number) => v.toFixed(2);
const n4  = (v: number) => v.toFixed(4);
// Temperature helpers — report shows °F and °C side by side.
const fToC   = (f: number) => (f - 32) * 5 / 9;
const dualT0 = (f: number) => `${Math.round(f)} / ${fToC(f).toFixed(1)}`;        // cell value; unit (°F / °C) lives in the row label
const dualT1 = (f: number) => `${f.toFixed(1)} / ${fToC(f).toFixed(1)}`;
const dualTu = (f: number) => `${f.toFixed(1)}°F / ${fToC(f).toFixed(1)}°C`;      // inline, units inline

// ─── Header / Footer ─────────────────────────────────────────────────────────

const drawHeader = (doc: jsPDF, project: any, pageNo: number, totalPages: number, C: Theme = DEFAULT_THEME) => {
  const w = doc.internal.pageSize.getWidth();
  if (C.eco) {
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.3);
    doc.line(0, 10, w, 10);
  } else {
    doc.setFillColor(...C.accent);
    doc.rect(0, 0, w, 10, 'F');
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.headFg);
  doc.text(String(project?.name || 'PROJECT').toUpperCase(), PAGE.left, 6.5);
  doc.setFont('helvetica', 'normal');
  doc.text('HVAC LOAD CALCULATION REPORT', w / 2, 6.5, { align: 'center' });
  doc.text(`Page ${pageNo} of ${totalPages}`, w - PAGE.right, 6.5, { align: 'right' });
};

const drawFooter = (doc: jsPDF, C: Theme = DEFAULT_THEME) => {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setDrawColor(...C.line);
  doc.setLineWidth(0.2);
  doc.line(PAGE.left, h - PAGE.bottom + 2, w - PAGE.right, h - PAGE.bottom + 2);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(6.5);
  doc.setTextColor(...C.subInk);
  doc.text('Calculated per ASHRAE Fundamentals 2017 (IP Units)', PAGE.left, h - PAGE.bottom + 6);
  doc.setFont('helvetica', 'normal');
  doc.text('© CREATIVE CONCEPT', w / 2, h - PAGE.bottom + 6, { align: 'center' });
  doc.setFont('helvetica', 'italic');
  const ds = reportStamp.dateShort || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const idTag = reportStamp.id ? `${reportStamp.id}${reportStamp.rev ? ' ' + reportStamp.rev : ''}   ·   ` : '';
  doc.text(`${idTag}${ds}`, w - PAGE.right, h - PAGE.bottom + 6, { align: 'right' });
};

const sectionBanner = (doc: jsPDF, text: string, y: number, C: Theme = DEFAULT_THEME) => {
  const w = doc.internal.pageSize.getWidth();
  if (C.eco) {
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.3);
    doc.rect(PAGE.left, y - 4, w - PAGE.left - PAGE.right, 7, 'S');
  } else {
    doc.setFillColor(...C.accent);
    doc.rect(PAGE.left, y - 4, w - PAGE.left - PAGE.right, 7, 'F');
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...C.headFg);
  doc.text(text, PAGE.left + 3, y + 0.8);
  return y + 7;
};

const subBanner = (doc: jsPDF, text: string, y: number, C: Theme = DEFAULT_THEME) => {
  const w = doc.internal.pageSize.getWidth();
  if (C.eco) {
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.3);
    doc.rect(PAGE.left, y - 3.5, w - PAGE.left - PAGE.right, 6.5, 'S');
  } else {
    doc.setFillColor(...C.panelDark);
    doc.rect(PAGE.left, y - 3.5, w - PAGE.left - PAGE.right, 6.5, 'F');
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.ink);
  doc.text(text, PAGE.left + 3, y + 0.8);
  return y + 6.5;
};

// ─── Data builders ────────────────────────────────────────────────────────────

const getSeasonProfiles = (project: any): SeasonProfile[] => {
  const inSumT  = asNum(project?.insideSummerTemp  ?? project?.data?.insideSummerTemp,  75);
  const inSumRH = asNum(project?.insideSummerHumidity ?? project?.data?.insideSummerHumidity, 50);
  const profiles: SeasonProfile[] = [
    {
      key: 'summer',
      label: 'Summer',
      outdoorTemp:     asNum(project?.summerDesignTemp     ?? project?.data?.summerDesignTemp,     95),
      outdoorHumidity: asNum(project?.summerDesignHumidity ?? project?.data?.summerDesignHumidity, 50),
      indoorTemp:      inSumT,
      indoorHumidity:  inSumRH,
    },
  ];

  const includeMonsoon = !!(project?.includeMonsoon ?? project?.data?.includeMonsoon);
  if (includeMonsoon) {
    profiles.push({
      key: 'monsoon',
      label: 'Monsoon',
      outdoorTemp:     asNum(project?.monsoonDesignTemp     ?? project?.data?.monsoonDesignTemp,     85),
      outdoorHumidity: asNum(project?.monsoonDesignHumidity ?? project?.data?.monsoonDesignHumidity, 85),
      indoorTemp:      asNum(project?.insideMonsoonTemp     ?? project?.data?.insideMonsoonTemp,     inSumT),
      indoorHumidity:  asNum(project?.insideMonsoonHumidity ?? project?.data?.insideMonsoonHumidity, 55),
    });
  }

  const includeWinter = !!(project?.includeWinter ?? project?.data?.includeWinter);
  if (includeWinter) {
    profiles.push({
      key: 'winter',
      label: 'Winter',
      outdoorTemp:     asNum(project?.winterDesignTemp     ?? project?.data?.winterDesignTemp,     40),
      outdoorHumidity: asNum(project?.winterDesignHumidity ?? project?.data?.winterDesignHumidity, 30),
      indoorTemp:      asNum(project?.insideWinterTemp     ?? project?.data?.insideWinterTemp,     70),
      indoorHumidity:  asNum(project?.insideWinterHumidity ?? project?.data?.insideWinterHumidity, 40),
    });
  }

  return profiles;
};

const buildEntityRecords = (_project: any, systems: any[], zones: any[], rooms: Record<string, any[]>, equipSystems: any[] = []): EntityRecord[] => {
  // Use zones when available — all project types now use flat zone architecture.
  // Fallback to systems only for legacy VRF projects that have systems but no separate zones.
  if (zones.length > 0) {
    // LC surfaces ES SYSTEMS as zones-with-description (so the LC tree can render
    // System > Zone > Room). Those are parent rows, NOT data zones — filter them out
    // before generating per-zone PDF entries to avoid duplicate "ZONE DETAIL — System N"
    // pages with 0 rooms.
    const equipSystemIds = new Set((equipSystems ?? []).map((s: any) => s.id));
    const realZones = zones.filter((z: any) => !equipSystemIds.has(z.id) && z.description === undefined);
    return realZones.map((zone: any) => {
      // Parent system can live in /systems (legacy LC VRF) OR /equipmentSystems (ES sub-zones)
      const parent =
        systems.find((s: any) => s.id === (zone.systemId ?? zone.id))
        ?? (equipSystems ?? []).find((s: any) => s.id === zone.systemId);
      return {
        id: zone.id, type: 'Zone' as const, name: zone.name || `Zone ${zone.id}`,
        parentSystem: parent?.name,
        indoorTemp: zone.indoorTemp, indoorHumidity: zone.indoorHumidity,
        outdoorTemp: zone.outdoorTemp, outdoorHumidity: zone.outdoorHumidity,
        winterIndoorTemp: zone.winterIndoorTemp, winterIndoorHumidity: zone.winterIndoorHumidity,
        rooms: rooms[zone.id] || [],
      };
    });
  }
  // Legacy fallback: VRF systems used as zone grouping before flat-room migration
  return systems.map((sys: any) => ({
    id: sys.id, type: 'System' as const, name: sys.name || `System ${sys.id}`,
    indoorTemp: sys.indoorTemp, indoorHumidity: sys.indoorHumidity,
    outdoorTemp: sys.outdoorTemp, outdoorHumidity: sys.outdoorHumidity,
    winterIndoorTemp: sys.winterIndoorTemp, winterIndoorHumidity: sys.winterIndoorHumidity,
    rooms: rooms[sys.id] || [],
  }));
};

// fallbackRoomIds: room IDs belonging to this entity — used to match equipment zones by room
// membership when zone IDs differ (e.g. equipment zones use grp-{ts} while Firestore zone
// docs have their own doc IDs).
const getInstalledTrCfm = (entityId: string, eqSystems: any[], fallbackRoomIds?: string[]): { tr: number; cfm: number } => {
  const extractZone = (eZone: any): { tr: number; cfm: number } | null => {
    if (eZone.selection) {
      const sel = eZone.selection;
      const qty = sel.quantity ?? 1;
      return { tr: (sel.trCapacity ?? 0) * qty, cfm: (sel.cfmRated ?? 0) * qty };
    }
    if (eZone.unitSelections?.length) {
      const totalTr  = (eZone.unitSelections as any[]).reduce((s: number, u: any) => s + (u.trCapacity ?? 0) * (u.quantity ?? 1), 0);
      const totalCfm = (eZone.unitSelections as any[]).reduce((s: number, u: any) => s + (u.cfmRated  ?? 0) * (u.quantity ?? 1), 0);
      return { tr: totalTr, cfm: totalCfm };
    }
    return null;
  };
  for (const sys of eqSystems) {
    const eqZones = (sys.zones ?? []) as any[];
    // Primary: match by zone ID
    let eZone = eqZones.find((z: any) => z.id === entityId);
    // Fallback: match by room membership (equipment zones use grp-{ts} IDs, not Firestore zone doc IDs)
    if (!eZone && fallbackRoomIds?.length) {
      eZone = eqZones.find((z: any) =>
        (z.roomIds as string[] ?? []).some((rid: string) => fallbackRoomIds.includes(rid))
      );
    }
    if (eZone) {
      const result = extractZone(eZone);
      if (result) return result;
    }
    // Per-room iduSelections (VRF individual IDUs — rooms not grouped into an equipment zone)
    if (fallbackRoomIds?.length && sys.iduSelections) {
      const iduSels = sys.iduSelections as Record<string, any>;
      let totalTr = 0, totalCfm = 0;
      for (const [roomId, val] of Object.entries(iduSels)) {
        if (!fallbackRoomIds.includes(roomId)) continue;
        const units: any[] = Array.isArray(val) ? val : (val ? [val] : []);
        for (const u of units) {
          totalTr  += (u.trCapacity ?? 0) * (u.quantity ?? 1);
          totalCfm += (u.cfmRated  ?? 0) * (u.quantity ?? 1);
        }
      }
      if (totalTr > 0) return { tr: totalTr, cfm: totalCfm };
    }
    // Legacy: entity ID matches system ID directly
    if (sys.id === entityId) {
      if (sys.unitSelection) {
        const u = sys.unitSelection;
        return { tr: (u.trCapacity ?? 0) * (u.quantity ?? 1), cfm: (u.cfmRated ?? 0) * (u.quantity ?? 1) };
      }
      if (sys.oduSelection) {
        const odu = sys.oduSelection;
        return { tr: odu.effectiveTR ?? ((odu.trCapacity ?? 0) * (odu.modules ?? 1)), cfm: 0 };
      }
    }
  }
  return { tr: 0, cfm: 0 };
};

// Per-room installed TR/CFM: checks iduSelections first, then the zone-group that contains the room
const getRoomInstalledTrCfm = (roomId: string, eqSystems: any[]): { tr: number; cfm: number } => {
  for (const sys of eqSystems) {
    if (sys.iduSelections) {
      const val = (sys.iduSelections as Record<string, any>)[roomId];
      if (val) {
        const units: any[] = Array.isArray(val) ? val : [val];
        const tr  = units.reduce((s: number, u: any) => s + (u.trCapacity ?? 0) * (u.quantity ?? 1), 0);
        const cfm = units.reduce((s: number, u: any) => s + (u.cfmRated  ?? 0) * (u.quantity ?? 1), 0);
        if (tr > 0) return { tr, cfm };
      }
    }
    for (const z of (sys.zones ?? []) as any[]) {
      if (!(z.roomIds as string[] ?? []).includes(roomId)) continue;
      if (z.selection) {
        const sel = z.selection;
        return { tr: (sel.trCapacity ?? 0) * (sel.quantity ?? 1), cfm: (sel.cfmRated ?? 0) * (sel.quantity ?? 1) };
      }
      if (z.unitSelections?.length) {
        const tr  = (z.unitSelections as any[]).reduce((s: number, u: any) => s + (u.trCapacity ?? 0) * (u.quantity ?? 1), 0);
        const cfm = (z.unitSelections as any[]).reduce((s: number, u: any) => s + (u.cfmRated  ?? 0) * (u.quantity ?? 1), 0);
        return { tr, cfm };
      }
    }
    if (sys.type === 'Split' && sys.roomSelections) {
      const val = (sys.roomSelections as Record<string, any>)[roomId];
      if (val) {
        const units: any[] = Array.isArray(val) ? val : [val];
        const tr  = units.reduce((s: number, u: any) => s + (u.trCapacity ?? 0) * (u.quantity ?? 1), 0);
        const cfm = units.reduce((s: number, u: any) => s + (u.cfmRated  ?? 0) * (u.quantity ?? 1), 0);
        if (tr > 0) return { tr, cfm };
      }
    }
  }
  return { tr: 0, cfm: 0 };
};

// Sum of IDU/FCU TR and CFM across all equipment systems (for Executive Summary).
// Mirrors the Section 5 rendering logic exactly: zone-level selections first,
// sys.unitSelection (ODU/plant) and sys.chillerUnits (plant) are intentionally excluded.
// Caller is expected to pass only active (room-referenced) systems.
const computeTotalInstalledIDU = (eqSystems: any[]): { tr: number; cfm: number } => {
  let tr = 0, cfm = 0;
  for (const sys of eqSystems) {
    // Mirror the authoritative formula from EquipmentSelection.tsx lines 2815-2821:
    // sum ALL iduSelections + sum ALL zone.selection — data model guarantees no overlap.
    if (sys.iduSelections) {
      for (const val of Object.values(sys.iduSelections as Record<string, any>)) {
        const units: any[] = Array.isArray(val) ? val : (val ? [val] : []);
        for (const u of units) {
          tr  += (u.trCapacity ?? 0) * (u.quantity ?? 1);
          cfm += (u.cfmRated  ?? 0) * (u.quantity ?? 1);
        }
      }
    }
    for (const z of (sys.zones ?? (sys as any).ahuGroups ?? []) as any[]) {
      if (z.selection) {
        tr  += (z.selection.trCapacity ?? 0) * (z.selection.quantity ?? 1);
        cfm += (z.selection.cfmRated  ?? 0) * (z.selection.quantity ?? 1);
      }
    }
  }
  return { tr, cfm };
};

// Compute total installed plant/ODU capacity broken down by system type and Working/Standby role.
// Only the outdoor/plant equipment is counted (not IDUs/FCUs).
// For chillers, uses Actual TR (site-condition, OEM-confirmed) when available, else Nominal.
// Returns a per-system diversity line: indoor space load × design DF + non-diverse
// outdoor-air load (room fresh air + chiller-fed TFA), versus installed plant TR.
// Diversity is applied to the INDOOR calc only — fresh air is continuous and carried
// in full — then the install margin is shown.
//   Example: "Chiller Plant: diversity 75% -> 110.00×0.75 + OA 25.50 = 108.00 TR req'd; installed 144.00 TR (133%)"
// Connected space indoor-unit (AHU/FCU/IDU) TR for a system — zone terminal selections
// (z.unitSelections or z.selection) plus any direct per-room IDU selections. The TFA/DOAS
// unit is a separate system, so it is naturally excluded. Mirrors EquipmentSelection's
// installed-capacity plant basis (chiller plant is sized off the selected AHUs).
const connectedIduTR = (sys: any): number => {
  let iduTR = 0;
  for (const z of (sys.zones ?? (sys as any).ahuGroups ?? []) as any[]) {
    if (z.unitSelections?.length) iduTR += (z.unitSelections as any[]).reduce((s: number, u: any) => s + (u.trCapacity ?? 0) * (u.quantity ?? 1), 0);
    else if (z.selection) iduTR += (z.selection.trCapacity ?? 0) * (z.selection.quantity ?? 1);
  }
  if (sys.iduSelections) Object.values(sys.iduSelections as Record<string, any>).forEach((val: any) => {
    (Array.isArray(val) ? val : val ? [val] : []).forEach((u: any) => { iduTR += (u.trCapacity ?? 0) * (u.quantity ?? 1); });
  });
  return iduTR;
};

// Per-zone dehumidification strategy (set in Equipment Selection) — so the report can show
// that a latent shortfall is RESOLVED by the engineer's chosen reheat / desiccant, instead of
// flagging it as an open problem. Method + reheat kW live on the ES sub-zone (or the system).
const DEHUMID_REHEAT_LABELS: Record<string, string> = {
  'reheat-hwc': 'AHU Heating Coil (HW)',
  'reheat-electric-ahu': 'AHU Electric Heater',
  'reheat-duct': 'Duct Heater',
  'standalone': 'Standalone Desiccant / DX',
};
const isReheatMethod = (m?: string | null): boolean =>
  m === 'reheat-hwc' || m === 'reheat-electric-ahu' || m === 'reheat-duct';
const resolveRoomDehumid = (
  room: any,
  systems: any[],
): { method: string; reheatKW: number | null; label: string } | null => {
  for (const sys of systems) {
    const inSys = room.systemId === sys.id || room.zoneId === sys.id || room.hvacSystemId === sys.id
      || ((sys.zones ?? []) as any[]).some((z: any) => (z.roomIds ?? []).includes(room.id));
    if (!inSys) continue;
    const zone = ((sys.zones ?? []) as any[]).find((z: any) => z.id === room.zoneId || (z.roomIds ?? []).includes(room.id));
    const method = (zone?.dehumidMethod ?? (sys as any).dehumidMethod) as string | null | undefined;
    if (!method) return null;
    const reheatKW = Number(zone?.dehumidReheatKW ?? zone?.fahu?.electricHeaterKW ?? (sys as any).dehumidReheatKW) || null;
    return { method, reheatKW, label: DEHUMID_REHEAT_LABELS[method] ?? method };
  }
  return null;
};

const formatDiversitySummary = (
  systems: any[],
  flatRooms: any[],
  roomIndoorTR: Map<string, number>,
  roomNonDiverseTR?: Map<string, number>,
  roomChillerTfaTR?: Map<string, number>,
): string => {
  const parts: string[] = [];
  for (const sys of systems) {
    const t = String(sys.type ?? '');
    if (t !== 'VRF' && t !== 'Chiller') continue;

    // Installed plant TR — working only for chillers (standby excluded); ODU effective TR for VRF
    let installedTR = 0;
    if (t === 'Chiller') {
      const units: any[] = sys.chillerUnits?.length
        ? sys.chillerUnits
        : (sys.unitSelection ? [{ ...sys.unitSelection, quantity: sys.unitSelection.quantity ?? 1 }] : []);
      for (const u of units) {
        if (u.role === 'standby') continue;
        const per = (u.actualTR != null && u.actualTR > 0) ? u.actualTR : (u.trCapacity ?? 0);
        installedTR += per * (u.quantity ?? 1);
      }
    } else {
      const odu = sys.oduSelection;
      if (odu) installedTR = odu.effectiveTR ?? ((odu.trCapacity ?? 0) * (odu.modules ?? 1));
    }

    // Sum of room TR for rooms tied to this system — indoor (diversifiable) and the
    // non-diverse outdoor-air load (room fresh air + any chiller-fed TFA coil).
    let sumIndoorTR = 0, sumOaTR = 0, sumTfaTR = 0;
    for (const r of flatRooms) {
      if (r.systemId === sys.id || r.zoneId === sys.id || r.hvacSystemId === sys.id) {
        sumIndoorTR += roomIndoorTR.get(r.id) ?? 0;
        sumOaTR     += roomNonDiverseTR?.get(r.id) ?? 0;
        sumTfaTR    += roomChillerTfaTR?.get(r.id) ?? 0;
      }
    }
    if (sumIndoorTR <= 0 && sumOaTR <= 0) continue;

    // Design diversity de-rates INDOOR peaks (zones don't peak together). The fresh-air /
    // OA load runs continuously, so it is NOT diversified — it adds on top. Plant is sized
    // off the SELECTED AHU/IDU capacity (indoor portion = connected − OA); falls back to the
    // space-load indoor before any unit is selected. Mirrors EquipmentSelection.
    const df = Math.max(0, Math.min(1, Number(sys.diversityFactor ?? 0.75)));
    const connected = connectedIduTR(sys);
    // Subtract only the on-unit fresh air (oa − chiller-fed TFA) from the connected AHU
    // capacity — the chiller-fed TFA coil is a separate DOAS unit, not inside the AHU TR.
    const onUnitOa = Math.max(0, sumOaTR - sumTfaTR);
    const indoorBasis = connected > 0 ? Math.max(0, connected - onUnitOa) : sumIndoorTR;
    const requiredTR = indoorBasis * df + sumOaTR;
    if (requiredTR <= 0 || installedTR <= 0) continue;

    const marginPct = (installedTR / requiredTR) * 100;
    const name = sys.name ?? sys.id;
    // Client-facing: show only the net diversified plant-required TR and install margin.
    // Diversity de-rates the indoor load; fresh-air/OA is held out un-diversified — but
    // that split is intentionally NOT shown here (it confuses clients when there's no
    // separate TFA/OA unit). The breakdown lives in the on-screen Equipment Selection.
    parts.push(`${name}: diversity ${(df * 100).toFixed(0)}% -> ${n2(requiredTR)} TR req'd; installed ${n2(installedTR)} TR (${marginPct.toFixed(0)}%)`);
  }
  return parts.length > 0 ? parts.join('  |  ') : '—  (all systems at 100%)';
};

// Diversity-applied plant required TR across chiller/VRF systems, matching the app's
// chillerPlantRequiredTR: (Σ indoor room load × design diversity) + Σ non-diverse OA
// (room fresh air + chiller-fed TFA coil). Same inputs as formatDiversitySummary so the
// headline submission basis and the diversity line always agree.
// Exported for the regression test net (Step-1 safety net, 2026-07-08) — locks the
// R85 "47.84 TR" plant-artifact fix. No behavior change; was previously module-private.
export const computePlantRequiredTR = (
  systems: any[],
  flatRooms: any[],
  roomIndoorTR: Map<string, number>,
  roomNonDiverseTR?: Map<string, number>,
  roomChillerTfaTR?: Map<string, number>,
): number => {
  let total = 0;
  for (const sys of systems) {
    const t = String(sys.type ?? '');
    if (t !== 'VRF' && t !== 'Chiller') continue;
    let indoor = 0, oa = 0, tfa = 0;
    for (const r of flatRooms) {
      if (r.systemId === sys.id || r.zoneId === sys.id || r.hvacSystemId === sys.id) {
        indoor += roomIndoorTR.get(r.id) ?? 0;
        oa     += roomNonDiverseTR?.get(r.id) ?? 0;
        tfa    += roomChillerTfaTR?.get(r.id) ?? 0;
      }
    }
    const df = Math.max(0, Math.min(1, Number(sys.diversityFactor ?? 0.75)));
    // Indoor basis = selected AHU/IDU capacity less the OA it actually carries. Only the room
    // fresh air riding ON the space AHU (= oa − chiller-fed TFA) sits inside that connected
    // capacity; the chiller-fed TFA coil is a SEPARATE DOAS unit and must NOT be subtracted
    // from the AHU capacity. Subtracting the whole OA (incl. TFA) drove the indoor basis to
    // zero when the TFA coil exceeded the AHU TR, leaving only OA — the R85 "47.84 TR"
    // artifact. Falls back to space-load indoor when no unit is selected yet. Mirrors
    // EquipmentSelection.chillerPlantRequiredTR.
    const onUnitOa = Math.max(0, oa - tfa);
    const connected = connectedIduTR(sys);
    const indoorBasis = connected > 0 ? Math.max(0, connected - onUnitOa) : indoor;
    total += indoorBasis * df + oa;
  }
  return total;
};

// Installed-equipment diversity check: achieved diversity = installed WORKING plant TR
// ÷ installed connected indoor-unit (IDU/AHU/FCU) TR, versus the design DF. Flags when
// the plant is undersized for what's hung on it (achieved < design DF). (Decision
// 2026-06-11; mirrors the on-screen Equipment Selection check.)
const formatPlantDiversityCheck = (
  systems: any[],
  flatRooms: any[],
  roomChillerTfaTR?: Map<string, number>,
): string => {
  const parts: string[] = [];
  for (const sys of systems) {
    const t = String(sys.type ?? '');
    if (t !== 'VRF' && t !== 'Chiller') continue;

    // Connected SPACE indoor-unit (AHU / FCU / IDU) TR — zone terminal selections + direct
    // IDUs. The TFA/DOAS unit is a separate system, so it is naturally excluded here.
    let iduTR = 0;
    for (const z of (sys.zones ?? (sys as any).ahuGroups ?? []) as any[]) {
      if (z.unitSelections?.length) iduTR += (z.unitSelections as any[]).reduce((s: number, u: any) => s + (u.trCapacity ?? 0) * (u.quantity ?? 1), 0);
      else if (z.selection) iduTR += (z.selection.trCapacity ?? 0) * (z.selection.quantity ?? 1);
    }
    if (sys.iduSelections) Object.values(sys.iduSelections as Record<string, any>).forEach((val: any) => {
      (Array.isArray(val) ? val : val ? [val] : []).forEach((u: any) => { iduTR += (u.trCapacity ?? 0) * (u.quantity ?? 1); });
    });

    // Installed WORKING plant TR (standby excluded) — chiller units or VRF ODU.
    let plantTR = 0;
    if (t === 'Chiller') {
      const units: any[] = sys.chillerUnits?.length
        ? sys.chillerUnits
        : (sys.unitSelection ? [{ ...sys.unitSelection, quantity: sys.unitSelection.quantity ?? 1 }] : []);
      for (const u of units) {
        if (u.role === 'standby') continue;
        const per = (u.actualTR != null && u.actualTR > 0) ? u.actualTR : (u.trCapacity ?? 0);
        plantTR += per * (u.quantity ?? 1);
      }
    } else {
      const odu = sys.oduSelection;
      if (odu) plantTR = odu.effectiveTR ?? ((odu.trCapacity ?? 0) * (odu.modules ?? 1));
    }

    // Carve the chiller-fed TFA coil OUT of the plant — diversity is not applied to TFA.
    let tfaOnPlant = 0;
    for (const r of flatRooms) {
      if (r.systemId === sys.id || r.zoneId === sys.id || r.hvacSystemId === sys.id) {
        tfaOnPlant += roomChillerTfaTR?.get(r.id) ?? 0;
      }
    }
    const plantSpace = Math.max(0, plantTR - tfaOnPlant);  // plant left for the space AHUs

    if (iduTR <= 0 || plantSpace <= 0) continue;
    // Displayed "Diversity %" = connected IDU ÷ space plant (IDU 148 / Plant 144 = 103%;
    // IDU 80 / Plant 84 = 95%). Above 100% = connected exceeds plant (diversity in use);
    // below 100% = plant exceeds connected (slightly oversized). The undersize warning is
    // intentionally NOT written to the PDF (client-facing) — it lives on the on-screen chip only.
    const diversityPct = (iduTR / plantSpace) * 100;
    const name = sys.name ?? sys.id;
    const plantStr = tfaOnPlant > 0.005
      ? `Plant ${n2(plantSpace)} TR (${n2(plantTR)} - ${n2(tfaOnPlant)} TFA)`
      : `Plant ${n2(plantSpace)} TR`;
    parts.push(`${name}: Installed IDU ${n2(iduTR)} TR / ${plantStr} = Diversity ${diversityPct.toFixed(0)}%`);
  }
  return parts.length > 0 ? parts.join('  |  ') : '—';
};

const hasAnyChillerActualOverride = (systems: any[]): boolean => {
  for (const sys of systems) {
    if (String(sys.type ?? '') !== 'Chiller') continue;
    const units: any[] = sys.chillerUnits ?? [];
    if (units.some(u => u.actualTR != null && u.actualTR > 0)) return true;
  }
  return false;
};

// Sum of installed WORKING plant TR across chiller/VRF systems (standby excluded) — the
// real capacity being submitted. Chiller uses Actual TR when OEM-confirmed, else Nominal.
const computeInstalledWorkingPlantTR = (systems: any[]): number => {
  let total = 0;
  for (const sys of systems) {
    const t = String(sys.type ?? '');
    if (t === 'Chiller') {
      const units: any[] = sys.chillerUnits?.length
        ? sys.chillerUnits
        : (sys.unitSelection ? [{ ...sys.unitSelection, quantity: sys.unitSelection.quantity ?? 1 }] : []);
      for (const u of units) {
        if (u.role === 'standby') continue;
        const per = (u.actualTR != null && u.actualTR > 0) ? u.actualTR : (u.trCapacity ?? 0);
        total += per * (u.quantity ?? 1);
      }
    } else if (t === 'VRF') {
      const odu = sys.oduSelection;
      if (odu) total += odu.effectiveTR ?? ((odu.trCapacity ?? 0) * (odu.modules ?? 1));
    }
  }
  return total;
};

const computeTotalInstalledPlant = (systems: any[]): string => {
  let chillerWorking = 0, chillerStandby = 0;
  let vrfTR = 0, packageTR = 0, ahuTR = 0;

  for (const sys of systems) {
    const t = String(sys.type ?? '');
    if (t === 'Chiller') {
      const units: any[] = sys.chillerUnits?.length
        ? sys.chillerUnits
        : (sys.unitSelection ? [{ ...sys.unitSelection, quantity: sys.unitSelection.quantity ?? 1 }] : []);
      for (const u of units) {
        const perUnit = (u.actualTR != null && u.actualTR > 0) ? u.actualTR : (u.trCapacity ?? 0);
        const tr = perUnit * (u.quantity ?? 1);
        if (u.role === 'standby') chillerStandby += tr; else chillerWorking += tr;
      }
    }
    if (t === 'VRF') {
      const odu = sys.oduSelection;
      if (odu) vrfTR += odu.effectiveTR ?? ((odu.trCapacity ?? 0) * (odu.modules ?? 1));
    }
    if (t === 'Package' || t === 'DuctableSplit') {
      if (sys.unitSelection) packageTR += (sys.unitSelection.trCapacity ?? 0) * (sys.unitSelection.quantity ?? 1);
    }
    if (t === 'AHU') {
      const units: any[] = sys.ahuUnits?.length ? sys.ahuUnits : (sys.unitSelection ? [sys.unitSelection] : []);
      for (const u of units) ahuTR += (u.trCapacity ?? 0) * (u.quantity ?? 1);
    }
  }

  const parts: string[] = [];
  if (chillerWorking > 0 || chillerStandby > 0) {
    let s = `Chiller: ${n2(chillerWorking)} TR Working`;
    if (chillerStandby > 0) s += ` + ${n2(chillerStandby)} TR Standby`;
    parts.push(s);
  }
  if (vrfTR    > 0) parts.push(`VRF ODU: ${n2(vrfTR)} TR`);
  if (packageTR > 0) parts.push(`Package: ${n2(packageTR)} TR`);
  if (ahuTR    > 0) parts.push(`AHU (DX): ${n2(ahuTR)} TR`);
  return parts.length > 0 ? parts.join('  |  ') : '—  (no plant / ODU selected)';
};

const resolveEntityDC = (entity: EntityRecord, season: SeasonProfile, project: any): DC => {
  const alt = asNum(project?.altitude ?? project?.data?.altitude, 0);
  // Always populate the winter* fields so calculateHeatingLoad has a valid input
  // regardless of which season DC is being built.
  const wOutT  = asNum(project?.winterDesignTemp     ?? project?.data?.winterDesignTemp,     40);
  const wOutRH = asNum(project?.winterDesignHumidity ?? project?.data?.winterDesignHumidity, 30);
  const wInT   = asNum(project?.insideWinterTemp     ?? project?.data?.insideWinterTemp,     70);
  const wInRH  = asNum(project?.insideWinterHumidity ?? project?.data?.insideWinterHumidity, 40);
  if (season.key === 'winter') {
    return {
      outdoorTemp: wOutT, outdoorHumidity: wOutRH,
      indoorTemp: season.indoorTemp, indoorHumidity: season.indoorHumidity,
      altitude: alt,
      winterOutdoorTemp: wOutT, winterOutdoorHumidity: wOutRH,
      winterIndoorTemp: wInT, winterIndoorHumidity: wInRH,
    };
  }
  return {
    outdoorTemp:     asNum(entity.outdoorTemp,     season.outdoorTemp),
    outdoorHumidity: asNum(entity.outdoorHumidity, season.outdoorHumidity),
    indoorTemp:      asNum(entity.indoorTemp,      season.indoorTemp),
    indoorHumidity:  asNum(entity.indoorHumidity,  season.indoorHumidity),
    altitude: alt,
    winterOutdoorTemp: wOutT, winterOutdoorHumidity: wOutRH,
    winterIndoorTemp: wInT, winterIndoorHumidity: wInRH,
  };
};

const computeDetailed = (room: any, elements: any[], dc: DC, project: any): DetailedMetrics => {
  const BF        = 0.15;
  const sSafetyPct = asNum(room?.sensibleSafetyPercent ?? room?.sensibleSafetyFactor, 10);
  const lSafetyPct = asNum(room?.latentSafetyPercent   ?? room?.latentSafetyFactor,   5);
  const oSafetyPct = asNum(room?.overallSafetyPercent  ?? room?.grandTotalSafetyFactor, 3);
  const ductPct   = asNum(room?.ductGainPct, 2);
  const fanPct    = asNum(room?.fanGainPct,  3);

  // TFA/DOAS: when this room is DOAS-served, the outdoor air is conditioned by the
  // TFA unit, NOT the primary coil. Recompute with the cold-DOAS branch so the
  // primary COIL loads — and therefore ADP, RSHF, GSHF, supply-air state,
  // dehumidified CFM and reheat — reflect the reduced (sensible-leaning) coil.
  const { doas, mode: effTfaMode } = resolveRoomTfa(room, reportEquipSystems);
  const isTFA = !!doas;
  const isTfaOnly = effTfaMode === 'tfa-only';
  const dcEff: any = isTFA
    ? { ...dc, ventilationStrategy: 'tfa-cold', tfaSupplyTemp: doas.tfaSupplyTemp, tfaSupplyHumidity: doas.tfaSupplyHumidity, ervSensibleEffectiveness: doas.ervSensibleEffectiveness, ervLatentEffectiveness: doas.ervLatentEffectiveness }
    : dc;

  const envelope  = calculateEnvelopeGain(elements, dcEff);
  const internal  = calculateInternalGains(room);
  const vent      = calculateVentilationLoad(room, dcEff);
  // Winter heating must use the TFA-aware DC: for DOAS-served rooms the mechanical fresh
  // air is heated by the DOAS coil, so the space unit covers ONLY genuine infiltration
  // (winterInfiltrationACH), not the full FACPH. Passing the raw `dc` here made the space
  // re-heat the entire fresh-air rate that the DOAS coil already handles — a double count.
  const heating   = calculateHeatingLoad(room, elements, dcEff);
  const tfa       = isTFA ? calculateTFALoad(room, dcEff) : null;

  const area = asNum(room?.length, 0) * asNum(room?.width, 0);
  const faCfm = (calculateRoomVolume(room) * asNum(room?.facph, 0)) / 60;

  // In TFA mode the bypass-OA terms go to the DOAS unit, not the primary coil.
  const erVentSenBF   = isTFA ? 0 : vent.sensible * BF;
  const erVentLatBF   = isTFA ? 0 : vent.latent   * BF;
  const erSensibleRaw = envelope.sensible + internal.sensible + erVentSenBF;
  const erLatentRaw   = internal.latent   + erVentLatBF;
  const parasitic     = calculateParasiticGains(erSensibleRaw, erSensibleRaw, ductPct, fanPct);
  const ersh          = (erSensibleRaw + parasitic.ductGain + parasitic.fanGain) * (1 + sSafetyPct / 100);
  const erlh          = erLatentRaw * (1 + lSafetyPct / 100);
  const erh           = ersh + erlh;
  const oaSensible    = isTFA ? 0 : vent.sensible * (1 - BF);
  const oaLatent      = isTFA ? 0 : vent.latent   * (1 - BF);
  // Cold-DOAS supply offsets a portion of the space coil load (engineering credit).
  const tfaOffSen     = tfa ? tfa.spaceSensibleOffset : 0;
  const tfaOffLat     = tfa ? tfa.spaceLatentOffset   : 0;
  const coilSensible  = isTfaOnly ? 0 : (isTFA ? Math.max(0, ersh - tfaOffSen) : ersh + oaSensible);
  const coilLatent    = isTfaOnly ? 0 : (isTFA ? Math.max(0, erlh - tfaOffLat) : erlh + oaLatent);
  const grandTotal    = coilSensible + coilLatent;
  const loadTr        = grandTotal / 12000;

  // Coil recomputed from the (TFA-reduced) loads — drives ADP / RSHF / supply air.
  const coil = calculateCoilParameters(coilSensible, coilLatent, dcEff.indoorTemp, dcEff.indoorHumidity, dcEff.altitude, BF, 35, 65, getMinAdp(project?.systemType, project?.adpBasis));

  const totalAch     = resolveTotalSupplyACH(getRecommendedAch(room?.achProfile ?? room?.activityType), asNum(room?.facph, 0), asNum(room?.recircPct, 0));
  const totalSupplyCfm = (calculateRoomVolume(room) * totalAch) / 60;
  // TFA-served space coils are sized by thermal (sensible-at-ADP) airflow only — the
  // recommended-ACH air-change duty belongs to the DOAS. tfa-only corridors keep the
  // air-change airflow (≈ the TFA supply CFM).
  // Supply-air basis: 'dscfm' (DEFAULT, dehumidified-air) vs 'ach' (legacy ACH-preset).
  // DSCFM is the default — only an explicit 'ach' opts out. The DOAS is independent — it
  // always sizes off the OA FACPH. Mirrors lib/hvac/supplyCfm + the LC/RoomTable/ZoneList paths.
  const designCfm    = resolveSupplyCfm({
    basis: resolveRoomSupplyBasis(room?.supplyCfmBasis, project?.supplyBasis),
    isTFA, isTfaOnly,
    dehumidifiedCFM: coil.dehumidifiedCFM,
    minAdpSensibleCFM: coil.minAdpSensibleCFM,
    totalSupplyCFM: totalSupplyCfm,
    freshAirCFM: faCfm,
    tfaCfm: tfa?.cfm ?? 0,
  }).designSupplyCFM;
  const cfmTr        = designCfm / 400;
  // Plant TR is LOAD-ONLY (locked policy 2026-05-20). cfmTr is a sanity ratio only.
  const governingTr  = loadTr;
  const requiredTr   = governingTr * (1 + oSafetyPct / 100);
  // TFA/DOAS coil duty (outdoor-air conditioning) handled by the DOAS unit.
  const tfaCoilSensible = tfa ? tfa.coilSensible : 0;
  const tfaCoilLatent   = tfa ? tfa.coilLatent   : 0;
  const tfaCoilTr       = (tfaCoilSensible + tfaCoilLatent) / 12000;
  const tfaCfm          = tfa ? tfa.cfm : 0;
  // Summer dehumidification reheat coil on the DOAS (cool-to-ADP then reheat to supply).
  const tfaReheat       = tfa ? (tfa.reheatCoilSensible || 0) : 0;
  const tfaCoilADP      = tfa ? tfa.coilADP : 0;

  // ── Heating safety + humidification (used when called with winter DC) ──────
  const heatingSafetyPct  = asNum(room?.heatingSafetyPercent, 10);
  const heatingPickupPct  = asNum(room?.heatingPickupPercent, 15);
  const includeHumidifier = Boolean(room?.includeHumidifier ?? false);

  const hTransRaw  = heating.transmissionLoss;
  const hVentRaw   = heating.ventilationHeating;
  const hSlabRaw   = heating.slabLoss ?? 0;
  const hTransSafe = hTransRaw * (1 + heatingSafetyPct / 100);
  const hVentSafe  = hVentRaw  * (1 + heatingSafetyPct / 100);
  const hSlabSafe  = hSlabRaw  * (1 + heatingSafetyPct / 100);

  // Humidification: only relevant when outdoor W < indoor W (winter)
  const LATENT_HFG = 1061;
  const wOutPsych  = calculatePsychrometrics(dc.outdoorTemp, dc.outdoorHumidity, dc.altitude);
  const wInPsych   = calculatePsychrometrics(dc.indoorTemp,  dc.indoorHumidity,  dc.altitude);
  const wSatIndoor = calculatePsychrometrics(dc.indoorTemp,  100,                dc.altitude);
  const wOut = wOutPsych.humidityRatio;
  const wIn  = wInPsych.humidityRatio;
  const deltaWLb   = wIn - wOut;
  const humNeeded  = deltaWLb > 0.0001;
  const humFreshCFM    = vent.cfm;
  const humRateBase    = humNeeded ? 4.5 * humFreshCFM * deltaWLb : 0;
  const humRate        = humRateBase * 1.10;
  const humEnergyBTU   = humRate * LATENT_HFG;
  const humEnergyKW    = humEnergyBTU / 3412;
  const rhAfterHeating = wSatIndoor.humidityRatio > 0
    ? Math.min(100, Math.round((wOut / wSatIndoor.humidityRatio) * 100))
    : 0;
  const hHumLoad       = includeHumidifier && humNeeded ? humEnergyBTU : 0;
  // Humidification conditions the fresh air, which the TFA/DOAS unit handles — so it
  // is NOT part of the space heating load. Space heating is sensible only (envelope +
  // infiltration + slab); hHumLoad is reported on the DOAS side alongside the TFA coil.
  const heatingSubtotal   = hTransSafe + hVentSafe + hSlabSafe;
  const designHeatingLoad = heatingSubtotal * (1 + heatingPickupPct / 100);

  return {
    area, ventilationCfm: vent.cfm, faCfm, designCfm, totalAch, totalSupplyCfm,
    heatingLoad: heating.totalHeatingLoad,
    envWalls:       envelope.breakdown.walls,
    envRoof:        envelope.breakdown.roof,
    envGlassTrans:  envelope.breakdown.glassTransmission,
    envGlassSolar:  envelope.breakdown.glassSolar,
    envPartitions:  envelope.breakdown.partitions,
    envFloor:       envelope.breakdown.floor,
    envelopeTotal:  envelope.sensible,
    peopleSensible:   internal.breakdown?.peopleSensible   ?? 0,
    peopleLatent:     internal.breakdown?.peopleLatent     ?? 0,
    lightsSensible:   internal.breakdown?.lightsSensible   ?? 0,
    equipmentSensible:internal.breakdown?.equipmentSensible?? 0,
    othersSensible:   internal.breakdown?.othersSensible   ?? 0,
    internalSensible: internal.sensible,
    internalLatent:   internal.latent,
    ventSensibleBF: vent.sensible * BF,
    ventLatentBF:   vent.latent   * BF,
    ductGain: parasitic.ductGain,
    fanGain:  parasitic.fanGain,
    erSensibleRaw, erLatentRaw,
    sSafetyPct, lSafetyPct, oSafetyPct,
    ersh, erlh, erh, oaSensible, oaLatent,
    coilSensible, coilLatent, grandTotal, loadTr, cfmTr, governingTr, requiredTr,
    // TFA / DOAS — zero when the room isn't DOAS-served.
    isTFA, isTfaOnly,
    tfaCoilSensible, tfaCoilLatent, tfaCoilTr, tfaCfm,
    tfaReheat, tfaCoilADP,
    tfaSupplyOffsetSen: tfaOffSen, tfaSupplyOffsetLat: tfaOffLat,
    indicatedAdp: coil.indicatedADP,
    selectedAdp:  coil.selectedADP,
    rshf:         coil.rshf,
    adpUnreachable: coil.adpUnreachable,
    // Latent / reheat diagnostics (2026-06-10) — the dehumidified-air sized on sensible vs the
    // airflow the latent would need, and the implied reheat duty if the coil can't dry the room.
    dehumidSensibleCfm: coil.dehumidifiedCFM,
    latentCfm:          coil.latentCFM,
    latentShortfallCfm: coil.latentShortfallCFM,
    reheatRequiredBtu:  coil.reheatRequiredBTU,
    // Heating with safety
    heatingSafetyPct, heatingPickupPct, includeHumidifier,
    hTransRaw, hVentRaw, hTransSafe, hVentSafe, hSlabRaw, hSlabSafe,
    hHumLoad, heatingSubtotal, designHeatingLoad,
    // Humidification
    humNeeded, humFreshCFM,
    humDeltaWGr:     deltaWLb * 7000,
    humWOutGr:       wOut * 7000,
    humWInGr:        wIn  * 7000,
    humRhAfterHeating: rhAfterHeating,
    humRateBase, humRate, humEnergyBTU, humEnergyKW,
    humExceedsCap62: wIn > 0.0125,
  };
};

// ─── Page management ─────────────────────────────────────────────────────────

const startBody = (doc: jsPDF, _project: any) => {
  doc.addPage();
  return PAGE.top + 4;
};

const ensureSpace = (doc: jsPDF, y: number, needed: number, project: any) => {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - PAGE.bottom - 4) {
    return startBody(doc, project);
  }
  return y;
};

// ─── ENGINEERING REVIEW ─────────────────────────────────────────────────────
// Auto-detected design findings shown as a project-level review section near
// the end of the report. Complements the per-room "Designer's Note" callouts.

type FindingSeverity = 'critical' | 'warning' | 'info';
type Finding = {
  severity: FindingSeverity;
  scope: string;        // e.g. "Project", "Room IGLOO 1", "System Chiller Plant"
  title: string;        // one-line headline
  description: string;  // 1-2 sentence explanation of what was detected
  recommendation: string; // what to change / verify
};

// Reheat estimate matching the per-room PDF calc — sizes against ROOM SHF
// (effective room sensible / latent with safety factors), not coil/grand SHF.
// See the inline calc in renderRoomBody for the full rationale.
const estimateReheatBTU = (m: DetailedMetrics): number => {
  const tSHR = 0.75;
  const roomTot = m.ersh + m.erlh;
  if (roomTot <= 0) return 0;
  const rSHR = m.ersh / roomTot;
  if (rSHR >= tSHR) return 0;
  return Math.max(0, (m.erlh * tSHR) / (1 - tSHR) - m.ersh);
};

const buildEngineeringReview = (
  project: any,
  entities: EntityRecord[],
  envelopeElementsMap: Record<string, any[]>,
  effectiveEquipSystems: any[],
  summer: SeasonProfile,
  winter: SeasonProfile | undefined,
): Finding[] => {
  const findings: Finding[] = [];
  const altitude = asNum(project?.altitude ?? project?.data?.altitude, 0);

  // ── PROJECT-LEVEL: indoor target review ────────────────────────────────
  const sIndoorT  = asNum(project?.insideSummerTemp     ?? project?.summerIndoorTemp     ?? project?.data?.insideSummerTemp,     75);
  const sIndoorRH = asNum(project?.insideSummerHumidity ?? project?.summerIndoorHumidity ?? project?.data?.insideSummerHumidity, 50);
  if (sIndoorT > 76) {
    findings.push({
      severity: 'critical',
      scope: 'Project',
      title: `Summer indoor design ${sIndoorT}°F is above the comfort range`,
      description: `Standard comfort cooling design is 74-76°F / 45-55% RH. Higher setpoints feel warm to occupants and force the system into low-SHR operation that requires reheat.`,
      recommendation: `Reduce summer indoor target to 75°F / 50% RH unless this is a process or cold-storage space with a justified higher setpoint.`,
    });
  }
  if (sIndoorRH > 55) {
    findings.push({
      severity: 'critical',
      scope: 'Project',
      title: `Summer indoor RH ${sIndoorRH}% exceeds typical comfort RH (45-55%)`,
      description: `RH above 55% drives mold/IAQ risk and a very low coil SHR — meaning very large reheat or desiccant systems are needed.`,
      recommendation: `Reduce indoor RH target to 50% (standard) or 45% (drier-comfort spaces). Verify with the client before sizing equipment.`,
    });
  }

  // ASHRAE 62.1-2022 §5.9 humidity ratio cap (87 gr/lb at any altitude)
  const indoorPsy = calculatePsychrometrics(sIndoorT, sIndoorRH, altitude);
  const wInGr = indoorPsy.humidityRatio * 7000;
  if (wInGr > 87) {
    findings.push({
      severity: 'critical',
      scope: 'Project',
      title: `Indoor humidity ratio ${wInGr.toFixed(0)} gr/lb exceeds ASHRAE 62.1-2022 §5.9 cap (87 gr/lb)`,
      description: `Continuously maintaining indoor air at this humidity creates condensation and mould risk and is non-compliant with current IAQ standards.`,
      recommendation: `Lower indoor RH target. At 75°F max RH ~ 55%; at 78°F max RH ~ 49%; at 70°F max RH ~ 70%.`,
    });
  }

  // Winter indoor target check (only if winter enabled)
  if (winter) {
    const wIndoorT  = asNum(project?.insideWinterTemp     ?? project?.winterIndoorTemp     ?? project?.data?.insideWinterTemp,     70);
    const wIndoorRH = asNum(project?.insideWinterHumidity ?? project?.winterIndoorHumidity ?? project?.data?.insideWinterHumidity, 40);
    if (wIndoorT > 74 || wIndoorRH > 45) {
      findings.push({
        severity: 'warning',
        scope: 'Project',
        title: `Winter indoor target ${wIndoorT}°F / ${wIndoorRH}% RH is above typical winter comfort`,
        description: `Standard winter comfort design is 68-72°F / 30-40% RH. Higher targets dramatically increase humidifier energy in dry winter air.`,
        recommendation: `Use 70°F / 35-40% RH for winter unless process needs justify the higher setpoint. For Indian climates, humidification is rarely needed.`,
      });
    }
  }

  // ── ROOM-LEVEL CHECKS ──────────────────────────────────────────────────
  for (const entity of entities) {
    for (const room of entity.rooms) {
      const roomElements = envelopeElementsMap[room.id] || [];
      const sumDc = resolveEntityDC(entity, summer, project);
      const winDc = winter ? resolveEntityDC(entity, winter, project) : null;
      const sm = computeDetailed(room, roomElements, sumDc, project);
      const wm = winDc ? computeDetailed(room, roomElements, winDc, project) : null;
      const roomLabel = `Room ${room.name || room.id || 'Unnamed'}`;

      // Reheat as % of cooling — sized against ROOM SHF, so threshold is
      // "reheat is large vs cooling load" (>30% is genuinely a problem).
      const reheatBTU = estimateReheatBTU(sm);
      const roomTot = sm.ersh + sm.erlh;
      const rSHR = roomTot > 0 ? sm.ersh / roomTot : 1;
      if (sm.grandTotal > 0 && reheatBTU > 0.3 * sm.grandTotal) {
        findings.push({
          severity: 'critical',
          scope: roomLabel,
          title: `Reheat (${n0(reheatBTU)} BTU/h) is ${((reheatBTU / sm.grandTotal) * 100).toFixed(0)}% of cooling load (${n0(sm.grandTotal)} BTU/h)`,
          description: `Room SHR ${rSHR.toFixed(2)} is below 0.75 (typical comfort target). Supply air would over-cool the room while dehumidifying — reheat is needed to prevent this.`,
          recommendation: `Verify fresh air rate (currently ${asNum(room.facph, 0)} ACH = ${n0(sm.faCfm)} CFM). If not driven by occupant IAQ, reduce facph. For persistently low Room SHR, consider desiccant dehumidification or raising indoor RH target.`,
        });
      }

      // ADP unreachable
      if (sm.adpUnreachable) {
        findings.push({
          severity: 'warning',
          scope: roomLabel,
          title: `Indicated ADP (${n1(sm.indicatedAdp)}°F) is unreachable on the saturation curve`,
          description: `Coil GSHF ${sm.rshf.toFixed(2)} is below the minimum SHF a saturated cooling coil can produce in the search range. Reheat at the coil is mandatory.`,
          recommendation: `Either accept the reheat penalty (already calculated above), use desiccant/chemical dehumidification, or correct the inputs causing the very low SHR (high ventilation, low internal sensible).`,
        });
      }

      // Mixed wall U-values — likely partition modeling issue
      const walls = roomElements.filter((e: any) => String(e.type || '').toLowerCase() === 'wall');
      if (walls.length >= 2) {
        const us = walls.map((w: any) => asNum(w.uValue, 0)).filter((u: number) => u > 0);
        if (us.length >= 2) {
          const maxU = Math.max(...us);
          const minU = Math.min(...us);
          if (maxU > 0.2 && minU < 0.05) {
            findings.push({
              severity: 'info',
              scope: roomLabel,
              title: `Mixed wall U-values (${minU.toFixed(3)} to ${maxU.toFixed(3)}) — verify partition modeling`,
              description: `Some walls are heavily insulated (U ~ 0.03 typical of cold-storage panels) while others are exterior-grade (U ~ 0.35 typical of brick/uninsulated).`,
              recommendation: `Walls bordering other conditioned rooms should be modeled as Partition elements with the actual dT to the neighbour (often 0-5°F), not as exterior walls receiving full outdoor dT and solar.`,
            });
          }
        }
      }

      // Over-ventilation per person
      const peopleCount = asNum(room.peopleCount, 0);
      if (peopleCount > 0 && sm.faCfm > 0) {
        const cfmPerPerson = sm.faCfm / peopleCount;
        if (cfmPerPerson > 200) {
          findings.push({
            severity: 'warning',
            scope: roomLabel,
            title: `Fresh air ${n0(cfmPerPerson)} CFM/person — likely over-ventilated for occupant IAQ`,
            description: `${n0(sm.faCfm)} CFM ÷ ${peopleCount} occupant(s). ASHRAE 62.1 minimum is 10-20 CFM/person for offices/factories.`,
            recommendation: `If high ventilation is for process/exhaust make-up, that's fine — confirm the process basis. If for occupants only, reduce facph; every extra CFM adds significant summer/monsoon dehumidification cost.`,
          });
        }
      }

      // Winter humidifier dominance — share of the TOTAL winter duty
      // (space heating + TFA fresh-air coil + humidification), since humidification
      // now sits on the DOAS side rather than inside the space heating load.
      if (wm && wm.hHumLoad > 0) {
        const totalWinterDuty = wm.designHeatingLoad + (Number((room as any)?._calcTfaWinterHeatingBTUH) || 0) + wm.hHumLoad;
        const humPct = totalWinterDuty > 0 ? (wm.hHumLoad / totalWinterDuty) * 100 : 0;
        if (humPct > 40) {
          findings.push({
            severity: 'warning',
            scope: roomLabel,
            title: `Winter humidifier is ${humPct.toFixed(0)}% of total winter duty`,
            description: `${n0(wm.hHumLoad)} BTU/h humidification vs ${n0(totalWinterDuty)} BTU/h total winter duty (space heating + TFA coil + humidification). Humidification is dominating the winter design.`,
            recommendation: `Lower indoor RH target in winter (e.g. 70°F / 40%). For most Indian climates with mild winters and naturally humid outdoor air, humidification is unnecessary.`,
          });
        }
      }
    }
  }

  // ── EQUIPMENT-LEVEL CHECKS ─────────────────────────────────────────────
  for (const sys of effectiveEquipSystems) {
    const workingTR = asNum(sys.workingCapacityTR ?? sys.totalCapacityTR ?? sys.capacityTR, 0);
    const standbyTR = asNum(sys.standbyCapacityTR ?? sys.redundancyTR, 0);
    if (workingTR > 0 && standbyTR > 0) {
      const standbyPct = (standbyTR / workingTR) * 100;
      if (standbyPct > 33) {
        findings.push({
          severity: 'info',
          scope: `System ${sys.name || sys.id}`,
          title: `Standby capacity ${standbyPct.toFixed(0)}% (${n0(standbyTR)} TR standby / ${n0(workingTR)} TR working) is above typical N+1 redundancy`,
          description: `Standard N+1 redundancy gives 25-33% standby. Above that suggests N+N or oversized backup — higher capex and footprint than needed for typical reliability targets.`,
          recommendation: `Confirm with client whether full backup is required, or use 25-33% N+1 design (e.g. 3 units at 33% capacity each, 1 standby).`,
        });
      }
    }
  }

  return findings;
};

// Replace common HVAC/math glyphs that aren't in jsPDF's default WinAnsi
// helvetica encoding. These render as garbage bytes (e.g. "H for ≈) AND
// throw off splitTextToSize width calc, causing text to overflow the colored
// findings card. Keep this list in sync with any new symbols introduced in
// finding text.
const sanitizeForPDF = (s: string): string =>
  s
    .replace(/≈/g, '~')
    .replace(/Δ/g, 'd')
    .replace(/Σ/g, 'Sum')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/±/g, '+/-')
    .replace(/µ/g, 'u');

const renderEngineeringReview = (
  doc: jsPDF,
  findings: Finding[],
  project: any,
  C: Theme,
  pageW: number,
): void => {
  if (findings.length === 0) return;

  // Defensive sanitize so any future finding text can't sneak in glyphs
  // unsupported by jsPDF's default font (would corrupt rendering).
  findings = findings.map((f) => ({
    ...f,
    title: sanitizeForPDF(f.title),
    description: sanitizeForPDF(f.description),
    recommendation: sanitizeForPDF(f.recommendation),
    scope: sanitizeForPDF(f.scope),
  }));

  // Sort: critical -> warning -> info
  const order: Record<FindingSeverity, number> = { critical: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  const colors: Record<FindingSeverity, { bg: [number,number,number]; border: [number,number,number]; ink: [number,number,number]; label: string }> = {
    critical: { bg: [254, 226, 226], border: [220,  38,  38], ink: [127,  29,  29], label: 'CRITICAL' },
    warning:  { bg: [254, 243, 199], border: [217, 119,   6], ink: [120,  53,  15], label: 'WARNING'  },
    info:     { bg: [219, 234, 254], border: [ 37,  99, 235], ink: [ 30,  58, 138], label: 'NOTE'     },
  };

  let y = startBody(doc, project);
  y = sectionBanner(doc, 'ENGINEERING REVIEW & RECOMMENDATIONS', y, C);
  y += 4;

  // Intro line
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.subInk);
  const introLines = doc.splitTextToSize(
    `Auto-detected design findings (${findings.length}) based on project inputs and computed loads. Items marked CRITICAL materially affect equipment sizing or compliance and should be resolved before issuing for procurement. WARNING items merit client confirmation. NOTE items are advisory.`,
    pageW - PAGE.left - PAGE.right,
  );
  doc.text(introLines, PAGE.left, y);
  y += (introLines.length * 3.5) + 4;

  const usableW = pageW - PAGE.left - PAGE.right;
  const innerW = usableW - 6;

  for (const f of findings) {
    const c = colors[f.severity];

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const titleLines = doc.splitTextToSize(f.title, innerW);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const descLines = doc.splitTextToSize(f.description, innerW);
    doc.setFont('helvetica', 'italic');
    const recLines  = doc.splitTextToSize(`Recommendation: ${f.recommendation}`, innerW);

    const blockH = 5 /*chip+gap*/ + (titleLines.length * 4) + 1.5 + (descLines.length * 3.4) + 1.5 + (recLines.length * 3.4) + 4;

    y = ensureSpace(doc, y, blockH + 3, project);

    doc.setFillColor(...c.bg);
    doc.setDrawColor(...c.border);
    doc.setLineWidth(0.3);
    doc.rect(PAGE.left, y, usableW, blockH, 'FD');

    // Severity chip + scope
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...c.ink);
    doc.text(`[${c.label}]  ${f.scope}`, PAGE.left + 3, y + 4);

    // Title
    doc.setFontSize(8);
    doc.text(titleLines, PAGE.left + 3, y + 8.5);
    let yCur = y + 8.5 + (titleLines.length * 4);

    // Description
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(60, 60, 60);
    doc.text(descLines, PAGE.left + 3, yCur + 1.5);
    yCur += 1.5 + (descLines.length * 3.4);

    // Recommendation
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...c.ink);
    doc.text(recLines, PAGE.left + 3, yCur + 1.5);

    y += blockH + 3;
  }
};

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export const generatePDFReport = (
  project: any,
  systems: any[],
  zones: any[],
  rooms: Record<string, any[]>,
  envelopeElements: Record<string, any[]>,
  equipSystems: any[] = [],
  hvacHierarchy?: HvacHierarchyData,
  eco = false,
) => {
  // Select colour palette: corporate blue (default) or eco/print-friendly greyscale
  const C = makeTheme(eco);
  // When new hierarchy data is provided, override the legacy arrays.
  const effectiveSystems = hvacHierarchy ? hvacHierarchy.systems : systems;
  const effectiveZones   = hvacHierarchy
    ? Object.values(hvacHierarchy.zonesBySystem).flat()
    : zones;
  const effectiveRooms   = hvacHierarchy ? hvacHierarchy.rooms : rooms;
  // For Section 5, use hvacSystems as equipment systems when hierarchy is provided
  // (they carry the same equipment selection fields, migrated from /equipmentSystems)
  const effectiveEquipSystems = hvacHierarchy && equipSystems.length === 0
    ? hvacHierarchy.systems
    : equipSystems;
  // Make computeDetailed TFA-aware for this report build.
  reportEquipSystems = effectiveEquipSystems ?? [];
  buildReportStamp(project);

  const doc      = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW    = doc.internal.pageSize.getWidth();
  const seasons  = getSeasonProfiles(project);
  const entities = buildEntityRecords(project, effectiveSystems, effectiveZones, effectiveRooms, effectiveEquipSystems);
  const includeMonsoon = seasons.some((s) => s.key === 'monsoon');
  const includeWinter  = seasons.some((s) => s.key === 'winter');
  const summer  = seasons.find((s) => s.key === 'summer')!;
  const monsoon = seasons.find((s) => s.key === 'monsoon');
  const winter  = seasons.find((s) => s.key === 'winter');

  const alt  = asNum(project?.altitude  ?? project?.data?.altitude,  0);
  const lat  = asNum(project?.latitude  ?? project?.data?.latitude,  0);
  const lon  = asNum(project?.longitude ?? project?.data?.longitude, 0);

  // ═══ COVER PAGE ═══════════════════════════════════════════════════════════

  // Top band — filled in colour mode, thin separator line in eco mode
  if (C.eco) {
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.5);
    doc.line(PAGE.left, 52, pageW - PAGE.right, 52);
  } else {
    doc.setFillColor(...C.accent);
    doc.rect(0, 0, pageW, 52, 'F');
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...C.headFg);
  doc.text('HVAC LOAD CALCULATION', PAGE.left, 22);
  doc.text('REPORT', PAGE.left, 32);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...C.coverText);
  doc.text('Technical Submission Document for Design Approval', PAGE.left, 40);
  doc.text('Calculated per ASHRAE Fundamentals Handbook 2017 (IP Units)', PAGE.left, 47);

  // Project info card
  autoTable(doc, {
    startY: 62,
    body: [
      ['Project Name',   String(project?.name     || '-')],
      ['Location',       String(project?.location  || '-')],
      ['System Type',    String(project?.systemType|| '-')],
      ['Altitude',       alt  ? `${n0(alt)} ft`  : '-'],
      ['Coordinates',    lat  ? `${n1(lat)}° N, ${n1(Math.abs(lon))}° ${lon >= 0 ? 'E' : 'W'}` : '-'],
      ['Design Basis',   [
        'Summer',
        ...(includeMonsoon ? ['Monsoon'] : []),
        ...(includeWinter  ? ['Winter']  : []),
      ].join(' + ')],
      ['Report No.',     reportStamp.id || '—'],
      ['Revision',       reportStamp.rev || 'R0'],
      ['Report Date',    reportStamp.dateLong],
      ['Prepared By',    'HVAC Load Master – Automated Calculation Engine'],
    ],
    theme: 'grid',
    styles: { fontSize: 9.5, cellPadding: 3.5, textColor: C.ink },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: C.panel, cellWidth: 48 },
      1: { cellWidth: 138 },
    },
    margin: { left: PAGE.left, right: PAGE.right },
  });

  drawFooter(doc, C);

  // ═══ PAGE 2: DESIGN CONDITIONS + EXECUTIVE SUMMARY ════════════════════════

  let y = startBody(doc, project);

  // --- Section 1: Design Conditions ---
  y = sectionBanner(doc, '1.  PROJECT DESIGN CONDITIONS', y, C);
  y += 2;

  // Site info row
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...C.subInk);
  const siteInfo = [
    alt  ? `Altitude: ${n0(alt)} ft`           : null,
    lat  ? `Latitude: ${n1(lat)}°`             : null,
    lon  ? `Longitude: ${n1(Math.abs(lon))}° ${lon >= 0 ? 'E' : 'W'}` : null,
  ].filter(Boolean).join('   ·   ');
  if (siteInfo) { doc.text(siteInfo, PAGE.left, y); y += 4; }

  // Psychrometric data per season
  const seasonPsycho = seasons.map((s) => ({
    season: s,
    outdoor: calculatePsychrometrics(s.outdoorTemp, s.outdoorHumidity, alt),
    indoor:  calculatePsychrometrics(s.indoorTemp,  s.indoorHumidity,  alt),
  }));

  const seasonCols = seasons.map((s) => s.label);
  const condHead = ['Condition', ...seasonCols];

  const condBody: (string | number)[][] = [
    ['OUTDOOR', ...seasons.map(() => '')],
    ['  Dry Bulb (°F / °C)',        ...seasonPsycho.map((sp) => dualT0(sp.season.outdoorTemp))],
    ['  Relative Humidity (%)',     ...seasonPsycho.map((sp) => n0(sp.season.outdoorHumidity))],
    ['  Humidity Ratio (lb/lb)',    ...seasonPsycho.map((sp) => n4(sp.outdoor.humidityRatio))],
    ['  Enthalpy (BTU/lb dry air)', ...seasonPsycho.map((sp) => n2(sp.outdoor.enthalpy))],
    ['INDOOR (Design Space)', ...seasons.map(() => '')],
    ['  Dry Bulb (°F / °C)',        ...seasonPsycho.map((sp) => dualT0(sp.season.indoorTemp))],
    ['  Relative Humidity (%)',     ...seasonPsycho.map((sp) => n0(sp.season.indoorHumidity))],
    ['  Humidity Ratio (lb/lb)',    ...seasonPsycho.map((sp) => n4(sp.indoor.humidityRatio))],
    ['  Enthalpy (BTU/lb dry air)', ...seasonPsycho.map((sp) => n2(sp.indoor.enthalpy))],
  ];

  autoTable(doc, {
    startY: y,
    head: [condHead],
    body: condBody,
    theme: 'grid',
    styles:     { fontSize: 8, cellPadding: 2, textColor: C.ink },
    headStyles: { fillColor: C.panelDark, textColor: C.ink, fontStyle: 'bold', fontSize: 8 },
    willDrawCell: (data: any) => {
      if (data.section === 'body') {
        const txt = String(data.cell.raw);
        if (txt === 'OUTDOOR' || txt === 'INDOOR (Design Space)') {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = C.accentBg;
        }
      }
    },
    margin: { left: PAGE.left, right: PAGE.right },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // --- Section 2: Executive Summary ---
  y = sectionBanner(doc, '2.  PROJECT EXECUTIVE SUMMARY', y, C);
  y += 2;

  // Compute project totals per season
  const projectSeasonTotals = seasons.map((season) => {
    let cooling = 0; let reqTr = 0; let cfm = 0; let heating = 0; let tfaCoil = 0;
    entities.forEach((entity) => {
      const dc = resolveEntityDC(entity, season, project);
      entity.rooms.forEach((room) => {
        const m = computeDetailed(room, envelopeElements[room.id] || [], dc, project);
        cooling  += m.grandTotal;     // space (primary) coil — TFA-reduced (raw load)
        reqTr    += m.requiredTr;      // with overall safety — the equipment-sizing basis
        cfm      += m.designCfm;
        heating  += m.designHeatingLoad;
        tfaCoil  += m.tfaCoilSensible + m.tfaCoilLatent; // TFA/DOAS coil duty
      });
    });
    const loadTr = cooling / 12000;
    const cfmTr  = cfm / 400;
    const tfaCoilTr = tfaCoil / 12000;
    // Governing TR carries the overall safety factor (matches Equipment Selection's coil duty);
    // Space TR (loadTr) is the raw coil load. cfmTr retained as a sanity ratio only.
    return { season: season.label, key: season.key, loadTr, cfm, cfmTr, heating, tfaCoilTr, governingTr: reqTr };
  });
  const projectTfaCoilTR = Math.max(0, ...projectSeasonTotals.filter(s => s.key !== 'winter').map(s => s.tfaCoilTr));
  const hasTfa = projectTfaCoilTR > 0;
  // TFA/DOAS fresh-air winter heating coil — project total (season-independent).
  const projectTfaWinterHeatingBTUH = entities.reduce(
    (s: number, e: any) => s + e.rooms.reduce((rs: number, r: any) => rs + (Number(r._calcTfaWinterHeatingBTUH) || 0), 0),
    0,
  );
  // TFA/DOAS summer dehumidification reheat coil — project total (season-independent;
  // a function of the supply setpoint). Zero unless a neutral/warm-dry supply is set.
  const projectTfaReheatBTUH = entities.reduce(
    (s: number, e: any) => s + e.rooms.reduce((rs: number, r: any) => rs + (Number(r._calcTfaReheatBTUH) || 0), 0),
    0,
  );
  // Is any DOAS fed by the main chiller plant? If so, its coil load is ON the plant
  // and must be added to the plant duty; otherwise the TFA is a separate unit.
  const chillerFedTfa = (reportEquipSystems ?? []).some((s: any) => s?.type === 'DOAS' && ((s.tfaCoolingSource ?? 'own-unit') === 'chiller-plant'));

  const coolingSeasonsOnly = projectSeasonTotals.filter(s => s.key !== 'winter');
  const peakSeason = coolingSeasonsOnly.reduce((a, b) => b.governingTr > a.governingTr ? b : a);
  const recTR  = peakSeason.governingTr;
  // Plant duty = SIMULTANEOUS peak of (space + chiller-fed TFA) in the same season —
  // not the sum of peaks from different seasons. When TFA is on its own unit, the
  // plant is the space coil only and the TFA is reported separately.
  const plantSeasonPeak = coolingSeasonsOnly.reduce((a, b) =>
    ((b.loadTr + (chillerFedTfa ? b.tfaCoilTr : 0)) > (a.loadTr + (chillerFedTfa ? a.tfaCoilTr : 0))) ? b : a);
  // CFM must come from the same peak cooling season — winter CFM is inflated by heating ventilation loads
  const recCFM = peakSeason.cfm;
  // Submission airflow = PEAK design CFM across cooling seasons (summer + monsoon).
  // Design airflow can peak in a different season than plant TR (e.g. summer airflow
  // exceeds monsoon airflow even when monsoon governs TR), so ductwork / AHU must be
  // sized to the higher of the two — not the TR-governing season's CFM. Winter is
  // excluded (its CFM is inflated by heating-ventilation loads).
  const submissionCFM = Math.max(0, ...coolingSeasonsOnly.map(s => s.cfm));
  const allRooms = entities.flatMap((e) => e.rooms);

  // Stats panel — filter equipment systems to those that have at least one live room pointing to them
  const flatRoomDocs = Object.values(effectiveRooms).flat();
  const activeEquipSystemIds = new Set<string>(
    flatRoomDocs.flatMap((r: any) => [r.systemId, r.zoneId, r.hvacSystemId].filter(Boolean))
  );
  const activeEquipSystems = effectiveEquipSystems.filter((s: any) => activeEquipSystemIds.has(s.id));
  const totalIDU = computeTotalInstalledIDU(activeEquipSystems);
  const totalIDUStr = totalIDU.tr > 0
    ? `${n2(totalIDU.tr)} TR  ·  ${n0(totalIDU.cfm)} CFM`
    : '—  (no equipment selected)';
  const totalPlantStr = computeTotalInstalledPlant(activeEquipSystems);

  // Per-room governing TR, split so DIVERSITY applies to the INDOOR (space) load only.
  // The fresh-air / outdoor-air load is continuous — non-coincident-peak diversity does
  // not apply to it — so it is added back UN-diversified, together with any chiller-fed
  // TFA coil. Governing cooling season = the one with the highest TOTAL room load; that
  // operating point is then split into its indoor and outdoor-air parts.
  // (Decision 2026-06-11: diversity on the indoor calc, not the full space design —
  //  fresh air is added back on top. Mirrors EquipmentSelection.chillerPlantRequiredTR.)
  const roomIndoorTR = new Map<string, number>();      // diversifiable indoor: envelope+people+lights+equip (erh)
  const roomNonDiverseTR = new Map<string, number>();   // OA / fresh air (+ chiller-fed TFA) — never diversified
  const roomChillerTfaTR = new Map<string, number>();   // chiller-fed TFA coil only — carved out of plant for the diversity check
  // Project total of the TFA / DOAS fresh-air branch airflow (season-independent, ACH-based).
  // The space design CFM (submissionCFM) is the recirc/AHU air and already includes any
  // on-unit fresh air; the separate DOAS branch is NOT in it, so it is summed here and shown
  // added on top of the space CFM in the submission basis (space + TFA = total supply).
  let projectTfaFreshCFM = 0;
  const coolingSeasonsForRoom = seasons.filter(s => s.key !== 'winter');
  entities.forEach((entity) => {
    entity.rooms.forEach((room) => {
      const rdoas = findReportDoasForRoom(room);
      const roomChillerFed = !!rdoas && ((rdoas.tfaCoolingSource ?? 'own-unit') === 'chiller-plant');
      let bestTotal = -1, govIndoor = 0, govNonDiverse = 0, govTfa = 0, roomTfaCfm = 0;
      for (const season of coolingSeasonsForRoom) {
        const dc = resolveEntityDC(entity, season, project);
        const m = computeDetailed(room, envelopeElements[room.id] || [], dc, project);
        const oaTr = (m.oaSensible + m.oaLatent) / 12000;            // room fresh-air load (0 when DOAS-served)
        const indoorTr = Math.max(0, m.grandTotal / 12000 - oaTr);   // space load less its OA share (= erh)
        const tfaTr = roomChillerFed ? (m.tfaCoilSensible + m.tfaCoilLatent) / 12000 : 0;
        const nonDiverse = oaTr + tfaTr;                             // all OA landing on this plant, un-diversified
        const total = indoorTr + nonDiverse;
        roomTfaCfm = m.tfaCfm;                                       // DOAS branch airflow (0 for non-TFA rooms; season-independent)
        if (total > bestTotal) { bestTotal = total; govIndoor = indoorTr; govNonDiverse = nonDiverse; govTfa = tfaTr; }
      }
      roomIndoorTR.set(room.id, govIndoor);
      roomNonDiverseTR.set(room.id, govNonDiverse);
      roomChillerTfaTR.set(room.id, govTfa);
      projectTfaFreshCFM += roomTfaCfm;
    });
  });
  const diversityStr = formatDiversitySummary(activeEquipSystems, flatRoomDocs, roomIndoorTR, roomNonDiverseTR, roomChillerTfaTR);
  // Installed-equipment check: achieved diversity (working plant ÷ connected IDU) vs design DF.
  // Chiller-fed TFA coil is carved OUT of the plant first (TFA is non-diverse) — only the
  // space AHUs vs the remaining plant get the diversity ratio.
  const plantDiversityStr = formatPlantDiversityCheck(activeEquipSystems, flatRoomDocs, roomChillerTfaTR);
  // Single diversity-applied plant-required figure used by BOTH the submission basis
  // and the diversity line, so they always agree (indoor×df + OA/fresh air).
  const plantRequiredTR = computePlantRequiredTR(activeEquipSystems, flatRoomDocs, roomIndoorTR, roomNonDiverseTR, roomChillerTfaTR);
  // Submission basis reflects what's actually being INSTALLED: working plant TR (144,
  // not the 135.54 load figure) and the design airflow rounded up to a clean hundred for
  // submission (41,958 -> 42,000). Falls back to the load figure if no plant is selected.
  const installedWorkingPlantTR = computeInstalledWorkingPlantTR(activeEquipSystems);
  const submissionBasisTR = installedWorkingPlantTR > 0
    ? installedWorkingPlantTR
    : (plantRequiredTR > 0 ? plantRequiredTR : recTR);
  const submissionCFMRounded = Math.ceil(submissionCFM / 100) * 100;
  // CFM basis: the space/recirc AHU design airflow plus the separate DOAS fresh-air branch,
  // totalled so the client sees the full supply air (space + TFA = total), not just the
  // space CFM. Total design supply matches the 3A Airflow Schedule PROJECT TOTAL.
  const tfaFreshCFMRounded   = Math.ceil(projectTfaFreshCFM / 100) * 100;
  const totalSupplyCFM       = submissionCFM + projectTfaFreshCFM;
  const totalSupplyCFMRounded = Math.ceil(totalSupplyCFM / 100) * 100;
  const submissionCFMStr = projectTfaFreshCFM > 0.5
    ? `${n0(submissionCFMRounded)} space + ${n0(tfaFreshCFMRounded)} TFA = ${n0(totalSupplyCFMRounded)} CFM total`
    : `${n0(submissionCFMRounded)} CFM`;
  autoTable(doc, {
    startY: y,
    body: [
      ['Total Systems',                    n0(Math.max(effectiveSystems.length, activeEquipSystems.length))],
      // Use entities.length (already filtered by buildEntityRecords) instead of
      // effectiveZones.length — the raw zones array contains equipment-system
      // docs that LC mirrors into /zones/ for the tree view, which would
      // double-count here.
      ['Total Zones',                      n0(entities.length)],
      ['Total Rooms',                      n0(allRooms.length)],
      ['Peak Governing Season',            chillerFedTfa
        ? `${plantSeasonPeak.season}  (${n2(plantRequiredTR)} TR plant, diversity applied  ·  ${n0(totalSupplyCFM)} CFM total)`
        : `${peakSeason.season}  (${n2(peakSeason.loadTr)} TR space  ·  ${n0(recCFM)} CFM)`],
      ['Recommended Submission Basis',     chillerFedTfa
        ? `Space + TFA coil on one plant:  ${n2(submissionBasisTR)} TR (installed)  ·  ${submissionCFMStr}`
        : hasTfa
          ? `Chiller ${n2(submissionBasisTR)} TR (installed)  +  separate TFA unit ${n2(projectTfaCoilTR)} TR  ·  ${submissionCFMStr}`
          : `${n2(submissionBasisTR)} TR  and  ${n0(submissionCFMRounded)} CFM`],
      ...(hasTfa ? [['TFA / DOAS Coil Capacity', `${n2(projectTfaCoilTR)} TR  (outdoor-air coil, governing season)${chillerFedTfa ? ' — on main chiller plant' : ' — dedicated TFA unit'}`]] as [string,string][] : []),
      ...(hasTfa && projectTfaReheatBTUH > 0 ? [['TFA / DOAS Reheat Coil', `${n0(projectTfaReheatBTUH)} BTU/h  (${n2(projectTfaReheatBTUH / 12000)} TR · cool-to-ADP then reheat to supply temp)`]] as [string,string][] : []),
      ['Total Installed IDU / FCU Capacity', totalIDUStr],
      ['Total Installed Plant / ODU Capacity', totalPlantStr],
      // Diversity line is the installed IDU / Plant ratio (Pravat 2026-06-11). Falls back
      // to the load-based diversity summary only when no terminal units have been entered.
      ['Diversity Applied',                plantDiversityStr !== '—' ? plantDiversityStr : diversityStr],
    ],
    theme: 'grid',
    styles:       { fontSize: 9, cellPadding: 2.8, textColor: C.ink },
    columnStyles: { 0: { fontStyle: 'bold', fillColor: C.panel, cellWidth: 80 }, 1: {} },
    willDrawCell: (data: any) => {
      if (data.section === 'body' && data.row.index === 4) {
        data.cell.styles.fillColor = C.total;
        data.cell.styles.fontStyle = 'bold';
      }
      if (data.section === 'body' && data.row.index === 5) {
        data.cell.styles.fillColor = C.grandBg;
        data.cell.styles.textColor = C.grandFg;
        data.cell.styles.fontStyle = 'bold';
      }
      if (data.section === 'body' && data.row.index === 6) {
        data.cell.styles.fillColor = C.grandBg;
        data.cell.styles.textColor = C.grandFg;
        data.cell.styles.fontStyle = 'bold';
      }
      // Diversity row carries a long string — shrink so it wraps cleanly inside the
      // value cell instead of overflowing the table edge.
      if (data.section === 'body' && data.row.index === 7 && data.column.index === 1) {
        data.cell.styles.fontSize = 7.5;
      }
    },
    margin: { left: PAGE.left, right: PAGE.right },
  });
  y = (doc as any).lastAutoTable.finalY + 5;

  // Chiller-sizing convention note (only when at least one chiller has an Actual TR override)
  if (hasAnyChillerActualOverride(activeEquipSystems)) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.subInk);
    const noteLines = doc.splitTextToSize(
      'Chiller plant capacity above is the minimum required Actual TR at the project\'s site conditions ' +
      '(entering CW/air temp, LCW temp, altitude, fouling) — OEM to confirm in their technical proposal. ' +
      'Catalog Nominal TR — rated at AHRI 550/590 standard conditions — typically runs 5–15% higher and is ' +
      'shown in the Equipment Schedule for reference only.',
      doc.internal.pageSize.getWidth() - PAGE.left - PAGE.right
    );
    doc.text(noteLines, PAGE.left, y + 2);
    y += noteLines.length * 3.6 + 2;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.ink);
  }

  // Season summary table
  const sumHead = [
    'Season', 'Space TR', 'CFM TR', 'Governing TR',
    ...(hasTfa ? ['TFA Coil TR'] : []),
    'Design CFM',
    ...(includeWinter ? ['Winter Heat BTU/h'] : []),
    ...(includeWinter && projectTfaWinterHeatingBTUH > 0 ? ['TFA Heat BTU/h'] : []),
  ];
  const sumBody = projectSeasonTotals.map((s) => [
    s.season,
    s.key === 'winter' ? '—' : n2(s.loadTr),
    s.key === 'winter' ? '—' : n2(s.cfmTr),
    s.key === 'winter' ? '—' : n2(s.governingTr),
    ...(hasTfa ? [s.key === 'winter' ? '—' : n2(s.tfaCoilTr)] : []),
    s.key === 'winter' ? '—' : n0(s.cfm),
    ...(includeWinter ? [s.key === 'winter' ? n0(s.heating) : '—'] : []),
    ...(includeWinter && projectTfaWinterHeatingBTUH > 0 ? [s.key === 'winter' ? n0(projectTfaWinterHeatingBTUH) : '—'] : []),
  ]);

  autoTable(doc, {
    startY: y,
    head: [sumHead],
    body: sumBody,
    theme: 'grid',
    styles:     { fontSize: 8.5, cellPadding: 2.5, halign: 'center', textColor: C.ink },
    headStyles: { fillColor: C.panelDark, textColor: C.ink, fontStyle: 'bold' },
    columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
    willDrawCell: (data: any) => {
      if (data.section === 'body') {
        const label = String(sumBody[data.row.index]?.[0] ?? '');
        if (label === 'Summer')  data.cell.styles.fillColor = C.summerBg;
        if (label === 'Monsoon') data.cell.styles.fillColor = C.monsoonBg;
        if (label === 'Winter')  data.cell.styles.fillColor = C.winterBg;
      }
    },
    margin: { left: PAGE.left, right: PAGE.right },
  });

  // ═══ PAGE 3: SYSTEM/ZONE SUMMARY SCHEDULE ═════════════════════════════════

  y = startBody(doc, project);
  y = sectionBanner(doc, '3.  SYSTEM / ZONE SUMMARY SCHEDULE', y, C);
  y += 2;

  const summaryHead = [
    'Type', 'Parent System', 'Entity Name', 'Rooms', 'Summer TR',
    ...(includeMonsoon ? ['Monsoon TR'] : []),
    'Design CFM',
    ...(includeWinter ? ['Winter BTU/h'] : []),
    'Gov. TR', 'Inst. TR', 'Inst. CFM',
  ];

  const colCount = summaryHead.length;
  const govTrIdx      = 6 + (includeMonsoon ? 1 : 0) + (includeWinter ? 1 : 0);
  const instTrColIdx  = govTrIdx + 1;
  const instCfmColIdx = govTrIdx + 2;

  // Helper: build one zone row for the summary table
  const buildZoneRow = (entity: EntityRecord, parentName: string, sysType?: string): any[] => {
    const effProject = sysType ? { ...project, systemType: sysType } : project;
    const sumDc = resolveEntityDC(entity, summer,  effProject);
    const monDc = monsoon ? resolveEntityDC(entity, monsoon, effProject) : null;
    const winDc = winter ? resolveEntityDC(entity, winter, effProject) : null;
    let sumBTUH = 0, sumReqTR = 0, sumCfm = 0, monBTUH = 0, monReqTR = 0, monCfm = 0, winHeat = 0;
    entity.rooms.forEach((room) => {
      const sm = computeDetailed(room, envelopeElements[room.id] || [], sumDc, effProject);
      sumBTUH += sm.grandTotal; sumReqTR += sm.requiredTr; sumCfm += sm.designCfm;
      if (monDc) {
        const mm = computeDetailed(room, envelopeElements[room.id] || [], monDc, effProject);
        monBTUH += mm.grandTotal; monReqTR += mm.requiredTr; monCfm += mm.designCfm;
      }
      if (winDc) winHeat += computeDetailed(room, envelopeElements[room.id] || [], winDc, effProject).designHeatingLoad;
    });
    const sumTr    = sumBTUH / 12000;   // raw season load (Summer/Monsoon TR columns)
    const monTr    = monBTUH / 12000;
    const sumGovTR = sumTr;
    const monGovTR = monsoon ? monTr : 0;
    // Gov. TR carries the overall safety factor (matches Equipment Selection's coil duty).
    const govTr    = includeMonsoon ? Math.max(sumReqTR, monReqTR) : sumReqTR;
    const govCfm   = Math.max(sumCfm, monCfm);
    const inst = getInstalledTrCfm(entity.id, effectiveEquipSystems, entity.rooms.map(r => r.id));
    const row: any[] = [entity.type, parentName, entity.name, n0(entity.rooms.length), n2(sumGovTR)];
    if (includeMonsoon) row.push(n2(monGovTR));
    row.push(n0(govCfm));
    if (includeWinter) row.push(n0(winHeat));
    row.push(n2(govTr));
    row.push(inst.tr > 0 ? n2(inst.tr) : '—', inst.cfm > 0 ? n0(inst.cfm) : '—');
    return row;
  };

  // Build summary body — grouped by system when using new hierarchy
  const summaryBody: any[][] = [];
  if (hvacHierarchy) {
    for (const sys of hvacHierarchy.systems) {
      const sysZones = hvacHierarchy.zonesBySystem[sys.id] ?? [];
      // System header row spanning all columns
      summaryBody.push([{
        content: `${sys.name ?? sys.id}   ·   ${sys.type ?? '—'}`,
        colSpan: colCount,
        styles: { fontStyle: 'bold' as const, fillColor: C.panelDark, textColor: C.ink, fontSize: 7.5 },
      }]);
      if (sysZones.length === 0) {
        summaryBody.push([{
          content: 'No zones defined',
          colSpan: colCount,
          styles: { fontStyle: 'italic' as const, textColor: C.subInk },
        }]);
        continue;
      }
      for (const zone of sysZones) {
        const entity = entities.find(e => e.id === zone.id);
        if (!entity || entity.rooms.length === 0) {
          const emptyRow: any[] = ['Zone', sys.name || '—', `  ${zone.name || zone.id}`, '0', '—'];
          if (includeMonsoon) emptyRow.push('—');
          emptyRow.push('—');
          if (includeWinter) emptyRow.push('—');
          emptyRow.push('—', '—', '—');
          summaryBody.push(emptyRow);
        } else {
          const row = buildZoneRow(entity, sys.name || '—', sys.type);
          row[2] = `  ${row[2]}`; // indent zone name
          summaryBody.push(row);
        }
      }
    }
  } else {
    entities.forEach(entity => {
      // Resolve parent system from equipment systems (rooms carry systemId pointing to /equipmentSystems)
      const roomSystemId = entity.rooms[0]?.systemId as string | undefined;
      const eqParent = roomSystemId ? effectiveEquipSystems.find((s: any) => s.id === roomSystemId) : null;
      const parentName = eqParent?.name ?? entity.parentSystem ?? '—';
      summaryBody.push(buildZoneRow(entity, parentName));
    });
  }

  const sumColStyles: Record<number, any> = {
    0: { fontStyle: 'bold', cellWidth: 12 },
    2: { fontStyle: 'bold', cellWidth: includeMonsoon ? 24 : 28 },
  };
  sumColStyles[instTrColIdx]  = { halign: 'right', cellWidth: 15, fontStyle: 'bold' };
  sumColStyles[instCfmColIdx] = { halign: 'right', cellWidth: 15, fontStyle: 'bold' };

  autoTable(doc, {
    startY: y,
    head: [summaryHead],
    body: summaryBody,
    theme: 'grid',
    styles:     { fontSize: 7, cellPadding: 1.5, textColor: C.ink },
    headStyles: { fillColor: C.panelDark, textColor: C.ink, fontStyle: 'bold' },
    columnStyles: sumColStyles,
    willDrawCell: (data: any) => {
      if (data.section === 'body') {
        // Skip styling for colspan (system header) rows
        if (data.row.cells[0]?.raw && String(data.row.cells[0].raw).length > 0 &&
            Object.keys(data.row.cells).length === 1) return;
        const col = data.column.index;
        if (col === instTrColIdx || col === instCfmColIdx) {
          const cellVal = String(data.cell.raw ?? '');
          const govTrVal = parseFloat(String(data.row.cells[govTrIdx]?.raw ?? '0'));
          if (col === instTrColIdx && cellVal !== '—') {
            const instTrVal = parseFloat(cellVal);
            if (instTrVal < govTrVal) {
              data.cell.styles.textColor = [180, 50, 50] as [number, number, number];
            } else {
              data.cell.styles.textColor = [20, 120, 60] as [number, number, number];
            }
          }
        }
      }
    },
    margin: { left: PAGE.left, right: PAGE.right },
  });

  // ── Equipment Fit Verification ────────────────────────────────────────────
  {
    const fitBody: any[][] = [];
    for (const entity of entities) {
      if (entity.rooms.length === 0) continue;
      const eDc  = resolveEntityDC(entity, summer, project);
      const eMon = monsoon ? resolveEntityDC(entity, monsoon, project) : null;
      let sReqTR = 0, sCFM = 0, mReqTR = 0, mCFM = 0;
      entity.rooms.forEach((rm) => {
        const sm = computeDetailed(rm, envelopeElements[rm.id] || [], eDc, project);
        sReqTR += sm.requiredTr; sCFM += sm.designCfm;
        if (eMon) { const mm = computeDetailed(rm, envelopeElements[rm.id] || [], eMon, project); mReqTR += mm.requiredTr; mCFM += mm.designCfm; }
      });
      // Fit basis carries the overall safety factor (matches Equipment Selection's coil duty).
      const govTR  = includeMonsoon ? Math.max(sReqTR, mReqTR) : sReqTR;
      const govCFM = Math.max(sCFM, mCFM);
      const inst   = getInstalledTrCfm(entity.id, effectiveEquipSystems, entity.rooms.map(r => r.id));
      const fitStatus = inst.tr === 0 ? 'No Equip' : inst.tr >= govTR * 0.97 ? 'OK' : 'Undersized';
      fitBody.push([entity.name, n2(govTR), n0(govCFM), inst.tr > 0 ? n2(inst.tr) : '—', inst.cfm > 0 ? n0(inst.cfm) : '—', fitStatus]);
    }
    if (fitBody.length > 0) {
      y = (doc as any).lastAutoTable.finalY + 8;
      y = ensureSpace(doc, y, 16 + fitBody.length * 7, project);
      y = subBanner(doc, 'Equipment Fit Verification  (safety factors already included in Governing TR)', y, C);
      y += 2;
      autoTable(doc, {
        startY: y,
        head: [['Entity / Zone', 'Governing TR', 'Design CFM', 'Inst. TR', 'Inst. CFM', 'Status']],
        body: fitBody,
        theme: 'grid',
        styles:     { fontSize: 7.5, cellPadding: 2, textColor: C.ink },
        headStyles: { fillColor: C.accent, textColor: C.headFg, fontStyle: 'bold', fontSize: 7.5 },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 48 },
          1: { halign: 'right' as const, cellWidth: 24, fontStyle: 'bold' },
          2: { halign: 'right' as const, cellWidth: 24 },
          3: { halign: 'right' as const, cellWidth: 22, fontStyle: 'bold' },
          4: { halign: 'right' as const, cellWidth: 22 },
          5: { halign: 'center' as const, fontStyle: 'bold' },
        },
        willDrawCell: (data: any) => {
          if (data.section === 'body' && data.column.index === 6) {
            const s = String(data.cell.raw);
            if (s === 'OK')         data.cell.styles.textColor = [20, 130, 70]  as [number,number,number];
            else if (s === 'Undersized') data.cell.styles.textColor = [180, 50, 50] as [number,number,number];
            else                    data.cell.styles.textColor = [120, 120, 120] as [number,number,number];
          }
        },
        margin: { left: PAGE.left, right: PAGE.right },
      });
    }
  }

  // ── Airflow Schedule (recirc / fresh air) for terminal & duct layout ──────
  {
    const afBody: any[][] = [];
    let projRecirc = 0, projFacfm = 0, projTotal = 0;
    for (const entity of entities) {
      if (entity.rooms.length === 0) continue;
      const sumDc = resolveEntityDC(entity, summer, project);
      const monDc = monsoon ? resolveEntityDC(entity, monsoon, project) : null;
      afBody.push([{ content: entity.name, colSpan: 5, styles: { fontStyle: 'bold' as const, fillColor: C.panelDark, textColor: C.ink, fontSize: 7.5 } }]);
      let zRecirc = 0, zFacfm = 0, zTotal = 0;
      for (const room of entity.rooms) {
        const els = envelopeElements[room.id] || [];
        const sm = computeDetailed(room, els, sumDc, project);
        const govCfm = monDc
          ? Math.max(sm.designCfm, computeDetailed(room, els, monDc, project).designCfm)
          : sm.designCfm;
        const split = computeAirflowSplit({
          designSupplyCFM: govCfm,
          freshAirCFM: sm.faCfm,
          tfaCfm: sm.tfaCfm,
          isTFA: sm.isTFA,
          isTfaOnly: sm.isTfaOnly,
        });
        const modeLabel = sm.isTfaOnly ? 'TFA-only' : sm.isTFA ? 'Central TFA' : 'On unit';
        afBody.push([`  ${room.name ?? 'Unnamed'}`, modeLabel, n0(split.recircCFM), n0(split.freshAirCFM), n0(split.totalSupplyCFM)]);
        zRecirc += split.recircCFM; zFacfm += split.freshAirCFM; zTotal += split.totalSupplyCFM;
      }
      afBody.push([
        { content: `${entity.name} subtotal`, colSpan: 2, styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
        { content: n0(zRecirc), styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
        { content: n0(zFacfm), styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
        { content: n0(zTotal), styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
      ]);
      projRecirc += zRecirc; projFacfm += zFacfm; projTotal += zTotal;
    }
    if (afBody.length > 0) {
      y = startBody(doc, project);
      y = sectionBanner(doc, '3A.  AIRFLOW SCHEDULE  —  RECIRC / FRESH AIR (FACFM)', y, C);
      y += 2;
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text('Recirc = Total - Fresh. Total supply = governing (worst-season) airflow. Sizes supply diffusers = Total; return/recirc = Recirc; OA intake or DOAS branch = FACFM.', PAGE.left, y);
      doc.setFont('helvetica', 'normal');
      y += 5;
      afBody.push([
        { content: 'PROJECT TOTAL', colSpan: 2, styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
        { content: n0(projRecirc), styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
        { content: n0(projFacfm), styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
        { content: n0(projTotal), styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
      ]);
      autoTable(doc, {
        startY: y,
        head: [['Room', 'Fresh air', 'Recirc CFM', 'Fresh (FACFM)', 'Total Supply CFM']],
        body: afBody,
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 1.5, textColor: C.ink },
        headStyles: { fillColor: C.accent, textColor: C.headFg, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 50 },
          1: { cellWidth: 26 },
          2: { halign: 'right' as const, cellWidth: 30 },
          3: { halign: 'right' as const, cellWidth: 32 },
          4: { halign: 'right' as const, cellWidth: 34 },
        },
        margin: { left: PAGE.left, right: PAGE.right },
      });
    }
  }

  // ═══ SECTIONS 4+: ENTITY DETAIL ═══════════════════════════════════════════

  for (const entity of entities) {
    y = startBody(doc, project);
    y = sectionBanner(doc, `4.  ${entity.type.toUpperCase()} DETAIL  —  ${String(entity.name || '').toUpperCase()}`, y, C);
    y += 2;

    // Entity info
    autoTable(doc, {
      startY: y,
      body: [
        ['Entity Type',    entity.type],
        ['Entity Name',    entity.name],
        ['Parent System',  entity.parentSystem || '—'],
        ['No. of Rooms',   n0(entity.rooms.length)],
      ],
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 2.2, textColor: C.ink },
      columnStyles: { 0: { fontStyle: 'bold', fillColor: C.panel, cellWidth: 48 } },
      margin: { left: PAGE.left, right: PAGE.right },
    });
    y = (doc as any).lastAutoTable.finalY + 5;

    // Entity room schedule table
    y = subBanner(doc, 'Room Schedule', y, C);
    y += 1;

    // TFA/DOAS split: a room is TFA-served when the engine persisted a TFA coil
    // load (or flagged it tfa-only). When any room in the zone is TFA-served, add
    // a "TFA Coil TR" + "TFA CFM" pair so the schedule shows the space (primary
    // coil) side and the TFA side separately. Non-TFA zones get no extra columns.
    const isTfaRoom = (room: any) =>
      (Number(room._calcTfaCoilBTUH) || 0) > 0 ||
      (Number(room._calcMonsoonTfaCoilBTUH) || 0) > 0 ||
      !!room._calcTfaOnly;
    const entityHasTfa = entity.rooms.some(isTfaRoom);

    const rscHead = [
      'Room', 'Floor', 'Area ft²', 'Summer TR',
      ...(includeMonsoon ? ['Monsoon TR'] : []),
      'Design CFM',
      ...(entityHasTfa ? ['TFA Coil TR', 'TFA CFM'] : []),
      ...(includeWinter ? ['Winter BTU/h'] : []),
      ...(includeWinter && entityHasTfa ? ['TFA Heat BTU/h'] : []),
      'Gov TR', 'Inst. TR', 'Inst. CFM',
    ];

    const sumDcE = resolveEntityDC(entity, summer, project);
    const monDcE = monsoon ? resolveEntityDC(entity, monsoon, project) : null;
    const winDcE = winter ? resolveEntityDC(entity, winter, project) : null;

    let totArea = 0, totSumTRsum = 0, totMonTRsum = 0, totCFMsum = 0, totWinHeat = 0;
    let totSumReqTRsum = 0, totMonReqTRsum = 0;  // with overall safety — for the ZONE TOTAL Gov TR
    let totTfaTR = 0, totTfaCFM = 0, totTfaWinterHeat = 0;

    // Prefer the engine's persisted values (load-only + TFA-aware) over a fresh
    // recompute; computeDetailed (max load/CFM, OA-on-primary) is only a fallback
    // for rooms that were never calculated. num() returns null when the field is
    // absent so we know to fall back.
    const num = (v: any): number | null => (v === undefined || v === null || v === '' ? null : Number(v));

    const rscBody: any[][] = entity.rooms.map((room: any) => {
      const sm = computeDetailed(room, envelopeElements[room.id] || [], sumDcE, project);
      const mm = monDcE ? computeDetailed(room, envelopeElements[room.id] || [], monDcE, project) : null;
      const wm = winDcE ? computeDetailed(room, envelopeElements[room.id] || [], winDcE, project) : null;

      // Reconcile persisted with the live recompute (take the max), same as the
      // TFA-coil column below — so a stale or partial persist (e.g. a tfa-served
      // room whose cold-DOAS credit zeroed _calcGoverningTR while the live space
      // coil is non-zero) can't make this schedule disagree with the per-room
      // cooling breakdown / zone summary, which both recompute live.
      const sumTR  = Math.max(num(room._calcGoverningTR)        ?? 0, sm.governingTr);
      const monTR  = Math.max(num(room._calcMonsoonGoverningTR) ?? 0, mm?.governingTr ?? 0);
      // Gov TR carries the overall safety factor (matches Equipment Selection's coil duty);
      // sumTR/monTR above stay as the raw per-season governing load for their columns.
      const govTR  = Math.max(num(room._calcOverallRequiredTR) ?? 0, sm.requiredTr, mm?.requiredTr ?? 0);
      const cfm    = Math.max(num(room._calcOverallDesignCFM)   ?? 0, sm.designCfm, mm?.designCfm ?? 0);
      // TFA coil duty — governing (summer/monsoon) persisted value, falling back to
      // the live recompute when the room object doesn't carry the persisted _calc
      // fields, so the schedule matches the per-room cooling breakdown.
      const tfaTR  = Math.max(
        Number(room._calcTfaCoilTR) || 0,
        Number(room._calcMonsoonTfaCoilTR) || 0,
        sm.tfaCoilTr || 0,
        mm?.tfaCoilTr || 0,
      );
      const tfaCfm = Number(room._calcTfaCfm) || sm.tfaCfm || mm?.tfaCfm || 0;

      totArea     += sm.area;
      totSumTRsum += sumTR;
      totMonTRsum += monTR;
      totSumReqTRsum += Math.max(num(room._calcRequiredTR)        ?? 0, sm.requiredTr);
      totMonReqTRsum += Math.max(num(room._calcMonsoonRequiredTR) ?? 0, mm?.requiredTr ?? 0);
      totCFMsum   += cfm;
      totWinHeat  += wm?.designHeatingLoad ?? 0;
      totTfaTR    += tfaTR;
      totTfaCFM   += tfaCfm;
      totTfaWinterHeat += Number(room._calcTfaWinterHeatingBTUH) || 0;

      const rInst = getRoomInstalledTrCfm(room.id, effectiveEquipSystems);
      const row: any[] = [room.name || '—', room.floor || '—', n0(sm.area), n2(sumTR)];
      if (includeMonsoon) row.push(n2(monTR));
      row.push(n0(cfm));
      if (entityHasTfa) row.push(tfaTR > 0 ? n2(tfaTR) : '—', tfaCfm > 0 ? n0(tfaCfm) : '—');
      if (includeWinter) row.push(n0(wm?.designHeatingLoad ?? 0));
      if (includeWinter && entityHasTfa) row.push((Number(room._calcTfaWinterHeatingBTUH) || 0) > 0 ? n0(Number(room._calcTfaWinterHeatingBTUH)) : '—');
      row.push(
        n2(govTR),
        rInst.tr  > 0 ? n2(rInst.tr)  : '—',
        rInst.cfm > 0 ? n0(rInst.cfm) : '—',
      );
      return row;
    });

    // Per-season TR columns stay raw load; the Gov TR total carries the overall safety factor
    // (matches the per-room Gov TR cell + Equipment Selection's coil duty).
    const totSumTR  = totSumTRsum;
    const totMonTR  = includeMonsoon ? totMonTRsum : 0;
    const totGovTR  = includeMonsoon ? Math.max(totSumReqTRsum, totMonReqTRsum) : totSumReqTRsum;
    const totCFM    = totCFMsum;

    // Totals row — installed TR/CFM from equipment selection merged at zone level
    const instE = getInstalledTrCfm(entity.id, effectiveEquipSystems, entity.rooms.map((r: any) => r.id));
    const instTRStr  = instE.tr  > 0 ? n2(instE.tr)  : '—';
    const instCFMStr = instE.cfm > 0 ? n0(instE.cfm) : '—';
    const totRow: any[] = [
      { content: 'ZONE TOTAL', styles: { fontStyle: 'bold' as const, fillColor: C.total } },
      { content: '—',          styles: { fillColor: C.total } },
      { content: n0(totArea),  styles: { fontStyle: 'bold' as const, fillColor: C.total } },
      { content: n2(totSumTR), styles: { fontStyle: 'bold' as const, fillColor: C.total } },
    ];
    if (includeMonsoon) totRow.push({ content: n2(totMonTR), styles: { fontStyle: 'bold' as const, fillColor: C.total } });
    totRow.push({ content: n0(totCFM), styles: { fontStyle: 'bold' as const, fillColor: C.total } });
    if (entityHasTfa) totRow.push(
      { content: totTfaTR  > 0 ? n2(totTfaTR)  : '—', styles: { fontStyle: 'bold' as const, fillColor: C.total } },
      { content: totTfaCFM > 0 ? n0(totTfaCFM) : '—', styles: { fontStyle: 'bold' as const, fillColor: C.total } },
    );
    if (includeWinter) totRow.push({ content: n0(totWinHeat), styles: { fontStyle: 'bold' as const, fillColor: C.total } });
    if (includeWinter && entityHasTfa) totRow.push({ content: totTfaWinterHeat > 0 ? n0(totTfaWinterHeat) : '—', styles: { fontStyle: 'bold' as const, fillColor: C.total } });
    totRow.push(
      { content: n2(totGovTR),   styles: { fontStyle: 'bold' as const, fillColor: C.total } },
      { content: instTRStr,  styles: { fontStyle: 'bold' as const, fillColor: C.grandBg, textColor: C.grandFg, halign: 'right' as const } },
      { content: instCFMStr, styles: { fontStyle: 'bold' as const, fillColor: C.grandBg, textColor: C.grandFg, halign: 'right' as const } },
    );
    rscBody.push(totRow);

    const rscColStyles: Record<number, any> = { 0: { fontStyle: 'bold', cellWidth: 30 } };
    const tfaCols     = entityHasTfa ? 2 : 0;
    const tfaHeatCol  = (includeWinter && entityHasTfa) ? 1 : 0;
    const rInstTRIdx  = 6 + (includeMonsoon ? 1 : 0) + tfaCols + (includeWinter ? 1 : 0) + tfaHeatCol;
    const rInstCFMIdx = 7 + (includeMonsoon ? 1 : 0) + tfaCols + (includeWinter ? 1 : 0) + tfaHeatCol;
    rscColStyles[rInstTRIdx]  = { halign: 'right', cellWidth: 15 };
    rscColStyles[rInstCFMIdx] = { halign: 'right', cellWidth: 15 };

    autoTable(doc, {
      startY: y,
      head: [rscHead],
      body: rscBody,
      theme: 'grid',
      styles:     { fontSize: 7, cellPadding: 1.5, textColor: C.ink },
      headStyles: { fillColor: C.panelDark, textColor: C.ink, fontStyle: 'bold' },
      columnStyles: rscColStyles,
      margin: { left: PAGE.left, right: PAGE.right },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // Plant-duty caption — ONLY when this zone has TFA-served rooms. Shows how the
    // space (primary coil) and TFA coil combine. If the serving DOAS is fed by the
    // main chiller plant, the two add into one plant duty; otherwise the TFA coil
    // sits on its own dedicated unit. Non-TFA zones print nothing (no change).
    if (entityHasTfa) {
      const doasList = (effectiveEquipSystems ?? []).filter((s: any) => s?.type === 'DOAS');
      const chillerFed = entity.rooms.some((room: any) =>
        doasList.some((d: any) =>
          ((d.tfaCoolingSource ?? 'own-unit') === 'chiller-plant') &&
          (((d.doasLinkedSystemIds ?? []).includes(room.systemId)) ||
           ((d.doasLinkedZoneIds ?? []).includes(room.zoneId)))));
      const totalDuty = totGovTR + totTfaTR;
      const cap = chillerFed
        ? `Plant duty (TFA coil on main chiller): space ${n2(totGovTR)} TR + TFA coil ${n2(totTfaTR)} TR = ${n2(totalDuty)} TR`
        : `Cooling split: space ${n2(totGovTR)} TR on chiller  +  TFA coil ${n2(totTfaTR)} TR on dedicated TFA unit  (${n2(totalDuty)} TR total)`;
      doc.setFontSize(7.5);
      doc.setTextColor(...C.ink);
      doc.text(cap, PAGE.left, y);
      y += 5;
    }

    // ── Per-room detail ──────────────────────────────────────────────────────
    for (const room of entity.rooms) {

      const drawRoomForSeason = (seasonLabel: string, dc: DC, bgRow: [number,number,number]) => {
        const m = computeDetailed(room, envelopeElements[room.id] || [], dc, project);
        const elems = envelopeElements[room.id] || [];
        const outdoorPsycho = calculatePsychrometrics(dc.outdoorTemp, dc.outdoorHumidity, dc.altitude);
        const indoorPsycho  = calculatePsychrometrics(dc.indoorTemp,  dc.indoorHumidity,  dc.altitude);
        const isWinter = (dc.outdoorTemp < dc.indoorTemp);

        // ── Room header bar ──
        y = ensureSpace(doc, y, 120, project);
        doc.setFillColor(...bgRow);
        doc.rect(PAGE.left, y - 3.5, pageW - PAGE.left - PAGE.right, 7.5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...C.ink);
        doc.text(`Room: ${String(room.name || '—')}  (${String(room.floor || '—')})  ·  ${seasonLabel} Analysis`, PAGE.left + 3, y + 1);
        y += 8;

        // ── Room inputs (two column layout) ──
        const effH = (room.hasFalseCeiling && room.falseCeilingHeight) ? asNum(room.falseCeilingHeight, 0) : asNum(room.height, 0);
        const dims = `${asNum(room.length, 0)} × ${asNum(room.width, 0)} × ${asNum(room.height, 0)} ft`;
        const fcNote = (room.hasFalseCeiling && room.falseCeilingHeight)
          ? `False Ceiling: ${asNum(room.falseCeilingHeight, 0)} ft  (Eff. ${n1(effH)} ft)`
          : 'No False Ceiling';

        autoTable(doc, {
          startY: y,
          body: [
            ['Length × Width × Height',    dims,             'False Ceiling Height', fcNote],
            ['Floor Area',                 `${n0(m.area)} ft²`,  'Room Volume', `${n0(calculateRoomVolume(room))} ft³`],
            ['People / Activity',          `${n0(asNum(room.peopleCount, 0))} persons  /  ${String(room.activityType || '—')}`, 'FACPH / FA CFM', `${n1(asNum(room.facph, 0))} ACH  /  ${n0(m.faCfm)} CFM`],
            ['Lighting / Equip / Others',  `${asNum(room.lightsWattsPerSqft, 0)} W/ft²  /  ${asNum(room.equipmentKW, 0)} kW  /  ${asNum(room.othersKW, 0)} kW`,
              resolveRoomSupplyBasis(room.supplyCfmBasis, project?.supplyBasis) === 'ach' ? 'ACH / Total Supply CFM' : 'Supply Basis / Design CFM',
              resolveRoomSupplyBasis(room.supplyCfmBasis, project?.supplyBasis) === 'ach'
                ? `${n1(m.totalAch)} ACH  /  ${n0(m.totalSupplyCfm)} CFM`
                : `Dehumidified (DSCFM)  /  ${n0(m.designCfm)} CFM`],
            // Latent shortfall row — only when the actual design supply air can't carry the latent
            // load at the selected ADP (latentShortfallCFM is sensible-based and false-alarms once
            // the ACH/DSCFM floor bumps supply above the latent need). When the engineer has chosen
            // a dehumidification strategy for this zone (reheat or desiccant), show it as RESOLVED
            // with the reheat duty — not an open failure.
            ...((m.latentCfm - m.designCfm) > 1
              ? (() => {
                  const dh = resolveRoomDehumid(room, activeEquipSystems);
                  if (dh && isReheatMethod(dh.method)) {
                    // Use the SAME RSHF-based required-reheat the psychro "Reheat ★ REQD" row shows
                    // below — NOT the zone's stored dehumidReheatKW (which can be stale/undersized and
                    // would contradict the psychro row, and differ between identical rooms).
                    const _roomTot = m.ersh + m.erlh;
                    const _cSHR = _roomTot > 0 ? m.ersh / _roomTot : 1;
                    const rhBtu = _cSHR < 0.75 ? Math.max(0, (m.erlh * 0.75) / 0.25 - m.ersh) : 0;
                    // Only print the "over-cools then reheats — size the reheat coil" narrative when
                    // reheat is actually needed (room SHR < 0.75 → the supply over-cools while drying).
                    // At SHR >= 0.75 the duty is 0, so describing a reheat coil next to "0.00 kW" is
                    // self-contradictory — state plainly that no reheat is required instead.
                    if (rhBtu > 0) {
                      return [['Dehumidification (Reheat)',
                        `Reheat dehumidification selected (${dh.label}): the coil over-cools below the ${n0(m.selectedAdp)}°F ADP to wring out the full latent load at ${n0(m.designCfm)} CFM, then reheats to hold supply temp. Size the reheat coil to the duty at right.`,
                        'Required reheat duty',
                        `${n2(rhBtu / 3412.142)} kW  (${n0(rhBtu)} BTU/h)`]];
                    }
                    return [['Dehumidification',
                      `Coil @ ${n0(m.selectedAdp)}°F dries this room at ${n0(m.designCfm)} CFM with no reheat — room SHR ${_cSHR.toFixed(2)} is at/above 0.75, so the supply air does not over-cool. (${dh.label} is configured for this zone should a tighter supply-temp band later be required.)`,
                      'Required reheat duty',
                      `Not required (SHR ${_cSHR.toFixed(2)})`]];
                  }
                  if (dh && dh.method === 'standalone') {
                    return [['Dehumidification',
                      `Standalone desiccant / DX dehumidification selected for this zone — removes the residual latent the cooling coil can't at ${n0(m.designCfm)} CFM.`,
                      'Latent need / Supplied',
                      `${n0(m.latentCfm)} / ${n0(m.designCfm)} CFM`]];
                  }
                  return [['Latent / Reheat',
                    `Coil @ ${n0(m.selectedAdp)}°F can't fully dry this room — supplied ${n0(m.designCfm)} CFM is below the ${n0(m.latentCfm)} CFM the latent load needs at this ADP. Lower the coil ADP (Dehumidification mode) or add a DOAS / desiccant.`,
                    'Latent need / Supplied',
                    `${n0(m.latentCfm)} / ${n0(m.designCfm)} CFM`]];
                })()
              : []),
          ],
          theme: 'grid',
          styles: { fontSize: 7.5, cellPadding: 1.8, textColor: C.ink },
          columnStyles: {
            0: { fontStyle: 'bold', fillColor: C.panel, cellWidth: 44 },
            1: { cellWidth: 56 },
            2: { fontStyle: 'bold', fillColor: C.panel, cellWidth: 42 },
            3: { cellWidth: 44 },
          },
          margin: { left: PAGE.left, right: PAGE.right },
        });
        y = (doc as any).lastAutoTable.finalY + 3;

        // ── Envelope elements table ──
        if (elems.length > 0) {
          y = ensureSpace(doc, y, 30, project);
          y = subBanner(doc, `Envelope Elements  (${seasonLabel})`, y, C);
          y += 1;

          const envRows = elems.map((el: any) => {
            const gain = calculateSingleElementGain(el, dc);
            const uA = asNum(el.uValue, 0) * asNum(el.area, 0);
            // CLTD/SCL column:
            //  • Glass — the solar factor (SCL/SHGF) that drives the solar gain.
            //  • Opaque — the EFFECTIVE CLTD actually used (ASHRAE altitude / temp-base /
            //    color / latitude-month corrections applied), backed out of the conduction so
            //    U × A × CLTD reconciles with the Cond BTU/h column. Previously this showed the
            //    stored el.solarFactor, which is the uncorrected value and did NOT reproduce Cond.
            const cltdScl = isWinter
              ? '—'
              : String(el.type) === 'Glass'
                ? n2(asNum(el.solarFactor, 0))
                : n2(uA !== 0 ? gain.conduction / uA : 0);
            return [
              String(el.type || '—'),
              String(el.description || el.wallTypeId || '—'),
              String(el.orientation || '—'),
              n0(asNum(el.area, 0)),
              asNum(el.uValue, 0).toFixed(3),
              cltdScl,
              n0(gain.conduction),
              isWinter ? '—' : n0(gain.radiation),
              n0(gain.total),
            ];
          });

          autoTable(doc, {
            startY: y,
            head: [['Type', 'Description', 'Orient', 'Area ft²', 'U-Value', 'CLTD/SCL', 'Cond BTU/h', 'Solar BTU/h', 'Total BTU/h']],
            body: envRows,
            theme: 'grid',
            styles:     { fontSize: 7, cellPadding: 1.5, textColor: C.ink },
            headStyles: { fillColor: C.panelDark, textColor: C.ink, fontStyle: 'bold', fontSize: 7 },
            columnStyles: {
              0: { fontStyle: 'bold', cellWidth: 15 },
              1: { cellWidth: 35 },
              2: { cellWidth: 13, halign: 'center' },
              3: { halign: 'right', cellWidth: 15 },
              4: { halign: 'right', cellWidth: 15 },
              5: { halign: 'right', cellWidth: 15 },
              6: { halign: 'right' },
              7: { halign: 'right' },
              8: { halign: 'right', fontStyle: 'bold' },
            },
            margin: { left: PAGE.left, right: PAGE.right },
          });
          y = (doc as any).lastAutoTable.finalY + 3;
        }

        // ── Load breakdown table ──
        y = ensureSpace(doc, y, 120, project);
        y = subBanner(doc, `Cooling Load Breakdown  (${seasonLabel})`, y, C);
        y += 1;

        const loadRows: any[] = [
          // Envelope
          [{ content: 'ENVELOPE GAINS', colSpan: 3, styles: { fontStyle: 'bold', fillColor: C.accentBg, textColor: C.ink } }],
          ['  Walls',              n0(m.envWalls),        '—'],
          ['  Roof',               n0(m.envRoof),         '—'],
          ['  Glass – Conduction', n0(m.envGlassTrans),   '—'],
          ['  Glass – Solar',      n0(m.envGlassSolar),   '—'],
          ['  Partitions',         n0(m.envPartitions),   '—'],
          ['  Floor',              n0(m.envFloor),        '—'],
          [{ content: '  Total Envelope', styles: { fontStyle: 'bold' } }, { content: n0(m.envelopeTotal), styles: { fontStyle: 'bold' } }, '—'],
          // Internal
          [{ content: 'INTERNAL GAINS', colSpan: 3, styles: { fontStyle: 'bold', fillColor: C.accentBg, textColor: C.ink } }],
          ['  People',             n0(m.peopleSensible),    n0(m.peopleLatent)],
          ['  Lighting',           n0(m.lightsSensible),    '—'],
          ['  Equipment',          n0(m.equipmentSensible), '—'],
          ['  Others',             n0(m.othersSensible),    '—'],
          [{ content: '  Total Internal', styles: { fontStyle: 'bold' } }, { content: n0(m.internalSensible), styles: { fontStyle: 'bold' } }, { content: n0(m.internalLatent), styles: { fontStyle: 'bold' } }],
          // Vent + Parasitic
          [{ content: 'VENTILATION & PARASITIC', colSpan: 3, styles: { fontStyle: 'bold', fillColor: C.accentBg, textColor: C.ink } }],
          [`  Ventilation (BF=${0.15} room portion)`, n0(m.ventSensibleBF), n0(m.ventLatentBF)],
          ['  Duct Gain',          n0(m.ductGain),          '—'],
          ['  Fan Heat Gain',      n0(m.fanGain),           '—'],
          // Effective room
          [{ content: 'EFFECTIVE ROOM LOADS', colSpan: 3, styles: { fontStyle: 'bold', fillColor: C.accentBg, textColor: C.ink } }],
          ['  ERSH (raw)',         n0(m.erSensibleRaw + m.ductGain + m.fanGain), '—'],
          ['  ERLH (raw)',         '—',                                           n0(m.erLatentRaw)],
          [`  Safety Factor Applied`, `+${m.sSafetyPct}% sensible`, `+${m.lSafetyPct}% latent`],
          [{ content: '  ERSH (with safety factor)', styles: { fontStyle: 'bold', fillColor: C.total } }, { content: n0(m.ersh), styles: { fontStyle: 'bold', fillColor: C.total } }, { content: '—', styles: { fillColor: C.total } }],
          [{ content: '  ERLH (with safety factor)', styles: { fontStyle: 'bold', fillColor: C.total } }, { content: '—', styles: { fillColor: C.total } }, { content: n0(m.erlh), styles: { fontStyle: 'bold', fillColor: C.total } }],
          // Outdoor air — to the TFA/DOAS coil when DOAS-served, else on the primary coil.
          ...(m.isTFA
            ? [
                [{ content: 'TFA / DOAS COIL  (outdoor air — conditioned by the DOAS unit, not the primary)', colSpan: 3, styles: { fontStyle: 'bold', fillColor: C.accentBg, textColor: C.ink } }],
                ['  TFA Coil Sensible',  n0(m.tfaCoilSensible), '—'],
                ['  TFA Coil Latent',    '—',                   n0(m.tfaCoilLatent)],
                [{ content: `  TFA Coil Total   =   ${n0(m.tfaCoilSensible + m.tfaCoilLatent)} BTU/h   (${n2(m.tfaCoilTr)} TR · ${n0(m.tfaCfm)} CFM OA)`, colSpan: 3, styles: { fontStyle: 'bold', fillColor: C.total } }],
                ...(m.tfaReheat > 0
                  ? [[{ content: `  TFA Reheat Coil   =   ${n0(m.tfaReheat)} BTU/h   (cool OA to ADP ${dualTu(m.tfaCoilADP)} to dehumidify, then sensibly reheat to the DOAS supply temp)`, colSpan: 3, styles: { fontStyle: 'bold', fillColor: C.total } }]] as any[]
                  : []),
                ...((m.tfaSupplyOffsetSen > 0 || m.tfaSupplyOffsetLat > 0)
                  ? [['  Cold-DOAS supply credit to space', m.tfaSupplyOffsetSen > 0 ? `-${n0(m.tfaSupplyOffsetSen)}` : '—', m.tfaSupplyOffsetLat > 0 ? `-${n0(m.tfaSupplyOffsetLat)}` : '—']]
                  : []),
                [{ content: m.isTfaOnly ? 'PRIMARY COIL  (TFA-only — primary carries zero)' : 'PRIMARY COIL  (space — OA handled by TFA)', colSpan: 3, styles: { fontStyle: 'bold', fillColor: C.accentBg, textColor: C.ink } }],
              ]
            : [
                [{ content: 'OUTDOOR AIR (unbypassed coil load)', colSpan: 3, styles: { fontStyle: 'bold', fillColor: C.accentBg, textColor: C.ink } }],
                ['  OA Sensible',        n0(m.oaSensible), '—'],
                ['  OA Latent',          '—',              n0(m.oaLatent)],
                [{ content: 'COIL LOADS', colSpan: 3, styles: { fontStyle: 'bold', fillColor: C.accentBg, textColor: C.ink } }],
              ]),
          ['  Coil Sensible',      n0(m.coilSensible),  '—'],
          ['  Coil Latent',        '—',                 n0(m.coilLatent)],
          [{ content: `  ${m.isTFA ? 'SPACE COIL TOTAL' : 'GRAND TOTAL'}   =   ${n0(m.grandTotal)} BTU/h   (${n2(m.loadTr)} TR)`, colSpan: 3, styles: { fontStyle: 'bold', fillColor: C.grandBg, textColor: C.grandFg, fontSize: 8.5 } }],
        ];

        autoTable(doc, {
          startY: y,
          head: [['Load Component', 'Sensible BTU/h', 'Latent BTU/h']],
          body: loadRows,
          theme: 'grid',
          styles:     { fontSize: 7.5, cellPadding: 1.6, textColor: C.ink },
          headStyles: { fillColor: C.panelDark, textColor: C.ink, fontStyle: 'bold' },
          columnStyles: {
            0: { cellWidth: 90 },
            1: { halign: 'right', cellWidth: 48 },
            2: { halign: 'right', cellWidth: 48 },
          },
          margin: { left: PAGE.left, right: PAGE.right },
        });
        y = (doc as any).lastAutoTable.finalY + 3;

        // ── ADP / CFM / TR summary panel ──
        y = ensureSpace(doc, y, 20, project);
        // RSHF here is the true Room Sensible Heat Factor (room sensible / room
        // total, with safety factors applied) — what engineers expect when they
        // see "RSHF". The m.rshf field actually stores GSHF (coil-level), kept
        // unrenamed for backward compatibility but not used in display.
        const panelRoomTot = m.ersh + m.erlh;
        const panelRSHF = panelRoomTot > 0 ? m.ersh / panelRoomTot : 1;

        const panelCols = [
          // When adpUnreachable, the indicated ADP is below the coil's achievable
          // floor (no real saturation-curve intersection), so flag that it was
          // clamped to the selected ADP. Whether reheat is actually needed is a
          // separate RSHF-based determination — shown in the Reheat row above —
          // so this annotation no longer asserts "reheat req." (avoids contradicting it).
          ['Indicated ADP', m.adpUnreachable ? `${n1(m.indicatedAdp)} °F (below ${n0(m.selectedAdp)} °F coil floor — clamped)` : `${n1(m.indicatedAdp)} °F`],
          ['Selected ADP',  `${n0(m.selectedAdp)} °F`],
          ['RSHF',          n2(panelRSHF)],
          ['Design CFM',    `${n0(m.designCfm)} CFM`],
          ['Governing TR',  `${n2(m.requiredTr)} TR`],
          ...(includeWinter ? [['Winter Load', `${n0(m.designHeatingLoad)} BTU/h`]] : []),
          ...(includeWinter && Number((room as any)?._calcTfaWinterHeatingBTUH) > 0
            ? [['TFA Heat Coil', `${n0(Number((room as any)._calcTfaWinterHeatingBTUH))} BTU/h`]]
            : []),
          // TFA/DOAS split — appended last so the Governing-TR highlight (col 4)
          // stays put. Cooling seasons only; the TFA coil duty is the persisted,
          // season-appropriate engine value (this room's share of the DOAS coil).
          ...(isTfaRoom(room) && !/winter/i.test(seasonLabel)
            ? [
                ['TFA Coil', `${n2((/monsoon/i.test(seasonLabel) ? Number(room._calcMonsoonTfaCoilTR) : Number(room._calcTfaCoilTR)) || m.tfaCoilTr || 0)} TR`],
                ['TFA Airflow', `${n0(Number(room._calcTfaCfm) || m.tfaCfm || 0)} CFM`],
                // Total air the room receives = space (recirc) coil + DOAS treated fresh.
                // Design CFM (above) sizes the coil; this is the combined room airflow.
                // Skip tfa-only rooms (no own coil — Design CFM already is the full supply).
                ...(!m.isTfaOnly
                  ? [['Total Supply', `${n0(m.designCfm + (Number(room._calcTfaCfm) || m.tfaCfm || 0))} CFM`]]
                  : []),
              ]
            : []),
        ];

        autoTable(doc, {
          startY: y,
          body: [panelCols.map((c) => c[0]), panelCols.map((c) => c[1])],
          theme: 'grid',
          styles: { fontSize: 8, cellPadding: 2.2, halign: 'center', textColor: C.ink },
          willDrawCell: (data: any) => {
            if (data.row.index === 0) {
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.fillColor = C.panelDark;
            }
            if (data.row.index === 1) {
              data.cell.styles.fillColor = C.accentBg;
              data.cell.styles.fontStyle = 'bold';
            }
            // Highlight Governing TR column
            if (data.column.index === 4) {
              data.cell.styles.fillColor = C.total;
            }
          },
          margin: { left: PAGE.left, right: PAGE.right },
        });
        y = (doc as any).lastAutoTable.finalY + 3;

        // ── Moisture, Coil & Psychrometric Analysis ──
        y = ensureSpace(doc, y, 55, project);
        y = subBanner(doc, `Moisture, Coil & Psychrometric Analysis  (${seasonLabel})`, y, C);
        y += 1;

        const LHV_PDF  = 1061; // ASHRAE hfg at coil conditions (matches 0.68 constant derivation)
        const BF_PDF   = 0.15;
        const adpPs    = calculatePsychrometrics(m.selectedAdp, 100, dc.altitude);
        const tSup     = m.selectedAdp + BF_PDF * (dc.indoorTemp  - m.selectedAdp);
        const wSup     = adpPs.humidityRatio + BF_PDF * (indoorPsycho.humidityRatio - adpPs.humidityRatio);
        const hSup     = 0.240 * tSup + wSup * (1061 + 0.444 * tSup);
        const dwCoil   = Math.max(0, (indoorPsycho.humidityRatio - wSup) * 7000);
        const moisRate = Math.max(0, m.coilLatent / LHV_PDF);
        const moisAct  = m.coilLatent > 50 ? 'Dehumidify' : m.coilLatent < -50 ? 'Humidify' : 'Balanced';
        // Reheat sizing — based on ROOM SHF (RSHF), not coil/grand SHF (GSHF).
        // Reheat exists to prevent room overcooling, so what matters is whether
        // the room's own sensible:total ratio drops below the comfort threshold
        // (typically 0.75). Using GSHF inflates reheat by including OA + parasitic
        // sensible+latent in the ratio, which would size reheat against the coil's
        // discharge condition rather than the room load — yielding unrealistically
        // large numbers (e.g. ~900k BTU/h for an over-ventilated low-RSHF room).
        const roomTot  = m.ersh + m.erlh;
        const cSHR     = roomTot > 0 ? m.ersh / roomTot : 1;
        const tSHR     = 0.75;
        const needRH   = !isWinter && cSHR < tSHR;
        const rhBTU    = needRH ? Math.max(0, (m.erlh * tSHR) / (1 - tSHR) - m.ersh) : 0;

        autoTable(doc, {
          startY: y,
          head: [['Parameter', 'Outdoor', 'Indoor', 'Supply Air', 'Coil / Notes']],
          body: isWinter ? [
            ['Dry Bulb Temp (°F / °C)',  dualT1(dc.outdoorTemp),                  dualT1(dc.indoorTemp),                  '—', '—'],
            ['Humidity Ratio (gr/lb)',   n1(outdoorPsycho.humidityRatio * 7000), n1(indoorPsycho.humidityRatio * 7000), '—', 'Winter — no coil dehumidification'],
            ['Enthalpy h (BTU/lb)',      n2(outdoorPsycho.enthalpy),             n2(indoorPsycho.enthalpy),              '—', '—'],
          ] : [
            ['Dry Bulb Temp (°F / °C)',  dualT1(dc.outdoorTemp),                  dualT1(dc.indoorTemp),                  dualT1(tSup),       `ADP ${dualTu(m.selectedAdp)}  (Ind. ${dualTu(m.indicatedAdp)})`],
            ['Humidity Ratio (gr/lb)',   n1(outdoorPsycho.humidityRatio * 7000), n1(indoorPsycho.humidityRatio * 7000), n1(wSup * 7000),    `dW coil = ${n1(dwCoil)} gr/lb`],
            // RSHF (room) drives reheat sizing; GSHF (coil incl. OA + parasitic)
            // drives ADP. Show both since they answer different questions.
            ['Enthalpy h (BTU/lb)',      n2(outdoorPsycho.enthalpy),             n2(indoorPsycho.enthalpy),              n2(hSup),           `RSHF = ${n2(cSHR)}  ·  GSHF = ${n2(m.rshf)}`],
            ['Moisture Action',          moisAct,                                 '—',                                    '—',                `Coil condensate = ${moisRate.toFixed(2)} lbs/hr  (= coil latent / 1061 BTU/lb; size drain)`],
            ['Coil Latent (BTU/h)',      '—',                                     '—',                                    '—',                n0(m.coilLatent)],
            [needRH ? 'Reheat  ★ REQD' : 'Reheat', needRH ? `Room SHR ${n2(cSHR)} < ${tSHR}` : `Room SHR = ${n2(cSHR)}`, '—', '—', needRH ? `${n0(rhBTU)} BTU/h required` : 'Not required'],
          ],
          theme: 'grid',
          styles:     { fontSize: 7.5, cellPadding: 1.6, textColor: C.ink },
          headStyles: { fillColor: C.panelDark, textColor: C.ink, fontStyle: 'bold', fontSize: 7.5 },
          columnStyles: {
            0: { fontStyle: 'bold', fillColor: C.panel, cellWidth: 46 },
            1: { halign: 'right', cellWidth: 25 },
            2: { halign: 'right', cellWidth: 25 },
            3: { halign: 'right', cellWidth: 25 },
            4: { cellWidth: 65 },
          },
          willDrawCell: (data: any) => {
            if (!isWinter && data.section === 'body' && data.row.index === 5 && needRH) {
              data.cell.styles.fillColor = C.adpBg;
              data.cell.styles.fontStyle = 'bold';
            }
          },
          margin: { left: PAGE.left, right: PAGE.right },
        });
        y = (doc as any).lastAutoTable.finalY + 4;

        // ── Charts row: Psychrometric chart (left)  +  Load pie chart (right) ──
        const chartRowH = 70;
        y = ensureSpace(doc, y, chartRowH + 4, project);

        const chartY  = y;
        const psychW  = 104;
        const psychX  = PAGE.left;
        const pieW    = 78;
        const pieX    = psychX + psychW + 2;

        // ─ Psychrometric chart ─────────────────────────────────────────────────
        const T_MIN_C = 35, T_MAX_C = 115;
        const W_MAX_C = 220; // gr/lb ceiling for chart
        const pxL = psychX + 18; // left edge of plot area
        const pxT = chartY + 10; // top edge of plot area
        const pxW = psychW - 22; // plot width mm
        const pxH = chartRowH - 18; // plot height mm

        const toSX = (T: number) => pxL + (T - T_MIN_C) / (T_MAX_C - T_MIN_C) * pxW;
        const toSY = (W: number) => pxT + pxH - Math.max(0, Math.min(W, W_MAX_C)) / W_MAX_C * pxH;

        // Chart background & border
        doc.setFillColor(249, 251, 255);
        doc.setDrawColor(...C.line);
        doc.setLineWidth(0.3);
        doc.rect(psychX, chartY, psychW, chartRowH, 'FD');

        // Chart title
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(...C.ink);
        doc.text('Psychrometric Chart', psychX + psychW / 2, chartY + 5, { align: 'center' });

        // Grid lines – temperature
        doc.setDrawColor(218, 226, 238);
        doc.setLineWidth(0.15);
        for (let T = 40; T <= 110; T += 10) {
          const gx = toSX(T);
          doc.line(gx, pxT, gx, pxT + pxH);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(5);
          doc.setTextColor(...C.subInk);
          doc.text(`${T}`, gx, pxT + pxH + 3.5, { align: 'center' });
        }
        // Grid lines – humidity ratio
        for (let W = 0; W <= 200; W += 40) {
          const gy = toSY(W);
          doc.line(pxL, gy, pxL + pxW, gy);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(4.8);
          doc.setTextColor(...C.subInk);
          doc.text(`${W}`, pxL - 1.5, gy + 1.2, { align: 'right' });
        }

        // Axis labels
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5);
        doc.setTextColor(...C.subInk);
        doc.text('DB Temp (°F)', pxL + pxW / 2, pxT + pxH + 7, { align: 'center' });
        doc.text('W (gr/lb)', psychX + 5, pxT + pxH / 2 + 1, { angle: 90, align: 'center' });

        // Plot area border
        doc.setDrawColor(...C.subInk);
        doc.setLineWidth(0.35);
        doc.rect(pxL, pxT, pxW, pxH);

        // Saturation curve
        doc.setDrawColor(20, 90, 190);
        doc.setLineWidth(0.65);
        let prevCx: number | null = null;
        let prevCy: number | null = null;
        for (let T = T_MIN_C; T <= T_MAX_C; T += 1) {
          const ps  = calculatePsychrometrics(T, 100, dc.altitude);
          const Wgr = ps.humidityRatio * 7000;
          if (Wgr > W_MAX_C) { prevCx = null; prevCy = null; continue; }
          const cx2 = toSX(T);
          const cy2 = toSY(Wgr);
          if (prevCx !== null && prevCy !== null) doc.line(prevCx, prevCy, cx2, cy2);
          prevCx = cx2; prevCy = cy2;
        }

        // Saturation label on curve
        const satLabelT = 80;
        const satLabelPs = calculatePsychrometrics(satLabelT, 100, dc.altitude);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(4.8);
        doc.setTextColor(20, 90, 190);
        doc.text('100% RH', toSX(satLabelT) + 1, toSY(satLabelPs.humidityRatio * 7000) - 1.5);

        // Dot + label helper
        const dotPoint = (T: number, Wgr: number, lbl: string, col: [number,number,number], lblAbove = true) => {
          const px2 = toSX(T);
          const py2 = toSY(Wgr);
          doc.setFillColor(...col);
          doc.setDrawColor(255, 255, 255);
          doc.setLineWidth(0.3);
          doc.circle(px2, py2, 1.6, 'FD');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(5.5);
          doc.setTextColor(...col);
          doc.text(lbl, px2, lblAbove ? py2 - 2.8 : py2 + 4.5, { align: 'center' });
        };

        const oWgr  = outdoorPsycho.humidityRatio  * 7000;
        const iWgr  = indoorPsycho.humidityRatio   * 7000;
        const sWgr  = wSup * 7000;
        const adpWgr = adpPs.humidityRatio * 7000;

        if (!isWinter) {
          // Room → ADP line (cooling / dehumidification process)
          doc.setDrawColor(80, 150, 220);
          doc.setLineWidth(0.5);
          doc.line(toSX(dc.indoorTemp), toSY(iWgr), toSX(m.selectedAdp), toSY(adpWgr));
          // OA → RA dashed context line
          doc.setDrawColor(190, 190, 190);
          doc.setLineWidth(0.3);
          // approximate dashed line with short segments
          const segCount = 8;
          for (let i = 0; i < segCount; i++) {
            if (i % 2 === 0) {
              doc.line(
                toSX(dc.outdoorTemp) + (toSX(dc.indoorTemp) - toSX(dc.outdoorTemp)) * i / segCount,
                toSY(oWgr) + (toSY(iWgr) - toSY(oWgr)) * i / segCount,
                toSX(dc.outdoorTemp) + (toSX(dc.indoorTemp) - toSX(dc.outdoorTemp)) * (i + 0.8) / segCount,
                toSY(oWgr) + (toSY(iWgr) - toSY(oWgr)) * (i + 0.8) / segCount,
              );
            }
          }
          dotPoint(dc.outdoorTemp,  oWgr,   'OA',  [210, 55, 55]);
          dotPoint(dc.indoorTemp,   iWgr,   'RA',  [30, 100, 200]);
          dotPoint(tSup,            sWgr,   'SA',  [50, 165, 80]);
          dotPoint(m.selectedAdp,   adpWgr, 'ADP', [130, 50, 200], false);
        } else {
          dotPoint(dc.outdoorTemp, oWgr, 'OA', [80, 120, 200]);
          dotPoint(dc.indoorTemp,  iWgr, 'RA', [30, 100, 200]);
        }

        // Legend key (bottom-left inside chart)
        if (!isWinter) {
          const legData: { lbl: string; col: [number,number,number] }[] = [
            { lbl: 'OA = Outdoor',   col: [210, 55, 55] },
            { lbl: 'RA = Room',      col: [30, 100, 200] },
            { lbl: 'SA = Supply',    col: [50, 165, 80] },
            { lbl: 'ADP = App.Dew', col: [130, 50, 200] },
          ];
          let lky = pxT + pxH + 9;
          legData.forEach((ld) => {
            doc.setFillColor(...ld.col);
            doc.circle(pxL + 2 + legData.indexOf(ld) * 24, lky, 1.2, 'F');
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(4.8);
            doc.setTextColor(...C.subInk);
            doc.text(ld.lbl, pxL + 4.5 + legData.indexOf(ld) * 24, lky + 1);
          });
        }

        // ─ Pie / Donut chart ───────────────────────────────────────────────────
        doc.setFillColor(249, 251, 255);
        doc.setDrawColor(...C.line);
        doc.setLineWidth(0.3);
        doc.rect(pieX, chartY, pieW, chartRowH, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(...C.ink);
        doc.text(isWinter ? 'Winter Heating Summary' : 'Cooling Load Breakdown', pieX + pieW / 2, chartY + 5, { align: 'center' });

        if (!isWinter) {
          const glassLoad   = m.envGlassTrans + m.envGlassSolar;
          const wallLoad    = m.envWalls + m.envRoof + m.envPartitions + m.envFloor;
          const lightLoad   = m.lightsSensible;
          const equipLoad   = m.equipmentSensible + m.othersSensible;
          const peopleLoad  = m.peopleSensible + m.peopleLatent;
          const freshAir    = Math.max(0, m.oaSensible + m.oaLatent);

          type PieSeg = { label: string; value: number; color: [number,number,number] };
          const allSegs: PieSeg[] = [
            { label: 'Glass',       value: glassLoad,  color: [255, 155, 45]  as [number,number,number] },
            { label: 'Walls/Roof',  value: wallLoad,   color: [55,  115, 205] as [number,number,number] },
            { label: 'Lighting',    value: lightLoad,  color: [240, 200, 30]  as [number,number,number] },
            { label: 'Equipment',   value: equipLoad,  color: [155, 75, 215]  as [number,number,number] },
            { label: 'People',      value: peopleLoad, color: [215, 55, 80]   as [number,number,number] },
            { label: 'Fresh Air',   value: freshAir,   color: [45,  170, 110] as [number,number,number] },
            // TFA-served rooms: OA is on the DOAS coil, not the primary — show it separately.
            { label: 'TFA Coil (OA)', value: m.isTFA ? (m.tfaCoilSensible + m.tfaCoilLatent) : 0, color: [20, 160, 160] as [number,number,number] },
          ];
          const segments: PieSeg[] = allSegs.filter((s) => s.value > 1);

          const pieTotal = segments.reduce((acc, s) => acc + s.value, 0);

          if (pieTotal > 0) {
            const cxP  = pieX + 30;
            const cyP  = chartY + chartRowH * 0.50 + 2;
            const rPie = 20;

            // Triangle-fan slice drawing
            const drawSlice = (a1: number, a2: number, col: [number,number,number]) => {
              const steps = Math.max(6, Math.ceil(Math.abs(a2 - a1) / (2 * Math.PI) * 48));
              doc.setFillColor(...col);
              doc.setDrawColor(255, 255, 255);
              doc.setLineWidth(0.3);
              for (let i = 0; i < steps; i++) {
                const aa1 = a1 + (a2 - a1) * i       / steps;
                const aa2 = a1 + (a2 - a1) * (i + 1) / steps;
                doc.triangle(
                  cxP, cyP,
                  cxP + rPie * Math.cos(aa1), cyP + rPie * Math.sin(aa1),
                  cxP + rPie * Math.cos(aa2), cyP + rPie * Math.sin(aa2),
                  'FD',
                );
              }
            };

            let angle = -Math.PI / 2;
            segments.forEach((seg) => {
              const sweep = (seg.value / pieTotal) * 2 * Math.PI;
              drawSlice(angle, angle + sweep, seg.color);
              angle += sweep;
            });

            // White donut hole
            doc.setFillColor(249, 251, 255);
            doc.setDrawColor(249, 251, 255);
            doc.circle(cxP, cyP, rPie * 0.43, 'FD');

            // Center label
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(6);
            doc.setTextColor(...C.ink);
            doc.text(`${n2(m.loadTr)}`, cxP, cyP + 1, { align: 'center' });
            doc.setFontSize(4.5);
            doc.text('TR', cxP, cyP + 4, { align: 'center' });

            // Legend – right side
            const legX2 = pieX + 54;
            let legY2   = chartY + 11;
            segments.forEach((seg) => {
              const pct = ((seg.value / pieTotal) * 100).toFixed(0);
              doc.setFillColor(...seg.color);
              doc.rect(legX2, legY2 - 2, 3.2, 3.2, 'F');
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(5.5);
              doc.setTextColor(...C.ink);
              doc.text(seg.label, legX2 + 5, legY2 + 0.8);
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(5);
              doc.setTextColor(...C.subInk);
              doc.text(`${pct}%  (${n0(seg.value / 1000)}k)`, legX2 + 5, legY2 + 4.2);
              legY2 += 9;
            });
          }
        } else {
          // Winter: simple heating summary card
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(...C.accent);
          doc.text(`${n0(m.designHeatingLoad)}`, pieX + pieW / 2, chartY + chartRowH / 2 + 3, { align: 'center' });
          doc.setFontSize(6);
          doc.setTextColor(...C.subInk);
          doc.text('BTU/h  Design Heating Load', pieX + pieW / 2, chartY + chartRowH / 2 + 8, { align: 'center' });
          doc.setFontSize(6.5);
          doc.setTextColor(...C.ink);
          doc.text(`Outdoor:  ${n0(dc.outdoorTemp)}°F (${fToC(dc.outdoorTemp).toFixed(1)}°C) / ${n0(dc.outdoorHumidity)}% RH`,   pieX + 6, chartY + chartRowH / 2 + 16);
          doc.text(`Indoor:   ${n0(dc.indoorTemp)}°F (${fToC(dc.indoorTemp).toFixed(1)}°C) / ${n0(dc.indoorHumidity)}% RH`,     pieX + 6, chartY + chartRowH / 2 + 22);
        }

        y = chartY + chartRowH + 6;
      };

      // Draw summer room detail
      y = ensureSpace(doc, y, 30, project);
      drawRoomForSeason('Summer', resolveEntityDC(entity, summer, project), C.summerBg);

      // Draw monsoon room detail if applicable
      if (monsoon) {
        y = ensureSpace(doc, y, 30, project);
        drawRoomForSeason('Monsoon', resolveEntityDC(entity, monsoon, project), C.monsoonBg);
      }

      // ── Winter Heating + Humidification detail ───────────────────────────
      if (winter) {
      y = ensureSpace(doc, y, 80, project);
      const winDcRoom = resolveEntityDC(entity, winter, project);
      const wm = computeDetailed(room, envelopeElements[room.id] || [], winDcRoom, project);

      // Section header
      doc.setFillColor(...C.winterBg);
      doc.rect(PAGE.left, y - 3.5, pageW - PAGE.left - PAGE.right, 7.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...C.ink);
      doc.text(`Room: ${String(room.name || '—')}  (${String(room.floor || '—')})  ·  Winter Heating`, PAGE.left + 3, y + 1);
      y += 8;

      // ── Heating load table with safety + pickup ───────────────────────────
      const humRow: string[][] = wm.includeHumidifier && wm.humNeeded
        ? [[wm.isTFA
            ? '+ TFA / DOAS Humidification  (fresh-air moisture — DOAS duty)'
            : '+ Humidification  (fresh-air moisture — space humidifier duty)',
            '—', `${n0(wm.hHumLoad)} BTU/h`]]
        : [];
      const slabRow: string[][] = wm.hSlabRaw > 0
        ? [['Slab-Edge Loss  (F × Perimeter × dT)',   `${n0(wm.hSlabRaw)}`,     `${n0(wm.hSlabSafe)}`]]
        : [];

      autoTable(doc, {
        startY: y,
        head: [['Component', 'Raw (BTU/h)', 'With Safety (BTU/h)']],
        body: [
          ['Transmission Loss  (U × A × dT)',         `${n0(wm.hTransRaw)}`,    `${n0(wm.hTransSafe)}`],
          [wm.isTFA
            ? 'Infiltration Heating  (1.08 × CFM × dT, infiltration ACH — OA on DOAS)'
            : 'OA + Infiltration Heating  (1.08 × FACPH-CFM × dT, no DOAS)',
            `${n0(wm.hVentRaw)}`, `${n0(wm.hVentSafe)}`],
          ...slabRow,
          [`Subtotal  (safety ${wm.heatingSafetyPct.toFixed(0)}% applied)`,   '—', `${n0(wm.heatingSubtotal)}`],
          [`Pickup / Warm-up Allowance  (+${wm.heatingPickupPct.toFixed(0)}%)`, '—', `${n0(wm.designHeatingLoad - wm.heatingSubtotal)}`],
          ['DESIGN HEATING LOAD (Space)',                                        '—', `${n0(wm.designHeatingLoad)} BTU/h`],
          ...(Number((room as any)?._calcTfaWinterHeatingBTUH) > 0
            ? [['+ TFA / DOAS Fresh-Air Heating Coil  (OA temper — DOAS duty)', '—', `${n0(Number((room as any)._calcTfaWinterHeatingBTUH))} BTU/h`]]
            : []),
          ...humRow,
        ],
        theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 2, textColor: C.ink },
        headStyles: { fillColor: C.eco ? C.panel : [30, 90, 180] as [number,number,number], textColor: C.headFg, fontStyle: 'bold', fontSize: 7.5 },
        columnStyles: {
          0: { fontStyle: 'bold', fillColor: C.panel, cellWidth: 85 },
          1: { halign: 'right' as const, cellWidth: 38 },
          2: { halign: 'right' as const },
        },
        willDrawCell: (data: any) => {
          if (data.section === 'body') {
            const lastRow = wm.includeHumidifier && wm.humNeeded ? 5 : 4;
            const pickupRow = lastRow - 1;
            if (data.row.index === lastRow) {
              data.cell.styles.fillColor = C.eco ? C.panel : [30, 90, 180] as [number,number,number];
              data.cell.styles.textColor = C.eco ? C.ink : [255,255,255] as [number,number,number];
              data.cell.styles.fontStyle = 'bold';
            } else if (data.row.index === pickupRow) {
              data.cell.styles.fillColor = C.eco ? C.panel : [255, 248, 220] as [number,number,number];
            } else if (wm.includeHumidifier && wm.humNeeded && data.row.index === 2) {
              data.cell.styles.fillColor = C.eco ? C.panel : [225, 245, 255] as [number,number,number];
            }
          }
        },
        margin: { left: PAGE.left, right: PAGE.right },
      });
      y = (doc as any).lastAutoTable.finalY + 5;

      // ── Humidification analysis ───────────────────────────────────────────
      y = ensureSpace(doc, y, 40, project);
      // When the space settles within comfort (≥30% RH) without a humidifier, humidification is
      // OPTIONAL — only needed to actively hold the (higher) indoor RH target. The figures are
      // shown for reference so the client can decide; they are not a hard requirement.
      const humOptional = wm.humNeeded && wm.humRhAfterHeating >= 30;
      const humLabel = !wm.humNeeded
        ? 'NO HUMIDIFIER NEEDED'
        : (humOptional ? 'HUMIDIFIER OPTIONAL' : 'HUMIDIFIER RECOMMENDED');
      const humLabelColor: [number,number,number] = (!wm.humNeeded || humOptional) ? [20, 130, 70] : [200, 120, 0];

      doc.setFillColor(235, 248, 255);
      doc.rect(PAGE.left, y - 2.5, pageW - PAGE.left - PAGE.right, 7, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...C.ink);
      doc.text('Winter Humidification Analysis', PAGE.left + 3, y + 1.5);
      doc.setTextColor(...humLabelColor);
      doc.text(humLabel, pageW - PAGE.right - 3, y + 1.5, { align: 'right' });
      y += 8;

      const humBody: string[][] = [
        ['Outdoor Air',  `${dualTu(winDcRoom.outdoorTemp)} / ${winDcRoom.outdoorHumidity}% RH`, `W = ${wm.humWOutGr.toFixed(1)} gr/lb`],
        ['Indoor Target', `${dualTu(winDcRoom.indoorTemp)} / ${winDcRoom.indoorHumidity}% RH`, `W = ${wm.humWInGr.toFixed(1)} gr/lb`],
        ['Moisture Deficit dW', `${wm.humDeltaWGr.toFixed(1)} gr/lb`, wm.humNeeded ? (humOptional ? 'Only to actively hold the target RH' : 'Humidification needed') : 'Sufficient — no humidifier'],
        ['RH after heating (no humidifier)', `${wm.humRhAfterHeating}%`, wm.humRhAfterHeating < 30 ? '⚠ Below ASHRAE 55 min (30%)' : '✓ Within comfort range'],
      ];
      if (humOptional) {
        humBody.push(['Design Basis', `No humidifier — space settles at ~${wm.humRhAfterHeating}% RH`, 'Within comfort. Figures below size a humidifier only IF the target RH must be held.']);
      }
      if (wm.humNeeded) {
        humBody.push(
          ['Fresh Air CFM (ventilation)', `${Math.round(wm.humFreshCFM)} CFM`, 'Only fresh air needs moisture'],
          [`Humidifier Output${humOptional ? ' (optional)' : ''} — to hold ${winDcRoom.indoorHumidity}% RH (+10% margin)`, `${wm.humRate.toFixed(2)} lbs/hr`, `Base: ${wm.humRateBase.toFixed(2)} lbs/hr.  If an adiabatic / evaporative humidifier (wetted media, spray, ultrasonic) is used, add ${n0(wm.humEnergyBTU)} BTU/h to the DESIGN HEATING LOAD (Space) — the coil must offset the evaporative cooling. Steam / isothermal type: separate electrical load, not added.`],
          [`Energy Penalty${humOptional ? ' (if humidified)' : ''}`, `${n0(wm.humEnergyBTU)} BTU/h`, `${wm.humEnergyKW.toFixed(2)} kW`],
          ['ASHRAE 62.1-2022 §5.9 Cap', `Indoor W = ${wm.humWInGr.toFixed(1)} gr/lb`, wm.humExceedsCap62 ? '⚠ Exceeds 87 gr/lb cap' : '✓ Within 87 gr/lb limit'],
        );
      }

      autoTable(doc, {
        startY: y,
        body: humBody,
        theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 2, textColor: C.ink },
        columnStyles: {
          0: { fontStyle: 'bold', fillColor: C.panel, cellWidth: 68 },
          1: { cellWidth: 40 },
          2: {},
        },
        willDrawCell: (data: any) => {
          if (data.section === 'body' && wm.humNeeded) {
            const lastIdx = humBody.length - 1;
            if (data.row.index === lastIdx && wm.humExceedsCap62 && data.column.index === 2) {
              data.cell.styles.textColor = [180, 100, 0] as [number,number,number];
              data.cell.styles.fontStyle = 'bold';
            }
          }
          if (data.section === 'body' && data.row.index === 3 && wm.humRhAfterHeating < 30 && data.column.index === 2) {
            data.cell.styles.textColor = [180, 50, 50] as [number,number,number];
            data.cell.styles.fontStyle = 'bold';
          }
        },
        margin: { left: PAGE.left, right: PAGE.right },
      });
      y = (doc as any).lastAutoTable.finalY + 4;

      // Designer's Note (Indoor Target Review) was previously rendered here for
      // warm/humid winter indoor targets, but it has been moved to the standalone
      // "Engineering Review" PDF (internal QA only). The client load-calculation
      // submission must not contain auto-generated designer commentary.
      y += 4;
      } // end if (winter)
    }
  }

  // ═══ DESIGN NOTES & ASSUMPTIONS ══════════════════════════════════════════
  {
    const projNotes = String(project?.notes ?? project?.data?.notes ?? '').trim();
    const sysWithNotes = effectiveEquipSystems.filter((s: any) => String(s.notes ?? '').trim());
    if (projNotes || sysWithNotes.length > 0) {
      y = startBody(doc, project);
      y = sectionBanner(doc, 'DESIGN NOTES & ASSUMPTIONS', y, C);
      y += 5;
      if (projNotes) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
        doc.text('Project Notes', PAGE.left, y); y += 5;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.subInk);
        const noteLines = doc.splitTextToSize(projNotes, pageW - PAGE.left - PAGE.right);
        doc.text(noteLines, PAGE.left, y); y += (noteLines.length * 4.5) + 6;
      }
      for (const sys of sysWithNotes) {
        const sysNotes = String(sys.notes ?? '').trim();
        y = ensureSpace(doc, y, 20, project);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...C.ink);
        doc.text(`${String(sys.name ?? sys.id)}  ·  ${String(sys.type ?? '')}`, PAGE.left, y); y += 5;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...C.subInk);
        const sysLines = doc.splitTextToSize(sysNotes, pageW - PAGE.left - PAGE.right);
        doc.text(sysLines, PAGE.left, y); y += (sysLines.length * 4.5) + 8;
      }
    }
  }

  // ═══ Stamp headers/footers on all body pages ══════════════════════════════

  const totalPages = doc.getNumberOfPages();
  for (let p = 2; p <= totalPages; p++) {
    doc.setPage(p);
    drawHeader(doc, project, p - 1, totalPages - 1, C);
    drawFooter(doc, C);
  }

  const fileName = `${reportFileTag()}${String(project?.name || 'HVAC_Report').replace(/[^a-zA-Z0-9_]/g, '_')}_Load_Report.pdf`;
  doc.save(fileName);
};

// ─── EQUIPMENT SCHEDULE PDF (standalone) ─────────────────────────────────────

const renderEquipmentScheduleBody = (
  doc: jsPDF,
  equipSystems: any[],
  flatRooms: any[],
  project: any,
  C: Theme,
  startY?: number,
) => {
  const eqHead = ['Zone / Room', 'Equipment', 'Brand', 'Model / Series', 'Sub-type', 'TR (Rated)', 'CFM (Rated)', 'Qty'];
  // Show only the human-readable model series; never expose raw Firestore doc IDs
  const ms = (item: any) => String(item?.modelSeries || item?.model || '—').trim() || '—';
  // Defaults match DEFAULT_AHU_CONFIG in EquipmentSelection.tsx
  const AHU_DEFAULTS = {
    fanCurve: 'backward-curved', fanDrive: 'belt-driven', extStaticPa: 150,
    hasMixingBox: true, coolingCoilRows: 6, heatingCoilRows: 2, hasHeatingCoil: false,
    filters: { pre: true, fine: true, hepa: false },
    preFilterGrade: 'G4 (EU4 / MERV-8)', fineFilterGrade: 'F7 (EU7 / MERV-13)', hepaFilterGrade: 'H14',
  };
  let y = startY ?? PAGE.top + 4;

  // ── System deduplication ─────────────────────────────────────────────────────
  // Step 1: deduplicate by Firestore document ID (exact duplicates)
  const seenSysIds = new Set<string>();
  const idDeduped = equipSystems.filter((s: any) => {
    if (seenSysIds.has(s.id)) return false;
    seenSysIds.add(s.id);
    return true;
  });

  // Step 2: deduplicate stale documents that share the same type+name (created during
  // modifications when the old document was never deleted).  Keep the most recently
  // updated document for each type+name pair — that is the user's current setup.
  const systemNameKey = (s: any) =>
    `${String(s.type || '')}|${String(s.name || s.id).toLowerCase().trim()}`;
  const nameGroupMap = new Map<string, any[]>();
  idDeduped.forEach((s: any) => {
    const k = systemNameKey(s);
    if (!nameGroupMap.has(k)) nameGroupMap.set(k, []);
    nameGroupMap.get(k)!.push(s);
  });
  const dedupedSystems = Array.from(nameGroupMap.values()).map(group => {
    if (group.length === 1) return group[0];
    // Multiple docs with the same type+name → keep the most recently updated one
    return group.reduce((best: any, s: any) => {
      const tBest = best.updatedAt?.seconds ?? (best.updatedAt?.toMillis ? best.updatedAt.toMillis() / 1000 : 0);
      const tS    = s.updatedAt?.seconds    ?? (s.updatedAt?.toMillis    ? s.updatedAt.toMillis()    / 1000 : 0);
      return tS > tBest ? s : best;
    }, group[0]);
  });

  // Step 3: for Chiller systems — if ANY Chiller document uses the zone-based data path
  // (chillerUnits[] + zones[].selection), treat any other Chiller document that uses ONLY
  // the legacy unitSelection/ctSelection path (no zones with equipment) as stale and skip it.
  // This handles the "IGLOO 1" vs "Chiller Plant" pattern where the user migrated to zones
  // but the old legacy document was never deleted from Firestore.
  const hasZoneBasedChiller = dedupedSystems.some((s: any) =>
    String(s.type) === 'Chiller' &&
    (s.zones ?? []).some((z: any) => z.selection || (z.unitSelections ?? []).length > 0)
  );
  const finalSystems = hasZoneBasedChiller
    ? dedupedSystems.filter((s: any) => {
        if (String(s.type) !== 'Chiller') return true;
        const hasZones = (s.zones ?? []).some((z: any) => z.selection || (z.unitSelections ?? []).length > 0);
        if (hasZones) return true;
        // Legacy-only Chiller: has unitSelection or chillerUnits but NO zones with equipment
        const isLegacyOnly = !!(s.unitSelection || (s.chillerUnits ?? []).length > 0);
        return !isLegacyOnly; // skip legacy-only when a zone-based Chiller exists
      })
    : dedupedSystems;

  for (const sys of finalSystems) {
    const sysType  = String(sys.type  || '—');
    const sysName  = String(sys.name  || `System ${sys.id}`);
    const sysBrand = String(sys.brand || '—');
    // ── Zone deduplication ────────────────────────────────────────────────────
    // Step 1: deduplicate by zone ID
    const seenZoneIds = new Set<string>();
    const idDedupedZones: any[] = ((sys.zones ?? []) as any[]).filter((z: any) => {
      if (!z.id || seenZoneIds.has(z.id)) return false;
      seenZoneIds.add(z.id);
      return true;
    });

    // Step 2: sort zones newest-first (zone IDs embed a Date.now() timestamp: "zone-1234567890")
    // so that when room-coverage filtering runs, the latest zone wins over stale old zones.
    const zoneTimestamp = (z: any): number =>
      parseInt(String(z.id ?? '').replace(/^[a-z]+-/, ''), 10) || 0;
    idDedupedZones.sort((a: any, b: any) => zoneTimestamp(b) - zoneTimestamp(a));

    // Step 3: room-coverage filter — skip any zone whose rooms are ALL already claimed by
    // a newer zone.  This removes orphaned zones left when a zone was deleted and re-created.
    const claimedRoomIds = new Set<string>();
    const dedupedZones: any[] = idDedupedZones.filter((z: any) => {
      const rIds: string[] = z.roomIds ?? [];
      const hasEquip = !!(z.selection || (z.unitSelections ?? []).length > 0);
      if (!hasEquip) return false; // skip zones with no equipment at all
      if (rIds.length === 0) return true; // empty-room zones: keep if they have equipment
      const allClaimed = rIds.every(rid => claimedRoomIds.has(rid));
      if (allClaimed) return false; // stale zone — all its rooms moved to a newer zone
      rIds.forEach(rid => claimedRoomIds.add(rid));
      return true;
    });
    const eqBody: any[][] = [];

    if (sysType === 'VRF' && sys.oduSelection) {
      const odu = sys.oduSelection;
      const instTR = odu.effectiveTR ?? ((odu.trCapacity ?? 0) * (odu.modules ?? 1));
      eqBody.push([sysName, 'ODU', String(odu.brand || sysBrand),
        ms(odu),
        String(odu.compressorType || '—'), n2(instTR), '—', odu.modules ? `×${odu.modules} mod` : '1']);
      const df = sys.diversityFactor;
      if (df && df !== 1) {
        let connTR = 0;
        dedupedZones.forEach((z: any) => {
          if (z.unitSelections?.length) connTR += (z.unitSelections as any[]).reduce((s: number, u: any) => s + (u.trCapacity ?? 0) * (u.quantity ?? 1), 0);
          else if (z.selection) connTR += (z.selection.trCapacity ?? 0) * (z.selection.quantity ?? 1);
        });
        if (sys.iduSelections) Object.values(sys.iduSelections as Record<string, any>).forEach((val: any) => { (Array.isArray(val) ? val : val ? [val] : []).forEach((u: any) => { connTR += (u.trCapacity ?? 0) * (u.quantity ?? 1); }); });
        const note = connTR > 0
          ? `  Diversity Factor: ${(df * 100).toFixed(0)}%  ·  Total Connected IDU: ${n2(connTR)} TR  ->  Effective Required: ${n2(connTR * df)} TR`
          : `  Diversity Factor: ${(df * 100).toFixed(0)}%`;
        eqBody.push([{ content: note, colSpan: 8, styles: { fontStyle: 'italic' as const, fontSize: 7, textColor: C.subInk } }]);
      }
    }
    if (sysType === 'Chiller') {
      const units: any[] = sys.chillerUnits?.length ? sys.chillerUnits : (sys.unitSelection ? [{ ...sys.unitSelection, quantity: sys.unitSelection.quantity ?? 1 }] : []);
      let anyActualOverride = false;
      units.forEach((u: any) => {
        const roleLabel = u.role === 'standby' ? 'Standby' : (u.role === 'working' ? 'Working (Duty)' : '—');
        const hasActual = u.actualTR != null && u.actualTR > 0;
        if (hasActual) anyActualOverride = true;
        // Show "Actual / Nominal" when overridden, else just the catalog value (which the
        // user has confirmed equals Actual). PDF column is "TR (Actual / Nominal)".
        const trCell = hasActual ? `${n2(u.actualTR)} / ${n2(u.trCapacity ?? 0)}` : n2(u.trCapacity ?? 0);
        eqBody.push([sysName, 'Chiller', String(u.brand || sysBrand),
          ms(u), roleLabel, trCell, '—', String(u.quantity ?? 1)]);
      });
      if (anyActualOverride) {
        eqBody.push([{
          content: '  TR = minimum required Actual at site conditions (OEM to confirm in technical proposal) / Catalog Nominal at AHRI 550/590. Plant sizing uses Actual.',
          colSpan: 8,
          styles: { fontStyle: 'italic' as const, fontSize: 7, textColor: C.subInk }
        }]);
      }
      // Diversity note — chiller plant sizing accounts for non-simultaneous zone peaks.
      // Σ Connected = sum of zone AHU/FCU TR; Effective Plant Required = Σ × diversity.
      const cdf = sys.diversityFactor;
      if (cdf && cdf !== 1) {
        let connTR = 0;
        dedupedZones.forEach((z: any) => {
          if (z.unitSelections?.length) connTR += (z.unitSelections as any[]).reduce((s: number, u: any) => s + (u.trCapacity ?? 0) * (u.quantity ?? 1), 0);
          else if (z.selection) connTR += (z.selection.trCapacity ?? 0) * (z.selection.quantity ?? 1);
        });
        const note = connTR > 0
          ? `  Diversity Factor: ${(cdf * 100).toFixed(0)}%  ·  Sum Connected AHU / FCU: ${n2(connTR)} TR  ->  Effective Plant Required: ${n2(connTR * cdf)} TR`
          : `  Diversity Factor: ${(cdf * 100).toFixed(0)}%  (applied to sum of zone peak loads for plant sizing)`;
        eqBody.push([{ content: note, colSpan: 8, styles: { fontStyle: 'italic' as const, fontSize: 7, textColor: C.subInk } }]);
      }
      const ctUnits: any[] = sys.ctUnits?.length ? sys.ctUnits : (sys.ctSelection ? [{ ...sys.ctSelection, quantity: sys.ctSelection.quantity ?? 1 }] : []);
      ctUnits.forEach((ct: any) => {
        const ctRoleLabel = ct.role === 'standby' ? 'Standby' : (ct.role === 'working' ? 'Working (Duty)' : '—');
        eqBody.push([sysName, 'Cooling Tower', String(ct.brand || sysBrand),
          ms(ct), ctRoleLabel, n2(ct.trCapacity ?? 0), '—', String(ct.quantity ?? 1)]);
      });
    }
    if (sysType === 'AHU' && sys.unitSelection) {
      const u = sys.unitSelection;
      eqBody.push([sysName, 'DX Condensing Unit', String(u.brand || sysBrand),
        ms(u), String(u.subType || '—'), n2(u.trCapacity ?? 0), '—', String(u.quantity ?? 1)]);
    }
    if (sysType === 'DOAS' && sys.unitSelection) {
      const u = sys.unitSelection;
      const oaNote = String(u.subType || 'ERV/HRV/FAHU');
      eqBody.push([sysName, 'TFA/DOAS Unit', String(u.brand || sysBrand),
        ms(u),
        oaNote, n2(u.trCapacity ?? 0), n0(u.cfmRated ?? 0), String(u.quantity ?? 1)]);
      const linked: string[] = (sys as any).doasLinkedSystemIds ?? [];
      if (linked.length > 0) {
        const linkedNames = linked.map((id: string) => equipSystems.find((s: any) => s.id === id)?.name ?? id).join(', ');
        eqBody.push([{ content: `  Supplements: ${linkedNames}  ·  OA-only ventilation system`, colSpan: 8, styles: { fontStyle: 'italic' as const, fontSize: 7, textColor: C.subInk } }]);
      }
    }
    if ((sysType === 'Package' || sysType === 'DuctableSplit') && sys.unitSelection) {
      const u = sys.unitSelection;
      eqBody.push([sysName, sysType, String(u.brand || sysBrand),
        ms(u), String(u.subType || '—'), n2(u.trCapacity ?? 0), n0(u.cfmRated ?? 0), String(u.quantity ?? 1)]);
    }

    // Zone-level IDUs / AHUs / FCUs — show the AHU's catalog-rated TR and CFM
    // (as selected from the Global Equipment Library / custom catalog), matching
    // the in-app Summary's Equipment Schedule.
    dedupedZones.forEach((zone: any) => {
      const zoneName = String(zone.name || `Zone ${zone.id}`);
      const unitSels = (zone.unitSelections ?? []) as any[];
      if (unitSels.length > 0) {
        unitSels.forEach((u: any) => {
          const lbl = sysType === 'Chiller' ? 'FCU' : sysType === 'AHU' ? 'AHU-DX' : 'IDU';
          const qty = u.quantity ?? 1;
          eqBody.push([zoneName, lbl, String(u.brand || sysBrand), ms(u), String(u.subType || '—'), n2(u.trCapacity ?? 0), n0(u.cfmRated ?? 0), String(qty)]);
        });
      } else if (zone.selection) {
        const sel = zone.selection;
        const lbl = sysType === 'Chiller' ? 'FCU / AHU' : sysType === 'AHU' ? 'AHU-DX' : 'IDU';
        const qty = sel.quantity ?? 1;
        eqBody.push([zoneName, lbl, String(sel.brand || sysBrand), ms(sel), String(sel.subType || '—'), n2(sel.trCapacity ?? 0), n0(sel.cfmRated ?? 0), String(qty)]);
        // Multi-AHU same-spec zone: annotate so engineers reading the BOM know it's
        // not a typo and that each AHU has its own duct.
        if (qty > 1) {
          const totalTR  = (sel.trCapacity ?? 0) * qty;
          const totalCFM = (sel.cfmRated ?? 0) * qty;
          eqBody.push([{
            content: `  ↳ Multi-AHU zone — ${qty} × same-spec, each with own dedicated duct. Total: ${n2(totalTR)} TR · ${n0(totalCFM)} CFM`,
            colSpan: 8,
            styles: { fontStyle: 'italic' as const, fontSize: 6.5, textColor: C.subInk, fillColor: C.panel as [number,number,number] },
          }]);
        }
      }
    });

    // FAHU accessories (humidifier + electric heater) — mirrors the in-app
    // Summary's Equipment Schedule so the PDF lists Rapidcool / steam / electric
    // humidifiers and reheat coils as discrete BOM lines with brand + model.
    // Capacity (kg/hr for humidifier, kW for heater) goes in the rate-style column
    // so engineers scanning the BOM see the numeric value, not just dashes.
    dedupedZones.forEach((zone: any) => {
      const fahu: any = zone.fahu ?? {};
      const zoneName = String(zone.name || `Zone ${zone.id}`);
      const ahuQty = Number(zone.selection?.quantity ?? 1) || 1;
      if (fahu.hasElectricHeater && (fahu.electricHeaterKW ?? 0) > 0) {
        eqBody.push([
          zoneName,
          'Electric Heater',
          'Electric',
          'Reheat Coil',
          'Reheat',
          '—',
          `${fahu.electricHeaterKW} kW`,
          String(ahuQty),
        ]);
      }
      if (fahu.hasHumidifier && (fahu.humidifierKgHr ?? 0) > 0) {
        const hmModel = String(fahu.humidifierModel ?? '');
        const humBrand = hmModel ? hmModel.split(' ')[0] : 'Steam/Electric';
        const humModelStr = hmModel
          ? hmModel.split(' ').slice(1).join(' ')
          : 'Humidifier';
        eqBody.push([
          zoneName,
          'Humidifier',
          humBrand,
          humModelStr,
          String(fahu.humidifierSubType || 'Humidification'),
          '—',
          `${fahu.humidifierKgHr} kg/hr`,
          String(ahuQty),
        ]);
      }
    });

    // Per-room iduSelections — VRF and AHU only.
    // Chiller is a zone-based system; per-room iduSelections are legacy orphaned data, suppressed here.
    if (sys.iduSelections && (sysType === 'VRF' || sysType === 'AHU')) {
      const zoneCovered = new Set<string>();
      dedupedZones.forEach((z: any) => {
        if (z.selection || z.unitSelections?.length) (z.roomIds as string[] ?? []).forEach((rid: string) => zoneCovered.add(rid));
      });
      Object.entries(sys.iduSelections as Record<string, any>).forEach(([roomId, val]) => {
        if (zoneCovered.has(roomId)) return;
        const units: any[] = Array.isArray(val) ? val : (val ? [val] : []);
        units.forEach((u: any) => {
          if (!u || (u.trCapacity ?? 0) === 0) return;
          const roomObj = flatRooms.find((r: any) => r.id === roomId);
          const lbl = sysType === 'AHU' ? 'AHU-DX' : 'IDU';
          eqBody.push([String(roomObj?.name ?? roomObj?.roomName ?? roomId), lbl, String(u.brand || sysBrand), ms(u), String(u.subType || '—'), n2(u.trCapacity ?? 0), n0(u.cfmRated ?? 0), String(u.quantity ?? 1)]);
        });
      });
    }
    if (sysType === 'Split' && sys.roomSelections) {
      Object.entries(sys.roomSelections as Record<string, any>).forEach(([rId, idus]: [string, any]) => {
        (idus as any[]).forEach((u: any) => eqBody.push([String(rId), 'Split IDU', String(u.brand || sysBrand), ms(u), String(u.subType || '—'), n2(u.trCapacity ?? 0), n0(u.cfmRated ?? 0), String(u.quantity ?? 1)]));
      });
    }
    // Skip systems with no equipment — avoids ghost/placeholder system blocks in the PDF
    if (eqBody.length === 0) continue;

    y = ensureSpace(doc, y, 16 + eqBody.length * 7, project);
    const w = doc.internal.pageSize.getWidth();
    doc.setFillColor(...C.panelDark);
    doc.rect(PAGE.left, y - 3, w - PAGE.left - PAGE.right, 7, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...C.ink);
    doc.text(sysName, PAGE.left + 3, y + 1.2);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...C.subInk);
    doc.text(`System Type: ${sysType}  ·  Brand: ${sysBrand}`, w - PAGE.right - 3, y + 1.2, { align: 'right' });
    y += 7;

    autoTable(doc, {
      startY: y, head: [eqHead], body: eqBody, theme: 'grid',
      styles:     { fontSize: 7.5, cellPadding: 2, textColor: C.ink },
      headStyles: { fillColor: C.accent, textColor: C.headFg, fontStyle: 'bold', fontSize: 7 },
      columnStyles: {
        0: { cellWidth: 30, fontStyle: 'bold' }, 1: { cellWidth: 24 }, 2: { cellWidth: 18 },
        3: { cellWidth: 44 }, 4: { cellWidth: 22 },
        5: { cellWidth: 16, halign: 'right' as const, fontStyle: 'bold' },
        6: { cellWidth: 16, halign: 'right' as const },
        7: { cellWidth: 12, halign: 'center' as const },
      },
      margin: { left: PAGE.left, right: PAGE.right },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // ── AHU Configuration Schedule — shown when the system has AHU-capable zones with equipment ──
    const ahuZones = dedupedZones.filter((z: any) => {
      const hasEquip = z.selection || z.unitSelections?.length;
      const isAhuType = sysType === 'Chiller' || sysType === 'AHU' ||
        ['ductable-low', 'ductable-mid', 'ductable-hi', 'AHU-DX', 'AHU', 'TFA'].includes(z.selection?.subType ?? '');
      return hasEquip && isAhuType;
    });
    if (ahuZones.length > 0) {
      const ahuRows: any[][] = [];
      let hasMultiAhuZone = false;
      ahuZones.forEach((zone: any) => {
        const cfg: any = { ...AHU_DEFAULTS, ...(sys as any).ahuConfig, ...zone.ahuConfig };
        const zoneName = String(zone.name || `Zone ${zone.id}`);
        const ahuQty = Number(zone.selection?.quantity ?? 1) || 1;
        if (ahuQty > 1) hasMultiAhuZone = true;
        const fanWheel = cfg.fanCurve === 'forward-curved' ? 'Fwd Curved' : cfg.fanCurve === 'backward-curved' ? 'Bwd Curved' : '—';
        const drive    = cfg.fanDrive === 'plug-fan' ? 'Plug Fan' : cfg.fanDrive === 'belt-driven' ? 'Belt' : '—';
        const esp      = cfg.extStaticPa != null ? `${cfg.extStaticPa} Pa` : '—';
        const mixBox   = cfg.hasMixingBox === false ? 'No' : 'Yes';
        const coilRows = `${cfg.coolingCoilRows ?? 6}R cooling` + (cfg.hasHeatingCoil ? ` + ${cfg.heatingCoilRows ?? 2}R htg` : '');
        const filters: string[] = [];
        if (cfg.filters?.pre)  filters.push(String(cfg.preFilterGrade  || 'Pre'));
        if (cfg.filters?.fine) filters.push(String(cfg.fineFilterGrade || 'Fine'));
        if (cfg.filters?.hepa) filters.push(String(cfg.hepaFilterGrade || 'HEPA'));
        const filtration = filters.length ? filters.join(' + ') : 'None';
        const fahu: any = zone.fahu ?? {};
        // BOM-correct: each AHU has its own physical accessories. If zone uses qty=N AHUs,
        // the total is N × the per-unit value.
        const heater = fahu.hasElectricHeater
          ? (ahuQty > 1
              ? `${ahuQty} × ${fahu.electricHeaterKW ?? '—'} kW`
              : `${fahu.electricHeaterKW ?? '—'} kW`)
          : '—';
        const humidifier = fahu.hasHumidifier
          ? (ahuQty > 1
              ? `${ahuQty} × ${fahu.humidifierKgHr ?? '—'} kg/hr`
              : `${fahu.humidifierKgHr ?? '—'} kg/hr`)
          : '—';
        const qtyLabel = ahuQty > 1 ? `${ahuQty}×` : '1';
        ahuRows.push([zoneName, qtyLabel, fanWheel, drive, esp, mixBox, coilRows, filtration, heater, humidifier]);
      });
      if (ahuRows.length > 0) {
        y = ensureSpace(doc, y, 14 + ahuRows.length * 6 + (hasMultiAhuZone ? 6 : 0), project);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...C.subInk);
        doc.text('AHU CONFIGURATION', PAGE.left, y);
        y += 3;
        autoTable(doc, {
          startY: y,
          head: [['Zone', 'Qty', 'Fan Wheel', 'Drive', 'ESP', 'Mixing Box', 'Coil', 'Filtration', 'Heater', 'Humidifier']],
          body: ahuRows, theme: 'grid',
          styles:     { fontSize: 7, cellPadding: 1.8, textColor: C.ink },
          headStyles: { fillColor: C.panelDark as [number,number,number], textColor: C.ink as [number,number,number], fontStyle: 'bold', fontSize: 6.5 },
          columnStyles: {
            0: { cellWidth: 26, fontStyle: 'bold' },
            1: { cellWidth: 10, halign: 'center' as const, fontStyle: 'bold' },
            2: { cellWidth: 16 }, 3: { cellWidth: 12 },
            4: { cellWidth: 12, halign: 'right' as const }, 5: { cellWidth: 14, halign: 'center' as const },
            6: { cellWidth: 22 }, 7: { cellWidth: 'auto' as const },
            8: { cellWidth: 16, halign: 'right' as const },
            9: { cellWidth: 18, halign: 'right' as const },
          },
          margin: { left: PAGE.left, right: PAGE.right },
        });
        y = (doc as any).lastAutoTable.finalY + 2;
        if (hasMultiAhuZone) {
          doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5); doc.setTextColor(...C.subInk);
          doc.text(
            'Note: Multi-AHU zones use same-spec AHUs with their own dedicated duct each. Accessories listed as "N × value" represent the per-zone total (each AHU has its own physical heater/humidifier).',
            PAGE.left, y + 2, { maxWidth: doc.internal.pageSize.getWidth() - PAGE.left - PAGE.right },
          );
          y += 6;
        }
        y += 4;
      }
    }
  }
};

export const generateEquipmentSchedulePDF = (
  project: any,
  equipSystems: any[],
  rooms: Record<string, any[]>,
  hvacHierarchy?: HvacHierarchyData,
  eco = false,
) => {
  const C = makeTheme(eco);
  const effectiveEquipSystems = hvacHierarchy && equipSystems.length === 0
    ? hvacHierarchy.systems : equipSystems;
  if (effectiveEquipSystems.length === 0) return;
  buildReportStamp(project);

  const flatRooms = Object.values(hvacHierarchy ? hvacHierarchy.rooms : rooms).flat();

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  // ── Cover strip ──────────────────────────────────────────────────────────
  if (C.eco) {
    // Eco: just a bottom separator line, no filled band.
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.5);
    doc.line(PAGE.left, 42, pageW - PAGE.right, 42);
  } else {
    doc.setFillColor(...C.accent);
    doc.rect(0, 0, pageW, 42, 'F');
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...C.grandFg);
  doc.text('INSTALLED EQUIPMENT', PAGE.left, 18);
  doc.text('SCHEDULE', PAGE.left, 30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...C.coverText);
  doc.text(`${String(project?.name || 'Project')}  ·  ${reportStamp.dateShort}`, PAGE.left, 38);

  // ── Project info table ────────────────────────────────────────────────────
  let y = 52;
  autoTable(doc, {
    startY: y,
    body: [
      ['Project Name', String(project?.name || '—')],
      ['Location',     String(project?.location || project?.place || '—')],
      ['System Type',  String(project?.systemType || '—')],
    ],
    theme: 'grid',
    styles:       { fontSize: 8.5, cellPadding: 2.2, textColor: C.ink },
    columnStyles: { 0: { fontStyle: 'bold', fillColor: C.panel, cellWidth: 48 } },
    margin: { left: PAGE.left, right: PAGE.right },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // ── Section banner ────────────────────────────────────────────────────────
  y = sectionBanner(doc, 'INSTALLED EQUIPMENT SCHEDULE', y, C);
  y += 4;

  // Chiller-sizing convention note (only when at least one chiller has an Actual TR override)
  if (hasAnyChillerActualOverride(effectiveEquipSystems)) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.subInk);
    const noteLines = doc.splitTextToSize(
      'Chiller TR column reads as "Actual / Nominal". Actual = our minimum required capacity at this project\'s site ' +
      'conditions (entering CW/air temp, LCW temp, altitude, fouling) — OEM to confirm in technical proposal — and ' +
      'governs plant sizing. Nominal = catalog rating at AHRI 550/590 standard conditions, shown for reference only.',
      pageW - PAGE.left - PAGE.right
    );
    doc.text(noteLines, PAGE.left, y);
    y += noteLines.length * 3.6 + 3;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.ink);
  }

  renderEquipmentScheduleBody(doc, effectiveEquipSystems, flatRooms, project, C, y);

  // ── Headers / footers ────────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    if (p > 1) drawHeader(doc, project, p - 1, totalPages - 1, C);
    drawFooter(doc, C);
  }

  const fileName = `${reportFileTag()}${String(project?.name || 'Equipment').replace(/[^a-zA-Z0-9_]/g, '_')}_Equipment_Schedule.pdf`;
  doc.save(fileName);
};

// ─── ENGINEERING REVIEW PDF (standalone — internal QA, not for client submission) ─

export const generateEngineeringReviewPDF = (
  project: any,
  systems: any[],
  zones: any[],
  rooms: Record<string, any[]>,
  envelopeElementsMap: Record<string, any[]>,
  equipSystems: any[] = [],
  hvacHierarchy?: HvacHierarchyData,
  eco = false,
) => {
  const C = makeTheme(eco);
  const effectiveSystems     = hvacHierarchy ? hvacHierarchy.systems : systems;
  const effectiveZones       = hvacHierarchy ? Object.values(hvacHierarchy.zonesBySystem).flat() : zones;
  const effectiveRooms       = hvacHierarchy ? hvacHierarchy.rooms : rooms;
  const effectiveEquipSystems = hvacHierarchy && equipSystems.length === 0 ? hvacHierarchy.systems : equipSystems;
  reportEquipSystems = effectiveEquipSystems ?? [];
  buildReportStamp(project);

  const seasons = getSeasonProfiles(project);
  const summer  = seasons.find((s) => s.key === 'summer')!;
  const winter  = seasons.find((s) => s.key === 'winter');
  const entities = buildEntityRecords(project, effectiveSystems, effectiveZones, effectiveRooms, effectiveEquipSystems);

  const findings = buildEngineeringReview(
    project, entities, envelopeElementsMap, effectiveEquipSystems, summer, winter,
  );

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  // ── Cover strip ──────────────────────────────────────────────────────────
  if (C.eco) {
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.5);
    doc.line(PAGE.left, 42, pageW - PAGE.right, 42);
  } else {
    doc.setFillColor(...C.accent);
    doc.rect(0, 0, pageW, 42, 'F');
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...C.grandFg);
  doc.text('ENGINEERING REVIEW', PAGE.left, 18);
  doc.text('& RECOMMENDATIONS', PAGE.left, 30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...C.coverText);
  doc.text(
    `${String(project?.name || 'Project')}  ·  ${reportStamp.dateShort}`,
    PAGE.left, 38,
  );

  // ── Project info table ───────────────────────────────────────────────────
  let y = 52;
  autoTable(doc, {
    startY: y,
    body: [
      ['Project Name',  String(project?.name     || '—')],
      ['Location',      String(project?.location || project?.place || '—')],
      ['System Type',   String(project?.systemType || '—')],
      ['Findings',      `${findings.length} item(s) detected`],
    ],
    theme: 'grid',
    styles:       { fontSize: 8.5, cellPadding: 2.2, textColor: C.ink },
    columnStyles: { 0: { fontStyle: 'bold', fillColor: C.panel, cellWidth: 48 } },
    margin: { left: PAGE.left, right: PAGE.right },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // ── Internal-use disclaimer ──────────────────────────────────────────────
  doc.setFillColor(255, 248, 220);
  doc.setDrawColor(200, 150, 30);
  doc.setLineWidth(0.25);
  const discLines = doc.splitTextToSize(
    'INTERNAL USE — design QA review. Not part of the client load-calculation submission. Use these findings to verify project inputs and resolve issues before issuing the official report for procurement.',
    pageW - PAGE.left - PAGE.right - 6,
  );
  const discH = (discLines.length * 3.4) + 5;
  doc.rect(PAGE.left, y, pageW - PAGE.left - PAGE.right, discH, 'FD');
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 80, 0);
  doc.text(discLines, PAGE.left + 3, y + 3.5);
  y += discH + 4;

  // Empty-state message
  if (findings.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...C.ink);
    doc.text('No design findings detected — all checks passed.', PAGE.left, y + 8);
  } else {
    // Render findings on a fresh body page so the cover stays clean.
    renderEngineeringReview(doc, findings, project, C, pageW);
  }

  // ── Headers / footers ────────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    if (p > 1) drawHeader(doc, project, p - 1, totalPages - 1, C);
    drawFooter(doc, C);
  }

  const fileName = `${reportFileTag()}${String(project?.name || 'Project').replace(/[^a-zA-Z0-9_]/g, '_')}_Engineering_Review.pdf`;
  doc.save(fileName);
};
