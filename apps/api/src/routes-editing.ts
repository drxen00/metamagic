import type { FastifyInstance } from "fastify";
import {
  applyArtworkSchema,
  editCollectionSchema,
  editItemSchema,
  integrationsSchema,
  linkCollectionSchema,
  mediuxImportSchema,
  tpdbSetSchema,
} from "@metamagic/shared";
import type {
  ArtworkLinks,
  ArtworkOption,
  ArtworkProvenance,
  CollectionCompleteness,
  IntegrationsStatus,
  MediaItem,
  MissingCollectionItem,
} from "@metamagic/shared";
import { requirePlex } from "./client-store.js";
import { EDIT_TYPE_IDS, PlexError } from "./plex.js";
import {
  deleteCollectionLink,
  getAppSetting,
  getArtworkSources,
  getCollectionLink,
  recordArtworkSource,
  setAppSetting,
  setCollectionLink,
} from "./db.js";
import {
  getTmdbCollectionParts,
  movieCollection,
  searchTmdbCollection,
  searchTmdbCollections,
  tmdbArtwork,
  tmdbSeasonArtwork,
  validateTmdbKey,
} from "./tmdb.js";
import { indexByIds } from "./mediux.js";
import { applyMediux, previewMediux } from "./mediux.js";
import { fetchRemoteImage } from "./remote-image.js";
import { startJob, getJob } from "./jobs.js";
import { applyTpdbSetToCollection } from "./tpdb.js";

function editTypeId(itemType: string): number {
  const id = EDIT_TYPE_IDS[itemType];
  if (!id) throw new PlexError(`Editing is not supported for type "${itemType}"`, 400);
  return id;
}

/** "Fast & Furious Collection" → "Fast & Furious" for external searches. */
function cleanCollectionTitle(title: string): string {
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
async function resolveTmdbCollection(
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

/** Classify a user-supplied "where's it from" page link into a provenance entry. */
function classifySourcePage(pageUrl: string): { source: string; label: string; url?: string } {
  const mediuxSet = pageUrl.match(/^https?:\/\/(?:www\.)?mediux\.pro\/sets\/(\d+)/i);
  if (mediuxSet) {
    return {
      source: "mediux",
      label: `MediUX set ${mediuxSet[1]}`,
      url: `https://mediux.pro/sets/${mediuxSet[1]}`,
    };
  }
  if (/^https?:\/\/(?:www\.)?mediux\.pro\//i.test(pageUrl)) {
    return { source: "mediux", label: "MediUX", url: pageUrl };
  }
  if (/^https?:\/\/(?:www\.)?theposterdb\.com\//i.test(pageUrl)) {
    return { source: "tpdb", label: "ThePosterDB", url: pageUrl };
  }
  try {
    return { source: "url", label: new URL(pageUrl).hostname, url: pageUrl };
  } catch {
    return { source: "url", label: "External URL" };
  }
}

/** Classify an applied artwork URL into a provenance entry. */
function classifyArtworkUrl(
  rawUrl: string,
  item: MediaItem,
): { source: string; label: string; url?: string } {
  const tpdbPage = rawUrl.match(/^https?:\/\/(?:www\.)?theposterdb\.com\/poster\/(\d+)/i);
  if (tpdbPage) {
    return { source: "tpdb", label: "ThePosterDB", url: `https://theposterdb.com/poster/${tpdbPage[1]}` };
  }
  const tpdbAsset = rawUrl.match(/^https?:\/\/(?:www\.)?theposterdb\.com\/api\/assets\/(\d+)/i);
  if (tpdbAsset) {
    return { source: "tpdb", label: "ThePosterDB", url: `https://theposterdb.com/poster/${tpdbAsset[1]}` };
  }
  if (/^https?:\/\/image\.tmdb\.org\//i.test(rawUrl)) {
    const url = item.tmdbId
      ? `https://www.themoviedb.org/${item.type === "show" ? "tv" : "movie"}/${item.tmdbId}/images/posters`
      : undefined;
    return { source: "tmdb", label: "TMDb", url };
  }
  if (/^https?:\/\/api\.mediux\.pro\//i.test(rawUrl)) {
    // Keep the pasted asset link — no set page is derivable from it, but a
    // link back to the exact image is still useful provenance.
    return { source: "mediux", label: "MediUX", url: rawUrl };
  }
  try {
    return { source: "url", label: new URL(rawUrl).hostname, url: rawUrl };
  } catch {
    return { source: "url", label: "External URL" };
  }
}

export function registerEditingRoutes(app: FastifyInstance): void {
  // ---------- Metadata editing ----------

  app.put<{ Params: { ratingKey: string } }>("/api/items/:ratingKey/edit", async (req) => {
    const input = editItemSchema.parse(req.body);
    const client = requirePlex();
    const item = await client.item(req.params.ratingKey);
    if (!item.librarySectionId) {
      throw new PlexError("Could not determine the item's library section.", 500);
    }
    const typeId = editTypeId(item.type);

    const params: Record<string, string | number> = {
      ...client.buildFieldParams({
        title: input.title,
        titleSort: input.titleSort,
        summary: input.summary,
      }),
      ...(input.addLabels?.length || input.removeLabels?.length
        ? client.buildTagParams("label", item.labels ?? [], input.addLabels, input.removeLabels)
        : {}),
      ...(input.addGenres?.length || input.removeGenres?.length
        ? client.buildTagParams("genre", item.genres ?? [], input.addGenres, input.removeGenres)
        : {}),
    };
    if (Object.keys(params).length === 0) return { ok: true };

    await client.editMetadata(item.librarySectionId, typeId, req.params.ratingKey, params);
    return { ok: true };
  });

  app.put<{ Params: { ratingKey: string } }>("/api/collections/:ratingKey/edit", async (req) => {
    const input = editCollectionSchema.parse(req.body);
    const client = requirePlex();
    const item = await client.item(req.params.ratingKey);
    if (!item.librarySectionId) {
      throw new PlexError("Could not determine the collection's library section.", 500);
    }
    const params = client.buildFieldParams({ title: input.title, summary: input.summary });
    if (Object.keys(params).length === 0) return { ok: true };
    await client.editMetadata(
      item.librarySectionId,
      EDIT_TYPE_IDS.collection,
      req.params.ratingKey,
      params,
    );
    return { ok: true };
  });

  // ---------- Artwork ----------

  app.get<{ Params: { ratingKey: string }; Querystring: { kind?: string; source?: string } }>(
    "/api/items/:ratingKey/artwork",
    async (req): Promise<ArtworkOption[]> => {
      const kind = req.query.kind === "art" ? "art" : "poster";
      const source = req.query.source ?? "plex";
      const client = requirePlex();

      if (source === "plex") {
        const options = await client.listArtwork(req.params.ratingKey, kind);
        return options.map((o) => {
          const preview = o.thumb ?? o.key;
          return {
            applyUrl: o.ratingKey ?? o.key,
            // Agent artwork often carries remote (e.g. image.tmdb.org) URLs the
            // browser can load directly; only Plex-relative paths need the proxy.
            previewUrl: /^https?:\/\//i.test(preview)
              ? preview
              : `/api/image?path=${encodeURIComponent(preview)}&w=300&h=450`,
            provider: o.provider ?? "plex",
            selected: o.selected,
          };
        });
      }

      if (source === "tmdb") {
        const item = await client.item(req.params.ratingKey);
        if (item.type === "season") {
          if (!item.parentRatingKey || item.index === undefined) {
            throw new PlexError("Could not resolve this season's show.", 404);
          }
          const show = await client.item(item.parentRatingKey);
          if (!show.tmdbId) {
            throw new PlexError("The parent show has no TMDb id in Plex.", 404);
          }
          return tmdbSeasonArtwork(show.tmdbId, item.index, kind);
        }
        if (item.type === "collection") {
          const collectionId = await searchTmdbCollection(cleanCollectionTitle(item.title));
          if (!collectionId) {
            throw new PlexError(
              `TMDb has no collection matching “${cleanCollectionTitle(item.title)}”.`,
              404,
            );
          }
          return tmdbArtwork(String(collectionId), "collection", kind);
        }
        if (!item.tmdbId) {
          throw new PlexError("This item has no TMDb id in Plex (is it matched to an agent?).", 404);
        }
        return tmdbArtwork(item.tmdbId, item.type === "show" ? "tv" : "movie", kind);
      }

      throw new PlexError(`Unknown artwork source "${source}"`, 400);
    },
  );

  // Children of a show (seasons) or season (episodes)
  app.get<{ Params: { ratingKey: string } }>("/api/items/:ratingKey/children", async (req) =>
    requirePlex().children(req.params.ratingKey),
  );

  // Where the current artwork came from (recorded on every apply)
  app.get<{ Params: { ratingKey: string } }>(
    "/api/items/:ratingKey/provenance",
    async (req): Promise<ArtworkProvenance> => getArtworkSources(req.params.ratingKey),
  );

  // External artwork pages for this item (link-outs in the poster picker)
  app.get<{ Params: { ratingKey: string } }>(
    "/api/items/:ratingKey/links",
    async (req): Promise<ArtworkLinks> => {
      const client = requirePlex();
      const item = await client.item(req.params.ratingKey);
      // TPDb search is text-only (no id lookup), but its posters are named
      // "Title (Year)" — searching that exact form surfaces the right title.
      const cleaned =
        item.type === "collection"
          ? cleanCollectionTitle(item.title)
          : item.year
            ? `${item.title} (${item.year})`
            : item.title;
      const links: ArtworkLinks = {
        tpdbUrl: `https://theposterdb.com/search?term=${encodeURIComponent(cleaned)}`,
      };
      if (item.type === "collection") {
        if (getAppSetting("tmdb_api_key")) {
          // Use the same accurate resolver as "missing from collection":
          // a user pin wins, else infer from the collection's own movies,
          // else fall back to title search. MediUX /collections/{id} keys on
          // the TMDb collection id.
          const children = await client.collectionChildren(req.params.ratingKey).catch(() => []);
          const resolved = await resolveTmdbCollection(
            req.params.ratingKey,
            item.title,
            children,
          ).catch(() => undefined);
          if (resolved) {
            links.mediuxUrl = `https://mediux.pro/collections/${resolved.id}`;
          }
        }
      } else if (item.tmdbId) {
        links.mediuxUrl = `https://mediux.pro/${item.type === "show" ? "shows" : "movies"}/${item.tmdbId}`;
      }
      return links;
    },
  );

  app.post<{ Params: { ratingKey: string } }>("/api/items/:ratingKey/artwork", async (req) => {
    const input = applyArtworkSchema.parse(req.body);
    const client = requirePlex();
    const item = await client.item(req.params.ratingKey);
    if (/^https?:\/\//i.test(input.url)) {
      // Download server-side and push the bytes to Plex — more reliable than
      // having Plex fetch the URL (hotlink protection, HTML pages, redirects).
      const image = await fetchRemoteImage(input.url);
      await client.uploadArtwork(req.params.ratingKey, input.kind, image.buffer, image.contentType);
      const origin = input.sourceUrl
        ? classifySourcePage(input.sourceUrl)
        : classifyArtworkUrl(input.url, item);
      recordArtworkSource(req.params.ratingKey, input.kind, origin.source, origin.label, origin.url);
    } else {
      await client.setArtwork(req.params.ratingKey, input.kind, input.url);
      recordArtworkSource(req.params.ratingKey, input.kind, "plex", "Plex artwork");
    }
    if (item.librarySectionId) {
      await client.lockArtwork(
        item.librarySectionId,
        editTypeId(item.type),
        req.params.ratingKey,
        input.kind,
      );
    }
    return { ok: true };
  });

  app.post<{ Params: { ratingKey: string }; Querystring: { kind?: string } }>(
    "/api/items/:ratingKey/artwork/upload",
    async (req) => {
      const kind = req.query.kind === "art" ? "art" : "poster";
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new PlexError("No image data received.", 400);
      }
      const client = requirePlex();
      const item = await client.item(req.params.ratingKey);
      await client.uploadArtwork(
        req.params.ratingKey,
        kind,
        body,
        req.headers["content-type"] ?? "image/jpeg",
      );
      recordArtworkSource(req.params.ratingKey, kind, "upload", "Uploaded file");
      if (item.librarySectionId) {
        await client.lockArtwork(
          item.librarySectionId,
          editTypeId(item.type),
          req.params.ratingKey,
          kind,
        );
      }
      return { ok: true };
    },
  );

  // ---------- Integrations settings ----------

  app.get("/api/settings/integrations", async (): Promise<IntegrationsStatus> => ({
    tmdbConfigured: !!getAppSetting("tmdb_api_key"),
    mediuxTokenConfigured: !!getAppSetting("mediux_token"),
  }));

  app.put("/api/settings/integrations", async (req, reply) => {
    const input = integrationsSchema.parse(req.body);
    if (input.tmdbApiKey !== undefined && input.tmdbApiKey !== "") {
      const valid = await validateTmdbKey(input.tmdbApiKey);
      if (!valid) return reply.status(400).send({ error: "TMDb rejected that API key." });
    }
    if (input.tmdbApiKey !== undefined) setAppSetting("tmdb_api_key", input.tmdbApiKey);
    if (input.mediuxToken !== undefined) setAppSetting("mediux_token", input.mediuxToken);
    return {
      tmdbConfigured: !!getAppSetting("tmdb_api_key"),
      mediuxTokenConfigured: !!getAppSetting("mediux_token"),
    } satisfies IntegrationsStatus;
  });

  // ---------- MediUX set import ----------

  app.post("/api/mediux/preview", async (req) => {
    const input = mediuxImportSchema.parse(req.body);
    return previewMediux(requirePlex(), input.yaml);
  });

  // Long-running: starts a background job; poll /api/jobs/:id for progress.
  app.post("/api/mediux/apply", async (req) => {
    const input = mediuxImportSchema.parse(req.body);
    const client = requirePlex();
    const job = startJob("mediux", (report) =>
      applyMediux(client, input.yaml, report).then(() => undefined),
    );
    return { jobId: job.id };
  });

  // ---------- Collection completeness (via TMDb) ----------

  app.get<{ Params: { ratingKey: string } }>(
    "/api/collections/:ratingKey/missing",
    async (req): Promise<CollectionCompleteness> => {
      const client = requirePlex();
      const collection = await client.item(req.params.ratingKey);
      const children = await client.collectionChildren(req.params.ratingKey);

      const resolved = await resolveTmdbCollection(req.params.ratingKey, collection.title, children);
      if (!resolved) {
        return { missing: [], inLibraryNotInCollection: [], matchSource: "none" };
      }
      const tmdbCollection = await getTmdbCollectionParts(resolved.id);
      if (!tmdbCollection) {
        return { missing: [], inLibraryNotInCollection: [], matchSource: "none" };
      }

      const inCollection = new Set(children.map((c) => c.tmdbId).filter(Boolean));
      const libraryIndex = await indexByIds(client);

      const today = new Date().toISOString().slice(0, 10);
      const missing: MissingCollectionItem[] = tmdbCollection.parts
        .filter((p) => !inCollection.has(p.tmdbId))
        .map((p) => ({
          tmdbId: p.tmdbId,
          title: p.title,
          year: p.year,
          posterUrl: p.posterUrl,
          ratingKey: libraryIndex.get(`tmdb:${p.tmdbId}`)?.ratingKey,
          unreleased: !p.releaseDate || p.releaseDate > today,
        }));

      return {
        tmdbCollectionId: tmdbCollection.id,
        tmdbCollectionName: tmdbCollection.name,
        tmdbCollectionUrl: `https://www.themoviedb.org/collection/${tmdbCollection.id}`,
        matchSource: resolved.source,
        missing,
        inLibraryNotInCollection: missing.filter((m) => m.ratingKey),
      };
    },
  );

  // Search TMDb collections, for manually binding a Plex collection
  app.get<{ Querystring: { q?: string } }>("/api/tmdb/collections", async (req) => {
    const q = req.query.q?.trim();
    if (!q) return [];
    return searchTmdbCollections(q);
  });

  // Pin / unpin the TMDb collection a Plex collection is measured against
  app.put<{ Params: { ratingKey: string } }>("/api/collections/:ratingKey/link", async (req) => {
    const input = linkCollectionSchema.parse(req.body);
    setCollectionLink(req.params.ratingKey, input.tmdbCollectionId, input.tmdbCollectionName);
    return { ok: true };
  });

  app.delete<{ Params: { ratingKey: string } }>("/api/collections/:ratingKey/link", async (req) => {
    deleteCollectionLink(req.params.ratingKey);
    return { ok: true };
  });

  // ---------- ThePosterDB set import (collections) ----------

  app.post<{ Params: { ratingKey: string } }>(
    "/api/collections/:ratingKey/tpdb-set",
    async (req) => {
      const input = tpdbSetSchema.parse(req.body);
      const client = requirePlex();
      const job = startJob("tpdb-set", (report) =>
        applyTpdbSetToCollection(client, req.params.ratingKey, input.url, report).then(
          () => undefined,
        ),
      );
      return { jobId: job.id };
    },
  );

  // ---------- Job polling ----------

  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.status(404).send({ error: "Job not found (it may have expired)." });
    return job;
  });
}
