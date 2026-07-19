import type { TpdbSetResult } from "@metamagic/shared";
import type { PlexClient } from "./plex.js";
import type { ProgressReporter } from "./mediux.js";
import { EDIT_TYPE_IDS, PlexError } from "./plex.js";
import { fetchRemoteImage } from "./remote-image.js";
import { recordArtworkSource } from "./db.js";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

export interface TpdbSetEntry {
  posterId: string;
  type: "movie" | "show" | "collection" | string;
  title: string;
  year?: number;
}

const ENTRY_RE =
  /data-poster-id='(\d+)'\s+data-poster-type='(\w+)'[\s\S]{0,900}?<p class="p-0 mb-1 text-break">([^<]+)<\/p>/g;

export function parseTpdbSetUrl(url: string): string | undefined {
  return url.match(/^https?:\/\/(?:www\.)?theposterdb\.com\/set\/(\d+)/i)?.[1];
}

export async function fetchTpdbSet(setId: string): Promise<TpdbSetEntry[]> {
  let res: Response;
  try {
    res = await fetch(`https://theposterdb.com/set/${setId}`, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new PlexError("Could not reach ThePosterDB.", 502);
  }
  if (!res.ok) {
    throw new PlexError(`ThePosterDB returned ${res.status} for that set.`, 502);
  }
  const html = await res.text();
  const entries: TpdbSetEntry[] = [];
  for (const m of html.matchAll(ENTRY_RE)) {
    const raw = m[3].trim();
    const yearMatch = raw.match(/^(.*)\s+\((\d{4})\)$/);
    entries.push({
      posterId: m[1],
      type: m[2],
      title: yearMatch ? yearMatch[1] : raw,
      year: yearMatch ? Number(yearMatch[2]) : undefined,
    });
  }
  if (entries.length === 0) {
    throw new PlexError("Couldn't find any posters on that set page — is the link a /set/ URL?", 400);
  }
  return entries;
}

function normalize(title: string): string {
  return title
    .toLowerCase()
    .replace(/[:'’!.,–-]/g, "")
    .replace(/\s+collection\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Apply a whole TPDb set to a collection: the set's collection poster goes on
 * the collection, and each movie/show poster is matched against the
 * collection's children by title (+year when present).
 */
export async function applyTpdbSetToCollection(
  client: PlexClient,
  collectionRatingKey: string,
  setUrl: string,
  report?: ProgressReporter<TpdbSetResult>,
): Promise<TpdbSetResult[]> {
  const setId = parseTpdbSetUrl(setUrl);
  if (!setId) throw new PlexError("That's not a ThePosterDB set link.", 400);

  report?.setCurrent("Fetching the set from ThePosterDB…");
  const entries = await fetchTpdbSet(setId);
  const collection = await client.item(collectionRatingKey);
  const children = await client.collectionChildren(collectionRatingKey);
  const results: TpdbSetResult[] = [];
  const pageUrl = `https://theposterdb.com/set/${setId}`;
  const emit = (r: TpdbSetResult) => {
    results.push(r);
    report?.push(r);
  };

  const applyPoster = async (ratingKey: string, posterId: string, typeId: number, sectionId?: string) => {
    const img = await fetchRemoteImage(`https://theposterdb.com/api/assets/${posterId}`);
    await client.uploadArtwork(ratingKey, "poster", img.buffer, img.contentType);
    if (sectionId) await client.lockArtwork(sectionId, typeId, ratingKey, "poster");
    recordArtworkSource(ratingKey, "poster", "tpdb", `ThePosterDB set ${setId}`, pageUrl);
  };

  // Collection poster: prefer the entry matching the collection's name, else
  // the first collection-type poster in the set.
  const collectionEntries = entries.filter((e) => e.type === "collection");
  const collectionEntry =
    collectionEntries.find((e) => normalize(e.title) === normalize(collection.title)) ??
    collectionEntries[0];
  if (collectionEntry) {
    try {
      await applyPoster(
        collectionRatingKey,
        collectionEntry.posterId,
        EDIT_TYPE_IDS.collection,
        collection.librarySectionId,
      );
      emit({ title: `${collectionEntry.title} (collection poster)`, status: "applied" });
    } catch (err) {
      emit({
        title: `${collectionEntry.title} (collection poster)`,
        status: "failed",
        error: err instanceof Error ? err.message : "failed",
      });
    }
  }

  for (const entry of entries.filter((e) => e.type === "movie" || e.type === "show")) {
    const child = children.find(
      (c) =>
        normalize(c.title) === normalize(entry.title) &&
        (entry.year === undefined || c.year === undefined || c.year === entry.year),
    );
    const label = entry.year ? `${entry.title} (${entry.year})` : entry.title;
    report?.setCurrent(`Applying ${label}…`);
    if (!child) {
      emit({ title: label, status: "no-match" });
      continue;
    }
    try {
      await applyPoster(
        child.ratingKey,
        entry.posterId,
        EDIT_TYPE_IDS[child.type] ?? 1,
        child.librarySectionId ?? collection.librarySectionId,
      );
      emit({ title: label, status: "applied" });
    } catch (err) {
      emit({
        title: label,
        status: "failed",
        error: err instanceof Error ? err.message : "failed",
      });
    }
  }
  return results;
}
