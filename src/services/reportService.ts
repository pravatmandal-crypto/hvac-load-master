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
  getRecommendedAch,
  calculateSingleElementGain,
} from '../lib/hvac-logic';

// ─── Types ────────────────────────────────────────────────────────────────────

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
  // Coil parameters
  indicatedAdp: number;
  selectedAdp: number;
  rshf: number;
  // Heating with safety factors (populated for winter DC calls)
  heatingSafetyPct: number;
  heatingPickupPct: number;
  hTransRaw: number;
  hVentRaw: number;
  hTransSafe: number;
  hVentSafe: number;
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

const C = {
  ink:       [15,  35,  60]  as [number,number,number],
  subInk:    [75,  90, 110]  as [number,number,number],
  line:      [190, 200, 215] as [number,number,number],
  panel:     [240, 244, 250] as [number,number,number],
  panelDark: [210, 220, 235] as [number,number,number],
  accent:    [15,  80, 160]  as [number,number,number],
  accentBg:  [230, 240, 255] as [number,number,number],
  total:     [220, 235, 255] as [number,number,number],
  grandBg:   [15,  80, 160]  as [number,number,number],
  grandFg:   [255, 255, 255] as [number,number,number],
  summerBg:  [255, 245, 230] as [number,number,number],
  winterBg:  [230, 245, 255] as [number,number,number],
  monsoonBg: [230, 255, 245] as [number,number,number],
};

const PAGE = { left: 12, right: 12, top: 20, bottom: 16 };

const getMinAdp = (systemType?: string): number => {
  const st = String(systemType || '').toLowerCase();
  if (st === 'chiller') return 44;
  if (st === 'vrf' || st === 'hybrid') return 42;
  return 44;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const asNum = (v: any, fb: number) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };
const n0  = (v: number) => Math.round(v).toLocaleString();
const n1  = (v: number) => v.toFixed(1);
const n2  = (v: number) => v.toFixed(2);
const n4  = (v: number) => v.toFixed(4);
const dash = (v: number) => v > 0 ? n0(v) : '-';

// ─── Header / Footer ─────────────────────────────────────────────────────────

const drawHeader = (doc: jsPDF, project: any, pageNo: number, totalPages: number) => {
  const w = doc.internal.pageSize.getWidth();
  // Blue top bar
  doc.setFillColor(...C.accent);
  doc.rect(0, 0, w, 10, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text(String(project?.name || 'PROJECT').toUpperCase(), PAGE.left, 6.5);
  doc.setFont('helvetica', 'normal');
  doc.text('HVAC LOAD CALCULATION REPORT', w / 2, 6.5, { align: 'center' });
  doc.text(`Page ${pageNo} of ${totalPages}`, w - PAGE.right, 6.5, { align: 'right' });
};

const drawFooter = (doc: jsPDF) => {
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
  doc.text(new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), w - PAGE.right, h - PAGE.bottom + 6, { align: 'right' });
};

const sectionBanner = (doc: jsPDF, text: string, y: number) => {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(...C.accent);
  doc.rect(PAGE.left, y - 4, w - PAGE.left - PAGE.right, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.text(text, PAGE.left + 3, y + 0.8);
  return y + 7;
};

const subBanner = (doc: jsPDF, text: string, y: number) => {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(...C.panelDark);
  doc.rect(PAGE.left, y - 3.5, w - PAGE.left - PAGE.right, 6.5, 'F');
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

  profiles.push({
    key: 'winter',
    label: 'Winter',
    outdoorTemp:     asNum(project?.winterDesignTemp     ?? project?.data?.winterDesignTemp,     40),
    outdoorHumidity: asNum(project?.winterDesignHumidity ?? project?.data?.winterDesignHumidity, 30),
    indoorTemp:      asNum(project?.insideWinterTemp     ?? project?.data?.insideWinterTemp,     70),
    indoorHumidity:  asNum(project?.insideWinterHumidity ?? project?.data?.insideWinterHumidity, 40),
  });

  return profiles;
};

const buildEntityRecords = (project: any, systems: any[], zones: any[], rooms: Record<string, any[]>): EntityRecord[] => {
  if (project?.systemType === 'VRF') {
    return systems.map((sys: any) => ({
      id: sys.id, type: 'System', name: sys.name || `System ${sys.id}`,
      indoorTemp: sys.indoorTemp, indoorHumidity: sys.indoorHumidity,
      outdoorTemp: sys.outdoorTemp, outdoorHumidity: sys.outdoorHumidity,
      winterIndoorTemp: sys.winterIndoorTemp, winterIndoorHumidity: sys.winterIndoorHumidity,
      rooms: rooms[sys.id] || [],
    }));
  }
  return zones.map((zone: any) => {
    const parent = systems.find((s: any) => s.id === zone.systemId);
    return {
      id: zone.id, type: 'Zone', name: zone.name || `Zone ${zone.id}`,
      parentSystem: parent?.name,
      indoorTemp: zone.indoorTemp, indoorHumidity: zone.indoorHumidity,
      outdoorTemp: zone.outdoorTemp, outdoorHumidity: zone.outdoorHumidity,
      winterIndoorTemp: zone.winterIndoorTemp, winterIndoorHumidity: zone.winterIndoorHumidity,
      rooms: rooms[zone.id] || [],
    };
  });
};

const resolveEntityDC = (entity: EntityRecord, season: SeasonProfile, project: any): DC => {
  const alt = asNum(project?.altitude ?? project?.data?.altitude, 0);
  if (season.key === 'winter') {
    const wT  = asNum(project?.winterDesignTemp     ?? project?.data?.winterDesignTemp,     season.outdoorTemp);
    const wRH = asNum(project?.winterDesignHumidity ?? project?.data?.winterDesignHumidity, season.outdoorHumidity);
    return { outdoorTemp: wT, outdoorHumidity: wRH, indoorTemp: season.indoorTemp, indoorHumidity: season.indoorHumidity, altitude: alt, winterOutdoorTemp: wT, winterOutdoorHumidity: wRH };
  }
  return {
    outdoorTemp:     asNum(entity.outdoorTemp,     season.outdoorTemp),
    outdoorHumidity: asNum(entity.outdoorHumidity, season.outdoorHumidity),
    indoorTemp:      asNum(entity.indoorTemp,      season.indoorTemp),
    indoorHumidity:  asNum(entity.indoorHumidity,  season.indoorHumidity),
    altitude: alt,
    winterOutdoorTemp:     asNum(project?.winterDesignTemp     ?? project?.data?.winterDesignTemp,     40),
    winterOutdoorHumidity: asNum(project?.winterDesignHumidity ?? project?.data?.winterDesignHumidity, 30),
  };
};

const computeDetailed = (room: any, elements: any[], dc: DC, project: any): DetailedMetrics => {
  const BF        = 0.15;
  const sSafetyPct = asNum(room?.sensibleSafetyPercent ?? room?.sensibleSafetyFactor, 10);
  const lSafetyPct = asNum(room?.latentSafetyPercent   ?? room?.latentSafetyFactor,   5);
  const oSafetyPct = asNum(room?.overallSafetyPercent  ?? room?.grandTotalSafetyFactor, 3);
  const ductPct   = asNum(room?.ductGainPct, 2);
  const fanPct    = asNum(room?.fanGainPct,  3);

  const envelope  = calculateEnvelopeGain(elements, dc);
  const internal  = calculateInternalGains(room);
  const vent      = calculateVentilationLoad(room, dc);
  const heating   = calculateHeatingLoad(room, elements, dc);

  const area = asNum(room?.length, 0) * asNum(room?.width, 0);
  const faCfm = (calculateRoomVolume(room) * asNum(room?.facph, 0)) / 60;

  const erSensibleRaw = envelope.sensible + internal.sensible + vent.sensible * BF;
  const erLatentRaw   = internal.latent   + vent.latent   * BF;
  const parasitic     = calculateParasiticGains(erSensibleRaw, erSensibleRaw, ductPct, fanPct);
  const ersh          = (erSensibleRaw + parasitic.ductGain + parasitic.fanGain) * (1 + sSafetyPct / 100);
  const erlh          = erLatentRaw * (1 + lSafetyPct / 100);
  const erh           = ersh + erlh;
  const oaSensible    = vent.sensible * (1 - BF);
  const oaLatent      = vent.latent   * (1 - BF);
  const coilSensible  = ersh + oaSensible;
  const coilLatent    = erlh + oaLatent;
  const grandTotal    = erh + oaSensible + oaLatent;
  const loadTr        = grandTotal / 12000;

  const coil = calculateCoilParameters(coilSensible, coilLatent, dc.indoorTemp, dc.indoorHumidity, dc.altitude, BF, 35, 65, getMinAdp(project?.systemType));

  const totalAch     = Math.max(getRecommendedAch(room?.achProfile ?? room?.activityType), asNum(room?.facph, 0));
  const totalSupplyCfm = (calculateRoomVolume(room) * totalAch) / 60;
  const designCfm    = Math.max(coil.dehumidifiedCFM, totalSupplyCfm);
  // 400 CFM/Ton: ASHRAE minimum for adequate dehumidification (accounts for sensible + latent)
  const cfmTr        = designCfm / 400;
  const governingTr  = Math.max(loadTr, cfmTr);
  const requiredTr   = governingTr * (1 + oSafetyPct / 100);

  // ── Heating safety + humidification (used when called with winter DC) ──────
  const heatingSafetyPct  = asNum(room?.heatingSafetyPercent, 10);
  const heatingPickupPct  = asNum(room?.heatingPickupPercent, 15);
  const includeHumidifier = Boolean(room?.includeHumidifier ?? false);

  const hTransRaw  = heating.transmissionLoss;
  const hVentRaw   = heating.ventilationHeating;
  const hTransSafe = hTransRaw * (1 + heatingSafetyPct / 100);
  const hVentSafe  = hVentRaw  * (1 + heatingSafetyPct / 100);

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
  const heatingSubtotal   = hTransSafe + hVentSafe + hHumLoad;
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
    indicatedAdp: coil.indicatedADP,
    selectedAdp:  coil.selectedADP,
    rshf:         coil.rshf,
    // Heating with safety
    heatingSafetyPct, heatingPickupPct, includeHumidifier,
    hTransRaw, hVentRaw, hTransSafe, hVentSafe,
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

const startBody = (doc: jsPDF, project: any) => {
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

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export const generatePDFReport = (
  project: any,
  systems: any[],
  zones: any[],
  rooms: Record<string, any[]>,
  envelopeElements: Record<string, any[]>,
) => {
  const doc      = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW    = doc.internal.pageSize.getWidth();
  const pageH    = doc.internal.pageSize.getHeight();
  const seasons  = getSeasonProfiles(project);
  const entities = buildEntityRecords(project, systems, zones, rooms);
  const includeMonsoon = seasons.some((s) => s.key === 'monsoon');
  const summer  = seasons.find((s) => s.key === 'summer')!;
  const monsoon = seasons.find((s) => s.key === 'monsoon');
  const winter  = seasons.find((s) => s.key === 'winter')!;

  const alt  = asNum(project?.altitude  ?? project?.data?.altitude,  0);
  const lat  = asNum(project?.latitude  ?? project?.data?.latitude,  0);
  const lon  = asNum(project?.longitude ?? project?.data?.longitude, 0);

  // ═══ COVER PAGE ═══════════════════════════════════════════════════════════

  // Blue top band
  doc.setFillColor(...C.accent);
  doc.rect(0, 0, pageW, 52, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text('HVAC LOAD CALCULATION', PAGE.left, 22);
  doc.text('REPORT', PAGE.left, 32);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(200, 220, 255);
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
      ['Design Basis',   includeMonsoon ? 'Summer + Monsoon + Winter' : 'Summer + Winter'],
      ['Report Date',    new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })],
      ['Prepared By',    'HVAC Load Master – Automated Calculation Engine'],
    ],
    theme: 'grid',
    styles: { fontSize: 9.5, cellPadding: 3.5, textColor: C.ink },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: C.panel, cellWidth: 48 },
      1: { cellWidth: 125 },
    },
    margin: { left: PAGE.left, right: PAGE.right },
  });

  drawFooter(doc);

  // ═══ PAGE 2: DESIGN CONDITIONS + EXECUTIVE SUMMARY ════════════════════════

  let y = startBody(doc, project);

  // --- Section 1: Design Conditions ---
  y = sectionBanner(doc, '1.  PROJECT DESIGN CONDITIONS', y);
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
    ['  Dry Bulb (°F)',             ...seasonPsycho.map((sp) => n0(sp.season.outdoorTemp))],
    ['  Relative Humidity (%)',     ...seasonPsycho.map((sp) => n0(sp.season.outdoorHumidity))],
    ['  Humidity Ratio (lb/lb)',    ...seasonPsycho.map((sp) => n4(sp.outdoor.humidityRatio))],
    ['  Enthalpy (BTU/lb dry air)', ...seasonPsycho.map((sp) => n2(sp.outdoor.enthalpy))],
    ['INDOOR (Design Space)', ...seasons.map(() => '')],
    ['  Dry Bulb (°F)',             ...seasonPsycho.map((sp) => n0(sp.season.indoorTemp))],
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
  y = sectionBanner(doc, '2.  PROJECT EXECUTIVE SUMMARY', y);
  y += 2;

  // Compute project totals per season
  const projectSeasonTotals = seasons.map((season) => {
    let cooling = 0; let cfm = 0; let heating = 0; let govTr = 0;
    entities.forEach((entity) => {
      const dc = resolveEntityDC(entity, season, project);
      entity.rooms.forEach((room) => {
        const m = computeDetailed(room, envelopeElements[room.id] || [], dc, project);
        cooling  += m.grandTotal;
        cfm      += m.designCfm;
        heating  += m.designHeatingLoad;   // use safety+pickup adjusted load
        govTr    += m.governingTr;
      });
    });
    const loadTr = cooling / 12000;
    const cfmTr  = cfm / 400;
    // Use sum of per-room governingTr (not re-computed from aggregates) for correct mixed-room sizing
    return { season: season.label, key: season.key, loadTr, cfm, cfmTr, heating, governingTr: govTr };
  });

  const coolingSeasonsOnly = projectSeasonTotals.filter(s => s.key !== 'winter');
  const peakSeason = coolingSeasonsOnly.reduce((a, b) => b.governingTr > a.governingTr ? b : a);
  const recTR  = peakSeason.governingTr;
  // CFM must come from the same peak cooling season — winter CFM is inflated by heating ventilation loads
  const recCFM = peakSeason.cfm;
  const allRooms = entities.flatMap((e) => e.rooms);

  // Stats panel
  autoTable(doc, {
    startY: y,
    body: [
      ['Total Systems',             n0(systems.length)],
      ['Total Zones',               n0(zones.length)],
      ['Total Rooms',               n0(allRooms.length)],
      ['Peak Governing Season',     `${peakSeason.season}  (${n2(peakSeason.governingTr)} TR  ·  ${n0(peakSeason.cfm)} CFM)`],
      ['Recommended Submission Basis', `${n2(recTR)} TR  and  ${n0(recCFM)} CFM`],
    ],
    theme: 'grid',
    styles:       { fontSize: 9, cellPadding: 2.8, textColor: C.ink },
    columnStyles: { 0: { fontStyle: 'bold', fillColor: C.panel, cellWidth: 75 }, 1: {} },
    willDrawCell: (data: any) => {
      if (data.section === 'body' && data.row.index === 4) {
        data.cell.styles.fillColor = C.total;
        data.cell.styles.fontStyle = 'bold';
      }
    },
    margin: { left: PAGE.left, right: PAGE.right },
  });
  y = (doc as any).lastAutoTable.finalY + 5;

  // Season summary table
  const sumHead = ['Season', 'Load TR', 'CFM TR', 'Governing TR', 'Design CFM', 'Winter Heat BTU/h'];
  const sumBody = projectSeasonTotals.map((s) => [
    s.season,
    s.key === 'winter' ? '—' : n2(s.loadTr),
    s.key === 'winter' ? '—' : n2(s.cfmTr),
    s.key === 'winter' ? '—' : n2(s.governingTr),
    s.key === 'winter' ? '—' : n0(s.cfm),
    s.key === 'winter' ? n0(s.heating) : '—',
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
  y = sectionBanner(doc, '3.  SYSTEM / ZONE SUMMARY SCHEDULE', y);
  y += 2;

  const summaryHead = includeMonsoon
    ? ['Type', 'Parent System', 'Entity Name', 'Rooms', 'Summer TR', 'Monsoon TR', 'Design CFM', 'Winter Heat BTU/h', 'Governing TR']
    : ['Type', 'Parent System', 'Entity Name', 'Rooms', 'Summer TR', 'Design CFM', 'Winter Heat BTU/h', 'Governing TR'];

  const summaryBody = entities.map((entity) => {
    const sumDc  = resolveEntityDC(entity, summer,  project);
    const monDc  = monsoon ? resolveEntityDC(entity, monsoon, project) : null;
    const winDc  = resolveEntityDC(entity, winter,  project);
    let sumTr = 0, sumCfm = 0, monTr = 0, monCfm = 0, winHeat = 0;
    entity.rooms.forEach((room) => {
      const sm = computeDetailed(room, envelopeElements[room.id] || [], sumDc, project);
      sumTr  += sm.governingTr; sumCfm += sm.designCfm;
      if (monDc) {
        const mm = computeDetailed(room, envelopeElements[room.id] || [], monDc, project);
        monTr += mm.governingTr; monCfm += mm.designCfm;
      }
      winHeat += computeDetailed(room, envelopeElements[room.id] || [], winDc, project).designHeatingLoad;
    });
    const govTr = Math.max(sumTr, monTr);
    const govCfm = Math.max(sumCfm, monCfm);
    const row = [entity.type, entity.parentSystem || '—', entity.name, n0(entity.rooms.length), n2(sumTr)];
    if (includeMonsoon) row.push(n2(monTr));
    row.push(n0(govCfm), n0(winHeat), n2(govTr));
    return row;
  });

  autoTable(doc, {
    startY: y,
    head: [summaryHead],
    body: summaryBody,
    theme: 'grid',
    styles:     { fontSize: 7.5, cellPadding: 2, textColor: C.ink },
    headStyles: { fillColor: C.panelDark, textColor: C.ink, fontStyle: 'bold' },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 14 },
      2: { fontStyle: 'bold', cellWidth: includeMonsoon ? 28 : 35 },
    },
    margin: { left: PAGE.left, right: PAGE.right },
  });

  // ═══ SECTIONS 4+: ENTITY DETAIL ═══════════════════════════════════════════

  for (const entity of entities) {
    y = startBody(doc, project);
    y = sectionBanner(doc, `4.  ${entity.type.toUpperCase()} DETAIL  —  ${String(entity.name || '').toUpperCase()}`, y);
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
    y = subBanner(doc, 'Room Schedule', y);
    y += 1;

    const rscHead = includeMonsoon
      ? ['Room', 'Floor', 'Area ft²', 'Summer TR', 'Monsoon TR', 'Design CFM', 'Winter BTU/h', 'Gov TR']
      : ['Room', 'Floor', 'Area ft²', 'Summer TR', 'Design CFM', 'Winter BTU/h', 'Gov TR'];

    const sumDcE = resolveEntityDC(entity, summer, project);
    const monDcE = monsoon ? resolveEntityDC(entity, monsoon, project) : null;
    const winDcE = resolveEntityDC(entity, winter, project);

    const rscBody = entity.rooms.map((room: any) => {
      const sm = computeDetailed(room, envelopeElements[room.id] || [], sumDcE, project);
      const mm = monDcE ? computeDetailed(room, envelopeElements[room.id] || [], monDcE, project) : null;
      const wm = computeDetailed(room, envelopeElements[room.id] || [], winDcE, project);
      const row = [
        room.name || '—',
        room.floor || '—',
        n0(sm.area),
        n2(sm.governingTr),
      ];
      if (includeMonsoon) row.push(n2(mm?.governingTr ?? 0));
      row.push(n0(Math.max(sm.designCfm, mm?.designCfm ?? 0)), n0(wm.designHeatingLoad), n2(Math.max(sm.governingTr, mm?.governingTr ?? 0)));
      return row;
    });

    autoTable(doc, {
      startY: y,
      head: [rscHead],
      body: rscBody,
      theme: 'grid',
      styles:     { fontSize: 7.5, cellPadding: 1.8, textColor: C.ink },
      headStyles: { fillColor: C.panelDark, textColor: C.ink, fontStyle: 'bold' },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 32 } },
      margin: { left: PAGE.left, right: PAGE.right },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

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
            ['Lighting / Equip / Others',  `${asNum(room.lightsWattsPerSqft, 0)} W/ft²  /  ${asNum(room.equipmentKW, 0)} kW  /  ${asNum(room.othersKW, 0)} kW`, 'ACH / Total Supply CFM', `${n1(m.totalAch)} ACH  /  ${n0(m.totalSupplyCfm)} CFM`],
          ],
          theme: 'grid',
          styles: { fontSize: 7.5, cellPadding: 1.8, textColor: C.ink },
          columnStyles: {
            0: { fontStyle: 'bold', fillColor: C.panel, cellWidth: 44 },
            1: { cellWidth: 52 },
            2: { fontStyle: 'bold', fillColor: C.panel, cellWidth: 42 },
            3: { cellWidth: 44 },
          },
          margin: { left: PAGE.left, right: PAGE.right },
        });
        y = (doc as any).lastAutoTable.finalY + 3;

        // ── Envelope elements table ──
        if (elems.length > 0) {
          y = ensureSpace(doc, y, 30, project);
          y = subBanner(doc, `Envelope Elements  (${seasonLabel})`, y);
          y += 1;

          const envRows = elems.map((el: any) => {
            const gain = calculateSingleElementGain(el, dc);
            return [
              String(el.type || '—'),
              String(el.description || el.wallTypeId || '—'),
              String(el.orientation || '—'),
              n0(asNum(el.area, 0)),
              asNum(el.uValue, 0).toFixed(3),
              isWinter ? '—' : n2(asNum(el.solarFactor, 0)),
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
        y = subBanner(doc, `Cooling Load Breakdown  (${seasonLabel})`, y);
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
          // OA
          [{ content: 'OUTDOOR AIR (unbypassed coil load)', colSpan: 3, styles: { fontStyle: 'bold', fillColor: C.accentBg, textColor: C.ink } }],
          ['  OA Sensible',        n0(m.oaSensible), '—'],
          ['  OA Latent',          '—',              n0(m.oaLatent)],
          // Coil
          [{ content: 'COIL LOADS', colSpan: 3, styles: { fontStyle: 'bold', fillColor: C.accentBg, textColor: C.ink } }],
          ['  Coil Sensible',      n0(m.coilSensible),  '—'],
          ['  Coil Latent',        '—',                 n0(m.coilLatent)],
          [{ content: `  GRAND TOTAL   =   ${n0(m.grandTotal)} BTU/h   (${n2(m.loadTr)} TR)`, colSpan: 3, styles: { fontStyle: 'bold', fillColor: C.grandBg, textColor: C.grandFg, fontSize: 8.5 } }],
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
            1: { halign: 'right', cellWidth: 40 },
            2: { halign: 'right', cellWidth: 40 },
          },
          margin: { left: PAGE.left, right: PAGE.right },
        });
        y = (doc as any).lastAutoTable.finalY + 3;

        // ── ADP / CFM / TR summary panel ──
        y = ensureSpace(doc, y, 20, project);
        const panelCols = [
          ['Indicated ADP', `${n1(m.indicatedAdp)} °F`],
          ['Selected ADP',  `${n0(m.selectedAdp)} °F`],
          ['RSHF',          n2(m.rshf)],
          ['Design CFM',    `${n0(m.designCfm)} CFM`],
          ['Governing TR',  `${n2(m.governingTr)} TR`],
          ['Winter Load',   `${n0(m.designHeatingLoad)} BTU/h`],
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
        y = subBanner(doc, `Moisture, Coil & Psychrometric Analysis  (${seasonLabel})`, y);
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
        const coilTot  = m.coilSensible + m.coilLatent;
        const cSHR     = coilTot > 0 ? m.coilSensible / coilTot : 1;
        const tSHR     = 0.75;
        const needRH   = !isWinter && cSHR < tSHR;
        const rhBTU    = needRH ? Math.max(0, (m.coilLatent * tSHR) / (1 - tSHR) - m.coilSensible) : 0;

        autoTable(doc, {
          startY: y,
          head: [['Parameter', 'Outdoor', 'Indoor', 'Supply Air', 'Coil / Notes']],
          body: isWinter ? [
            ['Dry Bulb Temp (°F)',       n1(dc.outdoorTemp),                      n1(dc.indoorTemp),                      '—', '—'],
            ['Humidity Ratio (gr/lb)',   n1(outdoorPsycho.humidityRatio * 7000), n1(indoorPsycho.humidityRatio * 7000), '—', 'Winter — no coil dehumidification'],
            ['Enthalpy h (BTU/lb)',      n2(outdoorPsycho.enthalpy),             n2(indoorPsycho.enthalpy),              '—', '—'],
          ] : [
            ['Dry Bulb Temp (°F)',       n1(dc.outdoorTemp),                      n1(dc.indoorTemp),                      n1(tSup),           `ADP ${n0(m.selectedAdp)} °F  (Ind. ${n1(m.indicatedAdp)} °F)`],
            ['Humidity Ratio (gr/lb)',   n1(outdoorPsycho.humidityRatio * 7000), n1(indoorPsycho.humidityRatio * 7000), n1(wSup * 7000),    `ΔW coil = ${n1(dwCoil)} gr/lb`],
            ['Enthalpy h (BTU/lb)',      n2(outdoorPsycho.enthalpy),             n2(indoorPsycho.enthalpy),              n2(hSup),           `RSHF = ${n2(m.rshf)}`],
            ['Moisture Action',          moisAct,                                 '—',                                    '—',                `Rate = ${moisRate.toFixed(2)} lbs/hr`],
            ['Coil Latent (BTU/h)',      '—',                                     '—',                                    '—',                n0(m.coilLatent)],
            [needRH ? 'Reheat  ★ REQD' : 'Reheat', needRH ? `SHR ${n2(cSHR)} < ${tSHR}` : `SHR = ${n2(cSHR)}`, '—', '—', needRH ? `${n0(rhBTU)} BTU/h required` : 'Not required'],
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
              data.cell.styles.fillColor = [255, 238, 210];
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
          doc.text(`Outdoor:  ${n0(dc.outdoorTemp)} °F / ${n0(dc.outdoorHumidity)}%`,   pieX + 6, chartY + chartRowH / 2 + 16);
          doc.text(`Indoor:   ${n0(dc.indoorTemp)} °F / ${n0(dc.indoorHumidity)}%`,     pieX + 6, chartY + chartRowH / 2 + 22);
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
        ? [['Humidifier Energy  (ṁ × h_fg)', `—`, `${n0(wm.hHumLoad)} BTU/h`]]
        : [];

      autoTable(doc, {
        startY: y,
        head: [['Component', 'Raw (BTU/h)', 'With Safety (BTU/h)']],
        body: [
          ['Transmission Loss  (U × A × ΔT)',         `${n0(wm.hTransRaw)}`,    `${n0(wm.hTransSafe)}`],
          ['Ventilation Heating  (1.08 × CFM × ΔT)',  `${n0(wm.hVentRaw)}`,     `${n0(wm.hVentSafe)}`],
          ...humRow,
          [`Subtotal  (safety ${wm.heatingSafetyPct.toFixed(0)}% applied)`,   '—', `${n0(wm.heatingSubtotal)}`],
          [`Pickup / Warm-up Allowance  (+${wm.heatingPickupPct.toFixed(0)}%)`, '—', `${n0(wm.designHeatingLoad - wm.heatingSubtotal)}`],
          ['DESIGN HEATING LOAD',                                                '—', `${n0(wm.designHeatingLoad)} BTU/h`],
        ],
        theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 2, textColor: C.ink },
        headStyles: { fillColor: [30, 90, 180] as [number,number,number], textColor: [255,255,255] as [number,number,number], fontStyle: 'bold', fontSize: 7.5 },
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
              data.cell.styles.fillColor = [30, 90, 180] as [number,number,number];
              data.cell.styles.textColor = [255,255,255] as [number,number,number];
              data.cell.styles.fontStyle = 'bold';
            } else if (data.row.index === pickupRow) {
              data.cell.styles.fillColor = [255, 248, 220] as [number,number,number];
            } else if (wm.includeHumidifier && wm.humNeeded && data.row.index === 2) {
              data.cell.styles.fillColor = [225, 245, 255] as [number,number,number];
            }
          }
        },
        margin: { left: PAGE.left, right: PAGE.right },
      });
      y = (doc as any).lastAutoTable.finalY + 5;

      // ── Humidification analysis ───────────────────────────────────────────
      y = ensureSpace(doc, y, 40, project);
      const humLabel = wm.humNeeded ? 'HUMIDIFIER REQUIRED' : 'NO HUMIDIFIER NEEDED';
      const humLabelColor: [number,number,number] = wm.humNeeded ? [0, 100, 180] : [20, 130, 70];

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
        ['Outdoor Air',  `${winDcRoom.outdoorTemp}°F / ${winDcRoom.outdoorHumidity}% RH`, `W = ${wm.humWOutGr.toFixed(1)} gr/lb`],
        ['Indoor Target', `${winDcRoom.indoorTemp}°F / ${winDcRoom.indoorHumidity}% RH`, `W = ${wm.humWInGr.toFixed(1)} gr/lb`],
        ['Moisture Deficit ΔW', `${wm.humDeltaWGr.toFixed(1)} gr/lb`, wm.humNeeded ? 'Humidification needed' : 'Sufficient — no humidifier'],
        ['RH after heating (no humidifier)', `${wm.humRhAfterHeating}%`, wm.humRhAfterHeating < 30 ? '⚠ Below ASHRAE 55 min (30%)' : '✓ Within comfort range'],
      ];
      if (wm.humNeeded) {
        humBody.push(
          ['Fresh Air CFM (ventilation)', `${Math.round(wm.humFreshCFM)} CFM`, 'Only fresh air needs moisture'],
          ['Humidifier Output (incl. 10% margin)', `${wm.humRate.toFixed(2)} lbs/hr`, `Base: ${wm.humRateBase.toFixed(2)} lbs/hr`],
          ['Energy Penalty', `${n0(wm.humEnergyBTU)} BTU/h`, `${wm.humEnergyKW.toFixed(2)} kW`],
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
      y = (doc as any).lastAutoTable.finalY + 8;
    }
  }

  // ═══ Stamp headers/footers on all body pages ══════════════════════════════

  const totalPages = doc.getNumberOfPages();
  for (let p = 2; p <= totalPages; p++) {
    doc.setPage(p);
    drawHeader(doc, project, p - 1, totalPages - 1);
    drawFooter(doc);
  }

  const fileName = `${String(project?.name || 'HVAC_Report').replace(/[^a-zA-Z0-9_]/g, '_')}_Load_Report.pdf`;
  doc.save(fileName);
};
