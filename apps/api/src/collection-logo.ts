import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CollectionLogoState, MediaItem } from "@metamagic/shared";
import { CONFIG_DIR } from "./env.js";
import { EDIT_TYPE_IDS, PlexError, type PlexClient } from "./plex.js";
import {
  deleteCollectionLogo,
  getAppSetting,
  getCollectionLogo,
  recordArtworkSource,
  upsertCollectionLogo,
} from "./db.js";
import {
  fetchProviderLogo,
  tmdbConfigured,
  tmdbWatchProviders,
  watchProviderById,
  type WatchProvider,
} from "./tmdb.js";
import { stampLogoOnPoster } from "./poster-gen.js";

/**
 * Persistent per-collection streaming logo. Unlike the one-shot poster
 * generator, this stamps the collection's *current* poster — whatever set it,
 * including a MediUX auto-sync — and remembers the choice so it can be re-stamped
 * after MediUX re-applies the poster, or removed cleanly later.
 *
 * To avoid stacking the logo when re-stamping, we remember both the clean
 * (pre-logo) base and a hash of the stamped poster we uploaded. On re-stamp we
 * compare Plex's current poster to that hash: if it matches, nothing changed and
 * we reuse the stored clean base; if it differs, the poster was replaced
 * externally (MediUX / a manual change), so that new poster becomes the clean
 * base.
 */

const BASE_DIR = path.join(CONFIG_DIR, "collection-logo-base");
fs.mkdirSync(BASE_DIR, { recursive: true });

const POSTER_WIDTH = 1000;
const POSTER_HEIGHT = 1500;

function basePath(fileName: string): string {
  return path.join(BASE_DIR, fileName);
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function defaultRegion(): string {
  return getAppSetting("watch_region") || "US";
}

/** The resolved display name of a stored logo preference, for the UI. */
export async function collectionLogoState(ratingKey: string): Promise<CollectionLogoState> {
  const row = getCollectionLogo(ratingKey);
  if (!row) return { provider: null };
  let providerName: string | undefined;
  if (row.provider !== "auto" && tmdbConfigured()) {
    providerName = (await watchProviderById(row.provider, row.region).catch(() => undefined))?.name;
  }
  return { provider: row.provider, providerName, region: row.region };
}

/** Detect the streaming service most of a collection's members are on. */
async function detectDominantProvider(
  children: MediaItem[],
  region: string,
): Promise<WatchProvider | undefined> {
  const members = children
    .filter((c) => c.tmdbId && (c.type === "movie" || c.type === "show"))
    .slice(0, 12);
  const tally = new Map<number, { count: number; provider: WatchProvider }>();
  for (const m of members) {
    try {
      const mediaType = m.type === "show" ? "tv" : "movie";
      for (const p of await tmdbWatchProviders(m.tmdbId!, mediaType, region)) {
        const hit = tally.get(p.id);
        if (hit) hit.count += 1;
        else tally.set(p.id, { count: 1, provider: p });
      }
    } catch {
      // skip this member
    }
  }
  return [...tally.values()].sort((a, b) => b.count - a.count)[0]?.provider;
}

/**
 * Resolve the logo image + display name to stamp for a preference ("auto" or a
 * TMDb provider id). Returns undefined when nothing suitable is found (no TMDb
 * key, provider has no logo, or auto couldn't detect a service).
 */
export async function resolveLogoImage(
  children: MediaItem[],
  provider: string,
  region: string,
): Promise<{ image: Buffer; name: string } | undefined> {
  if (!tmdbConfigured()) return undefined;
  let logoPath: string | null | undefined;
  let name: string;
  if (provider === "auto") {
    const best = await detectDominantProvider(children, region);
    if (!best) return undefined;
    logoPath = best.logoPath;
    name = best.name;
  } else {
    const match = await watchProviderById(provider, region).catch(() => undefined);
    if (!match) return undefined;
    logoPath = match.logoPath;
    name = match.name;
  }
  if (!logoPath) return undefined;
  return { image: await fetchProviderLogo(logoPath), name };
}

/** Download the collection's current Plex poster. */
async function fetchCurrentPoster(
  client: PlexClient,
  coll: MediaItem,
): Promise<{ buffer: Buffer; contentType: string }> {
  if (!coll.thumb) throw new PlexError(`“${coll.title}” has no poster to stamp a logo on.`, 400);
  const url = client.imageUrl(coll.thumb, POSTER_WIDTH, POSTER_HEIGHT);
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new PlexError(`Plex returned ${res.status} for the poster.`, 502);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg",
  };
}

/**
 * Resolve the clean (pre-logo) base poster to stamp on. If the collection's
 * current Plex poster still matches the stamped poster we last uploaded, nothing
 * changed and we reuse the stored clean base. Otherwise the poster was replaced
 * (MediUX re-sync, a manual poster change) and becomes the new clean base.
 */
async function resolveBasePoster(
  client: PlexClient,
  coll: MediaItem,
): Promise<{ fileName: string; contentType: string; buffer: Buffer }> {
  const row = getCollectionLogo(coll.ratingKey);
  const current = await fetchCurrentPoster(client, coll);
  const unchanged = row?.stampedHash && sha256(current.buffer) === row.stampedHash;

  if (unchanged && row?.baseFile) {
    const file = basePath(row.baseFile);
    if (fs.existsSync(file)) {
      return {
        fileName: row.baseFile,
        contentType: row.baseContentType ?? "image/jpeg",
        buffer: fs.readFileSync(file),
      };
    }
  }

  // New clean base: the current poster (it isn't one we stamped).
  const fileName = `${coll.ratingKey}.bin`;
  fs.writeFileSync(basePath(fileName), current.buffer);
  return { fileName, contentType: current.contentType, buffer: current.buffer };
}

/** Stamp (or re-stamp) the chosen streaming logo on a collection's poster. */
export async function applyCollectionLogo(
  client: PlexClient,
  ratingKey: string,
  provider: string,
  region: string,
): Promise<{ name: string }> {
  const coll = await client.item(ratingKey);
  if (coll.type !== "collection") {
    throw new PlexError("Streaming logos can only be stamped on collections.", 400);
  }
  const children = await client.collectionChildren(ratingKey).catch(() => [] as MediaItem[]);
  const resolved = await resolveLogoImage(children, provider, region);
  if (!resolved) {
    throw new PlexError(
      provider === "auto"
        ? "Couldn't detect a streaming service for this collection (needs a TMDb key and matched titles)."
        : "That streaming service has no logo available.",
      400,
    );
  }

  const base = await resolveBasePoster(client, coll);
  const stamped = await stampLogoOnPoster(base.buffer, resolved.image);
  await client.uploadArtwork(ratingKey, "poster", stamped, "image/jpeg");
  if (coll.librarySectionId) {
    await client.lockArtwork(coll.librarySectionId, EDIT_TYPE_IDS.collection, ratingKey, "poster");
  }
  upsertCollectionLogo({
    ratingKey,
    provider,
    region,
    baseFile: base.fileName,
    baseContentType: base.contentType,
    stampedHash: sha256(stamped),
  });
  recordArtworkSource(ratingKey, "poster", "metamagic", `Streaming logo · ${resolved.name}`);
  return { name: resolved.name };
}

/** Remove a collection's streaming logo, restoring the clean base poster. */
export async function clearCollectionLogo(client: PlexClient, ratingKey: string): Promise<boolean> {
  const row = getCollectionLogo(ratingKey);
  if (!row) return false;
  if (row.baseFile) {
    const file = basePath(row.baseFile);
    if (fs.existsSync(file)) {
      await client.uploadArtwork(
        ratingKey,
        "poster",
        fs.readFileSync(file),
        row.baseContentType ?? "image/jpeg",
      );
      fs.rmSync(file, { force: true });
    }
  }
  deleteCollectionLogo(ratingKey);
  return true;
}

/**
 * Re-stamp a collection's remembered logo after its poster may have changed
 * (MediUX auto-sync, a manual poster swap). No-op when the collection has no
 * logo preference. resolveBasePoster figures out whether the poster was replaced.
 */
export async function restampCollectionLogo(client: PlexClient, ratingKey: string): Promise<boolean> {
  const row = getCollectionLogo(ratingKey);
  if (!row) return false;
  await applyCollectionLogo(client, ratingKey, row.provider, row.region);
  return true;
}

export function hasCollectionLogo(ratingKey: string): boolean {
  return !!getCollectionLogo(ratingKey);
}
