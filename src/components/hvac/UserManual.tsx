import { useState } from 'react';
import {
  BookOpen, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle,
  Lightbulb, ArrowRight, Building2, Wind, Zap, Thermometer, Users,
  FileText, Settings, Calculator, Layers, Wrench, Package, RefreshCw,
} from 'lucide-react';

// ─── Shared mini-components ───────────────────────────────────────────────────

function SysTag({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${color}`}>
      {label}
    </span>
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold shrink-0">
      {n}
    </span>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
      <Lightbulb className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
      <span>{children}</span>
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-500" />
      <span>{children}</span>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
      <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-blue-500" />
      <span>{children}</span>
    </div>
  );
}

function SectionCard({
  id, title, badge, badgeColor, icon: Icon, children, defaultOpen = false,
}: {
  id: string; title: string; badge: string; badgeColor: string;
  icon: React.ElementType; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div id={id} className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 px-6 py-4 bg-gradient-to-r from-gray-50 to-white hover:from-blue-50 hover:to-white transition-colors text-left"
      >
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-100 shrink-0">
          <Icon className="w-5 h-5 text-blue-700" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-bold text-gray-900">{title}</h3>
            <SysTag label={badge} color={badgeColor} />
          </div>
        </div>
        {open ? <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" /> : <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" />}
      </button>
      {open && <div className="px-6 pb-6 pt-2 space-y-5">{children}</div>}
    </div>
  );
}

function WorkflowStep({ n, label, detail }: { n: number; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3">
      <StepBadge n={n} />
      <div>
        <p className="text-sm font-semibold text-gray-800">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{detail}</p>
      </div>
    </div>
  );
}

function InputTable({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-100">
            <th className="px-3 py-2 text-left font-semibold text-gray-600">Parameter</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-600">Value</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-600">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([param, val, note], i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="px-3 py-1.5 text-gray-700">{param}</td>
              <td className="px-3 py-1.5 text-right font-mono font-bold text-blue-700">{val}</td>
              <td className="px-3 py-1.5 text-gray-500">{note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultTable({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-emerald-200">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-emerald-50">
            <th className="px-3 py-2 text-left font-semibold text-emerald-700">Room / Zone</th>
            <th className="px-3 py-2 text-right font-semibold text-emerald-700">Governing TR</th>
            <th className="px-3 py-2 text-right font-semibold text-emerald-700">Design CFM</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([room, tr, cfm], i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-emerald-50/30'}>
              <td className="px-3 py-1.5 text-gray-700 font-medium">{room}</td>
              <td className="px-3 py-1.5 text-right font-mono font-bold text-emerald-700">{tr}</td>
              <td className="px-3 py-1.5 text-right font-mono text-gray-600">{cfm}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function UserManual() {
  const toc = [
    { id: 'quick-start',   label: 'Quick Start Workflow' },
    { id: 'design-mode',   label: 'Design Mode & Supply Basis' },
    { id: 'equip-library', label: 'Equipment Library' },
    { id: 'equip-guide',   label: 'Equipment Selection Guide' },
    { id: 'vrf',          label: 'VRF System' },
    { id: 'chiller',      label: 'Chiller Plant' },
    { id: 'package',      label: 'Package Unit' },
    { id: 'ductable',     label: 'Ductable Split' },
    { id: 'split',        label: 'Split Unit' },
    { id: 'ahu',          label: 'AHU System' },
    { id: 'doas',         label: 'DOAS (Ventilation)' },
    { id: 'tips',         label: 'Design Tips' },
  ];

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-16">

      {/* ── Header ── */}
      <div className="rounded-2xl bg-gradient-to-br from-blue-900 to-blue-700 text-white p-8 shadow-xl">
        <div className="flex items-start gap-4">
          <BookOpen className="w-10 h-10 text-blue-300 shrink-0 mt-1" />
          <div>
            <h2 className="text-3xl font-bold mb-1">User Manual</h2>
            <p className="text-blue-200 text-sm leading-relaxed max-w-2xl">
              Practical step-by-step guide for performing HVAC load calculations, selecting equipment,
              and building a complete HVAC plant — with worked examples for every system type.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              {['VRF','Chiller','Package','Ductable Split','Split','AHU','DOAS'].map(t => (
                <span key={t} className="text-[11px] bg-white/15 border border-white/20 rounded-full px-2.5 py-0.5 font-medium">{t}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Table of Contents ── */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Contents</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {toc.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className="flex items-center gap-2 text-left text-sm text-blue-700 hover:text-blue-900 hover:bg-blue-50 rounded-lg px-3 py-1.5 transition-colors"
            >
              <ArrowRight className="w-3 h-3 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          SECTION 0 — Quick Start Workflow
      ════════════════════════════════════════════════════════════════════════ */}
      <div id="quick-start" className="rounded-2xl border-2 border-blue-200 bg-blue-50 p-6 shadow-sm">
        <h3 className="text-lg font-bold text-blue-900 mb-4 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-blue-600" /> Universal 5-Step Workflow
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {[
            { n:1, page:'Load Calculator', desc:'Enter project design conditions (outdoor/indoor DB, RH, altitude).' },
            { n:2, page:'Load Calculator', desc:'Create zones & rooms. Enter dimensions, people, lights, equipment, envelope elements.' },
            { n:3, page:'HVAC Systems', desc:'Create HVAC systems, add zones under each system, assign rooms to zones.' },
            { n:4, page:'Equipment Selection', desc:'Pick IDU/ODU for each zone. Use "Push to LC" to sync with Load Calculator.' },
            { n:5, page:'Reports', desc:'Generate PDF load report with System → Zone → Room hierarchy + installed equipment schedule.' },
          ].map(({ n, page, desc }) => (
            <div key={n} className="flex flex-col gap-2 bg-white rounded-xl p-4 border border-blue-100 shadow-sm">
              <div className="flex items-center gap-2">
                <StepBadge n={n} />
                <span className="text-xs font-bold text-blue-800">{page}</span>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <Tip>Always set project design conditions first (Step 1) — all room load calculations depend on these values.</Tip>
          <Note>The HVAC Systems page is the master for System→Zone→Room hierarchy. Rooms assigned there are automatically visible in Load Calculator and Equipment Selection.</Note>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          DESIGN MODE & SUPPLY-AIR BASIS  (added 2026-06-10)
      ════════════════════════════════════════════════════════════════════════ */}
      <SectionCard
        id="design-mode"
        title="Design Mode & Supply-Air Basis"
        badge="SIZING"
        badgeColor="bg-sky-100 text-sky-700"
        icon={Wind}
        defaultOpen={false}
      >
        <p className="text-sm text-gray-600">
          One project-level <strong>Design Mode</strong> controls two things at once: how cold the cooling coil runs
          (the apparatus dew-point / ADP floor) and how each room's supply airflow is sized by default. You set it in
          <strong> Load Calculator → (pick a project) → Edit ✏️ → "Design Mode"</strong>.
        </p>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-100">
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Design Mode</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">Coil ADP floor</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">Default airflow</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Pick it for</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Comfort', '54 °F', 'DSCFM', 'Offices, hotels, normal comfort spaces (7 °C CHW, ~55 °F supply, ~400 CFM/TR).'],
                ['Dehumidification', '44 / 42 °F', 'DSCFM', 'Humid / latent-heavy / process rooms that need a cold coil.'],
                ['Air-change', '54 °F', 'ACH', 'Rooms sized by ventilation / air-change rate, not cooling load.'],
              ].map(([m, adp, air, use], i) => (
                <tr key={m} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-1.5 font-semibold text-gray-800">{m}</td>
                  <td className="px-3 py-1.5 text-center font-mono font-bold text-sky-700">{adp}</td>
                  <td className="px-3 py-1.5 text-center font-mono font-bold text-sky-700">{air}</td>
                  <td className="px-3 py-1.5 text-gray-600">{use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mt-2">DSCFM vs ACH — the two airflow bases</p>
        <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
          <li><strong>Dehumidified (DSCFM)</strong> — sizes airflow on the cooling/dehumidification load
            (<span className="font-mono text-xs">CSH ÷ (1.08 × (1−BF) × ΔT)</span>), floored only at the fresh-air OA. The ACH preset is a
            <em> reference</em>, not a floor — the dehumidified figure governs even if it is smaller.</li>
          <li><strong>Air changes (ACH)</strong> — sizes airflow on the air-change preset (e.g. 10 ACH) for the activity type.</li>
        </ul>
        <Note>It is EITHER/OR — the app does <strong>not</strong> take the larger of the two. Whichever basis the room is on is the airflow it gets (never below the fresh-air OA).</Note>

        <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mt-2">Per-room override</p>
        <p className="text-sm text-gray-600">
          Every room inherits the project Design Mode's airflow basis, but you can override one room in
          <strong> Load Calculator → room → Step 1 Inputs → "Supply Basis"</strong> (DSCFM ⇄ Air changes). Example: a
          Comfort project (54 °F coil) with one warehouse room flipped to ACH — that room keeps the 54 °F coil but gets
          the air-change airflow.
        </p>

        <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mt-2">Two warnings you may see (Supply-Air Basis box)</p>
        <div className="space-y-2">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <strong>⚠ "Latent not met at ADP X °F"</strong> — the coil at that temperature can't dry the room. It shows the airflow the
            moisture <em>would</em> need and the implied reheat duty. Action: add <strong>reheat</strong> or a <strong>DOAS / desiccant</strong>;
            do not just raise the airflow. (Shows on both DSCFM and ACH.)
          </div>
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
            <strong>⚠ "Air-change / OA check"</strong> (DSCFM only) — the dehumidified airflow dropped below the ACH-preset airflow, so the
            fixed fresh-air (OA FACPH) is now a bigger % of a smaller supply. Action: confirm ventilation / air distribution is still OK, or
            switch that room to the ACH basis.
          </div>
        </div>

        <Warn>Changing Design Mode (or a room's basis) only updates the live view. Click <strong>"Recompute &amp; save all"</strong> (Global Settings) so the saved numbers used by PDF, Excel and Equipment Selection match. Take a <strong>backup</strong> first.</Warn>
        <Tip>Legacy projects created before this feature keep their original behaviour until you open Edit and pick a Design Mode.</Tip>
      </SectionCard>

      {/* ════════════════════════════════════════════════════════════════════════
          GLOBAL EQUIPMENT LIBRARY
      ════════════════════════════════════════════════════════════════════════ */}
      <SectionCard
        id="equip-library"
        title="Global Equipment Library"
        badge="SETUP"
        badgeColor="bg-violet-100 text-violet-700"
        icon={Package}
        defaultOpen
      >
        <p className="text-sm text-gray-600 leading-relaxed">
          The <strong>Global Equipment Library</strong> is the project-agnostic catalog of equipment models that
          populates the selection dropdowns in Equipment Selection. It is shared across all projects — models added
          here are available in every project. Access it via <strong>Equipment Library</strong> in the sidebar.
        </p>

        {/* ── Overview ── */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2">
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Library Overview</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { title: 'Pre-seeded Catalog', desc: 'The library ships with a built-in catalog (VRF IDUs/ODUs, Chillers, AHUs, Package units from major brands). These are loaded automatically on first use.' },
              { title: 'Sync New Items', desc: 'When the built-in catalog is updated with new models, click "Sync New Items" to push the additions to the live library without overwriting existing or custom entries.' },
              { title: 'Custom Models', desc: 'Add manufacturer models not in the built-in catalog — either one at a time via the Add Equipment form, or in bulk via CSV import.' },
            ].map(({ title, desc }) => (
              <div key={title} className="bg-white rounded-lg border border-gray-100 p-3 space-y-1">
                <p className="text-xs font-bold text-blue-700">{title}</p>
                <p className="text-xs text-gray-600 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Sync New Items ── */}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
          <p className="text-xs font-bold text-emerald-800 uppercase tracking-wide flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Sync New Items — Push Catalog Updates to the Library
          </p>
          <p className="text-xs text-gray-700 leading-relaxed">
            When new equipment models are added to the app's built-in catalog (for example, Voltas ACDS chillers),
            they do not appear automatically in the live library. Click <strong>"Sync New Items"</strong> in the
            library toolbar to add only the new entries — existing library items and custom models are never overwritten.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Note>Sync New Items is safe to run repeatedly. It deduplicates by natural key (brand + type + sub-type + model series + capacity) and skips models already in the library.</Note>
            <Tip>After any app update that mentions new catalog entries, run Sync New Items so the new models are available for all users in Equipment Selection.</Tip>
          </div>
        </div>

        {/* ── Adding Equipment Manually ── */}
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
          <p className="text-xs font-bold text-blue-800 uppercase tracking-wide flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5" /> Adding Equipment Manually — Add Equipment Form
          </p>
          <p className="text-xs text-gray-700 leading-relaxed">
            Click <strong>"+ Add Equipment"</strong> in the library toolbar. The form is context-aware —
            sub-type options and optional fields change based on the Type you select first.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-white rounded-lg border border-blue-100 p-3 space-y-2">
              <p className="text-xs font-bold text-blue-700">1 — Select Type</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                Click one of the type pills: <em>VRF-IDU, VRF-ODU, Chiller, AHU, Package, DuctableSplit, Split, DOAS, ChillerIDU, CoolingTower.</em> The sub-type list and visible fields update immediately.
              </p>
            </div>
            <div className="bg-white rounded-lg border border-blue-100 p-3 space-y-2">
              <p className="text-xs font-bold text-blue-700">2 — Select Sub-type</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                Choose from context-filtered options. Example: VRF-IDU → Wall-mounted, 4-way Cassette, Concealed Ducted (Low / Mid / High Static). Changing Type resets the sub-type.
              </p>
            </div>
            <div className="bg-white rounded-lg border border-blue-100 p-3 space-y-2">
              <p className="text-xs font-bold text-blue-700">3 — Fill Core Fields</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                Brand, Model Series, Model Number, Capacity (TR), Rated CFM. Units are shown inside each input field — no separate label lookup needed.
              </p>
            </div>
            <div className="bg-white rounded-lg border border-blue-100 p-3 space-y-2">
              <p className="text-xs font-bold text-blue-700">4 — Fill Type-Specific Fields</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                <strong>External Static Pressure (Pa)</strong> appears for ducted types (AHU, Package, Ductable Split, DOAS, ChillerIDU). <strong>EER / COP</strong> appears for Chiller, Package, VRF-ODU. VRF-ODU also has Min/Max Capacity % for inverter range.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-blue-200">
            <table className="w-full text-xs">
              <thead><tr className="bg-blue-100">
                <th className="px-3 py-2 text-left font-semibold text-blue-800">Field</th>
                <th className="px-3 py-2 text-center font-semibold text-blue-800">Unit</th>
                <th className="px-3 py-2 text-left font-semibold text-blue-800">Notes</th>
              </tr></thead>
              <tbody>
                {[
                  ['Capacity', 'TR', 'Nameplate cooling capacity at AHRI rated conditions'],
                  ['Rated CFM', 'CFM', 'Supply airflow at nominal conditions (0 Pa static for wall-mounts)'],
                  ['External Static Pressure', 'Pa', 'Rated at this static for ducted units — verify against duct design'],
                  ['Power Input', 'kW', 'Rated electrical input; used for MCB / cable sizing'],
                  ['EER', 'BTU/W·h', 'Energy Efficiency Ratio at rated conditions'],
                  ['COP', '—', 'Coefficient of Performance — typically 2.8–4.2 for modern inverter units'],
                  ['Min / Max Capacity %', '%', 'VRF-ODU only — inverter modulation range (e.g. 25%–115%)'],
                  ['Refrigerant', '—', 'R32, R410A, R407C, R22 — select from dropdown or type custom value'],
                ].map(([field, unit, notes], i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-blue-50/30'}>
                    <td className="px-3 py-1.5 font-semibold text-gray-800">{field}</td>
                    <td className="px-3 py-1.5 font-mono text-blue-700 text-center">{unit}</td>
                    <td className="px-3 py-1.5 text-gray-600">{notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── CSV Import ── */}
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-3">
          <p className="text-xs font-bold text-orange-800 uppercase tracking-wide flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Bulk Import via CSV — Two Supported Formats
          </p>
          <p className="text-xs text-gray-700 leading-relaxed">
            Click <strong>"Upload CSV"</strong> to import multiple models at once. The importer auto-detects
            the format by reading the header row — no manual format selection needed.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-white rounded-lg border border-orange-100 p-3 space-y-2">
              <p className="text-xs font-bold text-orange-700">Format 1 — App Template</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                Header row starts with <strong>brand</strong> as the first column. Download the template from the
                library toolbar, fill it in, and upload. Required columns: brand, type, subType, modelSeries, modelNo,
                capacityTR, ratedAirflowCFM, refrigerant.
              </p>
              <p className="text-[11px] font-mono bg-orange-50 rounded px-2 py-1 text-gray-700">brand,type,subType,modelSeries,modelNo,capacityTR,…</p>
            </div>
            <div className="bg-white rounded-lg border border-orange-100 p-3 space-y-2">
              <p className="text-xs font-bold text-orange-700">Format 2 — Manufacturer Spec Sheet</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                Use the manufacturer's own CSV export directly. The importer maps by header name (e.g.
                <em> product_series, model_no, kw_cool, refrigerant_type</em>) and derives type/sub-type from
                the product series name automatically.
              </p>
              <p className="text-[11px] font-mono bg-orange-50 rounded px-2 py-1 text-gray-700">product_series,model_no,kw_cool,refrigerant_type,…</p>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-orange-200">
            <table className="w-full text-xs">
              <thead><tr className="bg-orange-100">
                <th className="px-3 py-2 text-left font-semibold text-orange-800">Import result message</th>
                <th className="px-3 py-2 text-left font-semibold text-orange-800">What it means</th>
              </tr></thead>
              <tbody>
                {[
                  ['Added: N items', 'N new models were written to the library successfully.'],
                  ['Errors: N rows', 'N rows were skipped — missing required fields (capacity, brand, or model). Check the source CSV for blank cells in those columns.'],
                  ['Format: template / manufacturer', 'Confirms which parsing mode was used. If wrong, ensure the header row first column matches the expected label (brand for template).'],
                  ['0 added (all duplicates)', 'All rows already exist in the library — safe to re-upload without creating duplicates.'],
                ].map(([result, meaning], i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-orange-50/30'}>
                    <td className="px-3 py-1.5 font-mono font-bold text-orange-800">{result}</td>
                    <td className="px-3 py-1.5 text-gray-600">{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Warn>Manufacturer-format CSVs must include at least: a product series column, a model number column, and a cooling capacity column (kW or TR). Rows missing capacity are skipped with an error count.</Warn>
        </div>

        {/* ── Filters ── */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2">
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Using the Cascading Filters</p>
          <p className="text-xs text-gray-600 leading-relaxed">
            The library has four cascading filters: Brand → Type → Sub-type → Refrigerant. Each dropdown is
            filtered by the selections above it — choosing a brand first narrows the type list to only types
            that brand offers. Use the search bar to find a specific model number across all brands.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Tip>To review all Chiller entries across all brands, set Type = "Chiller" and leave Brand empty. The list shows only chiller models, sorted by brand then capacity.</Tip>
            <Note>The search bar matches across all fields — searching "R32" returns all models that use R32 refrigerant regardless of brand or type.</Note>
          </div>
        </div>
      </SectionCard>

      {/* ════════════════════════════════════════════════════════════════════════
          EQUIPMENT SELECTION — COMPLETE GUIDE
      ════════════════════════════════════════════════════════════════════════ */}
      <SectionCard
        id="equip-guide"
        title="Equipment Selection — Complete Step-by-Step Guide"
        badge="ALL SYSTEMS"
        badgeColor="bg-slate-100 text-slate-700"
        icon={Wrench}
        defaultOpen
      >
        {/* ── Overview ── */}
        <p className="text-sm text-gray-600 leading-relaxed">
          The <strong>Equipment Selection</strong> page is where you convert calculated cooling loads into a real, submittable
          equipment schedule. You assign specific manufacturer IDUs (indoor units) to every zone, select outdoor or central
          plant equipment (ODU, Chiller, Cooling Tower, AHU), and confirm that installed capacity covers the governing TR
          for each zone. The result populates <em>Section&nbsp;3</em> (Zone Summary) and <em>Section&nbsp;5</em> (Equipment
          Schedule) of the PDF load report.
        </p>

        {/* ── Pre-requisites ── */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
          <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">Before you start — 3 mandatory pre-requisites</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { n: 'A', title: 'Active Project', desc: 'Select a project from the Dashboard first. The project name appears in the blue sidebar banner. Equipment Selection has no project picker — it reads the active project.' },
              { n: 'B', title: 'Load Calculations Done', desc: 'Every room must have a saved Governing TR. Go to Load Calculator → Calculate All before using Equipment Selection. Zones without TR values show "—" and cannot be sized.' },
              { n: 'C', title: 'HVAC Systems Hierarchy', desc: 'Create your System → Zone → Room tree in the HVAC Systems page first. Equipment Selection reads that hierarchy. If no systems exist, only a blank system list appears.' },
            ].map(({ n, title, desc }) => (
              <div key={n} className="bg-white rounded-lg border border-amber-100 p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">{n}</span>
                  <p className="text-xs font-bold text-amber-800">{title}</p>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Page Layout Overview ── */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2">
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Understanding the Page Layout</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { area: 'Left Panel — System Tree', desc: 'Lists all HVAC systems in the project. Click a system to expand it and see its zones. Click a zone to expand and see assigned rooms.' },
              { area: 'Centre — Zone / Room Cards', desc: 'Each zone card shows: Governing TR, Design CFM, number of rooms, IDU status chip (Not Selected → green Fits → amber Oversized → red Under). Expand a zone to see per-room loads.' },
              { area: 'Top Toolbar', desc: 'Buttons: Sync from LC (refresh loads), Push to LC (write Inst. TR back), View toggle (System / Zone view), PDF Report button.' },
            ].map(({ area, desc }) => (
              <div key={area} className="bg-white rounded-lg border border-gray-100 p-3 space-y-1">
                <p className="text-xs font-bold text-blue-700">{area}</p>
                <p className="text-xs text-gray-600 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ═══ STEPS ═══ */}
        <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mt-2">Detailed Step-by-Step Workflow</p>

        {/* STEP 1 */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-3 bg-blue-700 px-4 py-3">
            <StepBadge n={1} />
            <p className="text-sm font-bold text-white">Open Equipment Selection and Select Your System</p>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-gray-600 leading-relaxed">
              Click <strong>Equipment Selection</strong> in the sidebar. The left panel lists every HVAC system
              belonging to your active project. If the list is empty, no HVAC systems exist yet — go to
              <strong> HVAC Systems</strong> first and build the System → Zone → Room hierarchy, then return here.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Note>Click a system name to expand it. Each expanded system shows zone cards with the Governing TR and Design CFM pulled live from Load Calculator results.</Note>
              <Tip>Use the <strong>System View / Zone View</strong> toggle in the toolbar to switch between a collapsible tree and a flat zone list. Flat view is faster when you have many zones across many systems.</Tip>
            </div>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead><tr className="bg-gray-100">
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">What you see</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">What it means</th>
                </tr></thead>
                <tbody>
                  {[
                    ['System listed, no zones visible', 'System exists in HVAC Systems but no zones assigned yet — go to HVAC Systems to add zones.'],
                    ['Zone card shows "— TR"', 'Rooms in this zone have not been calculated yet — run Calculate All in Load Calculator.'],
                    ['Zone card shows a TR value', 'Ready for equipment selection. The number is the Governing TR you must meet or exceed.'],
                    ['Zone card shows "No rooms"', 'Zone was created but no rooms assigned. Assign rooms in HVAC Systems or via the Assign Rooms button in Equipment Selection.'],
                  ].map(([what, means], i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 py-2 font-medium text-gray-800">{what}</td>
                      <td className="px-3 py-2 text-gray-600">{means}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* STEP 2 */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-3 bg-blue-700 px-4 py-3">
            <StepBadge n={2} />
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-blue-200" />
              <p className="text-sm font-bold text-white">Sync Zones from Load Calculator (when needed)</p>
            </div>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-gray-600 leading-relaxed">
              If you recently recalculated rooms, added new rooms, or reassigned rooms in HVAC Systems,
              click <strong>Sync from LC</strong> in the toolbar. This refreshes zone loads and room lists
              without erasing any equipment data you have already entered.
            </p>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead><tr className="bg-gray-100">
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Scenario</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Action needed</th>
                </tr></thead>
                <tbody>
                  {[
                    ['Zone exists in HVAC Systems but not showing in Equipment Selection', 'Click Sync from LC'],
                    ['Room load changed after re-calculation in Load Calculator', 'Click Sync from LC — Governing TR updates immediately'],
                    ['New rooms added to a zone in HVAC Systems', 'Click Sync from LC — new rooms appear, zone TR recalculates'],
                    ['You just opened Equipment Selection for the first time on this project', 'Data loads automatically — Sync only needed if stale'],
                  ].map(([scen, act], i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 py-2 text-gray-700">{scen}</td>
                      <td className="px-3 py-2 font-medium text-blue-700">{act}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* STEP 3 */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-3 bg-blue-700 px-4 py-3">
            <StepBadge n={3} />
            <p className="text-sm font-bold text-white">Review Zone Load Summary — Know What You Need to Cover</p>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-gray-600 leading-relaxed">
              Before selecting any equipment, read the zone card numbers carefully. These are the design requirements
              your selected IDU must equal or exceed.
            </p>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead><tr className="bg-gray-100">
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Field on Zone Card</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">What it means</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Use it to…</th>
                </tr></thead>
                <tbody>
                  {[
                    ['Governing TR', 'max(Load TR from heat-gain calc, CFM TR where CFM TR = Design CFM ÷ 400). This is the minimum installed cooling capacity required.', 'Set the floor for IDU selection. Your Inst. TR must be ≥ this.'],
                    ['Design CFM', 'Total required supply airflow for the zone at peak load.', 'Verify the IDU rated CFM ≥ this value. CFM can govern even when TR is small.'],
                    ['Summer TR / Monsoon TR', 'Separate TR values for each season (if Monsoon enabled in project settings).', 'Confirm which season governs — Governing TR is the higher of the two.'],
                    ['No. of Rooms', 'Count of rooms assigned to this zone.', 'Sanity check — if fewer rooms than expected, a room assignment may be missing.'],
                    ['Winter Heating (BTU/h)', 'Heating load at outdoor winter design temperature.', 'For heat-pump IDUs: confirm heating capacity in the catalogue covers this figure.'],
                  ].map(([field, meaning, use], i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 py-2 font-semibold text-gray-800">{field}</td>
                      <td className="px-3 py-2 text-gray-600">{meaning}</td>
                      <td className="px-3 py-2 text-blue-700">{use}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1">
              <p className="text-xs font-bold text-slate-700">Governing TR formula</p>
              <p className="text-xs font-mono bg-white rounded px-3 py-2 border border-slate-200 text-slate-800 leading-relaxed">
                CFM TR = Design CFM ÷ 400<br />
                Governing TR = max(Load TR, CFM TR)<br />
                <span className="text-slate-400">Example: Load TR = 4.2, Design CFM = 2,000 → CFM TR = 5.0 → Governing TR = 5.0 TR</span>
              </p>
              <p className="text-xs text-gray-500">In high-ventilation spaces (conference rooms, hospitals, OTs with high ACH), CFM TR often exceeds Load TR. The unit must deliver the required airflow even when the thermal load is modest.</p>
            </div>
          </div>
        </div>

        {/* STEP 4 */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-3 bg-blue-700 px-4 py-3">
            <StepBadge n={4} />
            <p className="text-sm font-bold text-white">Select Indoor Unit (IDU) for Each Zone — Fill in the Form</p>
          </div>
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-600 leading-relaxed">
              Expand a zone card and click the <strong>pencil icon</strong> or <strong>"Select IDU"</strong> button.
              A selection panel opens. You can either pick a unit from the built-in Equipment Catalogue or enter
              custom make/model details manually. Fill in every field for a complete, submittable equipment schedule entry.
            </p>

            {/* Two-column form fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Required Fields</p>
                <InputTable rows={[
                  ['Manufacturer', 'Daikin / Mitsubishi / LG / Carrier…', 'Appears in Equipment Schedule PDF'],
                  ['Model Number', 'Exact catalogue code', 'e.g. FXSQ50A, PURY-EP200'],
                  ['IDU Subtype', 'See IDU type table below', 'Defines terminal type in report'],
                  ['Installed TR', 'Nameplate cooling capacity in TR', 'Must be ≥ Governing TR'],
                  ['Installed CFM', 'Rated supply airflow at nominal conditions', 'Should be ≥ Design CFM'],
                ]} />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Optional but Recommended</p>
                <InputTable rows={[
                  ['Heating Capacity', 'kW or BTU/h', 'Required for heat-pump IDUs in cold climates'],
                  ['Power Input (kW)', 'Rated electrical input at full load', 'Used for MCB / cable sizing'],
                  ['EER / COP', 'Efficiency at rated conditions', 'For energy compliance checks'],
                  ['Quantity', 'No. of identical units in this zone', 'If one zone has multiple IDUs'],
                  ['Notes', 'Location, piping circuit, tag no.', 'e.g. "Ground Floor East, VRF Circuit A"'],
                ]} />
              </div>
            </div>

            {/* IDU Subtype reference */}
            <div className="space-y-2">
              <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">IDU Subtype Selection Guide</p>
              <div className="overflow-x-auto rounded-lg border border-blue-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-blue-50">
                      <th className="px-3 py-2 text-left font-semibold text-blue-700">IDU Subtype</th>
                      <th className="px-3 py-2 text-left font-semibold text-blue-700">Typical Application</th>
                      <th className="px-3 py-2 text-right font-semibold text-blue-700">CFM Range</th>
                      <th className="px-3 py-2 text-left font-semibold text-blue-700">Best Paired With</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['Wall-mounted', 'Residential, small office, hotel rooms', '350–700', 'Split, VRF'],
                      ['4-way Cassette', 'Open-plan offices, retail', '500–1,400', 'VRF (primary choice for open plan)'],
                      ['1-way / 2-way Cassette', 'Perimeter or corridor applications', '350–800', 'VRF, Split'],
                      ['Concealed Ducted (Low Static)', 'False-ceiling spaces, short duct runs', '600–1,800', 'VRF, Ductable Split'],
                      ['Concealed Ducted (Mid Static)', 'Medium duct runs with supply/return grilles', '800–2,500', 'VRF, Ductable Split'],
                      ['Concealed Ducted (High Static)', 'Long duct runs, AHU-style zone distribution', '1,200–4,000', 'Ductable Split, VRF-FAHU'],
                      ['Floor-standing', 'Lobby perimeter, showroom, under-window', '400–1,200', 'VRF, Split'],
                      ['Fan Coil Unit (FCU)', 'Hotel rooms, apartments, chilled-water zones', '300–800', 'Chiller plant (CHW loop)'],
                      ['AHU (Air Handling Unit)', 'Central plant, hospitals, large zones', '1,000–50,000', 'Chiller, AHU-DX systems'],
                      ['TFA / FAHU', 'Fresh-air handling unit, DOAS terminal', '500–5,000', 'DOAS, hybrid VRF+DOAS'],
                    ].map(([type, app, cfm, paired], i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-blue-50/30'}>
                        <td className="px-3 py-2 font-semibold text-gray-800">{type}</td>
                        <td className="px-3 py-2 text-gray-600">{app}</td>
                        <td className="px-3 py-2 text-right font-mono text-blue-700">{cfm}</td>
                        <td className="px-3 py-2 text-gray-600">{paired}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Using the Catalogue */}
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2">
              <p className="text-xs font-bold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-blue-600" /> Using the Built-in Equipment Catalogue
              </p>
              <p className="text-xs text-gray-600 leading-relaxed">
                The catalogue contains pre-loaded IDU and ODU models for major brands. When you pick a model from the catalogue:
              </p>
              <div className="space-y-1.5">
                {[
                  ['Filter by Brand', 'Use the brand dropdown to narrow the list to one manufacturer.'],
                  ['Filter by Subtype', 'Select the IDU subtype first — the catalogue filters to matching unit types.'],
                  ['Fit Badge appears instantly', 'The catalogue shows a ✅ Fits / 🟡 Oversized / 🔴 Under badge next to each model based on Governing TR of the zone. Pick a ✅ Fits model.'],
                  ['Auto-fills TR and CFM', 'Selecting a catalogue model automatically fills Installed TR, CFM, and power from the catalogue data — no manual entry needed.'],
                  ['Custom override', 'You can override auto-filled values if your actual equipment differs from the catalogue (e.g. site derate, altitude correction).'],
                ].map(([step, detail]) => (
                  <div key={step} className="flex items-start gap-2 text-xs">
                    <ArrowRight className="w-3 h-3 mt-0.5 shrink-0 text-blue-500" />
                    <span><strong>{step}</strong> — {detail}</span>
                  </div>
                ))}
              </div>
            </div>

            <Tip>When entering custom model data (not from catalogue), always use the <strong>catalogue-rated conditions</strong> TR — typically at 35 °C outdoor / 27 °C indoor. At India peak summer (45 °C OA), derate by ~8–12%. Check the manufacturer selection software or catalogue correction tables for accuracy.</Tip>
          </div>
        </div>

        {/* STEP 5 */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-3 bg-blue-700 px-4 py-3">
            <StepBadge n={5} />
            <p className="text-sm font-bold text-white">Read the Status Badge — Every Zone Must Be Green Before Reporting</p>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-gray-600 leading-relaxed">
              After saving an IDU selection, the zone card updates instantly with a colour-coded status badge.
              <strong> All zones must show ✅ Fits before you generate the final report.</strong>
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4 space-y-2">
                <p className="text-sm font-bold text-emerald-700 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> ✅ Fits — Adequate
                </p>
                <p className="text-xs text-emerald-700 leading-relaxed">Inst. TR ≥ Gov. TR <strong>and</strong> Inst. CFM ≥ Design CFM. Equipment is correctly sized. Zone is clear for reporting.</p>
                <p className="text-[11px] font-mono bg-white rounded px-2 py-1 text-emerald-800 border border-emerald-200">Inst 5.0 TR ≥ Gov 4.6 TR ✓</p>
              </div>
              <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 space-y-2">
                <p className="text-sm font-bold text-amber-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> 🟡 Oversized
                </p>
                <p className="text-xs text-amber-700 leading-relaxed">Inst. TR exceeds Gov. TR by more than 30%. The unit delivers more capacity than the load needs. Acceptable but may waste money and reduce part-load efficiency.</p>
                <p className="text-[11px] font-mono bg-white rounded px-2 py-1 text-amber-800 border border-amber-200">Inst 8.0 TR, Gov 4.6 TR — 74% excess</p>
              </div>
              <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 space-y-2">
                <p className="text-sm font-bold text-red-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> 🔴 Under — Undersized
                </p>
                <p className="text-xs text-red-700 leading-relaxed">Inst. TR {'<'} Gov. TR or Inst. CFM {'<'} Design CFM. Equipment cannot maintain design indoor conditions at peak load. Must select a larger unit.</p>
                <p className="text-[11px] font-mono bg-white rounded px-2 py-1 text-red-800 border border-red-200">Inst 3.0 TR {'<'} Gov 4.6 TR ✗</p>
              </div>
            </div>
            <Warn>Never accept a 🔴 Under zone. A red zone means the space will be uncomfortably warm or humid on the design day. Select the next standard catalogue size up to bring it to ✅ Fits.</Warn>
          </div>
        </div>

        {/* STEP 6 */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-3 bg-blue-700 px-4 py-3">
            <StepBadge n={6} />
            <p className="text-sm font-bold text-white">Select Plant / Outdoor Equipment at System Level</p>
          </div>
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-600 leading-relaxed">
              After completing IDUs for all zones, scroll to the <strong>system-level header card</strong>.
              This is where you select outdoor or central plant equipment. The selection varies by system type —
              read the relevant sub-section below.
            </p>

            {/* VRF */}
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3">
              <p className="text-xs font-bold text-green-800 uppercase tracking-wide flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5" /> VRF System — ODU Selection with Diversity Factor
              </p>
              <p className="text-xs text-gray-700 leading-relaxed">
                At the system header card, click <strong>"Select ODU"</strong> or <strong>"Add Outdoor Unit"</strong>.
              </p>
              <div className="overflow-x-auto rounded-lg border border-green-200">
                <table className="w-full text-xs">
                  <thead><tr className="bg-green-100">
                    <th className="px-3 py-1.5 text-left font-semibold text-green-800">Field</th>
                    <th className="px-3 py-1.5 text-left font-semibold text-green-800">What to enter</th>
                    <th className="px-3 py-1.5 text-left font-semibold text-green-800">Guidance</th>
                  </tr></thead>
                  <tbody>
                    {[
                      ['ODU Manufacturer', 'Daikin, Mitsubishi, LG, Samsung, etc.', 'As per your procurement spec'],
                      ['ODU Model', 'Exact catalogue code, e.g. RYYQ20T', 'From ODU catalogue, include heat-recovery suffix if 3-pipe'],
                      ['ODU Nominal TR', 'Nameplate capacity in TR', 'Read from catalogue — this is at standard ARI test conditions'],
                      ['Diversity Factor', '0.80–0.85 for offices; 0.70–0.75 for hotels', 'Simultaneous demand fraction. Required ODU TR = Σ IDU TR × DF'],
                      ['Piping Configuration', '2-pipe (cooling only) or 3-pipe (heat recovery)', '3-pipe allows simultaneous cooling + heating in different zones'],
                    ].map(([field, enter, guide], i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-green-50/40'}>
                        <td className="px-3 py-1.5 font-semibold text-gray-800">{field}</td>
                        <td className="px-3 py-1.5 text-gray-600">{enter}</td>
                        <td className="px-3 py-1.5 text-green-800">{guide}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded-lg bg-white border border-green-200 p-3 space-y-1">
                <p className="text-xs font-bold text-gray-700">ODU sizing worked example</p>
                <p className="text-xs font-mono text-gray-700 leading-relaxed">
                  4 zones: 4.5 + 6.0 + 5.5 + 4.0 = 20.0 TR total IDU<br />
                  Diversity factor 0.82 → Required ODU = 20.0 × 0.82 = 16.4 TR<br />
                  Select 18 TR ODU (next standard size above 16.4) → ✅ Fits<br />
                  Max connectable = 18 × 1.30 = 23.4 TR — all 20 TR IDU fits ✓
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Tip>VRF manufacturers specify a maximum connectable IDU capacity = ODU nominal × 130%. Ensure your total IDU TR does not exceed this limit — an over-connected VRF system will not operate correctly.</Tip>
                <Note>For 3-pipe heat-recovery VRF, the simultaneous heating + cooling scenario may require a larger ODU than the cooling-only calculation. Check the manufacturer selection software for the simultaneous operation case.</Note>
              </div>
            </div>

            {/* Chiller */}
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
              <p className="text-xs font-bold text-blue-800 uppercase tracking-wide flex items-center gap-1.5">
                <Thermometer className="w-3.5 h-3.5" /> Chiller Plant — Chiller + Cooling Tower + Pumps
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-white rounded-lg border border-blue-100 p-3 space-y-1.5">
                  <p className="text-xs font-bold text-blue-700">a) Add Chiller Units</p>
                  <p className="text-xs text-gray-600 leading-relaxed">Click <strong>"Add Chiller"</strong> at system level. Enter make, model, TR/unit, quantity. Total installed chiller TR = TR/unit × qty.</p>
                  <p className="text-xs font-mono bg-blue-50 rounded px-2 py-1 text-gray-700">E.g. 2 × 100 TR = 200 TR installed → covers 148 TR peak load with N+1 redundancy ✓</p>
                </div>
                <div className="bg-white rounded-lg border border-blue-100 p-3 space-y-1.5">
                  <p className="text-xs font-bold text-blue-700">b) Add Cooling Tower</p>
                  <p className="text-xs text-gray-600 leading-relaxed">Click <strong>"Add Cooling Tower"</strong>. Enter make, model, CT rated TR. Rule of thumb: CT TR ≥ Chiller TR × 1.25 (for heat rejection = cooling load + compressor heat).</p>
                  <p className="text-xs font-mono bg-blue-50 rounded px-2 py-1 text-gray-700">E.g. 200 TR chiller → CT ≥ 200 × 1.25 = 250 TR → select 250 TR CT</p>
                </div>
                <div className="bg-white rounded-lg border border-blue-100 p-3 space-y-1.5">
                  <p className="text-xs font-bold text-blue-700">c) Zone IDUs = AHUs or FCUs</p>
                  <p className="text-xs text-gray-600 leading-relaxed">For each zone under the Chiller plant, the "IDU" is the AHU or FCU connected to the chilled-water loop. Select it using the standard IDU form — set subtype to AHU or FCU and enter TR + CFM from the AHU selection sheet.</p>
                </div>
                <div className="bg-white rounded-lg border border-blue-100 p-3 space-y-1.5">
                  <p className="text-xs font-bold text-blue-700">d) Optional: Pumps</p>
                  <p className="text-xs text-gray-600 leading-relaxed">Use the Notes field to record primary pump and secondary pump details (head, flow, kW). Full pump sizing is done in the Hydronic Pipe Sizer tool; record the result here for the equipment schedule.</p>
                </div>
              </div>
            </div>

            {/* AHU / DX */}
            <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 space-y-3">
              <p className="text-xs font-bold text-teal-800 uppercase tracking-wide flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5" /> AHU / DX System — Condensing Unit + AHU per Zone
              </p>
              <div className="space-y-1.5 text-xs text-gray-700">
                {[
                  ['Select Condensing Unit', 'At system level, click "Select Condensing Unit". Enter the DX outdoor unit make, model, TR. This serves the entire AHU system.'],
                  ['Select AHU per Zone', 'For each zone, the IDU is the AHU. Set subtype to AHU or Ductable-High, enter rated CFM and ESP (External Static Pressure).'],
                  ['Verify AHU performance', 'AHU CFM from Load Calculator is net supply air. Check the AHU\'s fan performance curve to confirm rated CFM is achievable at your system\'s ESP (typically 0.6–1.0 in WG for office buildings, 1.0–1.5 in WG for hospitals).'],
                  ['AHU Configuration', 'The tool stores AHU-specific fields: pre-filter grade (G4/MERV-8 min), fine-filter grade (F7/MERV-13), HEPA checkbox (for OTs), mixing box, and heating coil flag.'],
                ].map(([step, detail]) => (
                  <div key={step} className="flex items-start gap-2">
                    <ArrowRight className="w-3 h-3 mt-0.5 shrink-0 text-teal-600" />
                    <span><strong>{step}</strong> — {detail}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Package / Split / Ductable */}
            <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 space-y-2">
              <p className="text-xs font-bold text-purple-800 uppercase tracking-wide flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" /> Package / Ductable Split / Split — IDU Only (No Separate Plant Step)
              </p>
              <p className="text-xs text-gray-700 leading-relaxed">
                For these system types, there is <strong>no system-level plant selection</strong>. The IDU contains the compressor + evaporator (Package = also condenser). Complete Steps 4–5 for all zones, verify all badges show ✅ Fits, then proceed directly to Step 7.
              </p>
            </div>
          </div>
        </div>

        {/* STEP 7 */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-3 bg-blue-700 px-4 py-3">
            <StepBadge n={7} />
            <p className="text-sm font-bold text-white">Check System-Level Summary — Loading Percentage</p>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-gray-600 leading-relaxed">
              The system header card aggregates all zones. Review the system summary before pushing to Load Calculator.
            </p>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead><tr className="bg-gray-100">
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Summary Field</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Target / Acceptable Range</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Action if outside range</th>
                </tr></thead>
                <tbody>
                  {[
                    ['Total Required TR', '—', 'Read-only. Sum of Governing TR across all zones.'],
                    ['Total Installed TR', '≥ Total Required TR', 'If below: one or more zones are 🔴 Under. Fix those zones first.'],
                    ['Loading %', '85–100% ideal', 'Below 80%: system is oversized — consider a smaller unit. Above 100%: undersized — fix immediately.'],
                    ['All zones ✅ Fits?', '100% green', 'If any zone is 🔴 Under: fix before generating report. Amber (Oversized) is acceptable.'],
                  ].map(([field, target, action], i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 py-2 font-semibold text-gray-800">{field}</td>
                      <td className="px-3 py-2 font-mono text-blue-700 font-bold">{target}</td>
                      <td className="px-3 py-2 text-gray-600">{action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Tip>A loading of 85–95% is the engineering sweet spot. Equipment runs near rated conditions (efficient), with headroom for the occasional day hotter than design. If loading is 75% or below, check whether the next smaller catalogue size still gives ✅ Fits — it likely does and will save cost and energy.</Tip>
          </div>
        </div>

        {/* STEP 8 */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-3 bg-blue-700 px-4 py-3">
            <StepBadge n={8} />
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-blue-200" />
              <p className="text-sm font-bold text-white">Push to Load Calculator — Sync Equipment Data Back for Reporting</p>
            </div>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-gray-600 leading-relaxed">
              When all zones show ✅ Fits (or acceptable 🟡 Oversized), click the <strong>"Push to LC"</strong> button
              in the Equipment Selection toolbar. This writes the installed equipment data back to the Load Calculator
              zone records, so the PDF report can show both calculated (governing) TR and installed TR side-by-side.
            </p>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead><tr className="bg-gray-100">
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">What Push to LC writes</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Where it appears</th>
                </tr></thead>
                <tbody>
                  {[
                    ['Installed TR per zone', 'Load Calculator Zone Summary → "Inst. TR" column'],
                    ['Installed CFM per zone', 'PDF Report Section 3 → "Inst. CFM" column'],
                    ['Equipment make + model per zone', 'PDF Report Section 5 Equipment Schedule'],
                    ['hvacSystemId + hvacZoneId on each room', 'Rooms appear correctly in HVAC Systems hierarchy'],
                  ].map(([what, where], i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 py-2 text-gray-700">{what}</td>
                      <td className="px-3 py-2 text-blue-700 font-medium">{where}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Note>Push to LC is safe to run multiple times. If you change equipment after the first push, push again — it overwrites previous values. No load calculation data is lost.</Note>
              <Warn>If you skip Push to LC and generate the PDF directly from HVAC Systems, Section 3 will show blank Inst. TR and Section 5 will be empty. Always push first.</Warn>
            </div>
          </div>
        </div>

        {/* STEP 9 */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-3 bg-blue-700 px-4 py-3">
            <StepBadge n={9} />
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-200" />
              <p className="text-sm font-bold text-white">Generate the PDF Report — Equipment Schedule + Zone Summary</p>
            </div>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-gray-600 leading-relaxed">
              The PDF can be generated from two places — both produce the same output:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1.5">
                <p className="text-xs font-bold text-gray-700">From Equipment Selection</p>
                <p className="text-xs text-gray-600 leading-relaxed">PDF button in the top toolbar. Best for reviewing one system during design iterations before final submission.</p>
              </div>
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 space-y-1.5">
                <p className="text-xs font-bold text-orange-700">From HVAC Systems (recommended for submission)</p>
                <p className="text-xs text-gray-600 leading-relaxed">The orange <strong>"PDF Report"</strong> button top-right in HVAC Systems. Generates a full project report with all systems, all zones, all rooms — use this for MEP submission packages.</p>
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead><tr className="bg-gray-100">
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">PDF Section</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Content</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Fed by</th>
                </tr></thead>
                <tbody>
                  {[
                    ['Section 1 — Project Info', 'Project name, location, system type, design conditions, engineer name/stamp', 'Project settings'],
                    ['Section 2 — Executive Summary', 'Total TR, total CFM, system/zone count, key safety factors, design standards reference', 'Auto-computed from all zones'],
                    ['Section 3 — Zone Summary', 'Per zone: Gov. TR, Inst. TR (green/red), Design CFM, Inst. CFM, room count. Grouped System → Zone.', 'Load Calculator + Push to LC'],
                    ['Section 4 — Room-by-Room Detail', 'Full CLTD / SHGF / CLF / psychrometric breakdown for every room. Basis of Design appendix.', 'Load Calculator'],
                    ['Section 5 — Equipment Schedule', 'All IDUs, ODUs, Chillers, Cooling Towers with make, model, TR, CFM, power — ready for procurement.', 'Equipment Selection'],
                  ].map(([section, content, fed], i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 py-2 font-semibold text-gray-800">{section}</td>
                      <td className="px-3 py-2 text-gray-600">{content}</td>
                      <td className="px-3 py-2 text-blue-700">{fed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* STEP 10 — Common Mistakes */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-3 bg-rose-600 px-4 py-3">
            <StepBadge n={10} />
            <p className="text-sm font-bold text-white">Common Equipment Selection Mistakes — and How to Avoid Them</p>
          </div>
          <div className="p-4">
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 w-1/3">Mistake</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 w-1/3">Consequence</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 w-1/3">Prevention</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    [
                      'Entering Inst. TR exactly equal to Gov. TR',
                      'Equipment runs at 100% at design conditions — any day hotter than design and the space overheats.',
                      'Select the next standard catalogue size up. E.g. if Gov. TR = 4.8, select a 5.0 TR unit.',
                    ],
                    [
                      'Ignoring Design CFM when it governs',
                      'IDU may show ✅ Fits for TR but 🔴 Under for CFM — space is under-ventilated even though TR looks OK.',
                      'Always verify Inst. CFM ≥ Design CFM. If CFM TR exceeds Load TR, CFM is your sizing criterion.',
                    ],
                    [
                      'Not applying VRF diversity factor to the ODU',
                      'ODU is grossly oversized (diversity = 1.0 used implicitly) — wastes capital cost and refrigerant charge.',
                      'Apply 0.80–0.85 for offices, 0.75 for hotels. Use manufacturer diversity tables for mixed-use projects.',
                    ],
                    [
                      'Forgetting to click Push to LC before generating the PDF',
                      'PDF Section 3 shows no Inst. TR, Section 5 Equipment Schedule is blank — unusable for submission.',
                      'Always Push to LC immediately after finalising all zone IDU selections.',
                    ],
                    [
                      'Using nominal TR without altitude or high-OAT derate',
                      'Equipment is actually undersized at site conditions — system fails on the hottest days.',
                      'Apply manufacturer selection software at actual OAT. At 45 °C OA, VRF derate ≈ 8–12%.',
                    ],
                    [
                      'Wrong Cooling Tower sizing for Chiller plant',
                      'CT undersized → condenser water temp rises → chiller trips on high head pressure.',
                      'CT rated TR ≥ Chiller TR × 1.25 always. Enter this in the CT field and record the model.',
                    ],
                    [
                      'Not checking AHU rated CFM at actual system ESP',
                      'AHU delivers less CFM than rated at zero ESP — rooms are under-ventilated.',
                      'Read CFM from the fan performance curve at your actual external static pressure (0.6–1.0 in WG typical).',
                    ],
                    [
                      'Selecting Split IDUs for a Chiller zone (or FCU for a VRF zone)',
                      'System type mismatch — equipment cannot physically connect to the refrigerant or CHW piping.',
                      'Match IDU subtype to system type: Chiller → FCU or AHU; VRF → VRF-compatible IDUs only.',
                    ],
                  ].map(([mistake, consequence, prevention], i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 py-2 text-red-700 font-medium align-top">{mistake}</td>
                      <td className="px-3 py-2 text-gray-600 align-top">{consequence}</td>
                      <td className="px-3 py-2 text-emerald-700 font-medium align-top">{prevention}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Final summary callout */}
        <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-4 space-y-2">
          <p className="text-sm font-bold text-blue-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Equipment Selection Completion Checklist
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
            {[
              'All zones show ✅ Fits (no 🔴 Under zones)',
              'All zone Inst. CFM ≥ Design CFM',
              'System loading % in 85–100% range',
              'VRF: ODU selected with diversity factor applied',
              'Chiller: Chiller TR + Cooling Tower TR entered',
              'AHU: condensing unit + per-zone AHU selected with ESP noted',
              'Push to LC completed (toolbar button clicked)',
              'PDF generated and Section 3 shows green/red comparison',
              'PDF Section 5 shows full equipment schedule with make + model',
            ].map((item) => (
              <div key={item} className="flex items-center gap-2 text-xs text-blue-800">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* ════════════════════════════════════════════════════════════════════════
          SECTION 1 — VRF
      ════════════════════════════════════════════════════════════════════════ */}
      <SectionCard
        id="vrf" title="VRF System — 3-Storey Office Building"
        badge="VRF" badgeColor="bg-green-100 text-green-800"
        icon={Zap} defaultOpen
      >
        <p className="text-sm text-gray-600 leading-relaxed">
          A 3-storey office building with one VRF outdoor unit per floor serving multiple
          indoor units. Each floor is one zone; each zone has 4–6 rooms.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Project Design Conditions</p>
            <InputTable rows={[
              ['Outdoor Summer DB', '100 °F', 'Peak cooling design'],
              ['Outdoor Summer RH', '55 %', ''],
              ['Indoor Summer DB', '75 °F', 'ASHRAE comfort'],
              ['Indoor Summer RH', '50 %', ''],
              ['Winter Outdoor DB', '45 °F', 'For heating calc'],
              ['Altitude', '820 ft', 'Hyderabad example'],
            ]} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Building Summary</p>
            <InputTable rows={[
              ['Floors', '3', 'Ground, First, Second'],
              ['Rooms per floor', '4–6', '~15 rooms total'],
              ['Typical room', '15 × 12 × 10 ft', 'Open-plan office'],
              ['Occupancy', '4 persons / room', 'Office activity'],
              ['Lights', '1.2 W/ft²', 'LED office'],
              ['Equipment', '0.8 kW / room', 'Computers, monitors'],
            ]} />
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-4 border-l-2 border-blue-200 pl-5 ml-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={1} /><p className="text-sm font-semibold">Create Project → Enter Design Conditions</p></div>
            <p className="text-xs text-gray-500 ml-9">Dashboard → New Project → set System Type = VRF → enter outdoor/indoor conditions above.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={2} /><p className="text-sm font-semibold">Load Calculator → Create 3 Zones (one per floor)</p></div>
            <p className="text-xs text-gray-500 ml-9">Click <strong>+ Add Zone</strong>. Name each zone "Ground Floor", "First Floor", "Second Floor". Add 4–5 rooms per zone, enter dimensions and internal loads.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={3} /><p className="text-sm font-semibold">Add Envelope Elements per Room</p></div>
            <p className="text-xs text-gray-500 ml-9">Expand a room → Envelope. Add Walls (S, W, N, E), Roof (for top floor), Glass for windows. The app applies CLTD/SHGF/CLF automatically.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={4} /><p className="text-sm font-semibold">Calculate All Rooms</p></div>
            <p className="text-xs text-gray-500 ml-9">Click <strong>Calculate All</strong> or expand each room and click Save. Results show Governing TR and Design CFM per room.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={5} /><p className="text-sm font-semibold">HVAC Systems → Create VRF System</p></div>
            <p className="text-xs text-gray-500 ml-9">Navigate to <strong>HVAC Systems</strong>. Click <strong>+ Add System</strong> → Type = VRF, name it "VRF-1". Add 3 zones (one per floor). Assign rooms from Load Calculator to each zone.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={6} /><p className="text-sm font-semibold">Equipment Selection → Select ODU + IDUs</p></div>
            <p className="text-xs text-gray-500 ml-9">Go to <strong>Equipment Selection</strong>. Select VRF-1. Click <strong>Create Zone</strong> per floor → select rooms → click <strong>Select IDU</strong> for each zone. Then select the <strong>ODU</strong> sized to cover total TR with diversity factor (0.85 typical).</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={7} /><p className="text-sm font-semibold">Generate PDF Report</p></div>
            <p className="text-xs text-gray-500 ml-9">Go to <strong>HVAC Systems</strong> → click <strong>PDF Report</strong>. Or use the PDF button in Load Calculator toolbar.</p>
          </div>
        </div>

        <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Typical Results</p>
        <ResultTable rows={[
          ['Ground Floor (Zone 1)',  '7.2 TR',  '2,880 CFM'],
          ['First Floor (Zone 2)',   '6.8 TR',  '2,720 CFM'],
          ['Second Floor (Zone 3)',  '5.5 TR',  '2,200 CFM'],
          ['Total Project',          '19.5 TR', '7,800 CFM'],
        ]} />

        <Tip>For VRF, the ODU effective TR must be ≥ total zone TR ÷ diversity factor. With 19.5 TR and 0.85 diversity → ODU needs ≥ 23 TR nominal.</Tip>
        <Warn>VRF systems are limited to ~164 ft total piping length and ~100 ft vertical rise. Check manufacturer limits before finalising the ODU location.</Warn>
      </SectionCard>

      {/* ════════════════════════════════════════════════════════════════════════
          SECTION 2 — CHILLER
      ════════════════════════════════════════════════════════════════════════ */}
      <SectionCard
        id="chiller" title="Chiller Plant — Commercial Hotel"
        badge="CHILLER" badgeColor="bg-blue-100 text-blue-800"
        icon={Thermometer}
      >
        <p className="text-sm text-gray-600 leading-relaxed">
          A 120-room hotel with a central chiller plant. The plant serves multiple AHUs —
          one per wing — each as a separate zone. FCUs in guest rooms are part of the chilled-water loop.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Design Conditions (Mumbai)</p>
            <InputTable rows={[
              ['Outdoor Summer DB', '95 °F', ''],
              ['Outdoor Summer RH', '75 %', 'Coastal humid'],
              ['Monsoon Outdoor DB', '88 °F', 'Enable Monsoon checkbox'],
              ['Monsoon Outdoor RH', '90 %', ''],
              ['Indoor DB', '75 °F', 'All spaces'],
              ['Indoor RH', '55 %', 'Hotel comfort'],
              ['Altitude', '37 ft', 'Sea level'],
            ]} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">System Layout</p>
            <InputTable rows={[
              ['System type', 'Chiller', ''],
              ['No. of AHUs', '4', 'North, South, East, Lobby'],
              ['Guest rooms / AHU', '~30', 'FCU per room'],
              ['Common areas', '1 zone', 'Lobby, Restaurant, Gym'],
              ['Chiller units', '2 × 100 TR', 'N+1 redundancy'],
              ['Cooling tower', '1 × 250 TR', 'Induced-draft'],
            ]} />
          </div>
        </div>

        <div className="space-y-4 border-l-2 border-blue-200 pl-5 ml-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={1} /><p className="text-sm font-semibold">Create Project → Enable Monsoon</p></div>
            <p className="text-xs text-gray-500 ml-9">In Project Settings, tick <strong>Include Monsoon Season</strong>. Enter monsoon outdoor conditions. The app calculates for both Summer and Monsoon; the governing (higher) TR drives equipment selection.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={2} /><p className="text-sm font-semibold">Load Calculator → Create 5 Zones</p></div>
            <p className="text-xs text-gray-500 ml-9">North Wing, South Wing, East Wing, Lobby Zone, Common Areas. Set zone-level indoor conditions for special spaces (e.g. Restaurant at 72 °F).</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={3} /><p className="text-sm font-semibold">Add Guest Rooms (typical room method)</p></div>
            <p className="text-xs text-gray-500 ml-9">Create one "Typical Guest Room" with accurate envelope (exterior wall + window). Copy results × room count for zone total. Add one "Corridor" room per wing.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={4} /><p className="text-sm font-semibold">HVAC Systems → Chiller System with AHU Zones</p></div>
            <p className="text-xs text-gray-500 ml-9">Create system "Chiller Plant 1". Add zones: AHU-North, AHU-South, AHU-East, AHU-Lobby, AHU-Common. Assign rooms from Load Calculator to each AHU zone.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={5} /><p className="text-sm font-semibold">Equipment Selection → Chiller + Cooling Tower + AHUs</p></div>
            <p className="text-xs text-gray-500 ml-9">
              In Equipment Selection: select the Chiller Plant. First add the <strong>Chiller Units</strong> (2 × 100 TR). Then add the <strong>Cooling Tower</strong>.
              For each AHU zone, click <strong>Select Zone IDU</strong> to choose the AHU model and airflow.
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={6} /><p className="text-sm font-semibold">Cross-check: Inst TR ≥ Req TR (green = OK, red = undersized)</p></div>
            <p className="text-xs text-gray-500 ml-9">The PDF report Section 3 shows Inst. TR vs Gov. TR per zone in green/red. Adjust chiller selection until all zones are green.</p>
          </div>
        </div>

        <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Typical Results (120-room hotel)</p>
        <ResultTable rows={[
          ['North Wing (30 rooms)',  '32.4 TR',  '12,960 CFM'],
          ['South Wing (30 rooms)', '35.1 TR',  '14,040 CFM'],
          ['East Wing (30 rooms)',  '28.7 TR',  '11,480 CFM'],
          ['Lobby Zone',            '22.0 TR',  '8,800 CFM'],
          ['Common Areas',          '18.5 TR',  '7,400 CFM'],
          ['Total (Summer)',        '136.7 TR', '54,680 CFM'],
          ['Total (Monsoon)',       '148.2 TR', '59,280 CFM — governs'],
        ]} />

        <Tip>For Chiller Plants, the Monsoon season typically governs in humid coastal cities. Always enable Monsoon for projects in Mumbai, Chennai, Kochi, Singapore, etc.</Tip>
        <Note>The coil ADP floor follows the project <strong>Design Mode</strong> (see the <em>Design Mode &amp; Supply-Air Basis</em> section): <strong>Comfort</strong> = 54 °F, <strong>Dehumidification</strong> = 44 °F for chilled-water / 42 °F for VRF-Hybrid. Use Dehumidification mode for humid / latent-heavy chiller projects.</Note>
      </SectionCard>

      {/* ════════════════════════════════════════════════════════════════════════
          SECTION 3 — PACKAGE UNIT
      ════════════════════════════════════════════════════════════════════════ */}
      <SectionCard
        id="package" title="Package Unit — Retail Showroom"
        badge="PACKAGE" badgeColor="bg-purple-100 text-purple-800"
        icon={Building2}
      >
        <p className="text-sm text-gray-600 leading-relaxed">
          A single-storey retail showroom (3,500 ft²) with a rooftop packaged DX unit.
          One zone — entire showroom served by one unit with ducted distribution.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Design Conditions (Delhi)</p>
            <InputTable rows={[
              ['Outdoor Summer DB', '110 °F', 'Peak Delhi summer'],
              ['Outdoor Summer RH', '35 %', 'Dry heat'],
              ['Indoor DB', '75 °F', ''],
              ['Indoor RH', '50 %', ''],
              ['Altitude', '705 ft', ''],
            ]} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Showroom Layout</p>
            <InputTable rows={[
              ['Floor area', '3,500 ft²', '70 × 50 ft'],
              ['Ceiling height', '14 ft', 'High bay retail'],
              ['Occupancy', '45 persons', 'Retail/shopping'],
              ['Lights', '2.5 W/ft²', 'Display lighting'],
              ['Equipment', '2 kW', 'POS terminals'],
              ['Glazing', 'Large south façade', '40% glazing ratio'],
            ]} />
          </div>
        </div>

        <div className="space-y-4 border-l-2 border-blue-200 pl-5 ml-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={1} /><p className="text-sm font-semibold">Single Zone — All Showroom Rooms</p></div>
            <p className="text-xs text-gray-500 ml-9">Create one zone "Showroom". Add rooms: Main Sales Floor, Stock Room, Office, Restrooms. The envelope on the south wall (glass) drives solar gain — add south-facing glass elements carefully.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={2} /><p className="text-sm font-semibold">Envelope — South Glass is Critical</p></div>
            <p className="text-xs text-gray-500 ml-9">For the south façade glass: Type = Glass, Orientation = S, Area = 560 ft² (14 × 40), U-Value = 0.55, Solar Factor (SC) = 0.60. This single element may contribute 30–40% of total cooling load.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={3} /><p className="text-sm font-semibold">HVAC Systems → Package System</p></div>
            <p className="text-xs text-gray-500 ml-9">Create system "RTU-1" → Type = Package. Add one zone "Showroom Zone". Assign all rooms.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={4} /><p className="text-sm font-semibold">Equipment Selection → Rooftop Package Unit</p></div>
            <p className="text-xs text-gray-500 ml-9">Select RTU-1 → click <strong>Select Unit</strong>. Choose a Package unit with TR ≥ required. Enter CFM rated and model details. Check that Inst. TR ≥ Gov. TR in the report.</p>
          </div>
        </div>

        <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Typical Results</p>
        <ResultTable rows={[
          ['Main Sales Floor', '12.8 TR', '5,120 CFM'],
          ['Stock Room',        '2.1 TR', '840 CFM'],
          ['Office',            '1.4 TR', '560 CFM'],
          ['Showroom Total',   '16.3 TR', '6,520 CFM'],
        ]} />

        <Tip>High-bay retail with extensive display lighting and large glass is among the highest load density spaces. Always model the glazing solar gain — it often governs over all other loads combined in peak summer.</Tip>
      </SectionCard>

      {/* ════════════════════════════════════════════════════════════════════════
          SECTION 4 — DUCTABLE SPLIT
      ════════════════════════════════════════════════════════════════════════ */}
      <SectionCard
        id="ductable" title="Ductable Split — Medium Office Floor"
        badge="DUCTABLE" badgeColor="bg-indigo-100 text-indigo-800"
        icon={Wind}
      >
        <p className="text-sm text-gray-600 leading-relaxed">
          A 5,000 ft² single-floor open-plan office served by two ductable split units —
          one per wing. Two zones, each with an indoor cassette unit ducted to supply grilles.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Design Conditions (Bangalore)</p>
            <InputTable rows={[
              ['Outdoor Summer DB', '88 °F', ''],
              ['Outdoor Summer RH', '60 %', ''],
              ['Indoor DB', '75 °F', ''],
              ['Indoor RH', '50 %', ''],
              ['Altitude', '2,952 ft', 'Affects psychrometrics'],
            ]} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Layout</p>
            <InputTable rows={[
              ['East Wing', '2,400 ft²', '8 workstations + conf rooms'],
              ['West Wing', '2,600 ft²', '10 workstations + server room'],
              ['Server room load', '5 kW', 'IT equipment load'],
              ['People density', '1 person / 100 ft²', 'Open plan'],
              ['Lights', '1.0 W/ft²', 'LED'],
            ]} />
          </div>
        </div>

        <div className="space-y-4 border-l-2 border-blue-200 pl-5 ml-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={1} /><p className="text-sm font-semibold">Two Zones — East and West Wings</p></div>
            <p className="text-xs text-gray-500 ml-9">Each zone is served by one ductable unit. The server room (in West Wing) needs its own high equipment load — add it as a separate room with Equipment kW = 5.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={2} /><p className="text-sm font-semibold">Zone Design Conditions Override</p></div>
            <p className="text-xs text-gray-500 ml-9">The server room may require 70 °F indoor. In Load Calculator, expand the West Wing zone → set Zone Indoor Temp override to 70 °F. Only the server room inherits this; other rooms use project default.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={3} /><p className="text-sm font-semibold">HVAC Systems → DuctableSplit System</p></div>
            <p className="text-xs text-gray-500 ml-9">Create system "DS-1" → Type = DuctableSplit. Add zones: East Wing, West Wing. Assign rooms accordingly.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={4} /><p className="text-sm font-semibold">Equipment Selection → Two Ductable Units</p></div>
            <p className="text-xs text-gray-500 ml-9">Select DS-1 in Equipment Selection. For each zone, click Select Unit. Pick ductable units sized to cover the zone TR. Note the CFM must match duct system capacity.</p>
          </div>
        </div>

        <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Typical Results</p>
        <ResultTable rows={[
          ['East Wing (Open plan)', '6.8 TR', '2,720 CFM'],
          ['West Wing + Server',    '9.2 TR', '3,680 CFM'],
          ['Floor Total',          '16.0 TR', '6,400 CFM'],
        ]} />

        <Tip>At Bangalore's 2,952 ft altitude, the air density is ~10% lower than sea level. The tool adjusts psychrometrics automatically — design CFM will be ~10% higher than the same room at sea level for the same TR.</Tip>
      </SectionCard>

      {/* ════════════════════════════════════════════════════════════════════════
          SECTION 5 — SPLIT
      ════════════════════════════════════════════════════════════════════════ */}
      <SectionCard
        id="split" title="Split Unit — Boutique Hotel Guest Rooms"
        badge="SPLIT" badgeColor="bg-orange-100 text-orange-800"
        icon={Layers}
      >
        <p className="text-sm text-gray-600 leading-relaxed">
          A 20-room boutique hotel where each guest room has its own split unit (wall-mounted IDU).
          Each room is an independent zone; rooms are grouped by floor for billing and maintenance.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Typical Guest Room</p>
            <InputTable rows={[
              ['Room size', '14 × 12 × 10 ft', 'Standard double'],
              ['Occupancy', '2 persons', 'Sleeping'],
              ['Lights', '0.8 W/ft²', 'LED ambient'],
              ['Equipment', '0.2 kW', 'TV, phone chargers'],
              ['Window', 'East, 24 ft²', 'U=0.60, SC=0.55'],
              ['External wall', 'East, 100 ft²', 'U=0.35'],
            ]} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Design Conditions (Jaipur)</p>
            <InputTable rows={[
              ['Outdoor Summer DB', '112 °F', 'Extreme Rajasthan heat'],
              ['Outdoor Summer RH', '25 %', 'Very dry'],
              ['Indoor DB', '75 °F', ''],
              ['Indoor RH', '50 %', ''],
              ['Altitude', '1,385 ft', ''],
            ]} />
          </div>
        </div>

        <div className="space-y-4 border-l-2 border-blue-200 pl-5 ml-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={1} /><p className="text-sm font-semibold">Create a "Typical Room" → Calculate → Apply to All Rooms</p></div>
            <p className="text-xs text-gray-500 ml-9">Rather than entering 20 identical rooms, create one typical room, calculate it, and note the governing TR (e.g. 1.4 TR). Rooms with different orientations (south corner, top floor) get separate entries.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={2} /><p className="text-sm font-semibold">Zones = Floors (for Load Calculator grouping)</p></div>
            <p className="text-xs text-gray-500 ml-9">Create zones "Floor 1", "Floor 2", "Floor 3". Add ~6–7 rooms per floor. Top floor rooms get a Roof element — they will show higher TR than lower-floor rooms.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={3} /><p className="text-sm font-semibold">HVAC Systems → Split System (one zone per room concept)</p></div>
            <p className="text-xs text-gray-500 ml-9">Create "Split System". Since each room has its own IDU, you can group rooms by floor as zones in HVAC Systems. Add all rooms to the appropriate zone.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={4} /><p className="text-sm font-semibold">Equipment Selection → Per-Room Split IDU</p></div>
            <p className="text-xs text-gray-500 ml-9">In Equipment Selection → Split System → expand a room → <strong>Select IDU</strong>. Standard rooms: 1.5 TR wall-mounted. Corner/top-floor rooms: 2 TR. The report shows per-room installed TR.</p>
          </div>
        </div>

        <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Typical Results</p>
        <ResultTable rows={[
          ['Standard east room',    '1.4 TR', '540 CFM'],
          ['South corner room',     '1.8 TR', '720 CFM'],
          ['Top floor east room',   '1.7 TR', '680 CFM'],
          ['Top floor south corner','2.1 TR', '840 CFM'],
          ['20-room hotel total',  '32 TR',  '12,800 CFM'],
        ]} />

        <Warn>In extreme dry climates like Jaipur (112 °F / 25% RH), sensible load dominates heavily (SHR close to 1.0). Verify the RSHF on the Psychrometric tab — reheat is rarely needed in such climates.</Warn>
      </SectionCard>

      {/* ════════════════════════════════════════════════════════════════════════
          SECTION 6 — AHU
      ════════════════════════════════════════════════════════════════════════ */}
      <SectionCard
        id="ahu" title="AHU System — Hospital Surgical Wing"
        badge="AHU" badgeColor="bg-teal-100 text-teal-800"
        icon={Settings}
      >
        <p className="text-sm text-gray-600 leading-relaxed">
          A hospital surgical wing with strict indoor conditions. Two dedicated AHUs —
          one for Operating Theatres (OT) and one for ICU. Each AHU is a separate zone
          with independent design conditions.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Zone Design Conditions</p>
            <InputTable rows={[
              ['OT Indoor DB', '65 °F', 'Surgery protocol'],
              ['OT Indoor RH', '55 %', 'Anti-static'],
              ['ICU Indoor DB', '70 °F', 'Patient comfort'],
              ['ICU Indoor RH', '50 %', ''],
              ['OT FACPH', '25 ACH', 'ASHRAE 170 compliance'],
              ['ICU FACPH', '15 ACH', 'ASHRAE 170 minimum'],
            ]} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Design Conditions (Chennai)</p>
            <InputTable rows={[
              ['Outdoor Summer DB', '100 °F', ''],
              ['Outdoor Summer RH', '70 %', 'Humid coastal'],
              ['Monsoon RH', '90 %', 'Enable monsoon'],
              ['Altitude', '16 ft', ''],
            ]} />
          </div>
        </div>

        <div className="space-y-4 border-l-2 border-blue-200 pl-5 ml-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={1} /><p className="text-sm font-semibold">Zone-Level Indoor Override is Critical</p></div>
            <p className="text-xs text-gray-500 ml-9">In Load Calculator, expand the OT zone → set Zone Indoor Temp = 65 °F, Indoor RH = 55 %. This overrides the project-level defaults for all OT rooms. Do the same for ICU at 70 °F / 50 %.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={2} /><p className="text-sm font-semibold">High FACPH Drives CFM in Hospital Zones</p></div>
            <p className="text-xs text-gray-500 ml-9">Set FACPH = 25 ACH for OT rooms. The tool computes: Fresh Air CFM = Volume × 25 ÷ 60. This fresh-air load is enormous in hospitals and typically governs equipment size over sensible gains.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={3} /><p className="text-sm font-semibold">HVAC Systems → AHU System</p></div>
            <p className="text-xs text-gray-500 ml-9">Create "AHU System 1" → Type = AHU. Add zones: OT Suite, ICU Wing, Ward Block. Assign rooms.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={4} /><p className="text-sm font-semibold">Equipment Selection → DX Condensing Unit + AHU</p></div>
            <p className="text-xs text-gray-500 ml-9">Select AHU System 1 → select the condensing unit (TR), then per zone select the AHU unit (CFM). Ensure AHU static pressure ≥ duct system resistance.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={5} /><p className="text-sm font-semibold">Reheat Check on Psychrometric Tab</p></div>
            <p className="text-xs text-gray-500 ml-9">Expand any OT room → Psychrometrics tab. At 65 °F / 55 % indoor with high OA load, the coil SHR may drop below 0.75. If Reheat ★ REQD appears, budget for a reheat coil (shown in BTU/h).</p>
          </div>
        </div>

        <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Typical Results (6-OT suite, 20-bed ICU)</p>
        <ResultTable rows={[
          ['OT Suite (6 rooms)',  '42.5 TR',  '17,000 CFM'],
          ['ICU Wing (20 beds)',  '28.3 TR',  '11,320 CFM'],
          ['Ward Block',         '18.0 TR',   '7,200 CFM'],
          ['Total',              '88.8 TR',  '35,520 CFM'],
        ]} />

        <Warn>Hospital HVAC is governed by ASHRAE Standard 170. Always verify ACH, filtration class (HEPA for OT), pressurisation (OT positive, isolation negative), and humidity limits. This tool calculates sensible/latent loads but does not enforce all ASHRAE 170 pressure cascades — consult the standard directly.</Warn>
      </SectionCard>

      {/* ════════════════════════════════════════════════════════════════════════
          SECTION 7 — DOAS
      ════════════════════════════════════════════════════════════════════════ */}
      <SectionCard
        id="doas" title="DOAS — Dedicated Outdoor Air System"
        badge="DOAS" badgeColor="bg-gray-200 text-gray-700"
        icon={Wind}
      >
        <p className="text-sm text-gray-600 leading-relaxed">
          A DOAS supplies 100% conditioned outdoor air for ventilation; it is not the primary
          cooling/heating system. A typical application: VRF for sensible cooling + DOAS for
          fresh-air ventilation in a commercial office building.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">DOAS Design Intent</p>
            <InputTable rows={[
              ['Function', 'Ventilation only', 'ASHRAE 62.1'],
              ['Supply condition', '55 °F / 90% RH', 'Neutral or slightly cool'],
              ['Linked to', 'VRF System', 'Handles sensible load'],
              ['ACH contribution', '0.5–1.5 ACH', 'From DOAS only'],
              ['Full system ACH', '4–6 ACH total', 'VRF recirculation + DOAS'],
            ]} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Workflow</p>
            <InputTable rows={[
              ['Step 1', 'Create primary system', 'e.g. VRF or Chiller'],
              ['Step 2', 'Create DOAS system', 'Type = DOAS'],
              ['Step 3', 'Assign zones to DOAS', 'Same zones as primary'],
              ['Step 4', 'Enter OA fraction', 'Fresh-air ACH only'],
              ['Step 5', 'Report shows both', 'Separate TR per system'],
            ]} />
          </div>
        </div>

        <div className="space-y-4 border-l-2 border-blue-200 pl-5 ml-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={1} /><p className="text-sm font-semibold">Create Primary System First</p></div>
            <p className="text-xs text-gray-500 ml-9">In HVAC Systems, create the VRF (or Chiller) system with all its zones and rooms. This handles all recirculation and sensible cooling.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={2} /><p className="text-sm font-semibold">Add DOAS System Linked to Primary</p></div>
            <p className="text-xs text-gray-500 ml-9">Create new system → Type = DOAS. Name it "DOAS-1". In the system settings, link it to the VRF system (doasLinkedSystemIds). Add the same zones as the VRF system.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={3} /><p className="text-sm font-semibold">Set Fresh Air Rate Per Zone</p></div>
            <p className="text-xs text-gray-500 ml-9">DOAS zones carry only the outdoor air fraction. In Load Calculator, the ventilation load (BF = 0.15 room portion vs OA unbypassed coil load) is already split correctly. DOAS handles the unbypassed OA portion.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><StepBadge n={4} /><p className="text-sm font-semibold">Equipment Selection → Energy Recovery Unit</p></div>
            <p className="text-xs text-gray-500 ml-9">For DOAS, select an Energy Recovery Ventilator (ERV) or Heat Recovery Ventilator (HRV). Size it for total OA CFM across all zones. ERV efficiency (sensible ≥ 70%, latent ≥ 50%) significantly reduces the DOAS cooling load.</p>
          </div>
        </div>

        <Tip>
          The bypass factor (BF = 0.15) in this tool represents the fraction of room air that bypasses the coil unconditioned. In a DOAS setup, the outdoor air (unbypassed portion) is handled by the DOAS coil. The VRF/Chiller handles the room recirculation load only. Both TR values are shown separately in the report.
        </Tip>
        <Note>DOAS is increasingly required by ASHRAE 90.1 and local energy codes in high-humidity climates. It improves latent control and enables better IAQ without oversizing the primary system.</Note>
      </SectionCard>

      {/* ════════════════════════════════════════════════════════════════════════
          SECTION 8 — DESIGN TIPS
      ════════════════════════════════════════════════════════════════════════ */}
      <div id="tips" className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6 space-y-5">
        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-amber-500" /> Practical Design Tips
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3">
            <p className="text-xs font-bold text-blue-700 uppercase tracking-wide flex items-center gap-1.5">
              <Calculator className="w-3.5 h-3.5" /> Load Calculation
            </p>
            {[
              ['Safety Factors', 'Use Sensible Safety = 10%, Latent Safety = 5%, Overall Safety = 3% as starting point. Increase overall to 5–8% for critical facilities (hospitals, data centres).'],
              ['Orientation matters', 'West-facing glass generates peak load at 3–5 pm. If your project is a west-facing glazed tower, the west rooms will govern. Run the calculation; do not assume a single orientation.'],
              ['False Ceiling', 'When a false ceiling exists, enter the false ceiling height (not structural height) as the Effective Height. The tool calculates room volume and ACH-based supply CFM based on this value.'],
              ['Duct & Fan Gain', 'Default Duct Gain = 2%, Fan Heat = 3% of ERSH. For long duct runs (>100 ft) increase duct gain to 4–5%.'],
            ].map(([title, text]) => (
              <div key={title} className="text-xs space-y-0.5">
                <p className="font-semibold text-gray-800">{title}</p>
                <p className="text-gray-500 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3">
            <p className="text-xs font-bold text-green-700 uppercase tracking-wide flex items-center gap-1.5">
              <Settings className="w-3.5 h-3.5" /> Equipment Selection
            </p>
            {[
              ['Governing TR vs Load TR', 'Governing TR = max(Load TR, CFM TR). CFM TR = Design CFM ÷ 400. If your design CFM drives a higher TR than the heat load, the unit must be sized for CFM, not just the thermal load.'],
              ['Installed TR must be ≥ Governing TR', 'The report shows green/red traffic-light comparison. Never accept red — resize the unit until all zones are green.'],
              ['VRF Diversity', 'Simultaneous demand is rarely 100%. Apply 0.80–0.85 diversity to get ODU TR. E.g. 25 TR zone total × 0.85 = 21.25 TR ODU minimum.'],
              ['Chiller N+1', 'For critical loads, specify 2 × 60% capacity chillers instead of 1 × 100%. Ensures redundancy without significant capital penalty.'],
            ].map(([title, text]) => (
              <div key={title} className="text-xs space-y-0.5">
                <p className="font-semibold text-gray-800">{title}</p>
                <p className="text-gray-500 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3">
            <p className="text-xs font-bold text-purple-700 uppercase tracking-wide flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Reports & Submission
            </p>
            {[
              ['PDF from HVAC Systems', 'The PDF Report button in HVAC Systems generates a fully structured report — System → Zone → Room — ideal for MEP submission packages.'],
              ['Section 3 check', 'Before submitting, review Section 3 (Zone Summary). Inst. TR should be green (≥ Gov. TR) for every zone. Any red rows need equipment resizing.'],
              ['Excel export', 'Use the Excel export for quantity surveying and cost estimation. It lists all rooms, TR values, and CFM — ready for the QS team.'],
              ['Methodology PDF', 'The Methodology page (Super users) exports the complete ASHRAE calculation basis. Attach it to the submission as "Basis of Design".'],
            ].map(([title, text]) => (
              <div key={title} className="text-xs space-y-0.5">
                <p className="font-semibold text-gray-800">{title}</p>
                <p className="text-gray-500 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3">
            <p className="text-xs font-bold text-orange-700 uppercase tracking-wide flex items-center gap-1.5">
              <Thermometer className="w-3.5 h-3.5" /> Common Mistakes
            </p>
            {[
              ['Wrong orientation', 'Entering all walls as "South" is the most common error. Always check compass bearings on site. A misoriented west wall can underestimate peak load by 20–30%.'],
              ['Missing internal partitions', 'Partitions to unconditioned corridors or stairwells must be entered as Partition elements (U-value of partition, ΔT = indoor – unconditioned space temp).'],
              ['Ignoring altitude', 'At altitudes > 2,000 ft, air density is meaningfully lower. Design CFM increases by ~5–10% for the same TR. Always enter altitude — the psychrometric engine uses it.'],
              ['Single-season design', 'In humid climates, Monsoon season often governs due to extreme latent load. Always run Summer + Monsoon for coastal or tropical projects.'],
            ].map(([title, text]) => (
              <div key={title} className="text-xs space-y-0.5">
                <p className="font-semibold text-gray-800">{title}</p>
                <p className="text-gray-500 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Quick reference table */}
        <div className="space-y-2">
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">System Type Quick Reference</p>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">System</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Best For</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Typical TR Range</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">ADP</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Diversity</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['VRF',           'Medium offices, hotels, retail',            '5–50 TR',    '42 °F', '0.80–0.85'],
                  ['Chiller',       'Large buildings, >100 TR, district cooling', '100–2,000 TR','44 °F','N/A (zone sizing)'],
                  ['Package',       'Single-zone retail, small commercial',       '3–25 TR',    '44 °F','1.0'],
                  ['Ductable Split','Open-plan offices, mid-size commercial',     '2–10 TR',    '44 °F','1.0'],
                  ['Split',         'Individual rooms, hotels, apartments',       '0.75–3 TR',  '44 °F','0.70–0.80'],
                  ['AHU',           'Hospitals, clean rooms, process spaces',     '10–300 TR',  '44 °F','1.0'],
                  ['DOAS',          'Ventilation supplement to any system',       '2–50 TR OA', '44 °F','1.0'],
                ].map(([sys, best, tr, adp, div], i) => (
                  <tr key={sys} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-1.5 font-bold text-gray-800">{sys}</td>
                    <td className="px-3 py-1.5 text-gray-600">{best}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-blue-700">{tr}</td>
                    <td className="px-3 py-1.5 font-mono text-gray-600">{adp}</td>
                    <td className="px-3 py-1.5 font-mono text-gray-600">{div}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex gap-3 items-start bg-blue-50 border border-blue-200 rounded-xl p-4">
          <Users className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800 space-y-1">
            <p className="font-bold">Need the engineering formulas behind these calculations?</p>
            <p className="text-xs leading-relaxed">
              Visit the <strong>Methodology</strong> page for the complete CLTD/SHGF/CLF method,
              psychrometric equations, ADP/bypass-factor analysis, and ASHRAE Standard references.
              The Methodology PDF (available to Super users) is suitable for attaching to BOD submissions.
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}
