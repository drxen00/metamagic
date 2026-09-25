import type { FastifyInstance } from "fastify";
import {
  automationSettingsSchema,
  autoAddExistingSchema,
  discordSettingsInputSchema,
  franchiseAutoCreateSchema,
  studioAutomationSchema,
  mediuxSyncSettingsSchema,
  mediuxWatchUpdateSchema,
  ruleInputSchema,
  type ActivityEvent,
  type AutomationPresets,
  type AutomationSettings,
  type CompanyOption,
  type DiscordEvents,
  type DiscordSettings,
  type DiscoveredCollection,
  type MediuxMatch,
  type MediuxSyncState,
  type MediuxWatch,
  type Rule,
  type RuleChange,
  type RuleEvaluation,
  type RuleRun,
  type UntrackedCollection,
} from "@metamagic/shared";
import { plexClient, requirePlex } from "./client-store.js";
import { getLibraryIndexCached } from "./mediux.js";
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
  getStudioAutomation,
  runAutoAddExisting,
  runFranchiseAutoCreate,
  runStudioAutomation,
  setAutoAddExisting,
  setFranchiseAutoCreate,
  setStudioAutomation,
} from "./automations.js";
import { discoverCollections } from "./discover.js";
import { companyMovieStats, searchCompanies, searchKeywords } from "./tmdb.js";
import { startJob, getJob } from "./jobs.js";
import { getDiscordEvents, notifyMediuxSweep, sendTestNotification, type MediuxSweepChange } from "./notify.js";
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

  // ---------- Discord notifications ----------

  const discordState = (): DiscordSettings => ({
    configured: !!getAppSetting("discord_webhook_url"),
    events: getDiscordEvents(),
  });

  app.get("/api/settings/discord", async (): Promise<DiscordSettings> => discordState());

  app.put("/api/settings/discord", async (req): Promise<DiscordSettings> => {
    const input = discordSettingsInputSchema.parse(req.body);
    if (input.webhookUrl !== undefined) {
      setAppSetting("discord_webhook_url", input.webhookUrl.trim());
    }
    if (input.events) {
      const merged: DiscordEvents = { ...getDiscordEvents(), ...input.events };
      setAppSetting("discord_events", JSON.stringify(merged));
    }
    return discordState();
  });

  app.post("/api/settings/discord/test", async (_req, reply) => {
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

  // Collections that exist in Plex but aren't tracked by auto-sync yet (no MediUX
  // set applied) — surfaced so the user can apply a set and start syncing them.
  app.get("/api/mediux/untracked", async (): Promise<UntrackedCollection[]> => {
    const client = requirePlex();
    const tracked = new Set(listMediuxWatches().map((w) => w.ratingKey));
    const collections = await client.collections();
    return collections
      .filter((c) => !tracked.has(c.ratingKey))
      .map((c) => ({
        ratingKey: c.ratingKey,
        title: c.title,
        thumb: c.thumb,
        sectionTitle: c.sectionTitle,
        childCount: c.childCount,
      }));
  });

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
          const outcome = await syncWatch(client, watch, { force: true, report });
          const after = await computeSignature(client, watch).catch(() => watch.lastSignature);
          recordMediuxWatchSync(watch.ratingKey, after, outcome.result);
          recordActivity({
            kind: "mediux-sync",
            title: watch.title,
            detail: outcome.result,
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
      const changes: MediuxSweepChange[] = [];
      for (const w of watches) {
        report.setCurrent(`Syncing ${w.title}…`);
        try {
          const outcome = await syncWatch(client, w, { force: true, report });
          const after = await computeSignature(client, w).catch(() => w.lastSignature);
          recordMediuxWatchSync(w.ratingKey, after, outcome.result);
          recordActivity(
            {
              kind: "mediux-sync",
              title: w.title,
              detail: outcome.result,
              status: "ok",
              trigger: "manual (sync all)",
            },
            { notify: false },
          );
          changes.push({ title: w.title, detail: outcome.result, status: "ok" });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "sync failed";
          recordMediuxWatchSync(w.ratingKey, w.lastSignature, `Error: ${msg}`);
          recordActivity(
            {
              kind: "mediux-sync",
              title: w.title,
              detail: msg,
              status: "error",
              trigger: "manual (sync all)",
            },
            { notify: false },
          );
          changes.push({ title: w.title, detail: msg, status: "error" });
          report.log(`✗ ${w.title} — ${msg}`);
        }
      }
      await notifyMediuxSweep(changes, "manual (sync all)");
    });
    return { jobId: job.id };
  });

  // ---------- Preset automations ----------

  const presets = (): AutomationPresets => ({
    franchise: getFranchiseAutoCreate(),
    autoAdd: getAutoAddExisting(),
    studio: getStudioAutomation(),
    lastRunAt: automationsLastRunAt(),
  });

  app.get("/api/automations/presets", async (): Promise<AutomationPresets> => presets());

  app.put("/api/automations/franchise", async (req): Promise<AutomationPresets> => {
    setFranchiseAutoCreate(franchiseAutoCreateSchema.parse(req.body));
    return presets();
  });

  app.put("/api/automations/auto-add", async (req): Promise<AutomationPresets> => {
    setAutoAddExisting(autoAddExistingSchema.parse(req.body));
    return presets();
  });

  app.put("/api/automations/studio", async (req): Promise<AutomationPresets> => {
    setStudioAutomation(studioAutomationSchema.parse(req.body));
    return presets();
  });

  // Studio (production company) search for the studio-automation picker.
  // Enriches candidates with a logo, origin country, how many of their films you
  // already own, and TMDb's total — so it's obvious which "A24" is the real one.
  app.get<{ Querystring: { q?: string } }>(
    "/api/tmdb/companies",
    async (req): Promise<CompanyOption[]> => {
      const q = req.query.q?.trim();
      if (!q) return [];
      const companies = await searchCompanies(q);
      const client = plexClient();
      if (!client) return companies;

      let index: Map<string, { type: string }>;
      try {
        index = await getLibraryIndexCached(client);
      } catch {
        return companies; // Plex hiccup — still return the basics.
      }

      // Enrich the most-relevant candidates in parallel; leave the rest as-is.
      const enriched = await Promise.all(
        companies.slice(0, 8).map(async (c): Promise<CompanyOption> => {
          try {
            const { ids, total } = await companyMovieStats(c.id);
            const ownedCount = ids.reduce(
              (n, id) => n + (index.get(`tmdb:${id}`)?.type === "movie" ? 1 : 0),
              0,
            );
            return { ...c, ownedCount, movieCount: total };
          } catch {
            return c;
          }
        }),
      );

      // Surface what you own most of first, then the biggest catalogs.
      enriched.sort(
        (a, b) =>
          (b.ownedCount ?? 0) - (a.ownedCount ?? 0) || (b.movieCount ?? 0) - (a.movieCount ?? 0),
      );
      return enriched;
    },
  );

  // Run a preset automation right now (bypasses the daily gate + enabled toggle).
  app.post("/api/automations/franchise/run", async () => {
    const client = requirePlex();
    const job = startJob("franchise-run", (report) =>
      runFranchiseAutoCreate(client, app.log, { report, manual: true }),
    );
    return { jobId: job.id };
  });

  app.post("/api/automations/auto-add/run", async () => {
    const client = requirePlex();
    const job = startJob("auto-add-run", (report) =>
      runAutoAddExisting(client, app.log, { report, manual: true }),
    );
    return { jobId: job.id };
  });

  app.post("/api/automations/studio/run", async () => {
    const client = requirePlex();
    const job = startJob("studio-run", (report) =>
      runStudioAutomation(client, app.log, { report, manual: true }),
    );
    return { jobId: job.id };
  });

  // ---------- Activity feed ----------

  app.get("/api/activity", async (): Promise<ActivityEvent[]> => listActivity());

  // Job polling is shared with the rest of the app
  void getJob;
}
