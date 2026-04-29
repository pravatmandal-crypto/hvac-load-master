import { useState, useMemo } from 'react';
import { Wind, Ruler, Activity, Info, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { sizeDuct } from '../../lib/hvac-logic';
import { toast } from 'sonner';

// Standard duct dimensions (inches) per SMACNA
const STD_SIZES = [6, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 44, 48];
const roundUpToStd = (val: number) => STD_SIZES.find((s) => s >= val) ?? Math.ceil(val);

// ASHRAE equivalent hydraulic diameter: D_e = 1.3 × (a·b)^0.625 / (a+b)^0.25
// Given D_e and aspect ratio AR = a/b, solve for b then a.
function rectDimsFromAR(D_e: number, AR: number): { a: number; b: number } {
  const k = D_e / 1.3;
  const b_raw = k * Math.pow(AR + 1, 0.25) / Math.pow(AR, 0.625);
  const a_raw = AR * b_raw;
  return { a: a_raw, b: b_raw };
}

// Given a fixed height b (minHeight constraint), solve for width a numerically
// using ASHRAE formula: 1.3 × (a·b)^0.625 / (a+b)^0.25 = D_e
function solveWidthForHeight(D_e: number, b: number): number {
  const target = D_e / 1.3;
  // f(a) = (a·b)^0.625 / (a+b)^0.25 - target = 0
  // Use bisection
  let lo = b * 0.5, hi = b * 20;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const val = Math.pow(mid * b, 0.625) / Math.pow(mid + b, 0.25);
    if (val < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

interface RectOption {
  ar: string;
  width: number;
  height: number;
  velocity: number;
  aspect: number;
}

export default function DuctSizer() {
  const [cfm, setCfm] = useState(1000);
  const [friction, setFriction] = useState(0.1);
  const [maxVelocity, setMaxVelocity] = useState(1200); // FPM constraint
  const [minHeight, setMinHeight] = useState(0); // inches, 0 = no constraint

  // Round duct sizing
  const roundResult = useMemo(() => {
    // Friction-based sizing
    const res = sizeDuct(cfm, friction);
    // Velocity-based sizing: D = 1.128 × √(Q/V) [inches]
    const diaFromVelocity = maxVelocity > 0
      ? 1.128 * Math.sqrt(cfm / maxVelocity) * 12  // 1.128 × √(A_ft²) × 12
      : 0;
    // Take the larger (more conservative) diameter
    const diaRequired = Math.max(res.diameter, diaFromVelocity);
    // Round to next integer inch
    const diaFinal = Math.ceil(diaRequired * 10) / 10;
    const areaSqFt = Math.PI * Math.pow(diaFinal / 24, 2);
    const actualVelocity = cfm / areaSqFt;
    return {
      diaFriction: res.diameter,
      diaVelocity: diaFromVelocity,
      diaFinal,
      velocity: actualVelocity,
      velocityLimited: diaFromVelocity > res.diameter,
    };
  }, [cfm, friction, maxVelocity]);

  // Rectangular duct options (5 aspect ratios)
  const rectOptions: RectOption[] = useMemo(() => {
    const D_e = roundResult.diaFinal;
    const aspectRatios = [1.0, 1.5, 2.0, 3.0, 4.0];
    const labels = ['1:1 (Square)', '1.5:1', '2:1', '3:1', '4:1'];

    return aspectRatios.map((ar, idx) => {
      let a_raw: number, b_raw: number;

      if (minHeight > 0) {
        // If minHeight constraint: fix b to max(natural b, minHeight), solve for a
        const natural = rectDimsFromAR(D_e, ar);
        if (natural.b >= minHeight) {
          a_raw = natural.a;
          b_raw = natural.b;
        } else {
          b_raw = minHeight;
          a_raw = solveWidthForHeight(D_e, b_raw);
        }
      } else {
        const dims = rectDimsFromAR(D_e, ar);
        a_raw = dims.a;
        b_raw = dims.b;
      }

      const width = roundUpToStd(a_raw);
      const height = roundUpToStd(b_raw);
      const areaSqFt = (width * height) / 144;
      const velocity = cfm / areaSqFt;

      return {
        ar: labels[idx],
        width,
        height,
        velocity: Math.round(velocity),
        aspect: ar,
      };
    });
  }, [roundResult.diaFinal, minHeight, cfm]);

  const handleExport = () => {
    const rows = [
      'HVAC Duct Sizing Report',
      new Date().toLocaleString(),
      '',
      'INPUTS',
      `Airflow,${cfm},CFM`,
      `Friction Loss,${friction},in.wg/100 ft`,
      `Max Velocity,${maxVelocity},FPM`,
      `Min Rect Height,${minHeight || 'None'},in`,
      '',
      'ROUND DUCT',
      `Required Diameter (Friction),${roundResult.diaFriction.toFixed(1)},in`,
      `Required Diameter (Velocity),${roundResult.diaVelocity.toFixed(1)},in`,
      `Selected Diameter,${roundResult.diaFinal.toFixed(1)},in`,
      `Air Velocity,${Math.round(roundResult.velocity)},FPM`,
      `Sizing Basis,${roundResult.velocityLimited ? 'Velocity (governing)' : 'Friction Loss (governing)'}`,
      '',
      'RECTANGULAR DUCT OPTIONS',
      'Aspect Ratio,Width (in),Height (in),Velocity (FPM)',
      ...rectOptions.map((o) => `${o.ar},${o.width},${o.height},${o.velocity}`),
      '',
      'NOTES',
      'Sizing per ASHRAE Fundamentals 2017 Chapter 21 - Equal Friction Method',
      'Rectangular sizes per ASHRAE D_e = 1.3(ab)^0.625/(a+b)^0.25',
      'Standard dimensions per SMACNA HVAC Duct Construction Standards',
    ].join('\n');

    const el = document.createElement('a');
    el.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows));
    el.setAttribute('download', `duct-sizing-${cfm}cfm-${Date.now()}.csv`);
    el.click();
    toast.success('Duct sizing report downloaded');
  };

  const velocityColor = (v: number) =>
    v > 1500 ? 'text-red-600' : v > 1200 ? 'text-amber-600' : 'text-green-600';

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Duct Sizing Tool</h2>
        <p className="text-gray-500 text-sm mt-1">
          Equal friction method — ASHRAE Fundamentals 2017, Chapter 21
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Inputs */}
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Wind className="w-5 h-5 text-blue-500" />
              Input Parameters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium text-gray-600">Airflow (CFM)</Label>
                <Input
                  type="number"
                  value={cfm}
                  onChange={(e) => setCfm(Math.max(1, Number(e.target.value)))}
                  placeholder="e.g. 1000"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-gray-600">Friction Loss (in.wg/100ft)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={friction}
                  onChange={(e) => setFriction(Math.max(0.01, Number(e.target.value)))}
                  placeholder="e.g. 0.10"
                  className="font-mono"
                />
                <p className="text-[10px] text-gray-400">Typical: 0.08–0.12 in.wg/100ft</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-gray-600">Max Velocity (FPM)</Label>
                <Input
                  type="number"
                  step="50"
                  value={maxVelocity}
                  onChange={(e) => setMaxVelocity(Math.max(100, Number(e.target.value)))}
                  placeholder="e.g. 1200"
                  className="font-mono"
                />
                <p className="text-[10px] text-gray-400">Supply: ≤1200, Return: ≤800</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-gray-600">Min Rect. Height (in)</Label>
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={minHeight || ''}
                  onChange={(e) => setMinHeight(Number(e.target.value) || 0)}
                  placeholder="e.g. 10 (space limit)"
                  className="font-mono"
                />
                <p className="text-[10px] text-gray-400">0 = no constraint</p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800 space-y-1">
              <p className="font-semibold">Velocity Guidelines (ASHRAE)</p>
              <p>Main duct — Supply: ≤1200 FPM | Return: ≤800 FPM</p>
              <p>Branch duct — Supply: ≤800 FPM | Return: ≤600 FPM</p>
              <p>Noise-sensitive areas: ≤600 FPM</p>
            </div>
          </CardContent>
        </Card>

        {/* Round duct result */}
        <Card className="border-none shadow-sm bg-blue-600 text-white overflow-hidden">
          <CardHeader>
            <CardTitle className="text-blue-100 text-sm font-medium uppercase tracking-wider">
              Round Duct Result
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
                <Ruler className="w-7 h-7" />
              </div>
              <div>
                <p className="text-xs text-blue-200 uppercase tracking-wider">Required Diameter</p>
                <h3 className="text-4xl font-bold">
                  {roundResult.diaFinal.toFixed(1)}"
                  <span className="text-base font-normal ml-2">Round</span>
                </h3>
                <p className="text-xs text-blue-200 mt-0.5">
                  {roundResult.velocityLimited
                    ? 'Governed by max velocity'
                    : 'Governed by friction loss'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-5">
              <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
                <Activity className="w-7 h-7" />
              </div>
              <div>
                <p className="text-xs text-blue-200 uppercase tracking-wider">Air Velocity</p>
                <h3 className="text-4xl font-bold">
                  {Math.round(roundResult.velocity).toLocaleString()}
                  <span className="text-base font-normal ml-2">FPM</span>
                </h3>
              </div>
            </div>

            <div className="pt-3 border-t border-white/20 grid grid-cols-2 gap-2 text-sm">
              <div className="bg-white/10 rounded-lg p-2">
                <p className="text-blue-200 text-xs">Friction basis</p>
                <p className="font-semibold">{roundResult.diaFriction.toFixed(1)}" dia.</p>
              </div>
              <div className="bg-white/10 rounded-lg p-2">
                <p className="text-blue-200 text-xs">Velocity basis</p>
                <p className="font-semibold">{roundResult.diaVelocity.toFixed(1)}" dia.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rectangular duct options */}
      <Card className="border-none shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Ruler className="w-5 h-5 text-indigo-500" />
            Rectangular Duct Options
            <span className="text-xs font-normal text-gray-500 ml-1">
              (ASHRAE equivalent D = {roundResult.diaFinal.toFixed(1)}")
            </span>
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
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Aspect Ratio</th>
                  <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Width</th>
                  <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Height</th>
                  <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500 uppercase">W × H</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Velocity (FPM)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rectOptions.map((opt, i) => (
                  <tr key={i} className={i === 0 ? 'bg-indigo-50' : ''}>
                    <td className="py-2.5 px-3 font-medium text-gray-700">{opt.ar}</td>
                    <td className="py-2.5 px-3 text-center font-mono font-semibold">{opt.width}"</td>
                    <td className="py-2.5 px-3 text-center font-mono font-semibold">{opt.height}"</td>
                    <td className="py-2.5 px-3 text-center font-mono text-gray-600">{opt.width}" × {opt.height}"</td>
                    <td className={`py-2.5 px-3 text-right font-semibold ${velocityColor(opt.velocity)}`}>
                      {opt.velocity.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            * Sizes rounded up to nearest SMACNA standard dimension. Highlighted row (1:1) is most space-efficient.
            Velocity in <span className="text-green-600 font-medium">green</span> = acceptable,{' '}
            <span className="text-amber-600 font-medium">amber</span> = borderline,{' '}
            <span className="text-red-600 font-medium">red</span> = exceeds recommendation.
          </p>
        </CardContent>
      </Card>

      {/* Engineering notes */}
      <Card className="border-none shadow-sm bg-gray-50">
        <CardContent className="p-5 flex gap-3 items-start">
          <Info className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
          <div className="space-y-2 text-sm text-gray-600">
            <p className="font-medium text-gray-800">Engineering Notes</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>
                <strong>Equal friction method</strong> maintains constant pressure drop per unit length;
                suitable for most HVAC distribution systems.
              </li>
              <li>
                <strong>Rectangular equivalent</strong> computed using ASHRAE hydraulic diameter
                formula: D<sub>e</sub> = 1.3 × (a·b)<sup>0.625</sup> / (a+b)<sup>0.25</sup>
              </li>
              <li>
                <strong>Aspect ratio ≤ 4:1</strong> is strongly recommended to limit fabrication cost
                and pressure losses at fittings.
              </li>
              <li>
                Verify final selection against <strong>local code</strong>, duct material roughness
                (ε = 0.0005 ft for galvanized steel), and fitting loss coefficients.
              </li>
              <li>
                Use <strong>static regain method</strong> for high-velocity systems or large trunk-to-branch
                variations.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
