import type { FastifyInstance } from "fastify";
import {
  applyArtworkSchema,
  editCollectionSchema,
  editItemSchema,
  integrationsSchema,
  mediuxImportSchema,
} from "@metamagic/shared";
import type { ArtworkLinks, ArtworkOption, IntegrationsStatus } from "@metamagic/shared";
import { requirePlex } from "./client-store.js";
import { EDIT_TYPE_IDS, PlexError } from "./plex.js";
import { getAppSetting, setAppSetting } from "./db.js";
import { searchTmdbCollection, tmdbArtwork, validateTmdbKey } from "./tmdb.js";
import { applyMediux, previewMediux } from "./mediux.js";
import { fetchRemoteImage } from "./remote-image.js";

function editTypeId(itemType: string): number {
  const id = EDIT_TYPE_IDS[itemType];
  if (!id) throw new PlexError(`Editing is not supported for type "${itemType}"`, 400);
  return id;
}

/** "Fast & Furious Collection" → "Fast & Furious" for external searches. */
function cleanCollectionTitle(title: string): string {
  return title.replace(/\s+collection\s*$/i, "").trim() || title;
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

  // External artwork pages for this item (link-outs in the poster picker)
  app.get<{ Params: { ratingKey: string } }>(
    "/api/items/:ratingKey/links",
    async (req): Promise<ArtworkLinks> => {
      const client = requirePlex();
      const item = await client.item(req.params.ratingKey);
      const cleaned =
        item.type === "collection" ? cleanCollectionTitle(item.title) : item.title;
      const links: ArtworkLinks = {
        tpdbUrl: `https://theposterdb.com/search?term=${encodeURIComponent(cleaned)}`,
      };
      if (item.type === "collection") {
        if (getAppSetting("tmdb_api_key")) {
          const collectionId = await searchTmdbCollection(cleaned).catch(() => undefined);
          if (collectionId) links.mediuxUrl = `https://mediux.pro/collections/${collectionId}`;
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
    } else {
      await client.setArtwork(req.params.ratingKey, input.kind, input.url);
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

  app.post("/api/mediux/apply", async (req) => {
    const input = mediuxImportSchema.parse(req.body);
    return applyMediux(requirePlex(), input.yaml);
  });
}
