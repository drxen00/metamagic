import type { DiscoveredCollection } from "@metamagic/shared";
import type { PlexClient } from "./plex.js";
import { collectionPosterUrl, movieCollection, tmdbConfigured } from "./tmdb.js";
import { TmdbError } from "./tmdb.js";
import type { ProgressReporter } from "./mediux.js";

interface Bucket {
  id: number;
  name: string;
  owned: DiscoveredCollection["owned"];
  sectionId: string;
  /** How many of the owned films sit in each existing Plex collection (by normalised title). */
  collectionVotes: Map<string, number>;
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+collection\s*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Find TMDb collections the user could create: walk the movie libraries, ask
 * TMDb (cached) which collection each film belongs to, and group the franchises
 * where 2+ films are owned.
 *
 * A franchise is only *recommended* when its films aren't already grouped in a
 * Plex collection. We detect that by membership (which existing collection the
 * owned films actually live in), not just by name — a "Batman (Nolan)"
 * collection should stop us re-suggesting "The Dark Knight Collection". Ones
 * that already exist are still returned, flagged with `existing`, so the UI can
 * show "you already have this" instead of a Create button.
 */
export async function discoverCollections(
  client: PlexClient,
  report?: ProgressReporter<DiscoveredCollection>,
): Promise<DiscoveredCollection[]> {
  if (!tmdbConfigured()) {
    throw new TmdbError("Add a TMDb API key in Settings → Integrations to scan for collections.", 428);
  }

  const existing = await client.collections();
  // Normalised title → the Plex collection, for resolving membership back to a
  // real collection (item memberships only carry the collection's title).
  const existingByNorm = new Map<string, (typeof existing)[number]>();
  for (const c of existing) existingByNorm.set(normalize(c.title), c);
  const buckets = new Map<number, Bucket>();

  const sections = (await client.sections()).filter((s) => s.type === "movie");
  for (const section of sections) {
    let offset = 0;
    const limit = 200;
    for (;;) {
      const page = await client.sectionItems(section.id, { offset, limit });
      for (const item of page.items) {
        if (!item.tmdbId) continue;
        report?.setCurrent(`Checking ${item.title}…`);
        const belongs = await movieCollection(item.tmdbId).catch(() => undefined);
        if (!belongs) continue;
        const bucket = buckets.get(belongs.id) ?? {
          id: belongs.id,
          name: belongs.name,
          owned: [],
          sectionId: item.librarySectionId ?? section.id,
          collectionVotes: new Map<string, number>(),
        };
        bucket.owned.push({
          ratingKey: item.ratingKey,
          title: item.title,
          year: item.year,
          thumb: item.thumb,
        });
        // Tally which existing collections this film already belongs to.
        for (const membership of item.collections ?? []) {
          const key = normalize(membership.tag);
          bucket.collectionVotes.set(key, (bucket.collectionVotes.get(key) ?? 0) + 1);
        }
        buckets.set(belongs.id, bucket);
      }
      offset += limit;
      if (offset >= page.totalSize || page.items.length === 0) break;
    }
  }

  /** The existing collection these films already live in, if any. */
  function resolveExisting(b: Bucket): DiscoveredCollection["existing"] {
    // A collection named after the franchise is the clearest signal.
    const byName = existingByNorm.get(normalize(b.name));
    if (byName) {
      const owned = b.collectionVotes.get(normalize(byName.title)) ?? 0;
      return { ratingKey: byName.ratingKey, title: byName.title, ownedCount: owned };
    }
    // Otherwise, an existing collection that holds a strong majority of the
    // franchise's owned films (differently named, e.g. a director cut) counts.
    const need = Math.max(2, Math.ceil(b.owned.length * 0.6));
    let best: { norm: string; count: number } | undefined;
    for (const [norm, count] of b.collectionVotes) {
      if (count >= need && (!best || count > best.count)) best = { norm, count };
    }
    if (best) {
      const coll = existingByNorm.get(best.norm);
      if (coll) return { ratingKey: coll.ratingKey, title: coll.title, ownedCount: best.count };
    }
    return undefined;
  }

  const suggestions = [...buckets.values()]
    .filter((b) => b.owned.length >= 2)
    .map<DiscoveredCollection>((b) => ({
      tmdbCollectionId: b.id,
      name: b.name,
      posterUrl: collectionPosterUrl(undefined),
      owned: b.owned,
      totalParts: b.owned.length,
      sectionId: b.sectionId,
      existing: resolveExisting(b),
    }))
    // Franchises you can create come first; ones you already have sink below.
    .sort((a, b) => {
      if (!!a.existing !== !!b.existing) return a.existing ? 1 : -1;
      return b.owned.length - a.owned.length;
    });

  const creatable = suggestions.filter((s) => !s.existing).length;
  report?.log(
    `• found ${creatable} collection(s) you could create, ${suggestions.length - creatable} already in a collection`,
  );
  for (const s of suggestions) report?.push(s);
  return suggestions;
}
