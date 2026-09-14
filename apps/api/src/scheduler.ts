import type { FastifyBaseLogger } from "fastify";
import type { Rule } from "@metamagic/shared";
import { getAppSetting, listRules } from "./db.js";
import { plexClient } from "./client-store.js";
import { runRule } from "./rules.js";
import { runMediuxAutoSync } from "./mediux-sync.js";
import { runPresetAutomations } from "./automations.js";
import { runWatcherTick } from "./watcher.js";

const TICK_MS = 15 * 60 * 1000;
/** Fast change-watcher tick — reacts to new content within ~a minute. */
const WATCH_TICK_MS = 60 * 1000;

const INTERVALS: Record<string, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

export function automationsPaused(): boolean {
  return getAppSetting("automations_paused") === "true";
}

function isDue(rule: Rule, now: number): boolean {
  if (!rule.enabled || rule.schedule === "manual") return false;
  const interval = INTERVALS[rule.schedule];
  if (!interval) return false;
  return !rule.lastRunAt || now - rule.lastRunAt >= interval;
}

/** Ticks every 15 minutes and runs whatever is due. */
export function startScheduler(log: FastifyBaseLogger): void {
  const tick = async () => {
    if (automationsPaused()) return;
    const client = plexClient();
    if (!client) return;

    const now = Date.now();
    for (const rule of listRules()) {
      if (!isDue(rule, now)) continue;
      log.info({ ruleId: rule.id, rule: rule.name }, "running scheduled rule");
      try {
        const run = await runRule(client, rule, "schedule");
        log.info(
          { ruleId: rule.id, status: run.status, added: run.addedCount, removed: run.removedCount },
          "scheduled rule finished",
        );
      } catch (err) {
        log.error({ err, ruleId: rule.id }, "scheduled rule threw");
      }
    }

    // MediUX auto-sync: re-style collections/shows whose content changed.
    try {
      await runMediuxAutoSync(client, log);
    } catch (err) {
      log.error({ err }, "mediux auto-sync threw");
    }

    // Preset automations: franchise auto-create, auto-add to existing (daily).
    try {
      await runPresetAutomations(client, log);
    } catch (err) {
      log.error({ err }, "preset automations threw");
    }
  };

  // Never let a slow tick overlap the next one — concurrent full-library scans
  // would pile up connections and starve the API.
  let ticking = false;
  const runTick = async () => {
    if (ticking) {
      log.warn("previous scheduler tick still running, skipping this one");
      return;
    }
    ticking = true;
    try {
      await tick();
    } finally {
      ticking = false;
    }
  };

  // Fast change-watcher: reacts to new content within ~a minute so automations
  // feel instant, instead of waiting for the 15-min/daily tick.
  let watching = false;
  const watchTick = async () => {
    if (automationsPaused() || watching) return;
    const client = plexClient();
    if (!client) return;
    watching = true;
    try {
      await runWatcherTick(client, log);
    } catch (err) {
      log.error({ err }, "watcher tick threw");
    } finally {
      watching = false;
    }
  };

  // A short delay so the first tick doesn't race container startup.
  setTimeout(() => {
    void runTick();
    setInterval(() => void runTick(), TICK_MS);
  }, 30_000).unref?.();

  setTimeout(() => {
    void watchTick();
    setInterval(() => void watchTick(), WATCH_TICK_MS);
  }, 20_000).unref?.();

  log.info("automation scheduler started (15 min tick + 60s change-watcher)");
}
