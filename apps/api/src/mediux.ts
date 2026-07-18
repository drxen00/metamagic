import { parse } from "yaml";
import type { MediuxMatch } from "@metamagic/shared";
import type { PlexClient } from "./plex.js";
import { EDIT_TYPE_IDS } from "./plex.js";
import { fetchRemoteImage } from "./remote-image.js";

export class MediuxError extends Error {
  status = 400;
}

export interface MediuxEntry {
  /** TMDb id for movies, TVDb id for shows */
  id: string;
  urlPoster?: string;
  urlBackground?: string;
}

/** Strip the common leading indentation MediUX copies sometimes carry. */
function dedent(text: string): string {
  const lines = text.replace(/\t/g, "  ").split("\n");
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => l.match(/^ */)![0].length);
  const min = indents.length > 0 ? Math.min(...indents) : 0;
  return min > 0 ? lines.map((l) => l.slice(min)).join("\n") : text;
}

/**
 * Parse the YAML copied from a MediUX set page. The real "Copy YAML" format
 * is id-keyed at the top level (TMDb ids for movies, TVDb ids for shows):
 *
 *   "82856":
 *     url_poster: https://api.mediux.pro/assets/…
 *     url_background: https://…
 *     seasons: …
 *
 * A Kometa-style wrapper (`metadata:` root) is accepted too.
 */
export function parseMediuxYaml(text: string): MediuxEntry[] {
  let doc: unknown;
  try {
    doc = parse(dedent(text));
  } catch {
    throw new MediuxError("That doesn't parse as YAML — copy the full YAML block from the MediUX set page.");
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new MediuxError("Expected a YAML mapping — copy the full YAML block from the MediUX set page.");
  }
  const root = doc as Record<string, unknown>;
  const map =
    root.metadata && typeof root.metadata === "object" && !Array.isArray(root.metadata)
      ? (root.metadata as Record<string, unknown>)
      : root;

  const entries: MediuxEntry[] = [];
  for (const [id, raw] of Object.entries(map)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as { url_poster?: unknown; url_background?: unknown };
    const urlPoster = typeof entry.url_poster === "string" ? entry.url_poster : undefined;
    const urlBackground =
      typeof entry.url_background === "string" ? entry.url_background : undefined;
    if (urlPoster || urlBackground) {
      entries.push({ id: String(id), urlPoster, urlBackground });
    }
  }
  if (entries.length === 0) {
    throw new MediuxError(
      "The YAML parsed, but no url_poster/url_background entries were found in it.",
    );
  }
  return entries;
}

interface IndexedItem {
  ratingKey: string;
  title: string;
  thumb?: string;
  type: string;
  sectionId: string;
}

/** Scan all movie/show sections and index items by both TMDb and TVDb ids. */
async function indexByIds(client: PlexClient): Promise<Map<string, IndexedItem>> {
  const index = new Map<string, IndexedItem>();
  for (const section of await client.sections()) {
    let offset = 0;
    const limit = 200;
    for (;;) {
      const page = await client.sectionItems(section.id, { offset, limit });
      for (const item of page.items) {
        const indexed: IndexedItem = {
          ratingKey: item.ratingKey,
          title: item.title,
          thumb: item.thumb,
          type: item.type,
          sectionId: item.librarySectionId ?? section.id,
        };
        if (item.tmdbId && !index.has(`tmdb:${item.tmdbId}`)) {
          index.set(`tmdb:${item.tmdbId}`, indexed);
        }
        if (item.tvdbId && !index.has(`tvdb:${item.tvdbId}`)) {
          index.set(`tvdb:${item.tvdbId}`, indexed);
        }
      }
      offset += limit;
      if (offset >= page.totalSize || page.items.length === 0) break;
    }
  }
  return index;
}

function lookup(index: Map<string, IndexedItem>, id: string): IndexedItem | undefined {
  return index.get(`tmdb:${id}`) ?? index.get(`tvdb:${id}`);
}

export async function previewMediux(client: PlexClient, yamlText: string): Promise<MediuxMatch[]> {
  const entries = parseMediuxYaml(yamlText);
  const index = await indexByIds(client);
  return entries.map((e) => {
    const hit = lookup(index, e.id);
    return {
      id: e.id,
      title: hit?.title,
      ratingKey: hit?.ratingKey,
      thumb: hit?.thumb,
      hasPoster: !!e.urlPoster,
      hasBackground: !!e.urlBackground,
    };
  });
}

export async function applyMediux(client: PlexClient, yamlText: string): Promise<MediuxMatch[]> {
  const entries = parseMediuxYaml(yamlText);
  const index = await indexByIds(client);
  const results: MediuxMatch[] = [];
  for (const e of entries) {
    const hit = lookup(index, e.id);
    const result: MediuxMatch = {
      id: e.id,
      title: hit?.title,
      ratingKey: hit?.ratingKey,
      thumb: hit?.thumb,
      hasPoster: !!e.urlPoster,
      hasBackground: !!e.urlBackground,
      applied: false,
    };
    if (hit) {
      try {
        const typeId = EDIT_TYPE_IDS[hit.type] ?? 1;
        if (e.urlPoster) {
          const img = await fetchRemoteImage(e.urlPoster);
          await client.uploadArtwork(hit.ratingKey, "poster", img.buffer, img.contentType);
          await client.lockArtwork(hit.sectionId, typeId, hit.ratingKey, "poster");
        }
        if (e.urlBackground) {
          const img = await fetchRemoteImage(e.urlBackground);
          await client.uploadArtwork(hit.ratingKey, "art", img.buffer, img.contentType);
          await client.lockArtwork(hit.sectionId, typeId, hit.ratingKey, "art");
        }
        result.applied = true;
      } catch (err) {
        result.error = err instanceof Error ? err.message : "Failed to apply";
      }
    } else {
      result.error = "Not found in your libraries";
    }
    results.push(result);
  }
  return results;
}
