import Fastify from "fastify";
import cookie from "@fastify/cookie";
import {
  collectionItemsSchema,
  createCollectionSchema,
  libraryQuerySchema,
  plexConnectionInputSchema,
} from "@metamagic/shared";
import type { ConnectionStatus, DashboardData } from "@metamagic/shared";
import { HOST, PORT } from "./env.js";
import { deleteConnection, getConnection, saveConnection } from "./db.js";
import { PlexClient, PlexError } from "./plex.js";
import { plexClient, requirePlex } from "./client-store.js";
import { registerAuth } from "./auth.js";
import { registerEditingRoutes } from "./routes-editing.js";
import { registerRuleRoutes } from "./routes-rules.js";
import { startScheduler } from "./scheduler.js";
import { TmdbError } from "./tmdb.js";
import { MediuxError } from "./mediux.js";

const app = Fastify({ logger: { level: "info" }, bodyLimit: 20 * 1024 * 1024 });

await app.register(cookie);

// Raw image bodies for poster uploads
app.addContentTypeParser(/^image\//, { parseAs: "buffer" }, (_req, body, done) => {
  done(null, body);
});

app.setErrorHandler((err: unknown, _req, reply) => {
  if (err instanceof PlexError || err instanceof TmdbError) {
    return reply.status(err.status && err.status >= 400 ? err.status : 502).send({
      error: err.message,
    });
  }
  const e = err as {
    validation?: unknown;
    name?: string;
    message?: string;
    issues?: { message: string; path?: (string | number)[] }[];
  };
  if (e.validation || e.name === "ZodError") {
    // Surface the first issue in plain language — raw Zod JSON is unreadable
    // in a form error, which is exactly where these land.
    const issue = e.issues?.[0];
    const field = issue?.path?.filter((p) => typeof p === "string").join(".");
    const message = issue
      ? field
        ? `${field}: ${issue.message}`
        : issue.message
      : (e.message ?? "Invalid request");
    return reply.status(400).send({ error: message });
  }
  if (err instanceof MediuxError) {
    return reply.status(400).send({ error: err.message });
  }
  app.log.error(err);
  return reply.status(500).send({ error: "Internal server error" });
});

registerAuth(app);
registerEditingRoutes(app);
registerRuleRoutes(app);

app.get("/api/health", async () => ({ status: "ok", app: "metamagic" }));

// ---------- Settings ----------

app.get("/api/settings/connection", async (): Promise<ConnectionStatus> => {
  const conn = getConnection();
  if (!conn) return { connected: false };
  return {
    connected: true,
    url: conn.url,
    server: conn.serverName
      ? {
          name: conn.serverName,
          machineIdentifier: conn.machineIdentifier ?? "",
          version: conn.serverVersion ?? "",
        }
      : undefined,
  };
});

app.post("/api/settings/connection/test", async (req) => {
  const input = plexConnectionInputSchema.parse(req.body);
  const client = new PlexClient(input.url, input.token);
  const server = await client.identity();
  const sections = await client.sections();
  return { server, sections };
});

app.put("/api/settings/connection", async (req) => {
  const input = plexConnectionInputSchema.parse(req.body);
  const client = new PlexClient(input.url, input.token);
  const server = await client.identity();
  saveConnection({
    url: input.url,
    token: input.token,
    serverName: server.name,
    machineIdentifier: server.machineIdentifier,
    serverVersion: server.version,
  });
  return { connected: true, url: input.url, server } satisfies ConnectionStatus;
});

app.delete("/api/settings/connection", async () => {
  deleteConnection();
  return { connected: false } satisfies ConnectionStatus;
});

// ---------- Dashboard ----------

app.get("/api/dashboard", async (): Promise<DashboardData> => {
  const client = plexClient();
  const conn = getConnection();
  if (!client || !conn) return { connected: false, sections: [], collectionCount: 0 };

  const sections = await client.sections();
  const [counts, collections] = await Promise.all([
    Promise.all(sections.map((s) => client.sectionCount(s.id).catch(() => 0))),
    client.collections().catch(() => []),
  ]);
  return {
    connected: true,
    server: conn.serverName
      ? {
          name: conn.serverName,
          machineIdentifier: conn.machineIdentifier ?? "",
          version: conn.serverVersion ?? "",
        }
      : undefined,
    sections: sections.map((s, i) => ({ ...s, count: counts[i] })),
    collectionCount: collections.length,
  };
});

// ---------- Library ----------

app.get("/api/library/sections", async () => requirePlex().sections());

app.get<{ Params: { id: string } }>("/api/library/sections/:id/items", async (req) => {
  const q = libraryQuerySchema.parse(req.query);
  return requirePlex().sectionItems(req.params.id, q);
});

app.get<{ Params: { id: string } }>("/api/library/sections/:id/genres", async (req) =>
  requirePlex().genres(req.params.id),
);

app.get<{ Params: { ratingKey: string } }>("/api/library/items/:ratingKey", async (req) =>
  requirePlex().item(req.params.ratingKey),
);

// ---------- Collections ----------

app.get<{ Querystring: { sectionId?: string } }>("/api/collections", async (req) =>
  requirePlex().collections(req.query.sectionId),
);

app.get<{ Params: { ratingKey: string } }>("/api/collections/:ratingKey/items", async (req) =>
  requirePlex().collectionChildren(req.params.ratingKey),
);

app.post("/api/collections", async (req) => {
  const input = createCollectionSchema.parse(req.body);
  const client = requirePlex();
  const sections = await client.sections();
  const section = sections.find((s) => s.id === input.sectionId);
  if (!section) throw new PlexError(`Library section ${input.sectionId} not found`, 404);
  return client.createCollection(input.sectionId, section.type, input.title, input.itemRatingKeys);
});

app.post<{ Params: { ratingKey: string } }>("/api/collections/:ratingKey/items", async (req) => {
  const input = collectionItemsSchema.parse(req.body);
  await requirePlex().addToCollection(req.params.ratingKey, input.itemRatingKeys);
  return { ok: true };
});

app.delete<{ Params: { ratingKey: string; itemRatingKey: string } }>(
  "/api/collections/:ratingKey/items/:itemRatingKey",
  async (req) => {
    await requirePlex().removeFromCollection(req.params.ratingKey, req.params.itemRatingKey);
    return { ok: true };
  },
);

app.delete<{ Params: { ratingKey: string } }>("/api/collections/:ratingKey", async (req) => {
  await requirePlex().deleteCollection(req.params.ratingKey);
  return { ok: true };
});

// ---------- Image proxy (token never reaches the browser) ----------

app.get<{ Querystring: { path?: string; w?: string; h?: string } }>(
  "/api/image",
  async (req, reply) => {
    const { path: imagePath, w, h } = req.query;
    if (!imagePath || !imagePath.startsWith("/")) {
      return reply.status(400).send({ error: "Missing or invalid image path" });
    }
    const client = requirePlex();
    const url = client.imageUrl(imagePath, Number(w ?? 300), Number(h ?? 450));
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return reply.status(res.status).send({ error: "Image fetch failed" });
    reply.header("Content-Type", res.headers.get("content-type") ?? "image/jpeg");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(Buffer.from(await res.arrayBuffer()));
  },
);

app
  .listen({ port: PORT, host: HOST })
  .then(() => {
    app.log.info(`MetaMagic API on :${PORT}`);
    startScheduler(app.log);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
