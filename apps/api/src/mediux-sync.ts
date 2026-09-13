import type { FastifyBaseLogger } from "fastify";
import type { Rule } from "@metamagic/shared";
import type { PlexClient } from "./plex.js";
import {
  getAppSetting,
  listMediuxWatches,
  recordMediuxWatchSync,
  setAppSetting,
  upsertMediuxWatch,
  type MediuxWatchFull,
} from "./db.js";
import { applyMediux, extractSetUrl, type ProgressReporter } from "./mediux.js";
import { evaluateRule } from "./rules.js";
import { resolveTmdbCollection } from "./collection-match.js";
import { recordActivity } from "./activity.js";
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

/**
 * Remember (or refresh) the MediUX set applied to a collection or show so it can
 * be re-applied automatically later. Season scopes map to their parent show;
 * movie scopes are ignored (no franchise-level target to sync).
 */
export async function rememberMediuxSet(
  client: PlexClient,
  scopeRatingKey: string,
  scopeType: "collection" | "show" | "season" | "movie" | undefined,
  yaml: string,
): Promise<void> {
  const item = await client.item(scopeRatingKey).catch(() => undefined);
  if (!item) return;

  const effectiveType = scopeType ?? item.type;
  let type: "collection" | "show";
  let ratingKey = scopeRatingKey;
  let title = item.title;
  let tmdbId: string | undefined;

  if (effectiveType === "collection") {
    type = "collection";
    const children = await client.collectionChildren(ratingKey).catch(() => []);
    const resolved = await resolveTmdbCollection(ratingKey, item.title, children).catch(
      () => undefined,
    );
    tmdbId = resolved ? String(resolved.id) : undefined;
  } else if (effectiveType === "show") {
    type = "show";
    tmdbId = item.tmdbId;
  } else if (effectiveType === "season") {
    if (!item.parentRatingKey) return;
    const show = await client.item(item.parentRatingKey).catch(() => undefined);
    if (!show) return;
    type = "show";
    ratingKey = show.ratingKey;
    title = show.title;
    tmdbId = show.tmdbId;
  } else {
    // Movies (and anything else) have no collection/show to keep in sync.
    return;
  }

  const setUrl = extractSetUrl(yaml).url;
  const signature = await computeSignature(client, { ratingKey, type }).catch(() => undefined);
  upsertMediuxWatch({ ratingKey, type, title, tmdbId, yaml, setUrl, signature });
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

/**
 * Sync one watch: for collections, add any newly-owned franchise films and
 * re-apply the set to them (via the rules engine); for shows, re-apply the set
 * so new seasons/episode cards get their art. `force` re-applies even when a
 * collection gained no new members (used by "Run now").
 */
export async function syncWatch(
  client: PlexClient,
  watch: MediuxWatchFull,
  opts: { force: boolean; report?: ProgressReporter<MediuxMatch> },
): Promise<string> {
  const log = (line: string) => opts.report?.log(line);

  if (watch.type === "show") {
    opts.report?.setCurrent(`Re-applying “${watch.title}” artwork…`);
    await applyMediux(client, watch.yaml, opts.report);
    return "artwork re-applied";
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
    if (opts.force && evaluation.toAdd.length === 0) {
      log("• re-applying the MediUX set to existing members");
      await applyMediux(client, watch.yaml, opts.report);
    }
    return `added ${evaluation.toAdd.length}, artwork re-applied`;
  }

  await applyMediux(client, watch.yaml, opts.report);
  return "artwork re-applied";
}

/**
 * Scheduler entry point. In `detect` mode a watch is synced when its
 * fingerprint changed; in a scheduled mode it's re-applied on that cadence.
 */
export async function runMediuxAutoSync(client: PlexClient, log: FastifyBaseLogger): Promise<void> {
  if (!mediuxAutoSyncEnabled()) return;
  const mode = mediuxSyncMode();
  const now = Date.now();
  setAppSetting("mediux_last_check", String(now));

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

    log.info({ ratingKey: watch.ratingKey, title: watch.title, mode }, "mediux auto-sync");
    try {
      const result = await syncWatch(client, watch, { force: mode !== "detect" });
      const after = await computeSignature(client, watch).catch(() => current);
      recordMediuxWatchSync(watch.ratingKey, after, result);
      recordActivity({
        kind: "mediux-sync",
        title: watch.title,
        detail: result,
        status: "ok",
        trigger: mode === "detect" ? "detected a change" : `${mode} schedule`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "sync failed";
      recordMediuxWatchSync(watch.ratingKey, watch.lastSignature, `Error: ${message}`);
      recordActivity({
        kind: "mediux-sync",
        title: watch.title,
        detail: message,
        status: "error",
        trigger: mode === "detect" ? "detected a change" : `${mode} schedule`,
      });
      log.error({ err, ratingKey: watch.ratingKey }, "mediux auto-sync failed");
    }
  }
}
