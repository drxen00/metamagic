import { parse } from "yaml";
import type { MediuxMatch } from "@metamagic/shared";
import type { PlexClient } from "./plex.js";
import { EDIT_TYPE_IDS } from "./plex.js";

export class MediuxError extends Error {
  status = 400;
}

export interface MediuxEntry {
  tmdbId: string;
  urlPoster?: string;
  urlBackground?: string;
}

/**
 * Parse a Kometa-style YAML block copied from a MediUX set page:
 *
 *   metadata:
 *     "603692":
 *       url_poster: https://api.mediux.pro/assets/…
 *       url_background: https://…
 */
export function parseMediuxYaml(text: string): MediuxEntry[] {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch {
    throw new MediuxError("That doesn't parse as YAML — copy the full YAML block from the MediUX set page.");
  }
  const metadata = (doc as { metadata?: Record<string, unknown> } | null)?.metadata;
  if (!metadata || typeof metadata !== "object") {
    throw new MediuxError('No "metadata:" section found — copy the full YAML block from the MediUX set page.');
  }
  const entries: MediuxEntry[] = [];
  for (const [tmdbId, raw] of Object.entries(metadata)) {
    const entry = raw as { url_poster?: string; url_background?: string } | null;
    if (!entry) continue;
    if (entry.url_poster || entry.url_background) {
      entries.push({
        tmdbId: String(tmdbId),
        urlPoster: entry.url_poster,
        urlBackground: entry.url_background,
      });
    }
  }
  if (entries.length === 0) {
    throw new MediuxError("The YAML parsed, but no url_poster/url_background entries were found in it.");
  }
  return entries;
}

/** Scan all movie/show sections and index items by TMDb id. */
async function indexByTmdb(client: PlexClient): Promise<Map<string, { ratingKey: string; title: string; thumb?: string; type: string; sectionId: string }>> {
  const index = new Map<string, { ratingKey: string; title: string; thumb?: string; type: string; sectionId: string }>();
  for (const section of await client.sections()) {
    let offset = 0;
    const limit = 200;
    for (;;) {
      const page = await client.sectionItems(section.id, { offset, limit });
      for (const item of page.items) {
        if (item.tmdbId && !index.has(item.tmdbId)) {
          index.set(item.tmdbId, {
            ratingKey: item.ratingKey,
            title: item.title,
            thumb: item.thumb,
            type: item.type,
            sectionId: item.librarySectionId ?? section.id,
          });
        }
      }
      offset += limit;
      if (offset >= page.totalSize || page.items.length === 0) break;
    }
  }
  return index;
}

export async function previewMediux(client: PlexClient, yamlText: string): Promise<MediuxMatch[]> {
  const entries = parseMediuxYaml(yamlText);
  const index = await indexByTmdb(client);
  return entries.map((e) => {
    const hit = index.get(e.tmdbId);
    return {
      tmdbId: e.tmdbId,
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
  const index = await indexByTmdb(client);
  const results: MediuxMatch[] = [];
  for (const e of entries) {
    const hit = index.get(e.tmdbId);
    const result: MediuxMatch = {
      tmdbId: e.tmdbId,
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
          await client.setArtwork(hit.ratingKey, "poster", e.urlPoster);
          await client.lockArtwork(hit.sectionId, typeId, hit.ratingKey, "poster");
        }
        if (e.urlBackground) {
          await client.setArtwork(hit.ratingKey, "art", e.urlBackground);
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
