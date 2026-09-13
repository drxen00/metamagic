import type { FastifyInstance } from "fastify";
import {
  automationSettingsSchema,
  autoAddExistingSchema,
  franchiseAutoCreateSchema,
  mediuxSyncSettingsSchema,
  mediuxWatchUpdateSchema,
  ruleInputSchema,
  type ActivityEvent,
  type AutomationPresets,
  type AutomationSettings,
  type DiscoveredCollection,
  type MediuxMatch,
  type MediuxSyncState,
  type MediuxWatch,
  type Rule,
  type RuleChange,
  type RuleEvaluation,
  type RuleRun,
} from "@metamagic/shared";
import { requirePlex } from "./client-store.js";
import { PlexError } from "./plex.js";
import {
  createRule,
  deleteRule,
  deleteMediuxWatch,
  getMediuxWatch,
  getRule,
  getRun,
  listMediuxWatches,
  listRules,
  listRuns,
  resolveRun,
  setAppSetting,
  setMediuxWatchEnabled,
  recordMediuxWatchSync,
  getAppSetting,
  updateRule,
} from "./db.js";
import { applyChanges, evaluateRule, runRule } from "./rules.js";
import {
  computeSignature,
  mediuxAutoSyncEnabled,
  mediuxLastCheckedAt,
  mediuxSyncMode,
  syncWatch,
} from "./mediux-sync.js";
import { listActivity, recordActivity } from "./activity.js";
import {
  automationsLastRunAt,
  getAutoAddExisting,
  getFranchiseAutoCreate,
  setAutoAddExisting,
  setFranchiseAutoCreate,
} from "./automations.js";
import { discoverCollections } from "./discover.js";
import { searchKeywords } from "./tmdb.js";
import { startJob, getJob } from "./jobs.js";
import { sendTestNotification } from "./notify.js";
import { automationsPaused } from "./scheduler.js";

/** Public view of a watch — the stored YAML/fingerprint stay server-side. */
function toWatchSummary(w: ReturnType<typeof listMediuxWatches>[number]): MediuxWatch {
  return {
    ratingKey: w.ratingKey,
    type: w.type,
    title: w.title,
    thumb: w.thumb,
    tmdbId: w.tmdbId,
    setUrl: w.setUrl,
    enabled: w.enabled,
    lastSyncedAt: w.lastSyncedAt,
    lastResult: w.lastResult,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

export function registerRuleRoutes(app: FastifyInstance): void {
  // ---------- Rule CRUD ----------

  app.get("/api/rules", async (): Promise<Rule[]> => listRules());

  app.post("/api/rules", async (req): Promise<Rule> => {
    const input = ruleInputSchema.parse(req.body);
    return createRule(input);
  });

  app.put<{ Params: { id: string } }>("/api/rules/:id", async (req, reply) => {
    const input = ruleInputSchema.parse(req.body);
    const rule = updateRule(Number(req.params.id), input);
    if (!rule) return reply.status(404).send({ error: "Rule not found" });
    return rule;
  });

  app.delete<{ Params: { id: string } }>("/api/rules/:id", async (req) => {
    deleteRule(Number(req.params.id));
    return { ok: true };
  });

  // ---------- Preview & run ----------

  app.post<{ Params: { id: string } }>(
    "/api/rules/:id/preview",
    async (req, reply): Promise<RuleEvaluation | undefined> => {
      const rule = getRule(Number(req.params.id));
      if (!rule) return reply.status(404).send({ error: "Rule not found" });
      return evaluateRule(requirePlex(), rule, { dryRun: true });
    },
  );

  /** Preview an unsaved rule (the create/edit dialog uses this). */
  app.post("/api/rules/preview", async (req): Promise<RuleEvaluation> => {
    const input = ruleInputSchema.parse(req.body);
    const draft: Rule = { ...input, id: 0 };
    return evaluateRule(requirePlex(), draft, { dryRun: true });
  });

  app.post<{ Params: { id: string } }>("/api/rules/:id/run", async (req, reply) => {
    const rule = getRule(Number(req.params.id));
    if (!rule) return reply.status(404).send({ error: "Rule not found" });
    const client = requirePlex();
    const job = startJob<RuleChange>("rule-run", async (report) => {
      await runRule(client, rule, "manual", report);
    });
    return { jobId: job.id };
  });

  // ---------- Run history & approvals ----------

  app.get("/api/runs", async (): Promise<RuleRun[]> => listRuns());

  app.post<{ Params: { id: string } }>("/api/runs/:id/apply", async (req, reply) => {
    const run = getRun(Number(req.params.id));
    if (!run) return reply.status(404).send({ error: "Run not found" });
    if (run.status !== "pending" || !run.pending) {
      return reply.status(400).send({ error: "That run has nothing waiting to apply." });
    }
    const rule = getRule(run.ruleId);
    if (!rule) return reply.status(404).send({ error: "The rule no longer exists." });

    const client = requirePlex();
    const { toAdd, toRemove } = run.pending;
    const job = startJob<RuleChange>("rule-apply", async (report) => {
      await applyChanges(client, rule, rule.collectionRatingKey, toAdd, toRemove, report);
      resolveRun(run.id, "applied", toAdd.length, toRemove.length);
    });
    return { jobId: job.id };
  });

  app.post<{ Params: { id: string } }>("/api/runs/:id/dismiss", async (req, reply) => {
    const run = getRun(Number(req.params.id));
    if (!run) return reply.status(404).send({ error: "Run not found" });
    resolveRun(run.id, "dismissed");
    return { ok: true };
  });

  // ---------- Discovery ----------

  app.post("/api/discover/collections", async () => {
    const client = requirePlex();
    const job = startJob<DiscoveredCollection>("discover", async (report) => {
      await discoverCollections(client, report);
    });
    return { jobId: job.id };
  });

  /** Create a collection straight from a discovery suggestion. */
  app.post<{
    Body: { sectionId?: string; title?: string; ratingKeys?: string[] };
  }>("/api/discover/create", async (req, reply) => {
    const { sectionId, title, ratingKeys } = req.body ?? {};
    if (!sectionId || !title || !ratingKeys?.length) {
      return reply.status(400).send({ error: "sectionId, title and ratingKeys are required." });
    }
    const client = requirePlex();
    const sections = await client.sections();
    const section = sections.find((s) => s.id === sectionId);
    if (!section) throw new PlexError(`Library section ${sectionId} not found`, 404);

    // Don't create a duplicate: if every chosen film already shares one existing
    // collection, say so rather than making a second one with the same members.
    const norm = (s: string) =>
      s.toLowerCase().replace(/\s+collection\s*$/, "").replace(/[^a-z0-9]+/g, " ").trim();
    let shared: Set<string> | undefined;
    for (const rk of ratingKeys) {
      const it = await client.item(rk).catch(() => undefined);
      const tags = new Set((it?.collections ?? []).map((c) => norm(c.tag)));
      shared = shared ? new Set([...shared].filter((t) => tags.has(t))) : tags;
      if (shared.size === 0) break;
    }
    if (shared && shared.size > 0) {
      const match = (await client.collections(sectionId)).find((c) => shared!.has(norm(c.title)));
      if (match) {
        return reply.status(409).send({
          error: `Those films are already in the “${match.title}” collection.`,
        });
      }
    }

    const created = await client.createCollection(sectionId, section.type, title, ratingKeys);
    recordActivity({
      kind: "collection-created",
      title: `Created collection “${title}”`,
      detail: `${ratingKeys.length} film(s)`,
      status: "ok",
      trigger: "manual",
    });
    return created;
  });

  // ---------- Keyword search (rule sources) ----------

  app.get<{ Querystring: { q?: string } }>("/api/tmdb/keywords", async (req) => {
    const q = req.query.q?.trim();
    if (!q) return [];
    return searchKeywords(q);
  });

  // ---------- Automation settings ----------

  app.get("/api/settings/automations", async (): Promise<AutomationSettings> => ({
    paused: automationsPaused(),
    discordConfigured: !!getAppSetting("discord_webhook_url"),
  }));

  app.put("/api/settings/automations", async (req): Promise<AutomationSettings> => {
    const input = automationSettingsSchema.parse(req.body);
    if (input.paused !== undefined) {
      setAppSetting("automations_paused", input.paused ? "true" : "");
    }
    if (input.discordWebhookUrl !== undefined) {
      setAppSetting("discord_webhook_url", input.discordWebhookUrl);
    }
    return {
      paused: automationsPaused(),
      discordConfigured: !!getAppSetting("discord_webhook_url"),
    };
  });

  app.post("/api/settings/automations/test-discord", async (_req, reply) => {
    const url = getAppSetting("discord_webhook_url");
    if (!url) return reply.status(428).send({ error: "Save a Discord webhook URL first." });
    try {
      await sendTestNotification(url);
      return { ok: true };
    } catch {
      return reply.status(502).send({ error: "Discord rejected the webhook — check the URL." });
    }
  });

  // ---------- MediUX auto-sync ----------

  const syncState = (): MediuxSyncState => ({
    enabled: mediuxAutoSyncEnabled(),
    mode: mediuxSyncMode(),
    lastCheckedAt: mediuxLastCheckedAt(),
    watches: listMediuxWatches().map(toWatchSummary),
  });

  app.get("/api/mediux/sync", async (): Promise<MediuxSyncState> => syncState());

  app.put("/api/mediux/sync", async (req): Promise<MediuxSyncState> => {
    const input = mediuxSyncSettingsSchema.parse(req.body);
    if (input.enabled !== undefined) setAppSetting("mediux_autosync", input.enabled ? "true" : "");
    if (input.mode !== undefined) setAppSetting("mediux_sync_mode", input.mode);
    return syncState();
  });

  app.put<{ Params: { ratingKey: string } }>(
    "/api/mediux/watches/:ratingKey",
    async (req, reply) => {
      const input = mediuxWatchUpdateSchema.parse(req.body);
      if (!getMediuxWatch(req.params.ratingKey)) {
        return reply.status(404).send({ error: "That MediUX watch no longer exists." });
      }
      setMediuxWatchEnabled(req.params.ratingKey, input.enabled);
      return { ok: true };
    },
  );

  app.delete<{ Params: { ratingKey: string } }>("/api/mediux/watches/:ratingKey", async (req) => {
    deleteMediuxWatch(req.params.ratingKey);
    return { ok: true };
  });

  // Sync one watch right now (adds new members + re-applies its set).
  app.post<{ Params: { ratingKey: string } }>(
    "/api/mediux/watches/:ratingKey/run",
    async (req, reply) => {
      const watch = getMediuxWatch(req.params.ratingKey);
      if (!watch) return reply.status(404).send({ error: "That MediUX watch no longer exists." });
      const client = requirePlex();
      const job = startJob<MediuxMatch>("mediux-sync", async (report) => {
        try {
          const result = await syncWatch(client, watch, { force: true, report });
          const after = await computeSignature(client, watch).catch(() => watch.lastSignature);
          recordMediuxWatchSync(watch.ratingKey, after, result);
          recordActivity({
            kind: "mediux-sync",
            title: watch.title,
            detail: result,
            status: "ok",
            trigger: "manual",
          });
        } catch (err) {
          recordActivity({
            kind: "mediux-sync",
            title: watch.title,
            detail: err instanceof Error ? err.message : "sync failed",
            status: "error",
            trigger: "manual",
          });
          throw err;
        }
      });
      return { jobId: job.id };
    },
  );

  // Sync every enabled watch now, one job with a combined transcript.
  app.post("/api/mediux/sync/run-all", async (_req, reply) => {
    const watches = listMediuxWatches().filter((w) => w.enabled);
    if (watches.length === 0) {
      return reply.status(400).send({ error: "No enabled MediUX items to sync." });
    }
    const client = requirePlex();
    const job = startJob<MediuxMatch>("mediux-sync-all", async (report) => {
      for (const w of watches) {
        report.setCurrent(`Syncing ${w.title}…`);
        try {
          const result = await syncWatch(client, w, { force: true, report });
          const after = await computeSignature(client, w).catch(() => w.lastSignature);
          recordMediuxWatchSync(w.ratingKey, after, result);
          recordActivity({
            kind: "mediux-sync",
            title: w.title,
            detail: result,
            status: "ok",
            trigger: "manual (sync all)",
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "sync failed";
          recordMediuxWatchSync(w.ratingKey, w.lastSignature, `Error: ${msg}`);
          recordActivity({
            kind: "mediux-sync",
            title: w.title,
            detail: msg,
            status: "error",
            trigger: "manual (sync all)",
          });
          report.log(`✗ ${w.title} — ${msg}`);
        }
      }
    });
    return { jobId: job.id };
  });

  // ---------- Preset automations ----------

  app.get("/api/automations/presets", async (): Promise<AutomationPresets> => ({
    franchise: getFranchiseAutoCreate(),
    autoAdd: getAutoAddExisting(),
    lastRunAt: automationsLastRunAt(),
  }));

  app.put("/api/automations/franchise", async (req): Promise<AutomationPresets> => {
    setFranchiseAutoCreate(franchiseAutoCreateSchema.parse(req.body));
    return { franchise: getFranchiseAutoCreate(), autoAdd: getAutoAddExisting(), lastRunAt: automationsLastRunAt() };
  });

  app.put("/api/automations/auto-add", async (req): Promise<AutomationPresets> => {
    setAutoAddExisting(autoAddExistingSchema.parse(req.body));
    return { franchise: getFranchiseAutoCreate(), autoAdd: getAutoAddExisting(), lastRunAt: automationsLastRunAt() };
  });

  // ---------- Activity feed ----------

  app.get("/api/activity", async (): Promise<ActivityEvent[]> => listActivity());

  // Job polling is shared with the rest of the app
  void getJob;
}
