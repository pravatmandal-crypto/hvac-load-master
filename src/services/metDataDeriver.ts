// Met data deriver — takes 10-year monthly Min/Max/RH data and computes ASHRAE-style
// design conditions at user-selected percentile basis (1% or 4%).
//
// Input format: pasted CSV / TSV / whitespace-separated rows. Header line optional.
// Each row: YEAR, MONTH, MIN_TEMP_C, MAX_TEMP_C, RH_PERCENT
//   2024, JAN, 9.6, 25.7, 79
//   2024, FEB, 11.2, 28.5, 79
//   ...
// Temperatures may be °C (typical Indian met data) — converted to °F for the app.

export interface MetDataRow {
  year: number;
  month: number; // 1-12
  minTempC: number;
  maxTempC: number;
  rh: number;
}

export interface DesignSeasonResult {
  dbtC: number;
  dbtF: number;
  rh: number;
  sourceMonth: string; // e.g. "Aug 2024"
}

export interface DesignConditionsResult {
  basis: '1%' | '4%';
  summer: DesignSeasonResult;
  winter: DesignSeasonResult;
  monsoon: DesignSeasonResult;
  rowCount: number;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parseMonth = (raw: string): number | null => {
  const t = raw.trim().toUpperCase();
  // Numeric (1-12)
  const n = Number(t);
  if (Number.isFinite(n) && n >= 1 && n <= 12) return n;
  // 3-letter abbreviation
  const idx = MONTH_NAMES.findIndex(m => m.toUpperCase() === t.slice(0, 3));
  if (idx >= 0) return idx + 1;
  return null;
};

const cToF = (c: number) => (c * 9 / 5) + 32;

/**
 * Parses pasted text into rows. Tolerant to whitespace / commas / tabs.
 * Skips header rows and rows that can't be parsed.
 */
export function parseMetData(text: string): MetDataRow[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows: MetDataRow[] = [];
  for (const line of lines) {
    // Split on tabs, commas, or 2+ spaces
    const parts = line.split(/[\t,]+|\s{2,}/).map(p => p.trim()).filter(Boolean);
    if (parts.length < 5) continue;
    const year = Number(parts[0]);
    const month = parseMonth(parts[1]);
    const minT = Number(parts[2]);
    const maxT = Number(parts[3]);
    const rh   = Number(parts[4]);
    if (!Number.isFinite(year) || year < 1900 || year > 2100) continue;
    if (month == null) continue;
    if (!Number.isFinite(minT) || !Number.isFinite(maxT) || !Number.isFinite(rh)) continue;
    rows.push({ year, month, minTempC: minT, maxTempC: maxT, rh });
  }
  return rows;
}

/**
 * Returns the value at the given percentile from a sorted ascending array.
 * percentile 99 = top 1% (basis '1%'), percentile 96 = top 4% (basis '4%').
 */
const valueAtPercentile = (sortedAsc: number[], pct: number): number => {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor((pct / 100) * (sortedAsc.length - 1))));
  return sortedAsc[idx];
};

/**
 * Derives ASHRAE-style design conditions at the selected percentile basis.
 *  - basis '1%': cooling 99th-percentile of MAX, heating 1st-percentile of MIN
 *  - basis '4%': cooling 96th-percentile of MAX, heating 4th-percentile of MIN
 *
 * Returned tempC/tempF and rh are reported with the source month/year that
 * supplied the nearest value to the percentile, so the engineer can audit.
 */
export function deriveDesignConditions(rows: MetDataRow[], basis: '1%' | '4%'): DesignConditionsResult {
  // Cooling percentile: top 1% → 99th, top 4% → 96th
  const summerPct = basis === '1%' ? 99 : 96;
  const winterPct = basis === '1%' ? 1  : 4;

  // Summer pool — all MAX values
  const summerSorted = [...rows].sort((a, b) => a.maxTempC - b.maxTempC);
  const summerTargetC = valueAtPercentile(summerSorted.map(r => r.maxTempC), summerPct);
  const summerRow = summerSorted.reduce(
    (best, r) => Math.abs(r.maxTempC - summerTargetC) < Math.abs(best.maxTempC - summerTargetC) ? r : best,
    summerSorted[summerSorted.length - 1] ?? rows[0],
  );

  // Winter pool — all MIN values
  const winterSorted = [...rows].sort((a, b) => a.minTempC - b.minTempC);
  const winterTargetC = valueAtPercentile(winterSorted.map(r => r.minTempC), winterPct);
  const winterRow = winterSorted.reduce(
    (best, r) => Math.abs(r.minTempC - winterTargetC) < Math.abs(best.minTempC - winterTargetC) ? r : best,
    winterSorted[0] ?? rows[0],
  );

  // Monsoon pool — JUN/JUL/AUG/SEP rows with high RH × MAX
  const monsoonRows = rows.filter(r => r.month >= 6 && r.month <= 9);
  // Pick the row with the highest "monsoon score" = MAX × (RH/100)
  // — biases toward simultaneously hot AND humid (worst-case dehumidification load).
  const monsoonRow = monsoonRows.length > 0
    ? monsoonRows.reduce((best, r) => (r.maxTempC * r.rh > best.maxTempC * best.rh ? r : best))
    : summerRow;
  // For monsoon, use the matching MAX as DBT (it's the design dehumidification basis)
  const monsoonTargetC = monsoonRow.maxTempC;

  // Coincident RH: for summer/winter use the source row's RH (rough but defensible
  // given monthly granularity). For monsoon use the actual high-RH row.
  return {
    basis,
    summer: {
      dbtC: Number(summerTargetC.toFixed(1)),
      dbtF: Number(cToF(summerTargetC).toFixed(1)),
      rh: summerRow.rh,
      sourceMonth: `${MONTH_NAMES[summerRow.month - 1]} ${summerRow.year}`,
    },
    winter: {
      dbtC: Number(winterTargetC.toFixed(1)),
      dbtF: Number(cToF(winterTargetC).toFixed(1)),
      rh: winterRow.rh,
      sourceMonth: `${MONTH_NAMES[winterRow.month - 1]} ${winterRow.year}`,
    },
    monsoon: {
      dbtC: Number(monsoonTargetC.toFixed(1)),
      dbtF: Number(cToF(monsoonTargetC).toFixed(1)),
      rh: monsoonRow.rh,
      sourceMonth: `${MONTH_NAMES[monsoonRow.month - 1]} ${monsoonRow.year}`,
    },
    rowCount: rows.length,
  };
}
