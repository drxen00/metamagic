import sharp from "sharp";
import type { OverlayOptions } from "sharp";

/**
 * A simple, good-looking collection poster generator: it composites a source
 * image (a backdrop or member poster) with a dark gradient and the collection
 * title, giving MetaMagic its own poster style without lifting anyone else's
 * branded artwork. Pure — no Plex, no disk, no network.
 */

const W = 1000;
const H = 1500;
const SIDE_MARGIN = 70;
const BOTTOM_ANCHOR = 1408; // baseline of the last title line
const FONT = "DejaVu Sans, Helvetica, Arial, sans-serif";

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;",
  );
}

/** Greedy word-wrap to a max character count per line. */
function wrap(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Pick the largest font size that wraps the title into a tidy few lines. */
function fitTitle(title: string): { fontSize: number; lines: string[] } {
  const usable = W - SIDE_MARGIN * 2;
  for (const fontSize of [96, 84, 74, 64, 56]) {
    const maxChars = Math.max(6, Math.floor(usable / (fontSize * 0.6)));
    const lines = wrap(title, maxChars);
    if (lines.length <= 3) return { fontSize, lines };
  }
  const fontSize = 50;
  const maxChars = Math.max(6, Math.floor(usable / (fontSize * 0.6)));
  return { fontSize, lines: wrap(title, maxChars).slice(0, 4) };
}

function overlaySvg(title: string, accent: string): Buffer {
  const { fontSize, lines } = fitTitle(title);
  const lineHeight = Math.round(fontSize * 1.16);
  const firstBaseline = BOTTOM_ANCHOR - (lines.length - 1) * lineHeight;
  const accentY = firstBaseline - fontSize - 34;

  const textLines = lines
    .map((line, i) => {
      const y = firstBaseline + i * lineHeight;
      const safe = escapeXml(line);
      return (
        // A soft shadow copy behind the white text so it reads on bright art.
        `<text x="${W / 2}" y="${y + 3}" text-anchor="middle" font-family="${FONT}" ` +
        `font-size="${fontSize}" font-weight="bold" fill="#000000" fill-opacity="0.55">${safe}</text>` +
        `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${FONT}" ` +
        `font-size="${fontSize}" font-weight="bold" fill="#ffffff">${safe}</text>`
      );
    })
    .join("\n");

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.30" stop-color="#0a0a0f" stop-opacity="0"/>
      <stop offset="0.60" stop-color="#0a0a0f" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#0a0a0f" stop-opacity="0.97"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#grad)"/>
  <rect x="${W / 2 - 55}" y="${accentY}" width="110" height="9" rx="4.5" fill="${accent}"/>
  ${textLines}
</svg>`,
  );
}

export interface PosterOptions {
  /** Accent bar color; defaults to the MetaMagic purple. */
  accent?: string;
}

/** Compose a collection poster from source image bytes + a title. */
export async function generatePoster(
  source: Buffer,
  title: string,
  options: PosterOptions = {},
): Promise<Buffer> {
  const accent = options.accent?.trim() || "#5b36e0";
  const base = sharp(source)
    .resize(W, H, { fit: "cover", position: "attention" })
    .modulate({ brightness: 0.92 });
  const layers: OverlayOptions[] = [{ input: overlaySvg(title, accent), top: 0, left: 0 }];
  return base.composite(layers).jpeg({ quality: 90 }).toBuffer();
}

/**
 * Build a 1000×1500 mosaic of poster tiles (cover-cropped grid), for the collage
 * style. The result is a full-size image you can feed straight into
 * generatePoster() to get the gradient + title on top. Tiles cycle if there are
 * fewer than cols×rows of them.
 */
export async function composeCollageBase(
  tiles: Buffer[],
  cols = 3,
  rows = 3,
): Promise<Buffer> {
  const cellW = Math.ceil(W / cols);
  const cellH = Math.ceil(H / rows);
  const usable = tiles.filter((t) => t && t.length > 0);
  if (usable.length === 0) throw new Error("No tiles to build a collage from.");
  const layers: OverlayOptions[] = [];
  for (let i = 0; i < cols * rows; i++) {
    const tile = usable[i % usable.length];
    const buf = await sharp(tile)
      .resize(cellW, cellH, { fit: "cover", position: "attention" })
      .toBuffer();
    layers.push({ input: buf, left: (i % cols) * cellW, top: Math.floor(i / cols) * cellH });
  }
  return sharp({
    create: { width: W, height: H, channels: 3, background: { r: 10, g: 10, b: 15 } },
  })
    .composite(layers)
    .jpeg({ quality: 90 })
    .toBuffer();
}
