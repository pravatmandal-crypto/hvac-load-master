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
  getRecommendedAch,
  calculateSingleElementGain,
} from '../lib/hvac-logic';

type SeasonKey = 'summer' | 'monsoon' | 'winter';

type SeasonProfile = {
  key: SeasonKey;
  label: string;
  outdoorTemp: number;
  outdoorHumidity: number;
  indoorTemp: number;
  indoorHumidity: number;
};

type RoomMetrics = {
  area: number;
  ventilationCfm: number;
  heatingLoad: number;
  coolingBTUH: number;
  loadTR: number;
  cfmTR: number;
  governingTR: number;
  requiredTR: number;
  designCFM: number;
  coilSensible: number;
  coilLatent: number;
  envelopeSensible: number;
  internalSensible: number;
  internalLatent: number;
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

const THEME = {
  ink: [25, 25, 25] as [number, number, number],
  subInk: [80, 80, 80] as [number, number, number],
  line: [185, 185, 185] as [number, number, number],
  panel: [245, 245, 245] as [number, number, number],
  panelDark: [230, 230, 230] as [number, number, number],
};

const PAGE = {
  left: 14,
  right: 14,
  top: 18,
  bottom: 14,
};

const asNum = (value: any, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const n0 = (value: number) => Math.round(value).toLocaleString();
const n2 = (value: number) => value.toFixed(2);

const drawHeader = (doc: jsPDF, project: any, pageNo: number) => {
  const w = doc.internal.pageSize.getWidth();
  doc.setDrawColor(...THEME.line);
  doc.setLineWidth(0.2);
  doc.line(PAGE.left, PAGE.top - 7, w - PAGE.right, PAGE.top - 7);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...THEME.subInk);
  doc.text(String(project?.name || 'Project').toUpperCase(), PAGE.left, PAGE.top - 9.5);

  doc.setFont('helvetica', 'normal');
  doc.text('HVAC TECHNICAL SUBMISSION REPORT', w - PAGE.right, PAGE.top - 9.5, { align: 'right' });
  doc.text(`Page ${pageNo}`, w - PAGE.right, PAGE.top - 5.5, { align: 'right' });
};

const drawFooter = (doc: jsPDF) => {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setDrawColor(...THEME.line);
  doc.setLineWidth(0.2);
  doc.line(PAGE.left, h - PAGE.bottom + 2, w - PAGE.right, h - PAGE.bottom + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...THEME.subInk);
  doc.text('Prepared for approval and procurement documentation', PAGE.left, h - PAGE.bottom + 6);
};

const getSeasonProfiles = (project: any): SeasonProfile[] => {
  const indoorSummerTemp = asNum(project?.insideSummerTemp ?? project?.summerIndoorTemp, 75);
  const indoorSummerRh = asNum(project?.insideSummerHumidity ?? project?.summerIndoorHumidity, 50);

  const profiles: SeasonProfile[] = [
    {
      key: 'summer',
      label: 'Summer',
      outdoorTemp: asNum(project?.summerDesignTemp, 95),
      outdoorHumidity: asNum(project?.summerDesignHumidity, 50),
      indoorTemp: indoorSummerTemp,
      indoorHumidity: indoorSummerRh,
    },
  ];

  const includeMonsoon = !!(project?.includeMonsoon ?? project?.data?.includeMonsoon);
  if (includeMonsoon) {
    profiles.push({
      key: 'monsoon',
      label: 'Monsoon',
      outdoorTemp: asNum(project?.monsoonDesignTemp, 85),
      outdoorHumidity: asNum(project?.monsoonDesignHumidity, 85),
      indoorTemp: asNum(project?.insideMonsoonTemp, indoorSummerTemp),
      indoorHumidity: asNum(project?.insideMonsoonHumidity, 55),
    });
  }

  profiles.push({
    key: 'winter',
    label: 'Winter',
    outdoorTemp: asNum(project?.winterDesignTemp, 40),
    outdoorHumidity: asNum(project?.winterDesignHumidity, 30),
    indoorTemp: asNum(project?.insideWinterTemp ?? project?.winterIndoorTemp, 72),
    indoorHumidity: asNum(project?.insideWinterHumidity ?? project?.winterIndoorHumidity, 40),
  });

  return profiles;
};

const buildEntityRecords = (
  project: any,
  systems: any[],
  zones: any[],
  rooms: Record<string, any[]>,
): EntityRecord[] => {
  if (project?.systemType === 'VRF') {
    return systems.map((sys: any) => ({
      id: sys.id,
      type: 'System',
      name: sys.name || `System ${sys.id}`,
      indoorTemp: sys.indoorTemp,
      indoorHumidity: sys.indoorHumidity,
      outdoorTemp: sys.outdoorTemp,
      outdoorHumidity: sys.outdoorHumidity,
      winterIndoorTemp: sys.winterIndoorTemp,
      winterIndoorHumidity: sys.winterIndoorHumidity,
      rooms: rooms[sys.id] || [],
    }));
  }

  return zones.map((zone: any) => {
    const parent = systems.find((s: any) => s.id === zone.systemId);
    return {
      id: zone.id,
      type: 'Zone',
      name: zone.name || `Zone ${zone.id}`,
      parentSystem: parent?.name,
      indoorTemp: zone.indoorTemp,
      indoorHumidity: zone.indoorHumidity,
      outdoorTemp: zone.outdoorTemp,
      outdoorHumidity: zone.outdoorHumidity,
      winterIndoorTemp: zone.winterIndoorTemp,
      winterIndoorHumidity: zone.winterIndoorHumidity,
      rooms: rooms[zone.id] || [],
    };
  });
};

const computeRoomMetrics = (
  room: any,
  elements: any[],
  dc: {
    outdoorTemp: number;
    indoorTemp: number;
    outdoorHumidity: number;
    indoorHumidity: number;
    altitude: number;
    winterOutdoorTemp: number;
    winterOutdoorHumidity: number;
  },
  project: any,
): RoomMetrics => {
  const BF = 0.15;

  const sSafety = asNum(room?.sensibleSafetyPercent ?? room?.sensibleSafetyFactor, 10) / 100;
  const lSafety = asNum(room?.latentSafetyPercent ?? room?.latentSafetyFactor, 5) / 100;
  const oSafety = asNum(room?.overallSafetyPercent ?? room?.grandTotalSafetyFactor, 3) / 100;

  const envelope = calculateEnvelopeGain(elements, dc);
  const internal = calculateInternalGains(room);
  const vent = calculateVentilationLoad(room, dc);
  const heating = calculateHeatingLoad(room, elements, dc);

  const baseErSensible = envelope.sensible + internal.sensible + vent.sensible * BF;
  const baseErLatent = internal.latent + vent.latent * BF;
  const parasitic = calculateParasiticGains(baseErSensible, baseErSensible, asNum(room?.ductGainPct, 2), asNum(room?.fanGainPct, 3));

  const ersh = (baseErSensible + parasitic.ductGain + parasitic.fanGain) * (1 + sSafety);
  const erlh = baseErLatent * (1 + lSafety);
  const oaSensible = (1 - BF) * vent.sensible;
  const oaLatent = (1 - BF) * vent.latent;
  const coilSensible = ersh + oaSensible;
  const coilLatent = erlh + oaLatent;

  const coolingBTUH = coilSensible + coilLatent;
  const loadTR = coolingBTUH / 12000;

  const isChiller = String(project?.systemType || '').toLowerCase().includes('chiller');
  const coil = calculateCoilParameters(
    coilSensible,
    coilLatent,
    dc.indoorTemp,
    dc.indoorHumidity,
    asNum(dc.altitude, 0),
    BF,
    35,
    65,
    isChiller ? 45 : 54,
  );

  const totalSupplyAch = Math.max(getRecommendedAch(room?.achProfile ?? room?.activityType), asNum(room?.facph, 0));
  const totalSupplyCfm = (calculateRoomVolume(room) * totalSupplyAch) / 60;
  const designCFM = Math.max(coil.dehumidifiedCFM, totalSupplyCfm);

  const cfmTR = (designCFM * 1.08 * 20) / 12000;
  const governingTR = Math.max(loadTR, cfmTR);
  const requiredTR = governingTR * (1 + oSafety);

  return {
    area: asNum(room?.length, 0) * asNum(room?.width, 0),
    ventilationCfm: asNum(vent.cfm, 0),
    heatingLoad: asNum(heating.totalHeatingLoad, 0),
    coolingBTUH,
    loadTR,
    cfmTR,
    governingTR,
    requiredTR,
    designCFM,
    coilSensible,
    coilLatent,
    envelopeSensible: asNum(envelope.sensible, 0),
    internalSensible: asNum(internal.sensible, 0),
    internalLatent: asNum(internal.latent, 0),
  };
};

const resolveEntityConditions = (entity: EntityRecord, season: SeasonProfile, project: any) => {
  if (season.key === 'winter') {
    return {
      outdoorTemp: asNum(project?.winterDesignTemp, season.outdoorTemp),
      outdoorHumidity: asNum(project?.winterDesignHumidity, season.outdoorHumidity),
      indoorTemp: asNum(entity.winterIndoorTemp, season.indoorTemp),
      indoorHumidity: asNum(entity.winterIndoorHumidity, season.indoorHumidity),
      winterOutdoorTemp: asNum(project?.winterDesignTemp, season.outdoorTemp),
      winterOutdoorHumidity: asNum(project?.winterDesignHumidity, season.outdoorHumidity),
      altitude: asNum(project?.altitude, 0),
    };
  }

  return {
    outdoorTemp: asNum(entity.outdoorTemp, season.outdoorTemp),
    outdoorHumidity: asNum(entity.outdoorHumidity, season.outdoorHumidity),
    indoorTemp: asNum(entity.indoorTemp, season.indoorTemp),
    indoorHumidity: asNum(entity.indoorHumidity, season.indoorHumidity),
    winterOutdoorTemp: asNum(project?.winterDesignTemp, season.outdoorTemp),
    winterOutdoorHumidity: asNum(project?.winterDesignHumidity, season.outdoorHumidity),
    altitude: asNum(project?.altitude, 0),
  };
};

const sectionTitle = (doc: jsPDF, text: string, y: number) => {
  doc.setFillColor(...THEME.panel);
  doc.rect(PAGE.left, y - 4, doc.internal.pageSize.getWidth() - PAGE.left - PAGE.right, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...THEME.ink);
  doc.text(text, PAGE.left + 2, y + 0.8);
};

export const generatePDFReport = (
  project: any,
  systems: any[],
  zones: any[],
  rooms: Record<string, any[]>,
  envelopeElements: Record<string, any[]>,
) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const seasons = getSeasonProfiles(project);
  const entities = buildEntityRecords(project, systems, zones, rooms);

  const addBodyPage = () => {
    doc.addPage();
    drawHeader(doc, project, doc.getCurrentPageInfo().pageNumber);
    drawFooter(doc);
    return PAGE.top + 2;
  };

  // Cover page
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...THEME.ink);
  doc.text('HVAC LOAD CALCULATION REPORT', PAGE.left, 38);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...THEME.subInk);
  doc.text('Technical submission document for design approval', PAGE.left, 45);

  doc.setDrawColor(...THEME.line);
  doc.setLineWidth(0.4);
  doc.line(PAGE.left, 50, pageW - PAGE.right, 50);

  const coverRows = [
    ['Project Name', String(project?.name || 'N/A')],
    ['Project ID', String(project?.id || 'N/A')],
    ['Location', String(project?.location || project?.place || 'N/A')],
    ['System Type', String(project?.systemType || 'N/A')],
    ['Prepared Date', new Date().toLocaleDateString()],
    ['Design Basis', project?.includeMonsoon ? 'Summer + Monsoon + Winter' : 'Summer + Winter'],
  ];

  autoTable(doc, {
    startY: 62,
    body: coverRows,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 3, textColor: THEME.ink },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: THEME.panel, cellWidth: 45 },
      1: { cellWidth: 130 },
    },
    margin: { left: PAGE.left, right: PAGE.right },
  });

  drawFooter(doc);

  let y = addBodyPage();

  sectionTitle(doc, '1. PROJECT DESIGN CONDITIONS', y);
  y += 7;

  const conditionHeader = ['Condition', ...seasons.map((s) => s.label)];
  const conditionRows = [
    ['Outdoor Dry Bulb (F)', ...seasons.map((s) => n0(s.outdoorTemp))],
    ['Outdoor RH (%)', ...seasons.map((s) => n0(s.outdoorHumidity))],
    ['Indoor Dry Bulb (F)', ...seasons.map((s) => n0(s.indoorTemp))],
    ['Indoor RH (%)', ...seasons.map((s) => n0(s.indoorHumidity))],
  ];

  autoTable(doc, {
    startY: y,
    head: [conditionHeader],
    body: conditionRows,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2.5, textColor: THEME.ink },
    headStyles: { fillColor: THEME.panelDark, textColor: THEME.ink, fontStyle: 'bold' },
    margin: { left: PAGE.left, right: PAGE.right },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  sectionTitle(doc, '2. PROJECT EXECUTIVE SUMMARY', y);
  y += 7;

  let allRooms: any[] = [];
  entities.forEach((entity) => {
    allRooms = allRooms.concat(entity.rooms);
  });

  const projectSeasonSummary = seasons.map((season) => {
    let cooling = 0;
    let heating = 0;
    let cfm = 0;

    entities.forEach((entity) => {
      const dc = resolveEntityConditions(entity, season, project);
      entity.rooms.forEach((room) => {
        const metrics = computeRoomMetrics(room, envelopeElements[room.id] || [], dc, project);
        cooling += metrics.coolingBTUH;
        cfm += metrics.designCFM;
        if (season.key === 'winter') heating += metrics.heatingLoad;
      });
    });

    const loadTR = cooling / 12000;
    const cfmTR = (cfm * 1.08 * 20) / 12000;
    return {
      season: season.label,
      cooling,
      loadTR,
      cfm,
      cfmTR,
      heating,
      governingTR: Math.max(loadTR, cfmTR),
    };
  });

  autoTable(doc, {
    startY: y,
    head: [['Season', 'Cooling BTU/h', 'Load TR', 'Design CFM', 'CFM TR', 'Governing TR', 'Winter Heating BTU/h']],
    body: projectSeasonSummary.map((s) => [
      s.season,
      n0(s.cooling),
      n2(s.loadTR),
      n0(s.cfm),
      n2(s.cfmTR),
      n2(s.governingTR),
      s.season === 'Winter' ? n0(s.heating) : '-',
    ]),
    theme: 'grid',
    styles: { fontSize: 8.2, cellPadding: 2.4, textColor: THEME.ink },
    headStyles: { fillColor: THEME.panelDark, textColor: THEME.ink, fontStyle: 'bold' },
    margin: { left: PAGE.left, right: PAGE.right },
  });

  y = (doc as any).lastAutoTable.finalY + 8;

  const peakSeason = projectSeasonSummary.reduce((acc, cur) => cur.governingTR > acc.governingTR ? cur : acc, projectSeasonSummary[0]);
  autoTable(doc, {
    startY: y,
    body: [
      ['Total Systems', n0(systems.length)],
      ['Total Zones', n0(zones.length)],
      ['Total Rooms', n0(allRooms.length)],
      ['Peak Governing Season', `${peakSeason.season} (${n2(peakSeason.governingTR)} TR)`],
      ['Recommended Submission Basis', `${n2(Math.max(...projectSeasonSummary.map((s) => s.governingTR)))} TR and ${n0(Math.max(...projectSeasonSummary.map((s) => s.cfm)))} CFM`],
    ],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2.6, textColor: THEME.ink },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: THEME.panel, cellWidth: 75 },
    },
    margin: { left: PAGE.left, right: PAGE.right },
  });

  y = addBodyPage();
  sectionTitle(doc, '3. SYSTEM/ZONE SUMMARY SCHEDULE', y);
  y += 7;

  const summaryRows = entities.map((entity) => {
    const summer = seasons.find((s) => s.key === 'summer')!;
    const monsoon = seasons.find((s) => s.key === 'monsoon');
    const winter = seasons.find((s) => s.key === 'winter')!;

    const summerDc = resolveEntityConditions(entity, summer, project);
    const monsoonDc = monsoon ? resolveEntityConditions(entity, monsoon, project) : null;
    const winterDc = resolveEntityConditions(entity, winter, project);

    let summerLoad = 0;
    let summerCfm = 0;
    let monsoonLoad = 0;
    let monsoonCfm = 0;
    let winterHeat = 0;

    entity.rooms.forEach((room) => {
      const summerMetrics = computeRoomMetrics(room, envelopeElements[room.id] || [], summerDc, project);
      summerLoad += summerMetrics.loadTR;
      summerCfm += summerMetrics.designCFM;

      if (monsoonDc) {
        const monsoonMetrics = computeRoomMetrics(room, envelopeElements[room.id] || [], monsoonDc, project);
        monsoonLoad += monsoonMetrics.loadTR;
        monsoonCfm += monsoonMetrics.designCFM;
      }

      const winterMetrics = computeRoomMetrics(room, envelopeElements[room.id] || [], winterDc, project);
      winterHeat += winterMetrics.heatingLoad;
    });

    const sumCfmTr = (summerCfm * 1.08 * 20) / 12000;
    const monCfmTr = (monsoonCfm * 1.08 * 20) / 12000;
    const governingTr = Math.max(summerLoad, monsoonLoad, sumCfmTr, monCfmTr);

    return [
      entity.type,
      entity.parentSystem || '-',
      entity.name,
      n0(entity.rooms.length),
      n2(summerLoad),
      monsoon ? n2(monsoonLoad) : '-',
      n0(Math.max(summerCfm, monsoonCfm)),
      n0(winterHeat),
      n2(governingTr),
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [['Type', 'Parent', 'Name', 'Rooms', 'Summer TR', 'Monsoon TR', 'Design CFM', 'Winter Heat BTU/h', 'Governing TR']],
    body: summaryRows,
    theme: 'grid',
    styles: { fontSize: 7.8, cellPadding: 2.1, textColor: THEME.ink },
    headStyles: { fillColor: THEME.panelDark, textColor: THEME.ink, fontStyle: 'bold' },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 14 },
      2: { fontStyle: 'bold', cellWidth: 30 },
      7: { cellWidth: 27 },
    },
    margin: { left: PAGE.left, right: PAGE.right },
  });

  for (const entity of entities) {
    y = addBodyPage();

    sectionTitle(doc, `4. ${entity.type.toUpperCase()} DETAIL - ${String(entity.name || '').toUpperCase()}`, y);
    y += 7;

    autoTable(doc, {
      startY: y,
      body: [
        ['Entity Type', entity.type],
        ['Entity Name', entity.name],
        ['Parent System', entity.parentSystem || '-'],
        ['No. of Rooms', n0(entity.rooms.length)],
      ],
      theme: 'grid',
      styles: { fontSize: 8.4, cellPadding: 2.2, textColor: THEME.ink },
      columnStyles: { 0: { fontStyle: 'bold', fillColor: THEME.panel, cellWidth: 48 } },
      margin: { left: PAGE.left, right: PAGE.right },
    });

    y = (doc as any).lastAutoTable.finalY + 6;

    const summer = seasons.find((s) => s.key === 'summer')!;
    const monsoon = seasons.find((s) => s.key === 'monsoon');
    const winter = seasons.find((s) => s.key === 'winter')!;

    const roomScheduleRows = entity.rooms.map((room: any) => {
      const summerM = computeRoomMetrics(room, envelopeElements[room.id] || [], resolveEntityConditions(entity, summer, project), project);
      const monsoonM = monsoon
        ? computeRoomMetrics(room, envelopeElements[room.id] || [], resolveEntityConditions(entity, monsoon, project), project)
        : null;
      const winterM = computeRoomMetrics(room, envelopeElements[room.id] || [], resolveEntityConditions(entity, winter, project), project);

      return [
        room.name || '-',
        room.floor || '-',
        n0(summerM.area),
        n2(summerM.loadTR),
        monsoonM ? n2(monsoonM.loadTR) : '-',
        n0(Math.max(summerM.designCFM, monsoonM?.designCFM || 0)),
        n0(winterM.heatingLoad),
        n2(Math.max(summerM.governingTR, monsoonM?.governingTR || 0)),
      ];
    });

    autoTable(doc, {
      startY: y,
      head: [['Room', 'Floor', 'Area ft2', 'Summer TR', 'Monsoon TR', 'Design CFM', 'Winter Heat BTU/h', 'Gov TR']],
      body: roomScheduleRows,
      theme: 'grid',
      styles: { fontSize: 7.6, cellPadding: 1.9, textColor: THEME.ink },
      headStyles: { fillColor: THEME.panelDark, textColor: THEME.ink, fontStyle: 'bold' },
      margin: { left: PAGE.left, right: PAGE.right },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 30 } },
    });

    y = (doc as any).lastAutoTable.finalY + 6;

    for (const room of entity.rooms) {
      if (y > pageH - 80) {
        y = addBodyPage();
      }

      doc.setFillColor(...THEME.panel);
      doc.rect(PAGE.left, y - 3, pageW - PAGE.left - PAGE.right, 6, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.8);
      doc.setTextColor(...THEME.ink);
      doc.text(`Room Detail: ${String(room.name || '-')} (${String(room.floor || '-')})`, PAGE.left + 2, y + 1);
      y += 7;

      const summerDc = resolveEntityConditions(entity, summer, project);
      const summerM = computeRoomMetrics(room, envelopeElements[room.id] || [], summerDc, project);
      const elems = envelopeElements[room.id] || [];

      autoTable(doc, {
        startY: y,
        body: [
          ['Length x Width x Height (ft)', `${asNum(room.length, 0)} x ${asNum(room.width, 0)} x ${asNum(room.height, 0)}`],
          ['People / Activity', `${n0(asNum(room.peopleCount, 0))} / ${String(room.activityType || '-')}`],
          ['Lighting / Equipment / Others', `${asNum(room.lightsWattsPerSqft, 0)} W/ft2, ${asNum(room.equipmentKW, 0)} kW, ${asNum(room.othersKW, 0)} kW`],
          ['Ventilation CFM', n0(summerM.ventilationCfm)],
          ['Summer Load TR', n2(summerM.loadTR)],
          ['CFM TR', n2(summerM.cfmTR)],
          ['Governing TR', n2(summerM.governingTR)],
          ['Required TR (with safety)', n2(summerM.requiredTR)],
          ['Design Supply CFM', n0(summerM.designCFM)],
        ],
        theme: 'grid',
        styles: { fontSize: 7.4, cellPadding: 1.7, textColor: THEME.ink },
        columnStyles: { 0: { fontStyle: 'bold', fillColor: THEME.panel, cellWidth: 55 } },
        margin: { left: PAGE.left, right: PAGE.right },
      });

      y = (doc as any).lastAutoTable.finalY + 2;

      const envelopeRows = elems.map((el: any) => {
        const gain = calculateSingleElementGain(el, summerDc);
        return [
          String(el.type || '-'),
          String(el.orientation || '-'),
          n0(asNum(el.area, 0)),
          asNum(el.uValue, 0).toFixed(3),
          asNum(el.solarFactor, 0).toFixed(2),
          n0(asNum(gain.total, 0)),
        ];
      });

      autoTable(doc, {
        startY: y,
        head: [['Envelope', 'Orient', 'Area', 'U', 'CLTD/SCL', 'Gain BTU/h']],
        body: envelopeRows.length > 0 ? envelopeRows : [['-', '-', '-', '-', '-', '-']],
        theme: 'grid',
        styles: { fontSize: 7.2, cellPadding: 1.5, textColor: THEME.ink },
        headStyles: { fillColor: THEME.panelDark, textColor: THEME.ink, fontStyle: 'bold' },
        margin: { left: PAGE.left, right: PAGE.right },
      });

      y = (doc as any).lastAutoTable.finalY + 5;
    }
  }

  // redraw consistent header/footer on body pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 2; p <= totalPages; p++) {
    doc.setPage(p);
    drawHeader(doc, project, p);
    drawFooter(doc);
  }

  const fileName = `${String(project?.name || 'HVAC_Report').replace(/\s+/g, '_')}_Approval_Report.pdf`;
  doc.save(fileName);
};
