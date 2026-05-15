import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * Drop-in numeric input that fixes two recurring bugs:
 *   1. `parseFloat(e.target.value) || 0` snaps the field back to 0 mid-typing
 *      (the user can't type "0.", ".5", or clear the field to start over).
 *   2. `@base-ui/react` `<Input>` sometimes drops keystrokes for non-first-mounted
 *      controlled inputs — this component renders a native `<input>` instead.
 *
 * Behaviour:
 *   - Holds its own string state while focused, so partial typing ("0.", "-", "")
 *     is allowed without re-formatting.
 *   - Commits via `onChange(n)` on blur and on Enter.
 *   - Empty + `allowEmpty=true` (default) commits `undefined`; if `allowEmpty=false`
 *     an empty field reverts to the previous value.
 *   - Out-of-range or unparseable values revert on blur (no silent corruption).
 *   - Re-syncs from the external `value` prop only while unfocused, so a parent
 *     re-render mid-edit doesn't clobber the user's in-progress typing.
 */
interface NumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number | null | undefined;
  onChange: (next: number | undefined) => void;
  integer?: boolean;
  min?: number;
  max?: number;
  allowEmpty?: boolean;
}

const fmt = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '' : String(v);

export function NumericInput({
  value, onChange, integer = false, min, max, allowEmpty = true,
  className, onKeyDown, onBlur, onFocus, ...rest
}: NumericInputProps) {
  const [local, setLocal] = React.useState<string>(() => fmt(value));
  const focusedRef = React.useRef(false);

  React.useEffect(() => {
    if (!focusedRef.current) setLocal(fmt(value));
  }, [value]);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      if (allowEmpty) {
        onChange(undefined);
        setLocal('');
      } else {
        setLocal(fmt(value));
      }
      return;
    }
    const n = integer ? parseInt(trimmed, 10) : parseFloat(trimmed);
    if (!Number.isFinite(n)) { setLocal(fmt(value)); return; }
    if (min != null && n < min) { setLocal(fmt(value)); return; }
    if (max != null && n > max) { setLocal(fmt(value)); return; }
    onChange(n);
    setLocal(String(n));
  };

  return (
    <input
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onFocus={(e) => { focusedRef.current = true; onFocus?.(e); }}
      onBlur={(e) => { focusedRef.current = false; commit(e.target.value); onBlur?.(e); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        onKeyDown?.(e);
      }}
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30",
        className
      )}
      {...rest}
    />
  );
}
