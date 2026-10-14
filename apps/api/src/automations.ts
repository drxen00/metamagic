import type { FastifyBaseLogger } from "fastify";
import type {
  ActorAutomation,
  AutoAddExisting,
  FranchiseAutoCreate,
  LibrarySection,
  StudioAutomation,
} from "@metamagic/shared";
import { EDIT_TYPE_IDS, type PlexClient } from "./plex.js";
import { getAppSetting, recordArtworkSource, setAppSetting } from "./db.js";
import { discoverCollections } from "./discover.js";
import { indexByIds } from "./mediux.js";
import { resolveTmdbCollection } from "./collection-match.js";
import {
  discoverByCompany,
  getTmdbCollectionParts,
  personMovieCredits,
  tmdbConfigured,
  tmdbImageUrl,
  type PersonMovieCredit,
} from "./tmdb.js";
import { fetchRemoteImage } from "./remote-image.js";
import { recordActivity } from "./activity.js";
import { arrAlreadyRequested, markArrRequested } from "./db.js";
import { getArrAutoRequest, getArrConfig, radarrRequest } from "./arr.js";

const DAILY = 24 * 60 * 60 * 1000;

/** Minimal progress sink so "Run now" can stream a transcript to a job. */
export interface AutomationReporter {
  setCurrent: (line: string) => void;
  log: (line: string) => void;
}

interface RunOpts {
  report?: AutomationReporter;
  /** Manual "Run now" — bypasses the enabled toggle. */
  manual?: boolean;
}

function readJson<T>(key: string, fallback: T): T {
  const raw = getAppSetting(key);
  if (!raw) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

export function getFranchiseAutoCreate(): FranchiseAutoCreate {
  return readJson<FranchiseAutoCreate>("auto_create_franchise", { enabled: false, minMovies: 2 });
}

export function setFranchiseAutoCreate(cfg: FranchiseAutoCreate): void {
  setAppSetting("auto_create_franchise", JSON.stringify(cfg));
}

export function getAutoAddExisting(): AutoAddExisting {
  return readJson<AutoAddExisting>("auto_add_existing", { enabled: false, excludeRatingKeys: [] });
}

export function setAutoAddExisting(cfg: AutoAddExisting): void {
  setAppSetting("auto_add_existing", JSON.stringify(cfg));
}

export function getStudioAutomation(): StudioAutomation {
  return readJson<StudioAutomation>("auto_studio", { enabled: false, studios: [] });
}

export function setStudioAutomation(cfg: StudioAutomation): void {
  setAppSetting("auto_studio", JSON.stringify(cfg));
}

export function getActorAutomation(): ActorAutomation {
  return readJson<ActorAutomation>("auto_actor", { enabled: false, actors: [] });
}

export function setActorAutomation(cfg: ActorAutomation): void {
  setAppSetting("auto_actor", JSON.stringify(cfg));
}

export function automationsLastRunAt(): number | undefined {
  const v = getAppSetting("automations_presets_last_run");
  return v ? Number(v) : undefined;
}

/** Create collections for owned TMDb franchises that don't have one yet. */
export async function runFranchiseAutoCreate(
  client: PlexClient,
  log: FastifyBaseLogger,
  opts: RunOpts = {},
): Promise<void> {
  const cfg = getFranchiseAutoCreate();
  if (!opts.manual && !cfg.enabled) return;
  if (!tmdbConfigured()) {
    opts.report?.log("✗ Add a TMDb API key in Settings first.");
    return;
  }

  opts.report?.setCurrent("Scanning your movie libraries for franchises…");
  const suggestions = await discoverCollections(client);
  const sections = await client.sections();
  let created = 0;
  for (const s of suggestions) {
    if (s.existing || s.owned.length < cfg.minMovies) continue;
    const section = sections.find((sec) => sec.id === s.sectionId);
    if (!section) continue;
    try {
      await client.createCollection(
        s.sectionId,
        section.type,
        s.name,
        s.owned.map((o) => o.ratingKey),
      );
      created++;
      opts.report?.log(`✓ created “${s.name}” (${s.owned.length} films)`);
      recordActivity({
        kind: "collection-created",
        title: `Created collection “${s.name}”`,
        detail: `${s.owned.length} film(s)`,
        status: "ok",
        trigger: "franchise auto-create",
      });
      log.info({ name: s.name }, "franchise auto-create");
    } catch (err) {
      log.error({ err, name: s.name }, "franchise auto-create failed");
    }
  }
  opts.report?.log(`• done — ${created} collection(s) created`);
}

/** Add newly-owned franchise films to the collections that already exist. */
export async function runAutoAddExisting(
  client: PlexClient,
  log: FastifyBaseLogger,
  opts: RunOpts = {},
): Promise<void> {
  const cfg = getAutoAddExisting();
  if (!opts.manual && !cfg.enabled) return;
  if (!tmdbConfigured()) {
    opts.report?.log("✗ Add a TMDb API key in Settings first.");
    return;
  }

  const exclude = new Set(cfg.excludeRatingKeys);
  opts.report?.setCurrent("Scanning your libraries…");
  const collections = await client.collections();
  const index = await indexByIds(client);
  let added = 0;

  for (const coll of collections) {
    if (exclude.has(coll.ratingKey)) continue;
    try {
      opts.report?.setCurrent(`Checking “${coll.title}”…`);
      const children = await client.collectionChildren(coll.ratingKey);
      const resolved = await resolveTmdbCollection(coll.ratingKey, coll.title, children).catch(
        () => undefined,
      );
      if (!resolved) continue;
      const parts = await getTmdbCollectionParts(resolved.id);
      if (!parts) continue;

      const present = new Set(children.map((c) => c.tmdbId).filter(Boolean));
      const toAdd: string[] = [];
      for (const p of parts.parts) {
        if (present.has(p.tmdbId)) continue;
        const owned = index.get(`tmdb:${p.tmdbId}`);
        if (owned) toAdd.push(owned.ratingKey);
      }
      if (toAdd.length === 0) continue;

      await client.addToCollection(coll.ratingKey, toAdd);
      added += toAdd.length;
      opts.report?.log(`✓ ${coll.title} — added ${toAdd.length}`);
      recordActivity({
        kind: "collection-updated",
        title: coll.title,
        detail: `added ${toAdd.length} newly-owned film(s)`,
        status: "ok",
        trigger: "auto-add to existing",
      });
      log.info({ collection: coll.title, added: toAdd.length }, "auto-add to existing");
    } catch (err) {
      log.error({ err, collection: coll.title }, "auto-add to existing failed");
    }
  }
  opts.report?.log(`• done — ${added} film(s) added`);
}

function normTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Create/maintain a collection of owned movies for each configured studio. */
export async function runStudioAutomation(
  client: PlexClient,
  log: FastifyBaseLogger,
  opts: RunOpts = {},
): Promise<void> {
  const cfg = getStudioAutomation();
  if (!opts.manual && !cfg.enabled) return;
  if (cfg.studios.length === 0) {
    opts.report?.log("• no studios configured — add one in settings.");
    return;
  }
  if (!tmdbConfigured()) {
    opts.report?.log("✗ Add a TMDb API key in Settings first.");
    return;
  }

  const ctx = await namedCollectionContext(client);

  for (const studio of cfg.studios) {
    try {
      opts.report?.setCurrent(`Checking ${studio.name}…`);
      const movies = await discoverByCompany(studio.companyId);
      const owned = movies
        .map((m) => ctx.index.get(`tmdb:${m.tmdbId}`))
        .filter((hit): hit is NonNullable<typeof hit> => !!hit && hit.type === "movie");
      if (owned.length < studio.minMovies) {
        opts.report?.log(`· ${studio.name} — only ${owned.length} owned (min ${studio.minMovies})`);
        continue;
      }
      await syncNamedCollection(client, ctx, studio.name, owned, {
        trigger: "studio automation",
        report: opts.report,
      });
      log.info({ studio: studio.name }, "studio automation");
    } catch (err) {
      log.error({ err, studio: studio.name }, "studio automation failed");
    }
  }
  opts.report?.log("• done");
}

/** Owned films that count for an actor: a top-`maxBilling` role (0 = any role). */
export function qualifyingCredits(
  credits: PersonMovieCredit[],
  maxBilling: number,
): PersonMovieCredit[] {
  return maxBilling > 0 ? credits.filter((c) => c.order < maxBilling) : credits;
}

/**
 * Create/maintain a collection per configured actor, holding the owned movies
 * where they play a main character (top-billed, per TMDb's cast order). New
 * collections get the actor's TMDb portrait as their poster.
 */
export async function runActorAutomation(
  client: PlexClient,
  log: FastifyBaseLogger,
  opts: RunOpts = {},
): Promise<void> {
  const cfg = getActorAutomation();
  if (!opts.manual && !cfg.enabled) return;
  if (cfg.actors.length === 0) {
    opts.report?.log("• no actors configured — add one in settings.");
    return;
  }
  if (!tmdbConfigured()) {
    opts.report?.log("✗ Add a TMDb API key in Settings first.");
    return;
  }

  const ctx = await namedCollectionContext(client);

  for (const actor of cfg.actors) {
    try {
      opts.report?.setCurrent(`Checking ${actor.name}…`);
      const credits = qualifyingCredits(await personMovieCredits(actor.personId), actor.maxBilling);
      const owned = credits
        .map((c) => ctx.index.get(`tmdb:${c.tmdbId}`))
        .filter((hit): hit is NonNullable<typeof hit> => !!hit && hit.type === "movie");
      const roleNote = actor.maxBilling > 0 ? "lead-role " : "";
      if (owned.length < actor.minMovies) {
        opts.report?.log(
          `· ${actor.name} — only ${owned.length} owned ${roleNote}film(s) (min ${actor.minMovies})`,
        );
        continue;
      }
      await syncNamedCollection(client, ctx, actor.name, owned, {
        trigger: "actor automation",
        report: opts.report,
        onCreated: actor.profilePath
          ? (ratingKey, sectionId) => setPortraitPoster(client, ratingKey, sectionId, actor.profilePath!)
          : undefined,
      });
      log.info({ actor: actor.name }, "actor automation");
    } catch (err) {
      opts.report?.log(`✗ ${actor.name} — ${err instanceof Error ? err.message : "failed"}`);
      log.error({ err, actor: actor.name }, "actor automation failed");
    }
  }
  opts.report?.log("• done");
}

/** Use a TMDb portrait as a freshly created collection's poster (best effort). */
async function setPortraitPoster(
  client: PlexClient,
  ratingKey: string,
  sectionId: string,
  profilePath: string,
): Promise<void> {
  try {
    const url = tmdbImageUrl(profilePath);
    const image = await fetchRemoteImage(url);
    await client.uploadArtwork(ratingKey, "poster", image.buffer, image.contentType);
    await client.lockArtwork(sectionId, EDIT_TYPE_IDS.collection, ratingKey, "poster");
    recordArtworkSource(ratingKey, "poster", "tmdb", "TMDb portrait", url);
  } catch {
    // A missing poster isn't worth failing the collection over.
  }
}

// ---------- Named-collection maintenance (studio / actor) ----------

interface NamedCollectionContext {
  index: Awaited<ReturnType<typeof indexByIds>>;
  sections: LibrarySection[];
  /** Existing collections, keyed by `${sectionId}:${normalized title}`. */
  byName: Map<string, { ratingKey: string }>;
}

async function namedCollectionContext(client: PlexClient): Promise<NamedCollectionContext> {
  const [index, collections, sections] = await Promise.all([
    indexByIds(client),
    client.collections(),
    client.sections(),
  ]);
  const byName = new Map<string, { ratingKey: string }>();
  for (const c of collections) {
    byName.set(`${c.sectionId ?? ""}:${normTitle(c.title)}`, { ratingKey: c.ratingKey });
  }
  return { index, sections, byName };
}

/**
 * Make sure a collection called `name` holds every owned film in `owned`. Films
 * can live in different libraries and a Plex collection belongs to exactly one,
 * so there's one collection per library the films are in. Adds only — never
 * removes what the user put there.
 */
async function syncNamedCollection(
  client: PlexClient,
  ctx: NamedCollectionContext,
  name: string,
  owned: { ratingKey: string; sectionId: string }[],
  opts: {
    trigger: string;
    report?: AutomationReporter;
    onCreated?: (ratingKey: string, sectionId: string) => Promise<void>;
  },
): Promise<void> {
  const bySection = new Map<string, string[]>();
  for (const o of owned) {
    const keys = bySection.get(o.sectionId) ?? [];
    if (!keys.includes(o.ratingKey)) keys.push(o.ratingKey);
    bySection.set(o.sectionId, keys);
  }
  const multi = bySection.size > 1;

  for (const [sectionId, keys] of bySection) {
    const section = ctx.sections.find((s) => s.id === sectionId);
    if (!section) continue;
    const where = multi ? ` (${section.title})` : "";
    const key = `${sectionId}:${normTitle(name)}`;
    const existing = ctx.byName.get(key);

    if (existing) {
      const children = await client.collectionChildren(existing.ratingKey);
      const present = new Set(children.map((c) => c.ratingKey));
      const toAdd = keys.filter((k) => !present.has(k));
      if (toAdd.length === 0) {
        opts.report?.log(`· ${name}${where} — already complete`);
        continue;
      }
      await client.addToCollection(existing.ratingKey, toAdd);
      opts.report?.log(`✓ ${name}${where} — added ${toAdd.length}`);
      recordActivity({
        kind: "collection-updated",
        title: name,
        detail: `added ${toAdd.length} film(s)`,
        status: "ok",
        trigger: opts.trigger,
      });
    } else {
      const created = await client.createCollection(sectionId, section.type, name, keys);
      ctx.byName.set(key, { ratingKey: created.ratingKey });
      await opts.onCreated?.(created.ratingKey, sectionId);
      opts.report?.log(`✓ created “${name}”${where} (${keys.length} films)`);
      recordActivity({
        kind: "collection-created",
        title: `Created collection “${name}”`,
        detail: `${keys.length} film(s)`,
        status: "ok",
        trigger: opts.trigger,
      });
    }
  }
}

/** True when any preset automation is switched on. */
export function presetAutomationsAnyEnabled(): boolean {
  return (
    getFranchiseAutoCreate().enabled ||
    getAutoAddExisting().enabled ||
    getStudioAutomation().enabled ||
    getActorAutomation().enabled
  );
}

/**
 * Auto-request missing (released, unowned) collection movies from Radarr.
 * Opt-in + acknowledged only; deduped so a movie is requested at most once, and
 * capped per sweep so it never dumps a giant search all at once. Daily-gated.
 */
export async function runAutoRequest(client: PlexClient, log: FastifyBaseLogger): Promise<void> {
  const auto = getArrAutoRequest();
  if (!auto.enabled || !auto.acknowledged || !tmdbConfigured()) return;
  const cfg = getArrConfig("radarr");
  if (!cfg?.rootFolder || !cfg.qualityProfileId) return;

  const last = getAppSetting("arr_auto_request_last");
  if (last && Date.now() - Number(last) < DAILY) return;
  setAppSetting("arr_auto_request_last", String(Date.now()));

  const CAP = 40;
  const today = new Date().toISOString().slice(0, 10);
  const index = await indexByIds(client);
  const collections = await client.collections();
  let requested = 0;

  for (const coll of collections) {
    if (requested >= CAP) break;
    try {
      const children = await client.collectionChildren(coll.ratingKey);
      const resolved = await resolveTmdbCollection(coll.ratingKey, coll.title, children).catch(
        () => undefined,
      );
      if (!resolved) continue;
      const parts = await getTmdbCollectionParts(resolved.id);
      if (!parts) continue;

      for (const p of parts.parts) {
        if (requested >= CAP) break;
        if (index.get(`tmdb:${p.tmdbId}`)) continue; // already owned
        if (!p.releaseDate || p.releaseDate > today) continue; // unreleased
        if (arrAlreadyRequested(p.tmdbId)) continue;
        try {
          await radarrRequest(cfg, p.tmdbId);
          markArrRequested(p.tmdbId);
          requested++;
          recordActivity({
            kind: "download-request",
            title: `Requested “${p.title}”`,
            detail: `Radarr (auto) — for ${coll.title}`,
            status: "ok",
            trigger: "auto",
          });
        } catch (err) {
          log.error({ err, tmdbId: p.tmdbId }, "auto-request failed");
        }
      }
    } catch (err) {
      log.error({ err, collection: coll.title }, "auto-request collection failed");
    }
  }
  if (requested > 0) log.info({ requested }, "radarr auto-request sweep");
}

/**
 * Scheduler entry point — the preset automations. Gated to once per day on the
 * time-based tick; `ignoreGate` lets the change-watcher fire them the moment new
 * content appears.
 */
export async function runPresetAutomations(
  client: PlexClient,
  log: FastifyBaseLogger,
  opts: { ignoreGate?: boolean } = {},
): Promise<void> {
  if (!presetAutomationsAnyEnabled()) return;

  const last = automationsLastRunAt();
  if (!opts.ignoreGate && last && Date.now() - last < DAILY) return;
  setAppSetting("automations_presets_last_run", String(Date.now()));

  try {
    await runFranchiseAutoCreate(client, log);
  } catch (err) {
    log.error({ err }, "franchise auto-create sweep threw");
  }
  try {
    await runAutoAddExisting(client, log);
  } catch (err) {
    log.error({ err }, "auto-add sweep threw");
  }
  try {
    await runStudioAutomation(client, log);
  } catch (err) {
    log.error({ err }, "studio automation sweep threw");
  }
  try {
    await runActorAutomation(client, log);
  } catch (err) {
    log.error({ err }, "actor automation sweep threw");
  }
}
