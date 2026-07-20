import type {
  Rule,
  RuleChange,
  RuleEvaluation,
  RuleRun,
  RuleSource,
} from "@metamagic/shared";
import type { PlexClient } from "./plex.js";
import { PlexError } from "./plex.js";
import { indexByIds, applyMediux, type ProgressReporter } from "./mediux.js";
import { discoverByKeyword, getTmdbCollectionParts } from "./tmdb.js";
import {
  recordRuleOutcome,
  recordRun,
  setRuleCollectionKey,
} from "./db.js";
import { notifyRuleRun } from "./notify.js";

/** A title the rule's source says belongs in the collection. */
interface SourceTitle {
  tmdbId: string;
  title: string;
  year?: number;
  posterUrl?: string;
}

async function resolveSource(source: RuleSource): Promise<SourceTitle[]> {
  if (source.kind === "tmdb-collection") {
    const collection = await getTmdbCollectionParts(source.tmdbCollectionId);
    if (!collection) {
      throw new PlexError(`TMDb collection ${source.tmdbCollectionId} could not be loaded.`, 502);
    }
    return collection.parts.map((p) => ({
      tmdbId: p.tmdbId,
      title: p.title,
      year: p.year,
      posterUrl: p.posterUrl,
    }));
  }
  const results = await discoverByKeyword(source.keywordId);
  return results.map((r) => ({
    tmdbId: r.tmdbId,
    title: r.title,
    year: r.year,
    posterUrl: r.posterUrl,
  }));
}

export function describeSource(source: RuleSource): string {
  return source.kind === "tmdb-collection"
    ? `TMDb collection “${source.tmdbCollectionName}”`
    : `TMDb keyword “${source.keywordName}”`;
}

export interface EvaluateOptions {
  dryRun: boolean;
  report?: ProgressReporter<RuleChange>;
}

/**
 * Core of the rules engine. Resolves the rule's source to a set of titles,
 * intersects that with the library, diffs it against the target collection and
 * (unless dryRun) applies the difference.
 *
 * Preview and real runs share this single code path so they can't drift.
 */
export async function evaluateRule(
  client: PlexClient,
  rule: Rule,
  { dryRun, report }: EvaluateOptions,
): Promise<RuleEvaluation> {
  const log = (line: string) => report?.log(line);
  report?.setCurrent(`Resolving ${describeSource(rule.source)}…`);

  const sourceTitles = await resolveSource(rule.source);
  log(`• ${describeSource(rule.source)} lists ${sourceTitles.length} title(s)`);

  report?.setCurrent("Scanning your libraries…");
  const index = await indexByIds(client);

  // Which of the source's titles do we actually own?
  const owned = new Map<string, RuleChange>();
  const missingFromLibrary: SourceTitle[] = [];
  for (const t of sourceTitles) {
    const hit = index.get(`tmdb:${t.tmdbId}`);
    if (hit && hit.sectionId === rule.sectionId) {
      owned.set(hit.ratingKey, {
        ratingKey: hit.ratingKey,
        title: hit.title,
        year: t.year,
        thumb: hit.thumb,
      });
    } else if (!hit) {
      missingFromLibrary.push(t);
    }
  }
  log(`• ${owned.size} in your library, ${missingFromLibrary.length} not downloaded`);

  // Current collection membership (may not exist yet)
  let collectionRatingKey = rule.collectionRatingKey;
  let existing: RuleChange[] = [];
  if (collectionRatingKey) {
    try {
      const children = await client.collectionChildren(collectionRatingKey);
      existing = children.map((c) => ({
        ratingKey: c.ratingKey,
        title: c.title,
        year: c.year,
        thumb: c.thumb,
      }));
    } catch {
      // Collection was deleted in Plex — treat as missing and recreate below.
      log(`• collection no longer exists in Plex, it will be recreated`);
      collectionRatingKey = undefined;
    }
  }
  const existingKeys = new Set(existing.map((e) => e.ratingKey));

  const toAdd = rule.addMatching
    ? [...owned.values()].filter((o) => !existingKeys.has(o.ratingKey))
    : [];
  const toRemove = rule.removeStrays
    ? existing.filter((e) => !owned.has(e.ratingKey))
    : [];

  log(`• ${toAdd.length} to add, ${toRemove.length} to remove`);

  const evaluation: RuleEvaluation = {
    ruleId: rule.id,
    ruleName: rule.name,
    collectionTitle: rule.collectionTitle,
    toAdd,
    toRemove,
    missingFromLibrary: missingFromLibrary.map((m) => ({
      tmdbId: m.tmdbId,
      title: m.title,
      year: m.year,
      posterUrl: m.posterUrl,
    })),
    applied: false,
  };

  if (dryRun || (toAdd.length === 0 && toRemove.length === 0)) {
    if (dryRun) log("• preview only — nothing was changed");
    return evaluation;
  }

  await applyChanges(client, rule, collectionRatingKey, toAdd, toRemove, report);
  evaluation.applied = true;
  return evaluation;
}

/** Apply a previously computed diff (used by real runs and by approvals). */
export async function applyChanges(
  client: PlexClient,
  rule: Rule,
  collectionRatingKey: string | undefined,
  toAdd: RuleChange[],
  toRemove: RuleChange[],
  report?: ProgressReporter<RuleChange>,
): Promise<void> {
  const log = (line: string) => report?.log(line);
  let key = collectionRatingKey;

  if (!key) {
    if (toAdd.length === 0) return;
    report?.setCurrent(`Creating collection “${rule.collectionTitle}”…`);
    const sections = await client.sections();
    const section = sections.find((s) => s.id === rule.sectionId);
    if (!section) throw new PlexError(`Library section ${rule.sectionId} not found`, 404);
    const created = await client.createCollection(
      rule.sectionId,
      section.type,
      rule.collectionTitle,
      toAdd.map((a) => a.ratingKey),
    );
    key = created.ratingKey;
    setRuleCollectionKey(rule.id, key);
    log(`✓ created collection “${rule.collectionTitle}” with ${toAdd.length} item(s)`);
    for (const a of toAdd) report?.push(a);
  } else if (toAdd.length > 0) {
    report?.setCurrent(`Adding ${toAdd.length} item(s) to “${rule.collectionTitle}”…`);
    await client.addToCollection(
      key,
      toAdd.map((a) => a.ratingKey),
    );
    for (const a of toAdd) {
      log(`✓ added ${a.title}${a.year ? ` (${a.year})` : ""}`);
      report?.push(a);
    }
  }

  for (const r of toRemove) {
    report?.setCurrent(`Removing ${r.title}…`);
    try {
      await client.removeFromCollection(key, r.ratingKey);
      log(`✓ removed ${r.title}${r.year ? ` (${r.year})` : ""}`);
    } catch (err) {
      log(`✗ could not remove ${r.title} — ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  // Re-apply the rule's MediUX set so new arrivals get their artwork too.
  if (rule.mediuxYaml && toAdd.length > 0) {
    report?.setCurrent("Re-applying MediUX artwork…");
    log("• re-applying the rule's MediUX set");
    try {
      await applyMediux(client, rule.mediuxYaml, {
        setCurrent: (l) => report?.setCurrent(l),
        push: () => {},
        log,
      });
    } catch (err) {
      log(`✗ MediUX re-apply failed — ${err instanceof Error ? err.message : "failed"}`);
    }
  }
}

/** Run a rule end to end, recording history and notifying. */
export async function runRule(
  client: PlexClient,
  rule: Rule,
  trigger: "manual" | "schedule",
  report?: ProgressReporter<RuleChange>,
): Promise<RuleRun> {
  const startedAt = Date.now();
  const lines: string[] = [];
  const capture: ProgressReporter<RuleChange> = {
    setCurrent: (l) => report?.setCurrent(l),
    push: (r) => report?.push(r),
    log: (l) => {
      lines.push(l);
      report?.log(l);
    },
  };

  try {
    // Rules that need approval always evaluate dry first.
    const evaluation = await evaluateRule(client, rule, {
      dryRun: rule.requireApproval,
      report: capture,
    });

    const changed = evaluation.toAdd.length > 0 || evaluation.toRemove.length > 0;
    if (!changed) {
      recordRuleOutcome(rule.id, "No changes");
      return recordRun({
        ruleId: rule.id,
        ruleName: rule.name,
        startedAt,
        status: "no-changes",
        trigger,
        addedCount: 0,
        removedCount: 0,
        log: lines,
      });
    }

    if (rule.requireApproval) {
      capture.log("• waiting for your approval — nothing applied yet");
      recordRuleOutcome(rule.id, `${evaluation.toAdd.length} change(s) awaiting approval`);
      const run = recordRun({
        ruleId: rule.id,
        ruleName: rule.name,
        startedAt,
        status: "pending",
        trigger,
        addedCount: evaluation.toAdd.length,
        removedCount: evaluation.toRemove.length,
        log: lines,
        pending: { toAdd: evaluation.toAdd, toRemove: evaluation.toRemove },
      });
      await notifyRuleRun(run, rule);
      return run;
    }

    recordRuleOutcome(
      rule.id,
      `Added ${evaluation.toAdd.length}, removed ${evaluation.toRemove.length}`,
    );
    const run = recordRun({
      ruleId: rule.id,
      ruleName: rule.name,
      startedAt,
      status: "applied",
      trigger,
      addedCount: evaluation.toAdd.length,
      removedCount: evaluation.toRemove.length,
      log: lines,
    });
    await notifyRuleRun(run, rule);
    return run;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Rule failed";
    lines.push(`✗ ${message}`);
    recordRuleOutcome(rule.id, `Error: ${message}`);
    const run = recordRun({
      ruleId: rule.id,
      ruleName: rule.name,
      startedAt,
      status: "error",
      trigger,
      addedCount: 0,
      removedCount: 0,
      error: message,
      log: lines,
    });
    await notifyRuleRun(run, rule);
    return run;
  }
}
