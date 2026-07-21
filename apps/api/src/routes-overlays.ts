import type { FastifyInstance } from "fastify";
import {
  applyOverlaySchema,
  overlayPresetInputSchema,
  type OverlayPreset,
  type OverlayStatus,
} from "@metamagic/shared";
import { requirePlex } from "./client-store.js";
import {
  countOriginalArtwork,
  createOverlayPreset,
  deleteOverlayPreset,
  getOverlayPreset,
  listOriginalArtwork,
  listOverlayPresets,
  updateOverlayPreset,
} from "./db.js";
import { applyOverlays, compositePoster, loadOriginalPoster, restoreAll } from "./overlays.js";
import { startJob } from "./jobs.js";

export function registerOverlayRoutes(app: FastifyInstance): void {
  // ---------- Presets ----------

  app.get("/api/overlays/presets", async (): Promise<OverlayPreset[]> => listOverlayPresets());

  app.post("/api/overlays/presets", async (req): Promise<OverlayPreset> => {
    const input = overlayPresetInputSchema.parse(req.body);
    return createOverlayPreset(input);
  });

  app.put<{ Params: { id: string } }>("/api/overlays/presets/:id", async (req, reply) => {
    const input = overlayPresetInputSchema.parse(req.body);
    const preset = updateOverlayPreset(Number(req.params.id), input);
    if (!preset) return reply.status(404).send({ error: "Preset not found" });
    return preset;
  });

  app.delete<{ Params: { id: string } }>("/api/overlays/presets/:id", async (req) => {
    deleteOverlayPreset(Number(req.params.id));
    return { ok: true };
  });

  // ---------- Live preview ----------

  /**
   * Renders a preset onto a real item's original poster and streams the JPEG
   * back. Nothing is uploaded to Plex.
   */
  app.post<{ Querystring: { ratingKey?: string } }>(
    "/api/overlays/preview",
    async (req, reply) => {
      const body = req.body as { name?: string; badges?: unknown };
      const input = overlayPresetInputSchema.parse({
        name: body?.name ?? "Preview",
        badges: body?.badges,
      });
      const ratingKey = req.query.ratingKey;
      if (!ratingKey) return reply.status(400).send({ error: "ratingKey is required" });

      const client = requirePlex();
      const item = await client.item(ratingKey);
      const { buffer } = await loadOriginalPoster(client, item, false);
      const composed = await compositePoster(buffer, { id: 0, ...input }, item);

      reply.header("Content-Type", "image/jpeg");
      reply.header("Cache-Control", "no-store");
      return reply.send(composed);
    },
  );

  /** A sensible item to preview against — first item of a section. */
  app.get<{ Querystring: { sectionId?: string } }>("/api/overlays/sample", async (req, reply) => {
    const client = requirePlex();
    const sectionId = req.query.sectionId ?? (await client.sections())[0]?.id;
    if (!sectionId) return reply.status(404).send({ error: "No libraries found" });
    const page = await client.sectionItems(sectionId, { offset: 0, limit: 1, sort: "addedAt:desc" });
    const item = page.items[0];
    if (!item) return reply.status(404).send({ error: "That library is empty" });
    return client.item(item.ratingKey);
  });

  // ---------- Apply & restore ----------

  app.post("/api/overlays/apply", async (req, reply) => {
    const input = applyOverlaySchema.parse(req.body);
    const preset = getOverlayPreset(input.presetId);
    if (!preset) return reply.status(404).send({ error: "Preset not found" });
    const client = requirePlex();
    const job = startJob<{ ratingKey: string; title: string }>("overlay-apply", async (report) => {
      await applyOverlays(client, preset, input.sectionId, input.ratingKeys, report);
    });
    return { jobId: job.id };
  });

  app.get("/api/overlays/status", async (): Promise<OverlayStatus> => ({
    overlaidCount: countOriginalArtwork(),
  }));

  app.post("/api/overlays/restore", async () => {
    const client = requirePlex();
    const keys = listOriginalArtwork().map((o) => o.ratingKey);
    const job = startJob<{ ratingKey: string }>("overlay-restore", async (report) => {
      report.log(`• restoring ${keys.length} original poster(s)`);
      await restoreAll(client, keys, report);
    });
    return { jobId: job.id };
  });

  app.post<{ Params: { ratingKey: string } }>(
    "/api/overlays/restore/:ratingKey",
    async (req) => {
      const client = requirePlex();
      const job = startJob<{ ratingKey: string }>("overlay-restore", async (report) => {
        await restoreAll(client, [req.params.ratingKey], report);
      });
      return { jobId: job.id };
    },
  );
}
