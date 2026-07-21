"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "./input";

const SWATCHES = ["#111827", "#1d4ed8", "#7c3aed", "#b45309", "#16a34a", "#be123c", "#0891b2", "#db2777"];

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { h: 220, s: 50, l: 20 };
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Inline color picker — a clearly rainbow-tinted trigger that opens a small
 * in-page popover with hue/saturation/lightness sliders, swatches and a hex
 * field. Never opens the OS color dialog.
 */
export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const hsl = hexToHsl(value);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const set = (patch: Partial<{ h: number; s: number; l: number }>) =>
    onChange(hslToHex(patch.h ?? hsl.h, patch.s ?? hsl.s, patch.l ?? hsl.l));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Pick a color"
        aria-label="Pick a color"
        className="relative h-7 w-7 shrink-0 rounded-full border border-border transition-transform hover:scale-105"
        style={{
          // Rainbow conic gradient so it's obviously a color wheel, with the
          // current color as a solid center dot.
          background: `conic-gradient(from 0deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)`,
        }}
      >
        <span
          className="absolute inset-1.5 rounded-full border border-white/40"
          style={{ backgroundColor: value }}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-50 w-60 space-y-3 rounded-lg border border-border bg-popover p-3 shadow-xl">
          <div
            className="h-8 w-full rounded-md border border-border/60"
            style={{ backgroundColor: value }}
          />
          <Slider
            label="Hue"
            min={0}
            max={360}
            value={hsl.h}
            onChange={(h) => set({ h })}
            track="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
          />
          <Slider
            label="Saturation"
            min={0}
            max={100}
            value={hsl.s}
            onChange={(s) => set({ s })}
            track={`linear-gradient(to right, ${hslToHex(hsl.h, 0, hsl.l)}, ${hslToHex(hsl.h, 100, hsl.l)})`}
          />
          <Slider
            label="Lightness"
            min={0}
            max={100}
            value={hsl.l}
            onChange={(l) => set({ l })}
            track={`linear-gradient(to right, #000, ${hslToHex(hsl.h, hsl.s, 50)}, #fff)`}
          />
          <div className="flex flex-wrap gap-1.5">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange(c)}
                style={{ backgroundColor: c }}
                className={cn(
                  "h-5 w-5 rounded-full border transition-transform hover:scale-110",
                  value.toLowerCase() === c ? "border-primary ring-2 ring-primary" : "border-border",
                )}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-7 font-mono text-xs"
          />
        </div>
      )}
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  onChange,
  track,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  track: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full"
        style={{ background: track }}
      />
    </label>
  );
}
