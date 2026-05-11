import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Input } from './input';
import { cn } from '../../lib/utils';
import { ChevronDown } from 'lucide-react';

interface ComboboxInputProps {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
}

/**
 * Free-text input with optional suggestion dropdown.
 * Dropdown opens only when the user types or clicks the chevron — not on tab focus.
 * Closes on blur, Tab, or Escape.
 */
export function ComboboxInput({
  value, onChange, options, placeholder, className, inputClassName, disabled,
}: ComboboxInputProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filtered = options
    .filter(o => !value || o.toLowerCase().includes(value.toLowerCase()))
    .slice(0, 14);

  const close = useCallback(() => {
    setOpen(false);
    setHighlighted(-1);
  }, []);

  const select = useCallback((opt: string) => {
    onChange(opt);
    close();
  }, [onChange, close]);

  // Cancel pending blur close if focus returns to this component
  const handleFocusIn = () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
  };

  // Close after short delay on blur — delay lets option click fire first
  const handleBlur = () => {
    blurTimerRef.current = setTimeout(close, 120);
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlighted < 0 || !listRef.current) return;
    const el = listRef.current.children[highlighted] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  // Cleanup blur timer on unmount
  useEffect(() => () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      close();
      return; // let Tab propagate to move focus
    }
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); setHighlighted(0); return; }
      setHighlighted(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && highlighted >= 0) {
        e.preventDefault();
        select(filtered[highlighted]);
      }
    }
  };

  const toggleDropdown = () => {
    if (open) { close(); return; }
    setOpen(true);
    setHighlighted(-1);
    inputRef.current?.focus();
  };

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      onFocus={handleFocusIn}
      onBlur={handleBlur}
    >
      <div className="relative">
        <Input
          ref={inputRef}
          disabled={disabled}
          className={cn('pr-7', inputClassName)}
          placeholder={placeholder}
          value={value}
          onChange={e => {
            onChange(e.target.value);
            setOpen(true);
            setHighlighted(-1);
          }}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={toggleDropdown}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-0.5 rounded"
        >
          <ChevronDown className={cn('w-3.5 h-3.5 transition-transform duration-150', open && 'rotate-180')} />
        </button>
      </div>

      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          className="absolute z-[200] w-full mt-1 max-h-52 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl"
        >
          {filtered.map((opt, i) => (
            <button
              key={opt}
              type="button"
              tabIndex={-1}
              className={cn(
                'w-full text-left px-3 py-2 text-sm leading-tight transition-colors',
                i === highlighted
                  ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-medium'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-800 dark:text-slate-200',
                value && opt.toLowerCase() === value.toLowerCase() && i !== highlighted
                  ? 'font-medium text-slate-900 dark:text-slate-100'
                  : '',
              )}
              onMouseDown={e => { e.preventDefault(); select(opt); }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
