import { parse } from "yaml";
import type { MediuxMatch } from "@metamagic/shared";
import type { PlexClient } from "./plex.js";
import { EDIT_TYPE_IDS } from "./plex.js";
import { fetchRemoteImage } from "./remote-image.js";
import { recordArtworkSource } from "./db.js";

/** MediUX "Copy YAML" embeds the set link in a comment — pull it out for provenance. */
export function extractSetUrl(yamlText: string): { url?: string; label: string } {
  const m = yamlText.match(/https?:\/\/(?:www\.)?mediux\.pro\/sets\/(\d+)/i);
  if (m) return { url: `https://mediux.pro/sets/${m[1]}`, label: `MediUX set ${m[1]}` };
  return { label: "MediUX YAML" };
}

export class MediuxError extends Error {
  status = 400;
}

export interface MediuxSeason {
  urlPoster?: string;
  /** episode number -> title card URL */
  episodes: Record<string, string>;
}

export interface MediuxEntry {
  /** TMDb id for movies, TVDb id for shows */
  id: string;
  urlPoster?: string;
  urlBackground?: string;
  /** season number -> season assets */
  seasons: Record<string, MediuxSeason>;
}

export interface MediuxCollectionEntry {
  name: string;
  urlPoster?: string;
  urlBackground?: string;
}

export interface MediuxSet {
  entries: MediuxEntry[];
  collections: MediuxCollectionEntry[];
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function isMap(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
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

function parseSeasons(raw: unknown): Record<string, MediuxSeason> {
  const seasons: Record<string, MediuxSeason> = {};
  if (!isMap(raw)) return seasons;
  for (const [num, sRaw] of Object.entries(raw)) {
    if (!isMap(sRaw)) continue;
    const episodes: Record<string, string> = {};
    if (isMap(sRaw.episodes)) {
      for (const [eNum, eRaw] of Object.entries(sRaw.episodes)) {
        const url = isMap(eRaw) ? str(eRaw.url_poster) : undefined;
        if (url) episodes[eNum] = url;
      }
    }
    const urlPoster = str(sRaw.url_poster);
    if (urlPoster || Object.keys(episodes).length > 0) {
      seasons[num] = { urlPoster, episodes };
    }
  }
  return seasons;
}

/**
 * Parse the YAML copied from a MediUX set page. The real "Copy YAML" format
 * is id-keyed at the top level (TMDb ids for movies, TVDb ids for shows),
 * with optional per-season posters and per-episode title cards, plus an
 * optional Kometa-style `collections:` block keyed by collection name.
 * A `metadata:` wrapper is accepted too.
 */
export function parseMediuxYaml(text: string): MediuxSet {
  let doc: unknown;
  try {
    doc = parse(dedent(text));
  } catch {
    throw new MediuxError("That doesn't parse as YAML — copy the full YAML block from the MediUX set page.");
  }
  if (!isMap(doc)) {
    throw new MediuxError("Expected a YAML mapping — copy the full YAML block from the MediUX set page.");
  }

  const collections: MediuxCollectionEntry[] = [];
  if (isMap(doc.collections)) {
    for (const [name, raw] of Object.entries(doc.collections)) {
      if (!isMap(raw)) continue;
      const urlPoster = str(raw.url_poster);
      const urlBackground = str(raw.url_background);
      if (urlPoster || urlBackground) collections.push({ name, urlPoster, urlBackground });
    }
  }

  const itemMap = isMap(doc.metadata) ? doc.metadata : doc;
  const entries: MediuxEntry[] = [];
  for (const [id, raw] of Object.entries(itemMap)) {
    if (id === "collections" || id === "metadata") continue;
    if (!isMap(raw)) continue;
    const urlPoster = str(raw.url_poster);
    const urlBackground = str(raw.url_background);
    const seasons = parseSeasons(raw.seasons);
    if (urlPoster || urlBackground || Object.keys(seasons).length > 0) {
      entries.push({ id: String(id), urlPoster, urlBackground, seasons });
    }
  }

  // MediUX copies often put the id line at the SAME indent as its assets
  // ("360893:" followed by sibling url_poster/seasons keys). YAML then parses
  // the id as a null-valued key with the assets at root — reassemble that.
  if (entries.length === 0) {
    const urlPoster = str(itemMap.url_poster);
    const urlBackground = str(itemMap.url_background);
    const seasons = parseSeasons(itemMap.seasons);
    if (urlPoster || urlBackground || Object.keys(seasons).length > 0) {
      const idKey = Object.entries(itemMap).find(
        ([k, v]) => v === null && /^\d+$/.test(k),
      )?.[0];
      if (idKey) {
        entries.push({ id: idKey, urlPoster, urlBackground, seasons });
      }
    }
  }

  if (entries.length === 0 && collections.length === 0) {
    throw new MediuxError(
      "The YAML parsed, but no url_poster/url_background entries were found in it.",
    );
  }
  return { entries, collections };
}

function seasonCount(e: MediuxEntry): number {
  return Object.values(e.seasons).filter((s) => s.urlPoster).length;
}

function episodeCount(e: MediuxEntry): number {
  return Object.values(e.seasons).reduce((n, s) => n + Object.keys(s.episodes).length, 0);
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

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+collection\s*$/, "").trim();
}

async function findCollection(client: PlexClient, name: string) {
  const all = await client.collections();
  const target = normalizeName(name);
  return all.find((c) => normalizeName(c.title) === target);
}

async function applyImage(
  client: PlexClient,
  ratingKey: string,
  kind: "poster" | "art",
  url: string,
  sectionId: string | undefined,
  typeId: number,
): Promise<void> {
  const img = await fetchRemoteImage(url);
  await client.uploadArtwork(ratingKey, kind, img.buffer, img.contentType);
  if (sectionId) await client.lockArtwork(sectionId, typeId, ratingKey, kind);
}

export async function previewMediux(client: PlexClient, yamlText: string): Promise<MediuxMatch[]> {
  const set = parseMediuxYaml(yamlText);
  const index = await indexByIds(client);
  const results: MediuxMatch[] = [];

  for (const c of set.collections) {
    const hit = await findCollection(client, c.name);
    results.push({
      id: c.name,
      kind: "collection",
      title: hit?.title ?? c.name,
      ratingKey: hit?.ratingKey,
      thumb: hit?.thumb,
      hasPoster: !!c.urlPoster,
      hasBackground: !!c.urlBackground,
      seasonCount: 0,
      episodeCount: 0,
    });
  }

  for (const e of set.entries) {
    const hit = lookup(index, e.id);
    results.push({
      id: e.id,
      kind: "item",
      title: hit?.title,
      ratingKey: hit?.ratingKey,
      thumb: hit?.thumb,
      hasPoster: !!e.urlPoster,
      hasBackground: !!e.urlBackground,
      seasonCount: seasonCount(e),
      episodeCount: episodeCount(e),
    });
  }
  return results;
}

export interface ProgressReporter<T> {
  setCurrent: (line: string) => void;
  push: (result: T) => void;
}

export async function applyMediux(
  client: PlexClient,
  yamlText: string,
  report?: ProgressReporter<MediuxMatch>,
): Promise<MediuxMatch[]> {
  const set = parseMediuxYaml(yamlText);
  report?.setCurrent("Scanning your libraries…");
  const index = await indexByIds(client);
  const origin = extractSetUrl(yamlText);
  const results: MediuxMatch[] = [];
  const total = set.collections.length + set.entries.length;
  let done = 0;

  for (const c of set.collections) {
    report?.setCurrent(`Applying collection “${c.name}” (${++done}/${total})…`);
    const hit = await findCollection(client, c.name);
    const result: MediuxMatch = {
      id: c.name,
      kind: "collection",
      title: hit?.title ?? c.name,
      ratingKey: hit?.ratingKey,
      thumb: hit?.thumb,
      hasPoster: !!c.urlPoster,
      hasBackground: !!c.urlBackground,
      seasonCount: 0,
      episodeCount: 0,
      applied: false,
    };
    if (hit) {
      try {
        const typeId = EDIT_TYPE_IDS.collection;
        if (c.urlPoster) {
          await applyImage(client, hit.ratingKey, "poster", c.urlPoster, hit.sectionId, typeId);
          recordArtworkSource(hit.ratingKey, "poster", "mediux", origin.label, origin.url);
        }
        if (c.urlBackground) {
          await applyImage(client, hit.ratingKey, "art", c.urlBackground, hit.sectionId, typeId);
          recordArtworkSource(hit.ratingKey, "art", "mediux", origin.label, origin.url);
        }
        result.applied = true;
      } catch (err) {
        result.error = err instanceof Error ? err.message : "Failed to apply";
      }
    } else {
      result.error = "No matching collection in Plex";
    }
    results.push(result);
    report?.push(result);
  }

  for (const e of set.entries) {
    const hit = lookup(index, e.id);
    report?.setCurrent(
      `Applying ${hit?.title ?? `id ${e.id}`} (${++done}/${total})…`,
    );
    const result: MediuxMatch = {
      id: e.id,
      kind: "item",
      title: hit?.title,
      ratingKey: hit?.ratingKey,
      thumb: hit?.thumb,
      hasPoster: !!e.urlPoster,
      hasBackground: !!e.urlBackground,
      seasonCount: seasonCount(e),
      episodeCount: episodeCount(e),
      applied: false,
      appliedSeasons: 0,
      appliedEpisodes: 0,
    };
    if (!hit) {
      result.error = "Not found in your libraries";
      results.push(result);
      report?.push(result);
      continue;
    }

    const typeId = EDIT_TYPE_IDS[hit.type] ?? 1;
    const failures: string[] = [];
    try {
      if (e.urlPoster) {
        await applyImage(client, hit.ratingKey, "poster", e.urlPoster, hit.sectionId, typeId);
        recordArtworkSource(hit.ratingKey, "poster", "mediux", origin.label, origin.url);
      }
      if (e.urlBackground) {
        await applyImage(client, hit.ratingKey, "art", e.urlBackground, hit.sectionId, typeId);
        recordArtworkSource(hit.ratingKey, "art", "mediux", origin.label, origin.url);
      }
      result.applied = true;
    } catch (err) {
      failures.push(err instanceof Error ? err.message : "poster/background failed");
    }

    if (Object.keys(e.seasons).length > 0 && hit.type === "show") {
      try {
        const plexSeasons = await client.children(hit.ratingKey);
        for (const [num, sd] of Object.entries(e.seasons)) {
          const season = plexSeasons.find((s) => s.index === Number(num));
          if (!season) {
            failures.push(`season ${num} not in Plex`);
            continue;
          }
          if (sd.urlPoster) {
            try {
              await applyImage(
                client,
                season.ratingKey,
                "poster",
                sd.urlPoster,
                hit.sectionId,
                EDIT_TYPE_IDS.season,
              );
              result.appliedSeasons = (result.appliedSeasons ?? 0) + 1;
              result.applied = true;
            } catch {
              failures.push(`season ${num} poster failed`);
            }
          }
          const episodeEntries = Object.entries(sd.episodes);
          if (episodeEntries.length > 0) {
            const plexEpisodes = await client.children(season.ratingKey);
            for (const [eNum, url] of episodeEntries) {
              const episode = plexEpisodes.find((p) => p.index === Number(eNum));
              if (!episode) {
                failures.push(`s${num}e${eNum} not in Plex`);
                continue;
              }
              try {
                await applyImage(
                  client,
                  episode.ratingKey,
                  "poster",
                  url,
                  hit.sectionId,
                  EDIT_TYPE_IDS.episode,
                );
                result.appliedEpisodes = (result.appliedEpisodes ?? 0) + 1;
                result.applied = true;
              } catch {
                failures.push(`s${num}e${eNum} card failed`);
              }
            }
          }
        }
      } catch (err) {
        failures.push(err instanceof Error ? err.message : "season traversal failed");
      }
    }

    if (failures.length > 0) result.error = failures.slice(0, 4).join("; ");
    results.push(result);
    report?.push(result);
  }
  return results;
}
