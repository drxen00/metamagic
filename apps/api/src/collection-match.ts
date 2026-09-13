import type { MediaItem } from "@metamagic/shared";
import { getCollectionLink } from "./db.js";
import { movieCollection, searchTmdbCollection } from "./tmdb.js";

/** "Fast & Furious Collection" → "Fast & Furious" for external searches. */
export function cleanCollectionTitle(title: string): string {
  return title.replace(/\s+collection\s*$/i, "").trim() || title;
}

/**
 * Decide which TMDb collection a Plex collection should be measured against.
 *
 * Title search alone is unreliable (a "Middle Earth" collection matches
 * nothing; "The Lord of the Rings Collection" matches the making-of docs), so
 * prefer hard evidence: ask TMDb which collection the collection's own movies
 * belong to and take the most common answer. A user-pinned link always wins.
 */
export async function resolveTmdbCollection(
  ratingKey: string,
  title: string,
  children: MediaItem[],
): Promise<{ id: number; source: "manual" | "contents" | "title" } | undefined> {
  const pinned = getCollectionLink(ratingKey);
  if (pinned) return { id: pinned.tmdbCollectionId, source: "manual" };

  const votes = new Map<number, number>();
  for (const child of children.slice(0, 12)) {
    if (!child.tmdbId || child.type !== "movie") continue;
    const belongs = await movieCollection(child.tmdbId).catch(() => undefined);
    if (belongs) votes.set(belongs.id, (votes.get(belongs.id) ?? 0) + 1);
  }
  const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  // Require corroboration (2+ movies, or the only movie present) so a single
  // odd member can't hijack the match.
  if (winner && (winner[1] >= 2 || children.length === 1)) {
    return { id: winner[0], source: "contents" };
  }

  const byTitle = await searchTmdbCollection(cleanCollectionTitle(title)).catch(() => undefined);
  return byTitle ? { id: byTitle, source: "title" } : undefined;
}
