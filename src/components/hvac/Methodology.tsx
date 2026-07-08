import { useState, type ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { BookOpen, Calculator, Thermometer, Wind, Shield, Info, FlaskConical, Zap, AlertTriangle, ChevronDown, ChevronRight, Printer } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────── */
/* Methodology.tsx — Complete engineering methodology documentation             */
/* Based on: ASHRAE Fundamentals 2017, Carrier HAP, Trane Trace methodology   */
/* ─────────────────────────────────────────────────────────────────────────── */

// ── Collapsible section wrapper ──────────────────────────────────────────────
// The body is always mounted and only hidden with the `hidden` class when collapsed.
// Print / Ctrl+P (see the `@media print` block in index.css) reveals every section, so
// the printout is always the full, expanded document without touching React state.
function CollapseSection({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="collapse-toggle w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left text-sm font-semibold text-gray-800 transition-colors"
      >
        {title}
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>
      <div className={`collapse-body p-4 space-y-3 ${open ? '' : 'hidden'}`}>{children}</div>
    </div>
  );
}

// ── Formula block ─────────────────────────────────────────────────────────────
function FBlock({ label, code, color = 'text-blue-600' }: { label: string; code: string; color?: string }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
      <p className={`text-[10px] font-bold mb-1 ${color}`}>{label}</p>
      <code className="text-[11px] text-gray-700 whitespace-pre-wrap">{code}</code>
    </div>
  );
}

// ── Step row in worked example ────────────────────────────────────────────────
function CalcRow({ label, formula, result, unit = '', highlight = false }: { label: string; formula: string; result: string; unit?: string; highlight?: boolean }) {
  return (
    <tr className={highlight ? 'bg-blue-50 font-semibold' : ''}>
      <td className="px-3 py-1.5 text-gray-700 text-[11px]">{label}</td>
      <td className="px-3 py-1.5 font-mono text-[10px] text-gray-500">{formula}</td>
      <td className={`px-3 py-1.5 text-right font-mono font-bold text-[11px] ${highlight ? 'text-blue-700' : 'text-gray-800'}`}>{result}</td>
      <td className="px-3 py-1.5 text-[10px] text-gray-400">{unit}</td>
    </tr>
  );
}

// Static methodology — printed via the browser's own engine (window.print / Ctrl+P),
// so there is no PDF-generation code here. Print styling lives in index.css (@media print).

export default function Methodology({ userRole }: { userRole?: string | null }) {
  const handlePrint = () => window.print();

  return (
    <div className="methodology-theme max-w-5xl mx-auto space-y-8 pb-12">
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-3xl font-bold text-gray-900">Engineering Methodology</h2>
          {userRole === 'Super' && (
            <button
              onClick={handlePrint}
              className="no-print flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow transition-colors"
              title="Print or save the methodology as a PDF"
            >
              <Printer className="w-4 h-4" /> Print / Save as PDF
            </button>
          )}
        </div>
        <p className="text-gray-500 text-sm leading-relaxed">
          Complete step-by-step documentation of the cooling load calculation engine —
          CLTD/SHGF/CLF method (ASHRAE 1997 Ch. 26), ASHRAE psychrometrics, activity-based people loads,
          ADP/bypass-factor analysis, reheat, dehumidification, and equipment sizing.
          Includes a full real-life worked example and comparison with obsolete methods.
        </p>
        <div className="flex flex-wrap gap-2 mt-1">
          {['ASHRAE 2017 Ch. 1, 18', 'ASHRAE 1997 Ch. 26', 'Carrier Design Manual Pt. 1', 'ASHRAE Std 62.1-2022'].map(b => (
            <span key={b} className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full px-2 py-0.5 font-medium">{b}</span>
          ))}
        </div>
      </div>
      <div>

      {/* ── STEP 1 ── Psychrometrics ─────────────────────────────────────── */}
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-blue-600 text-white">
          <div className="flex items-center gap-3">
            <FlaskConical className="w-6 h-6" />
            <div>
              <CardTitle>Step 1 — Psychrometrics</CardTitle>
              <CardDescription className="text-blue-100">Saturation pressure, humidity ratio, enthalpy — ASHRAE Fundamentals 2017, Ch. 1</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-4 text-sm">
          <p className="text-gray-600 text-xs leading-relaxed">
            Every state point (outdoor, indoor, supply, ADP) is fully described by dry-bulb temperature and
            relative humidity. All subsequent heat-gain and psychrometric calculations derive from these properties.
            The full ASHRAE 2017 (Hyland–Wexler) saturation-pressure correlation is used — the ln(P_ws)
            polynomial in absolute temperature — not the simplified Magnus form.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FBlock label="Saturation pressure (ASHRAE 2017 Ch. 1, over water)" color="text-blue-600"
              code={'ln(P_ws) = C8/T + C9 + C10·T + C11·T² + C12·T³ + C13·ln(T)\n  T = absolute temperature [°R];  Hyland–Wexler (Eq. 6)'} />
            <FBlock label="Partial pressure of water vapour" color="text-blue-600"
              code={'P_v = φ × P_sat(T_db)   [kPa or psia]'} />
            <FBlock label="Humidity ratio W" color="text-blue-600"
              code={'W = 0.622 × P_v / (P_atm − P_v)   [lb_w / lb_da]\nGrains: W_gr = W × 7000         [gr/lb]'} />
            <FBlock label="Specific enthalpy" color="text-blue-600"
              code={'h = 0.240·T_db + W·(1061 + 0.444·T_db)  [BTU/lb]\n(T_db in °F, W in lb/lb)'} />
            <FBlock label="Dew-point temperature" color="text-blue-600"
              code={'Solved from the saturation curve: find T where P_ws(T) = P_v\n(numerical inversion of the ASHRAE curve — not a closed-form Magnus inverse)'} />
            <FBlock label="Atmospheric pressure at altitude" color="text-blue-600"
              code={'P_atm = 14.696 × (1 − 6.8754×10⁻⁶ × alt)^5.2559  [psia]\nalt in feet above sea level'} />
          </div>
          <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-[11px] text-blue-900">
            <strong>Engineering Guideline (ASHRAE 62.1):</strong> Design indoor conditions are typically 75°F DB / 50% RH for
            summer comfort. Humidity above 60% promotes mould growth; below 30% causes static and dryness complaints.
            Outdoor design conditions are taken at the 0.4% cooling design DB/WB (ASHRAE HOF 2017, Ch. 14 — Climatic Design).
          </div>
        </CardContent>
      </Card>

      {/* ── STEP 2 ── Envelope Loads ─────────────────────────────────────── */}
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-orange-600 text-white">
          <div className="flex items-center gap-3">
            <Calculator className="w-6 h-6" />
            <div>
              <CardTitle>Step 2 — Envelope Loads (CLTD / SHGF / CLF)</CardTitle>
              <CardDescription className="text-orange-100">Conduction and solar gains — ASHRAE Fundamentals 1997, Ch. 26 tables</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-5 text-sm">

          <CollapseSection title="2a. Walls & Roof — Conduction (CLTD Method)">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FBlock label="Heat gain — wall/roof" color="text-orange-600"
                code={'Q = U × A × CLTD_corr  [BTU/h]\nU = overall heat transfer coefficient [BTU/h·ft²·°F]\nA = area [ft²]'} />
              <FBlock label="Altitude correction factor" color="text-orange-600"
                code={'k_alt = min(1.25, √(14.696 / P_atm))\nCapped at 1.25 for practical use above 10 000 ft'} />
              <FBlock label="Wall CLTD base (exterior opaque)" color="text-orange-600"
                code={'CLTD_base = (ΔT + offset_orient) × k_alt\nΔT = T_outdoor − T_indoor\noffset: N=4  NE=10  E=18  SE=18  S=16  SW=14  W=12  NW=6'} />
              <FBlock label="Roof CLTD base (horizontal)" color="text-orange-600"
                code={'CLTD_base = (ΔT + 8) + offset_H × 0.35 × k_alt\noffset_H = 17  (+8°F = stored heat in heavyweight roof)'} />
              <FBlock label="Temperature base correction" color="text-orange-600"
                code={'T_mean = T_outdoor_max − DR / 2\ncorr_T = (78 − T_room) + (T_mean − 85)\n(Baseline: 78°F room, 85°F mean outdoor)'} />
              <FBlock label="Surface color correction" color="text-orange-600"
                code={'Dark   = 0°F  (baseline — absorbs most solar)\nMedium = −3°F\nLight  = −6°F  (reflects most solar)'} />
              <FBlock label="Latitude / Month (LM) correction — ASHRAE Table 26.4" color="text-orange-600"
                code={'Jul baseline (40°N). Example values:\nN: Jul=+2  Jan=−2  |  S: Jul=−2  Jan=+3\nE: Jul=+3  Jan=−3  |  W: Jul=−3  Jan=+2\nH: Jul=+2  Jan=−3'} />
              <FBlock label="Final corrected CLTD" color="text-orange-600"
                code={'CLTD_corr = CLTD_base + corr_T + corr_color + LM\n\nGlass (conduction only, no solar):\nQ = U × A × ΔT  (plain ΔT, no CLTD)\n\nPartition:  Q = U × A × ΔT × 0.6\nFloor:      Q = U × A × ΔT × 0.5  (ground damping)'} />
            </div>
            <div className="p-3 bg-orange-50 rounded-lg border border-orange-100 text-[11px] text-orange-800">
              <strong>Engineering Guideline:</strong> CLTD tables were compiled for 40°N latitude, July, peak solar time.
              All four corrections (temperature, color, LM, altitude) are mandatory for accuracy in Indian
              conditions (lat 8–37°N, very high outdoor temps, tropical summer months).
              Omitting the temperature correction alone can underestimate wall load by 15–25%.
            </div>
          </CollapseSection>

          <CollapseSection title="2b. Glass — Solar Gain (SHGF / SC Method)">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FBlock label="Solar heat gain" color="text-orange-600"
                code={'Q_solar = A × SHGF × SC   [BTU/h]\n  SC = SHGC / 0.87  (rated SHGC → shading coefficient)\n  No CLF applied (CLF = 1.0).'} />
              <FBlock label="Shading Coefficient (SC)" color="text-orange-600"
                code={'Clear single pane = 1.00\nClear double pane = 0.88\nTinted            = 0.70–0.80\nReflective        = 0.25–0.45\nLow-E double      = 0.25–0.40'} />
              <FBlock label="SHGF — Max Solar Heat Gain Factor (BTU/h·ft²) at 40°N, July" color="text-orange-600"
                code={'N=26  NE=48  E=68  SE=58  S=42\nSW=58  W=68  NW=48  Horizontal=82'} />
              <FBlock label="SHGC → SC conversion (engine)" color="text-orange-600"
                code={'SHGF tables are calibrated to reference DSA glass\n(SC = 1.0, SHGC ≈ 0.87), so the rated SHGC is\nconverted first:  SC = SHGC / 0.87\n\nNo Cooling Load Factor (CLF) is applied (CLF = 1.0) —\nradiant time-lag is not modelled at this stage.'} />
            </div>
            <div className="p-3 bg-orange-50 rounded-lg border border-orange-100 text-[11px] text-orange-800">
              <strong>Engineering Guideline (ASHRAE 90.1):</strong> Fenestration area should ideally be &lt;40% of
              wall area (WWR). East and West exposures receive peak solar in mornings and afternoons respectively
              and are the highest risk for cooling load. External shading (overhangs, fins) is the most effective
              strategy — it reduces SC effectively to 0.15–0.25 for deeply shaded glass.
            </div>
          </CollapseSection>

          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border border-gray-200 rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-orange-600 text-white">
                  <th className="px-3 py-2 text-left">Orientation</th>
                  {['N','NE','E','SE','S','SW','W','NW','H (Roof)'].map(o => <th key={o} className="px-2 py-2 text-right">{o}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr className="bg-white">
                  <td className="px-3 py-1.5 font-semibold text-gray-700">CLTD Offset (°F)</td>
                  {[4,10,18,18,16,14,12,6,17].map((v,i)=><td key={i} className="px-2 py-1.5 text-right text-gray-700">{v}</td>)}
                </tr>
                <tr className="bg-orange-50/40">
                  <td className="px-3 py-1.5 font-semibold text-gray-700">SHGF (BTU/h·ft²)</td>
                  {[26,48,68,58,42,58,68,48,82].map((v,i)=><td key={i} className="px-2 py-1.5 text-right text-gray-700">{v}</td>)}
                </tr>
                <tr className="bg-white">
                  <td className="px-3 py-1.5 font-semibold text-gray-700">LM July (°F)</td>
                  {[2,3,3,2,-2,-2,-3,-2,2].map((v,i)=><td key={i} className={`px-2 py-1.5 text-right ${v<0?'text-blue-600':'text-red-600'}`}>{v>0?`+${v}`:v}</td>)}
                </tr>
                <tr className="bg-orange-50/40">
                  <td className="px-3 py-1.5 font-semibold text-gray-700">LM Jan (°F)</td>
                  {[-2,-3,-3,-2,3,2,2,1,-3].map((v,i)=><td key={i} className={`px-2 py-1.5 text-right ${v<0?'text-blue-600':'text-red-600'}`}>{v>0?`+${v}`:v}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── STEP 3 ── Internal Gains ─────────────────────────────────────── */}
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-green-700 text-white">
          <div className="flex items-center gap-3">
            <Zap className="w-6 h-6" />
            <div>
              <CardTitle>Step 3 — Internal Gains (People, Lights, Equipment)</CardTitle>
              <CardDescription className="text-green-100">Activity-based people loads — ASHRAE Fundamentals 2017, Ch. 18, Table 2 at 75°F</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-4 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FBlock label="People — sensible" color="text-green-700"
              code={'Q_ps = N_people × q_s  [BTU/h]\nq_s = activity-specific (see table below)'} />
            <FBlock label="People — latent" color="text-green-700"
              code={'Q_pl = N_people × q_l  [BTU/h]\nq_l = activity-specific (perspiration + respiration)'} />
            <FBlock label="Lighting" color="text-green-700"
              code={'Q_lights = (W/ft²) × Area × 3.413  [BTU/h]\n1 Watt = 3.413 BTU/h  (100% sensible)\nTypical office: 1.0–2.0 W/ft²\nRetail / hospital: 1.5–3.0 W/ft²'} />
            <FBlock label="Misc equipment & computers" color="text-green-700"
              code={'Q_equip  = kW_equip × 3413  [BTU/h]\nQ_others = kW_others × 3413  [BTU/h]\n(100% sensible — computers, printers, projectors)'} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border border-gray-200 rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-green-700 text-white">
                  <th className="px-3 py-2 text-left">Occupancy Type</th>
                  <th className="px-3 py-2 text-right">Sensible (BTU/h·p)</th>
                  <th className="px-3 py-2 text-right">Latent (BTU/h·p)</th>
                  <th className="px-3 py-2 text-right">Total (BTU/h·p)</th>
                  <th className="px-3 py-2 text-left">Typical Spaces</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label:'Seated / Rest',         s:245, l:155, note:'Theatre, cinema, auditorium' },
                  { label:'Office Work',            s:245, l:205, note:'Default — typing, meetings, clerical ★' },
                  { label:'Retail / Standing',      s:250, l:250, note:'Retail shop, light store work' },
                  { label:'Restaurant / Dining',    s:275, l:275, note:'Seated eating' },
                  { label:'Light Assembly',         s:275, l:475, note:'Light factory, lab work' },
                  { label:'Light Exercise',         s:305, l:545, note:'Light yoga, walking gym' },
                  { label:'Bowling / Dancing',      s:405, l:645, note:'Sports recreation, dance halls' },
                  { label:'Moderate Exercise',      s:580, l:870, note:'Aerobics, gymnasium' },
                  { label:'Heavy Exercise / Gym',   s:710, l:1270,note:'Weightlifting, squash, sports hall' },
                  { label:'Heavy Factory Work',     s:580, l:870, note:'Heavy industrial, forge' },
                ].map((row,i)=>(
                  <tr key={i} className={i===1 ? 'bg-green-50 ring-1 ring-green-300' : i%2===0?'bg-white':'bg-green-50/20'}>
                    <td className="px-3 py-1.5 font-semibold text-gray-700">{row.label}{i===1?' ★':''}</td>
                    <td className="px-3 py-1.5 text-right text-blue-700">{row.s}</td>
                    <td className="px-3 py-1.5 text-right text-purple-700">{row.l}</td>
                    <td className="px-3 py-1.5 text-right font-bold text-gray-800">{row.s+row.l}</td>
                    <td className="px-3 py-1.5 text-gray-500">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 bg-green-50 border border-green-100 rounded-lg text-[11px] text-green-900 space-y-1">
            <p><strong>★ Default = Office Work.</strong> Values from ASHRAE Fundamentals 2017, Ch. 18, Table 2 at 75°F room temperature.</p>
            <p><strong>Engineering Guideline (ASHRAE 55):</strong> People heat dissipation decreases at lower room temperature.
               For rooms at 70°F, reduce sensible by ~5% and increase latent by ~5%. Gym/sports loads can dominate total load —
               always select activity type carefully.</p>
            <p><strong>Lighting note:</strong> LED lighting produces &lt;10% radiant heat vs incandescent. Most heat is convective/conductive;
               use full wattage value. Lighting CLF (time-lag factor) is not applied in this engine — conservative assumption.</p>
          </div>
        </CardContent>
      </Card>

      {/* ── STEP 4 ── Ventilation ────────────────────────────────────────── */}
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-sky-600 text-white">
          <div className="flex items-center gap-3">
            <Wind className="w-6 h-6" />
            <div>
              <CardTitle>Step 4 — Ventilation Load & Bypass Factor Split</CardTitle>
              <CardDescription className="text-sky-100">Fresh-air heat gain partitioned at the coil — ASHRAE 62.1 minimum OA rates</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-4 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FBlock label="Ventilation CFM from ACH" color="text-sky-600"
              code={'CFM_vent = ACH × Volume / 60\n(Volume = L × W × effective height  [ft³])'} />
            <FBlock label="Ventilation sensible load" color="text-sky-600"
              code={'Q_vs = 1.08 × CFM_vent × (T_outdoor − T_indoor)  [BTU/h]\n1.08 = 60 min/h × 0.075 lb/ft³ × 0.24 BTU/lb·°F'} />
            <FBlock label="Ventilation latent load" color="text-sky-600"
              code={'Q_vl = 0.68 × CFM_vent × (W_out − W_in)  [BTU/h]\nW must be in grains/lb  (W_lb × 7000)\n0.68 = 60 × 0.075 × 1061 / 7000 = 0.682'} />
            <FBlock label="Bypass Factor (BF = 0.15)" color="text-sky-600"
              code={'BF = fraction of air bypassing coil unchilled\nEngine uses a fixed 0.15 for ALL system types.\nReference ranges:\n  Chilled-water coil:  0.05–0.10\n  DX coil (4-row):     0.10–0.15\n  DX coil (2-row):     0.20–0.30'} />
            <FBlock label="Room-side ventilation" color="text-sky-600"
              code={'Q_vs_room = Q_vs × BF   → counted in ERSH\nQ_vl_room = Q_vl × BF   → counted in ERLH'} />
            <FBlock label="Coil OA contribution" color="text-sky-600"
              code={'OA_S = Q_vs × (1−BF)  → coil sensible\nOA_L = Q_vl × (1−BF)  → coil latent\n(only (1−BF) fraction contacts coil surfaces)'} />
          </div>
          <div className="p-3 bg-sky-50 border border-sky-100 rounded-lg text-[11px] text-sky-900">
            <strong>Engineering Guideline (ASHRAE 62.1-2022):</strong> Minimum OA for offices = 5 CFM/person + 0.06 CFM/ft².
            At 10 people in 300 ft²: 5×10 + 0.06×300 = 68 CFM minimum. Using 2 ACH × 3000 ft³/60 = 100 CFM
            exceeds this minimum, which is a good practice for CO₂ dilution. High OA in humid tropical climates
            (Kolkata, Mumbai, Chennai) dramatically increases the latent load — always check coil SHR vs room SHR.
          </div>
        </CardContent>
      </Card>

      {/* ── STEP 5 ── Load Assembly ──────────────────────────────────────── */}
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-violet-700 text-white">
          <div className="flex items-center gap-3">
            <Calculator className="w-6 h-6" />
            <div>
              <CardTitle>Step 5 — Load Assembly (Room → Coil → Grand Total)</CardTitle>
              <CardDescription className="text-violet-100">ERSH / ERLH → CSH / CLH → GTH — Carrier System Design Manual, Part 1</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-4 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FBlock label="Room Sensible base" color="text-violet-600"
              code={'RS_base = Q_envelope_s + Q_people_s + Q_lights\n        + Q_equipment + Q_others  [BTU/h]'} />
            <FBlock label="Parasitic gains (duct & fan)" color="text-violet-600"
              code={'Q_duct = duct_pct% × RS_base  (default 2%)\nQ_fan  = fan_pct%  × RS_base  (default 3%)\n(Accounts for heat picked up in supply ductwork\nand supply fan motor heat dissipation)'} />
            <FBlock label="ERSH — raw (before safety)" color="text-violet-600"
              code={'ERSH_raw = RS_base + Q_vs×BF + Q_duct + Q_fan\n\nRoom-level sensible including bypassed OA\nand parasitic gains, before safety allowance.'} />
            <FBlock label="ERLH — raw (before safety)" color="text-violet-600"
              code={'ERLH_raw = Q_people_latent + Q_vl×BF\n\n(No duct/fan latent — ducts add sensible only)'} />
            <FBlock label="Safety factors applied to ERSH & ERLH" color="text-violet-600"
              code={'ERSH = ERSH_raw × (1 + s_s%)   default s_s = 10%\nERLH = ERLH_raw × (1 + s_l%)   default s_l = 5%\n\ns_s and s_l are user-configurable per room.\nApplied HERE — before coil load assembly —\nso the safety margin is carried into every\ndownstream calculation (CFM, TR, reheat).\n\nNote: Overall safety (default 3%) is applied\nlater to govTR — do not confuse the two.'} />
            <FBlock label="OA coil contributions" color="text-violet-600"
              code={'OA_S = Q_vs × (1−BF)   → only this fraction\nOA_L = Q_vl × (1−BF)   → hits the coil surface'} />
            <FBlock label="Total Coil Sensible (CSH)" color="text-violet-600"
              code={'CSH = ERSH + OA_S  [BTU/h]\n(Full sensible load the coil must handle)'} />
            <FBlock label="Total Coil Latent (CLH)" color="text-violet-600"
              code={'CLH = ERLH + OA_L  [BTU/h]\n(Full latent — people + all ventilation latent)'} />
            <FBlock label="Grand Total Heat (GTH)" color="text-violet-600"
              code={'GTH = CSH + CLH  [BTU/h]\nLoadTR = GTH / 12 000  [tons refrigeration]'} />
          </div>
          <div className="overflow-x-auto mt-2">
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
              <p className="text-[11px] font-bold text-violet-800 mb-3">Load Assembly Flow Diagram</p>
              <div className="font-mono text-[10px] text-gray-700 leading-relaxed whitespace-pre">
{`Envelope sensible  ─┐
People sensible    ─┤
Lights             ─┼─ RS_base
Equipment          ─┤
Others             ─┘
                       + Q_vs × BF          ← bypassed OA sensible
                       + Q_duct (2%)
                       + Q_fan  (3%)
                     ─────────────────────────
                       ERSH_raw
                       × (1 + s_s%)         ← SENSIBLE SAFETY (default 10%)
                     ═══════════════════════
                       ERSH  (with safety)
                       + OA_S = Q_vs×(1−BF) ← un-bypassed OA sensible
                     ═══════════════════════
                       CSH (Total Coil Sensible)

People latent      ─┐
                    ├─ ERLH_raw
Q_vl × BF          ─┘
                       × (1 + s_l%)         ← LATENT SAFETY  (default 5%)
                     ─────────────────────────
                       ERLH  (with safety)
                       + OA_L = Q_vl×(1−BF)
                     ═══════════════════════
                       CLH (Total Coil Latent)

                       GTH = CSH + CLH → LoadTR
                       govTR × (1 + s_o%)   ← OVERALL SAFETY (default 3%)
                     ═══════════════════════
                       requiredTR`}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── STEP 6 ── ADP & Supply Air ──────────────────────────────────── */}
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-cyan-700 text-white">
          <div className="flex items-center gap-3">
            <Thermometer className="w-6 h-6" />
            <div>
              <CardTitle>Step 6 — ADP Search & Dehumidified CFM</CardTitle>
              <CardDescription className="text-cyan-100">GSHF line / saturation curve intersection — Carrier System Design Manual, Chapter 2</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-4 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FBlock label="Grand Sensible Heat Factor (GSHF)" color="text-cyan-600"
              code={'GSHF = CSH / GTH = CSH / (CSH + CLH)\nThis defines the slope of the process line on\nthe psychrometric chart through the room point.'} />
            <FBlock label="ADP search — GSHF / saturation curve intersection" color="text-cyan-600"
              code={`// Iterate T_adp from 35°F to 65°F in 0.1°F steps:
// At each T_adp compute W_adp = W_sat(T_adp)
// sensibleDiff = 1.08 × (T_room − T_adp)
// latentDiff   = 0.68 × (W_room_gr − W_adp_gr)
// ratio = sensibleDiff / (sensibleDiff + latentDiff)
// ADP is where ratio ≈ GSHF
// ── CFM cancels: both terms carry same CFM ──`} />
            <FBlock label="Supply air temperature" color="text-cyan-600"
              code={'T_supply = T_ADP + BF × (T_room − T_ADP)\n         = T_ADP × (1−BF) + T_room × BF'} />
            <FBlock label="Supply air humidity ratio" color="text-cyan-600"
              code={'W_supply = W_ADP + BF × (W_room − W_ADP)\n         = W_ADP × (1−BF) + W_room × BF'} />
            <FBlock label="Dehumidified Supply CFM (DSCFM)" color="text-cyan-600"
              code={'DSCFM = CSH / (1.08 × (T_room − T_supply))\n      = CSH / (1.08 × (1−BF) × (T_room − T_ADP))'} />
            <FBlock label="Why CFM cancels in the ADP loop" color="text-cyan-600"
              code={'GSHF = (1.08·CFM·ΔT) / (1.08·CFM·ΔT + 0.68·CFM·ΔW)\n     = (1.08·ΔT) / (1.08·ΔT + 0.68·ΔW)\nCFM divides out → pure psychrometric intersection.\nThis is mathematically identical to the GSHF-line\nmethod on the psychrometric chart.'} />
          </div>
          <div className="p-3 bg-cyan-50 border border-cyan-100 rounded-lg text-[11px] text-cyan-900 space-y-3">
            <p><strong>Engineering Guideline:</strong> Typical ADP range for air conditioning = 42–58°F.
            ADP below 42°F means the coil would need to operate near freezing — impractical without anti-frost control.
            ADP above 58°F with high latent load indicates the room humidity cannot be adequately controlled —
            a dedicated dehumidifier or TFA/DOAS (Treated Fresh Air / Dedicated Outdoor Air System) should be considered.
            Supply air temperature &lt;55°F can cause condensation on supply grilles or draught complaints.</p>
            <p><strong>Minimum ADP by system type</strong> — physical floor enforced by the refrigerant / medium:</p>
            <table className="w-full text-[10.5px] border border-cyan-200 rounded overflow-hidden mt-1">
              <thead>
                <tr className="bg-cyan-100 text-cyan-900">
                  <th className="text-left px-2 py-1 font-bold">System Type</th>
                  <th className="text-center px-2 py-1 font-bold">Min ADP</th>
                  <th className="text-left px-2 py-1 font-bold">Reason</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Chiller (CHW)', '44 °F', 'Chilled water supply typically 44 °F (7 °C); coil cannot cool below supply water temperature'],
                  ['VRF / Hybrid', '42 °F', 'Variable refrigerant circuit can reach lower evaporating temperatures (~−2 °C) with modern inverter compressors'],
                  ['Standard DX — CAC / VAV / WSHP', '44 °F', 'R-410A refrigerant evaporating temperature floor ~40–45 °F under normal operation'],
                ].map(([sys, adp, reason]) => (
                  <tr key={sys} className="border-t border-cyan-100">
                    <td className="px-2 py-1 font-semibold">{sys}</td>
                    <td className="px-2 py-1 text-center font-mono font-bold text-cyan-800">{adp}</td>
                    <td className="px-2 py-1 text-gray-700">{reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-cyan-700 mt-1">
              The <em>indicated ADP</em> is computed from the GSHF / saturation-curve intersection and may fall anywhere in the 35–65 °F search range.
              The <em>selected ADP</em> = max(indicated ADP, min ADP <strong>floor</strong>). If the selected ADP rises significantly above the indicated ADP,
              the latent load may not be fully removed — consider upgrading to a lower-ADP system or adding a dedicated dehumidifier.
            </p>
          </div>

          {/* Design Mode + Supply-air basis — added 2026-06-10 */}
          <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-[11px] text-indigo-900 space-y-2">
            <p className="font-bold text-indigo-800 text-[12px]">Design Mode — one project choice that sets the ADP floor AND the default airflow basis</p>
            <p>
              Each project picks a single <strong>Design Mode</strong> (Project ▸ Edit dialog). It fixes both how cold the coil runs
              (the selected-ADP floor) and how each room's supply airflow is sized by default. Any individual room can still override
              its supply basis (DSCFM ⇄ ACH).
            </p>
            <table className="w-full text-[10.5px] border border-indigo-200 rounded overflow-hidden mt-1">
              <thead>
                <tr className="bg-indigo-100 text-indigo-900">
                  <th className="text-left px-2 py-1 font-bold">Design Mode</th>
                  <th className="text-center px-2 py-1 font-bold">ADP floor</th>
                  <th className="text-center px-2 py-1 font-bold">Default airflow</th>
                  <th className="text-left px-2 py-1 font-bold">Use for</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Comfort', '54 °F', 'DSCFM', 'Offices / hotels / normal comfort — 7 °C CHW, ~55 °F supply, ~400 CFM/TR (standard Indian practice)'],
                  ['Dehumidification', '44 / 42 °F', 'DSCFM', 'Humid / latent-driven / process spaces that must chase a cold coil'],
                  ['Air-change', '54 °F', 'ACH', 'Spaces sized by ventilation / air-change rate rather than thermal load'],
                ].map(([m, adp, air, use]) => (
                  <tr key={m} className="border-t border-indigo-100">
                    <td className="px-2 py-1 font-semibold">{m}</td>
                    <td className="px-2 py-1 text-center font-mono font-bold text-indigo-800">{adp}</td>
                    <td className="px-2 py-1 text-center font-mono font-bold text-indigo-800">{air}</td>
                    <td className="px-2 py-1 text-gray-700">{use}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-indigo-700">
              <strong>Comfort vs Dehumidification — why 54 °F:</strong> a conventional 7 °C (44.6 °F) chilled-water plant, after coil
              approach, realistically delivers an ADP of ~52–55 °F and a ~55 °F supply (no diffuser sweat / draught). The 44/42 °F
              physical floors only apply when the project is explicitly in Dehumidification mode. Legacy projects (no Design Mode set)
              keep the physical floor + DSCFM.
            </p>
          </div>

          {/* Supply basis either/or + flags */}
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-emerald-900 space-y-2">
            <p className="font-bold text-emerald-800 text-[12px]">Supply-air basis is EITHER/OR — not a max floor</p>
            <p>
              <strong>DSCFM (Dehumidified):</strong> sizes airflow on the <em>sensible</em> Carrier quantity
              <code> ERSH / (1.08 × (1−BF) × (T_room − T_ADP)) </code>, floored only at the fresh-air OA so supply ≥ outdoor air.
              The ACH preset is a <em>reference</em> here, NOT a floor — the dehumidified figure governs even when it is below the
              air-change number.
            </p>
            <p>
              <strong>ACH (Air-change):</strong> sizes airflow on <code>max(sensible-at-fixed-ADP, ACH × Volume / 60)</code>.
            </p>
            <p className="text-[10px]">
              On a normal coil (ADP on the GSHF line) the sensible and latent airflows coincide, so DSCFM <em>is</em> the whole answer.
              They only diverge when the ADP is forced off the line (low-SHF / humid room).
            </p>
            <p className="pt-1 border-t border-emerald-200">
              <strong>⚠ Latent / DOAS flag</strong> (shown on both bases): when the coil at the selected ADP cannot remove the moisture,
              the room read-out shows the dehumidified airflow the latent <em>would</em> need and the implied
              <strong> reheat duty</strong>. That signals a deep-latent space — handle it with <strong>reheat</strong> or a
              <strong> DOAS / desiccant</strong>, never by inflating the airflow.
            </p>
            <p>
              <strong>⚠ Air-change / OA check</strong> (DSCFM only): if the dehumidified airflow falls below the ACH-preset airflow, the
              fixed OA FACPH becomes a larger % of a smaller supply (e.g. 25% → 43%). The read-out flags this so you can verify
              ventilation / air distribution, or switch that room to the ACH basis.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── STEP 7 ── Equipment Sizing ───────────────────────────────────── */}
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-amber-600 text-white">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6" />
            <div>
              <CardTitle>Step 7 — Equipment Sizing (TR & CFM)</CardTitle>
              <CardDescription className="text-amber-100">Plant capacity from coil load; airflow sized independently</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-4 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FBlock label="Plant Cooling Capacity (from Grand Total Heat)" color="text-amber-600"
              code={'plantTR = GTH / 12 000  [tons refrigeration]\n1 TR = 12 000 BTU/h\n\nThe chiller / DX plant is sized on COIL LOAD only.\nAirflow is a separate exercise (see Design CFM).'} />
            <FBlock label="Design Airflow — EITHER/OR basis (2026-06-10)" color="text-amber-600"
              code={'Per-room supply basis (set by project Design Mode,\n room-overridable). NOT a max between the two:\n\n DSCFM basis = max( CSH/(1.08·(1−BF)·ΔT) , freshAir OA )\n   → the SENSIBLE dehumidified-air quantity,\n     floored ONLY at the outdoor-air the room introduces.\n ACH basis   = max( sensible-at-fixed-ADP , ACH·Volume/60 )\n\nDrives: AHU fan, duct sizing, diffuser count.\nThe ACH preset is a REFERENCE under DSCFM, not a floor —\nthe latent excess is surfaced as reheat/DOAS, not airflow.\nDoes NOT inflate plant TR.'} />
            <FBlock label="CFM/TR — sanity ratio (display only)" color="text-amber-600"
              code={'cfmPerTR = DSCFM / plantTR  [CFM per TR]\n\nTypical comfort cooling: 350 – 450 CFM/TR\nHigh-sensible spaces (IT, storage): 500 – 1000\nLow-SHF (kitchens, pool): 250 – 350\n\nNo longer used as a governing input — it is a\nCROSS-CHECK to verify duct sizing is consistent.'} />
            <FBlock label="Required TR with overall safety factor" color="text-amber-600"
              code={'requiredTR = plantTR × (1 + s_o%)   default s_o = 3%\n\nSafety is applied in two stages:\n  Stage 1 (Step 5): s_s% on ERSH, s_l% on ERLH\n                    captures uncertainty in room loads\n  Stage 2 (Step 7): s_o% on plantTR\n                    captures equipment tolerance\n\nPractice: select next standard unit size.\nCommon sizes: 1.5, 2, 2.5, 3, 4, 5, 7.5, 10 TR'} />
          </div>
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-emerald-900">
            <strong>Why we dropped the 400 CFM/TR governance rule (2026-05-20):</strong> the Carrier 400 CFM/TR
            heuristic is a <em>downstream sizing check</em> for the air system, not a sizing input for the cooling
            plant. OEM catalogs for VRF / Package / Ductable / Split units already publish coupled TR and CFM
            ratings — picking <code>unit.ratedTR ≥ requiredTR</code> AND <code>unit.ratedCFM ≥ DSCFM</code> against
            the catalog enforces the relationship at the unit level without inflating room-level coil load.
            For chiller plants, the plant is sized strictly on summed coil duty; AHU/FCU airflow is sized
            independently against the dehumidified-CFM target. Forcing a 400 CFM/TR fit on AHU coils oversizes
            them (low SHR, hunting, freeze risk).
          </div>

          <div className="p-3 bg-sky-50 border border-sky-200 rounded-lg text-[11px] text-sky-900 space-y-1.5">
            <p><strong>Chiller AHU — Coil Duty vs Unit Size:</strong></p>
            <p>
              For a <strong>chiller-fed custom AHU</strong>, two independent numbers drive the design:
            </p>
            <ul className="list-disc list-inside pl-1 space-y-0.5">
              <li>
                <strong>Coil Duty (TR)</strong> = the project's <em>thermal load</em> (sensible + latent) the chilled-water
                coil must remove. This drives coil rows / FPI, CHW flow rate, and the chiller plant's share.
              </li>
              <li>
                <strong>Design CFM</strong> = the <em>dehumidified airflow</em> needed at the room ADP to hit space SHR.
                This drives the AHU fan, motor, casing, and duct sizing.
              </li>
            </ul>
            <p>
              For chiller AHUs serving high-latent or high-OA rooms, <code>Design CFM / Coil Duty</code> is typically
              <strong> 500 – 1000 CFM/TR</strong> — well above 400. That is engineering-correct, not a sizing error.
              If you instead force the AHU coil to 400 CFM/TR, the OEM will quote an <em>oversized coil</em> — destroying
              SHR control, causing hunting at part-load, and increasing freeze risk.
            </p>
            <p>
              <strong>What the schedule shows:</strong> for Chiller AHU/FCU rows the Equipment Schedule prints Coil Duty
              (from room thermal load) and Design CFM (from room dehumidified CFM) — not the catalog-rated TR/CFM of the
              selected model. The chiller plant is sized from <code>Σ Coil Duty × Diversity</code>, which is why plant TR
              sums smaller than the AHU CFM-TR sum when CFM governs.
            </p>
          </div>

          <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-[11px] text-indigo-900 space-y-1.5">
            <p><strong>Chiller Capacity — Actual TR vs Nominal TR (AHRI):</strong></p>
            <p>
              A chiller has two capacity numbers for the same machine — one from the catalog, one for the project:
            </p>
            <ul className="list-disc list-inside pl-1 space-y-0.5">
              <li>
                <strong>Nominal TR</strong> — catalog rating at <em>AHRI Standard 550/590</em> reference conditions:
                44 °F leaving chilled water, 54 °F entering chilled water; 85 °F EWT / 95 °F LWT condenser water
                (water-cooled) or 95 °F ambient (air-cooled), 0.0001 hr·ft²·°F/Btu fouling. Used for catalog
                comparison and IPLV / NPLV ratings — not for sizing.
              </li>
              <li>
                <strong>Actual TR</strong> — <em>our</em> minimum required capacity at this project's site conditions:
                actual entering CW or ambient temperature, design LCW temperature, altitude, glycol concentration,
                fouling factor. We issue this as the duty point in the tender / technical specification;{' '}
                <strong>the OEM must confirm in their technical proposal</strong> (running their selection software
                against the site conditions) that the offered model can meet or exceed this requirement.
              </li>
            </ul>
            <p>
              <strong>Plant sizing must be done on Actual TR, not Nominal.</strong> In hot/humid climates Actual is
              typically 5 – 15 % lower than Nominal (high condenser EWT or high ambient pulls the compressor envelope
              down); in cooler climates it can be slightly higher. Sizing on Nominal in a 110 °F summer ambient is
              a common cause of plants that cannot hold setpoint at design peak.
            </p>
            <p>
              In this tool each chiller unit carries both numbers. <strong>Nom. TR</strong> is the catalog value
              from the library; <strong>Act. TR</strong> is the minimum required Actual you enter for this project
              (revise once the OEM proposal arrives if their confirmed number is higher). Working / Standby roll-ups
              and the "Total Installed Plant" line in the PDF use Actual when entered, and silently fall back to
              Nominal when blank.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── STEP 8 ── Reheat & Moisture ─────────────────────────────────── */}
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-rose-600 text-white">
          <div className="flex items-center gap-3">
            <Thermometer className="w-6 h-6" />
            <div>
              <CardTitle>Step 8 — Reheat Analysis & Moisture Management</CardTitle>
              <CardDescription className="text-rose-100">Coil SHR vs target comfort SHR; total dehumidification rate</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-4 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FBlock label="Coil Sensible Heat Ratio (= GSHF)" color="text-rose-600"
              code={'coilSHR = CSH / GTH\nThis is the Grand Sensible Heat Factor (GSHF).\nIncludes OA sensible & latent — true coil SHR.'} />
            <FBlock label="Target SHR for comfort" color="text-rose-600"
              code={'targetSHR ≈ 0.75–0.80  (typical HVAC comfort)\nIf coilSHR > targetSHR → no reheat needed\nIf coilSHR < targetSHR → reheat may be required\n\nCommon triggers: high OA in humid climate,\nhigh occupancy / gym, low sensible load in winter'} />
            <FBlock label="Reheat power (if required)" color="text-rose-600"
              code={'Q_reheat = DSCFM × 1.08 × (T_supply_target − T_ADP)\nRaises supply air from T_ADP to desired supply DB\n\nNote: Reheat wastes energy — ASHRAE 90.1\nrequires justification for continuous reheat.'} />
            <FBlock label="Total moisture removal rate" color="text-rose-600"
              code={'ṁ_water = CLH / h_fg        [lbs/hr]\n         = CLH / 1061\n\nh_fg = 1061 BTU/lb  (ASHRAE standard value,\n       consistent with 0.68 latent constant)\n\nDerivation check:\n  0.68 = 60 min/hr × 0.075 lb/ft³ × 1061 BTU/lb\n         ──────────────────────────────────────\n              7000 gr/lb\n       = 0.682 ≈ 0.68  ✓\n\nIncludes ALL latent sources:\n  people + ventilation + infiltration'} />
            <FBlock label="Dehumidification action" color="text-rose-600"
              code={'CLH > 0 → Dehumidify  (summer, humid OA)\nCLH < 0 → Humidify    (winter, dry OA)\nCLH = 0 → None        (balanced conditions)'} />
            <FBlock label="Condensate rate (practical)" color="text-rose-600"
              code={'Condensate = ṁ_water / 8.34  [US gal/hr]\n           = ṁ_water / 1.0  [litres/hr approx.]\nUseful for drain sizing and water balance.'} />
          </div>
          <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg text-[11px] text-rose-900">
            <strong>Correction from earlier engine version:</strong> Prior code used ERSH/ERLH for reheat
            (room loads only). Fixed to use CSH/CLH — the coil loads including OA. This is the correct basis
            because the supply air SHR must satisfy the total coil load, not just the room load.
            Similarly, moisture removal previously used ventilation CFM only; now correctly uses CLH/h_fg
            to account for all latent sources.
          </div>
        </CardContent>
      </Card>

      {/* ── STEP 9 ── Seasonal Design Comparison ────────────────────────────── */}
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-teal-700 text-white">
          <div className="flex items-center gap-3">
            <Wind className="w-6 h-6" />
            <div>
              <CardTitle>Step 9 — Seasonal Design Comparison (Monsoon / Winter)</CardTitle>
              <CardDescription className="text-teal-100">Full repeat of Steps 1–8 under alternate-season outdoor conditions; governing TR = max across seasons</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-4 text-sm">
          <p className="text-gray-600 text-xs leading-relaxed">
            When Monsoon or Winter seasons are enabled in Project Settings, the engine repeats the full calculation
            pipeline (Steps 1–8) under the alternate-season outdoor design conditions. Each room carries a
            plant-cooling-capacity number per season — the highest season wins.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FBlock label="Monsoon outdoor conditions" color="text-teal-600"
              code={'T_out_monsoon = monsoon dry-bulb  [°F]\nRH_monsoon    = monsoon relative humidity  [%]\nΔT_monsoon    = T_out_monsoon − T_indoor\nΔW_monsoon    = W_out_monsoon − W_indoor  [gr/lb]\n\nTypically: lower DB, sharply higher RH vs summer\n→ sensible load falls, latent load rises'} />
            <FBlock label="Winter heating load" color="text-teal-600"
              code={'Q_heat = transmission + infiltration + slab-edge\n  ΔT = T_indoor − T_out_winter   (no CLTD, no solar)\n  transmission = Σ U · A · ΔT\n  infiltration = 1.08 · CFM_inf · ΔT\n    non-DOAS: CFM_inf = max(FACPH-CFM, 0.5 ACH)\n    DOAS:     CFM_inf = infiltration only (0.5 ACH) —\n              the DOAS tempers the fresh air, so the\n              space unit covers leakage only\n  slab-edge = F · P · ΔT   (ground-floor rooms only)\nReported as Q_heat [BTU/h] — NOT added to cooling TR\n(sizes the heating coil / heat-pump, not the chiller).'} />
            <FBlock label="Multi-season plant capacity (cooling)" color="text-teal-600"
              code={'plantTR_summer  = loadTR_s\nplantTR_monsoon = loadTR_m\n\nfinalPlantTR = max(plantTR_summer, plantTR_monsoon)\n\nOverall safety applied after:\n  requiredTR = finalPlantTR × (1 + s_o%)\n\nCFM is governed independently:\n  DSCFM = max(DSCFM_summer, DSCFM_monsoon)'} />
            <FBlock label="When monsoon governs (typical triggers)" color="text-teal-600"
              code={'• High OA ACH in humid climates\n  (Kolkata, Mumbai, Chennai, Kochi)\n• High-occupancy rooms\n  (gyms, auditoria, canteens)\n• Low-sensible / high-latent spaces\n\nGSHF_monsoon < 0.65 → humidity control\n  critical → check coil BF, consider TFA/DOAS'} />
          </div>
          <div className="overflow-x-auto">
            <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
              <p className="text-[11px] font-bold text-teal-800 mb-3">Seasonal Comparison — Decision Matrix</p>
              <table className="w-full text-[10.5px] border border-teal-200 rounded overflow-hidden">
                <thead>
                  <tr className="bg-teal-700 text-white">
                    <th className="px-3 py-1.5 text-left font-bold">Seasons Enabled</th>
                    <th className="px-3 py-1.5 text-left font-bold">Engine action</th>
                    <th className="px-3 py-1.5 text-left font-bold">Plant TR</th>
                    <th className="px-3 py-1.5 text-left font-bold">Heating output</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Summer only', 'Steps 1–8 at summer OA conditions', 'plantTR_summer', '—'],
                    ['Summer + Monsoon', 'Full pipeline repeated at monsoon OA; latent recalculated from W_out_monsoon', 'max(summer, monsoon)', '—'],
                    ['Summer + Winter', 'Heating load (transmission + infiltration + slab-edge) computed; no separate cooling run at winter OA', 'plantTR_summer', 'Q_heat [BTU/h]'],
                    ['All three', 'Both alternate-season pipelines computed', 'max(summer, monsoon)', 'Q_heat [BTU/h]'],
                  ].map(([seasons, action, govtr, heat], i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-teal-50/30'}>
                      <td className="px-3 py-1.5 font-semibold text-gray-800">{seasons}</td>
                      <td className="px-3 py-1.5 text-gray-700">{action}</td>
                      <td className="px-3 py-1.5 font-mono font-bold text-teal-800">{govtr}</td>
                      <td className="px-3 py-1.5 text-gray-600">{heat}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="p-3 bg-teal-50 border border-teal-100 rounded-lg text-[11px] text-teal-900 space-y-1">
            <p><strong>Engineering Guideline:</strong> For tropical Indian cities (Kolkata, Mumbai, Chennai, Kochi), always enable monsoon comparison. Monsoon governs equipment sizing in roughly 30–40% of rooms in humid climate zones. Monsoon-governed rooms require coils with lower bypass factor (BF ≤ 0.10) and sustained dehumidification capacity.</p>
            <p><strong>Winter heating note:</strong> The heating BTU/h is used to size heat-pump heating mode, electric strip heaters, or hot-water heating coils. It is reported per room in the PDF report but does not inflate the cooling TR — these are two separate sizing exercises on one calculation sheet.</p>
          </div>
        </CardContent>
      </Card>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ── WORKED EXAMPLE ─────────────────────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <Card className="border-2 border-indigo-300 shadow-md overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-indigo-700 to-indigo-500 text-white">
          <div className="flex items-center gap-3">
            <BookOpen className="w-7 h-7" />
            <div>
              <CardTitle className="text-xl">Real-Life Worked Example</CardTitle>
              <CardDescription className="text-indigo-100 text-sm">
                Conference Room — IT Company, Salt Lake, Kolkata, West Bengal, India
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-5 text-sm">

          {/* Room specification */}
          <CollapseSection title="Room & Project Specification">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label:'Location', value:'Salt Lake, Kolkata, WB' },
                { label:'Latitude', value:'22.57°N' },
                { label:'Altitude', value:'20 ft (≈ 6 m)' },
                { label:'Design Month', value:'June (peak summer)' },
                { label:'Room', value:'Conference Room' },
                { label:'Dimensions', value:'20 ft × 15 ft × 10 ft' },
                { label:'Floor Area', value:'300 ft²' },
                { label:'Volume', value:'3 000 ft³' },
                { label:'Occupancy', value:'10 people (Office Work)' },
                { label:'Lighting', value:'2.0 W/ft² (LED panels)' },
                { label:'Equipment', value:'1.0 kW (laptop + projector)' },
                { label:'Ventilation (ACH)', value:'2.0 ACH' },
                { label:'System type', value:'Split DX, BF = 0.15' },
                { label:'Duct gain', value:'2% of RS_base' },
                { label:'Fan gain', value:'3% of RS_base' },
                { label:'Surface color', value:'Medium (walls)' },
              ].map(({label, value}) => (
                <div key={label} className="bg-indigo-50 rounded-lg p-3">
                  <p className="text-[9px] text-indigo-500 font-bold uppercase tracking-wide">{label}</p>
                  <p className="text-[12px] font-semibold text-gray-800 mt-0.5">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-blue-50 rounded-lg p-3 space-y-1 text-[11px]">
                <p className="font-bold text-blue-700">Outdoor Design Conditions (Summer 0.4% DB)</p>
                {[
                  ['Dry Bulb (T_out)', '95°F'],
                  ['Daily Range (DR)', '18°F'],
                  ['Mean outdoor temp', '95 − 9 = 86°F'],
                  ['Relative Humidity', '70%'],
                  ['P_sat at 95°F', '≈ 0.816 psia'],
                  ['P_v = 0.70 × 0.816', '0.571 psia'],
                  ['W_out = 0.622×0.571/(14.696−0.571)', '0.0252 lb/lb = 176.4 gr/lb'],
                ].map(([k,v])=>(
                  <div key={k} className="flex justify-between">
                    <span className="text-gray-600">{k}</span>
                    <span className="font-mono font-bold text-blue-800">{v}</span>
                  </div>
                ))}
              </div>
              <div className="bg-green-50 rounded-lg p-3 space-y-1 text-[11px]">
                <p className="font-bold text-green-700">Indoor Design Conditions (ASHRAE 55)</p>
                {[
                  ['Dry Bulb (T_in)', '75°F'],
                  ['Relative Humidity', '55%'],
                  ['P_sat at 75°F', '≈ 0.430 psia'],
                  ['P_v = 0.55 × 0.430', '0.237 psia'],
                  ['W_in = 0.622×0.237/(14.696−0.237)', '0.01019 lb/lb = 71.3 gr/lb'],
                  ['ΔT = T_out − T_in', '20°F'],
                  ['ΔW = W_out − W_in (gr)', '176.4 − 71.3 = 105.1 gr/lb'],
                ].map(([k,v])=>(
                  <div key={k} className="flex justify-between">
                    <span className="text-gray-600">{k}</span>
                    <span className="font-mono font-bold text-green-800">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-3 text-[11px] space-y-1">
              <p className="font-bold text-gray-700 mb-2">Envelope Elements</p>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead><tr className="bg-gray-200">
                    <th className="px-2 py-1 text-left">Element</th>
                    <th className="px-2 py-1 text-right">Area (ft²)</th>
                    <th className="px-2 py-1 text-right">U (BTU/h·ft²·°F)</th>
                    <th className="px-2 py-1 text-right">Orientation</th>
                    <th className="px-2 py-1 text-right">Color / SC</th>
                    <th className="px-2 py-1 text-left">Description</th>
                  </tr></thead>
                  <tbody>
                    {[
                      { e:'East Wall (opaque)', a:'160', u:'0.35', o:'E', c:'Dark', d:'20 ft × 10 ft − 40 ft² glass' },
                      { e:'South Wall (opaque)', a:'150', u:'0.35', o:'S', c:'Dark', d:'15 ft × 10 ft, no windows' },
                      { e:'Flat Roof (insulated)', a:'300', u:'0.15', o:'H', c:'Dark', d:'20 ft × 15 ft' },
                      { e:'East Glass ×2 windows', a:'40', u:'1.04', o:'E', c:'SC=0.87', d:'2 windows, 4×5 ft each, clear single' },
                      { e:'West Wall (partition)', a:'200', u:'0.25', o:'Part.', c:'—', d:'Internal partition to corridor' },
                      { e:'North Wall (partition)', a:'150', u:'0.25', o:'Part.', c:'—', d:'Internal partition to lobby' },
                    ].map((r,i)=>(
                      <tr key={i} className={i%2===0?'bg-white':'bg-gray-50'}>
                        <td className="px-2 py-1 font-semibold text-gray-700">{r.e}</td>
                        <td className="px-2 py-1 text-right">{r.a}</td>
                        <td className="px-2 py-1 text-right font-mono">{r.u}</td>
                        <td className="px-2 py-1 text-right">{r.o}</td>
                        <td className="px-2 py-1 text-right">{r.c}</td>
                        <td className="px-2 py-1 text-gray-500 text-[10px]">{r.d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CollapseSection>

          {/* Step 1 in example: Psychrometrics are shown in spec above */}

          {/* Step 2 CLTD */}
          <CollapseSection title="Step 2 — CLTD Calculations (Envelope Heat Gain)">
            <div className="bg-orange-50 rounded-lg p-3 text-[11px] space-y-2">
              <p className="font-bold text-orange-800">Corrections first:</p>
              <div className="font-mono space-y-1 text-gray-700">
                <p>k_alt  = √(14.696 / 14.682) = <strong>1.0005</strong>  (Kolkata ≈ sea level, negligible)</p>
                <p>T_mean = 95 − 18/2        = <strong>86°F</strong></p>
                <p>corr_T = (78−75) + (86−85) = 3 + 1 = <strong>+4°F</strong></p>
                <p>corr_color (Dark)         = <strong>0°F</strong></p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border border-orange-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-orange-600 text-white">
                    <th className="px-3 py-2 text-left">Element</th>
                    <th className="px-2 py-2 text-right">CLTD_base</th>
                    <th className="px-2 py-2 text-right">corr_T</th>
                    <th className="px-2 py-2 text-right">LM (Jun)</th>
                    <th className="px-2 py-2 text-right font-bold">CLTD_corr</th>
                    <th className="px-2 py-2 text-right">U</th>
                    <th className="px-2 py-2 text-right">Area</th>
                    <th className="px-2 py-2 text-right font-bold">Q (BTU/h)</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { e:'East Wall',          base:'(20+18)×1.0=38', t:'+4', lm:'+3', corr:'45', u:'0.35', a:'160', q:'2 520' },
                    { e:'South Wall',         base:'(20+16)×1.0=36', t:'+4', lm:'−2', corr:'38', u:'0.35', a:'150', q:'1 995' },
                    { e:'Roof (H)',           base:'(20+8)+17×0.35=34', t:'+4', lm:'+2', corr:'40', u:'0.15', a:'300', q:'1 800' },
                    { e:'Glass (conduction)', base:'ΔT = 20°F', t:'—', lm:'—', corr:'20', u:'1.04', a:'40',  q:'832' },
                    { e:'West partition',     base:'ΔT×0.6=12', t:'—', lm:'—', corr:'12', u:'0.25', a:'200', q:'600' },
                    { e:'North partition',    base:'ΔT×0.6=12', t:'—', lm:'—', corr:'12', u:'0.25', a:'150', q:'450' },
                  ].map((r,i)=>(
                    <tr key={i} className={i%2===0?'bg-white':'bg-orange-50/30'}>
                      <td className="px-3 py-1.5 font-semibold text-gray-700">{r.e}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-600">{r.base}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-blue-700">{r.t}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-purple-700">{r.lm}</td>
                      <td className="px-2 py-1.5 text-right font-bold text-orange-700">{r.corr}°F</td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-600">{r.u}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-600">{r.a}</td>
                      <td className="px-2 py-1.5 text-right font-bold text-gray-900">{r.q}</td>
                    </tr>
                  ))}
                  <tr className="bg-orange-100 font-bold">
                    <td className="px-3 py-2" colSpan={7}>Solar gain: 40 ft² × 68 (SHGF_E) × 1.00 (SC = SHGC 0.87 / 0.87) — no CLF</td>
                    <td className="px-2 py-2 text-right text-orange-800">2 720</td>
                  </tr>
                  <tr className="bg-orange-200">
                    <td className="px-3 py-2 font-bold text-orange-900" colSpan={7}>Total Envelope Sensible (Q_env_s)</td>
                    <td className="px-2 py-2 text-right font-bold text-orange-900 text-[12px]">10 917</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CollapseSection>

          {/* Step 3 Internal */}
          <CollapseSection title="Step 3 — Internal Gains">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border border-green-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-green-700 text-white">
                    <th className="px-3 py-2 text-left">Source</th>
                    <th className="px-3 py-2 text-right">Formula</th>
                    <th className="px-3 py-2 text-right">Sensible (BTU/h)</th>
                    <th className="px-3 py-2 text-right">Latent (BTU/h)</th>
                  </tr>
                </thead>
                <tbody>
                  <CalcRow label="People (10, office)" formula="10 × 245 / 10 × 205" result="2 450 / 2 050" unit="S / L" />
                  <CalcRow label="Lights (2 W/ft² × 300 ft²)" formula="600 W × 3.413" result="2 048" unit="BTU/h" />
                  <CalcRow label="Equipment (projector+laptops 1 kW)" formula="1.0 kW × 3 413" result="3 413" unit="BTU/h" />
                  <tr className="bg-green-100 font-bold">
                    <td className="px-3 py-2 text-green-900" colSpan={2}>Internal Sensible / Latent Totals</td>
                    <td className="px-3 py-2 text-right text-green-900">7 911</td>
                    <td className="px-3 py-2 text-right text-green-900">2 050</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CollapseSection>

          {/* Step 4 Ventilation */}
          <CollapseSection title="Step 4 — Ventilation Load & Bypass Factor Split">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border border-sky-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-sky-600 text-white">
                    <th className="px-3 py-2 text-left">Calculation</th>
                    <th className="px-3 py-2 text-right">Formula</th>
                    <th className="px-3 py-2 text-right">Result</th>
                    <th className="px-2 py-2 text-left">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  <CalcRow label="Vent CFM" formula="2.0 ACH × 3000 ft³ / 60" result="100" unit="CFM" />
                  <CalcRow label="ASHRAE 62.1 min OA check" formula="5×10 + 0.06×300 = 50+18" result="68 min → 100 OK" unit="CFM" />
                  <CalcRow label="Q_vs (vent sensible)" formula="1.08 × 100 × (95−75)" result="2 160" unit="BTU/h" />
                  <CalcRow label="Q_vl (vent latent)" formula="0.68 × 100 × 105.1" result="7 147" unit="BTU/h" />
                  <CalcRow label="Room-side vent sensible (BF=0.15)" formula="2 160 × 0.15" result="324" unit="BTU/h" />
                  <CalcRow label="Room-side vent latent" formula="7 147 × 0.15" result="1 072" unit="BTU/h" />
                  <CalcRow label="OA coil sensible (1−BF=0.85)" formula="2 160 × 0.85" result="1 836" unit="BTU/h" highlight />
                  <CalcRow label="OA coil latent" formula="7 147 × 0.85" result="6 075" unit="BTU/h" highlight />
                </tbody>
              </table>
            </div>
          </CollapseSection>

          {/* Step 5 Load Assembly */}
          <CollapseSection title="Step 5 — Load Assembly (ERSH / ERLH → CSH / CLH → GTH)">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border border-violet-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-violet-700 text-white">
                    <th className="px-3 py-2 text-left">Load Component</th>
                    <th className="px-3 py-2 text-right">Formula</th>
                    <th className="px-3 py-2 text-right">BTU/h</th>
                    <th className="px-2 py-2 text-left">Note</th>
                  </tr>
                </thead>
                <tbody>
                  <CalcRow label="Envelope sensible (Q_env_s)" formula="(from Step 2)" result="10 917" unit="" />
                  <CalcRow label="Internal sensible (Q_int_s)" formula="(from Step 3)" result="7 911" unit="" />
                  <CalcRow label="Room-side vent sensible" formula="2 160 × 0.15" result="324" unit="" />
                  <CalcRow label="RS_base (pre-parasitic)" formula="10 917 + 7 911 + 324" result="19 152" unit="BTU/h" highlight />
                  <CalcRow label="Duct gain (2%)" formula="2% × 19 152" result="383" unit="" />
                  <CalcRow label="Fan gain (3%)" formula="3% × 19 152" result="575" unit="" />
                  <CalcRow label="ERSH (Eff. Room Sensible Heat)" formula="19 152 + 383 + 575" result="20 110" unit="BTU/h" highlight />
                  <CalcRow label="ERLH (Eff. Room Latent Heat)" formula="2 050 + 1 072" result="3 122" unit="BTU/h" highlight />
                  <CalcRow label="OA coil sensible" formula="2 160 × 0.85" result="1 836" unit="" />
                  <CalcRow label="OA coil latent" formula="7 147 × 0.85" result="6 075" unit="" />
                  <CalcRow label="CSH (Total Coil Sensible)" formula="20 110 + 1 836" result="21 946" unit="BTU/h" highlight />
                  <CalcRow label="CLH (Total Coil Latent)" formula="3 122 + 6 075" result="9 197" unit="BTU/h" highlight />
                  <CalcRow label="GTH (Grand Total Heat)" formula="21 946 + 9 197" result="31 143" unit="BTU/h" highlight />
                </tbody>
              </table>
            </div>
          </CollapseSection>

          {/* Step 6 ADP */}
          <CollapseSection title="Step 6 — ADP Search & Supply Conditions">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border border-cyan-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-cyan-700 text-white">
                    <th className="px-3 py-2 text-left">Calculation</th>
                    <th className="px-3 py-2 text-right">Formula</th>
                    <th className="px-3 py-2 text-right">Result</th>
                    <th className="px-2 py-2 text-left">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  <CalcRow label="GSHF" formula="21 946 / 31 143" result="0.705" unit="" highlight />
                  <CalcRow label="W_room" formula="(given)" result="71.3" unit="gr/lb" />
                  <CalcRow label="T_ADP trial = 50°F → W_sat(50°F)" formula="P_sat=0.1780 → W_adp" result="53.4" unit="gr/lb" />
                  <CalcRow label="sensibleDiff (no CFM)" formula="1.08×(75−50)" result="27.0" unit="" />
                  <CalcRow label="latentDiff" formula="0.68×(71.3−53.4)" result="12.2" unit="" />
                  <CalcRow label="ratio at 50°F" formula="27.0/(27.0+12.2)" result="0.689 ≈ 0.705 ✓" unit="" highlight />
                  <CalcRow label="T_ADP (converged)" formula="iteration converges" result="50.4°F" unit="" highlight />
                  <CalcRow label="T_supply" formula="50.4 + 0.15×(75−50.4)" result="54.1°F" unit="" highlight />
                  <CalcRow label="W_supply" formula="53.4 + 0.15×(71.3−53.4)" result="56.1" unit="gr/lb" />
                  <CalcRow label="DSCFM" formula="21 946 / (1.08×(75−54.1))" result="972" unit="CFM" highlight />
                </tbody>
              </table>
            </div>
          </CollapseSection>

          {/* Step 7 Equipment */}
          <CollapseSection title="Step 7 — Equipment Sizing">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border border-amber-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-amber-600 text-white">
                    <th className="px-3 py-2 text-left">Calculation</th>
                    <th className="px-3 py-2 text-right">Formula</th>
                    <th className="px-3 py-2 text-right">Result</th>
                    <th className="px-2 py-2 text-left">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  <CalcRow label="Load TR (= Governing TR, load-only)" formula="GTH ÷ 12 000 = 31 143 / 12 000" result="2.60" unit="TR" highlight />
                  <CalcRow label="CFM/TR (cross-check only)" formula="DSCFM ÷ 400 = 972 / 400" result="2.43" unit="TR" />
                  <CalcRow label="Required TR (+3% overall safety)" formula="2.60 × 1.03" result="2.68" unit="TR" highlight />
                  <CalcRow label="Selected unit" formula="Next standard size ≥ 2.68 TR" result="3.0 TR" unit="TR ★" highlight />
                  <CalcRow label="Unit CFM (catalog estimate)" formula="3.0 TR × 400" result="1 200" unit="CFM" />
                </tbody>
              </table>
            </div>
            <div className="p-3 bg-amber-50 rounded-lg border border-amber-100 text-[11px] text-amber-900">
              ★ <strong>Select a 3 TR (36 000 BTU/h) split unit.</strong> Plant TR is load-only (2.60 TR → 2.68 with
              3% safety); the CFM/TR cross-check (2.43) sits below it, so airflow is not the binding constraint.
              Always verify the unit's rated CFM (1 200 CFM for 3 TR) ≥ DSCFM (972 CFM). Here 1 200 &gt; 972 — airflow is adequate.
            </div>
          </CollapseSection>

          {/* Step 8 Moisture & Reheat */}
          <CollapseSection title="Step 8 — Moisture Management & Reheat">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border border-rose-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-rose-600 text-white">
                    <th className="px-3 py-2 text-left">Calculation</th>
                    <th className="px-3 py-2 text-right">Formula</th>
                    <th className="px-3 py-2 text-right">Result</th>
                    <th className="px-2 py-2 text-left">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  <CalcRow label="Coil SHR (GSHF)" formula="21 946 / 31 143" result="0.705" unit="" highlight />
                  <CalcRow label="Target SHR" formula="comfort range" result="0.75–0.80" unit="" />
                  <CalcRow label="Reheat needed?" formula="0.705 < 0.75 → yes (borderline)" result="Investigate" unit="" />
                  <CalcRow label="Moisture removal (ṁ)" formula="9 197 / 1 061" result="8.67" unit="lbs/hr" highlight />
                  <CalcRow label="Condensate flow" formula="8.67 / 8.34" result="1.04" unit="US gal/hr" />
                  <CalcRow label="Condensate (litres/hr)" formula="8.67 × 0.454" result="3.94" unit="L/hr" />
                  <CalcRow label="W_supply vs indoor W_room" formula="56.1 vs 71.3 gr/lb" result="ΔW = 15.2" unit="gr/lb removed" />
                  <CalcRow label="Supply air RH at 54°F, 56.1 gr" formula="P_v/P_sat(54°F)" result="≈ 88%" unit="% — acceptable" />
                </tbody>
              </table>
            </div>
            <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg text-[11px] text-rose-900 space-y-1">
              <p><strong>Reheat assessment:</strong> coilSHR = 0.705 is slightly below the 0.75 comfort target.
              In Kolkata's humid climate this is normal — the very high outdoor humidity (W = 176 gr/lb) creates
              a large latent load. Reheat or TFA/DOAS is worth considering for year-round humidity control,
              but for a conference room with intermittent occupancy, the DX unit with 3 TR is adequate.</p>
              <p><strong>Condensate drain:</strong> 3.94 L/hr — size drain line for ≥ 25 mm bore, slope ≥ 1:80.</p>
            </div>
          </CollapseSection>

          <CollapseSection title="Monsoon Design (Separate Detailed Real-Time Example)">
            <div className="p-3 bg-teal-50 border border-teal-100 rounded-lg text-[11px] text-teal-900 space-y-1">
              <p><strong>Why this separate check matters:</strong> For Kolkata, monsoon hours usually have lower dry-bulb but much higher RH, so latent load dominates even when sensible load drops.</p>
              <p><strong>Real-time use case:</strong> Use this mode when project weather is switched to Monsoon design point in the app and compare against summer sizing before final equipment selection.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-teal-50 rounded-lg p-3 space-y-1 text-[11px] border border-teal-100">
                <p className="font-bold text-teal-700">Monsoon Outdoor State (Kolkata)</p>
                {[
                  ['Dry Bulb (T_out_monsoon)', '88°F'],
                  ['Relative Humidity', '88%'],
                  ['P_sat at 88°F', '≈ 0.695 psia'],
                  ['P_v = 0.88 × 0.695', '0.612 psia'],
                  ['W_out_monsoon', '0.0270 lb/lb = 189.0 gr/lb'],
                  ['Indoor W_in (same setpoint)', '71.3 gr/lb'],
                  ['ΔT_monsoon', '88 − 75 = 13°F'],
                  ['ΔW_monsoon', '189.0 − 71.3 = 117.7 gr/lb'],
                ].map(([k,v])=>(
                  <div key={k} className="flex justify-between">
                    <span className="text-gray-600">{k}</span>
                    <span className="font-mono font-bold text-teal-800">{v}</span>
                  </div>
                ))}
              </div>

              <div className="bg-cyan-50 rounded-lg p-3 space-y-1 text-[11px] border border-cyan-100">
                <p className="font-bold text-cyan-700">Assumptions for Monsoon Update Run</p>
                {[
                  ['Room geometry / occupancy', 'Same as summer example'],
                  ['Ventilation', '2.0 ACH = 100 CFM'],
                  ['Bypass Factor', 'BF = 0.15'],
                  ['Internal loads', 'Unchanged (people/lights/equipment)'],
                  ['Envelope sensible update', 'Summer envelope × weather factor'],
                  ['Envelope result used', '6 432 BTU/h'],
                ].map(([k,v])=>(
                  <div key={k} className="flex justify-between gap-2">
                    <span className="text-gray-600">{k}</span>
                    <span className="font-mono font-bold text-cyan-800 text-right">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border border-teal-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-teal-700 text-white">
                    <th className="px-3 py-2 text-left">Monsoon Calculation Step</th>
                    <th className="px-3 py-2 text-right">Formula</th>
                    <th className="px-3 py-2 text-right">Result</th>
                    <th className="px-2 py-2 text-left">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  <CalcRow label="Vent CFM" formula="2.0 × 3000 / 60" result="100" unit="CFM" />
                  <CalcRow label="Q_vs,monsoon" formula="1.08 × 100 × 13" result="1 404" unit="BTU/h" />
                  <CalcRow label="Q_vl,monsoon" formula="0.68 × 100 × 117.7" result="8 004" unit="BTU/h" highlight />
                  <CalcRow label="Room-side vent sensible" formula="1 404 × 0.15" result="211" unit="BTU/h" />
                  <CalcRow label="Room-side vent latent" formula="8 004 × 0.15" result="1 201" unit="BTU/h" highlight />
                  <CalcRow label="OA coil sensible" formula="1 404 × 0.85" result="1 193" unit="BTU/h" />
                  <CalcRow label="OA coil latent" formula="8 004 × 0.85" result="6 803" unit="BTU/h" highlight />
                  <CalcRow label="RS_base" formula="Q_env_s(6 432) + Q_int_s(7 911) + 211" result="14 554" unit="BTU/h" />
                  <CalcRow label="Duct + Fan" formula="(2% + 3%) × 14 554" result="728" unit="BTU/h" />
                  <CalcRow label="ERSH" formula="14 554 + 728" result="15 282" unit="BTU/h" highlight />
                  <CalcRow label="ERLH" formula="2 050 + 1 201" result="3 251" unit="BTU/h" highlight />
                  <CalcRow label="CSH" formula="15 282 + 1 193" result="16 475" unit="BTU/h" highlight />
                  <CalcRow label="CLH" formula="3 251 + 6 803" result="10 054" unit="BTU/h" highlight />
                  <CalcRow label="GTH" formula="16 475 + 10 054" result="26 529" unit="BTU/h" highlight />
                  <CalcRow label="Load TR" formula="26 529 / 12 000" result="2.21" unit="TR" />
                  <CalcRow label="GSHF (Monsoon)" formula="16 475 / 26 529" result="0.621" unit="latent-heavy" highlight />
                </tbody>
              </table>
            </div>

            <div className="p-3 bg-teal-50 border border-teal-100 rounded-lg text-[11px] text-teal-900 space-y-1">
              <p><strong>Interpretation:</strong> Compared to summer, monsoon sensible load falls, but latent fraction rises sharply due to high outdoor humidity. Coil SHR drops to 0.621, so humidity control is more critical than dry-bulb pull-down.</p>
              <p><strong>Design action:</strong> Keep selected unit at 3.0 TR for robustness, and prioritize low-BF coil performance, continuous condensate management, and optional ventilation dehumidification in prolonged monsoon operation.</p>
            </div>
          </CollapseSection>

          {/* Final Summary */}
          <div className="bg-indigo-900 text-white rounded-xl p-5">
            <h4 className="text-base font-bold mb-4 flex items-center gap-2">
              <Calculator className="w-5 h-5" /> Final Load Summary — Conference Room, Kolkata
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label:'Envelope Sensible', value:'10 917', unit:'BTU/h', color:'text-orange-300' },
                { label:'Internal Sensible', value:'7 911', unit:'BTU/h', color:'text-green-300' },
                { label:'Vent + BF Sensible', value:'324', unit:'BTU/h', color:'text-sky-300' },
                { label:'Duct + Fan Gain', value:'958', unit:'BTU/h', color:'text-gray-300' },
                { label:'ERSH', value:'20 110', unit:'BTU/h', color:'text-violet-300' },
                { label:'ERLH', value:'3 122', unit:'BTU/h', color:'text-violet-300' },
                { label:'OA Coil Contribution', value:'7 911', unit:'BTU/h', color:'text-sky-300' },
                { label:'Grand Total Heat', value:'31 143', unit:'BTU/h', color:'text-yellow-300' },
                { label:'Load TR (load-only)', value:'2.60', unit:'TR', color:'text-yellow-300' },
                { label:'DSCFM', value:'972', unit:'CFM', color:'text-cyan-300' },
                { label:'Required TR (+3%)', value:'2.68', unit:'TR', color:'text-yellow-300' },
                { label:'Selected Unit', value:'3.0 TR', unit:'Split DX', color:'text-emerald-300' },
                { label:'Moisture Removal', value:'8.67', unit:'lbs/hr', color:'text-rose-300' },
                { label:'Condensate', value:'3.94', unit:'L/hr', color:'text-rose-300' },
                { label:'ADP', value:'50.4°F', unit:'', color:'text-cyan-300' },
                { label:'Supply Air', value:'54.1°F / 56 gr', unit:'', color:'text-cyan-300' },
              ].map(({label,value,unit,color})=>(
                <div key={label} className="bg-indigo-800 rounded-lg p-3">
                  <p className="text-[9px] text-indigo-300 uppercase tracking-wide">{label}</p>
                  <p className={`text-sm font-bold mt-1 ${color}`}>{value} <span className="text-[10px] font-normal text-indigo-300">{unit}</span></p>
                </div>
              ))}
            </div>
          </div>

        </CardContent>
      </Card>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ── SECOND WORKED EXAMPLE (GANGTOK) ───────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <Card className="border-2 border-emerald-300 shadow-md overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-emerald-700 to-emerald-500 text-white">
          <div className="flex items-center gap-3">
            <BookOpen className="w-7 h-7" />
            <div>
              <CardTitle className="text-xl">Detailed Comparative Example (Same Room) — Gangtok</CardTitle>
              <CardDescription className="text-emerald-100 text-sm">
                Conference Room — IT Company, Gangtok, Sikkim, India (Lat 27.3314N, Long 88.6138E, Altitude 5,249 ft)
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-5 text-sm">

          <CollapseSection title="Room & Project Specification (Same as Kolkata for apples-to-apples comparison)">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label:'Location', value:'Gangtok, Sikkim' },
                { label:'Latitude', value:'27.3314N' },
                { label:'Longitude', value:'88.6138E' },
                { label:'Altitude', value:'5 249 ft (≈ 1 600 m)' },
                { label:'Design Month', value:'June (summer)' },
                { label:'Room', value:'Conference Room' },
                { label:'Dimensions', value:'20 ft × 15 ft × 10 ft' },
                { label:'Floor Area', value:'300 ft²' },
                { label:'Volume', value:'3 000 ft³' },
                { label:'Occupancy', value:'10 people (Office Work)' },
                { label:'Lighting', value:'2.0 W/ft² (LED panels)' },
                { label:'Equipment', value:'1.0 kW (laptop + projector)' },
                { label:'Ventilation (ACH)', value:'2.0 ACH' },
                { label:'System type', value:'Split DX, BF = 0.15' },
                { label:'Duct gain', value:'2% of RS_base' },
                { label:'Fan gain', value:'3% of RS_base' },
              ].map(({label, value}) => (
                <div key={label} className="bg-emerald-50 rounded-lg p-3">
                  <p className="text-[9px] text-emerald-600 font-bold uppercase tracking-wide">{label}</p>
                  <p className="text-[12px] font-semibold text-gray-800 mt-0.5">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-sky-50 rounded-lg p-3 space-y-1 text-[11px]">
                <p className="font-bold text-sky-700">Outdoor Design Conditions (Gangtok summer design)</p>
                {[
                  ['Dry Bulb (T_out)', '82°F'],
                  ['Daily Range (DR)', '12°F'],
                  ['Mean outdoor temp', '82 − 6 = 76°F'],
                  ['Relative Humidity', '75%'],
                  ['Atmospheric pressure', '12.11 psia (at 5 249 ft)'],
                  ['P_sat at 82°F', '≈ 0.555 psia'],
                  ['P_v = 0.75 × 0.555', '0.416 psia'],
                  ['W_out = 0.622×0.416/(12.11−0.416)', '0.0221 lb/lb = 154.7 gr/lb'],
                ].map(([k,v])=>(
                  <div key={k} className="flex justify-between">
                    <span className="text-gray-600">{k}</span>
                    <span className="font-mono font-bold text-sky-800">{v}</span>
                  </div>
                ))}
              </div>
              <div className="bg-green-50 rounded-lg p-3 space-y-1 text-[11px]">
                <p className="font-bold text-green-700">Indoor Design Conditions (Same comfort target)</p>
                {[
                  ['Dry Bulb (T_in)', '75°F'],
                  ['Relative Humidity', '55%'],
                  ['P_sat at 75°F', '≈ 0.430 psia'],
                  ['P_v = 0.55 × 0.430', '0.237 psia'],
                  ['W_in = 0.622×0.237/(12.11−0.237)', '0.01239 lb/lb = 86.7 gr/lb'],
                  ['ΔT = T_out − T_in', '7°F'],
                  ['ΔW = W_out − W_in (gr/lb)', '154.7 − 86.7 = 68.0 gr/lb'],
                ].map(([k,v])=>(
                  <div key={k} className="flex justify-between">
                    <span className="text-gray-600">{k}</span>
                    <span className="font-mono font-bold text-green-800">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-3 text-[11px] space-y-1">
              <p className="font-bold text-gray-700 mb-2">Envelope Elements (exactly same as Kolkata case)</p>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead><tr className="bg-gray-200">
                    <th className="px-2 py-1 text-left">Element</th>
                    <th className="px-2 py-1 text-right">Area (ft²)</th>
                    <th className="px-2 py-1 text-right">U (BTU/h·ft²·°F)</th>
                    <th className="px-2 py-1 text-right">Orientation</th>
                    <th className="px-2 py-1 text-right">Color / SC</th>
                    <th className="px-2 py-1 text-left">Description</th>
                  </tr></thead>
                  <tbody>
                    {[
                      { e:'East Wall (opaque)', a:'160', u:'0.35', o:'E', c:'Dark', d:'20 ft × 10 ft − 40 ft² glass' },
                      { e:'South Wall (opaque)', a:'150', u:'0.35', o:'S', c:'Dark', d:'15 ft × 10 ft, no windows' },
                      { e:'Flat Roof (insulated)', a:'300', u:'0.15', o:'H', c:'Dark', d:'20 ft × 15 ft' },
                      { e:'East Glass ×2 windows', a:'40', u:'1.04', o:'E', c:'SC=0.87', d:'2 windows, 4×5 ft each, clear single' },
                      { e:'West Wall (partition)', a:'200', u:'0.25', o:'Part.', c:'—', d:'Internal partition to corridor' },
                      { e:'North Wall (partition)', a:'150', u:'0.25', o:'Part.', c:'—', d:'Internal partition to lobby' },
                    ].map((r,i)=>(
                      <tr key={i} className={i%2===0?'bg-white':'bg-gray-50'}>
                        <td className="px-2 py-1 font-semibold text-gray-700">{r.e}</td>
                        <td className="px-2 py-1 text-right">{r.a}</td>
                        <td className="px-2 py-1 text-right font-mono">{r.u}</td>
                        <td className="px-2 py-1 text-right">{r.o}</td>
                        <td className="px-2 py-1 text-right">{r.c}</td>
                        <td className="px-2 py-1 text-gray-500 text-[10px]">{r.d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CollapseSection>

          <CollapseSection title="Step 2 — CLTD Calculations (Gangtok)">
            <div className="bg-orange-50 rounded-lg p-3 text-[11px] space-y-2">
              <p className="font-bold text-orange-800">Corrections first:</p>
              <div className="font-mono space-y-1 text-gray-700">
                <p>P_atm  = 14.696 × (1 − 6.8754e−6 × 5249)^5.2559 = <strong>12.11 psia</strong></p>
                <p>k_alt  = √(14.696 / 12.11) = <strong>1.102</strong>  (noticeable altitude amplification)</p>
                <p>T_mean = 82 − 12/2          = <strong>76°F</strong></p>
                <p>corr_T = (78−75) + (76−85)  = 3 − 9 = <strong>−6°F</strong></p>
                <p>corr_color (Dark)           = <strong>0°F</strong></p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border border-orange-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-orange-600 text-white">
                    <th className="px-3 py-2 text-left">Element</th>
                    <th className="px-2 py-2 text-right">CLTD_base</th>
                    <th className="px-2 py-2 text-right">corr_T</th>
                    <th className="px-2 py-2 text-right">LM (Jun)</th>
                    <th className="px-2 py-2 text-right font-bold">CLTD_corr</th>
                    <th className="px-2 py-2 text-right">U</th>
                    <th className="px-2 py-2 text-right">Area</th>
                    <th className="px-2 py-2 text-right font-bold">Q (BTU/h)</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { e:'East Wall',          base:'(7+18)×1.102=27.6', t:'−6', lm:'+3', corr:'24.6', u:'0.35', a:'160', q:'1 377' },
                    { e:'South Wall',         base:'(7+16)×1.102=25.4', t:'−6', lm:'−2', corr:'17.4', u:'0.35', a:'150', q:'914' },
                    { e:'Roof (H)',           base:'((7+8)+17×0.35)×1.102=23.1', t:'−6', lm:'+2', corr:'19.1', u:'0.15', a:'300', q:'860' },
                    { e:'Glass (conduction)', base:'Delta T = 7F', t:'-', lm:'-', corr:'7', u:'1.04', a:'40',  q:'291' },
                    { e:'West partition',     base:'Delta T×0.6=4.2', t:'-', lm:'-', corr:'4.2', u:'0.25', a:'200', q:'210' },
                    { e:'North partition',    base:'Delta T×0.6=4.2', t:'-', lm:'-', corr:'4.2', u:'0.25', a:'150', q:'158' },
                  ].map((r,i)=>(
                    <tr key={i} className={i%2===0?'bg-white':'bg-orange-50/30'}>
                      <td className="px-3 py-1.5 font-semibold text-gray-700">{r.e}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-600">{r.base}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-blue-700">{r.t}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-purple-700">{r.lm}</td>
                      <td className="px-2 py-1.5 text-right font-bold text-orange-700">{r.corr}°F</td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-600">{r.u}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-600">{r.a}</td>
                      <td className="px-2 py-1.5 text-right font-bold text-gray-900">{r.q}</td>
                    </tr>
                  ))}
                  <tr className="bg-orange-100 font-bold">
                    <td className="px-3 py-2" colSpan={7}>Solar gain: 40 ft² × 68 (SHGF_E) × 1.00 (SC = SHGC 0.87 / 0.87) — no CLF</td>
                    <td className="px-2 py-2 text-right text-orange-800">2 720</td>
                  </tr>
                  <tr className="bg-orange-200">
                    <td className="px-3 py-2 font-bold text-orange-900" colSpan={7}>Total Envelope Sensible (Q_env_s)</td>
                    <td className="px-2 py-2 text-right font-bold text-orange-900 text-[12px]">6 530</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CollapseSection>

          <CollapseSection title="Step 3 — Internal Gains (same occupancy, same room)">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border border-green-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-green-700 text-white">
                    <th className="px-3 py-2 text-left">Source</th>
                    <th className="px-3 py-2 text-right">Formula</th>
                    <th className="px-3 py-2 text-right">Sensible (BTU/h)</th>
                    <th className="px-3 py-2 text-right">Latent (BTU/h)</th>
                  </tr>
                </thead>
                <tbody>
                  <CalcRow label="People (10, office)" formula="10 × 245 / 10 × 205" result="2 450 / 2 050" unit="S / L" />
                  <CalcRow label="Lights (2 W/ft2 × 300 ft2)" formula="600 W × 3.413" result="2 048" unit="BTU/h" />
                  <CalcRow label="Equipment (projector+laptops 1 kW)" formula="1.0 kW × 3 413" result="3 413" unit="BTU/h" />
                  <tr className="bg-green-100 font-bold">
                    <td className="px-3 py-2 text-green-900" colSpan={2}>Internal Sensible / Latent Totals</td>
                    <td className="px-3 py-2 text-right text-green-900">7 911</td>
                    <td className="px-3 py-2 text-right text-green-900">2 050</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CollapseSection>

          <CollapseSection title="Step 4 — Ventilation Load & Bypass Factor Split (Gangtok)">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border border-sky-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-sky-600 text-white">
                    <th className="px-3 py-2 text-left">Calculation</th>
                    <th className="px-3 py-2 text-right">Formula</th>
                    <th className="px-3 py-2 text-right">Result</th>
                    <th className="px-2 py-2 text-left">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  <CalcRow label="Vent CFM" formula="2.0 ACH × 3000 ft³ / 60" result="100" unit="CFM" />
                  <CalcRow label="ASHRAE 62.1 min OA check" formula="5×10 + 0.06×300 = 50+18" result="68 min → 100 OK" unit="CFM" />
                  <CalcRow label="Q_vs (vent sensible)" formula="1.08 × 100 × (82−75)" result="756" unit="BTU/h" />
                  <CalcRow label="Q_vl (vent latent)" formula="0.68 × 100 × 68.0" result="4 624" unit="BTU/h" />
                  <CalcRow label="Room-side vent sensible (BF=0.15)" formula="756 × 0.15" result="113" unit="BTU/h" />
                  <CalcRow label="Room-side vent latent" formula="4 624 × 0.15" result="694" unit="BTU/h" />
                  <CalcRow label="OA coil sensible (1−BF=0.85)" formula="756 × 0.85" result="643" unit="BTU/h" highlight />
                  <CalcRow label="OA coil latent" formula="4 624 × 0.85" result="3 930" unit="BTU/h" highlight />
                </tbody>
              </table>
            </div>
          </CollapseSection>

          <CollapseSection title="Step 5 — Load Assembly (ERSH / ERLH → CSH / CLH → GTH)">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border border-violet-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-violet-700 text-white">
                    <th className="px-3 py-2 text-left">Load Component</th>
                    <th className="px-3 py-2 text-right">Formula</th>
                    <th className="px-3 py-2 text-right">BTU/h</th>
                    <th className="px-2 py-2 text-left">Note</th>
                  </tr>
                </thead>
                <tbody>
                  <CalcRow label="Envelope sensible (Q_env_s)" formula="(from Step 2)" result="6 530" unit="" />
                  <CalcRow label="Internal sensible (Q_int_s)" formula="(from Step 3)" result="7 911" unit="" />
                  <CalcRow label="Room-side vent sensible" formula="756 × 0.15" result="113" unit="" />
                  <CalcRow label="RS_base (pre-parasitic)" formula="6 530 + 7 911 + 113" result="14 554" unit="BTU/h" highlight />
                  <CalcRow label="Duct gain (2%)" formula="2% × 14 554" result="291" unit="" />
                  <CalcRow label="Fan gain (3%)" formula="3% × 14 554" result="437" unit="" />
                  <CalcRow label="ERSH (Eff. Room Sensible Heat)" formula="14 554 + 291 + 437" result="15 282" unit="BTU/h" highlight />
                  <CalcRow label="ERLH (Eff. Room Latent Heat)" formula="2 050 + 694" result="2 744" unit="BTU/h" highlight />
                  <CalcRow label="OA coil sensible" formula="756 × 0.85" result="643" unit="" />
                  <CalcRow label="OA coil latent" formula="4 624 × 0.85" result="3 930" unit="" />
                  <CalcRow label="CSH (Total Coil Sensible)" formula="15 282 + 643" result="15 925" unit="BTU/h" highlight />
                  <CalcRow label="CLH (Total Coil Latent)" formula="2 744 + 3 930" result="6 674" unit="BTU/h" highlight />
                  <CalcRow label="GTH (Grand Total Heat)" formula="15 925 + 6 674" result="22 599" unit="BTU/h" highlight />
                </tbody>
              </table>
            </div>
          </CollapseSection>

          <CollapseSection title="Step 6 — ADP Search & Supply Conditions (Gangtok)">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border border-cyan-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-cyan-700 text-white">
                    <th className="px-3 py-2 text-left">Calculation</th>
                    <th className="px-3 py-2 text-right">Formula</th>
                    <th className="px-3 py-2 text-right">Result</th>
                    <th className="px-2 py-2 text-left">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  <CalcRow label="GSHF" formula="15 925 / 22 599" result="0.705" unit="" highlight />
                  <CalcRow label="W_room" formula="(given)" result="86.7" unit="gr/lb" />
                  <CalcRow label="T_ADP trial = 52F → W_sat(52F)" formula="P_sat=0.194 → W_adp" result="70.7" unit="gr/lb" />
                  <CalcRow label="sensibleDiff (no CFM)" formula="1.08×(75−52)" result="24.8" unit="" />
                  <CalcRow label="latentDiff" formula="0.68×(86.7−70.7)" result="10.9" unit="" />
                  <CalcRow label="ratio at 52F" formula="24.8/(24.8+10.9)" result="0.695 ≈ 0.705 ✓" unit="" highlight />
                  <CalcRow label="T_ADP (converged)" formula="iteration converges" result="52.0°F" unit="" highlight />
                  <CalcRow label="T_supply" formula="52.0 + 0.15×(75−52.0)" result="55.5°F" unit="" highlight />
                  <CalcRow label="W_supply" formula="70.7 + 0.15×(86.7−70.7)" result="73.1" unit="gr/lb" />
                  <CalcRow label="DSCFM" formula="15 925 / (1.08×(75−55.5))" result="756" unit="CFM" highlight />
                </tbody>
              </table>
            </div>
          </CollapseSection>

          <CollapseSection title="Step 7 — Equipment Sizing (Gangtok)">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border border-amber-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-amber-600 text-white">
                    <th className="px-3 py-2 text-left">Calculation</th>
                    <th className="px-3 py-2 text-right">Formula</th>
                    <th className="px-3 py-2 text-right">Result</th>
                    <th className="px-2 py-2 text-left">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  <CalcRow label="Load TR (= Governing TR, load-only)" formula="GTH ÷ 12 000 = 22 599 / 12 000" result="1.88" unit="TR" highlight />
                  <CalcRow label="CFM/TR (cross-check only)" formula="DSCFM ÷ 400 = 756 / 400" result="1.89" unit="TR" />
                  <CalcRow label="Required TR (+3% overall safety)" formula="1.88 × 1.03" result="1.94" unit="TR" highlight />
                  <CalcRow label="Selected unit" formula="Next standard size ≥ 1.94 TR" result="2.0 TR" unit="TR ★" highlight />
                  <CalcRow label="Unit CFM (catalog estimate)" formula="2.0 TR × 400" result="800" unit="CFM" />
                </tbody>
              </table>
            </div>
            <div className="p-3 bg-amber-50 rounded-lg border border-amber-100 text-[11px] text-amber-900">
              ★ <strong>Select a 2 TR (24 000 BTU/h) split unit.</strong> Plant TR is load-only (1.88 TR → 1.94 with 3% safety);
              the CFM/TR cross-check (1.89) sits alongside it, and catalog airflow (800 CFM) is above DSCFM (756 CFM), so both the load and airflow requirements are satisfied.
            </div>
          </CollapseSection>

          <CollapseSection title="Step 8 — Moisture Management & Reheat (Gangtok)">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border border-rose-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-rose-600 text-white">
                    <th className="px-3 py-2 text-left">Calculation</th>
                    <th className="px-3 py-2 text-right">Formula</th>
                    <th className="px-3 py-2 text-right">Result</th>
                    <th className="px-2 py-2 text-left">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  <CalcRow label="Coil SHR (GSHF)" formula="15 925 / 22 599" result="0.705" unit="" highlight />
                  <CalcRow label="Target SHR" formula="comfort range" result="0.75–0.80" unit="" />
                  <CalcRow label="Reheat needed?" formula="0.705 < 0.75" result="Possible in monsoon shoulder hours" unit="" />
                  <CalcRow label="Moisture removal (m_dot)" formula="6 674 / 1 061" result="6.29" unit="lbs/hr" highlight />
                  <CalcRow label="Condensate flow" formula="6.29 / 8.34" result="0.75" unit="US gal/hr" />
                  <CalcRow label="Condensate (litres/hr)" formula="6.29 × 0.454" result="2.86" unit="L/hr" />
                  <CalcRow label="W_supply vs indoor W_room" formula="73.1 vs 86.7 gr/lb" result="ΔW = 13.6" unit="gr/lb removed" />
                </tbody>
              </table>
            </div>
            <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg text-[11px] text-rose-900 space-y-1">
              <p><strong>Reheat assessment:</strong> Even in Gangtok, coilSHR stays below 0.75 due to latent fraction from ventilation.
              However, compared to Kolkata the latent burden is lower, so condensate generation and dehumidification demand are both reduced.</p>
              <p><strong>Condensate drain:</strong> 2.86 L/hr - 25 mm drain line with proper slope is adequate.</p>
            </div>
          </CollapseSection>

          <div className="bg-emerald-900 text-white rounded-xl p-5">
            <h4 className="text-base font-bold mb-4 flex items-center gap-2">
              <Calculator className="w-5 h-5" /> Final Load Summary — Conference Room, Gangtok
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label:'Envelope Sensible', value:'6 530', unit:'BTU/h', color:'text-orange-300' },
                { label:'Internal Sensible', value:'7 911', unit:'BTU/h', color:'text-green-300' },
                { label:'Vent + BF Sensible', value:'113', unit:'BTU/h', color:'text-sky-300' },
                { label:'Duct + Fan Gain', value:'728', unit:'BTU/h', color:'text-gray-300' },
                { label:'ERSH', value:'15 282', unit:'BTU/h', color:'text-violet-300' },
                { label:'ERLH', value:'2 744', unit:'BTU/h', color:'text-violet-300' },
                { label:'OA Coil Contribution', value:'4 573', unit:'BTU/h', color:'text-sky-300' },
                { label:'Grand Total Heat', value:'22 599', unit:'BTU/h', color:'text-yellow-300' },
                { label:'Load TR (load-only)', value:'1.88', unit:'TR', color:'text-yellow-300' },
                { label:'DSCFM', value:'756', unit:'CFM', color:'text-cyan-300' },
                { label:'Required TR (+3%)', value:'1.94', unit:'TR', color:'text-yellow-300' },
                { label:'Selected Unit', value:'2.0 TR', unit:'Split DX', color:'text-emerald-300' },
                { label:'Moisture Removal', value:'6.29', unit:'lbs/hr', color:'text-rose-300' },
                { label:'Condensate', value:'2.86', unit:'L/hr', color:'text-rose-300' },
                { label:'ADP', value:'52.0°F', unit:'', color:'text-cyan-300' },
                { label:'Supply Air', value:'55.5°F / 73 gr', unit:'', color:'text-cyan-300' },
              ].map(({label,value,unit,color})=>(
                <div key={label} className="bg-emerald-800 rounded-lg p-3">
                  <p className="text-[9px] text-emerald-300 uppercase tracking-wide">{label}</p>
                  <p className={`text-sm font-bold mt-1 ${color}`}>{value} <span className="text-[10px] font-normal text-emerald-300">{unit}</span></p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-100 border border-slate-300 rounded-xl p-4 text-[12px] text-slate-700 leading-relaxed">
            <p>
              <strong>Expert comparison (Kolkata vs Gangtok, same room and same internal profile):</strong> Gangtok requires substantially lower cooling capacity
              mainly because outdoor dry-bulb is much lower (82°F vs 95°F), which cuts ΔT and thus envelope + ventilation sensible loads. Even with altitude
              increasing the CLTD multiplier (k_alt ≈ 1.10), the net envelope sensible load still drops from 10,917 to 6,530 BTU/h. Grand Total Heat falls
              from 31,143 to 22,599 BTU/h, so selected capacity moves from 3.0 TR to 2.0 TR. Latent performance remains important in both cases, but Gangtok
              shows lower moisture removal demand (6.29 vs 8.67 lb/hr). Practical design takeaway: in Gangtok-like hill climates, prioritize right-sized capacity
              and airflow stability over oversizing for extreme heat; in Kolkata-like hot-humid climates, latent robustness and reheat/TFA strategy become more critical.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-800 text-white">
              <h4 className="text-sm font-bold">Quick Comparison Grid - Kolkata vs Gangtok (Same Room)</h4>
              <p className="text-[11px] text-slate-300 mt-0.5">All values shown from the worked examples above for direct side-by-side analysis.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200">
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">KPI</th>
                    <th className="px-3 py-2 text-right font-semibold text-indigo-700">Kolkata</th>
                    <th className="px-3 py-2 text-right font-semibold text-emerald-700">Gangtok</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">Delta (Gangtok - Kolkata)</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { kpi:'Outdoor DB', kol:'95°F', gan:'82°F', d:'−13°F' },
                    { kpi:'Outdoor humidity ratio', kol:'176.4 gr/lb', gan:'154.7 gr/lb', d:'-21.7 gr/lb' },
                    { kpi:'Atmospheric pressure', kol:'14.68 psia', gan:'12.11 psia', d:'-2.57 psia' },
                    { kpi:'Altitude correction factor (k_alt)', kol:'1.0005', gan:'1.102', d:'+0.1015' },
                    { kpi:'Envelope sensible (Q_env_s)', kol:'10,917 BTU/h', gan:'6,530 BTU/h', d:'-4,387 BTU/h' },
                    { kpi:'Internal sensible (Q_int_s)', kol:'7,911 BTU/h', gan:'7,911 BTU/h', d:'0' },
                    { kpi:'Vent sensible (Q_vs)', kol:'2,160 BTU/h', gan:'756 BTU/h', d:'-1,404 BTU/h' },
                    { kpi:'Vent latent (Q_vl)', kol:'7,147 BTU/h', gan:'4,624 BTU/h', d:'-2,523 BTU/h' },
                    { kpi:'ERSH', kol:'20,110 BTU/h', gan:'15,282 BTU/h', d:'-4,828 BTU/h' },
                    { kpi:'ERLH', kol:'3,122 BTU/h', gan:'2,744 BTU/h', d:'-378 BTU/h' },
                    { kpi:'CSH', kol:'21,946 BTU/h', gan:'15,925 BTU/h', d:'-6,021 BTU/h' },
                    { kpi:'CLH', kol:'9,197 BTU/h', gan:'6,674 BTU/h', d:'-2,523 BTU/h' },
                    { kpi:'Grand Total Heat (GTH)', kol:'31,143 BTU/h', gan:'22,599 BTU/h', d:'-8,544 BTU/h' },
                    { kpi:'Load TR (load-only)', kol:'2.60 TR', gan:'1.88 TR', d:'-0.72 TR' },
                    { kpi:'Required TR (+3%)', kol:'2.68 TR', gan:'1.94 TR', d:'-0.74 TR' },
                    { kpi:'Selected unit', kol:'3.0 TR', gan:'2.0 TR', d:'-1.0 TR size step' },
                    { kpi:'DSCFM', kol:'972 CFM', gan:'756 CFM', d:'-216 CFM' },
                    { kpi:'ADP', kol:'50.4°F', gan:'52.0°F', d:'+1.6°F' },
                    { kpi:'Supply air DB', kol:'54.1°F', gan:'55.5°F', d:'+1.4°F' },
                    { kpi:'Moisture removal', kol:'8.67 lb/hr', gan:'6.29 lb/hr', d:'-2.38 lb/hr' },
                    { kpi:'Condensate', kol:'3.94 L/hr', gan:'2.86 L/hr', d:'-1.08 L/hr' },
                  ].map((row, i) => (
                    <tr key={row.kpi} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="px-3 py-1.5 font-semibold text-slate-700">{row.kpi}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-indigo-700">{row.kol}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-emerald-700">{row.gan}</td>
                      <td className={`px-3 py-1.5 text-right font-mono font-semibold ${row.d.startsWith('-') ? 'text-green-700' : row.d.startsWith('+') ? 'text-amber-700' : 'text-slate-600'}`}>{row.d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </CardContent>
      </Card>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ── OBSOLETE METHODS ────────────────────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-gray-700 text-white">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-yellow-400" />
            <div>
              <CardTitle>Older Calculation Methods — Not Used Here & Why</CardTitle>
              <CardDescription className="text-gray-300">Historical context and engineering rationale for method selection</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-4 text-sm">
          <div className="space-y-3">

            {[
              {
                name: 'TETD/TA — Total Equivalent Temperature Differential / Time Averaging',
                era: 'ASHRAE 1967–1985',
                status: '❌ Obsolete',
                statusColor: 'text-red-600 bg-red-50',
                why: `The original ASHRAE hand-calculation method before CLTD. TETD/TA required separate time-averaging of heat stored in walls
to estimate delayed cooling load. Tables were computed for specific construction types and latitudes.
Replaced by CLTD/CLF in 1979 which was simpler to apply. This engine uses CLTD — not TETD.`,
              },
              {
                name: 'CLTD/CLF/SCL — Cooling Load Temperature Difference / Cooling Load Factor',
                era: 'ASHRAE 1979–1997 (Fundamentals Ch. 26)',
                status: '✅ Used in this engine',
                statusColor: 'text-green-700 bg-green-50',
                why: `This is the method implemented here. Tabulated CLTD values plus four correction factors give a fast, accurate 
estimate suitable for preliminary and final design of most commercial buildings. The 1997 version is used 
because it includes comprehensive tables for walls, roofs, and partitions with orientation/LM corrections.
Limitation: tables are pre-computed for standard constructions — atypical wall assemblies need adjustments.`,
              },
              {
                name: 'TFM — Transfer Function Method',
                era: 'ASHRAE 1972–2001',
                status: '⚠ Superseded',
                statusColor: 'text-yellow-700 bg-yellow-50',
                why: `TFM uses Z-transform response factors (CTF — Conduction Transfer Functions) to model exact thermal
storage in each wall layer. More accurate than CLTD for heavyweight constructions and 24-hr load profiling.
NOT used here because: (1) requires full construction assembly data per element — impractical for a fast
calculator, (2) results are nearly identical to CLTD for typical commercial constructions,
(3) ASHRAE replaced TFM with RTS in 2001 anyway.`,
              },
              {
                name: 'RTS — Radiant Time Series',
                era: 'ASHRAE Fundamentals 2001 onwards (Ch. 18)',
                status: '⚠ More accurate — not yet implemented',
                statusColor: 'text-yellow-700 bg-yellow-50',
                why: `RTS is the current ASHRAE recommended method. It separates radiant heat (solar, lights, people radiant fraction)
from convective heat and applies radiant time series coefficients to model time-delayed conversion from 
radiant energy to cooling load. More accurate than CLTD for: (a) heavyweight concrete/masonry buildings,
(b) dynamic hourly peak loads, (c) ASHRAE 90.1 compliance documentation.
NOT implemented here because: requires 24-hr solar position data, full construction thermal properties,
and 24-hr radiant time factor tables — significantly higher input burden for a field-use tool.
For final detailed design, cross-check critical rooms with an RTS-capable tool (Carrier HAP, Trane Trace).`,
              },
              {
                name: 'Hardcoded People Load (245/205 BTU/h — Office Only)',
                era: 'Earlier versions of this engine',
                status: '🔧 Fixed — replaced with activity type table',
                statusColor: 'text-blue-700 bg-blue-50',
                why: `Prior code in internalGains.ts used PEOPLE_SENSIBLE_LOAD = 245 and PEOPLE_LATENT_LOAD = 205 
for ALL room types. This is only correct for office work at 75°F. A gym with the same code 
would massively underestimate latent load (actual 1 270 BTU/h vs 205 BTU/h — 6× error!).
Fixed by adding the ACTIVITY_TYPES lookup table with 10 categories from ASHRAE 2017 Ch. 18 Table 2.
Users must now select occupancy type per room — default remains 'office' for backward compatibility.`,
              },
              {
                name: 'Ventilation-Only Moisture Management',
                era: 'Earlier versions of this engine',
                status: '🔧 Fixed — now uses total coil latent',
                statusColor: 'text-blue-700 bg-blue-50',
                why: `Prior code: calculateMoistureManagement(vent.cfm, outdoorW, indoorW)
computed moisture removal from ventilation air only, ignoring people latent and infiltration latent.
Example: 10 people × 205 BTU/h = 2 050 BTU/h latent from people alone — omitting this gave a
condensate rate that was 30–50% too low for occupied rooms.
Fixed: ṁ_water = CLH / 1061 — uses total coil latent, capturing all sources.`,
              },
              {
                name: 'Reheat using Room Loads (ERSH/ERLH)',
                era: 'Earlier versions of this engine',
                status: '🔧 Fixed — now uses coil loads (CSH/CLH)',
                statusColor: 'text-blue-700 bg-blue-50',
                why: `Prior code: calculateReheat(ersh, erlh)
The room SHR = ERSH/ERTH does not include the OA coil portion. In high-OA applications 
(hospitals, labs, humid climates), the outdoor air latent pushes the actual coil SHR much lower.
Using room loads alone can falsely show "no reheat" when the coil SHR including OA requires it.
Fixed: calculateReheat(coilSensible, coilLatent) — uses GSHF (Grand SHF) which is the true 
supply-air SHR including all outdoor air contributions.`,
              },
              {
                name: 'Fixed People Load CLF (Cooling Load Factor for People)',
                era: 'Not implemented',
                status: '⚠ Simplification retained',
                statusColor: 'text-yellow-700 bg-yellow-50',
                why: `ASHRAE CLTD/CLF method provides CLF factors for people loads to account for radiant body heat
being absorbed by room mass before becoming a cooling load. For office occupancy: CLF ≈ 0.79–1.00 
depending on hours of occupancy. This engine applies CLF = 1.0 (all people heat immediate).
This is conservative (slightly oversizes equipment) and is acceptable for typical commercial design.
For theatre/cinema where occupancy starts and stops, applying CLF would reduce peak loads meaningfully.`,
              },
              {
                name: 'Lighting CLF (time-lag for radiant lighting heat)',
                era: 'Part of CLTD/CLF method — not implemented',
                status: '⚠ Simplification retained',
                statusColor: 'text-yellow-700 bg-yellow-50',
                why: `ASHRAE CLF for lighting accounts for the fraction of lighting heat that is radiant (stored in 
room mass) vs convective (immediately a cooling load). CLF_lights ≈ 0.74–1.00 for offices.
This engine uses CLF_lights = 1.0 (all lighting heat is immediate). Conservative — oversizes by 
~5–10% for heavyweight spaces. Acceptable for most commercial design; LED fixtures are primarily
convective, making CLF < 1.0 even less significant.`,
              },
            ].map((m, i) => (
              <div key={i} className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex items-start justify-between px-4 py-3 bg-gray-50">
                  <div>
                    <p className="font-bold text-sm text-gray-900">{m.name}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">{m.era}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ml-3 ${m.statusColor}`}>{m.status}</span>
                </div>
                <div className="px-4 py-3 bg-white">
                  <p className="text-[11px] text-gray-600 leading-relaxed whitespace-pre-line">{m.why}</p>
                </div>
              </div>
            ))}

          </div>
        </CardContent>
      </Card>
      <Card className="border-none shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Info className="w-6 h-6 text-gray-500" />
            <div>
              <CardTitle>Assumptions, Constants & Known Limitations</CardTitle>
              <CardDescription>Engineering assumptions baked into the calculation engine</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border border-gray-200 rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-3 py-2 text-left font-bold text-gray-700">Parameter</th>
                  <th className="px-3 py-2 text-left font-bold text-gray-700">Value / Assumption</th>
                  <th className="px-3 py-2 text-left font-bold text-gray-700">Source / Remark</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { p: 'Bypass Factor (BF)',         v: '0.15',                       r: 'Fixed 0.15 for all system types; reference ranges vary by coil (see Step 4)' },
                  { p: 'Duct gain',                  v: '2% of ERSH',                 r: 'Industry rule; increase for long duct runs' },
                  { p: 'Fan heat gain',               v: '3% of ERSH',                 r: 'Typical supply fan efficiency assumption' },
                  { p: 'Safety factors',              v: 's_s=10% ERSH, s_l=5% ERLH, s_o=3% govTR', r: 'Applied in two stages — room loads then equipment sizing (see Step 5 & 7)' },
                  { p: 'CLTD tables',                v: 'ASHRAE 1997 Ch. 26',          r: '⚠ Pre-RTS method; RTS (2001+) is more accurate for detailed design' },
                  { p: 'SHGF tables',                v: 'ASHRAE 40°N, July',           r: 'Fixed orientation table; latitude not adjusted dynamically' },
                  { p: 'CLF for glass',              v: 'Not applied (1.0)',           r: 'Engine applies no cooling-load factor; solar = A × SHGF × SC, with SC = SHGC / 0.87' },
                  { p: 'People loads',               v: 'ASHRAE 2017 Ch.18 Table 2',   r: 'At 75°F room temp; values decrease at lower room temps' },
                  { p: 'Latent heat of vaporisation',v: '1061 BTU/lb',                 r: 'ASHRAE standard — consistent with 0.68 latent constant derivation (60×0.075×1061/7000 = 0.682)' },
                  { p: 'CFM/ton rule',               v: '400 CFM/ton',                 r: 'Sanity ratio only — not a sizing input. VRF / TFA systems may differ significantly' },
                  { p: 'Sensible heat factor',       v: '1.08 BTU·min/(h·CFM·°F)',     r: 'Standard at sea level; altitude-corrected via P_atm ratio' },
                  { p: 'Latent heat factor',         v: '0.68 BTU·min/(h·CFM·gr/lb)',  r: 'Standard at sea level' },
                  { p: 'Psychrometric equation',     v: 'ASHRAE 2017 (Hyland–Wexler)', r: 'Full ln(P_ws) saturation-pressure correlation, Handbook Ch. 1' },
                ].map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-1.5 font-semibold text-gray-700">{row.p}</td>
                    <td className="px-3 py-1.5 font-mono text-gray-700">{row.v}</td>
                    <td className="px-3 py-1.5 text-gray-500">{row.r}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200 text-[11px] text-yellow-900 flex gap-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-yellow-600" />
            <div>
              <strong>CLTD vs RTS:</strong> The CLTD/SHGF/CLF tables in this engine are from ASHRAE 1997.
              ASHRAE deprecated them in 2001 in favour of the Radiant Time Series (RTS) method which better models
              time-delayed radiant-to-convective conversion. For detailed design documentation or ASHRAE 90.1 compliance,
              a full RTS calculation using construction thermal mass data is recommended.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── ASHRAE References ───────────────────────────────────────────── */}
      <Card className="border-none shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-indigo-600" />
            <div>
              <CardTitle>ASHRAE References</CardTitle>
              <CardDescription>Standards and handbooks this engine is based on</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-xs text-gray-600">
            {[
              'ASHRAE Fundamentals 2017, Chapter 1 — Psychrometrics',
              'ASHRAE Fundamentals 2017, Chapter 18 — Nonresidential Cooling and Heating Load Calculations',
              'ASHRAE Fundamentals 1997, Chapter 26 — Cooling and Heating Load Calculations (CLTD/CLF/SCL tables)',
              'ASHRAE Fundamentals 2017, Chapter 17 — Residential Cooling and Heating Load Calculations',
              'ASHRAE Standard 62.1-2022 — Ventilation for Acceptable Indoor Air Quality',
              'ASHRAE Standard 55-2020 — Thermal Environmental Conditions for Human Occupancy',
              'Carrier System Design Manual, Part 1 — Load Estimating (ADP/GSHF method)',
              'Trane Air Conditioning Manual — Chapter 2 (Psychrometrics, BF, GSHF)',
            ].map((ref) => (
              <li key={ref} className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 mt-1.5 bg-indigo-400 rounded-full shrink-0" />
                {ref}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="text-center pt-8">
        <p className="text-[10px] text-gray-400 uppercase tracking-widest">HVAC Load Master • Engineering Documentation • v2.1 • ASHRAE 2017</p>
      </div>
      </div>
    </div>
  );
}
