"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '../../lib/utils';
import { calculatePsychrometrics, dewPointFromHumidityRatio } from '../../lib/hvac';
import { FileText, ChevronDown, ChevronRight, Wand2, Save, Printer, CheckCircle2, Download } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { NumericInput } from '../ui/numeric-input';
import { toast } from 'sonner';
import type { EquipmentSystem, AHUConfig, ODUCombinationUnit, SingleUnitSelection } from '../../types/equipment-systems';
import type { AHUData, AHUZoneData, ChillerData, CTData, PackageData, HumidifierData, FullSpec } from '../../types/equipment-specs';

// Effective per-unit capacity at site conditions: prefer actualTR (OEM-confirmed
// at this project's entering CW/ambient temps), fall back to catalog Nominal TR.
const effUnitTR = (u: ODUCombinationUnit) => (u.actualTR != null && u.actualTR > 0 ? u.actualTR : u.trCapacity);

// ─── Auto-fill helpers ────────────────────────────────────────────────────────

function approxWBF(dbF: number, rhPct: number): number {
  const T = (dbF - 32) * 5 / 9;
  const wbC = T * Math.atan(0.151977 * Math.sqrt(rhPct + 8.313659))
    + Math.atan(T + rhPct)
    - Math.atan(rhPct - 1.676331)
    + 0.00391838 * Math.pow(rhPct, 1.5) * Math.atan(0.023101 * rhPct)
    - 4.686035;
  return parseFloat((wbC * 9 / 5 + 32).toFixed(1));
}

function dn(lps: number): number {
  if (lps <= 0.5) return 25;
  if (lps <= 1.5) return 32;
  if (lps <= 3)   return 40;
  if (lps <= 6)   return 50;
  if (lps <= 12)  return 65;
  if (lps <= 25)  return 80;
  if (lps <= 50)  return 100;
  if (lps <= 80)  return 125;
  return 150;
}

function fToC(f: number) { return parseFloat(((f - 32) * 5 / 9).toFixed(1)); }

// When `exactTR` is true, the passed `tr` is taken as the per-unit cooling
// capacity exactly (e.g., the user-selected AHU catalog TR) — no 10% safety
// is added. When false (default), `tr` is treated as a load requirement and
// the function adds 10% safety + rounds up to the nearest 0.5 TR.
function buildAHU(project: any, psychro: any, tr: number, cfm: number, systemOACFM = 0, config?: AHUConfig, ventHeatingKW = 0, reheatKW = 0, ahuQuantity = 1, exactTR = false): AHUData {
  const odbF = Number(project?.summerDesignTemp ?? 95);
  const oRH  = Number(project?.summerDesignHumidity ?? 60);
  const idbF = psychro?.indoorTemp ?? 75;
  const iRH  = psychro?.indoorRH ?? 50;
  const owbF = approxWBF(odbF, oRH);
  const iwbF = approxWBF(idbF, iRH);
  const oaCFM = systemOACFM > 0 && cfm > 0 ? Math.round(systemOACFM) : Math.round(cfm * 15 / 100);
  const oaPct = cfm > 0 ? Math.round((oaCFM / cfm) * 100) : 15;
  const retCFM = Math.max(0, cfm - oaCFM);
  const mixDB = cfm > 0 ? (odbF * oaCFM + idbF * retCFM) / cfm : odbF;
  const mixWB = cfm > 0 ? (owbF * oaCFM + iwbF * retCFM) / cfm : owbF;
  const lvDB = (psychro?.coil as any)?.supplyTemp ?? 55;
  const lvRH = (psychro?.coil as any)?.supplyRH ?? 95;
  // Apparatus dew point (coil surface temp) + off-coil dew point — the coil-selection
  // drivers the AHU vendor needs. ADP must sit below the room dew point to hold design RH.
  const adpRaw = (psychro?.coil as any)?.selectedADP;
  const adpF = Number.isFinite(Number(adpRaw)) ? parseFloat(Number(adpRaw).toFixed(1)) : undefined;
  const altF = Number(project?.altitude ?? project?.data?.altitude ?? 0);
  let lvDPF: number | undefined;
  try {
    const lp = calculatePsychrometrics(Number(lvDB), Number(lvRH), altF);
    lvDPF = parseFloat(dewPointFromHumidityRatio(lp.humidityRatio, altF).toFixed(1));
  } catch { /* ignore psychro errors */ }
  // exactTR=true → caller passed the selected catalog per-unit TR; use as-is.
  // exactTR=false → caller passed a load requirement; add 10% safety and round to 0.5 TR.
  const capTR = exactTR ? parseFloat(tr.toFixed(2)) : Math.ceil(tr * 1.1 * 2) / 2;
  const capKW = parseFloat((capTR * 3.517).toFixed(1));
  const flow  = parseFloat((capKW / (4.186 * 5)).toFixed(2));
  const extSP = config?.extStaticPa ?? 150;
  // TSP = ESP + internal resistance (coils + filters + casing); used only for fan motor estimate
  const internalSP = 200;
  const totSP = extSP + internalSP;
  const fanKW = cfm > 0 ? parseFloat(((cfm * 0.000472 * totSP) / (0.65 * 0.88 * 1000)).toFixed(2)) : 0;

  const fCurve = config?.fanCurve ?? 'backward-curved';
  const fDrive = config?.fanDrive ?? 'belt-driven';
  const fanCurveLabel = fCurve === 'forward-curved' ? 'Forward Curved SISW' : 'Backward Curved DIDW';
  const fanDriveLabel = fDrive === 'plug-fan' ? 'Direct Drive (Plug Fan)' : 'Belt Driven';

  const hasHeat = config?.hasHeatingCoil ?? false;
  // Use LC-based heating loads if available; fall back to 30% of cooling capacity
  const heatingFromVent = ventHeatingKW;    // space heating (ventilation component, from LC FACPH + winter ΔT)
  const heatingFromDehumid = reheatKW;       // dehumidification reheat (from LC room analysis)
  const heatingFallback = capTR * 0.3 * 3.517;
  const heatCapRaw = Math.max(heatingFromVent, heatingFromDehumid);
  const heatCapKW = hasHeat ? parseFloat(((heatCapRaw > 0 ? heatCapRaw : heatingFallback) * 1.1).toFixed(1)) : 0;
  const hwSup = 60; const hwRet = 50;
  const hwFlowLPS = hasHeat ? parseFloat((heatCapKW / (4.186 * (hwSup - hwRet))).toFixed(2)) : 0;

  const hasPre  = config?.filters?.pre  ?? true;
  const hasFine = config?.filters?.fine ?? true;
  const hasHepa = config?.filters?.hepa ?? false;
  const hasMixBox = config?.hasMixingBox ?? true;
  const coolRows = config?.coolingCoilRows ?? 6;
  const heatRows = config?.heatingCoilRows ?? 2;

  // ── Approximate AHU dimensions ──────────────────────────────────────────────
  // Face area at standard coil face velocity 2.5 m/s
  const faceVel = 2.5; // m/s
  const q_m3s   = cfm * 0.000472;
  const faceArea = cfm > 0 ? q_m3s / faceVel : 0; // m²
  // W:H aspect ratio 1.3 (typical floor-standing)
  const aspect = 1.3;
  const ahuH = faceArea > 0 ? Math.ceil(Math.sqrt(faceArea / aspect) * 1000 / 50) * 50 : 0; // mm
  const ahuW = faceArea > 0 ? Math.ceil(Math.sqrt(faceArea * aspect) * 1000 / 50) * 50 : 0;

  // Section lengths in airflow direction (mm)
  const rowPitch = 38; // mm per coil row (standard fin-and-tube)
  let ahuL = 0;
  if (hasMixBox) ahuL += 600;
  if (hasPre)    ahuL += 300;
  const coolCoilD = Math.ceil((coolRows * rowPitch + 100) / 50) * 50; // coil + clearance
  ahuL += coolCoilD;
  const heatCoilD = hasHeat ? Math.ceil((heatRows * rowPitch + 80) / 50) * 50 : 0;
  if (hasHeat) ahuL += heatCoilD;
  if (hasFine)   ahuL += 300;
  if (hasHepa)   ahuL += 400;
  // Fan section varies by airflow
  ahuL += cfm < 3000 ? 800 : cfm < 8000 ? 1000 : cfm < 20000 ? 1200 : 1500;
  ahuL += 200; // outlet/access
  ahuL = Math.ceil(ahuL / 50) * 50;

  // Coil face dims match casing face; coil tube depth (no headers)
  const coolCoilTubeDepth = coolRows * rowPitch;
  const heatCoilTubeDepth = hasHeat ? heatRows * rowPitch : 0;

  return {
    quantity: ahuQuantity,
    supplyAirCFM: Math.round(cfm),
    outsideAirPct: oaPct,
    outsideAirCFM: oaCFM,
    returnAirCFM: retCFM,
    outdoorDBF: Math.round(odbF),
    outdoorWBF: Math.round(owbF),
    roomDBF: Math.round(idbF),
    roomRHPct: iRH,
    mixedAirDBF: parseFloat(mixDB.toFixed(1)),
    mixedAirWBF: parseFloat(mixWB.toFixed(1)),
    leavingAirDBF: parseFloat(String(lvDB)),
    leavingAirRHPct: lvRH,
    leavingAirDPF: lvDPF,
    apparatusDewPointF: adpF,
    coolingCapTR: capTR,
    coolingCapKW: capKW,
    coilType: `Chilled Water (${coolRows}-Row Coil)`,
    chwSupplyTempC: 7,
    chwReturnTempC: 12,
    chwFlowLPS: flow,
    chwPipeDN: dn(flow),
    coolingCoilRows: coolRows,
    coolCoilWidthMM: ahuW,
    coolCoilHeightMM: ahuH,
    coolCoilDepthMM: coolCoilTubeDepth,
    heatingCoil: hasHeat,
    heatingCapKW: heatCapKW,
    hwTempC: hasHeat ? '60 / 50' : '',
    hwSupplyTempC: hwSup,
    hwReturnTempC: hwRet,
    hwFlowLPS,
    hwPipeDN: hasHeat ? dn(hwFlowLPS) : 0,
    heatingCoilRows: hasHeat ? heatRows : 0,
    heatCoilDepthMM: heatCoilTubeDepth,
    heatVentLoadKW: hasHeat && heatingFromVent > 0 ? parseFloat(heatingFromVent.toFixed(1)) : undefined,
    heatReheatKW: hasHeat && heatingFromDehumid > 0 ? parseFloat(heatingFromDehumid.toFixed(1)) : undefined,
    fanType: `${fanCurveLabel}, ${fanDriveLabel}`,
    fanCurve: fanCurveLabel,
    fanDrive: fanDriveLabel,
    extStaticPa: extSP,
    totalStaticPa: totSP,
    fanMotorKW: fanKW,
    hasMixingBox: hasMixBox,
    preFilterGrade: hasPre  ? (config?.preFilterGrade  ?? 'G4 (EU4 / MERV-8)')   : 'Not Provided',
    finalFilterGrade: hasFine ? (config?.fineFilterGrade ?? 'F7 (EU7 / MERV-13)') : 'Not Provided',
    hepaFilter: hasHepa,
    hepaFilterGrade: hasHepa ? (config?.hepaFilterGrade ?? 'H14') : '',
    ahuLengthMM: ahuL,
    ahuWidthMM: ahuW,
    ahuHeightMM: ahuH,
    casingMaterial: 'Double-skin GI, 50 mm PU foam insulation',
    supplyDuctMM: '',
    returnDuctMM: '',
    notes: '',
  };
}

// buildChiller — when selectedUnits is provided, use the installed working
// capacity & quantity from the user's selection (standby units excluded —
// redundancy doesn't count toward plant duty). Otherwise fall back to
// load-derived generic sizing (loadTR × 1.1 safety).
function buildChiller(tr: number, isWC: boolean, selectedUnits?: ODUCombinationUnit[]): ChillerData {
  const workingUnits = (selectedUnits ?? []).filter(u => (u.role ?? 'working') === 'working');
  let perUnitTR: number;
  let quantity: number;
  let autoNote: string;

  if (workingUnits.length > 0) {
    const totalTR  = workingUnits.reduce((s, u) => s + effUnitTR(u) * u.quantity, 0);
    const totalQty = workingUnits.reduce((s, u) => s + u.quantity, 0);
    const distinctModels = new Set(workingUnits.map(u => `${u.brand}|${u.modelSeries}|${effUnitTR(u)}`));
    const homogeneous = distinctModels.size === 1;
    perUnitTR = homogeneous ? effUnitTR(workingUnits[0]) : parseFloat((totalTR / totalQty).toFixed(2));
    quantity  = totalQty;
    autoNote  = homogeneous
      ? `Plant: ${totalQty} × ${perUnitTR.toFixed(1)} TR working = ${totalTR.toFixed(1)} TR installed (standby units excluded).`
      : `Plant: ${totalTR.toFixed(1)} TR total across ${totalQty} working units (mixed models — see Equipment Schedule for breakdown).`;
  } else {
    perUnitTR = Math.ceil(tr * 1.1 * 2) / 2;
    quantity  = 1;
    autoNote  = '';
  }

  const capTR = perUnitTR;
  const capKW = parseFloat((capTR * 3.517).toFixed(1));
  const cop   = isWC ? 5.0 : 3.5;
  const ipKW  = parseFloat((capKW / cop).toFixed(1));
  const chFl  = parseFloat((capKW / (4.186 * 5)).toFixed(2));
  const cwFl  = isWC ? parseFloat(((capKW + ipKW) / (4.186 * 6)).toFixed(2)) : 0;
  return {
    quantity,
    coolingCapTR: capTR,
    coolingCapKW: capKW,
    copRated: cop,
    refrigerant: 'R-134a',
    condenserType: isWC ? 'Water-Cooled (Shell & Tube)' : 'Air-Cooled (Microchannel Coil)',
    chwSupplyTempC: 7,
    chwReturnTempC: 12,
    chwFlowLPS: chFl,
    chwPipeDN: dn(chFl),
    cwSupplyTempC: isWC ? 29 : 0,
    cwReturnTempC: isWC ? 35 : 0,
    cwFlowLPS: cwFl,
    cwPipeDN: isWC ? dn(cwFl) : 0,
    inputKW: ipKW,
    voltageHz: '415 V / 3Ph / 50 Hz',
    notes: autoNote,
  };
}

// buildCT — when selectedCTUnits provided, use installed working CT capacity
// (standby excluded). Otherwise size from chiller heat rejection (cap × 1.25).
function buildCT(chillerCapTR: number, chillerInputKW: number, project: any, selectedCTUnits?: ODUCombinationUnit[]): CTData {
  const workingCTs = (selectedCTUnits ?? []).filter(u => (u.role ?? 'working') === 'working');
  let perUnitTR: number;
  let quantity: number;
  let autoNote: string;

  if (workingCTs.length > 0) {
    const totalTR  = workingCTs.reduce((s, u) => s + u.trCapacity * u.quantity, 0);
    const totalQty = workingCTs.reduce((s, u) => s + u.quantity, 0);
    const distinctModels = new Set(workingCTs.map(u => `${u.brand}|${u.modelSeries}|${u.trCapacity}`));
    const homogeneous = distinctModels.size === 1;
    perUnitTR = homogeneous ? workingCTs[0].trCapacity : parseFloat((totalTR / totalQty).toFixed(2));
    quantity  = totalQty;
    autoNote  = homogeneous
      ? `Plant: ${totalQty} × ${perUnitTR.toFixed(1)} TR working = ${totalTR.toFixed(1)} TR installed (standby excluded).`
      : `Plant: ${totalTR.toFixed(1)} TR total across ${totalQty} working CTs (mixed models).`;
  } else {
    perUnitTR = Math.ceil(chillerCapTR * 1.25 * 2) / 2;
    quantity  = 1;
    autoNote  = '';
  }

  const dutyTR = perUnitTR;
  const dutyKW = parseFloat((dutyTR * 3.517).toFixed(1));
  const hot = 35; const cold = 29;
  const odbF  = Number(project?.summerDesignTemp ?? 95);
  const oRH   = Number(project?.summerDesignHumidity ?? 60);
  const wbtC  = fToC(approxWBF(odbF, oRH));
  const flow  = parseFloat((dutyKW / (4.186 * 6)).toFixed(2));
  const gpm   = Math.round(flow * 15.850);
  const fanKW = parseFloat((dutyTR * 0.025).toFixed(2));
  const pipeDn = dn(flow);
  return {
    quantity,
    dutyTR, dutyKW,
    hotWaterTempC: hot,
    coldWaterTempC: cold,
    designWBTC: wbtC,
    approach: parseFloat((cold - wbtC).toFixed(1)),
    range: hot - cold,
    waterFlowLPS: flow,
    waterFlowGPM: gpm,
    towerType: 'Induced Draft',
    flowType: 'Counter Flow',
    casingMaterial: 'FRP (Glass Fibre Reinforced)',
    fillType: 'PVC Film Fill',
    fanMotorKW: fanKW,
    inletPipeDN: pipeDn,
    outletPipeDN: pipeDn,
    notes: autoNote,
  };
}

// buildPackage — when a unit is selected, use its per-unit TR/CFM/qty;
// otherwise generic sizing from required TR with 10% safety.
function buildPackage(tr: number, cfm: number, selectedUnit?: SingleUnitSelection | null): PackageData {
  let capTR: number;
  let qty: number;
  let supplyCFM: number;
  if (selectedUnit && (selectedUnit.trCapacity ?? 0) > 0) {
    capTR     = selectedUnit.trCapacity;
    qty       = selectedUnit.quantity ?? 1;
    supplyCFM = Math.round(selectedUnit.cfmRated ?? cfm);
  } else {
    capTR     = Math.ceil(tr * 1.1 * 2) / 2;
    qty       = 1;
    supplyCFM = Math.round(cfm);
  }
  const capKW = parseFloat((capTR * 3.517).toFixed(1));
  const ipKW  = parseFloat((capKW / (10 / 3.412)).toFixed(1));
  return {
    coolingCapTR: capTR,
    coolingCapKW: capKW,
    eerRated: 10,
    refrigerant: 'R-410A',
    supplyAirCFM: supplyCFM,
    extStaticPa: 100,
    inputKW: ipKW,
    quantity: qty,
    notes: '',
  };
}

function buildHumidifier(capacityKgHr: number, type: 'steam-electrode' | 'ultrasonic' = 'steam-electrode'): HumidifierData {
  const cap = parseFloat(capacityKgHr.toFixed(1));
  if (type === 'ultrasonic') {
    return {
      capacityKgHr: cap,
      humidifierType: 'ultrasonic',
      type: 'Ultrasonic Humidifier (Piezoelectric)',
      heatingElementKW: parseFloat((cap * 0.05).toFixed(2)),
      waterConsumptionLPH: parseFloat((cap * 1.0).toFixed(1)),
      controlType: 'Modulating (0–10 V)',
      voltageHz: '230 V / 1Ph / 50 Hz',
      notes: '',
    };
  }
  return {
    capacityKgHr: cap,
    humidifierType: 'steam-electrode',
    type: 'Steam Electrode Humidifier',
    heatingElementKW: parseFloat((cap * 0.75).toFixed(1)),
    waterConsumptionLPH: parseFloat((cap * 1.1).toFixed(1)),
    controlType: 'Modulating (0–10 V)',
    voltageHz: '230 V / 1Ph / 50 Hz',
    notes: '',
  };
}

// ─── Print HTML generator ──────────────────────────────────────────────────

function row(lbl: string, val: string) {
  return `<tr><td class="lbl">${lbl}</td><td class="val">${val}</td></tr>`;
}
function section(title: string, rows: string) {
  return `<h2 class="sec">${title}</h2><table class="spec"><tbody>${rows}</tbody></table>`;
}

type EquipFilter = 'all' | 'ahu' | 'chiller' | 'ct' | 'humidifier' | 'pkg';

const EQUIP_LABELS: Record<EquipFilter, { title: string; desc: string; equipType: string }> = {
  all:        { title: 'Equipment Specification Sheet',             desc: 'Complete HVAC Equipment — For Manufacturer Enquiry / Approval',     equipType: 'Multiple Equipment' },
  ahu:        { title: 'Air Handling Unit (AHU / FCU) Specification', desc: 'AHU / FCU Terminal Unit — For Manufacturer Enquiry / Approval',   equipType: 'Air Handling Unit / FCU' },
  chiller:    { title: 'Water Chiller Specification',               desc: 'Central Chiller Plant — For Manufacturer Enquiry / Approval',        equipType: 'Water Chiller' },
  ct:         { title: 'Cooling Tower Specification',               desc: 'Cooling Tower — For Manufacturer Enquiry / Approval',               equipType: 'Cooling Tower' },
  humidifier: { title: 'Humidifier Specification',                  desc: 'Humidifier — For Manufacturer Enquiry / Approval',                 equipType: 'Humidifier' },
  pkg:        { title: 'Package AC / Ductable Split Specification', desc: 'Package / Ductable Split — For Manufacturer Enquiry / Approval',    equipType: 'Package AC Unit' },
};

function generatePrintHTML(system: EquipmentSystem, project: any, spec: FullSpec, filter: EquipFilter = 'all'): string {
  const date = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
  const pName = project?.name ?? 'Project';
  const lbl   = EQUIP_LABELS[filter];

  const hasAHU = !!((spec.ahu || (spec.ahuUnits?.length ?? 0) > 0) && (filter === 'all' || filter === 'ahu'));
  const showAHU     = hasAHU;
  const showChiller = !!(spec.chiller  && (filter === 'all' || filter === 'chiller'));
  const showCT      = !!(spec.ct       && (filter === 'all' || filter === 'ct'));
  const showHumid   = !!(spec.humidifier && (filter === 'all' || filter === 'humidifier'));
  const showPkg     = !!(spec.pkg      && (filter === 'all' || filter === 'pkg'));
  const multiGroup  = [showAHU, showChiller, showCT, showHumid, showPkg].filter(Boolean).length > 1;

  const grpHeader = (title: string) => multiGroup
    ? `<div style="background:#e8eaf6;color:#1a237e;font-size:8.5pt;font-weight:bold;padding:5px 8px;margin-top:16px;margin-bottom:0;border-left:3pt solid #1a237e;letter-spacing:0.04em;text-transform:uppercase;">${title}</div>`
    : '';

  const zoneSubHeader = (name: string) =>
    `<div style="background:#e3f2fd;color:#1565c0;font-size:8pt;font-weight:bold;padding:4px 8px;margin-top:12px;margin-bottom:0;border-left:2pt solid #1565c0;letter-spacing:0.02em;">${name}</div>`;

  const renderAHUBody = (a: AHUData): string => {
    const dbCo = (f: number) => `${f}°F (${fToC(f)}°C)`;
    let unitN = 0;
    let out = '';
    out += section(`${++unitN}. Air Performance`, [
      row('Total Supply Air Volume',         `${a.supplyAirCFM.toLocaleString()} CFM`),
      row('Outside Air (Fresh Air)',          `${a.outsideAirCFM.toLocaleString()} CFM (${a.outsideAirPct}% of supply)`),
      row('Return Air',                       `${a.returnAirCFM.toLocaleString()} CFM`),
    ].join(''));
    out += section(`${++unitN}. Design Conditions`, [
      row('Outdoor Design DB / WB',           `${dbCo(a.outdoorDBF)} DB  /  ${dbCo(a.outdoorWBF)} WB`),
      row('Room (Return Air) DB / RH',        `${dbCo(a.roomDBF)} DB  /  ${a.roomRHPct}% RH`),
      row('Mixed Air (Entering Coil) DB / WB',`${a.mixedAirDBF}°F (${fToC(a.mixedAirDBF)}°C) DB  /  ${a.mixedAirWBF}°F WB`),
      row('Supply Air (Leaving Coil) DB / RH',`${a.leavingAirDBF}°F (${fToC(a.leavingAirDBF)}°C) DB  /  ${a.leavingAirRHPct}% RH`),
      ...(a.leavingAirDPF != null ? [row('Off-Coil Dew Point',       `${dbCo(a.leavingAirDPF)}`)] : []),
      ...(a.apparatusDewPointF != null ? [row('Apparatus Dew Point (ADP)', `${dbCo(a.apparatusDewPointF)}`)] : []),
    ].join(''));
    out += section(`${++unitN}. Chilled Water Coil`, [
      row('Quantity',                         `${a.quantity ?? 1} nos`),
      row('Cooling Capacity (per unit)',      `${a.coolingCapTR} TR  (${a.coolingCapKW} kW)`),
      row('Coil Type',                        a.coilType),
      row('No. of Rows',                      `${a.coolingCoilRows ?? '—'} rows`),
      row('Coil Face Dimensions (approx.)',   `${a.coolCoilWidthMM ?? '—'} W × ${a.coolCoilHeightMM ?? '—'} H mm`),
      row('Coil Tube Depth (approx.)',        `${a.coolCoilDepthMM ?? '—'} mm`),
      row('CHW Supply / Return Temperature',  `${a.chwSupplyTempC}°C / ${a.chwReturnTempC}°C`),
      row('CHW Flow Rate',                    `${a.chwFlowLPS} LPS`),
      row('CHW Pipe Size',                    `DN ${a.chwPipeDN}`),
    ].join(''));
    if (a.heatingCoil) {
      out += section(`${++unitN}. Heating Coil (Hot Water)`, [
        row('Heating Capacity',               `${a.heatingCapKW} kW`),
        row('No. of Rows',                    `${a.heatingCoilRows ?? '—'} rows`),
        row('Coil Face Dimensions (approx.)', `${a.coolCoilWidthMM ?? '—'} W × ${a.coolCoilHeightMM ?? '—'} H mm`),
        row('Coil Tube Depth (approx.)',      `${a.heatCoilDepthMM ?? '—'} mm`),
        row('HW Supply Temperature',          `${a.hwSupplyTempC ?? 60}°C`),
        row('HW Return Temperature',          `${a.hwReturnTempC ?? 50}°C`),
        row('HW Flow Rate',                   `${a.hwFlowLPS ?? 0} LPS`),
        row('HW Pipe Size',                   `DN ${a.hwPipeDN ?? 0}`),
      ].join(''));
    }
    out += section(`${++unitN}. Fan`, [
      row('Fan Wheel Type',                   a.fanCurve ?? a.fanType),
      row('Fan Drive',                        a.fanDrive ?? 'Belt Driven'),
      row('External Static Pressure (ESP)',   `${a.extStaticPa} Pa`),
      row('Fan Motor (estimated)',             `${a.fanMotorKW} kW`),
    ].join(''));
    out += section(`${++unitN}. Filtration`, [
      row('Pre-filter Grade',    a.preFilterGrade || 'Not Provided'),
      row('Fine Filter Grade',   a.finalFilterGrade || 'Not Provided'),
      ...(a.hepaFilter ? [row('HEPA Filter Grade', a.hepaFilterGrade || 'H14')] : []),
      row('Casing Material',     a.casingMaterial),
    ].join(''));
    if (a.supplyDuctMM || a.returnDuctMM) {
      out += section(`${++unitN}. Connections`, [
        a.supplyDuctMM ? row('Supply Duct (W × H)', a.supplyDuctMM) : '',
        a.returnDuctMM ? row('Return Duct (W × H)', a.returnDuctMM) : '',
      ].join(''));
    }
    if ((a.ahuLengthMM ?? 0) > 0) {
      out += section(`${++unitN}. Approximate Unit Dimensions (for space planning — confirm with manufacturer)`, [
        row('Overall Length (L)', `${a.ahuLengthMM} mm`),
        row('Width (W)',           `${a.ahuWidthMM} mm`),
        row('Height (H)',          `${a.ahuHeightMM} mm`),
        row('Mixing Box',          a.hasMixingBox ? 'Included (+600 mm in length)' : 'Not Included'),
        row('Note',                'Approximate ±10%. Actual dimensions subject to manufacturer confirmation.'),
      ].join(''));
    }
    if (a.notes) {
      out += `<h2 class="sec">AHU / FCU Notes</h2><p class="note-text">${a.notes.replace(/\n/g, '<br/>')}</p>`;
    }
    return out;
  };

  let body = '';
  let n = 0;

  // ── AHU / FCU Terminal Units ──────────────────────────────────────────────
  if (showAHU) {
    if (spec.chiller) body += grpHeader('A. AHU / FCU Terminal Units');
    n = 0;

    if (spec.ahuUnits && spec.ahuUnits.length > 0) {
      // Per-zone unit breakdown
      spec.ahuUnits.forEach((unit, idx) => {
        body += zoneSubHeader(`Unit ${idx + 1}: ${unit.zoneName}  ·  ${unit.coolingCapTR} TR  /  ${unit.supplyAirCFM.toLocaleString()} CFM`);
        body += renderAHUBody(unit);
      });
    } else if (spec.ahu) {
      // Single aggregate unit (legacy or single-zone)
      body += renderAHUBody(spec.ahu);
    }
  }

  // ── Central Chiller Plant ─────────────────────────────────────────────────
  if (showChiller && spec.chiller) {
    const c = spec.chiller;
    const isWC = c.condenserType.toLowerCase().includes('water');
    if (spec.ahu) body += grpHeader('B. Central Chiller Plant');
    n = 0;
    body += section(`${++n}. Cooling Capacity & Performance`, [
      row('Quantity (Working Units)',         `${c.quantity ?? 1} nos`),
      row('Cooling Capacity (per unit)',      `${c.coolingCapTR} TR  (${c.coolingCapKW} kW)`),
      row('Total Installed (Working)',        `${((c.quantity ?? 1) * c.coolingCapTR).toFixed(2)} TR  (${((c.quantity ?? 1) * c.coolingCapKW).toFixed(1)} kW)`),
      row('Rated COP',                        `${c.copRated}`),
      row('Compressor Input Power (est.)',    `${c.inputKW} kW`),
      row('Refrigerant',                      c.refrigerant),
      row('Condenser Type',                   c.condenserType),
      row('Power Supply',                     c.voltageHz),
    ].join(''));

    body += section(`${++n}. Chilled Water Circuit`, [
      row('CHW Supply Temperature',           `${c.chwSupplyTempC}°C`),
      row('CHW Return Temperature',           `${c.chwReturnTempC}°C`),
      row('CHW Flow Rate',                    `${c.chwFlowLPS} LPS`),
      row('CHW Pipe Size',                    `DN ${c.chwPipeDN}`),
    ].join(''));

    if (isWC) {
      body += section(`${++n}. Condenser Water Circuit`, [
        row('CW Supply Temperature',          `${c.cwSupplyTempC}°C`),
        row('CW Return Temperature',          `${c.cwReturnTempC}°C`),
        row('CW Flow Rate',                   `${c.cwFlowLPS} LPS`),
        row('CW Pipe Size',                   `DN ${c.cwPipeDN}`),
      ].join(''));
    }

    if (c.notes) {
      body += `<h2 class="sec">Chiller Notes</h2><p class="note-text">${c.notes.replace(/\n/g, '<br/>')}</p>`;
    }
  }

  // ── Cooling Tower ─────────────────────────────────────────────────────────
  if (showCT && spec.ct) {
    const t = spec.ct;
    if (spec.chiller) body += grpHeader('C. Cooling Tower');
    n = 0;
    body += section(`${++n}. Thermal Duty & Design Temperatures`, [
      row('Quantity (Working Units)',         `${t.quantity ?? 1} nos`),
      row('Thermal Duty (per unit)',          `${t.dutyTR} TR  (${t.dutyKW} kW)`),
      row('Total Installed (Working)',        `${((t.quantity ?? 1) * t.dutyTR).toFixed(2)} TR  (${((t.quantity ?? 1) * t.dutyKW).toFixed(1)} kW)`),
      row('Hot Water Inlet Temperature',      `${t.hotWaterTempC}°C`),
      row('Cold Water Outlet Temperature',    `${t.coldWaterTempC}°C`),
      row('Design Wet-Bulb Temperature',      `${t.designWBTC}°C`),
      row('Approach (Cold − WBT)',            `${t.approach}°C`),
      row('Range (Hot − Cold)',               `${t.range}°C`),
      row('Condenser Water Flow Rate',        `${t.waterFlowLPS} LPS  (${t.waterFlowGPM} GPM)`),
    ].join(''));

    body += section(`${++n}. Construction & Fan`, [
      row('Tower Type',                       `${t.towerType} / ${t.flowType}`),
      row('Casing Material',                  t.casingMaterial),
      row('Fill Type',                        t.fillType),
      row('Fan Motor (estimated)',            `${t.fanMotorKW} kW`),
      row('Inlet / Outlet Pipe Size',         `DN ${t.inletPipeDN} / DN ${t.outletPipeDN}`),
    ].join(''));

    if (t.notes) {
      body += `<h2 class="sec">Cooling Tower Notes</h2><p class="note-text">${t.notes.replace(/\n/g, '<br/>')}</p>`;
    }
  }

  // ── Package / Ductable Split ──────────────────────────────────────────────
  if (showPkg && spec.pkg) {
    const p = spec.pkg;
    n = 0;
    body += section(`${++n}. Cooling Performance`, [
      row('Quantity',                         `${p.quantity ?? 1} nos`),
      row('Cooling Capacity (per unit)',      `${p.coolingCapTR} TR  (${p.coolingCapKW} kW)`),
      row('Total Installed',                  `${((p.quantity ?? 1) * p.coolingCapTR).toFixed(2)} TR  (${((p.quantity ?? 1) * p.coolingCapKW).toFixed(1)} kW)`),
      row('Rated EER',                        `${p.eerRated} BTU/W·h`),
      row('Compressor Input Power (est.)',    `${p.inputKW} kW`),
      row('Refrigerant',                      p.refrigerant),
    ].join(''));

    body += section(`${++n}. Air Performance`, [
      row('Total Supply Airflow',             `${p.supplyAirCFM.toLocaleString()} CFM`),
      row('External Static Pressure',         `${p.extStaticPa} Pa`),
    ].join(''));

    if (p.notes) {
      body += `<h2 class="sec">Notes</h2><p class="note-text">${p.notes.replace(/\n/g, '<br/>')}</p>`;
    }
  }

  // ── Humidifier ────────────────────────────────────────────────────────────
  if (showHumid && spec.humidifier) {
    const h = spec.humidifier;
    const grpLetter = spec.ahu && spec.chiller ? 'D' : spec.ahu || spec.chiller ? 'C' : '';
    if (grpLetter) body += grpHeader(`${grpLetter}. Humidifier`);
    n = 0;
    body += section(`${++n}. Humidifier Specification`, [
      row('Humidifier Type',              h.type),
      row('Steam Output Capacity',        `${h.capacityKgHr} kg/h`),
      row('Electrical Heating Input',     `${h.heatingElementKW} kW`),
      row('Water Consumption (est.)',     `${h.waterConsumptionLPH} L/h`),
      row('Humidity Control Type',        h.controlType),
      row('Power Supply',                 h.voltageHz),
    ].join(''));
    if (h.notes) {
      body += `<h2 class="sec">Humidifier Notes</h2><p class="note-text">${h.notes.replace(/\n/g, '<br/>')}</p>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${lbl.title} — ${pName} — ${system.name}</title>
<style>
  @page { size: A4; margin: 15mm 20mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #1a1a1a; }
  .hdr { border-bottom: 2.5pt solid #1a237e; padding-bottom: 10px; margin-bottom: 12px; overflow: hidden; }
  .stamp { float: right; border: 2pt solid #c62828; padding: 3px 10px; color: #c62828; font-weight: bold; font-size: 9pt; margin-top: 2px; }
  .title { font-size: 15pt; font-weight: bold; color: #1a237e; }
  .subtitle { font-size: 7.5pt; color: #555; margin-top: 3px; }
  .meta { width: 100%; border-collapse: collapse; margin-bottom: 14px; border: 0.5pt solid #ccc; }
  .meta td { padding: 4px 8px; font-size: 8.5pt; border: 0.5pt solid #e0e0e0; }
  .meta td b { color: #1a237e; }
  h2.sec { background: #1a237e; color: #fff; padding: 4px 8px; font-size: 8.5pt; font-weight: bold; margin-top: 12px; margin-bottom: 0; letter-spacing: 0.02em; }
  table.spec { width: 100%; border-collapse: collapse; border: 0.5pt solid #ccc; }
  table.spec tr { border-bottom: 0.5pt solid #e8eaf6; }
  table.spec tr:last-child { border-bottom: none; }
  td.lbl { width: 48%; font-weight: 500; background: #f5f7ff; color: #333; padding: 4px 8px; border-right: 0.5pt solid #dde; font-size: 8.5pt; }
  td.val { font-family: 'Courier New', Courier, monospace; padding: 4px 8px; font-size: 8.5pt; color: #111; }
  p.note-text { border: 0.5pt solid #ccc; padding: 6px 8px; font-size: 8pt; color: #444; margin-top: 0; background: #fafafa; font-style: italic; }
  .approval { border: 0.75pt solid #aaa; padding: 8px 12px; margin-top: 20px; page-break-inside: avoid; }
  .appr-title { font-size: 8pt; font-weight: bold; color: #1a237e; margin-bottom: 10px; }
  .appr-grid { display: flex; gap: 0; }
  .appr-cell { flex: 1; border-right: 0.5pt solid #ccc; padding: 4px 8px; }
  .appr-cell:last-child { border-right: none; }
  .appr-role { font-size: 7.5pt; font-weight: bold; color: #555; }
  .appr-line { border-top: 0.75pt solid #333; margin-top: 22px; padding-top: 3px; }
  .appr-label { font-size: 7pt; color: #777; }
  .footer { margin-top: 14px; font-size: 7pt; color: #888; font-style: italic; border-top: 0.5pt solid #ddd; padding-top: 6px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>

<div class="hdr">
  <span class="stamp">PRELIMINARY — FOR REVIEW</span>
  <div class="title">${lbl.title}</div>
  <div class="subtitle">HVAC Equipment Selection &amp; Performance Data — ${lbl.desc}</div>
</div>

<table class="meta">
  <tr>
    <td><b>Project:</b> ${pName}</td>
    <td><b>System Name:</b> ${system.name}</td>
    <td><b>Date Issued:</b> ${date}</td>
  </tr>
  <tr>
    <td><b>Equipment Type:</b> ${lbl.equipType}</td>
    <td><b>Spec Type:</b> ${spec.specType}</td>
    <td><b>Rev.:</b> A (Preliminary)</td>
  </tr>
</table>

${body}

<div class="approval">
  <div class="appr-title">Approval / Review Block</div>
  <div class="appr-grid">
    <div class="appr-cell">
      <div class="appr-role">Prepared By</div>
      <div class="appr-line"></div>
      <div class="appr-label">Name &amp; Signature</div>
      <div class="appr-line" style="margin-top:10px;"></div>
      <div class="appr-label">Date</div>
    </div>
    <div class="appr-cell">
      <div class="appr-role">Checked By</div>
      <div class="appr-line"></div>
      <div class="appr-label">Name &amp; Signature</div>
      <div class="appr-line" style="margin-top:10px;"></div>
      <div class="appr-label">Date</div>
    </div>
    <div class="appr-cell">
      <div class="appr-role">Approved By</div>
      <div class="appr-line"></div>
      <div class="appr-label">Name &amp; Signature</div>
      <div class="appr-line" style="margin-top:10px;"></div>
      <div class="appr-label">Date</div>
    </div>
  </div>
</div>

<div class="footer">
  Note: All values are design / nominal. Actual performance shall be confirmed from manufacturer's certified data sheets. Capacities carry ±5% tolerance. Temperatures in °F and °C as noted. WBT estimated from outdoor design conditions — verify with meteorological data.
</div>

</body>
</html>`;
}

// ─── Form sub-components ──────────────────────────────────────────────────────

function SF({
  label, value, onChange, unit, wide, type = 'number', className,
}: {
  label: string;
  value: string | number;
  onChange: (v: any) => void;
  unit?: string;
  wide?: boolean;
  type?: 'number' | 'text';
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2 min-w-0', className)}>
      <span className="text-[11px] text-slate-500 dark:text-slate-400 w-48 shrink-0">{label}</span>
      <div className="flex items-center gap-1">
        {type === 'number' ? (
          <NumericInput
            value={typeof value === 'number' ? value : (value === '' ? undefined : parseFloat(String(value)))}
            onChange={(n) => onChange(n ?? 0)}
            className={cn('h-7 text-xs font-mono dark:bg-slate-900 dark:border-slate-600 dark:text-slate-200', wide ? 'w-52' : 'w-24')}
          />
        ) : (
          <Input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            className={cn('h-7 text-xs font-mono dark:bg-slate-900 dark:border-slate-600 dark:text-slate-200', wide ? 'w-52' : 'w-24')}
          />
        )}
        {unit && <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0">{unit}</span>}
      </div>
    </div>
  );
}

function Sec({ title, color = 'slate', children }: { title: string; color?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={cn(
        'px-3 py-1.5 rounded-t text-[10px] font-bold uppercase tracking-wider',
        color === 'sky'    ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' :
        color === 'indigo' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' :
        color === 'teal'   ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' :
        color === 'amber'  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
        color === 'orange' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' :
        color === 'blue'   ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
        'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
      )}>
        {title}
      </div>
      <div className="border border-t-0 border-slate-200 dark:border-slate-700 rounded-b p-3 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 dark:bg-slate-800/30">
        {children}
      </div>
    </div>
  );
}

// ─── AHU Unit Form (shared between single-ahu and per-zone ahuUnits) ─────────

function AHUUnitForm({ ahu, onChange, ahuConfig }: {
  ahu: AHUData;
  onChange: (field: string, val: any) => void;
  ahuConfig?: AHUConfig;
}) {
  return (
    <>
      <Sec title="Air Performance" color="sky">
        <SF label="Quantity" value={ahu.quantity ?? 1} onChange={v => onChange('quantity', v)} unit="nos" />
        <SF label="Total Supply Air" value={ahu.supplyAirCFM} onChange={v => onChange('supplyAirCFM', v)} unit="CFM" />
        <SF label="Outside Air %" value={ahu.outsideAirPct} onChange={v => onChange('outsideAirPct', v)} unit="%" />
        <SF label="Outside Air (CFM)" value={ahu.outsideAirCFM} onChange={v => onChange('outsideAirCFM', v)} unit="CFM" />
        <SF label="Return Air" value={ahu.returnAirCFM} onChange={v => onChange('returnAirCFM', v)} unit="CFM" />
      </Sec>

      <Sec title="Design Conditions" color="sky">
        <SF label="Outdoor DB" value={ahu.outdoorDBF} onChange={v => onChange('outdoorDBF', v)} unit="°F" />
        <SF label="Outdoor WB (est.)" value={ahu.outdoorWBF} onChange={v => onChange('outdoorWBF', v)} unit="°F" />
        <SF label="Room DB" value={ahu.roomDBF} onChange={v => onChange('roomDBF', v)} unit="°F" />
        <SF label="Room RH" value={ahu.roomRHPct} onChange={v => onChange('roomRHPct', v)} unit="%" />
        <SF label="Mixed Air DB" value={ahu.mixedAirDBF} onChange={v => onChange('mixedAirDBF', v)} unit="°F" />
        <SF label="Mixed Air WB" value={ahu.mixedAirWBF} onChange={v => onChange('mixedAirWBF', v)} unit="°F" />
        <SF label="Leaving Air DB" value={ahu.leavingAirDBF} onChange={v => onChange('leavingAirDBF', v)} unit="°F" />
        <SF label="Leaving Air RH" value={ahu.leavingAirRHPct} onChange={v => onChange('leavingAirRHPct', v)} unit="%" />
        <SF label="Off-Coil Dew Point" value={ahu.leavingAirDPF ?? 0} onChange={v => onChange('leavingAirDPF', v)} unit="°F" />
        <SF label="Apparatus Dew Point (ADP)" value={ahu.apparatusDewPointF ?? 0} onChange={v => onChange('apparatusDewPointF', v)} unit="°F" />
      </Sec>

      <Sec title="Chilled Water Coil" color="sky">
        <SF label="Total Cooling Capacity" value={ahu.coolingCapTR} onChange={v => onChange('coolingCapTR', v)} unit="TR" />
        <SF label="Total Cooling Capacity" value={ahu.coolingCapKW} onChange={v => onChange('coolingCapKW', v)} unit="kW" />
        <SF label="Coil Type" value={ahu.coilType} onChange={v => onChange('coilType', v)} type="text" wide className="col-span-2 sm:col-span-2" />
        <SF label="No. of Rows" value={ahu.coolingCoilRows ?? 6} onChange={v => onChange('coolingCoilRows', v)} />
        <SF label="Coil Face W × H (approx.)" value={`${ahu.coolCoilWidthMM ?? 0} × ${ahu.coolCoilHeightMM ?? 0}`} onChange={() => {}} type="text" wide />
        <SF label="Coil Tube Depth (approx.)" value={ahu.coolCoilDepthMM ?? 0} onChange={v => onChange('coolCoilDepthMM', v)} unit="mm" />
        <SF label="CHW Supply Temp" value={ahu.chwSupplyTempC} onChange={v => onChange('chwSupplyTempC', v)} unit="°C" />
        <SF label="CHW Return Temp" value={ahu.chwReturnTempC} onChange={v => onChange('chwReturnTempC', v)} unit="°C" />
        <SF label="CHW Flow Rate (total)" value={ahu.chwFlowLPS} onChange={v => onChange('chwFlowLPS', v)} unit="LPS" />
        <SF label="CHW Pipe Size (main header)" value={ahu.chwPipeDN} onChange={v => onChange('chwPipeDN', v)} unit="DN" />
      </Sec>

      {(ahuConfig?.hasHeatingCoil || ahu.heatingCoil) && (
        <Sec title="Heating Coil (Hot Water)" color="orange">
          {ahuConfig?.hasHeatingCoil && !ahu.heatingCoil && (
            <div className="col-span-2 text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-2 py-1.5">
              Coil type set to Cooling + Heating — run <strong>Auto-Fill</strong> to populate heating coil data.
            </div>
          )}
          <SF label="Heating Capacity" value={ahu.heatingCapKW} onChange={v => onChange('heatingCapKW', v)} unit="kW" />
          {((ahu.heatVentLoadKW ?? 0) > 0 || (ahu.heatReheatKW ?? 0) > 0) && (
            <div className="col-span-2 text-[10px] text-slate-500 dark:text-slate-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded px-2 py-1.5 -mt-1">
              Space heating (vent): <span className="font-semibold text-slate-700 dark:text-slate-300">{(ahu.heatVentLoadKW ?? 0).toFixed(1)} kW</span>
              {' · '}
              Dehumid reheat: <span className="font-semibold text-slate-700 dark:text-slate-300">{(ahu.heatReheatKW ?? 0).toFixed(1)} kW</span>
              {' · '}
              Governing: <span className="font-semibold text-orange-700 dark:text-orange-400">
                {(ahu.heatVentLoadKW ?? 0) >= (ahu.heatReheatKW ?? 0) ? 'Space Heating' : 'Dehumidification Reheat'}
              </span>
              {' (10% safety added)'}
            </div>
          )}
          <SF label="No. of Rows" value={ahu.heatingCoilRows ?? 2} onChange={v => onChange('heatingCoilRows', v)} />
          <SF label="Coil Face W × H (approx.)" value={`${ahu.coolCoilWidthMM ?? 0} × ${ahu.coolCoilHeightMM ?? 0}`} onChange={() => {}} type="text" wide />
          <SF label="Coil Tube Depth (approx.)" value={ahu.heatCoilDepthMM ?? 0} onChange={v => onChange('heatCoilDepthMM', v)} unit="mm" />
          <SF label="HW Supply Temp" value={ahu.hwSupplyTempC ?? 60} onChange={v => onChange('hwSupplyTempC', v)} unit="°C" />
          <SF label="HW Return Temp" value={ahu.hwReturnTempC ?? 50} onChange={v => onChange('hwReturnTempC', v)} unit="°C" />
          <SF label="HW Flow Rate" value={ahu.hwFlowLPS ?? 0} onChange={v => onChange('hwFlowLPS', v)} unit="LPS" />
          <SF label="HW Pipe Size" value={ahu.hwPipeDN ?? 0} onChange={v => onChange('hwPipeDN', v)} unit="DN" />
        </Sec>
      )}

      <Sec title="Fan" color="slate">
        <SF label="Fan Wheel Type" value={ahu.fanCurve ?? 'Backward Curved DIDW'} onChange={v => onChange('fanCurve', v)} type="text" wide />
        <SF label="Fan Drive" value={ahu.fanDrive ?? 'Belt Driven'} onChange={v => onChange('fanDrive', v)} type="text" wide />
        <SF label="External Static Pressure (ESP)" value={ahu.extStaticPa} onChange={v => onChange('extStaticPa', v)} unit="Pa" />
        <SF label="Fan Motor (estimated)" value={ahu.fanMotorKW} onChange={v => onChange('fanMotorKW', v)} unit="kW" />
      </Sec>

      <Sec title="Filtration" color="slate">
        <SF label="Pre-filter Grade" value={ahu.preFilterGrade} onChange={v => onChange('preFilterGrade', v)} type="text" wide />
        <SF label="Fine Filter Grade" value={ahu.finalFilterGrade} onChange={v => onChange('finalFilterGrade', v)} type="text" wide />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 w-48 shrink-0">HEPA Filter</span>
          <button onClick={() => onChange('hepaFilter', !(ahu.hepaFilter ?? false))}
            className={cn('text-[10px] px-2 py-0.5 rounded border font-medium',
              ahu.hepaFilter
                ? 'bg-sky-100 border-sky-300 text-sky-700 dark:bg-sky-900/40 dark:border-sky-700 dark:text-sky-300'
                : 'bg-slate-50 border-slate-200 text-slate-400 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-500')}>
            {ahu.hepaFilter ? 'Installed ✓' : '+ Add HEPA'}
          </button>
        </div>
        {ahu.hepaFilter && (
          <SF label="HEPA Filter Grade" value={ahu.hepaFilterGrade ?? 'H14'} onChange={v => onChange('hepaFilterGrade', v)} type="text" wide />
        )}
        <SF label="Casing Material" value={ahu.casingMaterial} onChange={v => onChange('casingMaterial', v)} type="text" wide className="col-span-2 sm:col-span-2" />
      </Sec>

      <Sec title="Connections" color="slate">
        <SF label="Supply Duct (W × H mm)" value={ahu.supplyDuctMM} onChange={v => onChange('supplyDuctMM', v)} type="text" wide />
        <SF label="Return Duct (W × H mm)" value={ahu.returnDuctMM} onChange={v => onChange('returnDuctMM', v)} type="text" wide />
      </Sec>

      {(ahu.ahuLengthMM ?? 0) > 0 && (
        <div className="rounded border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-2">
            Approximate Unit Dimensions (for space estimation only — confirm with manufacturer)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            {[
              { label: 'Length (L)', value: `${ahu.ahuLengthMM} mm` },
              { label: 'Width (W)', value: `${ahu.ahuWidthMM} mm` },
              { label: 'Height (H)', value: `${ahu.ahuHeightMM} mm` },
              { label: 'Mixing Box', value: ahu.hasMixingBox ? 'Included' : 'Not Included' },
            ].map(item => (
              <div key={item.label} className="bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800 rounded px-2 py-1.5">
                <div className="text-[9px] text-amber-600 dark:text-amber-400 leading-tight">{item.label}</div>
                <div className="text-xs font-bold font-mono text-amber-900 dark:text-amber-300 mt-0.5">{item.value}</div>
              </div>
            ))}
          </div>
          <div className="text-[9px] text-amber-500 dark:text-amber-500 mt-1.5 italic">
            L = {ahu.hasMixingBox ? 'Mixing Box + ' : ''}Filters + Coil(s) + Fan section. Actual size may vary ±10%.
          </div>
        </div>
      )}

      <div className="col-span-2">
        <div className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500 mb-1">Notes / Special Requirements</div>
        <textarea
          value={ahu.notes}
          onChange={e => onChange('notes', e.target.value)}
          rows={3}
          placeholder="Vibration isolators, access doors, drain pan spec, coil material, etc."
          className="w-full rounded border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 resize-none focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-600"
        />
      </div>
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface ZoneUnit {
  zoneName: string;
  requiredTR: number;
  designCFM: number;
  oaCFM?: number;
  // Per-zone AHU config (mixing box, mounting, coil rows, fan, filters).
  // When set, overrides the system-level ahuConfig in autoFill so zones with
  // ceiling-hung / no-mixing-box / different fan types render correctly.
  ahuConfig?: AHUConfig;
  // Selected AHU/FCU units for this zone (from zone.unitSelections[] / zone.selection).
  // When present, the spec uses these instead of recomputing from load TR × 1.1
  // so the AHU spec reflects what the user actually picked.
  selectedAHUTotalTR?: number;
  selectedAHUTotalCFM?: number;
  selectedAHUQty?: number;
  selectedAHUPerUnitTR?: number;
  selectedAHUPerUnitCFM?: number;
}

interface SpecSheetProps {
  system: EquipmentSystem;
  project: any;
  systemPsychro: any | null;
  totalRequiredTR: number;
  totalDesignCFM: number;
  hvacCategory: string;
  systemNeedsHumidifier?: boolean;
  humidifierCapacityKgHr?: number;
  systemOACFM?: number;
  ahuConfig?: AHUConfig;
  systemVentHeatingKW?: number;
  systemReheatKW?: number;
  chillerPlantTR?: number;
  zoneUnits?: ZoneUnit[];
  // Actually-selected equipment from the user's picks in Equipment Selection.
  // When present, Auto-Fill uses these for capacity & quantity instead of
  // recomputing from load TR. Standby units are excluded in the build helpers.
  selectedChillerUnits?: ODUCombinationUnit[];
  selectedCTUnits?: ODUCombinationUnit[];
  selectedPackageUnit?: SingleUnitSelection | null;
  selectedAHUUnits?: SingleUnitSelection[];
  onSave: (spec: Record<string, any>) => Promise<void>;
}

export default function SpecSheet({
  system, project, systemPsychro, totalRequiredTR, totalDesignCFM, hvacCategory,
  systemNeedsHumidifier = false, humidifierCapacityKgHr = 0, systemOACFM = 0, ahuConfig,
  systemVentHeatingKW = 0, systemReheatKW = 0, chillerPlantTR = 0, zoneUnits,
  selectedChillerUnits, selectedCTUnits, selectedPackageUnit, selectedAHUUnits, onSave,
}: SpecSheetProps) {
  const [expanded, setExpanded]   = useState(false);
  const [spec, setSpec]           = useState<FullSpec>({ specType: system.type });
  const [saving, setSaving]       = useState(false);
  const [savedOk, setSavedOk]     = useState(false);

  const isWC = hvacCategory === 'Chiller WC';

  // Load saved spec from system document when system changes
  useEffect(() => {
    const saved = (system as any).customSpec;
    if (saved && typeof saved === 'object' && saved.specType) {
      setSpec(saved as FullSpec);
    } else {
      setSpec({ specType: system.type });
    }
    setSavedOk(false);
  }, [system.id]);

  const autoFill = useCallback(() => {
    try {
    // Preserve humidifier type already selected by user
    const humidType: 'steam-electrode' | 'ultrasonic' =
      spec.humidifier?.humidifierType ?? (spec.humidifier?.type?.includes('Ultrasonic') ? 'ultrasonic' : 'steam-electrode');

    // For AHU systems, derive AHU quantity from the user's selected unit list
    // (the DX condensing units act as the AHU count). For Chiller/VRF systems
    // this defaults to 1 — each zone has its own AHU spec already.
    const ahuQty = (system.type === 'AHU' && selectedAHUUnits && selectedAHUUnits.length > 0)
      ? selectedAHUUnits.reduce((s, u) => s + (u.quantity ?? 1), 0)
      : 1;

    // Build per-zone AHU units when zone breakdown is available; otherwise single aggregate.
    // When a zone has user-selected AHU units, use those for per-unit TR/CFM and quantity
    // — load values become a fallback only.
    const buildAHUUnitsOrSingle = (specType: string): Partial<FullSpec> => {
      if (zoneUnits && zoneUnits.length > 0) {
        const units: AHUZoneData[] = zoneUnits.map(z => {
          const hasSelected = (z.selectedAHUQty ?? 0) > 0 && (z.selectedAHUPerUnitTR ?? 0) > 0;
          const perUnitTR  = hasSelected ? (z.selectedAHUPerUnitTR ?? 0) : z.requiredTR;
          const perUnitCFM = hasSelected ? (z.selectedAHUPerUnitCFM ?? 0) : z.designCFM;
          const zoneQty    = hasSelected ? (z.selectedAHUQty ?? 1) : 1;
          // OA stays at the zone-total level (it's a ventilation requirement, not equipment-specific).
          // Divide by qty so per-unit OA CFM is meaningful when multiple AHUs serve one zone.
          const perUnitOA  = hasSelected && zoneQty > 0 ? (z.oaCFM ?? 0) / zoneQty : (z.oaCFM ?? 0);
          // Per-zone ahuConfig (mixing box, fan type, coil rows, filters) overrides
          // the system-level config — so ceiling-hung zones with no mixing box are
          // sized & rendered correctly instead of inheriting another zone's config.
          const zoneAhuConfig = z.ahuConfig ?? ahuConfig;
          return {
            ...buildAHU(project, systemPsychro, perUnitTR, perUnitCFM, perUnitOA, zoneAhuConfig, 0, 0, zoneQty, hasSelected),
            zoneName: z.zoneName,
          };
        });
        return { specType, ahuUnits: units };
      }
      return {
        specType,
        ahu: buildAHU(project, systemPsychro, totalRequiredTR, totalDesignCFM, systemOACFM, ahuConfig, systemVentHeatingKW, systemReheatKW, ahuQty),
      };
    };

    if (system.type === 'AHU') {
      const newSpec: FullSpec = { ...buildAHUUnitsOrSingle('AHU') } as FullSpec;
      if (systemNeedsHumidifier && humidifierCapacityKgHr > 0) {
        newSpec.humidifier = buildHumidifier(humidifierCapacityKgHr, humidType);
      }
      setSpec(newSpec);
    } else if (system.type === 'Chiller') {
      const plantTR = chillerPlantTR > 0 ? chillerPlantTR : totalRequiredTR;
      const chiller = buildChiller(plantTR, isWC, selectedChillerUnits);
      const specTypeName = isWC ? 'Chiller (Water-Cooled) + AHU/FCU' : 'Chiller (Air-Cooled) + AHU/FCU';
      const newSpec: FullSpec = { ...buildAHUUnitsOrSingle(specTypeName), chiller } as FullSpec;
      if (isWC) newSpec.ct = buildCT(chiller.coolingCapTR, chiller.inputKW, project, selectedCTUnits);
      if (systemNeedsHumidifier && humidifierCapacityKgHr > 0) {
        newSpec.humidifier = buildHumidifier(humidifierCapacityKgHr, humidType);
      }
      setSpec(newSpec);
    } else if (system.type === 'Package' || system.type === 'DuctableSplit') {
      const newSpec: FullSpec = {
        specType: system.type === 'Package' ? 'Package AC' : 'Ductable Split',
        pkg: buildPackage(totalRequiredTR, totalDesignCFM, selectedPackageUnit),
      };
      if (systemNeedsHumidifier && humidifierCapacityKgHr > 0) {
        newSpec.humidifier = buildHumidifier(humidifierCapacityKgHr, humidType);
      }
      setSpec(newSpec);
    } else if (system.type === 'VRF') {
      const newSpec: FullSpec = { ...buildAHUUnitsOrSingle('AHU-DX (VRF-Integrated)') } as FullSpec;
      if (systemNeedsHumidifier && humidifierCapacityKgHr > 0) {
        newSpec.humidifier = buildHumidifier(humidifierCapacityKgHr, humidType);
      }
      setSpec(newSpec);
    }
    setSavedOk(false);
    toast.success('Spec auto-filled from load calculation');
    } catch (err) {
      console.error('AutoFill error:', err);
      toast.error('Auto-fill failed: ' + String(err));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system.type, project, systemPsychro, totalRequiredTR, totalDesignCFM, isWC, systemNeedsHumidifier, humidifierCapacityKgHr, systemOACFM, ahuConfig, systemVentHeatingKW, systemReheatKW, chillerPlantTR, zoneUnits, selectedChillerUnits, selectedCTUnits, selectedPackageUnit, selectedAHUUnits, spec.humidifier?.humidifierType, spec.humidifier?.type]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Deep-strip undefined — Firestore rejects undefined in nested objects and arrays
      const deepStrip = (val: any): any => {
        if (Array.isArray(val)) return val.map(deepStrip);
        if (val !== null && typeof val === 'object') {
          return Object.fromEntries(
            Object.entries(val)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, deepStrip(v)]),
          );
        }
        return val;
      };
      const payload = deepStrip({ ...spec, savedAt: new Date().toISOString() });
      await onSave(payload);
      setSavedOk(true);
      toast.success('Specification saved');
    } catch (err) {
      console.error('SpecSheet save error:', err);
      toast.error('Failed to save specification');
    } finally {
      setSaving(false);
    }
  };

  const openPrintWindow = (html: string) => {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (win) {
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 500);
    }
  };

  const handlePrint = () => {
    if (!spec.ahu && !spec.chiller && !spec.pkg && !spec.humidifier) {
      toast.error('Auto-fill the spec first before printing');
      return;
    }
    openPrintWindow(generatePrintHTML(system, project, spec, 'all'));
  };

  const handlePrintEquipment = (filter: EquipFilter) => {
    openPrintWindow(generatePrintHTML(system, project, spec, filter));
  };

  const upd = (section: keyof FullSpec, field: string, val: any) =>
    setSpec(s => ({ ...s, [section]: { ...(s[section] as any), [field]: val } }));

  const updAHUUnit = (idx: number, field: string, val: any) =>
    setSpec(s => {
      const units = [...(s.ahuUnits ?? [])];
      units[idx] = { ...units[idx], [field]: val };
      return { ...s, ahuUnits: units };
    });

  const hasSpec = !!(spec.ahu || (spec.ahuUnits?.length ?? 0) > 0 || spec.chiller || spec.pkg || spec.humidifier);
  const sysColor =
    system.type === 'AHU'     ? 'sky' :
    system.type === 'Chiller' ? 'indigo' :
    system.type === 'Package' ? 'teal' :
    system.type === 'VRF'     ? 'violet' :
    'amber';

  return (
    <div className={cn(
      'rounded-lg overflow-hidden border',
      system.type === 'AHU'     ? 'border-sky-200 bg-sky-50/20 dark:border-sky-800 dark:bg-sky-950/10' :
      system.type === 'Chiller' ? 'border-indigo-200 bg-indigo-50/20 dark:border-indigo-800 dark:bg-indigo-950/10' :
      system.type === 'Package' ? 'border-teal-200 bg-teal-50/20 dark:border-teal-800 dark:bg-teal-950/10' :
      system.type === 'VRF'     ? 'border-violet-200 bg-violet-50/20 dark:border-violet-800 dark:bg-violet-950/10' :
      'border-amber-200 bg-amber-50/20 dark:border-amber-800 dark:bg-amber-950/10',
    )}>
      {/* Header — div instead of button to avoid nested <button> inside <button> (HTML spec violation) */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(v => !v)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setExpanded(v => !v); }}
        className={cn(
          'w-full flex items-center justify-between px-4 py-2.5 border-b text-left cursor-pointer',
          system.type === 'AHU'     ? 'bg-sky-50 border-sky-200 dark:bg-sky-950/30 dark:border-sky-800' :
          system.type === 'Chiller' ? 'bg-indigo-50 border-indigo-200 dark:bg-indigo-950/30 dark:border-indigo-800' :
          system.type === 'Package' ? 'bg-teal-50 border-teal-200 dark:bg-teal-950/30 dark:border-teal-800' :
          system.type === 'VRF'     ? 'bg-violet-50 border-violet-200 dark:bg-violet-950/30 dark:border-violet-800' :
          'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800',
        )}
      >
        <div className="flex items-center gap-2">
          <FileText className={cn('w-3.5 h-3.5',
            system.type === 'AHU'     ? 'text-sky-600 dark:text-sky-400' :
            system.type === 'Chiller' ? 'text-indigo-600 dark:text-indigo-400' :
            system.type === 'Package' ? 'text-teal-600 dark:text-teal-400' :
            system.type === 'VRF'     ? 'text-violet-600 dark:text-violet-400' :
            'text-amber-600 dark:text-amber-400',
          )} />
          <span className={cn('text-xs font-bold uppercase tracking-wide',
            system.type === 'AHU'     ? 'text-sky-700 dark:text-sky-300' :
            system.type === 'Chiller' ? 'text-indigo-700 dark:text-indigo-300' :
            system.type === 'Package' ? 'text-teal-700 dark:text-teal-300' :
            system.type === 'VRF'     ? 'text-violet-700 dark:text-violet-300' :
            'text-amber-700 dark:text-amber-300',
          )}>
            Equipment Specification Sheet
          </span>
          {hasSpec && (
            <span className="text-[10px] bg-white/70 dark:bg-slate-800/70 border border-current px-1.5 py-0.5 rounded font-medium opacity-70">
              {spec.specType}
            </span>
          )}
          {savedOk && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
        </div>
        <div className="flex items-center gap-2">
          {expanded && (
            <>
              <Button size="sm" variant="outline"
                className="h-7 text-xs gap-1.5 bg-white dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200"
                onClick={e => { e.stopPropagation(); autoFill(); }}
              >
                <Wand2 className="w-3 h-3" /> Auto-fill
              </Button>
              {hasSpec && (
                <>
                  <Button size="sm" variant="outline"
                    className="h-7 text-xs gap-1.5 bg-white dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200"
                    onClick={e => { e.stopPropagation(); handlePrint(); }}
                  >
                    <Printer className="w-3 h-3" /> Print All
                  </Button>
                  <Button size="sm"
                    className={cn('h-7 text-xs gap-1.5',
                      system.type === 'AHU'     ? 'bg-sky-600 hover:bg-sky-700' :
                      system.type === 'Chiller' ? 'bg-indigo-600 hover:bg-indigo-700' :
                      system.type === 'Package' ? 'bg-teal-600 hover:bg-teal-700' :
                      'bg-amber-600 hover:bg-amber-700',
                    )}
                    disabled={saving}
                    onClick={e => { e.stopPropagation(); void handleSave(); }}
                  >
                    <Save className="w-3 h-3" /> {saving ? 'Saving…' : 'Save'}
                  </Button>
                </>
              )}
            </>
          )}
          {expanded
            ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          }
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="p-4 space-y-4 dark:bg-slate-900/20">
          {!hasSpec && (
            <div className="flex flex-col items-center justify-center py-6 text-slate-400 dark:text-slate-500 gap-2">
              <FileText className="w-8 h-8 opacity-20" />
              <p className="text-sm font-medium">No specification data yet</p>
              <p className="text-xs text-center max-w-xs">
                Click <strong>Auto-fill</strong> to populate from the calculated load, then edit as needed and save.
              </p>
              <Button size="sm" variant="outline" className="gap-1.5 mt-2 dark:border-slate-600 dark:text-slate-300" onClick={autoFill}>
                <Wand2 className="w-3 h-3" /> Auto-fill from Load Calculation
              </Button>
            </div>
          )}

          {/* ── AHU / FCU Terminal Units Spec Form ─────────────────────────────── */}
          {(spec.ahu || (spec.ahuUnits?.length ?? 0) > 0) && (
            <div className="space-y-3">
              {spec.chiller && (
                <div className="flex items-center gap-2 px-1">
                  <div className="h-px flex-1 bg-sky-200 dark:bg-sky-800" />
                  <span className="text-[10px] font-bold uppercase text-sky-600 dark:text-sky-400 tracking-wider">AHU / FCU Terminal Units</span>
                  <div className="h-px flex-1 bg-sky-200 dark:bg-sky-800" />
                </div>
              )}

              {/* Per-zone breakdown */}
              {spec.ahuUnits && spec.ahuUnits.length > 0 ? (
                spec.ahuUnits.map((unit, idx) => (
                  <div key={idx} className="space-y-3">
                    {/* Zone name header */}
                    <div className="flex items-center gap-2">
                      <div className="bg-sky-700 dark:bg-sky-800 text-white text-[10px] font-bold px-3 py-1 rounded-l">
                        Unit {idx + 1}
                      </div>
                      <div className="bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-300 text-[11px] font-semibold px-3 py-1 rounded-r flex-1">
                        {unit.zoneName}
                        <span className="ml-3 text-sky-500 dark:text-sky-500 font-normal">
                          {unit.coolingCapTR} TR · {unit.supplyAirCFM.toLocaleString()} CFM
                        </span>
                      </div>
                    </div>
                    <AHUUnitForm
                      ahu={unit}
                      onChange={(field, val) => updAHUUnit(idx, field, val)}
                      ahuConfig={ahuConfig}
                    />
                    {idx < spec.ahuUnits!.length - 1 && (
                      <div className="border-t border-dashed border-sky-200 dark:border-sky-800 mt-4" />
                    )}
                  </div>
                ))
              ) : spec.ahu ? (
                /* Single aggregate unit (legacy / single-zone) */
                <AHUUnitForm
                  ahu={spec.ahu}
                  onChange={(field, val) => upd('ahu', field, val)}
                  ahuConfig={ahuConfig}
                />
              ) : null}
            </div>
          )}

          {/* ── Chiller Spec Form (central plant — sized from terminal loads) ── */}
          {spec.chiller && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <div className="h-px flex-1 bg-indigo-200 dark:bg-indigo-800" />
                <span className="text-[10px] font-bold uppercase text-indigo-500 dark:text-indigo-400 tracking-wider">Central Chiller Plant</span>
                <div className="h-px flex-1 bg-indigo-200 dark:bg-indigo-800" />
              </div>

              <Sec title="Cooling Capacity & Performance" color={sysColor}>
                <SF label="Quantity (Working Units)" value={spec.chiller.quantity ?? 1} onChange={v => upd('chiller', 'quantity', v)} unit="nos" />
                <SF label="Cooling Capacity (per unit)" value={spec.chiller.coolingCapTR} onChange={v => upd('chiller', 'coolingCapTR', v)} unit="TR" />
                <SF label="Cooling Capacity (per unit)" value={spec.chiller.coolingCapKW} onChange={v => upd('chiller', 'coolingCapKW', v)} unit="kW" />
                <SF label="Rated COP" value={spec.chiller.copRated} onChange={v => upd('chiller', 'copRated', v)} />
                <SF label="Compressor Input (est.)" value={spec.chiller.inputKW} onChange={v => upd('chiller', 'inputKW', v)} unit="kW" />
                <SF label="Refrigerant" value={spec.chiller.refrigerant} onChange={v => upd('chiller', 'refrigerant', v)} type="text" wide />
                <SF label="Condenser Type" value={spec.chiller.condenserType} onChange={v => upd('chiller', 'condenserType', v)} type="text" wide className="col-span-2 sm:col-span-2" />
                <SF label="Power Supply" value={spec.chiller.voltageHz} onChange={v => upd('chiller', 'voltageHz', v)} type="text" wide />
              </Sec>

              <Sec title="Chilled Water Circuit" color={sysColor}>
                <SF label="CHW Supply Temp" value={spec.chiller.chwSupplyTempC} onChange={v => upd('chiller', 'chwSupplyTempC', v)} unit="°C" />
                <SF label="CHW Return Temp" value={spec.chiller.chwReturnTempC} onChange={v => upd('chiller', 'chwReturnTempC', v)} unit="°C" />
                <SF label="CHW Flow Rate" value={spec.chiller.chwFlowLPS} onChange={v => upd('chiller', 'chwFlowLPS', v)} unit="LPS" />
                <SF label="CHW Pipe Size" value={spec.chiller.chwPipeDN} onChange={v => upd('chiller', 'chwPipeDN', v)} unit="DN" />
              </Sec>

              {isWC && (
                <Sec title="Condenser Water Circuit" color="blue">
                  <SF label="CW Supply Temp (to chiller)" value={spec.chiller.cwSupplyTempC} onChange={v => upd('chiller', 'cwSupplyTempC', v)} unit="°C" />
                  <SF label="CW Return Temp (from chiller)" value={spec.chiller.cwReturnTempC} onChange={v => upd('chiller', 'cwReturnTempC', v)} unit="°C" />
                  <SF label="CW Flow Rate" value={spec.chiller.cwFlowLPS} onChange={v => upd('chiller', 'cwFlowLPS', v)} unit="LPS" />
                  <SF label="CW Pipe Size" value={spec.chiller.cwPipeDN} onChange={v => upd('chiller', 'cwPipeDN', v)} unit="DN" />
                </Sec>
              )}

              <div>
                <div className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500 mb-1">Notes</div>
                <textarea
                  value={spec.chiller.notes}
                  onChange={e => upd('chiller', 'notes', e.target.value)}
                  rows={2}
                  placeholder="Noise level, start sequence, BMS integration, etc."
                  className="w-full rounded border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 resize-none focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                />
              </div>
            </div>
          )}

          {/* ── Cooling Tower Spec Form (sized from chiller heat rejection) ────── */}
          {spec.ct && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <div className="h-px flex-1 bg-indigo-200 dark:bg-indigo-800" />
                <span className="text-[10px] font-bold uppercase text-indigo-500 dark:text-indigo-400 tracking-wider">Cooling Tower</span>
                <div className="h-px flex-1 bg-indigo-200 dark:bg-indigo-800" />
              </div>

              <Sec title="Thermal Duty & Design Temperatures" color="blue">
                <SF label="Quantity (Working Units)" value={spec.ct.quantity ?? 1} onChange={v => upd('ct', 'quantity', v)} unit="nos" />
                <SF label="Nominal Thermal Duty (per unit)" value={spec.ct.dutyTR} onChange={v => upd('ct', 'dutyTR', v)} unit="TR" />
                <SF label="Thermal Duty (per unit)" value={spec.ct.dutyKW} onChange={v => upd('ct', 'dutyKW', v)} unit="kW" />
                <SF label="Hot Water Inlet Temp" value={spec.ct.hotWaterTempC} onChange={v => upd('ct', 'hotWaterTempC', v)} unit="°C" />
                <SF label="Cold Water Outlet Temp" value={spec.ct.coldWaterTempC} onChange={v => upd('ct', 'coldWaterTempC', v)} unit="°C" />
                <SF label="Design Wet-Bulb Temp (est.)" value={spec.ct.designWBTC} onChange={v => upd('ct', 'designWBTC', v)} unit="°C" />
                <SF label="Approach (Cold − WBT)" value={spec.ct.approach} onChange={v => upd('ct', 'approach', v)} unit="°C" />
                <SF label="Range (Hot − Cold)" value={spec.ct.range} onChange={v => upd('ct', 'range', v)} unit="°C" />
                <SF label="Condenser Water Flow Rate" value={spec.ct.waterFlowLPS} onChange={v => upd('ct', 'waterFlowLPS', v)} unit="LPS" />
              </Sec>

              <Sec title="Construction & Fan" color="blue">
                <SF label="Tower Type" value={spec.ct.towerType} onChange={v => upd('ct', 'towerType', v)} type="text" wide />
                <SF label="Flow Type" value={spec.ct.flowType} onChange={v => upd('ct', 'flowType', v)} type="text" wide />
                <SF label="Casing Material" value={spec.ct.casingMaterial} onChange={v => upd('ct', 'casingMaterial', v)} type="text" wide className="col-span-2 sm:col-span-2" />
                <SF label="Fill Type" value={spec.ct.fillType} onChange={v => upd('ct', 'fillType', v)} type="text" wide />
                <SF label="Fan Motor (estimated)" value={spec.ct.fanMotorKW} onChange={v => upd('ct', 'fanMotorKW', v)} unit="kW" />
                <SF label="Inlet Pipe Size" value={spec.ct.inletPipeDN} onChange={v => upd('ct', 'inletPipeDN', v)} unit="DN" />
                <SF label="Outlet Pipe Size" value={spec.ct.outletPipeDN} onChange={v => upd('ct', 'outletPipeDN', v)} unit="DN" />
              </Sec>

              <div>
                <div className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500 mb-1">Cooling Tower Notes</div>
                <textarea
                  value={spec.ct.notes}
                  onChange={e => upd('ct', 'notes', e.target.value)}
                  rows={2}
                  placeholder="Material spec for coastal/aggressive environment, basin heater, sump screen, make-up valve, etc."
                  className="w-full rounded border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 resize-none focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                />
              </div>
            </div>
          )}

          {/* ── Package / DuctableSplit Spec Form ─────────────────────────────── */}
          {spec.pkg && (
            <div className="space-y-3">
              <Sec title="Cooling Performance" color={sysColor}>
                <SF label="Cooling Capacity" value={spec.pkg.coolingCapTR} onChange={v => upd('pkg', 'coolingCapTR', v)} unit="TR" />
                <SF label="Cooling Capacity" value={spec.pkg.coolingCapKW} onChange={v => upd('pkg', 'coolingCapKW', v)} unit="kW" />
                <SF label="Rated EER" value={spec.pkg.eerRated} onChange={v => upd('pkg', 'eerRated', v)} unit="BTU/W·h" />
                <SF label="Compressor Input (est.)" value={spec.pkg.inputKW} onChange={v => upd('pkg', 'inputKW', v)} unit="kW" />
                <SF label="Refrigerant" value={spec.pkg.refrigerant} onChange={v => upd('pkg', 'refrigerant', v)} type="text" wide />
                <SF label="Quantity" value={spec.pkg.quantity} onChange={v => upd('pkg', 'quantity', v)} />
              </Sec>

              <Sec title="Air Performance" color={sysColor}>
                <SF label="Supply Airflow" value={spec.pkg.supplyAirCFM} onChange={v => upd('pkg', 'supplyAirCFM', v)} unit="CFM" />
                <SF label="External Static Pressure" value={spec.pkg.extStaticPa} onChange={v => upd('pkg', 'extStaticPa', v)} unit="Pa" />
              </Sec>

              <div>
                <div className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500 mb-1">Notes</div>
                <textarea
                  value={spec.pkg.notes}
                  onChange={e => upd('pkg', 'notes', e.target.value)}
                  rows={2}
                  placeholder="Discharge arrangement, economiser coil, controls, BMS integration, etc."
                  className="w-full rounded border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 resize-none focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                />
              </div>
            </div>
          )}

          {/* ── Humidifier Spec Form ──────────────────────────────────────── */}
          {spec.humidifier && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <div className="h-px flex-1 bg-cyan-200 dark:bg-cyan-800" />
                <span className="text-[10px] font-bold uppercase text-cyan-600 dark:text-cyan-400 tracking-wider">Humidifier</span>
                <div className="h-px flex-1 bg-cyan-200 dark:bg-cyan-800" />
              </div>

              {/* Humidifier type toggle */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Technology:</span>
                {(['steam-electrode', 'ultrasonic'] as const).map(t => {
                  const current = spec.humidifier!.humidifierType ?? (spec.humidifier!.type.includes('Ultrasonic') ? 'ultrasonic' : 'steam-electrode');
                  const isActive = t === current;
                  return (
                    <button key={t} type="button"
                      onClick={() => {
                        const rebuilt = buildHumidifier(spec.humidifier!.capacityKgHr, t);
                        setSpec(s => ({ ...s, humidifier: { ...rebuilt, notes: s.humidifier?.notes ?? '' } }));
                      }}
                      className={cn('text-[11px] px-2.5 py-1 rounded border font-medium transition-colors',
                        isActive
                          ? 'bg-cyan-600 border-cyan-600 text-white dark:bg-cyan-700 dark:border-cyan-700'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-cyan-300 dark:hover:border-cyan-700 hover:text-cyan-700 dark:hover:text-cyan-400'
                      )}
                    >
                      {t === 'steam-electrode' ? '♨ Steam Electrode' : '〰 Ultrasonic'}
                    </button>
                  );
                })}
                <span className="text-[10px] text-slate-400 dark:text-slate-500 italic">
                  {spec.humidifier.humidifierType === 'ultrasonic'
                    ? '· Piezoelectric, low energy (~0.05 kW/kg/h), no heating element'
                    : '· Resistive heating element (~0.75 kW/kg/h), clean steam'}
                </span>
              </div>

              <Sec title="Humidifier Specification" color="sky">
                <SF label="Moisture Output Capacity" value={spec.humidifier.capacityKgHr} onChange={v => upd('humidifier', 'capacityKgHr', v)} unit="kg/h" />
                <SF label="Electrical Input" value={spec.humidifier.heatingElementKW} onChange={v => upd('humidifier', 'heatingElementKW', v)} unit="kW" />
                <SF label="Humidifier Type" value={spec.humidifier.type} onChange={v => upd('humidifier', 'type', v)} type="text" wide className="col-span-2 sm:col-span-2" />
                <SF label="Water Consumption (est.)" value={spec.humidifier.waterConsumptionLPH} onChange={v => upd('humidifier', 'waterConsumptionLPH', v)} unit="L/h" />
                <SF label="Humidity Control" value={spec.humidifier.controlType} onChange={v => upd('humidifier', 'controlType', v)} type="text" wide />
                <SF label="Power Supply" value={spec.humidifier.voltageHz} onChange={v => upd('humidifier', 'voltageHz', v)} type="text" wide />
              </Sec>

              <div>
                <div className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500 mb-1">Humidifier Notes</div>
                <textarea
                  value={spec.humidifier.notes}
                  onChange={e => upd('humidifier', 'notes', e.target.value)}
                  rows={2}
                  placeholder="Flush cycle, water quality requirements, BMS integration, drain valve, etc."
                  className="w-full rounded border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 resize-none focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                />
              </div>
            </div>
          )}

          {/* Bottom action bar */}
          {hasSpec && (
            <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              {/* Per-equipment PDF download */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-2">
                  <Download className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Download Spec PDF — send to respective manufacturer</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {spec.ahu && (
                    <button
                      onClick={() => handlePrintEquipment('ahu')}
                      className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950/50 transition-colors"
                    >
                      <Printer className="w-3 h-3" /> AHU / FCU Spec
                    </button>
                  )}
                  {spec.chiller && (
                    <button
                      onClick={() => handlePrintEquipment('chiller')}
                      className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-950/50 transition-colors"
                    >
                      <Printer className="w-3 h-3" /> Chiller Spec
                    </button>
                  )}
                  {spec.ct && (
                    <button
                      onClick={() => handlePrintEquipment('ct')}
                      className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded border border-teal-300 dark:border-teal-700 bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-950/50 transition-colors"
                    >
                      <Printer className="w-3 h-3" /> Cooling Tower Spec
                    </button>
                  )}
                  {spec.humidifier && (
                    <button
                      onClick={() => handlePrintEquipment('humidifier')}
                      className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded border border-cyan-300 dark:border-cyan-700 bg-cyan-50 dark:bg-cyan-950/30 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 dark:hover:bg-cyan-950/50 transition-colors"
                    >
                      <Printer className="w-3 h-3" /> Humidifier Spec
                    </button>
                  )}
                  {spec.pkg && (
                    <button
                      onClick={() => handlePrintEquipment('pkg')}
                      className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors"
                    >
                      <Printer className="w-3 h-3" /> Package AC Spec
                    </button>
                  )}
                  <button
                    onClick={handlePrint}
                    className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    <Printer className="w-3 h-3" /> Full Spec (All)
                  </button>
                </div>
                <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-2 italic">
                  Opens print dialog → use "Save as PDF" to download. Each PDF is addressed to a specific manufacturer.
                </p>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
                  Auto-filled values are estimated — verify before submission.
                </p>
                <Button size="sm"
                  className={cn('h-7 text-xs gap-1.5',
                    system.type === 'AHU'     ? 'bg-sky-600 hover:bg-sky-700' :
                    system.type === 'Chiller' ? 'bg-indigo-600 hover:bg-indigo-700' :
                    system.type === 'Package' ? 'bg-teal-600 hover:bg-teal-700' :
                    'bg-amber-600 hover:bg-amber-700',
                  )}
                  disabled={saving}
                  onClick={() => void handleSave()}
                >
                  <Save className="w-3 h-3" /> {saving ? 'Saving…' : savedOk ? 'Saved ✓' : 'Save Spec'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
