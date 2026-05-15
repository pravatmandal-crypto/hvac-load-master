import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Copy, BarChart3, Check } from 'lucide-react';
import { toast } from 'sonner';
import { parseMetData, deriveDesignConditions } from '../../services/metDataDeriver';

const SAMPLE_DATA = `YEAR, MONTH, MIN, MAX, RH
2024, JAN,  9.6,  25.7, 79
2024, FEB, 11.2,  28.5, 79
2024, MAR, 13.7,  32.5, 76
2024, APR, 18.6,  34.3, 78
2024, MAY, 21.2,  34.4, 83
2024, JUN, 23.2,  35.5, 87
2024, JUL, 24.2,  37.8, 84
2024, AUG, 23.2,  35.5, 87
2024, SEP, 24.3,  38.1, 84
2024, OCT, 13.3,  32.5, 79
2024, NOV, 11.1,  30.6, 82
2024, DEC,  8.5,  27.0, 84`;

export function MetDataImporterDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [csvText, setCsvText] = useState<string>('');
  const [basis, setBasis] = useState<'1%' | '4%'>('1%');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const rows = useMemo(() => parseMetData(csvText), [csvText]);
  const result = useMemo(() => (rows.length > 0 ? deriveDesignConditions(rows, basis) : null), [rows, basis]);

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      toast.success(`Copied ${value}`);
      setTimeout(() => setCopiedKey(k => (k === key ? null : k)), 1500);
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-blue-600" />
            Met Data → Design Conditions
          </DialogTitle>
          <DialogDescription>
            Paste 10-year monthly Min/Max temperature (°C) and Mean RH per row. Tool computes ASHRAE-style design
            conditions at your chosen percentile basis. Copy the values into the project's design fields below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Format hint */}
          <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            <strong>Format (5 columns per row):</strong> <code className="bg-white dark:bg-slate-700 px-1 rounded">YEAR, MONTH, MIN_°C, MAX_°C, RH%</code> &nbsp;·&nbsp; tab / comma / multi-space separated.
            Month can be a number (1–12) or 3-letter abbreviation (JAN, FEB…). Header row OK (skipped automatically).
          </div>

          {/* Paste area */}
          <div>
            <Label htmlFor="met-data-csv" className="text-sm font-semibold">Met Data (paste here)</Label>
            <textarea
              id="met-data-csv"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={SAMPLE_DATA}
              rows={10}
              className="mt-1 w-full text-xs font-mono rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {rows.length > 0
                  ? `✓ Parsed ${rows.length} row${rows.length === 1 ? '' : 's'}`
                  : 'No valid rows yet — paste data above.'}
              </p>
              <button
                type="button"
                onClick={() => setCsvText(SAMPLE_DATA)}
                className="text-xs text-blue-600 hover:underline">
                Insert sample
              </button>
            </div>
          </div>

          {/* Percentile basis */}
          <div className="flex items-center gap-3 pt-1">
            <Label className="text-sm font-semibold">Percentile basis:</Label>
            <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
              <button
                type="button"
                onClick={() => setBasis('1%')}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  basis === '1%'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}>
                1% (Stringent)
              </button>
              <button
                type="button"
                onClick={() => setBasis('4%')}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors border-l border-slate-200 dark:border-slate-700 ${
                  basis === '4%'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}>
                4% (Economical)
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 italic">
              {basis === '1%'
                ? 'Top 1% of MAX temps (99th %ile); bottom 1% of MIN temps. Conservative sizing.'
                : 'Top 4% (96th %ile); bottom 4%. Smaller equipment, slightly more annual hours exceeding setpoint.'}
            </p>
          </div>

          {/* Results */}
          {result && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 space-y-3">
              <h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
                Recommended Design Conditions ({result.basis} basis · {result.rowCount} rows)
              </h3>

              {/* Summer */}
              <SeasonRow
                color="orange"
                label="Summer"
                f={result.summer.dbtF}
                c={result.summer.dbtC}
                rh={result.summer.rh}
                source={result.summer.sourceMonth}
                copiedKey={copiedKey}
                copy={copy}
              />
              {/* Winter */}
              <SeasonRow
                color="blue"
                label="Winter"
                f={result.winter.dbtF}
                c={result.winter.dbtC}
                rh={result.winter.rh}
                source={result.winter.sourceMonth}
                copiedKey={copiedKey}
                copy={copy}
              />
              {/* Monsoon */}
              <SeasonRow
                color="teal"
                label="Monsoon"
                f={result.monsoon.dbtF}
                c={result.monsoon.dbtC}
                rh={result.monsoon.rh}
                source={result.monsoon.sourceMonth}
                copiedKey={copiedKey}
                copy={copy}
              />

              <p className="text-xs text-slate-600 dark:text-slate-400 italic leading-relaxed pt-1">
                Tip: click 🗐 to copy a value to clipboard, then paste it into the Summer / Winter / Monsoon fields
                below in the project Edit form. Source month/year shown for audit traceability.
              </p>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SeasonRow({
  color, label, f, c, rh, source, copiedKey, copy,
}: {
  color: 'orange' | 'blue' | 'teal';
  label: string;
  f: number;
  c: number;
  rh: number;
  source: string;
  copiedKey: string | null;
  copy: (key: string, value: string) => void;
}) {
  const colorCls =
    color === 'orange' ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800 text-orange-800 dark:text-orange-300' :
    color === 'blue'   ? 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300' :
                         'bg-teal-50 dark:bg-teal-950/20 border-teal-200 dark:border-teal-800 text-teal-800 dark:text-teal-300';
  const tempKey = `${label}-temp`;
  const rhKey   = `${label}-rh`;
  return (
    <div className={`rounded-md border px-3 py-2 ${colorCls}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-bold uppercase tracking-wide w-20 shrink-0">{label}</span>
        <span className="text-sm font-mono font-semibold flex-1">
          {f.toFixed(1)} °F &nbsp;·&nbsp; {c.toFixed(1)} °C &nbsp;·&nbsp; {rh.toFixed(0)}% RH
        </span>
        <span className="text-xs italic opacity-75">from {source}</span>
        <div className="inline-flex gap-1">
          <button
            type="button"
            onClick={() => copy(tempKey, f.toFixed(1))}
            className="px-1.5 py-0.5 rounded text-xs hover:bg-white/40 dark:hover:bg-black/20 flex items-center gap-1"
            title="Copy temperature (°F)">
            {copiedKey === tempKey ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            °F
          </button>
          <button
            type="button"
            onClick={() => copy(rhKey, rh.toFixed(0))}
            className="px-1.5 py-0.5 rounded text-xs hover:bg-white/40 dark:hover:bg-black/20 flex items-center gap-1"
            title="Copy RH (%)">
            {copiedKey === rhKey ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            RH
          </button>
        </div>
      </div>
    </div>
  );
}
