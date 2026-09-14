import type { FastifyBaseLogger } from "fastify";
import type { AutoAddExisting, FranchiseAutoCreate, StudioAutomation } from "@metamagic/shared";
import type { PlexClient } from "./plex.js";
import { getAppSetting, setAppSetting } from "./db.js";
import { discoverCollections } from "./discover.js";
import { indexByIds } from "./mediux.js";
import { resolveTmdbCollection } from "./collection-match.js";
import { discoverByCompany, getTmdbCollectionParts, tmdbConfigured } from "./tmdb.js";
import { recordActivity } from "./activity.js";

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

  const index = await indexByIds(client);
  const collections = await client.collections();
  const byName = new Map<string, { ratingKey: string }>(
    collections.map((c) => [normTitle(c.title), { ratingKey: c.ratingKey }]),
  );

  for (const studio of cfg.studios) {
    try {
      opts.report?.setCurrent(`Checking ${studio.name}…`);
      const movies = await discoverByCompany(studio.companyId);
      const owned = movies
        .map((m) => index.get(`tmdb:${m.tmdbId}`))
        .filter((hit): hit is NonNullable<typeof hit> => !!hit && hit.type === "movie");
      if (owned.length < studio.minMovies) {
        opts.report?.log(`· ${studio.name} — only ${owned.length} owned (min ${studio.minMovies})`);
        continue;
      }

      const ownedKeys = owned.map((o) => o.ratingKey);
      const existing = byName.get(normTitle(studio.name));
      if (existing) {
        const children = await client.collectionChildren(existing.ratingKey);
        const present = new Set(children.map((c) => c.ratingKey));
        const toAdd = ownedKeys.filter((k) => !present.has(k));
        if (toAdd.length === 0) {
          opts.report?.log(`· ${studio.name} — already complete`);
          continue;
        }
        await client.addToCollection(existing.ratingKey, toAdd);
        opts.report?.log(`✓ ${studio.name} — added ${toAdd.length}`);
        recordActivity({
          kind: "collection-updated",
          title: studio.name,
          detail: `added ${toAdd.length} ${studio.name} film(s)`,
          status: "ok",
          trigger: "studio automation",
        });
      } else {
        const sectionId = owned[0].sectionId;
        const section = (await client.sections()).find((s) => s.id === sectionId);
        if (!section) continue;
        const created = await client.createCollection(
          sectionId,
          section.type,
          studio.name,
          ownedKeys,
        );
        byName.set(normTitle(studio.name), { ratingKey: created.ratingKey });
        opts.report?.log(`✓ created “${studio.name}” (${ownedKeys.length} films)`);
        recordActivity({
          kind: "collection-created",
          title: `Created collection “${studio.name}”`,
          detail: `${ownedKeys.length} film(s)`,
          status: "ok",
          trigger: "studio automation",
        });
      }
      log.info({ studio: studio.name }, "studio automation");
    } catch (err) {
      log.error({ err, studio: studio.name }, "studio automation failed");
    }
  }
  opts.report?.log("• done");
}

/** True when any preset automation is switched on. */
export function presetAutomationsAnyEnabled(): boolean {
  return (
    getFranchiseAutoCreate().enabled ||
    getAutoAddExisting().enabled ||
    getStudioAutomation().enabled
  );
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
}
