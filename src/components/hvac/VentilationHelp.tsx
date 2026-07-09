import { useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';

/**
 * Small "?" help popover shown beside the Recirculation input. Plain-English guide that
 * maps each client's fresh-air / recirculation requirement to the two numbers the engineer
 * types (Fresh air ACH + Recirculation %). No calc/logic — pure guidance, so it can never
 * change a result. Click to open; click outside or Esc to close.
 */
export function VentilationHelp() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label="How to enter fresh air & recirculation"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center justify-center text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-[22rem] max-w-[85vw] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-left shadow-xl">
          <p className="text-xs font-bold text-slate-800 dark:text-slate-100 normal-case tracking-normal">
            Fresh air &amp; Recirculation — what to enter
          </p>
          <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 normal-case tracking-normal">
            Enter two numbers: <b>Fresh air</b> (outdoor, in ACH) and <b>Recirculation</b> (%).
            Match your client&rsquo;s requirement below.
          </p>
          <ol className="mt-2 space-y-1.5 text-[11px] text-slate-700 dark:text-slate-200 normal-case tracking-normal">
            <li>
              <b>&ldquo;2 FACPH + 50% recirculation&rdquo;</b> (e.g. GURT) → Fresh = <b>2</b>, Recirc = <b>50%</b>. Enter the % as given — no maths.
            </li>
            <li>
              <b>&ldquo;2 FACPH + 75% recirculation&rdquo;</b> (e.g. SSC) → Fresh = <b>2</b>, Recirc = <b>75%</b>.
            </li>
            <li>
              <b>&ldquo;1 FACPH + 5 ACH recirculation&rdquo;</b> (e.g. BOCC) → recirc is in ACH, so convert:
              Recirc % = 5 ÷ (1 + 5) = <b>83%</b>. Enter Fresh = <b>1</b>, Recirc = <b>83%</b>. (Total = 6 ACH.)
            </li>
            <li>
              <b>&ldquo;25% fresh air of total&rdquo;</b> (e.g. Igloo) → fresh is a share of total, so:
              Recirc % = 100 − 25 = <b>75%</b>. Enter Fresh = your outdoor-air ACH, Recirc = <b>75%</b>.
            </li>
            <li>
              <b>Normal project</b> — fresh air on the unit, no recirc given → Fresh = your FACPH, leave
              Recirc = <b>0</b>. The app uses the higher of the space-type air-change and your fresh air.
            </li>
          </ol>
          <div className="mt-2 border-t border-slate-200 dark:border-slate-700 pt-2 text-[11px] text-slate-600 dark:text-slate-300 normal-case tracking-normal">
            <p className="font-semibold text-slate-700 dark:text-slate-200">Quick rules</p>
            <ul className="mt-1 space-y-0.5 list-disc pl-4">
              <li>Recirc given as <b>%</b> → type it straight in.</li>
              <li>Recirc given as <b>ACH</b> → Recirc % = recirc ÷ (fresh + recirc).</li>
              <li>Fresh given as <b>% of total</b> → Recirc % = 100 − that %.</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
