import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Badge } from "../ui/badge";
import { AlertCircle, CheckCircle2, Zap, AlertTriangle, Info, Download, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { auth, onAuthStateChanged } from "../../lib/firebase";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  sizeCableAndMCBWithApplication,
  calculateInrushCurrent,
  getApplicationProfile,
  checkCoordination,
  ApplicationType,
} from "../../lib/electrical";

// Cable type suggestions per placement (IS 732 / IS 1554 / IS 7098)
type ProcurementApplicationType =
  | "pump_fan_dol"
  | "pump_fan_soft_starter"
  | "electric_heater"
  | "lighting_load"
  | "general_purpose"
  | "chiller";

type PhaseMode = '1P' | '3P';

type SavedSelection = {
  id: string;
  userId: string;
  nameOfWork: string;
  circuitRef: string;
  applicationType: ProcurementApplicationType;
  applicationLabel: string;
  cableType: string;
  cableSize: string;
  cableSizeMetric: number;
  mcb: string;
  voltage: number;
  phase: string;
  loadCurrent: number;
  powerKW: number;
  cableLength: number;
  ambientTemp: number;
  cableMaterial: "copper" | "aluminum";
  vfdStarterEnabled?: boolean;
  voltageDropPercent: number;
  safetyMargin: number;
  isCompliant: boolean;
  createdAt?: any;
};

const PLACEMENT_CABLE_TYPES: Record<string, { label: string; type: string; standard: string; note: string }> = {
  conduit: {
    label: 'Conduit (MS/PVC)',
    type: 'PVC insulated single-core, stranded conductor (IS 694)',
    standard: 'IS 694 / IS 732',
    note: 'Use stranded flexible conductor. Ensure conduit fill ≤ 40%. GI conduit for industrial; PVC for domestic.',
  },
  tray: {
    label: 'Cable Tray',
    type: 'Armoured PVC/XLPE multicore cable (IS 1554 / IS 7098)',
    standard: 'IS 1554 Pt.1 / IS 7098 Pt.1',
    note: 'Prefer armoured cable on open tray. Maintain spacing for derating. XLPE preferred for higher temp rating (90°C).',
  },
  underground: {
    label: 'Underground / Direct Buried',
    type: 'Armoured XLPE or PVC cable (IS 7098 / IS 1554) — AYWY or SWA',
    standard: 'IS 7098 Pt.1 / IS 1554 Pt.1',
    note: 'Must be armoured (SWA/AWA). Minimum burial depth 0.75 m (IS 732). Use sand bedding + protective cover tiles.',
  },
  exposed: {
    label: 'Exposed / Surface (outdoor)',
    type: 'Armoured / UV-resistant XLPE cable (IS 7098)',
    standard: 'IS 7098 Pt.1',
    note: 'Use armoured cable or run in heavy-duty GI conduit. UV-stabilised sheathing required outdoors.',
  },
  panel: {
    label: 'Panel / MCC / DB Wiring',
    type: 'Flexible multicore PVC cable (IS 8130) or busbar',
    standard: 'IS 8130 / IS 5578',
    note: 'Short runs inside panels. Use flexible stranded conductors. Colour-code per IS 732 (R/Y/B/N/E).',
  },
  buried_duct: {
    label: 'Buried in Duct / Casing',
    type: 'XLPE armoured in HDPE duct (IS 7098 + IS 14333)',
    standard: 'IS 7098 / IS 14333',
    note: 'HDPE duct buried at ≥ 750 mm. Sealed ends. Suitable for road crossings and congested routes.',
  },
};

function getPhaseAwareCableType(
  placement: string,
  isThreePhase: boolean,
  material: "copper" | "aluminum"
): string {
  const conductorNote = material === 'aluminum' ? 'Aluminium conductor' : 'Copper conductor';
  if (!isThreePhase) {
    switch (placement) {
      case 'conduit':
        return `PVC insulated 2-core (L+N) + separate earth conductor (IS 694 / IS 732) - ${conductorNote}`;
      case 'tray':
        return `Armoured 2-core / 3-core PVC/XLPE cable for 1P circuits (IS 1554 / IS 7098) - ${conductorNote}`;
      case 'underground':
        return `Armoured 2-core / 3-core XLPE or PVC cable for 1P feeder (IS 7098 / IS 1554) - ${conductorNote}`;
      case 'exposed':
        return `UV-resistant armoured 2-core / 3-core XLPE cable (IS 7098) - ${conductorNote}`;
      case 'panel':
        return `Flexible 2-core / 3-core panel cable (IS 8130) - ${conductorNote}`;
      case 'buried_duct':
        return `2-core / 3-core XLPE armoured cable in HDPE duct (IS 7098 + IS 14333) - ${conductorNote}`;
      default:
        return `${PLACEMENT_CABLE_TYPES[placement]?.type ?? 'As per IS standard'} - ${conductorNote}`;
    }
  }

  switch (placement) {
    case 'conduit':
      return `PVC insulated 3-core / 3.5-core stranded ${material === 'aluminum' ? 'Al' : 'Cu'} cable (IS 694 / IS 1554)`;
    case 'tray':
      return `Armoured 3-core / 3.5-core PVC/XLPE cable (IS 1554 / IS 7098) - ${conductorNote}`;
    case 'underground':
      return `Armoured 3-core / 3.5-core XLPE or PVC cable (IS 7098 / IS 1554) - ${conductorNote}`;
    case 'exposed':
      return `UV-resistant armoured 3-core / 3.5-core XLPE cable (IS 7098) - ${conductorNote}`;
    case 'panel':
      return `Flexible 3-core control/power cable (IS 8130) - ${conductorNote}`;
    case 'buried_duct':
      return `3-core / 3.5-core XLPE armoured cable in HDPE duct (IS 7098 + IS 14333) - ${conductorNote}`;
    default:
      return `${PLACEMENT_CABLE_TYPES[placement]?.type ?? 'As per IS standard'} - ${conductorNote}`;
  }
}

const APPLICATION_OPTIONS: Record<ProcurementApplicationType, {
  label: string;
  calcType: ApplicationType;
  forcePhase?: PhaseMode;
  startingProtection: boolean;
}> = {
  pump_fan_dol: {
    label: "Pump / Fan DOL",
    calcType: "motor",
    startingProtection: false,
  },
  pump_fan_soft_starter: {
    label: "Pump / Fan Soft Starter",
    calcType: "pump",
    forcePhase: '3P',
    startingProtection: true,
  },
  electric_heater: {
    label: "Electric Heater",
    calcType: "heater",
    startingProtection: false,
  },
  lighting_load: {
    label: "Lighting Load",
    calcType: "lighting",
    startingProtection: false,
  },
  general_purpose: {
    label: "Genarel Purpose",
    calcType: "general",
    startingProtection: false,
  },
  chiller: {
    label: "Chiller",
    calcType: "chiller",
    forcePhase: '3P',
    startingProtection: true,
  },
};

function isThreePhaseVoltage(voltage: number): boolean {
  return voltage >= 380;
}

function getPowerFactor(application: ProcurementApplicationType): number {
  switch (application) {
    case 'electric_heater':
      return 1.0;
    case 'lighting_load':
      return 0.95;
    case 'general_purpose':
      return 0.9;
    case 'pump_fan_dol':
    case 'pump_fan_soft_starter':
    case 'chiller':
    default:
      return 0.85;
  }
}

function computeCurrentFromKW(kW: number, voltage: number, powerFactor: number): number {
  if (kW <= 0 || voltage <= 0) return 0;
  if (isThreePhaseVoltage(voltage)) {
    // 3-phase: I = kW × 1000 / (√3 × V × PF)
    return (kW * 1000) / (Math.sqrt(3) * voltage * powerFactor);
  }
  // 1-phase: I = kW × 1000 / (V × PF)
  return (kW * 1000) / (voltage * powerFactor);
}

function computeKWFromCurrent(I: number, voltage: number, powerFactor: number): number {
  if (I <= 0 || voltage <= 0) return 0;
  if (isThreePhaseVoltage(voltage)) {
    return (I * Math.sqrt(3) * voltage * powerFactor) / 1000;
  }
  return (I * voltage * powerFactor) / 1000;
}

function normalizeVoltageForCalc(voltage: number): number {
  if (voltage === 415) return 400;
  return voltage;
}

export function CableMCBSelectorV2() {
  // Project / circuit identification
  const [nameOfWork, setNameOfWork] = useState('');
  const [circuitRef, setCircuitRef] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [selectionList, setSelectionList] = useState<SavedSelection[]>([]);
  const [savingSelection, setSavingSelection] = useState(false);

  // Input state
  const [loadCurrent, setLoadCurrent] = useState<number>(32); // Amps
  const [applicationType, setApplicationType] = useState<ProcurementApplicationType>("pump_fan_dol");
  const [phaseMode, setPhaseMode] = useState<PhaseMode>('3P');
  const [systemVoltage, setSystemVoltage] = useState<number>(415);
  const [powerKW, setPowerKW] = useState<number>(() => computeKWFromCurrent(32, 415, getPowerFactor('pump_fan_dol')));
  const [cableLength, setCableLength] = useState<number>(50); // meters
  const [ambientTemp, setAmbientTemp] = useState<number>(40); // °C (IS standard reference)
  const [bundledCables, setBundledCables] = useState<number>(1);
  const [cableMaterial, setCableMaterial] = useState<"copper" | "aluminum">("copper");
  const [voltageDropLimit, setVoltageDropLimit] = useState<number>(3.0); // %
  const [cablePlacement, setCablePlacement] = useState<string>('conduit');
  const [vfdStarterEnabled, setVfdStarterEnabled] = useState<boolean>(false);

  const selectedApplication = APPLICATION_OPTIONS[applicationType];
  const powerFactor = getPowerFactor(applicationType);
  const calcApplicationType = selectedApplication.calcType;
  const useStartingProtection = selectedApplication.startingProtection || vfdStarterEnabled;
  const appProfile = getApplicationProfile(calcApplicationType);
  const placementInfo = PLACEMENT_CABLE_TYPES[cablePlacement];
  const phaseAwareCableType = getPhaseAwareCableType(cablePlacement, isThreePhaseVoltage(systemVoltage), cableMaterial);

  const localSelectionsKey = (uid?: string) => `cableSelections:${uid || 'guest'}`;

  const loadLocalSelections = (uid?: string) => {
    try {
      const raw = localStorage.getItem(localSelectionsKey(uid));
      if (!raw) return [] as SavedSelection[];
      const parsed = JSON.parse(raw) as SavedSelection[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [] as SavedSelection[];
    }
  };

  const saveLocalSelections = (uid: string | undefined, rows: SavedSelection[]) => {
    localStorage.setItem(localSelectionsKey(uid), JSON.stringify(rows));
  };

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUserId(user?.uid || '');
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    setSelectionList(loadLocalSelections(currentUserId));
  }, [currentUserId]);

  useEffect(() => {
    const forcedPhase = APPLICATION_OPTIONS[applicationType].forcePhase;
    if (forcedPhase && phaseMode !== forcedPhase) {
      setPhaseMode(forcedPhase);
      const nextVoltage = forcedPhase === '3P' ? 415 : 230;
      setSystemVoltage(nextVoltage);
      setPowerKW(parseFloat(computeKWFromCurrent(loadCurrent, nextVoltage, powerFactor).toFixed(2)));
    }
  }, [applicationType, loadCurrent, phaseMode, powerFactor]);

  useEffect(() => {
    const targetVoltage = phaseMode === '3P' ? 415 : 230;
    if (systemVoltage !== targetVoltage) {
      setSystemVoltage(targetVoltage);
      setPowerKW(parseFloat(computeKWFromCurrent(loadCurrent, targetVoltage, powerFactor).toFixed(2)));
    }
  }, [phaseMode, loadCurrent, systemVoltage, powerFactor]);

  // Sync kW ↔ current
  const handleCurrentChange = (val: number) => {
    setLoadCurrent(val);
    setPowerKW(parseFloat(computeKWFromCurrent(val, systemVoltage, powerFactor).toFixed(2)));
  };
  const handleKWChange = (val: number) => {
    setPowerKW(val);
    setLoadCurrent(parseFloat(computeCurrentFromKW(val, systemVoltage, powerFactor).toFixed(1)));
  };
  const handleVoltageChange = (v: number) => {
    setSystemVoltage(v);
    setPhaseMode(v >= 380 ? '3P' : '1P');
    // Recompute kW based on current current value
    setPowerKW(parseFloat(computeKWFromCurrent(loadCurrent, v, powerFactor).toFixed(2)));
  };

  const handlePhaseChange = (phase: PhaseMode) => {
    const nextVoltage = phase === '3P' ? 415 : 230;
    setPhaseMode(phase);
    setSystemVoltage(nextVoltage);
    setPowerKW(parseFloat(computeKWFromCurrent(loadCurrent, nextVoltage, powerFactor).toFixed(2)));
  };

  // Calculate sizing
  const result = useMemo(() => {
    const calcVoltage = normalizeVoltageForCalc(systemVoltage);
    return sizeCableAndMCBWithApplication(
      loadCurrent,
      calcApplicationType,
      calcVoltage,
      cableLength,
      ambientTemp,
      bundledCables,
      voltageDropLimit,
      cableMaterial,
      useStartingProtection,
      undefined
    );
  }, [
    loadCurrent,
    calcApplicationType,
    systemVoltage,
    cableLength,
    ambientTemp,
    bundledCables,
    voltageDropLimit,
    cableMaterial,
    useStartingProtection,
  ]);

  const coordinationCheck = useMemo(() => {
    if (!result) return null;
    return checkCoordination(result.selectedCable, result.selectedMCB, normalizeVoltageForCalc(systemVoltage));
  }, [result, systemVoltage]);

  const inrushCurrent = useMemo(() => {
    return calculateInrushCurrent(loadCurrent, calcApplicationType, undefined);
  }, [loadCurrent, calcApplicationType]);

  const clearSelectionsForCurrentWork = () => {
    if (!nameOfWork.trim() || !circuitRef.trim()) return;

    const matchCurrent = (row: SavedSelection) => (
      row.nameOfWork?.trim().toLowerCase() === nameOfWork.trim().toLowerCase()
      && row.circuitRef?.trim().toLowerCase() === circuitRef.trim().toLowerCase()
    );

    const existing = loadLocalSelections(currentUserId);
    const next = existing.filter((row) => !matchCurrent(row));
    saveLocalSelections(currentUserId, next);
    setSelectionList(next);
  };

  const handleClearList = () => {
    const existing = loadLocalSelections(currentUserId);
    if (!existing.length) {
      toast.error('List is already empty');
      return;
    }

    const hasFilter = !!nameOfWork.trim() && !!circuitRef.trim();
    const matchCurrent = (row: SavedSelection) => (
      row.nameOfWork?.trim().toLowerCase() === nameOfWork.trim().toLowerCase()
      && row.circuitRef?.trim().toLowerCase() === circuitRef.trim().toLowerCase()
    );

    const next = hasFilter ? existing.filter((row) => !matchCurrent(row)) : [];
    const clearedCount = existing.length - next.length;

    saveLocalSelections(currentUserId, next);
    setSelectionList(next);

    if (clearedCount > 0) {
      toast.success(hasFilter ? `Cleared ${clearedCount} row(s) for current work/circuit` : 'Cleared complete selection list');
    } else {
      toast.error('No matching rows found to clear');
    }
  };

  const handleDeleteSelection = (id: string) => {
    const existing = loadLocalSelections(currentUserId);
    const next = existing.filter((row) => row.id !== id);
    if (next.length === existing.length) {
      toast.error('Selection not found');
      return;
    }

    saveLocalSelections(currentUserId, next);
    setSelectionList(next);
    toast.success('Selection removed from list');
  };

  const handleAddSelection = async (clearOldForCurrent = false) => {
    if (!result) {
      toast.error("No valid recommendation to save");
      return;
    }
    if (!nameOfWork.trim() || !circuitRef.trim()) {
      toast.error("Name of Work and Circuit Ref are required before saving");
      return;
    }
    try {
      setSavingSelection(true);
      if (clearOldForCurrent) {
        clearSelectionsForCurrentWork();
      }

      const payload: SavedSelection = {
        id: `local-${Date.now()}`,
        userId: currentUserId || 'guest',
        nameOfWork: nameOfWork.trim(),
        circuitRef: circuitRef.trim(),
        applicationType,
        applicationLabel: selectedApplication.label,
        cableType: phaseAwareCableType,
        cableSize: result.selectedCable.description,
        cableSizeMetric: result.selectedCable.metric,
        mcb: result.selectedMCB.description,
        voltage: systemVoltage,
        phase: isThreePhaseVoltage(systemVoltage) ? '3-Phase' : '1-Phase',
        loadCurrent,
        powerKW,
        cableLength,
        ambientTemp,
        cableMaterial,
        vfdStarterEnabled,
        voltageDropPercent: parseFloat(((result.voltageDrop / normalizeVoltageForCalc(systemVoltage)) * 100).toFixed(2)),
        safetyMargin: result.safetyMargin,
        isCompliant: result.isCompliant,
        createdAt: new Date().toISOString(),
      };

      const existing = loadLocalSelections(currentUserId);
      const next = [payload, ...existing];
      saveLocalSelections(currentUserId, next);
      setSelectionList(next);

      toast.success(clearOldForCurrent ? 'Old list cleared and new selection saved in browser' : 'Selection added to browser list');
    } catch (error: any) {
      console.error(error);
      toast.error('Failed to save selection in browser storage');
    } finally {
      setSavingSelection(false);
    }
  };

  const rowsForCurrentWork = useMemo(() => {
    if (!nameOfWork.trim() || !circuitRef.trim()) return [];
    return selectionList.filter((row) => (
      row.nameOfWork?.trim().toLowerCase() === nameOfWork.trim().toLowerCase()
      && row.circuitRef?.trim().toLowerCase() === circuitRef.trim().toLowerCase()
    ));
  }, [selectionList, nameOfWork, circuitRef]);

  const handleDownloadPdf = () => {
    if (!nameOfWork.trim() || !circuitRef.trim()) {
      toast.error('Name of Work and Circuit Ref cannot be blank before PDF download');
      return;
    }

    const rowsForWork = rowsForCurrentWork;

    if (!rowsForWork.length) {
      toast.error('No saved selection found for this Name of Work / Circuit Ref');
      return;
    }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(14);
    doc.text('Cable & MCB Procurement Selection List', 40, 36);
    doc.setFontSize(10);
    doc.text(`Name of Work: ${nameOfWork.trim()}`, 40, 54);
    doc.text(`Circuit Ref: ${circuitRef.trim()}`, 40, 69);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 84);

    autoTable(doc, {
      startY: 96,
      head: [[
        'S.No',
        'Application Type',
        'VFD Starter',
        'Cable Type',
        'Cable Size',
        'MCB',
        'Voltage',
        'Load (A)',
        'Power (kW)',
        'Length (m)',
        'Ambient (°C)',
        'Material',
        'V.Drop %',
        'Safety %',
        'Compliance',
      ]],
      body: rowsForWork.map((row, idx) => [
        idx + 1,
        row.applicationLabel,
        row.vfdStarterEnabled ? 'Yes' : 'No',
        row.cableType,
        row.cableSize,
        row.mcb,
        `${row.voltage}V ${row.phase}`,
        row.loadCurrent.toFixed(1),
        row.powerKW.toFixed(2),
        row.cableLength.toFixed(0),
        row.ambientTemp.toFixed(0),
        row.cableMaterial,
        row.voltageDropPercent.toFixed(2),
        row.safetyMargin.toFixed(1),
        row.isCompliant ? 'Compliant' : 'Check',
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
    });

    const fileName = `Cable-MCB-Procurement-${nameOfWork.trim().replace(/\s+/g, '-')}-${circuitRef.trim().replace(/\s+/g, '-')}.pdf`;
    doc.save(fileName);
    toast.success('Procurement PDF downloaded');
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Zap className="h-7 w-7 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cable & MCB Sizing Tool</h1>
          <p className="text-slate-500 text-sm">Indian Standard Voltage & IS code aligned cable/MCB recommendation</p>
        </div>
      </div>

      {/* Name of Work (always at top) */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="pt-4 pb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-sm font-semibold text-blue-800">Name of Work / Project *</Label>
              <Input
                value={nameOfWork}
                onChange={(e) => setNameOfWork(e.target.value)}
                placeholder="e.g. AHU-3 Power Supply, Ground Floor Office Building"
                className="bg-white"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm font-semibold text-blue-800">Circuit Reference / Panel ID</Label>
              <Input
                value={circuitRef}
                onChange={(e) => setCircuitRef(e.target.value)}
                placeholder="e.g. MCC-1 / F1-CB-07"
                className="bg-white"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Input Panel */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Load Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Application Type */}
              <div className="space-y-1">
                <Label className="text-xs font-medium">Application Type</Label>
                <Select value={applicationType} onValueChange={(v) => setApplicationType(v as ProcurementApplicationType)}>
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pump_fan_dol">Pump / Fan DOL</SelectItem>
                    <SelectItem value="pump_fan_soft_starter">Pump / Fan (Soft Starter)</SelectItem>
                    <SelectItem value="electric_heater">Electric Heater</SelectItem>
                    <SelectItem value="lighting_load">Lighting Load</SelectItem>
                    <SelectItem value="general_purpose">Genarel Purpose</SelectItem>
                    <SelectItem value="chiller">Chiller</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-slate-500">{appProfile.description}</p>
              </div>

              {/* System Voltage */}
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs font-medium">System Voltage</Label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-500">Phase</span>
                    <Select
                      value={phaseMode}
                      onValueChange={(v) => handlePhaseChange(v as PhaseMode)}
                      disabled={!!APPLICATION_OPTIONS[applicationType].forcePhase}
                    >
                      <SelectTrigger className="h-6 w-[78px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1P">1P</SelectItem>
                        <SelectItem value="3P">3P</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Select value={systemVoltage.toString()} onValueChange={(v) => v && handleVoltageChange(parseInt(v))}>
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="230">230V (India)</SelectItem>
                    <SelectItem value="415">415V (India)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-slate-500">Only Indian standard voltage options are enabled.</p>
              </div>

              {/* Current OR kW — dual input */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Load — enter either</p>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Rated Current (A)</Label>
                  <Input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={loadCurrent}
                    onChange={(e) => handleCurrentChange(parseFloat(e.target.value) || 0)}
                    placeholder="e.g. 32 A"
                    className="text-sm font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Rated Power (kW)</Label>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.1"
                    value={powerKW}
                    onChange={(e) => handleKWChange(parseFloat(e.target.value) || 0)}
                    placeholder="e.g. 22 kW"
                    className="text-sm font-mono"
                  />
                </div>
                <p className="text-[10px] text-slate-500">PF = 0.85 assumed. Edit current or kW — the other updates automatically.</p>
              </div>

              {/* Cable Length */}
              <div className="space-y-1">
                <Label className="text-xs font-medium">Cable Length (m)</Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={cableLength}
                  onChange={(e) => setCableLength(parseFloat(e.target.value) || 1)}
                  placeholder="e.g. 50 m (motor to panel)"
                  className="text-sm font-mono"
                />
              </div>

              {/* Ambient Temperature */}
              <div className="space-y-1">
                <Label className="text-xs font-medium">Ambient Temperature (°C)</Label>
                <Input
                  type="number"
                  min="10"
                  max="70"
                  step="1"
                  value={ambientTemp}
                  onChange={(e) => setAmbientTemp(parseInt(e.target.value) || 40)}
                  placeholder="e.g. 40°C (IS 3961 reference)"
                  className="text-sm font-mono"
                />
                <p className="text-[10px] text-slate-500">IS 3961 reference: 40°C. Derate above 40°C.</p>
              </div>

              {/* Cable Placement */}
              <div className="space-y-1">
                <Label className="text-xs font-medium">Cable Placement / Installation Method</Label>
                <Select value={cablePlacement} onValueChange={(v) => v && setCablePlacement(v)}>
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PLACEMENT_CABLE_TYPES).map(([key, val]) => (
                      <SelectItem key={key} value={key}>{val.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Cable type recommendation */}
              {placementInfo && (
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs space-y-1">
                  <p className="font-semibold text-amber-800">{placementInfo.standard}</p>
                  <p className="text-amber-700"><strong>Recommended:</strong> {placementInfo.type}</p>
                  <p className="text-amber-600 italic">{placementInfo.note}</p>
                </div>
              )}

              {/* Cable Material */}
              <div className="space-y-1">
                <Label className="text-xs font-medium">Conductor Material</Label>
                <Select value={cableMaterial} onValueChange={(v) => setCableMaterial(v as any)}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="copper">Copper (IS 8130 — preferred)</SelectItem>
                    <SelectItem value="aluminum">Aluminum (above 16 mm²)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Bundled Cables */}
              <div className="space-y-1">
                <Label className="text-xs font-medium">Cables in Conduit / Tray</Label>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={bundledCables}
                  onChange={(e) => setBundledCables(Math.max(1, parseInt(e.target.value) || 1))}
                  placeholder="1"
                  className="text-sm font-mono"
                />
                <p className="text-[10px] text-slate-500">Grouping derate per IS 3961 / IEC 60364-5-52</p>
              </div>

              {/* Voltage Drop Limit */}
              <div className="space-y-1">
                <Label className="text-xs font-medium">Max Voltage Drop (%)</Label>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  step="0.5"
                  value={voltageDropLimit}
                  onChange={(e) => setVoltageDropLimit(parseFloat(e.target.value) || 3)}
                  placeholder="3% (IS 732 limit)"
                  className="text-sm font-mono"
                />
                <p className="text-[10px] text-slate-500">IS 732: ≤ 3% for final sub-circuits; ≤ 5% overall</p>
              </div>

              {/* Starting method note */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-1">
                <p className="text-xs font-semibold text-blue-800">Starting Method</p>
                <p className="text-xs text-blue-700">{appProfile.startingMethod}</p>
                <p className="text-[10px] text-blue-600">
                  {useStartingProtection ? 'Starting protection is considered in calculation (Soft-Starter / VFD effect).' : 'DOL/direct profile considered in calculation.'}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-2 space-y-4">
          {/* Power summary */}
          <Card className="bg-gradient-to-r from-blue-50 to-indigo-50">
            <CardContent className="pt-5">
              <div className="grid grid-cols-4 gap-3">
                <div className="text-center p-3 bg-white rounded-lg border border-blue-200">
                  <p className="text-xs text-slate-600">Rated Power</p>
                  <p className="text-2xl font-bold text-blue-600">{powerKW.toFixed(2)}<span className="text-sm ml-1">kW</span></p>
                  <p className="text-xs text-slate-500">{isThreePhaseVoltage(systemVoltage) ? '3-Phase' : '1-Phase'}</p>
                </div>
                <div className="text-center p-3 bg-white rounded-lg border border-slate-200">
                  <p className="text-xs text-slate-600">Rated Current</p>
                  <p className="text-2xl font-bold text-slate-700">{loadCurrent.toFixed(1)}<span className="text-sm ml-1">A</span></p>
                </div>
                <div className="text-center p-3 bg-orange-50 rounded-lg border border-orange-200">
                  <p className="text-xs text-orange-600">Peak Inrush</p>
                  <p className="text-2xl font-bold text-orange-600">{inrushCurrent.toFixed(0)}<span className="text-sm ml-1">A</span></p>
                  <p className="text-xs text-orange-500">{loadCurrent > 0 ? (inrushCurrent / loadCurrent).toFixed(1) : '—'}×</p>
                </div>
                <div className="text-center p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <p className="text-xs text-amber-700">Inrush Duration</p>
                  <p className="text-2xl font-bold text-amber-700">{appProfile.inrushDuration}<span className="text-sm ml-1">ms</span></p>
                  <p className="text-xs text-amber-600">{appProfile.startingMethod}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {result ? (
            <>
              {/* Compliance */}
              <Card className={result.isCompliant ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Compliance Status</CardTitle>
                    {result.isCompliant
                      ? <Badge className="bg-green-600">✓ COMPLIANT</Badge>
                      : <Badge className="bg-red-600">✗ NON-COMPLIANT</Badge>
                    }
                  </div>
                </CardHeader>
                <CardContent>
                  {result.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 text-red-700 text-sm">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                      <p>{w}</p>
                    </div>
                  ))}
                  {result.isCompliant && (
                    <p className="text-sm text-green-700 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" /> All parameters within IS / IEC limits
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Selection Table */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-base">Selection Summary</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => handleAddSelection()} className="gap-1" disabled={savingSelection}>
                      <Save className="h-4 w-4" />
                      {savingSelection ? 'Saving...' : 'Add to Selection List'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAddSelection(true)}
                      disabled={savingSelection}
                    >
                      {savingSelection ? 'Saving...' : 'New List + Save'}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <tbody>
                        <tr className="border-b border-gray-100">
                          <td className="py-2 pr-4 text-xs font-semibold text-gray-500 uppercase w-40">Parameter</td>
                          <td className="py-2 font-semibold">Value</td>
                          <td className="py-2 text-xs text-gray-500">Remarks</td>
                        </tr>
                        <tr className="border-b border-gray-100 bg-blue-50">
                          <td className="py-2 pr-4 text-xs text-gray-500">Cable Size</td>
                          <td className="py-2 font-bold text-blue-700">{result.selectedCable.description}</td>
                          <td className="py-2 text-xs text-gray-500">{result.selectedCable.metric} mm²</td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="py-2 pr-4 text-xs text-gray-500">Cable Type</td>
                          <td className="py-2 font-medium">{phaseAwareCableType}</td>
                          <td className="py-2 text-xs text-gray-500">{placementInfo?.standard}</td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="py-2 pr-4 text-xs text-gray-500">Conductor</td>
                          <td className="py-2 font-medium capitalize">{cableMaterial}</td>
                          <td className="py-2 text-xs text-gray-500">IS 8130</td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="py-2 pr-4 text-xs text-gray-500">Base Ampacity</td>
                          <td className="py-2 font-medium">{result.selectedAmpacity.ampacity} A</td>
                          <td className="py-2 text-xs text-gray-500">@ {result.selectedAmpacity.temperature}°C</td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="py-2 pr-4 text-xs text-gray-500">Safety Margin</td>
                          <td className="py-2 font-medium">{result.safetyMargin.toFixed(1)}%</td>
                          <td className="py-2 text-xs text-gray-500">Min 20% recommended</td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="py-2 pr-4 text-xs text-gray-500">Voltage Drop</td>
                          <td className={`py-2 font-bold ${((result.voltageDrop / systemVoltage) * 100) <= voltageDropLimit ? 'text-green-600' : 'text-red-600'}`}>
                            {((result.voltageDrop / normalizeVoltageForCalc(systemVoltage)) * 100).toFixed(2)}%
                          </td>
                          <td className="py-2 text-xs text-gray-500">Limit: {voltageDropLimit}% (IS 732)</td>
                        </tr>
                        <tr className="border-b border-gray-100 bg-orange-50">
                          <td className="py-2 pr-4 text-xs text-gray-500">MCB / MCCB</td>
                          <td className="py-2 font-bold text-orange-700">{result.selectedMCB.description}</td>
                          <td className="py-2 text-xs text-gray-500">{result.selectedMCB.poles}-pole, {result.selectedMCB.voltage}V · IS 13947</td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="py-2 pr-4 text-xs text-gray-500">Recommended MCB Curve</td>
                          <td className="py-2 font-medium">{appProfile.recommendedProtection}</td>
                          <td className="py-2 text-xs text-gray-500">IS 13947 / IEC 60898</td>
                        </tr>
                        <tr>
                          <td className="py-2 pr-4 text-xs text-gray-500">Installation</td>
                          <td className="py-2 font-medium">{placementInfo?.label ?? cablePlacement}</td>
                          <td className="py-2 text-xs text-gray-500">{placementInfo?.standard}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {coordinationCheck && (
                    <div className={`mt-3 p-3 rounded-lg border-l-4 text-sm ${
                      coordinationCheck.isCoordinated
                        ? 'bg-green-50 border-green-400 text-green-700'
                        : 'bg-red-50 border-red-400 text-red-700'
                    }`}>
                      <p className="font-medium">Coordination Check</p>
                      <p>{coordinationCheck.message}</p>
                    </div>
                  )}

                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={vfdStarterEnabled}
                        onChange={(e) => setVfdStarterEnabled(e.target.checked)}
                      />
                      VFD Starter fitted (apply reduced starting current for sizing)
                    </label>
                  </div>
                </CardContent>
              </Card>

              {/* Technical Notes */}
              {result.notes.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Info className="h-4 w-4" /> Technical Notes
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1.5">
                      {result.notes.map((note, idx) => (
                        <li key={idx} className="flex gap-2 text-sm text-slate-700">
                          <span className="text-blue-600 font-bold shrink-0">•</span>
                          {note}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Saved procurement list */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Saved Selection List (Procurement)</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={handleClearList} className="gap-1">
                      <Trash2 className="h-4 w-4" />
                      Clear List
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleDownloadPdf} className="gap-1">
                      <Download className="h-4 w-4" />
                      Download PDF
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {rowsForCurrentWork.length === 0 ? (
                    <p className="text-sm text-slate-500">No saved selections yet. Add recommendations to build your procurement list.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      {nameOfWork.trim() && circuitRef.trim() && (
                        <p className="text-xs text-slate-500 mb-2">
                          Showing list for current work/circuit: <span className="font-medium text-slate-700">{nameOfWork.trim()} / {circuitRef.trim()}</span>
                        </p>
                      )}
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr className="border-b bg-slate-50">
                            <th className="text-left py-2 px-2 text-xs font-semibold text-slate-600">Name of Work</th>
                            <th className="text-left py-2 px-2 text-xs font-semibold text-slate-600">Circuit Ref</th>
                            <th className="text-left py-2 px-2 text-xs font-semibold text-slate-600">Application</th>
                            <th className="text-left py-2 px-2 text-xs font-semibold text-slate-600">Cable Type</th>
                            <th className="text-left py-2 px-2 text-xs font-semibold text-slate-600">Size</th>
                            <th className="text-left py-2 px-2 text-xs font-semibold text-slate-600">MCB</th>
                            <th className="text-left py-2 px-2 text-xs font-semibold text-slate-600">Other Details</th>
                            <th className="text-left py-2 px-2 text-xs font-semibold text-slate-600">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rowsForCurrentWork.map((row) => (
                            <tr key={row.id} className="border-b border-slate-100">
                              <td className="py-2 px-2">{row.nameOfWork}</td>
                              <td className="py-2 px-2">{row.circuitRef}</td>
                              <td className="py-2 px-2">{row.applicationLabel}</td>
                              <td className="py-2 px-2">{row.cableType}</td>
                              <td className="py-2 px-2">{row.cableSize}</td>
                              <td className="py-2 px-2">{row.mcb}</td>
                              <td className="py-2 px-2 text-xs text-slate-500">
                                {row.voltage}V, {row.loadCurrent.toFixed(1)}A, {row.powerKW.toFixed(2)}kW, {row.cableLength}m, VFD {row.vfdStarterEnabled ? 'Yes' : 'No'}, Vdrop {row.voltageDropPercent.toFixed(2)}%
                              </td>
                              <td className="py-2 px-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs gap-1"
                                  onClick={() => handleDeleteSelection(row.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Delete
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3 text-red-700">
                  <AlertCircle className="h-5 w-5 mt-1 shrink-0" />
                  <div>
                    <p className="font-semibold">No Valid Configuration</p>
                    <p className="text-sm mt-1">Adjust parameters to find a suitable cable and breaker.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Standards Reference */}
      <Card className="bg-slate-50 border-slate-200">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="h-4 w-4" /> IS Code & International Standards Reference
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-slate-700">
            <div>
              <p className="font-semibold text-slate-900 mb-2">Indian Standards (IS)</p>
              <ul className="space-y-1">
                <li><strong>IS 3961 (Pt 1–5)</strong> — Current ratings for cables (PVC/XLPE/Paper)</li>
                <li><strong>IS 732</strong> — Code of practice for electrical wiring installations</li>
                <li><strong>IS 1554 Pt.1</strong> — PVC cables up to 1100 V</li>
                <li><strong>IS 7098 Pt.1</strong> — XLPE cables up to 1.1 kV</li>
                <li><strong>IS 8130</strong> — Conductors for insulated cables</li>
                <li><strong>IS 13947</strong> — LV switchgear (MCB/MCCB spec)</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-slate-900 mb-2">International Standards</p>
              <ul className="space-y-1">
                <li><strong>IEC 60364-5-52</strong> — Cable selection and installation</li>
                <li><strong>IEC 60898</strong> — MCB for household/similar</li>
                <li><strong>IEC 60947-2</strong> — MCCB for industrial use</li>
                <li><strong>NEC Art. 310</strong> — Conductors for general wiring (USA)</li>
                <li><strong>NEC Art. 240</strong> — Overcurrent protection (USA)</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-slate-900 mb-2">Inrush & Protection Curves</p>
              <ul className="space-y-1">
                <li>Motor DOL: 5–8× → <strong>Type D MCB</strong></li>
                <li>Chiller: 5–6× → <strong>Type D / MCCB</strong></li>
                <li>Soft-Starter / VFD: 1–3× → <strong>Type B/C OK</strong></li>
                <li>Heater / Lighting: 1–2× → <strong>Type B MCB</strong></li>
                <li>General: 2–4× → <strong>Type C MCB</strong></li>
                <li>Voltage drop limit: <strong>3%</strong> sub-circuit, <strong>5%</strong> total (IS 732)</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
