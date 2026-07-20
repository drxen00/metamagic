import type { FastifyBaseLogger } from "fastify";
import type { Rule } from "@metamagic/shared";
import { getAppSetting, listRules } from "./db.js";
import { plexClient } from "./client-store.js";
import { runRule } from "./rules.js";

const TICK_MS = 15 * 60 * 1000;

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
  };

  // A short delay so the first tick doesn't race container startup.
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), TICK_MS);
  }, 30_000).unref?.();

  log.info("automation scheduler started (15 min tick)");
}
