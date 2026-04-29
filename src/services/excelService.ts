// Utility to safely handle missing/undefined values for Excel export
const safeValue = (val: any, fallback: string = 'N/A') => (val === undefined || val === null || val === '' ? fallback : val);
import * as XLSX from 'xlsx';
import {
  calculateCoilParameters,
  calculateEnvelopeGain,
  calculateHeatingLoad,
  calculateInternalGains,
  calculateParasiticGains,
  calculatePsychrometrics,
  calculateRoomArea,
  calculateRoomVolume,
  calculateVentilationLoad,
  getRecommendedAch,
  type DesignConditions,
  type EnvelopeElement,
} from '../lib/hvac';

type SeasonKey = 'summer' | 'monsoon';

type SeasonResult = {
  area: number;
  volume: number;
  ventCfm: number;
  ventSensible: number;
  ventLatent: number;
  internalSensible: number;
  internalLatent: number;
  envelopeSensible: number;
  envelopeLatent: number;
  ductGain: number;
  fanGain: number;
  ersh: number;
  erlh: number;
  coilSensible: number;
  coilLatent: number;
  grandTotal: number;
  totalTR: number;
  totalSupplyCFM: number;
  designSupplyCFM: number;
  heatingLoad: number;
};

type RoomRecord = {
  room: any;
  zoneId: string;
  zoneName: string;
  systemName: string;
  sheetName: string;
  elements: EnvelopeElement[];
  zoneOrSystem: any;
  summer: SeasonResult;
  monsoon?: SeasonResult;
  winterHeatingLoad: number;
  winterEnvelopeSensible?: number;
  winterInternalSensible?: number;
  winterVentSensible?: number;
};

type RoomSheetRefs = {
  sheetName: string;
  zoneName: string;
  systemName: string;
  roomName: string;
  floorName: string;
  areaCell: string;
  heightCell: string;
  falseCeilingCell: string;
  freshAirCell: string;
  occupancyCell: string;
  electricalCell: string;
  summerTrCell: string;
  summerCfmCell: string;
  monsoonTrCell?: string;
  monsoonCfmCell?: string;
  winterLoadCell: string;
  governingTrCell: string;
  iduConfigCell: string;
};

const BF = 0.15;
const ORIENTATIONS: Array<'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'> = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const asNumber = (value: any, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sanitizeSheetName = (name: string) =>
  name
    .replace(/[\\/?*\[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const makeUniqueSheetName = (preferred: string, used: Set<string>) => {
  const base = sanitizeSheetName(preferred) || 'Room';
  let candidate = base.slice(0, 31);
  let counter = 1;

  while (used.has(candidate)) {
    const suffix = `_${counter}`;
    const limit = Math.max(1, 31 - suffix.length);
    candidate = `${base.slice(0, limit)}${suffix}`;
    counter += 1;
  }

  used.add(candidate);
  return candidate;
};

const sheetRef = (sheetName: string, cell: string) => `'${sheetName.replace(/'/g, "''")}'!${cell}`;

const formatDate = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${d}-${m}-${y}`;
};

const formatDateForFileName = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const toGrainsPerLb = (humidityRatioLbPerLb: number) => humidityRatioLbPerLb * 7000;

const getProjectPsychro = (project: any, season: SeasonKey) => {
  const isMonsoon = season === 'monsoon';
  const outdoorTemp = asNumber(isMonsoon ? project?.monsoonDesignTemp : project?.summerDesignTemp, 95);
  const outdoorHumidity = asNumber(isMonsoon ? project?.monsoonDesignHumidity : project?.summerDesignHumidity, isMonsoon ? 85 : 50);
  const indoorTemp = asNumber(isMonsoon ? project?.insideMonsoonTemp : project?.insideSummerTemp, isMonsoon ? 75 : 75);
  const indoorHumidity = asNumber(isMonsoon ? project?.insideMonsoonHumidity : project?.insideSummerHumidity, isMonsoon ? 55 : 50);

  const outdoor = calculatePsychrometrics(outdoorTemp, outdoorHumidity, asNumber(project?.altitude, 0));
  const indoor = calculatePsychrometrics(indoorTemp, indoorHumidity, asNumber(project?.altitude, 0));

  return {
    outside: {
      db: outdoorTemp,
      rh: outdoorHumidity,
      wb: asNumber(isMonsoon ? project?.outsideMonsoonWB : project?.outsideSummerWB, 0),
      th: asNumber(isMonsoon ? project?.monsoonEnthalpy : project?.summerEnthalpy, outdoor.enthalpy),
      grlb: toGrainsPerLb(asNumber(isMonsoon ? project?.monsoonHumidityRatio : project?.summerHumidityRatio, outdoor.humidityRatio)),
    },
    inside: {
      db: indoorTemp,
      rh: indoorHumidity,
      wb: asNumber(isMonsoon ? project?.insideMonsoonWB : project?.insideSummerWB, 0),
      th: asNumber(isMonsoon ? project?.insideMonsoonEnthalpy : project?.insideSummerEnthalpy, indoor.enthalpy),
      grlb: toGrainsPerLb(asNumber(isMonsoon ? project?.insideMonsoonHumidityRatio : project?.insideSummerHumidityRatio, indoor.humidityRatio)),
    },
  };
};

type PsychroValue = {
  db: number;
  rh: number;
  wb: number;
  th: number;
  grlb: number;
};

type PsychroDiff = {
  db: number;
  th: number;
  grlb: number;
};

type PsychroDisplay = {
  summer: {
    outside: PsychroValue;
    inside: PsychroValue;
    diff: PsychroDiff;
  };
  monsoon: {
    outside: PsychroValue;
    inside: PsychroValue;
    diff: PsychroDiff;
  };
};

const getDisplayPsychro = (project: any): PsychroDisplay => {
  const summer = getProjectPsychro(project, 'summer');
  const monsoon = getProjectPsychro(project, 'monsoon');

  return {
    summer: {
      ...summer,
      diff: {
        db: summer.outside.db - summer.inside.db,
        th: summer.outside.th - summer.inside.th,
        grlb: summer.outside.grlb - summer.inside.grlb,
      },
    },
    monsoon: {
      ...monsoon,
      diff: {
        db: monsoon.outside.db - monsoon.inside.db,
        th: monsoon.outside.th - monsoon.inside.th,
        grlb: monsoon.outside.grlb - monsoon.inside.grlb,
      },
    },
  };
};

const getDesignConditions = (project: any, zoneOrSystem: any, season: SeasonKey): DesignConditions => {
  const isMonsoon = season === 'monsoon';

  return {
    outdoorTemp: asNumber(zoneOrSystem?.outdoorTemp, isMonsoon ? project?.monsoonDesignTemp : project?.summerDesignTemp),
    indoorTemp: asNumber(zoneOrSystem?.indoorTemp, isMonsoon ? project?.insideMonsoonTemp : project?.insideSummerTemp),
    outdoorHumidity: asNumber(zoneOrSystem?.outdoorHumidity, isMonsoon ? project?.monsoonDesignHumidity : project?.summerDesignHumidity),
    indoorHumidity: asNumber(zoneOrSystem?.indoorHumidity, isMonsoon ? project?.insideMonsoonHumidity : project?.insideSummerHumidity),
    winterOutdoorTemp: asNumber(project?.winterDesignTemp, 50),
    winterOutdoorHumidity: asNumber(project?.winterDesignHumidity, 80),
    winterIndoorTemp: asNumber(project?.insideWinterTemp, 72),
    winterIndoorHumidity: asNumber(project?.insideWinterHumidity, 40),
    altitude: asNumber(project?.altitude, 0),
  };
};

const calculateSeasonResult = (
  project: any,
  zoneOrSystem: any,
  room: any,
  elements: EnvelopeElement[],
  season: SeasonKey,
): SeasonResult => {
  const area = calculateRoomArea(room);
  const volume = calculateRoomVolume(room);
  const designConditions = getDesignConditions(project, zoneOrSystem, season);

  const roomDetails = {
    id: room.id,
    name: room.name ?? '',
    floor: room.floor ?? 'Ground',
    length: asNumber(room.length, 0),
    width: asNumber(room.width, 0),
    height: asNumber(room.height, 0),
    hasFalseCeiling: room.hasFalseCeiling ?? false,
    falseCeilingHeight: asNumber(room.falseCeilingHeight, 0),
    facph: asNumber(room.facph, 0),
    peopleCount: asNumber(room.peopleCount, 0),
    activityType: room.activityType ?? 'office',
    lightsWattsPerSqft: asNumber(room.lightsWattsPerSqft, 0),
    equipmentKW: asNumber(room.equipmentKW, 0),
    othersKW: asNumber(room.othersKW, 0),
  };

  const vent = calculateVentilationLoad(roomDetails, designConditions);
  const internal = calculateInternalGains(roomDetails);
  const envelope = calculateEnvelopeGain(elements, designConditions);

  const ductGainPct = asNumber(room.ductGainPct, 2);
  const fanGainPct = asNumber(room.fanGainPct, 3);
  const sensibleSafetyPct = asNumber(room.sensibleSafetyPercent ?? room.sensibleSafetyFactor, 10);
  const latentSafetyPct = asNumber(room.latentSafetyPercent ?? room.latentSafetyFactor, 5);
  const overallSafetyPct = asNumber(room.overallSafetyPercent ?? room.grandTotalSafetyFactor, 3);

  const erSensibleBase = envelope.sensible + internal.sensible + vent.sensible * BF;
  const erLatentBase = internal.latent + envelope.latent + vent.latent * BF;
  const parasitic = calculateParasiticGains(erSensibleBase, erSensibleBase, ductGainPct, fanGainPct);

  const ersh = (erSensibleBase + parasitic.ductGain + parasitic.fanGain) * (1 + sensibleSafetyPct / 100);
  const erlh = erLatentBase * (1 + latentSafetyPct / 100);
  const oaSensible = vent.sensible * (1 - BF);
  const oaLatent = vent.latent * (1 - BF);
  const coilSensible = ersh + oaSensible;
  const coilLatent = erlh + oaLatent;
  const grandTotal = (coilSensible + coilLatent) * (1 + overallSafetyPct / 100);

  const isChiller = String(project?.systemType || '').toLowerCase().includes('chiller');
  const coil = calculateCoilParameters(
    coilSensible,
    coilLatent,
    designConditions.indoorTemp,
    designConditions.indoorHumidity,
    asNumber(project?.altitude, 0),
    BF,
    35,
    65,
    isChiller ? 50 : 54,
  );

  const totalSupplyAch = Math.max(getRecommendedAch(room.activityType ?? room.achProfile), asNumber(room.facph, 0));
  const totalSupplyCFM = (volume * totalSupplyAch) / 60;
  const designSupplyCFM = Math.max(coil.dehumidifiedCFM, totalSupplyCFM);
  const heating = calculateHeatingLoad(roomDetails, elements, designConditions);

  return {
    area,
    volume,
    ventCfm: vent.cfm,
    ventSensible: vent.sensible,
    ventLatent: vent.latent,
    internalSensible: internal.sensible,
    internalLatent: internal.latent,
    envelopeSensible: envelope.sensible,
    envelopeLatent: envelope.latent,
    ductGain: parasitic.ductGain,
    fanGain: parasitic.fanGain,
    ersh,
    erlh,
    coilSensible,
    coilLatent,
    grandTotal,
    totalTR: grandTotal / 12000,
    totalSupplyCFM,
    designSupplyCFM,
    heatingLoad: heating.totalHeatingLoad,
  };
};

const calculateWinterHeating = (
  project: any,
  zoneOrSystem: any,
  room: any,
  elements: EnvelopeElement[],
) => {
  const designConditions: DesignConditions = {
    outdoorTemp: asNumber(project?.winterDesignTemp, 50),
    indoorTemp: asNumber(zoneOrSystem?.winterIndoorTemp ?? project?.insideWinterTemp, 72),
    outdoorHumidity: asNumber(project?.winterDesignHumidity, 80),
    indoorHumidity: asNumber(zoneOrSystem?.winterIndoorHumidity ?? project?.insideWinterHumidity, 40),
    winterOutdoorTemp: asNumber(project?.winterDesignTemp, 50),
    winterOutdoorHumidity: asNumber(project?.winterDesignHumidity, 80),
    winterIndoorTemp: asNumber(zoneOrSystem?.winterIndoorTemp ?? project?.insideWinterTemp, 72),
    winterIndoorHumidity: asNumber(zoneOrSystem?.winterIndoorHumidity ?? project?.insideWinterHumidity, 40),
    altitude: asNumber(project?.altitude, 0),
  };

  const roomDetails = {
    id: room.id,
    name: room.name ?? '',
    floor: room.floor ?? 'Ground',
    length: asNumber(room.length, 0),
    width: asNumber(room.width, 0),
    height: asNumber(room.height, 0),
    hasFalseCeiling: room.hasFalseCeiling ?? false,
    falseCeilingHeight: asNumber(room.falseCeilingHeight, 0),
    facph: asNumber(room.facph, 0),
    peopleCount: asNumber(room.peopleCount, 0),
    activityType: room.activityType ?? 'office',
    lightsWattsPerSqft: asNumber(room.lightsWattsPerSqft, 0),
    equipmentKW: asNumber(room.equipmentKW, 0),
    othersKW: asNumber(room.othersKW, 0),
  };

  return calculateHeatingLoad(roomDetails, elements, designConditions).totalHeatingLoad;
};

const sumByOrientation = (elements: EnvelopeElement[], type: EnvelopeElement['type']) => {
  const areas: Record<string, number> = {
    N: 0,
    NE: 0,
    E: 0,
    SE: 0,
    S: 0,
    SW: 0,
    W: 0,
    NW: 0,
  };

  elements
    .filter((element) => element.type === type)
    .forEach((element) => {
      const orientation = String(element.orientation || '').toUpperCase();
      if (orientation in areas) {
        areas[orientation] += asNumber(element.area, 0);
      }
    });

  return areas;
};

const totalAreaByType = (elements: EnvelopeElement[], type: EnvelopeElement['type']) =>
  elements.filter((element) => element.type === type).reduce((sum, element) => sum + asNumber(element.area, 0), 0);

const setFormulaCell = (ws: XLSX.WorkSheet, address: string, formula: string, type: 'n' | 'str' = 'n') => {
  const current = ws[address] || { t: type };
  ws[address] = { ...current, t: type, f: formula } as XLSX.CellObject;
};

const style = {
  title: { font: { name: 'Arial', sz: 14, bold: true }, alignment: { horizontal: 'center', vertical: 'center' } },
  section: { font: { name: 'Arial', sz: 11, bold: true }, fill: { fgColor: { rgb: 'DCE6F1' } } },
  header: { font: { name: 'Arial', sz: 10, bold: true }, fill: { fgColor: { rgb: 'EDEDED' } }, alignment: { horizontal: 'center', wrapText: true } },
  label: { font: { name: 'Arial', sz: 10, bold: true } },
  input: { font: { name: 'Arial', sz: 10, color: { rgb: '1F4E79' } }, fill: { fgColor: { rgb: 'FFF2CC' } } },
  calc: { font: { name: 'Arial', sz: 10, color: { rgb: '000000' } } },
  border: {
    border: {
      top: { style: 'thin', color: { rgb: '000000' } },
      bottom: { style: 'thin', color: { rgb: '000000' } },
      left: { style: 'thin', color: { rgb: '000000' } },
      right: { style: 'thin', color: { rgb: '000000' } },
    },
  },
};

const setStyle = (ws: XLSX.WorkSheet, address: string, patch: any) => {
  const cell = ws[address];
  if (!cell) return;
  cell.s = { ...(cell.s || {}), ...patch };
};

const applyBorderRange = (ws: XLSX.WorkSheet, startRow: number, endRow: number, startCol: number, endCol: number) => {
  for (let r = startRow; r <= endRow; r += 1) {
    for (let c = startCol; c <= endCol; c += 1) {
      const address = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
      if (!ws[address]) ws[address] = { t: 's', v: '' };
      setStyle(ws, address, style.border);
    }
  }
};

const toRoomRecords = (
  project: any,
  systems: any[],
  zones: any[],
  rooms: Record<string, any[]>,
  envelopeElements: Record<string, EnvelopeElement[]>,
) => {
  const usedSheetNames = new Set<string>(['Summary Sheet']);
  const systemsById = new Map((systems || []).map((system) => [system.id, system]));
  const zonesById = new Map((zones || []).map((zone) => [zone.id, zone]));
  const records: RoomRecord[] = [];

  Object.keys(rooms || {})
    .sort()
    .forEach((groupId) => {
      const zone = zonesById.get(groupId);
      const system = systemsById.get(groupId);
      const zoneOrSystem = zone || system || {};
      const zoneName = String(zone?.name || system?.name || 'Unassigned').trim() || 'Unassigned';
      const systemName = String(zone?.systemId ? systemsById.get(zone.systemId)?.name || 'Standalone' : system?.name || 'Standalone').trim() || 'Standalone';

      (rooms[groupId] || []).forEach((room, index) => {
        const roomName = String(room?.name || `Room ${index + 1}`).trim() || `Room ${index + 1}`;
        const sheetName = makeUniqueSheetName(`${zoneName}_${roomName}`, usedSheetNames);
        const elements = envelopeElements?.[room.id] || [];

        // Calculate winter breakdown
        const designConditions: DesignConditions = {
          outdoorTemp: asNumber(project?.winterDesignTemp, 50),
          indoorTemp: asNumber(zoneOrSystem?.winterIndoorTemp ?? project?.insideWinterTemp, 72),
          outdoorHumidity: asNumber(project?.winterDesignHumidity, 80),
          indoorHumidity: asNumber(zoneOrSystem?.winterIndoorHumidity ?? project?.insideWinterHumidity, 40),
          winterOutdoorTemp: asNumber(project?.winterDesignTemp, 50),
          winterOutdoorHumidity: asNumber(project?.winterDesignHumidity, 80),
          winterIndoorTemp: asNumber(zoneOrSystem?.winterIndoorTemp ?? project?.insideWinterTemp, 72),
          winterIndoorHumidity: asNumber(zoneOrSystem?.winterIndoorHumidity ?? project?.insideWinterHumidity, 40),
          altitude: asNumber(project?.altitude, 0),
        };
        const roomDetails = {
          id: room.id,
          name: room.name ?? '',
          floor: room.floor ?? 'Ground',
          length: asNumber(room.length, 0),
          width: asNumber(room.width, 0),
          height: asNumber(room.height, 0),
          hasFalseCeiling: room.hasFalseCeiling ?? false,
          falseCeilingHeight: asNumber(room.falseCeilingHeight, 0),
          facph: asNumber(room.facph, 0),
          peopleCount: asNumber(room.peopleCount, 0),
          activityType: room.activityType ?? 'office',
          lightsWattsPerSqft: asNumber(room.lightsWattsPerSqft, 0),
          equipmentKW: asNumber(room.equipmentKW, 0),
          othersKW: asNumber(room.othersKW, 0),
        };
        const vent = calculateVentilationLoad(roomDetails, designConditions);
        const internal = calculateInternalGains(roomDetails);
        const envelope = calculateEnvelopeGain(elements, designConditions);
        records.push({
          room,
          zoneId: groupId,
          zoneName,
          systemName,
          sheetName,
          elements,
          zoneOrSystem,
          summer: calculateSeasonResult(project, zoneOrSystem, room, elements, 'summer'),
          monsoon: project?.includeMonsoon ? calculateSeasonResult(project, zoneOrSystem, room, elements, 'monsoon') : undefined,
          winterHeatingLoad: calculateHeatingLoad(roomDetails, elements, designConditions).totalHeatingLoad,
          winterEnvelopeSensible: envelope.sensible,
          winterInternalSensible: internal.sensible,
          winterVentSensible: vent.sensible,
        });
      });
    });

  return records.sort((left, right) =>
    `${left.systemName}|${left.zoneName}|${left.room?.name || ''}`.localeCompare(`${right.systemName}|${right.zoneName}|${right.room?.name || ''}`),
  );
};

const buildRoomSheet = (
  project: any,
  record: RoomRecord,
  withHeavyFormatting: boolean,
  creatorFirstName?: string,
): { ws: XLSX.WorkSheet; refs: RoomSheetRefs } => {
  void withHeavyFormatting;
  const room = record.room;
  const rows: any[][] = Array.from({ length: 80 }, () => Array(8).fill(''));
  const psychro = getDisplayPsychro(project);
  // Local winter psychrometric calculation
  const winterOutdoorTemp = asNumber(project?.winterDesignTemp, 50);
  const winterOutdoorHumidity = asNumber(project?.winterDesignHumidity, 80);
  const winterIndoorTemp = asNumber(project?.insideWinterTemp, 72);
  const winterIndoorHumidity = asNumber(project?.insideWinterHumidity, 40);
  const winterOutside = calculatePsychrometrics(winterOutdoorTemp, winterOutdoorHumidity, asNumber(project?.altitude, 0));
  const winterInside = calculatePsychrometrics(winterIndoorTemp, winterIndoorHumidity, asNumber(project?.altitude, 0));
  const winterPsychro = {
    outside: {
      db: winterOutdoorTemp,
      rh: winterOutdoorHumidity,
      wb: 0,
      th: winterOutside.enthalpy,
      grlb: toGrainsPerLb(winterOutside.humidityRatio),
    },
    inside: {
      db: winterIndoorTemp,
      rh: winterIndoorHumidity,
      wb: 0,
      th: winterInside.enthalpy,
      grlb: toGrainsPerLb(winterInside.humidityRatio),
    },
    diff: {
      db: winterOutdoorTemp - winterIndoorTemp,
      rh: winterOutdoorHumidity - winterIndoorHumidity,
      th: winterOutside.enthalpy - winterInside.enthalpy,
      grlb: toGrainsPerLb(winterOutside.humidityRatio) - toGrainsPerLb(winterInside.humidityRatio),
    },
  };
  const wallAreas = sumByOrientation(record.elements, 'Wall');
  const glassAreas = sumByOrientation(record.elements, 'Glass');
  const partitionArea = totalAreaByType(record.elements, 'Partition');
  const roofArea = totalAreaByType(record.elements, 'Roof');
  const floorArea = totalAreaByType(record.elements, 'Floor') || record.summer.area;
  const electricalDisplay = `${asNumber(room.equipmentKW, 0) + asNumber(room.othersKW, 0)} kW + ${asNumber(room.lightsWattsPerSqft, 0)} W/sq.ft`;

  rows[0][0] = `HEAT LOAD SHEET - ${String(room?.name || '').toUpperCase()}`;
  rows[1][0] = 'Project';
  rows[1][1] = safeValue(project?.name, 'Project');
  rows[1][3] = 'Location';
  rows[1][4] = safeValue(project?.location || project?.place);
  rows[1][6] = 'Date';
  rows[1][7] = formatDate();
  rows[3][4] = creatorFirstName ? creatorFirstName : '';
  rows[3][3] = 'Design Engineer';
  rows[2][0] = 'System';
  rows[2][1] = safeValue(record.systemName);
  rows[2][3] = 'Zone';
  rows[2][4] = safeValue(record.zoneName);
  rows[2][6] = 'Floor';
  rows[2][7] = safeValue(room?.floor);
  rows[3][0] = 'Area Name';
  rows[3][1] = safeValue(room?.name);
  rows[3][3] = 'Estimated By';
  rows[3][4] = safeValue(project?.engineerName || project?.estimatedBy, 'Design Engineer');
  rows[3][6] = 'Peak Load Time';
  rows[3][7] = safeValue(project?.peakLoadTime, 'APRIL, 16:00 HRS');

  rows[5][0] = 'DESIGN CONDITIONS';
  rows[6][0] = 'Parameter';
  rows[6][1] = 'Summer Outside';
  rows[6][2] = 'Summer Inside';
  rows[6][3] = 'Summer Diff';
  rows[6][4] = 'Monsoon Outside';
  rows[6][5] = 'Monsoon Inside';
  rows[6][6] = 'Monsoon Diff';
  rows[6][7] = 'Winter Outside';
  rows[6][8] = 'Winter Inside';
  rows[6][9] = 'Winter Diff';
  rows[7][0] = 'DB';
  rows[7][1] = psychro.summer.outside.db;
  rows[7][2] = psychro.summer.inside.db;
  rows[7][3] = psychro.summer.diff.db;
  rows[7][4] = project?.includeMonsoon ? psychro.monsoon.outside.db : '';
  rows[7][5] = project?.includeMonsoon ? psychro.monsoon.inside.db : '';
  rows[7][6] = project?.includeMonsoon ? psychro.monsoon.diff.db : '';
  rows[7][7] = winterPsychro.outside.db;
  rows[7][8] = winterPsychro.inside.db;
  rows[7][9] = winterPsychro.diff.db;
  rows[8][0] = '% RH';
  rows[8][1] = psychro.summer.outside.rh;
  rows[8][2] = psychro.summer.inside.rh;
  rows[8][4] = project?.includeMonsoon ? psychro.monsoon.outside.rh : '';
  rows[8][5] = project?.includeMonsoon ? psychro.monsoon.inside.rh : '';
  rows[8][7] = winterPsychro.outside.rh;
  rows[8][8] = winterPsychro.inside.rh;
  rows[8][9] = winterPsychro.diff?.rh ?? '';
  // Omit WB row as requested
  rows[10][0] = 'TH (Enthalpy)';
  rows[10][1] = psychro.summer.outside.th;
  rows[10][2] = psychro.summer.inside.th;
  rows[10][3] = psychro.summer.diff.th;
  rows[10][4] = project?.includeMonsoon ? psychro.monsoon.outside.th : '';
  rows[10][5] = project?.includeMonsoon ? psychro.monsoon.inside.th : '';
  rows[10][6] = project?.includeMonsoon ? psychro.monsoon.diff.th : '';
  rows[10][7] = Math.round(winterPsychro.outside.th * 100) / 100;
  rows[10][8] = Math.round(winterPsychro.inside.th * 100) / 100;
  rows[10][9] = Math.round(winterPsychro.diff.th * 100) / 100;
  rows[11][0] = 'GR/LB (Humidity Ratio)';
  rows[11][1] = psychro.summer.outside.grlb;
  rows[11][2] = psychro.summer.inside.grlb;
  rows[11][3] = psychro.summer.diff.grlb;
  rows[11][4] = project?.includeMonsoon ? psychro.monsoon.outside.grlb : '';
  rows[11][5] = project?.includeMonsoon ? psychro.monsoon.inside.grlb : '';
  rows[11][6] = project?.includeMonsoon ? psychro.monsoon.diff.grlb : '';
  rows[11][7] = Math.round(winterPsychro.outside.grlb * 100) / 100;
  rows[11][8] = Math.round(winterPsychro.inside.grlb * 100) / 100;
  rows[11][9] = Math.round(winterPsychro.diff.grlb * 100) / 100;

  rows[13][0] = 'ROOM INPUTS ';
  rows[14][0] = 'Parameter';
  rows[14][1] = 'Value';
  rows[14][2] = 'Unit';
  rows[15][0] = 'Area';
  rows[15][1] = safeValue(record.summer.area);
  rows[15][2] = 'Sq.Ft';
  rows[16][0] = 'Volume';
  rows[16][1] = safeValue(record.summer.volume);
  rows[16][2] = 'Cu.Ft';
  rows[17][0] = 'Total Height';
  rows[17][1] = safeValue(asNumber(room?.height, 0));
  rows[17][2] = 'Ft';
  rows[18][0] = 'False Ceiling Height';
  rows[18][1] = safeValue(asNumber(room?.falseCeilingHeight, 0));
  rows[18][2] = 'Ft';
  rows[19][0] = 'Occupancy';
  rows[19][1] = safeValue(asNumber(room?.peopleCount, 0));
  rows[19][2] = 'Nos.';
  rows[20][0] = 'Fresh Air';
  rows[20][1] = safeValue(record.summer.ventCfm);
  rows[20][2] = 'CFM';
  rows[21][0] = 'Room Electrical Load';
  rows[21][1] = safeValue(asNumber(room.lightsWattsPerSqft, 0));
  rows[21][2] = 'W/sq.ft';
  rows[22][0] = 'Equipment Load';
  rows[22][1] = safeValue(asNumber(room.equipmentKW, 0) + asNumber(room.othersKW, 0));
  rows[22][2] = 'KW';

  rows[23][0] = 'SUMMER CALCULATION';
  rows[24][0] = 'Metric';

  rows[24][1] = 'Value';
  rows[24][2] = 'Unit';
  // --- All rows population above this line ---

  // Pad all rows to the maximum column count to prevent Excel corruption
  const maxCols = Math.max(...rows.map(r => r.length));
  for (let i = 0; i < rows.length; i++) {
    while (rows[i].length < maxCols) rows[i].push('');
  }
  const wsRoom = XLSX.utils.aoa_to_sheet(rows);

  // --- All setFormulaCell(wsRoom, ...) and worksheet modifications below this line ---
  // Summer calculation values (rounded)
  rows[25][0] = 'Envelope Sensible'; rows[25][1] = Math.round(record.summer.envelopeSensible); rows[25][2] = 'BTU/h';
  rows[26][0] = 'Internal Sensible'; rows[26][1] = Math.round(record.summer.internalSensible); rows[26][2] = 'BTU/h';
  rows[27][0] = 'Vent Sensible'; rows[27][1] = Math.round(record.summer.ventSensible); rows[27][2] = 'BTU/h';
  rows[28][0] = 'Vent Latent'; rows[28][1] = Math.round(record.summer.ventLatent); rows[28][2] = 'BTU/h';
  rows[29][0] = 'Duct Gain'; rows[29][1] = Math.round(record.summer.ductGain); rows[29][2] = 'BTU/h';
  rows[30][0] = 'Fan Gain'; rows[30][1] = Math.round(record.summer.fanGain); rows[30][2] = 'BTU/h';
  rows[31][0] = 'ERSH'; rows[31][1] = Math.round(record.summer.ersh); rows[31][2] = 'BTU/h';
  rows[32][0] = 'ERLH'; rows[32][1] = Math.round(record.summer.erlh); rows[32][2] = 'BTU/h';
  rows[33][0] = 'Grand Total Heat'; rows[33][1] = Math.round(record.summer.grandTotal); rows[33][2] = 'BTU/h';
  rows[34][0] = 'Air Conditioning Tonnage'; rows[34][1] = Math.round(record.summer.totalTR * 100) / 100; rows[34][2] = 'TR';
  rows[35][0] = 'Design Supply CFM'; rows[35][1] = Math.round(record.summer.designSupplyCFM); rows[35][2] = 'CFM';

  // Monsoon calculation values (rounded)
  if (project?.includeMonsoon && record.monsoon) {
    rows[23][4] = 'MONSOON APP CALCULATION';
    rows[24][4] = 'Metric';
    rows[24][5] = 'Value';
    rows[24][6] = 'Unit';
    rows[25][4] = 'Envelope Sensible'; rows[25][5] = Math.round(record.monsoon.envelopeSensible); rows[25][6] = 'BTU/h';
    rows[26][4] = 'Internal Sensible'; rows[26][5] = Math.round(record.monsoon.internalSensible); rows[26][6] = 'BTU/h';
    rows[27][4] = 'Vent Sensible'; rows[27][5] = Math.round(record.monsoon.ventSensible); rows[27][6] = 'BTU/h';
    rows[28][4] = 'Vent Latent'; rows[28][5] = Math.round(record.monsoon.ventLatent); rows[28][6] = 'BTU/h';
    rows[29][4] = 'Duct Gain'; rows[29][5] = Math.round(record.monsoon.ductGain); rows[29][6] = 'BTU/h';
    rows[30][4] = 'Fan Gain'; rows[30][5] = Math.round(record.monsoon.fanGain); rows[30][6] = 'BTU/h';
    rows[31][4] = 'ERSH'; rows[31][5] = Math.round(record.monsoon.ersh); rows[31][6] = 'BTU/h';
    rows[32][4] = 'ERLH'; rows[32][5] = Math.round(record.monsoon.erlh); rows[32][6] = 'BTU/h';
    rows[33][4] = 'Grand Total Heat'; rows[33][5] = Math.round(record.monsoon.grandTotal); rows[33][6] = 'BTU/h';
    rows[34][4] = 'Air Conditioning Tonnage'; rows[34][5] = Math.round(record.monsoon.totalTR * 100) / 100; rows[34][6] = 'TR';
    rows[35][4] = 'Design Supply CFM'; rows[35][5] = Math.round(record.monsoon.designSupplyCFM); rows[35][6] = 'CFM';
  }


  // Place Winter Calculation Block beside Monsoon App Calculation Table
  // Fill winter breakdown values (rounded)
  rows[24][7] = 'WINTER CALCULATION';
  rows[25][7] = 'Envelope Sensible'; rows[25][8] = Math.round(record.winterEnvelopeSensible ?? 0); rows[25][9] = 'BTU/h';
  rows[26][7] = 'Internal Sensible'; rows[26][8] = Math.round(record.winterInternalSensible ?? 0); rows[26][9] = 'BTU/h';
  rows[27][7] = 'Vent Sensible'; rows[27][8] = Math.round(record.winterVentSensible ?? 0); rows[27][9] = 'BTU/h';
  rows[28][7] = ''; rows[28][8] = ''; rows[28][9] = '';
  rows[29][7] = ''; rows[29][8] = ''; rows[29][9] = '';
  rows[30][7] = ''; rows[30][8] = ''; rows[30][9] = '';
  rows[31][7] = ''; rows[31][8] = ''; rows[31][9] = '';
  rows[32][7] = ''; rows[32][8] = ''; rows[32][9] = '';
  rows[33][7] = ''; rows[33][8] = ''; rows[33][9] = '';
  rows[34][7] = 'Total Winter Heating Load'; rows[34][8] = Math.round(record.winterHeatingLoad); rows[34][9] = 'BTU/h';

  // Add comments/guidance for each section (moved to after main tables if needed)

  if (project?.includeMonsoon) {
    rows[23][4] = 'MONSOON APP CALCULATION';
    rows[24][4] = 'Metric';
    rows[24][5] = 'Value';
    rows[24][6] = 'Unit';
    rows[25][4] = 'Envelope Sensible';
    rows[25][5] = record.monsoon?.envelopeSensible ?? '';
    rows[25][6] = record.monsoon ? 'BTU/h' : '';
    rows[26][4] = 'Internal Sensible';
    rows[26][5] = record.monsoon?.internalSensible ?? '';
    rows[26][6] = record.monsoon ? 'BTU/h' : '';
    rows[27][4] = 'Vent Sensible';
    rows[27][5] = record.monsoon?.ventSensible ?? '';
    rows[27][6] = record.monsoon ? 'BTU/h' : '';
    rows[28][4] = 'Vent Latent';
    rows[28][5] = record.monsoon?.ventLatent ?? '';
    rows[28][6] = record.monsoon ? 'BTU/h' : '';
    rows[29][4] = 'Duct Gain';
    rows[29][5] = record.monsoon?.ductGain ?? '';
    rows[29][6] = record.monsoon ? 'BTU/h' : '';
    rows[30][4] = 'Fan Gain';
    rows[30][5] = record.monsoon?.fanGain ?? '';
    rows[30][6] = record.monsoon ? 'BTU/h' : '';
    rows[31][4] = 'ERSH';
    rows[31][5] = record.monsoon?.ersh ?? '';
    rows[31][6] = record.monsoon ? 'BTU/h' : '';
    rows[32][4] = 'ERLH';
    rows[32][5] = record.monsoon?.erlh ?? '';
    rows[32][6] = record.monsoon ? 'BTU/h' : '';
    rows[33][4] = 'Grand Total Heat';
    rows[33][5] = record.monsoon?.grandTotal ?? '';
    rows[33][6] = record.monsoon ? 'BTU/h' : '';
    rows[34][4] = 'Air Conditioning Tonnage';
    rows[34][5] = record.monsoon?.totalTR ?? '';
    rows[34][6] = record.monsoon ? 'TR' : '';
    rows[35][4] = 'Design Supply CFM';
    rows[35][5] = record.monsoon?.designSupplyCFM ?? '';
    rows[35][6] = record.monsoon ? 'CFM' : '';
  }

  // Move Structural Area Summary table after Room Inputs Table (immediately after row 22)
  let areaRow = 23;
  // Shift all rows after 22 down to make space for the area summary
  rows.splice(areaRow, 0, ...Array.from({length: 15}, () => Array(8).fill(''))); // Reserve 15 rows for area summary
  rows[areaRow][0] = 'STRUCTURAL AREA SUMMARY';
  rows[areaRow + 1][0] = 'Type';
  rows[areaRow + 1][1] = 'Orientation';
  rows[areaRow + 1][2] = 'Area (Sq.Ft)';
  rows[areaRow + 1][3] = 'U-Value';
  rows[areaRow + 1][4] = 'Description';

  let row = areaRow + 2;
  // Walls by orientation
  const wallElements = record.elements.filter(e => e.type === 'Wall');
  for (const orientation of ORIENTATIONS) {
    const elements = wallElements.filter(e => String(e.orientation).toUpperCase() === orientation);
    if (elements.length > 0) {
      for (const el of elements) {
        rows[row][0] = 'Wall';
        rows[row][1] = orientation;
        rows[row][2] = asNumber(el.area, 0);
        rows[row][3] = el.uValue;
        rows[row][4] = el.description || '';
        row++;
      }
    }
  }
  // Glass by orientation
  const glassElements = record.elements.filter(e => e.type === 'Glass');
  for (const orientation of ORIENTATIONS) {
    const elements = glassElements.filter(e => String(e.orientation).toUpperCase() === orientation);
    if (elements.length > 0) {
      for (const el of elements) {
        rows[row][0] = 'Glass';
        rows[row][1] = orientation;
        rows[row][2] = asNumber(el.area, 0);
        rows[row][3] = el.uValue;
        rows[row][4] = el.description || '';
        row++;
      }
    }
  }
  // Partition
  const partitionElements = record.elements.filter(e => e.type === 'Partition');
  if (partitionElements.length > 0) {
    for (const el of partitionElements) {
      rows[row][0] = 'Partition';
      rows[row][1] = el.orientation || '';
      rows[row][2] = asNumber(el.area, 0);
      rows[row][3] = el.uValue;
      rows[row][4] = el.description || '';
      row++;
    }
  } else {
    rows[row][0] = 'Partition';
    rows[row][2] = partitionArea;
    row++;
  }
  // Roof
  const roofElements = record.elements.filter(e => e.type === 'Roof');
  if (roofElements.length > 0) {
    for (const el of roofElements) {
      rows[row][0] = 'Roof';
      rows[row][1] = el.orientation || '';
      rows[row][2] = asNumber(el.area, 0);
      rows[row][3] = el.uValue;
      rows[row][4] = el.description || '';
      row++;
    }
  } else {
    rows[row][0] = 'Roof';
    rows[row][2] = roofArea;
    row++;
  }
  // Floor
  const floorElements = record.elements.filter(e => e.type === 'Floor');
  if (floorElements.length > 0) {
    for (const el of floorElements) {
      rows[row][0] = 'Floor';
      rows[row][1] = el.orientation || '';
      rows[row][2] = asNumber(el.area, 0);
      rows[row][3] = el.uValue;
      rows[row][4] = el.description || '';
      row++;
    }
  } else {
    rows[row][0] = 'Floor';
    rows[row][2] = floorArea;
    row++;
  }

  rows[45][0] = 'SELECTED EQUIPMENT';
  rows[46][0] = 'MODEL';
  rows[46][1] = 'TR';
  rows[46][2] = 'CFM';
  rows[46][3] = 'QTY';
  rows[46][4] = 'TOTAL TR';
  rows[46][5] = 'TOTAL CFM';
  rows[47][0] = String(room?.selectedIdModel || room?.iduModel || '');
  rows[47][1] = asNumber(room?.selectedIdTR || room?.iduTR, 0);
  rows[47][2] = asNumber(room?.selectedIdCFM || room?.iduCFM, 0);
  rows[47][3] = asNumber(room?.selectedIdQty || room?.iduQty, 0);
  rows[48][0] = '';
  rows[49][0] = '';
  rows[50][0] = 'TOTAL';
  rows[51][0] = 'IDU Configuration';

  const wsRoom2 = XLSX.utils.aoa_to_sheet(rows);

  wsRoom2['!cols'] = [
    { wch: 24 },
    { wch: 16 },
    { wch: 12 },
    { wch: 16 },
    { wch: 24 },
    { wch: 16 },
    { wch: 12 },
    { wch: 20 },
  ];
  wsRoom2['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
    { s: { r: 5, c: 0 }, e: { r: 5, c: 6 } },
    { s: { r: 13, c: 0 }, e: { r: 13, c: 2 } },
    { s: { r: 23, c: 0 }, e: { r: 23, c: 2 } },
    ...(project?.includeMonsoon ? [{ s: { r: 23, c: 4 }, e: { r: 23, c: 6 } }] : []),
    { s: { r: 37, c: 0 }, e: { r: 37, c: 2 } },
    { s: { r: 45, c: 0 }, e: { r: 45, c: 5 } },
    { s: { r: 51, c: 1 }, e: { r: 51, c: 5 } },
  ];

  setFormulaCell(wsRoom2, 'E48', 'B48*D48');
  setFormulaCell(wsRoom2, 'F48', 'C48*D48');
  setFormulaCell(wsRoom2, 'E49', 'B49*D49');
  setFormulaCell(wsRoom2, 'F49', 'C49*D49');
  setFormulaCell(wsRoom2, 'E50', 'SUM(E47:E49)');
  setFormulaCell(wsRoom2, 'F50', 'SUM(F47:F49)');
  setFormulaCell(wsRoom2, 'B52', 'TEXTJOIN("; ",TRUE,IF(A47<>"",A47&" + "&TEXT(B47,"0.00")&" TR + "&TEXT(C47,"0")&" CFM + Qty "&TEXT(D47,"0"),""),IF(A48<>"",A48&" + "&TEXT(B48,"0.00")&" TR + "&TEXT(C48,"0")&" CFM + Qty "&TEXT(D48,"0"),""),IF(A49<>"",A49&" + "&TEXT(B49,"0.00")&" TR + "&TEXT(C49,"0")&" CFM + Qty "&TEXT(D49,"0"),""))', 'str');
  setFormulaCell(wsRoom2, 'B53', `MAX(B35,${record.monsoon ? 'F35' : '0'})`);

  setStyle(wsRoom2, 'A1', style.title);
  // Bold all table headers
  ['A6', 'A14', 'A24', 'A38', 'A46', 'A7', 'B7', 'C7', 'D7', 'E7', 'F7', 'G7', 'A15', 'B15', 'C15', 'A25', 'B25', 'C25', 'A39', 'B39', 'C39', 'A47', 'B47', 'C47', 'D47', 'E47', 'F47',
    'A24', 'B24', 'C24', 'E24', 'F24', 'G24', 'H24', 'I24', 'J24', 'A25', 'B25', 'C25', 'E25', 'F25', 'G25', 'H25', 'I25', 'J25',
    'A38', 'B38', 'C38', 'D38', 'E38',
    'A46', 'B46', 'C46', 'D46', 'E46', 'F46',
    'A37', 'B37', 'C37', 'D37', 'E37',
    'A14', 'B14', 'C14',
  ].forEach((address) => setStyle(wsRoom2, address, style.header));
  if (project?.includeMonsoon) {
    ['E25', 'F25', 'G25'].forEach((address) => setStyle(wsRoom2, address, style.header));
  }
  ['B16', 'B17', 'B18', 'B19', 'B20', 'B21'].forEach((address) => setStyle(wsRoom2, address, style.input));
  ['B26', 'B27', 'B28', 'B29', 'B30', 'B31', 'B32', 'B33', 'B34', 'B35', 'B36', 'B37'].forEach((address) => setStyle(wsRoom2, address, style.calc));
  if (project?.includeMonsoon) {
    ['F26', 'F27', 'F28', 'F29', 'F30', 'F31', 'F32', 'F33', 'F34', 'F35'].forEach((address) => setStyle(wsRoom2, address, style.calc));
  }

  applyBorderRange(wsRoom2, 7, 11, 1, project?.includeMonsoon ? 7 : 4);
  applyBorderRange(wsRoom2, 15, 22, 1, 3);
  applyBorderRange(wsRoom2, 25, 36, 1, 3);
  if (project?.includeMonsoon) {
    applyBorderRange(wsRoom2, 25, 35, 5, 7);
  }
  applyBorderRange(wsRoom2, 39, 43, 1, 3);
  applyBorderRange(wsRoom2, 47, 50, 1, 6);

  if (!project?.includeMonsoon) {
    wsRoom2['!cols']![4].hidden = true;
    wsRoom2['!cols']![5].hidden = true;
    wsRoom2['!cols']![6].hidden = true;
  }

  wsRoom2['!margins'] = {
    left: 0.25,
    right: 0.25,
    top: 0.5,
    bottom: 0.5,
    header: 0.25,
    footer: 0.25,
  };
  (wsRoom2 as any)['!pageSetup'] = {
    paperSize: 9,
    orientation: 'portrait',
    fitToWidth: 1,
    fitToHeight: 1,
  };
  (wsRoom2 as any)['!freeze'] = { xSplit: 0, ySplit: 6 };

  return {
    ws: wsRoom2,
    refs: {
      sheetName: record.sheetName,
      zoneName: record.zoneName,
      systemName: record.systemName,
      roomName: room?.name || '',
      floorName: room?.floor || '',
      areaCell: 'B16',
      heightCell: 'B18',
      falseCeilingCell: 'B19',
      freshAirCell: 'B21',
      occupancyCell: 'B20',
      electricalCell: 'B22',
      summerTrCell: 'B35',
      summerCfmCell: 'B36',
      monsoonTrCell: record.monsoon ? 'F35' : undefined,
      monsoonCfmCell: record.monsoon ? 'F36' : undefined,
      winterLoadCell: 'B37',
      governingTrCell: 'B53',
      iduConfigCell: 'B52',
    },
  };
};

const buildSummarySheet = (project: any, roomRefs: RoomSheetRefs[], withHeavyFormatting: boolean) => {
  void withHeavyFormatting;
  const includeMonsoon = !!project?.includeMonsoon;
  const rows: any[][] = [];

  rows.push([`HEAT LOAD SUMMARY SHEET - ${String(project?.name || 'PROJECT').toUpperCase()}`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'DATE', formatDate()]);
  rows.push(['Filter the table below by System and Zone to review grouped rooms.', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  rows.push([]);
  rows.push([
    'Sr.No.',
    'Zone',
    'Room Name',
    'Floor',
    'Area (Sq.Ft)',
    'Total Height (FT)',
    'False Ceiling Height (FT)',
    'Fresh Air (CFM)',
    'Occupancy (Nos.)',
    'Electrical Load',
    'Summer TR',
    'Summer CFM',
    ...(includeMonsoon ? ['Monsoon TR', 'Monsoon CFM'] : []),
    'Winter Load (BTU/h)',
    'Governing TR',
    'IDU Configuration',
  ]);

  roomRefs.forEach((ref, index) => {
    rows.push([
      index + 1,
      ref.zoneName,
      ref.roomName,
      ref.floorName,
      0,
      0,
      0,
      0,
      0,
      '',
      0,
      0,
      ...(includeMonsoon ? [0, 0] : []),
      0,
      0,
      '',
    ]);
  });

  rows.push([
    'TOTAL',
    '',
    '',
    '',
    '',
    0,
    '',
    '',
    0,
    0,
    '',
    0,
    0,
    ...(includeMonsoon ? [0, 0] : []),
    0,
    0,
    '',
  ]);

  rows.push([]);
  rows.push(['ASSUMPTIONS']);
  rows.push(['1. Inside Condition: 25C ± 1C, RH ~55%']);
  rows.push(['2. Outside Condition: DB 38C, WB 31C']);
  rows.push(['3. Lighting Load: 0.5 Watts/Sq.ft']);
  rows.push(['4. Fresh Air: 0.5 ACH or 7.5 CFM per person, whichever is higher']);
  rows.push(['5. Equipment Load: as per details provided by Consultant/Customer']);
  rows.push(['6. Drawing Reference: Drawing provided by customer']);
  rows.push(['7. Exposed Glass: Single pane with venetian blind or roller shade, light color (U Value = 0.56 Btu/Hr/sq.ft/F)']);
  rows.push(['8. Floor above is air-conditioned']);
  rows.push([`9. Activity Hours: ${String(project?.activityHours || '9 AM to 1:30 PM')}`]);

  const wsSummary = XLSX.utils.aoa_to_sheet(rows);
  wsSummary['!cols'] = [
    { wch: 8 },
    { wch: 20 },
    { wch: 20 },
    { wch: 22 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
    { wch: 24 },
    { wch: 12 },
    { wch: 12 },
    ...(includeMonsoon ? [{ wch: 12 }, { wch: 12 }] : []),
    { wch: 16 },
    { wch: 12 },
    { wch: 44 },
  ];

  wsSummary['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 15 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 16 } },
  ];

  roomRefs.forEach((ref, index) => {
    const row = index + 5;
    setFormulaCell(wsSummary, `E${row}`, sheetRef(ref.sheetName, ref.areaCell));
    setFormulaCell(wsSummary, `F${row}`, sheetRef(ref.sheetName, ref.heightCell));
    setFormulaCell(wsSummary, `G${row}`, sheetRef(ref.sheetName, ref.falseCeilingCell));
    setFormulaCell(wsSummary, `H${row}`, sheetRef(ref.sheetName, ref.freshAirCell));
    setFormulaCell(wsSummary, `I${row}`, sheetRef(ref.sheetName, ref.occupancyCell));
    setFormulaCell(wsSummary, `J${row}`, sheetRef(ref.sheetName, ref.electricalCell), 'str');
    setFormulaCell(wsSummary, `K${row}`, `ROUND(${sheetRef(ref.sheetName, ref.summerTrCell)},2)`);
    setFormulaCell(wsSummary, `L${row}`, `ROUND(${sheetRef(ref.sheetName, ref.summerCfmCell)},0)`);
    const monsoonTrCol = includeMonsoon ? 'M' : null;
    const monsoonCfmCol = includeMonsoon ? 'N' : null;
    const winterCol = includeMonsoon ? 'O' : 'M';
    const governingCol = includeMonsoon ? 'P' : 'N';
    const iduCol = includeMonsoon ? 'Q' : 'O';

    if (monsoonTrCol && monsoonCfmCol) {
      setFormulaCell(wsSummary, `${monsoonTrCol}${row}`, ref.monsoonTrCell ? `ROUND(${sheetRef(ref.sheetName, ref.monsoonTrCell)},2)` : '0');
      setFormulaCell(wsSummary, `${monsoonCfmCol}${row}`, ref.monsoonCfmCell ? `ROUND(${sheetRef(ref.sheetName, ref.monsoonCfmCell)},0)` : '0');
    }
    setFormulaCell(wsSummary, `${winterCol}${row}`, `ROUND(${sheetRef(ref.sheetName, ref.winterLoadCell)},0)`);
    setFormulaCell(wsSummary, `${governingCol}${row}`, `ROUND(${sheetRef(ref.sheetName, ref.governingTrCell)},2)`);
    setFormulaCell(wsSummary, `${iduCol}${row}`, sheetRef(ref.sheetName, ref.iduConfigCell), 'str');
  });

  const totalRow = roomRefs.length + 5;
  setFormulaCell(wsSummary, `F${totalRow}`, `SUM(F5:F${totalRow - 1})`);
  setFormulaCell(wsSummary, `I${totalRow}`, `SUM(I5:I${totalRow - 1})`);
  setFormulaCell(wsSummary, `J${totalRow}`, `SUM(J5:J${totalRow - 1})`);
  setFormulaCell(wsSummary, `L${totalRow}`, `SUM(L5:L${totalRow - 1})`);
  setFormulaCell(wsSummary, `M${totalRow}`, `SUM(M5:M${totalRow - 1})`);
  if (includeMonsoon) {
    setFormulaCell(wsSummary, `N${totalRow}`, `SUM(N5:N${totalRow - 1})`);
    setFormulaCell(wsSummary, `O${totalRow}`, `SUM(O5:O${totalRow - 1})`);
    setFormulaCell(wsSummary, `P${totalRow}`, `SUM(P5:P${totalRow - 1})`);
    setFormulaCell(wsSummary, `Q${totalRow}`, `SUM(Q5:Q${totalRow - 1})`);
  } else {
    setFormulaCell(wsSummary, `N${totalRow}`, `SUM(N5:N${totalRow - 1})`);
    setFormulaCell(wsSummary, `O${totalRow}`, `SUM(O5:O${totalRow - 1})`);
  }

  const lastCol = includeMonsoon ? 'R' : 'P';
  wsSummary['!autofilter'] = { ref: `A4:${lastCol}${totalRow}` };
  (wsSummary as any)['!freeze'] = { xSplit: 0, ySplit: 4 };

  setStyle(wsSummary, 'A1', style.title);
  setStyle(wsSummary, 'A2', style.calc);
  const colCount = includeMonsoon ? 18 : 16;
  for (let c = 1; c <= colCount; c += 1) {
    setStyle(wsSummary, XLSX.utils.encode_cell({ r: 3, c: c - 1 }), style.header);
  }
  applyBorderRange(wsSummary, 4, totalRow, 1, colCount);
  for (let c = 1; c <= colCount; c += 1) {
    setStyle(wsSummary, XLSX.utils.encode_cell({ r: totalRow - 1, c: c - 1 }), style.section);
  }
  setStyle(wsSummary, `A${totalRow + 2}`, style.section);

  wsSummary['!margins'] = {
    left: 0.25,
    right: 0.25,
    top: 0.5,
    bottom: 0.5,
    header: 0.25,
    footer: 0.25,
  };
  (wsSummary as any)['!pageSetup'] = {
    paperSize: 8,
    orientation: 'landscape',
    fitToWidth: 1,
    fitToHeight: 0,
  };

  return wsSummary;
};

export const generateExcelReport = (
  project: any,
  systems: any[],
  zones: any[],
  rooms: Record<string, any[]>,
  envelopeElements: Record<string, EnvelopeElement[]>,
) => {
  const wb = XLSX.utils.book_new();
  const roomRecords = toRoomRecords(project, systems, zones, rooms, envelopeElements);
  const roomRefs: RoomSheetRefs[] = [];
  const withHeavyFormatting = true;

  roomRecords.forEach((record) => {
    const { ws, refs } = buildRoomSheet(project, record, withHeavyFormatting);
    XLSX.utils.book_append_sheet(wb, ws, record.sheetName);
    roomRefs.push(refs);
  });

  const summarySheet = buildSummarySheet(project, roomRefs, withHeavyFormatting);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary Sheet');

  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const data = new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const projectName = String(project?.name || 'Project')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '');

  const fileName = `VRF_HEAT_LOAD_${projectName}_${formatDateForFileName()}.xlsx`;
  const url = window.URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
