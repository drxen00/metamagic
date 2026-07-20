import type { FastifyInstance } from "fastify";
import {
  automationSettingsSchema,
  ruleInputSchema,
  type AutomationSettings,
  type DiscoveredCollection,
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
  getRule,
  getRun,
  listRules,
  listRuns,
  resolveRun,
  setAppSetting,
  getAppSetting,
  updateRule,
} from "./db.js";
import { applyChanges, evaluateRule, runRule } from "./rules.js";
import { discoverCollections } from "./discover.js";
import { searchKeywords } from "./tmdb.js";
import { startJob, getJob } from "./jobs.js";
import { sendTestNotification } from "./notify.js";
import { automationsPaused } from "./scheduler.js";

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
    return client.createCollection(sectionId, section.type, title, ratingKeys);
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

  // Job polling is shared with the rest of the app
  void getJob;
}
