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
 * TMDb (cached) which collection each film belongs to, and keep the franchises
 * where 2+ films are owned but no Plex collection exists yet.
 */
export async function discoverCollections(
  client: PlexClient,
  report?: ProgressReporter<DiscoveredCollection>,
): Promise<DiscoveredCollection[]> {
  if (!tmdbConfigured()) {
    throw new TmdbError("Add a TMDb API key in Settings → Integrations to scan for collections.", 428);
  }

  const existing = await client.collections();
  const existingNames = new Set(existing.map((c) => normalize(c.title)));
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
        };
        bucket.owned.push({
          ratingKey: item.ratingKey,
          title: item.title,
          year: item.year,
          thumb: item.thumb,
        });
        buckets.set(belongs.id, bucket);
      }
      offset += limit;
      if (offset >= page.totalSize || page.items.length === 0) break;
    }
  }

  const suggestions = [...buckets.values()]
    .filter((b) => b.owned.length >= 2 && !existingNames.has(normalize(b.name)))
    .map<DiscoveredCollection>((b) => ({
      tmdbCollectionId: b.id,
      name: b.name,
      posterUrl: collectionPosterUrl(undefined),
      owned: b.owned,
      totalParts: b.owned.length,
      sectionId: b.sectionId,
    }))
    .sort((a, b) => b.owned.length - a.owned.length);

  report?.log(`• found ${suggestions.length} collection(s) you could create`);
  for (const s of suggestions) report?.push(s);
  return suggestions;
}
