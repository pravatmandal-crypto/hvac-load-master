import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { useRef, useCallback } from "react"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function useDebounce<T extends (...args: any[]) => any>(fn: T, delayMs: number = 600): T {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  return useCallback((...args: any[]) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      fn(...args);
    }, delayMs);
  }, [fn, delayMs]) as T;
}
