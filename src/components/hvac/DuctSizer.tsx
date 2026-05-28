import { useState, useMemo, useEffect } from 'react';
import { Wind, Ruler, Activity, Info, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { NumericInput } from '../ui/numeric-input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { sizeDuct } from '../../lib/hvac-logic';
import { toast } from 'sonner';

// SMACNA HVAC Duct Construction Standards (2005) Table 1-5 — standard rectangular sizes (inches)
// Class A: 6–36 (2" increments). Class B: 40–60 (4" increments). Class C: 64–120 (4–8" increments).
const SMACNA_SIZES_IN = [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 42, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96, 100, 108, 120];

// IS 655 (sheet-metal air ducts) — common Indian standard duct sizes in mm
const IS655_SIZES_MM = [150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1800, 2000, 2200, 2400, 2700, 3000];

type Units = 'imperial' | 'metric';

type SizingMethodId = 'equal_friction' | 'velocity_reduction';

const SIZING_METHOD_LABELS: Record<SizingMethodId, { label: string; hint: string }> = {
  equal_friction: {
    label: 'Equal Friction (industry standard)',
    hint: 'Rect dims match the round duct\'s hydraulic equivalent — friction target is honoured, velocity ends up below max.',
  },
  velocity_reduction: {
    label: 'Velocity Reduction',
    hint: 'Rect dims sized to V_max — smaller duct, higher friction. Use when velocity (noise / space) governs.',
  },
};

// Unit conversion constants
const MM_PER_IN = 25.4;
const PA_PER_INWG_PER_M_PER_100FT = 8.1585; // 1 in.wg/100ft = 8.1585 Pa/m
const MPS_PER_FPM = 0.00508;

type DuctTypeId = 'supply_main' | 'return_main' | 'supply_branch' | 'return_branch' | 'noise_sensitive';

interface DuctTypeProfile {
  label: string;
  recommendedFpm: number; // upper end of typical band (auto-set as maxVelocity)
  warnFpm: number; // amber threshold (FPM)
  redFpm: number; // red threshold (FPM)
  note: string;
}

// Velocity bands from ASHRAE Fundamentals 2017 Ch.21 + ISHRAE HVAC Handbook Vol. 2 (commercial buildings)
const DUCT_TYPE_PROFILES: Record<DuctTypeId, DuctTypeProfile> = {
  supply_main: {
    label: 'Supply Main / Trunk',
    recommendedFpm: 1500,
    warnFpm: 1500,
    redFpm: 1800,
    note: 'Commercial supply trunks — typical 1200–1500 FPM (6–7.5 m/s). Above 1800 FPM = noise & high SP.',
  },
  return_main: {
    label: 'Return Main / Trunk',
    recommendedFpm: 1200,
    warnFpm: 1200,
    redFpm: 1500,
    note: 'Return trunks — typical 800–1200 FPM (4–6 m/s).',
  },
  supply_branch: {
    label: 'Supply Branch',
    recommendedFpm: 1000,
    warnFpm: 1000,
    redFpm: 1200,
    note: 'Branch ducts to diffusers — typical 600–1000 FPM (3–5 m/s).',
  },
  return_branch: {
    label: 'Return Branch',
    recommendedFpm: 800,
    warnFpm: 800,
    redFpm: 1000,
    note: 'Return branches — typical 600–800 FPM (3–4 m/s).',
  },
  noise_sensitive: {
    label: 'Noise-Sensitive (hospital / studio / library)',
    recommendedFpm: 600,
    warnFpm: 600,
    redFpm: 800,
    note: 'Acoustically-critical zones — keep ≤ 600 FPM (≤ 3 m/s).',
  },
};

/**
 * Snap a raw dimension (inches) to the next standard size in the selected unit system.
 * Returns the internal value (still inches, for downstream area/velocity calcs) plus a formatted label.
 */
function snapToStandardSize(rawInches: number, units: Units): { internalIn: number; label: string } {
  if (units === 'metric') {
    const rawMm = rawInches * MM_PER_IN;
    const next = IS655_SIZES_MM.find((s) => s >= rawMm) ?? Math.ceil(rawMm / 50) * 50;
    return { internalIn: next / MM_PER_IN, label: `${next} mm` };
  }
  const next = SMACNA_SIZES_IN.find((s) => s >= rawInches) ?? Math.ceil(rawInches);
  return { internalIn: next, label: `${next}"` };
}

// Display formatters for the selected unit system
function fmtDim(inches: number, units: Units): string {
  return units === 'metric'
    ? `${Math.round(inches * MM_PER_IN)} mm`
    : `${inches.toFixed(1)}"`;
}

function fmtVelocity(fpm: number, units: Units): string {
  return units === 'metric'
    ? `${(fpm * MPS_PER_FPM).toFixed(2)} m/s`
    : `${Math.round(fpm).toLocaleString()} FPM`;
}

function fmtFriction(inwgPer100ft: number, units: Units): string {
  return units === 'metric'
    ? `${(inwgPer100ft * PA_PER_INWG_PER_M_PER_100FT).toFixed(2)} Pa/m`
    : `${inwgPer100ft.toFixed(3)} in.wg/100ft`;
}

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
  width: number;          // inches (internal)
  height: number;         // inches (internal)
  widthLabel: string;     // formatted per unit system
  heightLabel: string;    // formatted per unit system
  velocity: number;       // FPM (internal)
  friction: number;       // in.wg/100ft (actual at chosen geometry)
  aspect: number;         // actual w/h after snap
}

export default function DuctSizer() {
  const [cfm, setCfm] = useState(1000);
  const [friction, setFriction] = useState(0.1); // always stored in in.wg/100ft
  const [ductType, setDuctType] = useState<DuctTypeId>('supply_main');
  const [maxVelocity, setMaxVelocity] = useState(DUCT_TYPE_PROFILES.supply_main.recommendedFpm); // always FPM
  const [minHeight, setMinHeight] = useState(0); // always inches
  const [units, setUnits] = useState<Units>('imperial');
  const [velocityOverridden, setVelocityOverridden] = useState(false);
  const [sizingMethod, setSizingMethod] = useState<SizingMethodId>('equal_friction');

  const profile = DUCT_TYPE_PROFILES[ductType];

  // Auto-sync max velocity to the selected duct type's recommended value unless user has manually overridden.
  useEffect(() => {
    if (!velocityOverridden) {
      setMaxVelocity(profile.recommendedFpm);
    }
  }, [ductType, profile.recommendedFpm, velocityOverridden]);

  const roundResult = useMemo(() => {
    const res = sizeDuct(cfm, friction);
    const diaFromVelocity = maxVelocity > 0
      ? 1.128 * Math.sqrt(cfm / maxVelocity) * 12
      : 0;
    const diaRequired = Math.max(res.diameter, diaFromVelocity);
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

  const rectOptions: RectOption[] = useMemo(() => {
    // Compute the minimum width needed for a given height under the chosen sizing method.
    //   Equal Friction:    Huebscher D_e(w, h) = D_round → solve for w
    //   Velocity Reduction: w × h ≥ CFM/V_max ⇒ w_min = (CFM/V_max × 144) / h
    const minWidthForHeight = (h: number): number => {
      if (sizingMethod === 'equal_friction') {
        return solveWidthForHeight(roundResult.diaFinal, h);
      }
      const requiredArea_sqin = (cfm / Math.max(maxVelocity, 1)) * 144;
      return requiredArea_sqin / h;
    };

    // Enumerate over standard heights, finding smallest standard width per height.
    // Stop once square is reached (no benefit going taller than wide).
    const heightSeed = units === 'metric'
      ? IS655_SIZES_MM.map((mm) => mm / MM_PER_IN)
      : SMACNA_SIZES_IN;
    const minH_in = Math.max(minHeight, units === 'metric' ? 150 / MM_PER_IN : 6);

    const options: RectOption[] = [];
    const seen = new Set<string>();

    for (const h of heightSeed) {
      if (h < minH_in) continue;

      const w_natural = minWidthForHeight(h);
      const w_min = Math.max(h, w_natural); // enforce w ≥ h (only "wide" or square ducts in this listing)
      const wSnap = snapToStandardSize(w_min, units);
      const hSnap = snapToStandardSize(h, units);

      const a = wSnap.internalIn;
      const b = hSnap.internalIn;
      const key = `${a.toFixed(2)}x${b.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const ar = a / b;
      if (ar > 6) continue; // skip absurd ARs (engineering impractical above ~6:1)

      const area_sqft = (a * b) / 144;
      const velocity = cfm / area_sqft;
      const D_e = 1.3 * Math.pow(a * b, 0.625) / Math.pow(a + b, 0.25);
      const friction = Math.pow((0.537 * Math.pow(cfm, 0.4)) / D_e, 5);

      options.push({
        ar: ar <= 1.05 ? '1:1 (Square)' : `${ar.toFixed(2)}:1`,
        width: a,
        height: b,
        widthLabel: wSnap.label,
        heightLabel: hSnap.label,
        velocity: Math.round(velocity),
        friction,
        aspect: ar,
      });

      if (ar <= 1.05) break; // reached square — no point checking taller heights
    }

    // Sort by aspect ratio ascending — square first, then progressively wider/flatter
    options.sort((a, b) => a.aspect - b.aspect);
    return options;
  }, [cfm, maxVelocity, minHeight, units, sizingMethod, roundResult.diaFinal]);

  const handleExport = () => {
    const sizeStdLabel = units === 'metric' ? 'IS 655 (mm)' : 'SMACNA (in)';
    const rows = [
      'HVAC Duct Sizing Report',
      new Date().toLocaleString(),
      '',
      'INPUTS',
      `Airflow,${cfm},CFM`,
      `Duct Type,${profile.label}`,
      `Friction Loss,${fmtFriction(friction, units)}`,
      `Max Velocity,${fmtVelocity(maxVelocity, units)}`,
      `Min Rect Height,${minHeight ? fmtDim(minHeight, units) : 'None'}`,
      `Unit System,${units === 'metric' ? 'Metric (mm / Pa·m⁻¹ / m·s⁻¹)' : 'Imperial (in / in.wg per 100 ft / FPM)'}`,
      `Standard Sizes,${sizeStdLabel}`,
      '',
      'ROUND DUCT',
      `Required Diameter (Friction),${fmtDim(roundResult.diaFriction, units)}`,
      `Required Diameter (Velocity),${fmtDim(roundResult.diaVelocity, units)}`,
      `Selected Diameter,${fmtDim(roundResult.diaFinal, units)}`,
      `Air Velocity,${fmtVelocity(roundResult.velocity, units)}`,
      `Sizing Basis,${roundResult.velocityLimited ? 'Velocity (governing)' : 'Friction Loss (governing)'}`,
      '',
      `RECTANGULAR DUCT OPTIONS (${SIZING_METHOD_LABELS[sizingMethod].label})`,
      `Aspect Ratio,Width,Height,Velocity,Friction`,
      ...rectOptions.map((o) => `${o.ar},${o.widthLabel},${o.heightLabel},${fmtVelocity(o.velocity, units)},${fmtFriction(o.friction, units)}`),
      '',
      'STANDARDS REFERENCED',
      'ASHRAE Fundamentals 2017 Chapter 21 — Equal Friction Method',
      'Rectangular Equivalent: D_e = 1.3 × (a·b)^0.625 / (a+b)^0.25',
      'SMACNA HVAC Duct Construction Standards — Imperial sheet-metal sizes',
      'IS 655 — Indian Standard for sheet-metal air ducts (metric sizes)',
      'ISHRAE HVAC Handbook Vol. 2 — Indian commercial-building velocity bands',
    ].join('\n');

    const el = document.createElement('a');
    el.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows));
    el.setAttribute('download', `duct-sizing-${cfm}cfm-${Date.now()}.csv`);
    el.click();
    toast.success('Duct sizing report downloaded');
  };

  // Velocity colour now keyed to the selected duct-type thresholds
  const velocityColor = (v: number) =>
    v > profile.redFpm ? 'text-red-600'
    : v > profile.warnFpm ? 'text-amber-600'
    : 'text-green-600';

  // Friction colour — compare actual rect friction against the user's target
  const frictionColor = (f: number) =>
    f > friction * 2 ? 'text-red-600'
    : f > friction * 1.25 ? 'text-amber-600'
    : 'text-green-600';

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-slate-100">Duct Sizing Tool</h2>
          <p className="text-gray-500 dark:text-slate-400 text-sm mt-1">
            Equal friction method — ASHRAE Fundamentals 2017 Ch.21 · SMACNA · IS 655 · ISHRAE
          </p>
        </div>
        {/* Unit toggle */}
        <div className="flex items-center gap-2">
          <Label className="text-xs font-medium text-gray-600 dark:text-slate-400">Units</Label>
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setUnits('imperial')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${units === 'imperial' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-300'}`}
            >
              Imperial (in · FPM)
            </button>
            <button
              type="button"
              onClick={() => setUnits('metric')}
              className={`px-3 py-1.5 text-xs font-medium border-l border-gray-200 dark:border-slate-700 transition-colors ${units === 'metric' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-300'}`}
            >
              Metric (mm · m/s)
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 md:items-start gap-6">
        {/* Inputs */}
        <Card className="border border-slate-200/80 dark:border-slate-700/70 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Wind className="w-5 h-5 text-blue-500" />
              Input Parameters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pb-5">
            {/* Duct Type (full width) — drives velocity limit & colour thresholds */}
            <div className="space-y-1">
              <Label className="text-xs font-medium text-gray-600 dark:text-slate-400">Duct Type</Label>
              <Select
                value={ductType}
                onValueChange={(v) => {
                  setDuctType(v as DuctTypeId);
                  setVelocityOverridden(false); // reset override when type changes
                }}
              >
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DUCT_TYPE_PROFILES).map(([key, p]) => (
                    <SelectItem key={key} value={key}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-gray-400 dark:text-slate-500">{profile.note}</p>
            </div>

            {/* Sizing Method — picks rect duct algorithm */}
            <div className="space-y-1">
              <Label className="text-xs font-medium text-gray-600 dark:text-slate-400">Rect. Sizing Method</Label>
              <Select value={sizingMethod} onValueChange={(v) => setSizingMethod(v as SizingMethodId)}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SIZING_METHOD_LABELS).map(([key, m]) => (
                    <SelectItem key={key} value={key}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-gray-400 dark:text-slate-500">{SIZING_METHOD_LABELS[sizingMethod].hint}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium text-gray-600 dark:text-slate-400">Airflow (CFM)</Label>
                <NumericInput
                  min={1}
                  value={cfm}
                  onChange={(n) => setCfm(Math.max(1, n ?? 1))}
                  placeholder="e.g. 1000"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-gray-600 dark:text-slate-400">
                  Friction Loss ({units === 'metric' ? 'Pa/m' : 'in.wg/100ft'})
                </Label>
                <NumericInput
                  min={0.01}
                  value={units === 'metric'
                    ? Number((friction * PA_PER_INWG_PER_M_PER_100FT).toFixed(2))
                    : friction}
                  onChange={(n) => {
                    if (n == null) return;
                    const internal = units === 'metric' ? n / PA_PER_INWG_PER_M_PER_100FT : n;
                    setFriction(Math.max(0.01, internal));
                  }}
                  placeholder={units === 'metric' ? 'e.g. 1.0' : 'e.g. 0.10'}
                  className="font-mono"
                />
                <p className="text-[10px] text-gray-400 dark:text-slate-500">
                  {units === 'metric' ? 'Typical: 0.65–1.0 Pa/m' : 'Typical: 0.08–0.12 in.wg/100ft'}
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-gray-600 dark:text-slate-400">
                  Max Velocity ({units === 'metric' ? 'm/s' : 'FPM'})
                </Label>
                <NumericInput
                  min={0.1}
                  value={units === 'metric'
                    ? Number((maxVelocity * MPS_PER_FPM).toFixed(2))
                    : Math.round(maxVelocity)}
                  onChange={(n) => {
                    if (n == null) return;
                    const internalFpm = units === 'metric' ? n / MPS_PER_FPM : n;
                    setMaxVelocity(Math.max(50, internalFpm));
                    setVelocityOverridden(true);
                  }}
                  placeholder={units === 'metric' ? 'e.g. 7.5' : 'e.g. 1500'}
                  className="font-mono"
                />
                <p className="text-[10px] text-gray-400 dark:text-slate-500">
                  Recommended for {profile.label}: {fmtVelocity(profile.recommendedFpm, units)}
                  {velocityOverridden && (
                    <>
                      {' · '}
                      <button
                        type="button"
                        className="text-blue-600 hover:underline"
                        onClick={() => { setVelocityOverridden(false); setMaxVelocity(profile.recommendedFpm); }}
                      >
                        Reset
                      </button>
                    </>
                  )}
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-gray-600 dark:text-slate-400">
                  Min Rect. Height ({units === 'metric' ? 'mm' : 'in'})
                </Label>
                <NumericInput
                  min={0}
                  value={minHeight > 0
                    ? (units === 'metric' ? Math.round(minHeight * MM_PER_IN) : minHeight)
                    : undefined}
                  onChange={(n) => {
                    const raw = n ?? 0;
                    setMinHeight(units === 'metric' ? raw / MM_PER_IN : raw);
                  }}
                  placeholder={units === 'metric' ? 'e.g. 250' : 'e.g. 10'}
                  className="font-mono"
                />
                <p className="text-[10px] text-gray-400 dark:text-slate-500">0 = no constraint</p>
              </div>
            </div>

          </CardContent>
        </Card>

        {/* Round duct result — coloured panel, works in both modes */}
        <Card className="self-start border-none shadow-sm bg-gradient-to-br from-blue-600 to-blue-700 text-white overflow-hidden">
          <CardHeader>
            <CardTitle className="text-blue-100 text-sm font-medium uppercase tracking-wider">
              Round Duct Result
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pb-5">
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
                <Ruler className="w-7 h-7" />
              </div>
              <div>
                <p className="text-xs text-blue-200 uppercase tracking-wider">Required Diameter</p>
                <h3 className="text-3xl md:text-4xl font-bold leading-tight tracking-tight">
                  {fmtDim(roundResult.diaFinal, units)}
                  <span className="text-base font-normal ml-2">Round</span>
                </h3>
                <p className="text-xs text-blue-200 mt-0.5">
                  {roundResult.velocityLimited ? 'Governed by max velocity' : 'Governed by friction loss'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-5">
              <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
                <Activity className="w-7 h-7" />
              </div>
              <div>
                <p className="text-xs text-blue-200 uppercase tracking-wider">Air Velocity</p>
                <h3 className="text-3xl md:text-4xl font-bold leading-tight tracking-tight">
                  {fmtVelocity(roundResult.velocity, units)}
                </h3>
              </div>
            </div>

            <div className="pt-3 border-t border-white/20 grid grid-cols-2 gap-2 text-sm">
              <div className="bg-white/10 rounded-lg p-2">
                <p className="text-blue-200 text-xs">Friction basis</p>
                <p className="font-semibold">{fmtDim(roundResult.diaFriction, units)} dia.</p>
              </div>
              <div className="bg-white/10 rounded-lg p-2">
                <p className="text-blue-200 text-xs">Velocity basis</p>
                <p className="font-semibold">{fmtDim(roundResult.diaVelocity, units)} dia.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border border-blue-200/90 dark:border-blue-900/60 bg-blue-50/80 dark:bg-blue-950/25 shadow-sm">
        <CardContent className="p-4 text-sm text-blue-800 dark:text-blue-300 space-y-2">
          <p className="font-semibold">Velocity bands (ASHRAE / ISHRAE)</p>
          <p>Supply Main: 1200–1500 FPM (6–7.5 m/s) · Return Main: 800–1200 FPM (4–6 m/s)</p>
          <p>Supply Branch: 600–1000 FPM (3–5 m/s) · Return Branch: 600–800 FPM (3–4 m/s)</p>
          <p>Noise-sensitive: ≤ 600 FPM (≤ 3 m/s)</p>
        </CardContent>
      </Card>

      {/* Rectangular duct options */}
      <Card className="border border-slate-200/80 dark:border-slate-700/70 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Ruler className="w-5 h-5 text-indigo-500" />
            Rectangular Duct Options
            <span className="text-xs font-normal text-gray-500 dark:text-slate-400 ml-1">
              (ASHRAE equivalent D = {fmtDim(roundResult.diaFinal, units)})
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
                <tr className="border-b border-gray-200 dark:border-slate-700">
                  <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Width</th>
                  <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Height</th>
                  <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">W × H</th>
                  <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Aspect Ratio</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">
                    Velocity ({units === 'metric' ? 'm/s' : 'FPM'})
                  </th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">
                    Friction ({units === 'metric' ? 'Pa/m' : 'in.wg/100ft'})
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {rectOptions.map((opt, i) => {
                  const isSquare = opt.aspect <= 1.05;
                  const arOverLimit = opt.aspect > 4.0;
                  return (
                    <tr
                      key={i}
                      className={
                        arOverLimit
                          ? 'bg-red-50 dark:bg-red-950/20'
                          : isSquare
                          ? 'bg-indigo-50 dark:bg-indigo-950/30'
                          : ''
                      }
                    >
                      <td className="py-2.5 px-3 text-center font-mono font-semibold dark:text-slate-200">{opt.widthLabel}</td>
                      <td className="py-2.5 px-3 text-center font-mono font-semibold dark:text-slate-200">{opt.heightLabel}</td>
                      <td className="py-2.5 px-3 text-center font-mono text-gray-600 dark:text-slate-400">{opt.widthLabel} × {opt.heightLabel}</td>
                      <td
                        className={`py-2.5 px-3 text-center font-medium ${
                          arOverLimit ? 'text-red-600 font-bold' : 'text-gray-700 dark:text-slate-300'
                        }`}
                        title={arOverLimit ? 'Exceeds recommended max AR of 4:1 — high fitting losses, fabrication cost' : undefined}
                      >
                        {opt.ar}
                      </td>
                      <td className={`py-2.5 px-3 text-right font-semibold ${velocityColor(opt.velocity)}`}>
                        {fmtVelocity(opt.velocity, units)}
                      </td>
                      <td className={`py-2.5 px-3 text-right font-mono ${frictionColor(opt.friction)}`}>
                        {fmtFriction(opt.friction, units)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-3">
            * Each row is a real {units === 'metric' ? 'IS 655 (mm)' : 'SMACNA (in)'} standard W × H combination that satisfies{' '}
            <strong>{SIZING_METHOD_LABELS[sizingMethod].label}</strong>. Sorted by aspect ratio — square first (most space-efficient).{' '}
            <span className="text-red-600 font-medium">Rows in red exceed the recommended AR ≤ 4:1</span> (higher fabrication cost, more fitting losses, possible drumming / noise).
          </p>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
            Velocity ({profile.label}):{' '}
            <span className="text-green-600 font-medium">≤ {fmtVelocity(profile.warnFpm, units)}</span> ·{' '}
            <span className="text-amber-600 font-medium">≤ {fmtVelocity(profile.redFpm, units)}</span> ·{' '}
            <span className="text-red-600 font-medium">&gt; {fmtVelocity(profile.redFpm, units)}</span>.
            Friction (vs target {fmtFriction(friction, units)}):{' '}
            <span className="text-green-600 font-medium">within 1.25×</span> ·{' '}
            <span className="text-amber-600 font-medium">1.25–2×</span> ·{' '}
            <span className="text-red-600 font-medium">&gt; 2× (consider larger duct or higher fan SP)</span>.
          </p>
        </CardContent>
      </Card>

      {/* Engineering notes */}
      <Card className="border-none shadow-sm bg-gray-50 dark:bg-slate-800/50">
        <CardContent className="p-5 flex gap-3 items-start">
          <Info className="w-5 h-5 text-gray-400 dark:text-slate-500 shrink-0 mt-0.5" />
          <div className="space-y-2 text-sm text-gray-600 dark:text-slate-400">
            <p className="font-medium text-gray-800 dark:text-slate-200">Engineering Notes & Standards</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>
                <strong>Round duct</strong>: equal-friction method (ASHRAE Fundamentals 2017 Ch.21) —
                diameter satisfies both your friction target and your max velocity (whichever is more restrictive).
              </li>
              <li>
                <strong>Rectangular options — sizing method is selectable:</strong>
                <ul className="list-disc ml-5 mt-1 space-y-0.5">
                  <li>
                    <em>Equal Friction</em> (industry default) — rect Huebscher D<sub>e</sub> matches the
                    round duct. Friction honoured; snap-up usually drops actual velocity below max.
                  </li>
                  <li>
                    <em>Velocity Reduction</em> — smallest rect at each aspect ratio that keeps V ≤ V_max.
                    Smaller / cheaper duct, but actual friction may exceed your target (flagged red in the
                    friction column).
                  </li>
                </ul>
                Both methods compute actual friction via Huebscher:{' '}
                D<sub>e</sub> = 1.3 × (a·b)<sup>0.625</sup> / (a+b)<sup>0.25</sup>.
              </li>
              <li>
                <strong>Aspect ratio ≤ 4:1</strong> is strongly recommended to limit fabrication cost,
                pressure losses at fittings, and material weight.
              </li>
              <li>
                <strong>Standard sheet-metal sizes:</strong> SMACNA HVAC Duct Construction Standards (in)
                and <strong>IS 655</strong> — Indian Standard for Sheet-Metal Air Ducts (mm). Use the unit
                toggle at the top of the page to switch between them for procurement-ready dimensions.
              </li>
              <li>
                <strong>Velocity bands</strong> per ASHRAE Fundamentals Ch.21 + <strong>ISHRAE HVAC Handbook Vol. 2</strong>{' '}
                (Indian commercial buildings). Use the Duct Type selector to apply the correct band — colour
                thresholds adjust automatically.
              </li>
              <li>
                Verify against duct material roughness (ε = 0.0005 ft for galvanised steel) and fitting loss
                coefficients. Use <strong>static regain method</strong> for high-velocity systems.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
