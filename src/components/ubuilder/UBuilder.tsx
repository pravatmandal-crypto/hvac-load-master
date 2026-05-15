import { useState, useEffect, useMemo } from 'react';
import { User } from 'firebase/auth';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, serverTimestamp, query, where, deleteField,
} from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import {
  Plus, Search, Pencil, Trash2, Download, Layers,
  ChevronDown, ChevronUp, X, Info, GripVertical,
} from 'lucide-react';
import { Button } from '../ui/button';
import { NumericInput } from '../ui/numeric-input';
import {
  MATERIALS, SOIL_TYPES, ASHRAE_ASSEMBLIES, MATERIAL_CATEGORIES,
  WALL_CATEGORY_LABELS,
  type UAssembly, type AssemblyLayer, type GroundParams, type WallCategory,
} from '../../data/ubuilder-seed';
import { calculateUValue } from '../../lib/ubuilder/calculations';
import { generateAssemblyPDF } from '../../services/ubuilderPDFService';

interface Props {
  currentUser: User;
}

type ActiveTab = 'standard' | 'custom';

const CATEGORY_COLORS: Record<WallCategory, string> = {
  above_ground: 'bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300',
  below_ground: 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300',
  roof: 'bg-purple-100 dark:bg-purple-950/50 text-purple-800 dark:text-purple-300',
  floor: 'bg-green-100 dark:bg-green-950/50 text-green-800 dark:text-green-300',
};

const EMPTY_LAYER: Omit<AssemblyLayer, 'r'> = {
  materialId: '',
  materialName: '',
  thickness: 100,
  lambda: 0,
};

const EMPTY_GROUND: GroundParams = {
  soilId: 's-001',
  soilName: 'Clay — Moist',
  soilLambda: 1.5,
  depthTop: 0,
  depthBottom: 2.0,
  slopeAngle: 0,
};

// ─── Assembly Card ────────────────────────────────────────────────────────────
function AssemblyCard({
  assembly,
  onEdit,
  onDelete,
  onDownload,
  isCustom,
}: {
  assembly: UAssembly;
  onEdit?: () => void;
  onDelete?: () => void;
  onDownload: () => void;
  isCustom: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm hover:shadow-md transition-shadow">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[assembly.wallCategory]}`}>
                {WALL_CATEGORY_LABELS[assembly.wallCategory]}
              </span>
              {assembly.ashraeReference && (
                <span className="text-xs text-gray-400 dark:text-slate-500">{assembly.ashraeReference}</span>
              )}
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-slate-100 text-sm leading-tight">{assembly.name}</h3>
            {assembly.description && (
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 line-clamp-2">{assembly.description}</p>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="text-right">
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{assembly.uValue.toFixed(2)}</div>
              <div className="text-xs text-gray-400 dark:text-slate-500">W/m²K</div>
            </div>
            <span className="text-[10px] font-mono bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-gray-500 dark:text-slate-400">
              {assembly.method === 'ISO_13370' ? 'ISO 13370' : 'ISO 6946'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
          >
            <Layers size={12} />
            {assembly.layers.length} layer{assembly.layers.length !== 1 ? 's' : ''}
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={onDownload}
              title="Download PDF report"
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              <Download size={14} />
            </button>
            {isCustom && onEdit && (
              <button
                onClick={onEdit}
                title="Edit assembly"
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                <Pencil size={14} />
              </button>
            )}
            {isCustom && onDelete && (
              <button
                onClick={onDelete}
                title="Delete assembly"
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-slate-700 px-4 pb-4 pt-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 dark:text-slate-500 uppercase text-[10px]">
                <th className="text-left font-medium pb-1">Material</th>
                <th className="text-right font-medium pb-1">Thickness</th>
                <th className="text-right font-medium pb-1">λ (W/mK)</th>
                <th className="text-right font-medium pb-1">R (m²K/W)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700">
              {assembly.layers.map((layer, i) => (
                <tr key={i}>
                  <td className="py-1 text-gray-700 dark:text-slate-300">{layer.materialName}</td>
                  <td className="py-1 text-right text-gray-600 dark:text-slate-400">{layer.thickness} mm</td>
                  <td className="py-1 text-right text-gray-600 dark:text-slate-400">{layer.lambda.toFixed(3)}</td>
                  <td className="py-1 text-right font-mono text-gray-700 dark:text-slate-300">{layer.r.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {assembly.groundParams && (
            <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <span className="font-semibold">Ground params: </span>
              {assembly.groundParams.soilName} · Depth {assembly.groundParams.depthTop}–{assembly.groundParams.depthBottom} m
              {assembly.groundParams.slopeAngle > 0 && ` · Slope ${assembly.groundParams.slopeAngle}°`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Assembly Builder Dialog ──────────────────────────────────────────────────
function AssemblyBuilderDialog({
  initial,
  onSave,
  onClose,
}: {
  initial?: UAssembly;
  onSave: (a: Omit<UAssembly, 'id' | 'type'>) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [wallCategory, setWallCategory] = useState<WallCategory>(initial?.wallCategory ?? 'above_ground');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [layers, setLayers] = useState<AssemblyLayer[]>(
    initial?.layers ?? [{ ...EMPTY_LAYER, materialId: '', materialName: '', thickness: 100, lambda: 0, r: 0 }],
  );
  const [groundParams, setGroundParams] = useState<GroundParams>(initial?.groundParams ?? { ...EMPTY_GROUND });
  const [categoryFilter, setCategoryFilter] = useState('');

  const result = useMemo(() => {
    const validLayers = layers.filter(l => l.lambda > 0 && l.thickness > 0);
    if (validLayers.length === 0) return null;
    return calculateUValue(validLayers, wallCategory, wallCategory === 'below_ground' ? groundParams : undefined);
  }, [layers, wallCategory, groundParams]);

  const addLayer = () =>
    setLayers(prev => [...prev, { materialId: '', materialName: '', thickness: 100, lambda: 0, r: 0 }]);

  const removeLayer = (i: number) => setLayers(prev => prev.filter((_, idx) => idx !== i));

  const moveLayer = (i: number, dir: -1 | 1) => {
    setLayers(prev => {
      const arr = [...prev];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  };

  const updateLayer = (i: number, field: keyof AssemblyLayer, value: string | number) => {
    setLayers(prev => {
      const arr = [...prev];
      arr[i] = { ...arr[i], [field]: value } as AssemblyLayer;
      if (field === 'materialId') {
        const mat = MATERIALS.find(m => m.id === value);
        if (mat) {
          arr[i].materialName = mat.name;
          arr[i].lambda = mat.lambda;
        }
      }
      if (arr[i].lambda > 0 && arr[i].thickness > 0) {
        arr[i].r = parseFloat((arr[i].thickness / 1000 / arr[i].lambda).toFixed(4));
      }
      return arr;
    });
  };

  const updateGround = (field: keyof GroundParams, value: string | number) => {
    setGroundParams(prev => {
      const updated = { ...prev, [field]: value };
      if (field === 'soilId') {
        const soil = SOIL_TYPES.find(s => s.id === value);
        if (soil) {
          updated.soilName = soil.name;
          updated.soilLambda = soil.lambda;
        }
      }
      return updated;
    });
  };

  const handleSave = () => {
    if (!name.trim()) { toast.error('Assembly name is required'); return; }
    const validLayers = layers.filter(l => l.lambda > 0 && l.thickness > 0);
    if (validLayers.length === 0) { toast.error('Add at least one valid layer'); return; }
    if (!result) { toast.error('Cannot calculate U-value — check layer data'); return; }
    const saveData: Parameters<typeof onSave>[0] = {
      name: name.trim(),
      wallCategory,
      description: description.trim(),
      uValue: result.uValue,
      method: result.method,
      layers: validLayers,
    };
    if (wallCategory === 'below_ground') saveData.groundParams = groundParams;
    onSave(saveData);
  };

  const filteredMaterials = categoryFilter
    ? MATERIALS.filter(m => m.category === categoryFilter)
    : MATERIALS;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b dark:border-slate-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">
            {initial ? 'Edit Assembly' : 'New Assembly'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-800 dark:text-slate-400">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">Assembly Name *</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Brick Cavity Wall — Insulated"
                className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">Element Type *</label>
              <select
                value={wallCategory}
                onChange={e => setWallCategory(e.target.value as WallCategory)}
                className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {(Object.keys(WALL_CATEGORY_LABELS) as WallCategory[]).map(k => (
                  <option key={k} value={k}>{WALL_CATEGORY_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">Description (optional)</label>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Brief description of construction"
                className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Layer Stack */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200">
                Layers <span className="text-xs font-normal text-gray-400 dark:text-slate-500">(outside → inside)</span>
              </h3>
              <div className="flex items-center gap-2">
                <select
                  value={categoryFilter}
                  onChange={e => setCategoryFilter(e.target.value)}
                  className="text-xs rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-300 px-2 py-1"
                >
                  <option value="">All categories</option>
                  {MATERIAL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <Button variant="outline" size="sm" onClick={addLayer}>
                  <Plus size={13} className="mr-1" /> Add Layer
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {layers.map((layer, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 p-2">
                  <div className="flex flex-col gap-0.5 text-gray-300 dark:text-slate-600">
                    <button onClick={() => moveLayer(i, -1)} disabled={i === 0} className="hover:text-gray-600 dark:hover:text-slate-300 disabled:opacity-30">
                      <ChevronUp size={12} />
                    </button>
                    <GripVertical size={12} />
                    <button onClick={() => moveLayer(i, 1)} disabled={i === layers.length - 1} className="hover:text-gray-600 dark:hover:text-slate-300 disabled:opacity-30">
                      <ChevronDown size={12} />
                    </button>
                  </div>

                  <div className="flex-1 grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5">
                      <select
                        value={layer.materialId}
                        onChange={e => updateLayer(i, 'materialId', e.target.value)}
                        className="w-full rounded border border-gray-200 dark:border-slate-600 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white dark:bg-slate-800 dark:text-slate-200"
                      >
                        <option value="">— Select material —</option>
                        {filteredMaterials.map(m => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                        <option value="__custom__">Custom (enter λ below)</option>
                      </select>
                    </div>
                    <div className="col-span-3 flex items-center gap-1">
                      <NumericInput
                        min={0}
                        value={layer.thickness}
                        onChange={(n) => updateLayer(i, 'thickness', n ?? 0)}
                        className="w-full rounded border border-gray-200 dark:border-slate-600 px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white dark:bg-slate-800 dark:text-slate-200"
                      />
                      <span className="text-xs text-gray-400 dark:text-slate-500 shrink-0">mm</span>
                    </div>
                    <div className="col-span-2 flex items-center gap-1">
                      <NumericInput
                        min={0}
                        value={layer.lambda || undefined}
                        onChange={(n) => updateLayer(i, 'lambda', n ?? 0)}
                        placeholder="λ"
                        className="w-full rounded border border-gray-200 dark:border-slate-600 px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white dark:bg-slate-800 dark:text-slate-200"
                      />
                    </div>
                    <div className="col-span-2 text-right">
                      {layer.lambda > 0 && layer.thickness > 0 ? (
                        <span className="text-xs font-mono text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 rounded">
                          R={((layer.thickness / 1000) / layer.lambda).toFixed(3)}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-slate-600">—</span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => removeLayer(i)}
                    disabled={layers.length === 1}
                    className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-500 dark:hover:text-red-400 text-gray-300 dark:text-slate-600 disabled:opacity-20 transition-colors"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Ground Params (below_ground only) */}
          {wallCategory === 'below_ground' && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4">
              <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-300 mb-3 flex items-center gap-2">
                <Info size={14} /> Ground / Soil Parameters (ISO 13370)
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="col-span-2 sm:col-span-3">
                  <label className="block text-xs font-medium text-amber-800 dark:text-amber-400 mb-1">Soil Type</label>
                  <select
                    value={groundParams.soilId}
                    onChange={e => updateGround('soilId', e.target.value)}
                    className="w-full rounded border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-800 dark:text-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                  >
                    {SOIL_TYPES.map(s => (
                      <option key={s.id} value={s.id}>{s.name} (λ={s.lambda} W/mK)</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-amber-800 dark:text-amber-400 mb-1">Depth — Top (m)</label>
                  <NumericInput
                    min={0}
                    value={groundParams.depthTop}
                    onChange={(n) => updateGround('depthTop', n ?? 0)}
                    className="w-full rounded border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-800 dark:text-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-amber-800 dark:text-amber-400 mb-1">Depth — Bottom (m)</label>
                  <NumericInput
                    min={0.1}
                    value={groundParams.depthBottom}
                    onChange={(n) => updateGround('depthBottom', n ?? 0.1)}
                    className="w-full rounded border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-800 dark:text-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-amber-800 dark:text-amber-400 mb-1">Slope Angle (°)</label>
                  <NumericInput
                    min={0} max={90}
                    value={groundParams.slopeAngle}
                    onChange={(n) => updateGround('slopeAngle', n ?? 0)}
                    className="w-full rounded border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-800 dark:text-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                  />
                  <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-0.5">0° = vertical backfill face</p>
                </div>
              </div>
            </div>
          )}

          {/* Live Result */}
          {result ? (
            <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 px-5 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-blue-500 dark:text-blue-400 font-medium uppercase tracking-wide">Calculated U-Value</p>
                  <p className="text-4xl font-bold text-blue-700 dark:text-blue-400 mt-0.5">
                    {result.uValue.toFixed(3)}
                    <span className="text-base font-normal text-blue-400 dark:text-blue-500 ml-1">W/m²K</span>
                  </p>
                </div>
                <div className="text-right text-xs text-blue-600 dark:text-blue-400 space-y-0.5">
                  <div>R<sub>si</sub> = {result.rsi} m²K/W</div>
                  <div>R<sub>wall</sub> = {result.rWall.toFixed(3)} m²K/W</div>
                  <div>R<sub>se</sub> = {result.rse} m²K/W</div>
                  <div className="font-semibold">R<sub>total</sub> = {result.rTotal.toFixed(3)} m²K/W</div>
                  <div className="text-[10px] text-blue-400 dark:text-blue-500">{result.method}</div>
                </div>
              </div>

              {result.strips && result.strips.length > 1 && (
                <details className="mt-3">
                  <summary className="text-xs text-blue-600 dark:text-blue-400 cursor-pointer hover:text-blue-800 dark:hover:text-blue-300">
                    Show depth strip breakdown ({result.strips.length} strips)
                  </summary>
                  <div className="mt-2 max-h-36 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-blue-400 dark:text-blue-500 text-[10px]">
                          <th className="text-left">Depth (m)</th>
                          <th className="text-right">Strip h (m)</th>
                          <th className="text-right">U (W/m²K)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.strips.map((s, i) => (
                          <tr key={i} className="border-t border-blue-100 dark:border-blue-900">
                            <td className="py-0.5 text-blue-700 dark:text-blue-400">{s.depthMidpoint.toFixed(2)}</td>
                            <td className="text-right text-blue-600 dark:text-blue-400">{s.stripHeight.toFixed(2)}</td>
                            <td className="text-right font-mono text-blue-800 dark:text-blue-300">{s.uAtDepth.toFixed(3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 px-5 py-4 text-center text-sm text-gray-400 dark:text-slate-500">
              Add materials with valid thickness and λ values to see the U-value
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white">
            {initial ? 'Save Changes' : 'Save to Library'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main UBuilder Page ───────────────────────────────────────────────────────
export default function UBuilder({ currentUser }: Props) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('standard');
  const [customAssemblies, setCustomAssemblies] = useState<UAssembly[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<WallCategory | ''>('');
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingAssembly, setEditingAssembly] = useState<UAssembly | undefined>(undefined);

  // ── Firestore: load custom assemblies ──────────────────────────────────────
  useEffect(() => {
    if (!currentUser?.uid) return;

    const q = query(
      collection(db, 'u_assemblies'),
      where('userId', '==', currentUser.uid),
    );

    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as UAssembly));
      setCustomAssemblies(docs.sort((a, b) => a.name.localeCompare(b.name)));
      setLoading(false);
    }, (err) => {
      console.error('[UBuilder] onSnapshot failed:', err?.code, err?.message, 'uid:', auth.currentUser?.uid);
      setLoading(false);
    });

    return () => unsub();
  }, [currentUser?.uid]);

  // ── Save custom assembly ───────────────────────────────────────────────────
  const handleSave = async (data: Omit<UAssembly, 'id' | 'type'>) => {
    try {
      // Ensure the auth token is fresh before writing
      await auth.currentUser?.getIdToken(true);
      const uid = auth.currentUser?.uid ?? currentUser.uid;

      if (editingAssembly) {
        await updateDoc(doc(db, 'u_assemblies', editingAssembly.id), {
          ...data,
          // Remove groundParams if category changed away from below_ground
          groundParams: data.groundParams ?? deleteField(),
          updatedAt: serverTimestamp(),
        });
        toast.success('Assembly updated');
      } else {
        await addDoc(collection(db, 'u_assemblies'), {
          ...data,
          type: 'custom',
          userId: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        toast.success('Assembly saved to library');
      }
      setShowBuilder(false);
      setEditingAssembly(undefined);
    } catch (err: any) {
      console.error('[UBuilder] Save failed:', err?.code, err?.message, 'uid:', auth.currentUser?.uid);
      toast.error(`Failed to save: ${err?.code ?? err?.message ?? 'unknown error'}`);
    }
  };

  const handleDelete = async (assembly: UAssembly) => {
    if (!confirm(`Delete "${assembly.name}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'u_assemblies', assembly.id));
      toast.success('Assembly deleted');
    } catch {
      toast.error('Failed to delete assembly');
    }
  };

  const handleEdit = (assembly: UAssembly) => {
    setEditingAssembly(assembly);
    setShowBuilder(true);
  };

  // ── Filtered lists ─────────────────────────────────────────────────────────
  const filteredStandard = useMemo(() => {
    return ASHRAE_ASSEMBLIES.filter(a => {
      const matchSearch = !searchQuery || a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (a.description ?? '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchCat = !categoryFilter || a.wallCategory === categoryFilter;
      return matchSearch && matchCat;
    });
  }, [searchQuery, categoryFilter]);

  const filteredCustom = useMemo(() => {
    return customAssemblies.filter(a => {
      const matchSearch = !searchQuery || a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (a.description ?? '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchCat = !categoryFilter || a.wallCategory === categoryFilter;
      return matchSearch && matchCat;
    });
  }, [customAssemblies, searchQuery, categoryFilter]);

  const handleDownloadPDF = (assembly: UAssembly) => {
    try {
      const result = calculateUValue(
        assembly.layers,
        assembly.wallCategory,
        assembly.groundParams,
      );
      generateAssemblyPDF(assembly, result);
      toast.success('PDF downloaded');
    } catch {
      toast.error('Failed to generate PDF');
    }
  };

  return (
    <div className="flex flex-col h-full gap-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">U Builder</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            Build and manage your thermal assembly library. Pull any U-value into your projects.
          </p>
        </div>
        <Button
          onClick={() => { setEditingAssembly(undefined); setShowBuilder(true); }}
          className="bg-blue-600 hover:bg-blue-700 text-white shrink-0"
        >
          <Plus size={16} className="mr-2" /> New Assembly
        </Button>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'ASHRAE Standard', value: ASHRAE_ASSEMBLIES.length, color: 'text-blue-600' },
          { label: 'Custom / Special', value: customAssemblies.length, color: 'text-green-600' },
          { label: 'Materials in DB', value: MATERIALS.length, color: 'text-purple-600' },
          { label: 'Soil Types', value: SOIL_TYPES.length, color: 'text-amber-600' },
        ].map(stat => (
          <div key={stat.label} className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs + Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1 shrink-0">
          {(['standard', 'custom'] as ActiveTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                activeTab === tab
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200'
              }`}
            >
              {tab === 'standard' ? 'ASHRAE Standard' : 'Custom / Special'}
            </button>
          ))}
        </div>

        <div className="flex-1 flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search assemblies..."
              className="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-200 pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value as WallCategory | '')}
            className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All types</option>
            {(Object.keys(WALL_CATEGORY_LABELS) as WallCategory[]).map(k => (
              <option key={k} value={k}>{WALL_CATEGORY_LABELS[k]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Assembly Grid */}
      {activeTab === 'standard' && (
        <div>
          {filteredStandard.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-gray-200 dark:border-slate-700 py-16 text-center text-gray-400 dark:text-slate-500">
              No assemblies match your search
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredStandard.map(a => (
                <AssemblyCard
                  key={a.id}
                  assembly={a}
                  isCustom={false}
                  onDownload={() => handleDownloadPDF(a)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'custom' && (
        <div>
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
            </div>
          ) : filteredCustom.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-gray-200 dark:border-slate-700 py-16 text-center">
              <Layers size={40} className="mx-auto text-gray-300 dark:text-slate-600 mb-3" />
              <p className="text-gray-500 dark:text-slate-400 font-medium">No custom assemblies yet</p>
              <p className="text-sm text-gray-400 dark:text-slate-500 mt-1">
                Click <span className="font-semibold">New Assembly</span> to build one
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredCustom.map(a => (
                <AssemblyCard
                  key={a.id}
                  assembly={a}
                  isCustom={true}
                  onEdit={() => handleEdit(a)}
                  onDelete={() => handleDelete(a)}
                  onDownload={() => handleDownloadPDF(a)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Builder Dialog */}
      {showBuilder && (
        <AssemblyBuilderDialog
          initial={editingAssembly}
          onSave={handleSave}
          onClose={() => { setShowBuilder(false); setEditingAssembly(undefined); }}
        />
      )}
    </div>
  );
}
