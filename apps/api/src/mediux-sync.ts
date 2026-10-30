import type { FastifyBaseLogger } from "fastify";
import type { Rule } from "@metamagic/shared";
import type { PlexClient } from "./plex.js";
import {
  getAppSetting,
  getMediuxWatch,
  listMediuxWatches,
  recordMediuxWatchSync,
  setAppSetting,
  upsertMediuxWatch,
  type MediuxSetSlot,
  type MediuxWatchFull,
} from "./db.js";
import {
  applyMediux,
  extractSetUrl,
  filterSet,
  parseMediuxYaml,
  type MediuxPart,
  type ProgressReporter,
} from "./mediux.js";
import { evaluateRule } from "./rules.js";
import { resolveTmdbCollection } from "./collection-match.js";
import { recordActivity } from "./activity.js";
import { notifyMediuxSweep, type MediuxSweepChange } from "./notify.js";
import type { MediuxMatch, MediuxSyncMode, RuleChange } from "@metamagic/shared";

const SCHEDULE_INTERVALS: Record<Exclude<MediuxSyncMode, "detect">, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

export function mediuxAutoSyncEnabled(): boolean {
  return getAppSetting("mediux_autosync") === "true";
}

export function mediuxSyncMode(): MediuxSyncMode {
  const v = getAppSetting("mediux_sync_mode");
  return v === "hourly" || v === "daily" || v === "weekly" ? v : "detect";
}

/** When the scheduler last ran an auto-sync sweep (any mode). */
export function mediuxLastCheckedAt(): number | undefined {
  const v = getAppSetting("mediux_last_check");
  return v ? Number(v) : undefined;
}

/**
 * A cheap fingerprint of "has anything changed that could need a re-sync".
 * - shows: the set of seasons (a new season flips it)
 * - collections: the collection's size + its library's total (a new movie
 *   anywhere in the library flips it, which is when we re-check membership)
 */
export async function computeSignature(
  client: PlexClient,
  watch: { ratingKey: string; type: "collection" | "show" },
): Promise<string> {
  if (watch.type === "show") {
    const seasons = await client.children(watch.ratingKey);
    const ids = seasons.map((s) => (s.index ?? s.ratingKey)).sort();
    return `show:${ids.join(",")}`;
  }
  const children = await client.collectionChildren(watch.ratingKey);
  const item = await client.item(watch.ratingKey);
  let total = 0;
  if (item.librarySectionId) {
    const page = await client.sectionItems(item.librarySectionId, { offset: 0, limit: 1 });
    total = page.totalSize;
  }
  return `coll:${children.length}:${total}`;
}

/** The collection/show a picker scope tracks sets for (a season → its show). */
export interface WatchTarget {
  ratingKey: string;
  type: "collection" | "show";
  title: string;
  thumb?: string;
  tmdbId?: string;
}

/**
 * Resolve a picker scope to the collection or show whose MediUX sets are
 * remembered. Season scopes map to their parent show; movies (and anything
 * else) have no franchise-level target, so they resolve to undefined.
 */
export async function resolveWatchTarget(
  client: PlexClient,
  scopeRatingKey: string,
  scopeType: "collection" | "show" | "season" | "movie" | undefined,
): Promise<WatchTarget | undefined> {
  const item = await client.item(scopeRatingKey).catch(() => undefined);
  if (!item) return undefined;
  const effectiveType = scopeType ?? item.type;

  if (effectiveType === "collection") {
    const children = await client.collectionChildren(scopeRatingKey).catch(() => []);
    const resolved = await resolveTmdbCollection(scopeRatingKey, item.title, children).catch(
      () => undefined,
    );
    return {
      ratingKey: scopeRatingKey,
      type: "collection",
      title: item.title,
      thumb: item.thumb,
      tmdbId: resolved ? String(resolved.id) : undefined,
    };
  }
  if (effectiveType === "show") {
    return { ratingKey: scopeRatingKey, type: "show", title: item.title, thumb: item.thumb, tmdbId: item.tmdbId };
  }
  if (effectiveType === "season" && item.parentRatingKey) {
    const show = await client.item(item.parentRatingKey).catch(() => undefined);
    if (!show) return undefined;
    return { ratingKey: show.ratingKey, type: "show", title: show.title, thumb: show.thumb, tmdbId: show.tmdbId };
  }
  return undefined;
}

/**
 * Remember (or refresh) a MediUX set applied to a collection or show so it can
 * be re-applied automatically later. A show has two slots — `main` (show &
 * season posters) and `episodes` (episode title cards only) — so sets that
 * MediUX uploaders publish separately can both be tracked.
 */
export async function rememberMediuxSet(
  client: PlexClient,
  scopeRatingKey: string,
  scopeType: "collection" | "show" | "season" | "movie" | undefined,
  yaml: string,
  slot: MediuxSetSlot = "main",
): Promise<void> {
  const target = await resolveWatchTarget(client, scopeRatingKey, scopeType);
  if (!target) return;
  // Episode cards only exist on shows.
  const effectiveSlot = target.type === "show" ? slot : "main";
  const setUrl = extractSetUrl(yaml).url;
  const signature = await computeSignature(client, target).catch(() => undefined);
  upsertMediuxWatch({ ...target, yaml, setUrl, signature, slot: effectiveSlot });
}

/**
 * The part of a show's main set to apply: everything, unless a separate
 * episode-card set is tracked — then its own cards are skipped so the two
 * sets don't fight over the same episodes.
 */
export function mainSetPart(watch: { episodesYaml?: string } | undefined): MediuxPart {
  return watch?.episodesYaml ? "posters" : "all";
}

/** The part a new apply should use, given the show's currently tracked sets. */
export function partForSlot(slot: MediuxSetSlot, targetRatingKey: string | undefined): MediuxPart {
  if (slot === "episodes") return "episodes";
  return targetRatingKey ? mainSetPart(getMediuxWatch(targetRatingKey)) : "all";
}

/** Whether a YAML has anything for this part (no throw). */
function hasPart(yaml: string, part: MediuxPart): boolean {
  try {
    filterSet(parseMediuxYaml(yaml), part);
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-apply every set a show tracks: the main set (minus its episode cards when
 * a separate card set exists), then the episode-card set — so the card set
 * always wins for episode cards.
 */
async function applyShowSets(
  client: PlexClient,
  watch: MediuxWatchFull,
  report?: ProgressReporter<MediuxMatch>,
): Promise<void> {
  const mainPart = mainSetPart(watch);
  if (watch.yaml.trim() && hasPart(watch.yaml, mainPart)) {
    if (watch.episodesYaml) report?.log("• show & season posters set");
    await applyMediux(client, watch.yaml, report, mainPart);
  }
  if (watch.episodesYaml) {
    report?.log("• episode title cards set");
    await applyMediux(client, watch.episodesYaml, report, "episodes");
  }
}

/** Build the transient collection-sync rule a watch stands in for. */
function watchRule(watch: MediuxWatchFull, sectionId: string): Rule {
  return {
    id: 0,
    name: `MediUX sync — ${watch.title}`,
    enabled: true,
    requireApproval: false,
    sectionId,
    source: {
      kind: "tmdb-collection",
      tmdbCollectionId: Number(watch.tmdbId),
      tmdbCollectionName: watch.title,
    },
    collectionTitle: watch.title,
    collectionRatingKey: watch.ratingKey,
    addMatching: true,
    removeStrays: false,
    mediuxYaml: watch.yaml,
    schedule: "manual",
  };
}

export interface SyncOutcome {
  /**
   * Whether something actually happened worth reporting. In detect mode a
   * collection that gained no new members is `false`, so unrelated library
   * growth no longer spams the timeline/Discord for every tracked item.
   */
  changed: boolean;
  added: number;
  /** Human-readable summary for the timeline / job feed. */
  result: string;
}

/**
 * Sync one watch: for collections, add any newly-owned franchise films and
 * re-apply the set to them (via the rules engine); for shows, re-apply the set
 * so new seasons/episode cards get their art. `force` re-applies even when a
 * collection gained no new members (used by "Run now" / scheduled cadence).
 */
export async function syncWatch(
  client: PlexClient,
  watch: MediuxWatchFull,
  opts: { force: boolean; report?: ProgressReporter<MediuxMatch> },
): Promise<SyncOutcome> {
  const log = (line: string) => opts.report?.log(line);

  if (watch.type === "show") {
    // A show only reaches here on a real season change (detect) or on force, so
    // re-applying its art is always meaningful.
    opts.report?.setCurrent(`Re-applying “${watch.title}” artwork…`);
    await applyShowSets(client, watch, opts.report);
    return { changed: true, added: 0, result: "artwork re-applied" };
  }

  // Collection: keep membership complete, then the engine re-applies the set to
  // whatever it added. Falls back to a plain re-apply if the TMDb link is
  // unknown (so "Run now" still restyles the existing members).
  const item = await client.item(watch.ratingKey).catch(() => undefined);
  const sectionId = item?.librarySectionId;

  if (watch.tmdbId && sectionId) {
    const rule = watchRule(watch, sectionId);
    // evaluateRule reports RuleChanges; surface each added film in the same
    // job feed as MediUX results so "Run now" shows what it added.
    const ruleReport: ProgressReporter<RuleChange> | undefined = opts.report && {
      setCurrent: (l) => opts.report!.setCurrent(l),
      log: (l) => opts.report!.log(l),
      push: (rc) =>
        opts.report!.push({
          id: rc.ratingKey,
          kind: "item",
          title: rc.title,
          ratingKey: rc.ratingKey,
          thumb: rc.thumb,
          hasPoster: false,
          hasBackground: false,
          seasonCount: 0,
          episodeCount: 0,
          applied: true,
        }),
    };
    const evaluation = await evaluateRule(client, rule, { dryRun: false, report: ruleReport });
    const added = evaluation.toAdd.length;
    if (added > 0) return { changed: true, added, result: `added ${added}, artwork re-applied` };
    if (opts.force) {
      log("• re-applying the MediUX set to existing members");
      await applyMediux(client, watch.yaml, opts.report);
      return { changed: true, added: 0, result: "artwork re-applied" };
    }
    // Detect mode, nothing new joined the collection — no work, nothing to say.
    return { changed: false, added: 0, result: "no change" };
  }

  // No TMDb link: we can't tell what (if anything) is new, so only re-apply on
  // an explicit force (manual/scheduled) — never spam on unrelated library growth.
  if (opts.force) {
    await applyMediux(client, watch.yaml, opts.report);
    return { changed: true, added: 0, result: "artwork re-applied" };
  }
  return { changed: false, added: 0, result: "no change" };
}

/**
 * Scheduler entry point. In `detect` mode a watch is synced when its
 * fingerprint changed; in a scheduled mode it's re-applied on that cadence.
 * Items that turn out not to have changed advance their signature silently — no
 * timeline entry, no Discord ping. Everything that did change is logged to the
 * timeline individually and reported to Discord as a single batched message.
 */
export async function runMediuxAutoSync(client: PlexClient, log: FastifyBaseLogger): Promise<void> {
  if (!mediuxAutoSyncEnabled()) return;
  const mode = mediuxSyncMode();
  const now = Date.now();
  setAppSetting("mediux_last_check", String(now));

  const triggerLabel = mode === "detect" ? "detected a change" : `${mode} schedule`;
  const changes: MediuxSweepChange[] = [];

  for (const watch of listMediuxWatches()) {
    if (!watch.enabled) continue;

    let current: string | undefined;
    try {
      current = await computeSignature(client, watch);
    } catch {
      continue; // Plex unreachable for this item — try again next tick.
    }

    const changed = !watch.lastSignature || current !== watch.lastSignature;
    const due =
      mode === "detect"
        ? changed
        : !watch.lastSyncedAt || now - watch.lastSyncedAt >= SCHEDULE_INTERVALS[mode];
    if (!due) continue;

    try {
      const outcome = await syncWatch(client, watch, { force: mode !== "detect" });
      const after = await computeSignature(client, watch).catch(() => current);
      recordMediuxWatchSync(watch.ratingKey, after, outcome.changed ? outcome.result : "no change");
      // Only surface items that actually changed — a collection that just saw an
      // unrelated library addition (its section total ticked up, but no new
      // franchise film joined it) advances its signature quietly.
      if (outcome.changed) {
        log.info({ ratingKey: watch.ratingKey, title: watch.title, mode }, "mediux auto-sync");
        recordActivity(
          {
            kind: "mediux-sync",
            title: watch.title,
            detail: outcome.result,
            status: "ok",
            trigger: triggerLabel,
          },
          { notify: false },
        );
        changes.push({ title: watch.title, detail: outcome.result, status: "ok" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "sync failed";
      recordMediuxWatchSync(watch.ratingKey, watch.lastSignature, `Error: ${message}`);
      recordActivity(
        {
          kind: "mediux-sync",
          title: watch.title,
          detail: message,
          status: "error",
          trigger: triggerLabel,
        },
        { notify: false },
      );
      changes.push({ title: watch.title, detail: message, status: "error" });
      log.error({ err, ratingKey: watch.ratingKey }, "mediux auto-sync failed");
    }
  }

  await notifyMediuxSweep(changes, triggerLabel);
}
