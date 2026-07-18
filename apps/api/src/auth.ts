import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { credentialsSchema, changePasswordSchema } from "@metamagic/shared";
import type { AuthStatus } from "@metamagic/shared";
import {
  createSession,
  createUser,
  deleteSession,
  getSessionUserId,
  getUserById,
  getUserByName,
  updateUserPassword,
  userCount,
} from "./db.js";

export const SESSION_COOKIE = "metamagic_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, hashHex] = parts;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function issueSession(reply: FastifyReply, userId: number): void {
  const token = crypto.randomBytes(32).toString("hex");
  createSession(hashToken(token), userId, Date.now() + SESSION_TTL_MS);
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function sessionUserId(req: FastifyRequest): number | undefined {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return undefined;
  return getSessionUserId(hashToken(token));
}

/** Paths reachable without a session. */
const PUBLIC_PATHS = ["/api/health", "/api/auth/"];

export function registerAuth(app: FastifyInstance): void {
  app.addHook("onRequest", async (req, reply) => {
    const url = req.url.split("?")[0];
    if (PUBLIC_PATHS.some((p) => (p.endsWith("/") ? url.startsWith(p) : url === p))) return;
    if (sessionUserId(req) === undefined) {
      return reply.status(401).send({ error: "Not authenticated" });
    }
  });

  app.get("/api/auth/status", async (req): Promise<AuthStatus> => {
    const setupRequired = userCount() === 0;
    const userId = sessionUserId(req);
    const user = userId !== undefined ? getUserById(userId) : undefined;
    return {
      setupRequired,
      authenticated: !!user,
      username: user?.username,
    };
  });

  app.post("/api/auth/setup", async (req, reply) => {
    if (userCount() > 0) {
      return reply.status(403).send({ error: "Setup has already been completed." });
    }
    const input = credentialsSchema.parse(req.body);
    createUser(input.username, hashPassword(input.password));
    const user = getUserByName(input.username)!;
    issueSession(reply, user.id);
    return { ok: true };
  });

  app.post("/api/auth/login", async (req, reply) => {
    const input = credentialsSchema.parse(req.body);
    const user = getUserByName(input.username);
    if (!user || !verifyPassword(input.password, user.pass_hash)) {
      return reply.status(401).send({ error: "Wrong username or password." });
    }
    issueSession(reply, user.id);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) deleteSession(hashToken(token));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.post("/api/auth/password", async (req, reply) => {
    const userId = sessionUserId(req);
    if (userId === undefined) return reply.status(401).send({ error: "Not authenticated" });
    const input = changePasswordSchema.parse(req.body);
    const user = getUserById(userId)!;
    if (!verifyPassword(input.currentPassword, user.pass_hash)) {
      return reply.status(403).send({ error: "Current password is incorrect." });
    }
    updateUserPassword(userId, hashPassword(input.newPassword));
    return { ok: true };
  });
}
