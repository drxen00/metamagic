// Regenerates src/logo-pack.json from the `simple-icons` devDependency.
// Simple Icons artwork is CC0; trademarks belong to their owners. Curated to
// media/streaming brands that Simple Icons still ships. Run: node scripts/build-logo-pack.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const icons = require("simple-icons/data/simple-icons.json");
const bySlug = Object.fromEntries(icons.map((i) => [i.slug, i]));

// Media/streaming brands. Add slugs here (must exist in simple-icons) to expand.
const SLUGS = [
  "netflix", "hbomax", "max", "hbo", "paramountplus", "appletv",
  "crunchyroll", "jellyfin", "plex", "showtime", "starz", "tubi", "youtube",
];

const pack = {};
for (const slug of SLUGS) {
  const meta = bySlug[slug];
  if (!meta) throw new Error(`slug not found in simple-icons: ${slug}`);
  const svg = readFileSync(new URL(`../node_modules/simple-icons/icons/${slug}.svg`, import.meta.url), "utf8");
  const path = svg.match(/ d="([^"]+)"/)?.[1];
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 24 24";
  if (!path) throw new Error(`no path for ${slug}`);
  pack[slug] = { title: meta.title, hex: meta.hex, viewBox, path };
}

writeFileSync(new URL("../src/logo-pack.json", import.meta.url), JSON.stringify(pack, null, 0) + "\n");
console.log(`wrote ${Object.keys(pack).length} logos to src/logo-pack.json`);
