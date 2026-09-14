import type { FastifyInstance } from "fastify";
import {
  arrAutoRequestSchema,
  arrConfigInputSchema,
  arrRequestSchema,
  arrTestSchema,
  type ArrSettings,
} from "@metamagic/shared";
import {
  ArrError,
  arrQualityProfiles,
  arrRootFolders,
  arrTest,
  getArrAutoRequest,
  getArrConfig,
  getArrPublic,
  radarrQueueTmdbIds,
  radarrRequest,
  setArrAutoRequest,
  setArrConfig,
  sonarrRequest,
  type ArrConfig,
  type ArrKind,
} from "./arr.js";
import { recordActivity } from "./activity.js";

const settings = (): ArrSettings => ({
  radarr: getArrPublic("radarr"),
  sonarr: getArrPublic("sonarr"),
  autoRequest: getArrAutoRequest(),
});

export function registerArrRoutes(app: FastifyInstance): void {
  app.get("/api/settings/arr", async (): Promise<ArrSettings> => settings());

  app.put("/api/settings/arr", async (req): Promise<ArrSettings> => {
    const input = arrConfigInputSchema.parse(req.body);
    setArrConfig(input.kind, {
      url: input.url,
      apiKey: input.apiKey,
      rootFolder: input.rootFolder,
      qualityProfileId: input.qualityProfileId,
    });
    return settings();
  });

  app.put("/api/settings/arr/auto-request", async (req): Promise<ArrSettings> => {
    const input = arrAutoRequestSchema.parse(req.body);
    setArrAutoRequest(input);
    return settings();
  });

  app.post("/api/settings/arr/test", async (req, reply) => {
    const input = arrTestSchema.parse(req.body);
    // Test the just-typed creds when provided, otherwise the saved ones.
    const cfg: ArrConfig | undefined =
      input.url && input.apiKey
        ? { url: input.url.replace(/\/+$/, ""), apiKey: input.apiKey }
        : getArrConfig(input.kind);
    if (!cfg) return reply.status(428).send({ error: `Enter a ${input.kind} URL and API key first.` });
    try {
      const { version } = await arrTest(input.kind, cfg);
      return { ok: true, version };
    } catch (err) {
      const status = err instanceof ArrError ? err.status : 502;
      return reply.status(status).send({ error: err instanceof Error ? err.message : "Connection failed." });
    }
  });

  app.get<{ Querystring: { kind?: string } }>("/api/settings/arr/options", async (req, reply) => {
    const kind: ArrKind = req.query.kind === "sonarr" ? "sonarr" : "radarr";
    const cfg = getArrConfig(kind);
    if (!cfg) return reply.status(428).send({ error: `Configure ${kind} first.` });
    try {
      const [rootFolders, qualityProfiles] = await Promise.all([
        arrRootFolders(kind, cfg),
        arrQualityProfiles(kind, cfg),
      ]);
      return { rootFolders, qualityProfiles };
    } catch (err) {
      const status = err instanceof ArrError ? err.status : 502;
      return reply.status(status).send({ error: err instanceof Error ? err.message : "Failed to load options." });
    }
  });

  app.post("/api/arr/request", async (req, reply) => {
    const input = arrRequestSchema.parse(req.body);
    const cfg = getArrConfig(input.kind);
    if (!cfg) return reply.status(428).send({ error: `Configure ${input.kind} first.` });
    try {
      const result =
        input.kind === "radarr"
          ? await radarrRequest(cfg, input.id)
          : await sonarrRequest(cfg, input.id);
      recordActivity({
        kind: "download-request",
        title: `Requested “${input.title ?? input.id}”`,
        detail: `${input.kind === "radarr" ? "Radarr" : "Sonarr"} — ${result}`,
        status: "ok",
        trigger: "manual",
      });
      return { ok: true, result };
    } catch (err) {
      const status = err instanceof ArrError ? err.status : 502;
      return reply.status(status).send({ error: err instanceof Error ? err.message : "Request failed." });
    }
  });

  // Which requested movies are currently downloading (TMDb ids), for a status badge.
  app.get("/api/arr/queue", async (): Promise<{ tmdbIds: string[] }> => {
    const cfg = getArrConfig("radarr");
    if (!cfg) return { tmdbIds: [] };
    try {
      return { tmdbIds: [...(await radarrQueueTmdbIds(cfg))] };
    } catch {
      return { tmdbIds: [] };
    }
  });
}
