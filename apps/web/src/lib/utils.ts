import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms?: number): string | undefined {
  if (!ms) return undefined;
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function imageUrl(path: string | undefined, w = 300, h = 450): string | undefined {
  if (!path) return undefined;
  return `/api/image?path=${encodeURIComponent(path)}&w=${w}&h=${h}`;
}
