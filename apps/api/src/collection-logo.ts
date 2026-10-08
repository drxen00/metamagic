import fs from "node:fs";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { CONFIG_DIR } from "./env.js";
import { EDIT_TYPE_IDS, PlexError, type PlexClient } from "./plex.js";
import { deleteCollectionLogo, listCollectionLogos, recordArtworkSource } from "./db.js";
import { recordActivity } from "./activity.js";

/**
 * One-time cleanup for the retired per-collection streaming logo (0.30.0).
 * Streaming logos now live in overlays; any collection that still carries a
 * stamped logo gets its clean (pre-logo) poster back, then the record is
 * dropped. Runs until nothing is left; a no-op (one SELECT) afterwards.
 */

const BASE_DIR = path.join(CONFIG_DIR, "collection-logo-base");

export async function restoreStampedCollectionLogos(
  client: PlexClient,
  log: FastifyBaseLogger,
): Promise<void> {
  const rows = listCollectionLogos();
  if (rows.length === 0) return;

  let restored = 0;
  for (const row of rows) {
    const file = row.baseFile ? path.join(BASE_DIR, row.baseFile) : undefined;
    try {
      if (file && fs.existsSync(file)) {
        await client.uploadArtwork(
          row.ratingKey,
          "poster",
          fs.readFileSync(file),
          row.baseContentType ?? "image/jpeg",
        );
        const item = await client.item(row.ratingKey).catch(() => undefined);
        if (item?.librarySectionId) {
          await client
            .lockArtwork(item.librarySectionId, EDIT_TYPE_IDS.collection, row.ratingKey, "poster")
            .catch(() => undefined);
        }
        recordArtworkSource(row.ratingKey, "poster", "metamagic", "Restored (streaming logo removed)");
        restored++;
        fs.rmSync(file, { force: true });
      }
      deleteCollectionLogo(row.ratingKey);
    } catch (err) {
      // The collection is gone — nothing to restore. Otherwise retry next pass.
      if (err instanceof PlexError && err.status === 404) {
        deleteCollectionLogo(row.ratingKey);
        if (file) fs.rmSync(file, { force: true });
      } else {
        log.warn({ err, ratingKey: row.ratingKey }, "couldn't restore collection poster yet");
      }
    }
  }

  if (restored > 0) {
    log.info({ restored }, "removed streaming logos from collection posters");
    recordActivity(
      {
        kind: "poster-set",
        title: "Collection streaming logos removed",
        detail: `${restored} collection poster${restored === 1 ? "" : "s"} restored — streaming logos are now an overlay badge`,
        status: "ok",
        trigger: "update",
      },
      { notify: false },
    );
  }
  if (listCollectionLogos().length === 0) fs.rmSync(BASE_DIR, { recursive: true, force: true });
}
