import type { CSSProperties } from "react";

/** Paints a range slider's filled portion (see globals.css). */
export function fill(value: number, min = 0, max = 1): CSSProperties {
  const pct = ((value - min) / (max - min)) * 100;
  return { ["--fill" as string]: `${Math.max(0, Math.min(100, pct))}%` } as CSSProperties;
}
