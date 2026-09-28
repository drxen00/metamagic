import { readFileSync } from "node:fs";
import type { LogoOption } from "@metamagic/shared";

/**
 * Brand logos for "logo" overlay badges. Sourced from Simple Icons (the SVG
 * artwork is CC0), curated to media/streaming brands. Trademarks belong to their
 * owners; these are used nominatively to label the service. Regenerate the pack
 * from the `simple-icons` devDependency.
 */
export interface LogoEntry {
  title: string;
  /** Brand hex without the leading '#'. */
  hex: string;
  viewBox: string;
  /** SVG path data (single monochrome path). */
  path: string;
}

const pack = JSON.parse(
  readFileSync(new URL("./logo-pack.json", import.meta.url), "utf8"),
) as Record<string, LogoEntry>;

/** All available logos, for the picker. */
export function listLogos(): LogoOption[] {
  return Object.entries(pack)
    .map(([slug, e]) => ({ slug, title: e.title, hex: `#${e.hex}` }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function getLogo(slug: string | undefined): LogoEntry | undefined {
  return slug ? pack[slug] : undefined;
}

/** The special "auto" sentinel resolves the item's actual streaming provider. */
export const AUTO_LOGO = "auto";

/**
 * Map a TMDb watch-provider name to a logo slug in our pack, or undefined when
 * we don't ship that provider's (CC0) logo. Matched loosely so provider-name
 * variants ("Apple TV Plus" / "Apple TV+") still resolve.
 */
export function providerToSlug(name: string): string | undefined {
  const n = name.toLowerCase();
  const rules: [RegExp, string][] = [
    [/netflix/, "netflix"],
    [/hbo\s*max/, "hbomax"],
    [/\bmax\b/, "max"],
    [/hbo/, "hbo"],
    [/paramount/, "paramountplus"],
    [/apple\s*tv/, "appletv"],
    [/crunchyroll/, "crunchyroll"],
    [/jellyfin/, "jellyfin"],
    [/\bplex\b/, "plex"],
    [/showtime/, "showtime"],
    [/starz/, "starz"],
    [/tubi/, "tubi"],
    [/youtube/, "youtube"],
  ];
  for (const [re, slug] of rules) if (re.test(n) && pack[slug]) return slug;
  return undefined;
}
