import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { Badge, BadgePosition, MediaItem, OverlayPreset } from "@metamagic/shared";
import { CONFIG_DIR } from "./env.js";
import { PlexError, EDIT_TYPE_IDS } from "./plex.js";
import type { PlexClient } from "./plex.js";
import {
  deleteOriginalArtwork,
  getOriginalArtwork,
  recordOriginalArtwork,
} from "./db.js";
import type { ProgressReporter } from "./mediux.js";

const ORIGINALS_DIR = path.join(CONFIG_DIR, "originals");
fs.mkdirSync(ORIGINALS_DIR, { recursive: true });

/** Posters are normalised to this width before compositing. */
const POSTER_WIDTH = 1000;
const POSTER_HEIGHT = 1500;

// ---------- Badge label derivation ----------

function resolutionLabel(item: MediaItem): string | undefined {
  const r = item.videoResolution?.toLowerCase();
  if (!r) return undefined;
  if (r === "4k" || r === "2160") return "4K";
  if (r === "1080") return "1080p";
  if (r === "720") return "720p";
  if (r === "480" || r === "sd") return "SD";
  return r.toUpperCase();
}

function audioLabel(item: MediaItem): string | undefined {
  const c = item.audioCodec?.toLowerCase();
  if (!c) return undefined;
  const map: Record<string, string> = {
    truehd: "TrueHD",
    eac3: "DD+",
    ac3: "DD",
    dca: "DTS",
    "dca-ma": "DTS-HD",
    dts: "DTS",
    flac: "FLAC",
    aac: "AAC",
    opus: "Opus",
    mp3: "MP3",
  };
  const base = map[c] ?? c.toUpperCase();
  return item.audioChannels && item.audioChannels >= 8 ? `${base} 7.1` : base;
}

function ratingLabel(item: MediaItem): string | undefined {
  const score = item.audienceRating ?? item.rating;
  return score ? `★ ${score.toFixed(1)}` : undefined;
}

function newLabel(item: MediaItem, badge: Badge): string | undefined {
  const days = Number(badge.value ?? "30") || 30;
  if (!item.addedAt) return undefined;
  const ageDays = (Date.now() / 1000 - item.addedAt) / 86400;
  return ageDays <= days ? "NEW" : undefined;
}

/** The text a badge shows for this item, or undefined when it doesn't apply. */
export function badgeLabel(badge: Badge, item: MediaItem): string | undefined {
  switch (badge.type) {
    case "resolution":
      return resolutionLabel(item);
    case "hdr":
      return item.hdr === "dv" ? "DOLBY VISION" : item.hdr === "hdr" ? "HDR" : undefined;
    case "audio":
      return audioLabel(item);
    case "rating":
      return ratingLabel(item);
    case "new":
      return newLabel(item, badge);
    case "text":
      return badge.value?.trim() || undefined;
  }
}

// ---------- SVG badge rendering ----------

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;",
  );
}

interface RenderedBadge {
  svg: Buffer;
  width: number;
  height: number;
  position: BadgePosition;
}

function renderBadge(badge: Badge, label: string): RenderedBadge {
  const scale = badge.scale ?? 1;
  const fontSize = Math.round(46 * scale);
  const padX = Math.round(28 * scale);
  const height = Math.round(fontSize + 34 * scale);
  // DejaVu Sans renders ~0.62em per char at this weight; pad generously so the
  // pill never clips (fontconfig metrics vary between hosts).
  const width = Math.round(label.length * fontSize * 0.64 + padX * 2);
  const radius = Math.round(height / 5);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}"
        fill="${badge.color ?? "#111827"}" fill-opacity="0.88"/>
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle"
        font-family="DejaVu Sans, Helvetica, Arial, sans-serif"
        font-size="${fontSize}" font-weight="bold" fill="#ffffff"
        letter-spacing="${1.5 * scale}">${escapeXml(label)}</text>
</svg>`;

  return { svg: Buffer.from(svg), width, height, position: badge.position ?? "bottom-right" };
}

function placement(
  position: BadgePosition,
  badgeWidth: number,
  badgeHeight: number,
  index: number,
): { left: number; top: number } {
  const margin = 34;
  // Stack multiple badges sharing a corner
  const offset = index * (badgeHeight + 16);
  const isTop = position.startsWith("top");
  const top = isTop ? margin + offset : POSTER_HEIGHT - margin - badgeHeight - offset;

  let left: number;
  if (position.endsWith("left")) left = margin;
  else if (position.endsWith("right")) left = POSTER_WIDTH - margin - badgeWidth;
  else left = Math.round((POSTER_WIDTH - badgeWidth) / 2);

  return { left: Math.max(0, left), top: Math.max(0, top) };
}

/** Composite a preset's badges onto poster bytes. Pure — no Plex, no disk. */
export async function compositePoster(
  original: Buffer,
  preset: OverlayPreset,
  item: MediaItem,
): Promise<Buffer> {
  const base = sharp(original).resize(POSTER_WIDTH, POSTER_HEIGHT, { fit: "cover" });

  const perPosition = new Map<BadgePosition, number>();
  const layers: sharp.OverlayOptions[] = [];

  for (const badge of preset.badges) {
    const label = badgeLabel(badge, item);
    if (!label) continue;
    const rendered = renderBadge(badge, label);
    const index = perPosition.get(rendered.position) ?? 0;
    perPosition.set(rendered.position, index + 1);
    const { left, top } = placement(rendered.position, rendered.width, rendered.height, index);
    layers.push({ input: rendered.svg, left, top });
  }

  return base.composite(layers).jpeg({ quality: 92 }).toBuffer();
}

// ---------- Original artwork safety net ----------

function originalPath(ratingKey: string): string {
  return path.join(ORIGINALS_DIR, `${ratingKey}.bin`);
}

/**
 * The untouched poster for an item. On first use the current Plex poster is
 * saved to /config/originals; afterwards the saved copy is returned — so
 * re-applying overlays never stacks badges on top of badges.
 */
export async function loadOriginalPoster(
  client: PlexClient,
  item: MediaItem,
  persist = true,
): Promise<{ buffer: Buffer; contentType: string }> {
  const saved = getOriginalArtwork(item.ratingKey);
  if (saved) {
    const file = path.join(ORIGINALS_DIR, saved.fileName);
    if (fs.existsSync(file)) {
      return { buffer: fs.readFileSync(file), contentType: saved.contentType };
    }
    // Record without a file (config wiped) — fall through and re-capture.
    deleteOriginalArtwork(item.ratingKey);
  }

  if (!item.thumb) throw new PlexError(`${item.title} has no poster to overlay.`, 400);
  const url = client.imageUrl(item.thumb, POSTER_WIDTH, POSTER_HEIGHT);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new PlexError(`Could not reach Plex to download the poster for ${item.title}.`, 502);
  }
  if (!res.ok) throw new PlexError(`Plex returned ${res.status} for ${item.title}'s poster.`, 502);
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";

  // Only persist as the restorable "original" during a real apply — previewing
  // must not create backups (it would inflate the restore count).
  if (persist) {
    const fileName = `${item.ratingKey}.bin`;
    fs.writeFileSync(originalPath(item.ratingKey), buffer);
    recordOriginalArtwork(item.ratingKey, fileName, contentType);
  }
  return { buffer, contentType };
}

/** Restore the stored original poster and forget the backup. */
export async function restoreOriginal(client: PlexClient, ratingKey: string): Promise<boolean> {
  const saved = getOriginalArtwork(ratingKey);
  if (!saved) return false;
  const file = path.join(ORIGINALS_DIR, saved.fileName);
  if (!fs.existsSync(file)) {
    deleteOriginalArtwork(ratingKey);
    return false;
  }
  const buffer = fs.readFileSync(file);
  await client.uploadArtwork(ratingKey, "poster", buffer, saved.contentType);
  fs.rmSync(file, { force: true });
  deleteOriginalArtwork(ratingKey);
  return true;
}

// ---------- Apply ----------

export async function applyOverlayToItem(
  client: PlexClient,
  preset: OverlayPreset,
  ratingKey: string,
): Promise<"applied" | "skipped"> {
  // Per-item metadata: needed for HDR/DV, which section listings omit.
  const item = await client.item(ratingKey);
  const applicable = preset.badges.some((b) => badgeLabel(b, item));
  if (!applicable) return "skipped";

  const { buffer } = await loadOriginalPoster(client, item);
  const composed = await compositePoster(buffer, preset, item);
  await client.uploadArtwork(ratingKey, "poster", composed, "image/jpeg");
  if (item.librarySectionId) {
    await client.lockArtwork(
      item.librarySectionId,
      EDIT_TYPE_IDS[item.type] ?? 1,
      ratingKey,
      "poster",
    );
  }
  return "applied";
}

export async function applyOverlays(
  client: PlexClient,
  preset: OverlayPreset,
  sectionId: string,
  ratingKeys: string[] | undefined,
  report?: ProgressReporter<{ ratingKey: string; title: string }>,
): Promise<{ applied: number; skipped: number; failed: number }> {
  let targets = ratingKeys;
  if (!targets) {
    targets = [];
    let offset = 0;
    const limit = 200;
    for (;;) {
      const page = await client.sectionItems(sectionId, { offset, limit });
      targets.push(...page.items.map((i) => i.ratingKey));
      offset += limit;
      if (offset >= page.totalSize || page.items.length === 0) break;
    }
  }

  let applied = 0;
  let skipped = 0;
  let failed = 0;

  for (const [i, ratingKey] of targets.entries()) {
    report?.setCurrent(`Overlaying ${i + 1}/${targets.length}…`);
    try {
      const item = await client.item(ratingKey);
      const result = await applyOverlayToItem(client, preset, ratingKey);
      if (result === "applied") {
        applied++;
        report?.log(`✓ ${item.title}`);
        report?.push({ ratingKey, title: item.title });
      } else {
        skipped++;
        report?.log(`· ${item.title} — no badges apply`);
      }
    } catch (err) {
      failed++;
      report?.log(`✗ ${ratingKey} — ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  report?.log(`• done: ${applied} overlaid, ${skipped} skipped, ${failed} failed`);
  return { applied, skipped, failed };
}

export async function restoreAll(
  client: PlexClient,
  ratingKeys: string[],
  report?: ProgressReporter<{ ratingKey: string }>,
): Promise<{ restored: number; failed: number }> {
  let restored = 0;
  let failed = 0;
  for (const [i, ratingKey] of ratingKeys.entries()) {
    report?.setCurrent(`Restoring ${i + 1}/${ratingKeys.length}…`);
    try {
      const ok = await restoreOriginal(client, ratingKey);
      if (ok) {
        restored++;
        report?.log(`✓ restored ${ratingKey}`);
      }
    } catch (err) {
      failed++;
      report?.log(`✗ ${ratingKey} — ${err instanceof Error ? err.message : "failed"}`);
    }
  }
  report?.log(`• restored ${restored}, ${failed} failed`);
  return { restored, failed };
}
