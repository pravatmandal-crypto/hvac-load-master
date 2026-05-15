import React, { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Zap, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  sizeCableAndMCB,
  calculateVoltageDrop,
  calculateVoltagDropPercent,
  checkCoordination,
  CABLE_SIZES,
  ELECTRICAL_CONSTANTS,
} from "@/lib/electrical";

export function CableMCBSelector() {
  // Input state
  const [loadCurrent, setLoadCurrent] = useState<number>(32); // Amps
  const [systemVoltage, setSystemVoltage] = useState<number>(230); // V
  const [cableLength, setCableLength] = useState<number>(50); // meters
  const [loadType, setLoadType] = useState<"resistive" | "inductive" | "mixed">(
    "mixed"
  );
  const [ambientTemp, setAmbientTemp] = useState<number>(30); // °C
  const [bundledCables, setBundledCables] = useState<number>(1);
  const [cableMaterial, setCableMaterial] = useState<"copper" | "aluminum">(
    "copper"
  );
  const [voltageDropLimit, setVoltageDropLimit] = useState<number>(3.0); // %

  // Calculate sizing
  const result = useMemo(() => {
    return sizeCableAndMCB(
      loadCurrent,
      systemVoltage,
      cableLength,
      loadType,
      ambientTemp,
      bundledCables,
      voltageDropLimit,
      cableMaterial
    );
  }, [loadCurrent, systemVoltage, cableLength, loadType, ambientTemp, bundledCables, voltageDropLimit, cableMaterial]);

  const coordinationCheck = useMemo(() => {
    if (!result) return null;
    return checkCoordination(result.selectedCable, result.selectedMCB, systemVoltage);
  }, [result, systemVoltage]);

  const calculatePower = useMemo(() => {
    const power = loadCurrent * systemVoltage;
    if (systemVoltage === 400) {
      return power * Math.sqrt(3); // 3-phase
    }
    return power;
  }, [loadCurrent, systemVoltage]);

  const handleExport = () => {
    if (!result) {
      toast.error("No valid sizing result to export");
      return;
    }

    const csvContent = [
      "Cable & MCB Sizing Report",
      new Date().toLocaleString(),
      "",
      "LOAD PARAMETERS",
      `Load Current,${loadCurrent},A`,
      `Calculated Power,${(calculatePower / 1000).toFixed(1)},kW`,
      `System Voltage,${systemVoltage},V`,
      `Cable Length,${cableLength},m`,
      `Load Type,${loadType}`,
      `Ambient Temperature,${ambientTemp},°C`,
      `Bundled Cables,${bundledCables}`,
      `Cable Material,${cableMaterial}`,
      "",
      "SIZING RESULTS",
      `Cable Size,${result.selectedCable.description}`,
      `Base Ampacity,${result.selectedAmpacity.ampacity},A`,
      `Derated Ampacity,${result.selectedAmpacity.ampacity},A`,
      `Safety Margin,${result.safetyMargin.toFixed(1)},%`,
      `Voltage Drop,${result.voltageDrop.toFixed(3)},V`,
      `Selected MCB,${result.selectedMCB.description}`,
      `Compliance Status,${result.isCompliant ? "COMPLIANT" : "NON-COMPLIANT"}`,
      "",
      "COMPLIANCE NOTES",
      ...result.warnings.map((w) => `WARNING,${w}`),
      ...result.notes.map((n) => `NOTE,${n}`),
    ].join("\n");

    const element = document.createElement("a");
    element.setAttribute(
      "href",
      "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent)
    );
    element.setAttribute("download", `cable-mcb-sizing-${Date.now()}.csv`);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    toast.success("Report downloaded successfully");
  };

  return (
    <div className="space-y-6 p-6 bg-gradient-to-br from-blue-50 to-indigo-50">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Zap className="h-8 w-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-slate-900">
              Cable & MCB Sizing Tool
            </h1>
          </div>
          <p className="text-slate-600">
            Professional electrical cable and circuit breaker selection based on
            NEC, IEC, and BS standards
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Input Panel */}
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Load Parameters</CardTitle>
                <CardDescription>Configure your circuit requirements</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Load Current */}
                <div className="space-y-2">
                  <Label htmlFor="load-current" className="text-sm font-medium">
                    Load Current: <span className="font-bold text-blue-600">{loadCurrent}A</span>
                  </Label>
                  <Slider
                    id="load-current"
                    min={1}
                    max={200}
                    step={1}
                    value={[loadCurrent]}
                    onValueChange={(val) => setLoadCurrent(val[0])}
                    className="w-full"
                  />
                  <NumericInput
                    min={0} max={1000}
                    value={loadCurrent}
                    onChange={(n) => setLoadCurrent(n ?? 0)}
                    placeholder="Amps"
                    className="text-sm"
                  />
                </div>

                {/* System Voltage */}
                <div className="space-y-2">
                  <Label htmlFor="voltage" className="text-sm font-medium">
                    System Voltage
                  </Label>
                  <Select
                    value={systemVoltage.toString()}
                    onValueChange={(v) => setSystemVoltage(parseInt(v))}
                  >
                    <SelectTrigger id="voltage" className="text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="230">230V (1-Phase)</SelectItem>
                      <SelectItem value="400">400V (3-Phase)</SelectItem>
                      <SelectItem value="120">120V (USA)</SelectItem>
                      <SelectItem value="480">480V (3-Phase USA)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Cable Length */}
                <div className="space-y-2">
                  <Label htmlFor="cable-length" className="text-sm font-medium">
                    Cable Length: <span className="font-bold text-blue-600">{cableLength}m</span>
                  </Label>
                  <Slider
                    id="cable-length"
                    min={0}
                    max={500}
                    step={5}
                    value={[cableLength]}
                    onValueChange={(val) => setCableLength(val[0])}
                    className="w-full"
                  />
                </div>

                {/* Load Type */}
                <div className="space-y-2">
                  <Label htmlFor="load-type" className="text-sm font-medium">
                    Load Type
                  </Label>
                  <Select
                    value={loadType}
                    onValueChange={(v) => setLoadType(v as any)}
                  >
                    <SelectTrigger id="load-type" className="text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="resistive">
                        Resistive (Heaters, Lighting)
                      </SelectItem>
                      <SelectItem value="mixed">
                        Mixed (Most Common)
                      </SelectItem>
                      <SelectItem value="inductive">
                        Inductive (Motors, Compressors)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Ambient Temperature */}
                <div className="space-y-2">
                  <Label htmlFor="ambient-temp" className="text-sm font-medium">
                    Ambient: <span className="font-bold text-blue-600">{ambientTemp}°C</span>
                  </Label>
                  <Slider
                    id="ambient-temp"
                    min={0}
                    max={60}
                    step={1}
                    value={[ambientTemp]}
                    onValueChange={(val) => setAmbientTemp(val[0])}
                    className="w-full"
                  />
                </div>

                {/* Bundled Cables */}
                <div className="space-y-2">
                  <Label htmlFor="bundled" className="text-sm font-medium">
                    Bundled Cables: <span className="font-bold text-blue-600">{bundledCables}</span>
                  </Label>
                  <Slider
                    id="bundled"
                    min={1}
                    max={10}
                    step={1}
                    value={[bundledCables]}
                    onValueChange={(val) => setBundledCables(val[0])}
                    className="w-full"
                  />
                </div>

                {/* Cable Material */}
                <div className="space-y-2">
                  <Label htmlFor="material" className="text-sm font-medium">
                    Cable Material
                  </Label>
                  <Select
                    value={cableMaterial}
                    onValueChange={(v) => setCableMaterial(v as any)}
                  >
                    <SelectTrigger id="material" className="text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="copper">Copper (Recommended)</SelectItem>
                      <SelectItem value="aluminum">Aluminum</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Voltage Drop Limit */}
                <div className="space-y-2">
                  <Label htmlFor="vd-limit" className="text-sm font-medium">
                    Max VD: <span className="font-bold text-blue-600">{voltageDropLimit.toFixed(1)}%</span>
                  </Label>
                  <Slider
                    id="vd-limit"
                    min={1}
                    max={5}
                    step={0.5}
                    value={[voltageDropLimit]}
                    onValueChange={(val) => setVoltageDropLimit(val[0])}
                    className="w-full"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Results Panel */}
          <div className="lg:col-span-2 space-y-4">
            {/* Power Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Load Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="text-sm text-slate-600">Calculated Power</p>
                    <p className="text-2xl font-bold text-blue-600">
                      {(calculatePower / 1000).toFixed(2)} {systemVoltage === 400 ? "kW (3Φ)" : "kW"}
                    </p>
                  </div>
                  <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                    <p className="text-sm text-slate-600">Circuit Current</p>
                    <p className="text-2xl font-bold text-indigo-600">{loadCurrent}A</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Sizing Results */}
            {result ? (
              <>
                {/* Compliance Status */}
                <Card
                  className={
                    result.isCompliant
                      ? "border-green-200 bg-green-50"
                      : "border-red-200 bg-red-50"
                  }
                >
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">Compliance Status</CardTitle>
                      {result.isCompliant ? (
                        <Badge className="bg-green-600">COMPLIANT</Badge>
                      ) : (
                        <Badge className="bg-red-600">NON-COMPLIANT</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {result.isCompliant ? (
                      <div className="flex items-start gap-2 text-green-700">
                        <CheckCircle2 className="h-5 w-5 mt-0.5 flex-shrink-0" />
                        <p className="text-sm">
                          Cable and MCB sizing meets all safety standards and
                          requirements
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 text-red-700 mb-3">
                        <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                        <p className="text-sm font-medium">
                          Configuration does not meet safety requirements
                        </p>
                      </div>
                    )}

                    {result.warnings.length > 0 && (
                      <div className="space-y-1">
                        {result.warnings.map((warning, idx) => (
                          <div key={idx} className="flex items-start gap-2 text-amber-700">
                            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                            <p className="text-sm">{warning}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Cable Selection */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Cable Selection</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border-2 border-blue-300">
                      <p className="text-sm text-slate-600 mb-1">Selected Cable</p>
                      <p className="text-2xl font-bold text-blue-600">
                        {result.selectedCable.description}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {result.selectedCable.metric}mm² | Ø{result.selectedCable.diameter}mm
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-slate-100 rounded-lg">
                        <p className="text-xs text-slate-600">Base Ampacity</p>
                        <p className="text-xl font-bold text-slate-900">
                          {result.selectedAmpacity.ampacity}A
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          @ {result.selectedAmpacity.temperature}°C
                        </p>
                      </div>
                      <div className="p-3 bg-slate-100 rounded-lg">
                        <p className="text-xs text-slate-600">Safety Margin</p>
                        <p className="text-xl font-bold text-green-600">
                          {result.safetyMargin.toFixed(1)}%
                        </p>
                      </div>
                    </div>

                    {cableLength > 0 && (
                      <div className="p-3 bg-slate-100 rounded-lg">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-slate-600">Voltage Drop</span>
                          <span
                            className={`text-sm font-semibold ${
                              result.voltageDrop / systemVoltage <= voltageDropLimit / 100
                                ? "text-green-600"
                                : "text-red-600"
                            }`}
                          >
                            {(
                              (result.voltageDrop / systemVoltage) *
                              100
                            ).toFixed(2)}
                            % ({result.voltageDrop.toFixed(2)}V)
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          Limit: {voltageDropLimit}%
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* MCB Selection */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">MCB/MCCB Selection</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-4 bg-gradient-to-r from-orange-50 to-amber-50 rounded-lg border-2 border-orange-300">
                      <p className="text-sm text-slate-600 mb-1">Selected Breaker</p>
                      <p className="text-2xl font-bold text-orange-600">
                        {result.selectedMCB.description}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Poles: {result.selectedMCB.poles} | Voltage: {result.selectedMCB.voltage}V
                      </p>
                    </div>

                    {coordinationCheck && (
                      <div
                        className={`p-3 rounded-lg border-l-4 ${
                          coordinationCheck.isCoordinated
                            ? "bg-green-50 border-green-400"
                            : "bg-red-50 border-red-400"
                        }`}
                      >
                        <p className="text-sm font-medium text-slate-900">
                          Coordination Check
                        </p>
                        <p
                          className={`text-sm mt-1 ${
                            coordinationCheck.isCoordinated
                              ? "text-green-700"
                              : "text-red-700"
                          }`}
                        >
                          {coordinationCheck.message}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Notes */}
                {result.notes.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Technical Notes</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {result.notes.map((note, idx) => (
                          <li key={idx} className="flex gap-2 text-sm text-slate-700">
                            <span className="text-blue-600 font-bold">•</span>
                            {note}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Export Button */}
                <Button
                  onClick={handleExport}
                  className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
                  size="lg"
                >
                  Download Report (CSV)
                </Button>
              </>
            ) : (
              <Card className="border-red-200 bg-red-50">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3 text-red-700">
                    <AlertCircle className="h-5 w-5 mt-1 flex-shrink-0" />
                    <div>
                      <p className="font-semibold">No Valid Configuration</p>
                      <p className="text-sm mt-1">
                        Please adjust parameters to find a suitable cable and MCB.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Standards Reference */}
        <Card className="mt-6 bg-slate-50">
          <CardHeader>
            <CardTitle className="text-sm">Safety Standards</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-xs text-slate-600 space-y-1">
              <li>
                🇺🇸 <strong>NEC (National Electrical Code)</strong> - Chapter 3,
                Table 310.15 for ampacity; Chapter 2 for protection
              </li>
              <li>
                🌍 <strong>IEC 60364</strong> - International standard for electrical
                installations in buildings
              </li>
              <li>
                🇬🇧 <strong>BS 7909</strong> - Temporary electrical systems for
                entertainment and events
              </li>
              <li>
                • Load current includes 25% safety factor (125% diversity)
              </li>
              <li>
                • Voltage drop limits: 3% feeder + 2% branch = 5% max total
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
