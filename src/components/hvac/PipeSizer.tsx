import { useState, useMemo } from 'react';
import { Droplets, Ruler, Gauge, Info, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { sizePipe } from '../../lib/hvac-logic';
import { toast } from 'sonner';

const PIPE_TABLE: { nominal: string; id: number; od: number }[] = [
  { nominal: '1/2"',   id: 0.622,  od: 0.840  },
  { nominal: '3/4"',   id: 0.824,  od: 1.050  },
  { nominal: '1"',     id: 1.049,  od: 1.315  },
  { nominal: '1-1/4"', id: 1.380,  od: 1.660  },
  { nominal: '1-1/2"', id: 1.610,  od: 1.900  },
  { nominal: '2"',     id: 2.067,  od: 2.375  },
  { nominal: '2-1/2"', id: 2.469,  od: 2.875  },
  { nominal: '3"',     id: 3.068,  od: 3.500  },
  { nominal: '4"',     id: 4.026,  od: 4.500  },
  { nominal: '5"',     id: 5.047,  od: 5.563  },
  { nominal: '6"',     id: 6.065,  od: 6.625  },
  { nominal: '8"',     id: 7.981,  od: 8.625  },
  { nominal: '10"',    id: 10.020, od: 10.750 },
  { nominal: '12"',    id: 11.938, od: 12.750 },
];

function getStandardPipe(idRequired: number) {
  return PIPE_TABLE.find((p) => p.id >= idRequired) ?? PIPE_TABLE[PIPE_TABLE.length - 1];
}

function frictionLoss100(gpm: number, id: number, C = 150): number {
  return 10.44 * Math.pow(gpm, 1.85) / (Math.pow(C, 1.85) * Math.pow(id, 4.87));
}

const MATERIAL_C: Record<string, number> = {
  Copper: 150,
  'Steel (new)': 140,
  'Steel (aged)': 120,
  PVC: 150,
  CPVC: 150,
  'Cast Iron': 100,
  'Stainless Steel': 150,
};

const VELOCITY_GUIDE: Record<string, { min: number; max: number; note: string }> = {
  'Chilled Water (main)': { min: 3, max: 8, note: 'IS 659 / ASHRAE 90.1' },
  'Chilled Water (branch)': { min: 2, max: 5, note: 'Noise-sensitive — keep ≤ 4 FPS' },
  'Hot Water (main)': { min: 3, max: 8, note: 'IS 659 / ASHRAE 90.1' },
  'Hot Water (branch)': { min: 2, max: 5, note: 'Thermal expansion considered' },
  'Condenser Water': { min: 4, max: 10, note: 'Higher velocity OK for cooling tower loops' },
  'Steam (low pressure)': { min: 15, max: 50, note: 'IS 1239 — velocity in FPS for steam' },
  'Glycol Solution': { min: 2, max: 6, note: 'Higher viscosity — derate Cv' },
  'Domestic Cold Water': { min: 2, max: 8, note: 'IS 1239 / NBC 2016' },
};

export default function PipeSizer() {
  const [gpm, setGpm] = useState(20);
  const [maxVelocity, setMaxVelocity] = useState(5);
  const [pipeLength, setPipeLength] = useState(100);
  const [material, setMaterial] = useState('Copper');
  const [fluidType, setFluidType] = useState('Chilled Water (main)');

  const C = MATERIAL_C[material] ?? 150;

  const result = useMemo(() => {
    const minID = sizePipe(gpm, maxVelocity).diameter;
    const pipe = getStandardPipe(minID);
    const actualVelocity = gpm / (2.45 * pipe.id * pipe.id);
    const hl100 = frictionLoss100(gpm, pipe.id, C);
    const totalHL = (hl100 * pipeLength) / 100;
    return { minID, pipe, actualVelocity, hl100, totalHL };
  }, [gpm, maxVelocity, pipeLength, C]);

  const guide = VELOCITY_GUIDE[fluidType];

  const handleExport = () => {
    const rows = [
      'Hydronic Pipe Sizing Report',
      new Date().toLocaleString(),
      '',
      'INPUTS',
      `Flow Rate,${gpm},GPM`,
      `Max Velocity,${maxVelocity},FPS`,
      `Pipe Length,${pipeLength},ft`,
      `Material,${material}`,
      `Fluid / Application,${fluidType}`,
      '',
      'RESULTS',
      `Min Internal Diameter Required,${result.minID.toFixed(3)},in`,
      `Selected Nominal Size,${result.pipe.nominal}`,
      `Internal Diameter (actual),${result.pipe.id.toFixed(3)},in`,
      `Actual Flow Velocity,${result.actualVelocity.toFixed(2)},FPS`,
      `Friction Loss per 100 ft,${result.hl100.toFixed(3)},psi/100ft`,
      `Total Friction Loss (${pipeLength} ft),${result.totalHL.toFixed(2)},psi`,
      '',
      'STANDARDS REFERENCE',
      'IS 1239 — Steel Tubes for Water, Gas & Sanitation',
      'IS 659 — Hydronic Piping Systems',
      'NBC 2016 Part 9 — Plumbing Services',
      'ASHRAE 90.1 — Pipe Insulation & Sizing',
    ].join('\n');

    const el = document.createElement('a');
    el.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows));
    el.setAttribute('download', `pipe-sizing-${gpm}gpm-${Date.now()}.csv`);
    el.click();
    toast.success('Pipe sizing report downloaded');
  };

  const velocityStatus = (() => {
    const v = result.actualVelocity;
    if (v > guide.max) return { label: 'Too High', color: 'text-red-600 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900' };
    if (v < guide.min) return { label: 'Below Recommended', color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900' };
    return { label: 'Acceptable', color: 'text-green-700 bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900' };
  })();

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Hydronic Pipe Sizer</h2>
        <p className="text-gray-500 dark:text-slate-400 text-sm mt-1">
          Hazen-Williams equation · IS 1239 / ASHRAE 90.1 · Standard pipe schedule
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Inputs */}
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Droplets className="w-5 h-5 text-cyan-500" />
              Flow Parameters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium text-gray-600 dark:text-slate-400">Flow Rate (GPM)</Label>
                <Input
                  type="text" inputMode="decimal"
                  value={gpm}
                  onChange={(e) => setGpm(Math.max(0.1, Number(e.target.value)))}
                  placeholder="e.g. 20"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-gray-600 dark:text-slate-400">Max Velocity (FPS)</Label>
                <Input
                  type="text" inputMode="decimal"
                  step="0.5"
                  value={maxVelocity}
                  onChange={(e) => setMaxVelocity(Math.max(0.5, Number(e.target.value)))}
                  placeholder="e.g. 5"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-gray-600 dark:text-slate-400">Pipe Length (ft)</Label>
                <Input
                  type="text" inputMode="decimal"
                  step="10"
                  value={pipeLength}
                  onChange={(e) => setPipeLength(Math.max(1, Number(e.target.value)))}
                  placeholder="e.g. 100"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-gray-600 dark:text-slate-400">Pipe Material</Label>
                <Select value={material} onValueChange={setMaterial}>
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.keys(MATERIAL_C).map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium text-gray-600 dark:text-slate-400">Fluid / Application Type</Label>
              <Select value={fluidType} onValueChange={setFluidType}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(VELOCITY_GUIDE).map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className={`p-3 rounded-lg border text-xs ${velocityStatus.color}`}>
              <div className="flex justify-between items-center mb-1">
                <span className="font-semibold">{fluidType}</span>
                <span className="font-bold">{velocityStatus.label}</span>
              </div>
              <p>Recommended: {guide.min}–{guide.max} FPS · {guide.note}</p>
            </div>
          </CardContent>
        </Card>

        {/* Results — coloured panel, works in both modes */}
        <Card className="border-none shadow-sm bg-cyan-600 text-white overflow-hidden">
          <CardHeader>
            <CardTitle className="text-cyan-100 text-sm font-medium uppercase tracking-wider">
              Sizing Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
                <Gauge className="w-7 h-7" />
              </div>
              <div>
                <p className="text-xs text-cyan-200 uppercase tracking-wider">Selected Pipe</p>
                <h3 className="text-4xl font-bold">{result.pipe.nominal}</h3>
                <p className="text-xs text-cyan-200 mt-0.5">
                  ID {result.pipe.id.toFixed(3)}" · OD {result.pipe.od.toFixed(3)}"
                </p>
              </div>
            </div>

            <div className="flex items-center gap-5">
              <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
                <Ruler className="w-7 h-7" />
              </div>
              <div>
                <p className="text-xs text-cyan-200 uppercase tracking-wider">Actual Velocity</p>
                <h3 className="text-4xl font-bold">{result.actualVelocity.toFixed(2)} <span className="text-base font-normal">FPS</span></h3>
              </div>
            </div>

            <div className="pt-3 border-t border-white/20 grid grid-cols-2 gap-2 text-sm">
              <div className="bg-white/10 rounded-lg p-2">
                <p className="text-cyan-200 text-xs">ΔP / 100 ft</p>
                <p className="font-semibold">{result.hl100.toFixed(2)} psi</p>
              </div>
              <div className="bg-white/10 rounded-lg p-2">
                <p className="text-cyan-200 text-xs">Total ΔP ({pipeLength} ft)</p>
                <p className="font-semibold">{result.totalHL.toFixed(2)} psi</p>
              </div>
              <div className="bg-white/10 rounded-lg p-2">
                <p className="text-cyan-200 text-xs">Min ID needed</p>
                <p className="font-semibold">{result.minID.toFixed(3)}"</p>
              </div>
              <div className="bg-white/10 rounded-lg p-2">
                <p className="text-cyan-200 text-xs">H-W C factor</p>
                <p className="font-semibold">{C}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Standard pipe size table */}
      <Card className="border-none shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            Pipe Selection Reference — IS 1239 / Schedule 40
          </CardTitle>
          <Button size="sm" variant="outline" onClick={handleExport} className="gap-1">
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-700">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Nominal</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">ID (in)</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">OD (in)</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Flow @ {maxVelocity} FPS (GPM)</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">ΔP/100ft @ {gpm} GPM (psi)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {PIPE_TABLE.map((p) => {
                  const maxGpm = 2.45 * p.id * p.id * maxVelocity;
                  const dp = frictionLoss100(gpm, p.id, C);
                  const isSelected = p.nominal === result.pipe.nominal;
                  return (
                    <tr key={p.nominal} className={isSelected ? 'bg-cyan-50 dark:bg-cyan-950/30 font-semibold' : ''}>
                      <td className="py-2 px-3 dark:text-slate-300">
                        {p.nominal}
                        {isSelected && <span className="ml-2 text-xs text-cyan-700 dark:text-cyan-400 font-bold">← Selected</span>}
                      </td>
                      <td className="py-2 px-3 text-right font-mono dark:text-slate-400">{p.id.toFixed(3)}</td>
                      <td className="py-2 px-3 text-right font-mono dark:text-slate-400">{p.od.toFixed(3)}</td>
                      <td className="py-2 px-3 text-right font-mono dark:text-slate-400">{maxGpm.toFixed(1)}</td>
                      <td className="py-2 px-3 text-right font-mono dark:text-slate-400">{dp.toFixed(3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Technical notes */}
      <Card className="border-none shadow-sm bg-gray-50 dark:bg-slate-800/50">
        <CardContent className="p-5 flex gap-3 items-start">
          <Info className="w-5 h-5 text-gray-400 dark:text-slate-500 shrink-0 mt-0.5" />
          <div className="space-y-3 text-sm text-gray-700 dark:text-slate-400">
            <p className="font-semibold text-gray-900 dark:text-slate-200">Technical Notes & Pipe Type Selection Guide</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="font-semibold text-gray-800 dark:text-slate-300 mb-1">Pipe Material Selection</p>
                <ul className="space-y-1 list-disc list-inside text-xs">
                  <li><strong>Copper (Type L/M):</strong> Chilled water, hot water ≤93°C. Smooth bore, low corrosion, highest C-factor (150). IS 2502.</li>
                  <li><strong>GI / MS Steel:</strong> General HVAC, condenser water, fire protection. IS 1239 (light/medium/heavy). C = 120–140.</li>
                  <li><strong>CPVC:</strong> Domestic cold/hot water ≤93°C. Lightweight, corrosion-free. NBC 2016.</li>
                  <li><strong>PVC:</strong> Drainage, condensate, cold water only (≤60°C). IS 4985.</li>
                  <li><strong>Stainless Steel (SS 316):</strong> Pharmaceutical, seawater cooling, corrosive fluids.</li>
                  <li><strong>Cast Iron:</strong> Below-grade drainage, fire mains. Lower C-factor; account for aging.</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-gray-800 dark:text-slate-300 mb-1">Design Velocity Guidelines</p>
                <ul className="space-y-1 list-disc list-inside text-xs">
                  <li><strong>Chilled/HW mains:</strong> 3–8 FPS (ASHRAE 90.1)</li>
                  <li><strong>Chilled/HW branches:</strong> 2–4 FPS (noise concern above 4)</li>
                  <li><strong>Condenser water:</strong> 4–10 FPS (CT loop OK to 10)</li>
                  <li><strong>Domestic cold water:</strong> 2–8 FPS (IS 1239 / NBC)</li>
                  <li><strong>Pressure drop target:</strong> 1–4 ft hd per 100 ft for mains (≈ 0.43–1.73 psi/100 ft)</li>
                </ul>
                <p className="font-semibold text-gray-800 dark:text-slate-300 mt-2 mb-1">IS Code References</p>
                <ul className="space-y-1 list-disc list-inside text-xs">
                  <li><strong>IS 1239:</strong> Steel tubes (water, gas, sanitation) — Part 1 (Plain end), Part 2 (Socket end)</li>
                  <li><strong>IS 659:</strong> Specification for hydronic piping systems</li>
                  <li><strong>IS 2502:</strong> Copper tubes for general purposes</li>
                  <li><strong>IS 4985:</strong> uPVC pipes for potable water supply</li>
                  <li><strong>NBC 2016:</strong> Part 9 — Plumbing & drainage services</li>
                </ul>
              </div>
            </div>

            <p className="text-xs text-gray-500 dark:text-slate-500">
              Friction loss computed using Hazen-Williams equation.
              For more accurate results at low flow or high-viscosity fluids, use Darcy-Weisbach with Moody chart.
              Add 20–30% equivalent length for fittings as a rule of thumb; confirm with actual fitting loss coefficients.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
