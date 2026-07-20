import Database from "better-sqlite3";
import path from "node:path";
import type { Rule, RuleInput, RuleRun, RuleSource, RunStatus } from "@metamagic/shared";
import { CONFIG_DIR } from "./env.js";
import { encrypt, decrypt } from "./crypto.js";

const db = new Database(path.join(CONFIG_DIR, "metamagic.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS plex_connection (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    url TEXT NOT NULL,
    token_enc TEXT NOT NULL,
    server_name TEXT,
    machine_identifier TEXT,
    server_version TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value_enc TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS collection_links (
    rating_key TEXT PRIMARY KEY,
    tmdb_collection_id INTEGER NOT NULL,
    tmdb_collection_name TEXT NOT NULL,
    linked_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS artwork_sources (
    rating_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    label TEXT NOT NULL,
    url TEXT,
    applied_at INTEGER NOT NULL,
    PRIMARY KEY (rating_key, kind)
  );

  CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    require_approval INTEGER NOT NULL DEFAULT 0,
    section_id TEXT NOT NULL,
    source_json TEXT NOT NULL,
    collection_title TEXT NOT NULL,
    collection_rating_key TEXT,
    add_matching INTEGER NOT NULL DEFAULT 1,
    remove_strays INTEGER NOT NULL DEFAULT 0,
    mediux_yaml TEXT,
    schedule TEXT NOT NULL DEFAULT 'daily',
    last_run_at INTEGER,
    last_result TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rule_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL,
    rule_name TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    trigger TEXT NOT NULL,
    added_count INTEGER NOT NULL DEFAULT 0,
    removed_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    log_json TEXT NOT NULL DEFAULT '[]',
    pending_json TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_rule_runs_started ON rule_runs(started_at DESC);

  /* Cached TMDb movie → collection lookups so repeat discovery scans are cheap */
  CREATE TABLE IF NOT EXISTS tmdb_movie_cache (
    tmdb_id TEXT PRIMARY KEY,
    collection_id INTEGER,
    collection_name TEXT,
    fetched_at INTEGER NOT NULL
  );
`);

export interface StoredConnection {
  url: string;
  token: string;
  serverName?: string;
  machineIdentifier?: string;
  serverVersion?: string;
}

export function getConnection(): StoredConnection | null {
  const row = db
    .prepare("SELECT * FROM plex_connection WHERE id = 1")
    .get() as
    | {
        url: string;
        token_enc: string;
        server_name?: string;
        machine_identifier?: string;
        server_version?: string;
      }
    | undefined;
  if (!row) return null;
  return {
    url: row.url,
    token: decrypt(row.token_enc),
    serverName: row.server_name ?? undefined,
    machineIdentifier: row.machine_identifier ?? undefined,
    serverVersion: row.server_version ?? undefined,
  };
}

export function saveConnection(conn: StoredConnection): void {
  db.prepare(
    `INSERT INTO plex_connection (id, url, token_enc, server_name, machine_identifier, server_version, updated_at)
     VALUES (1, @url, @tokenEnc, @serverName, @machineIdentifier, @serverVersion, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       url = excluded.url,
       token_enc = excluded.token_enc,
       server_name = excluded.server_name,
       machine_identifier = excluded.machine_identifier,
       server_version = excluded.server_version,
       updated_at = excluded.updated_at`,
  ).run({
    url: conn.url,
    tokenEnc: encrypt(conn.token),
    serverName: conn.serverName ?? null,
    machineIdentifier: conn.machineIdentifier ?? null,
    serverVersion: conn.serverVersion ?? null,
    updatedAt: Date.now(),
  });
}

export function deleteConnection(): void {
  db.prepare("DELETE FROM plex_connection WHERE id = 1").run();
}

// ---------- Users & sessions ----------

export interface UserRow {
  id: number;
  username: string;
  pass_hash: string;
}

export function userCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  return row.n;
}

export function getUserByName(username: string): UserRow | undefined {
  return db
    .prepare("SELECT id, username, pass_hash FROM users WHERE username = ?")
    .get(username) as UserRow | undefined;
}

export function getUserById(id: number): UserRow | undefined {
  return db
    .prepare("SELECT id, username, pass_hash FROM users WHERE id = ?")
    .get(id) as UserRow | undefined;
}

export function createUser(username: string, passHash: string): void {
  db.prepare("INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)").run(
    username,
    passHash,
    Date.now(),
  );
}

export function updateUserPassword(id: number, passHash: string): void {
  db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").run(passHash, id);
}

export function createSession(tokenHash: string, userId: number, expiresAt: number): void {
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
    tokenHash,
    userId,
    expiresAt,
  );
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
}

export function getSessionUserId(tokenHash: string): number | undefined {
  const row = db
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?")
    .get(tokenHash) as { user_id: number; expires_at: number } | undefined;
  if (!row || row.expires_at < Date.now()) return undefined;
  return row.user_id;
}

export function deleteSession(tokenHash: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

// ---------- Collection ↔ TMDb collection links ----------

export interface CollectionLinkRow {
  tmdbCollectionId: number;
  tmdbCollectionName: string;
}

export function getCollectionLink(ratingKey: string): CollectionLinkRow | undefined {
  const row = db
    .prepare(
      "SELECT tmdb_collection_id, tmdb_collection_name FROM collection_links WHERE rating_key = ?",
    )
    .get(ratingKey) as
    | { tmdb_collection_id: number; tmdb_collection_name: string }
    | undefined;
  return row
    ? { tmdbCollectionId: row.tmdb_collection_id, tmdbCollectionName: row.tmdb_collection_name }
    : undefined;
}

export function setCollectionLink(ratingKey: string, id: number, name: string): void {
  db.prepare(
    `INSERT INTO collection_links (rating_key, tmdb_collection_id, tmdb_collection_name, linked_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(rating_key) DO UPDATE SET
       tmdb_collection_id = excluded.tmdb_collection_id,
       tmdb_collection_name = excluded.tmdb_collection_name,
       linked_at = excluded.linked_at`,
  ).run(ratingKey, id, name, Date.now());
}

export function deleteCollectionLink(ratingKey: string): void {
  db.prepare("DELETE FROM collection_links WHERE rating_key = ?").run(ratingKey);
}

// ---------- Artwork provenance ----------

export interface ArtworkSourceRow {
  source: string;
  label: string;
  url?: string;
  appliedAt: number;
}

export function recordArtworkSource(
  ratingKey: string,
  kind: "poster" | "art",
  source: string,
  label: string,
  url?: string,
): void {
  db.prepare(
    `INSERT INTO artwork_sources (rating_key, kind, source, label, url, applied_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(rating_key, kind) DO UPDATE SET
       source = excluded.source,
       label = excluded.label,
       url = excluded.url,
       applied_at = excluded.applied_at`,
  ).run(ratingKey, kind, source, label, url ?? null, Date.now());
}

export function getArtworkSources(
  ratingKey: string,
): { poster?: ArtworkSourceRow; art?: ArtworkSourceRow } {
  const rows = db
    .prepare("SELECT kind, source, label, url, applied_at FROM artwork_sources WHERE rating_key = ?")
    .all(ratingKey) as { kind: string; source: string; label: string; url: string | null; applied_at: number }[];
  const result: { poster?: ArtworkSourceRow; art?: ArtworkSourceRow } = {};
  for (const row of rows) {
    const entry: ArtworkSourceRow = {
      source: row.source,
      label: row.label,
      url: row.url ?? undefined,
      appliedAt: row.applied_at,
    };
    if (row.kind === "poster") result.poster = entry;
    else if (row.kind === "art") result.art = entry;
  }
  return result;
}

// ---------- Rules ----------

interface RuleRow {
  id: number;
  name: string;
  enabled: number;
  require_approval: number;
  section_id: string;
  source_json: string;
  collection_title: string;
  collection_rating_key: string | null;
  add_matching: number;
  remove_strays: number;
  mediux_yaml: string | null;
  schedule: string;
  last_run_at: number | null;
  last_result: string | null;
}

function toRule(row: RuleRow): Rule {
  return {
    id: row.id,
    name: row.name,
    enabled: !!row.enabled,
    requireApproval: !!row.require_approval,
    sectionId: row.section_id,
    source: JSON.parse(row.source_json) as RuleSource,
    collectionTitle: row.collection_title,
    collectionRatingKey: row.collection_rating_key ?? undefined,
    addMatching: !!row.add_matching,
    removeStrays: !!row.remove_strays,
    mediuxYaml: row.mediux_yaml ?? undefined,
    schedule: row.schedule as Rule["schedule"],
    lastRunAt: row.last_run_at ?? undefined,
    lastResult: row.last_result ?? undefined,
  };
}

export function listRules(): Rule[] {
  return (db.prepare("SELECT * FROM rules ORDER BY id").all() as RuleRow[]).map(toRule);
}

export function getRule(id: number): Rule | undefined {
  const row = db.prepare("SELECT * FROM rules WHERE id = ?").get(id) as RuleRow | undefined;
  return row ? toRule(row) : undefined;
}

export function createRule(input: RuleInput): Rule {
  const info = db
    .prepare(
      `INSERT INTO rules (name, enabled, require_approval, section_id, source_json,
        collection_title, collection_rating_key, add_matching, remove_strays, mediux_yaml,
        schedule, created_at)
       VALUES (@name, @enabled, @requireApproval, @sectionId, @sourceJson, @collectionTitle,
        @collectionRatingKey, @addMatching, @removeStrays, @mediuxYaml, @schedule, @createdAt)`,
    )
    .run({
      name: input.name,
      enabled: input.enabled ? 1 : 0,
      requireApproval: input.requireApproval ? 1 : 0,
      sectionId: input.sectionId,
      sourceJson: JSON.stringify(input.source),
      collectionTitle: input.collectionTitle,
      collectionRatingKey: input.collectionRatingKey ?? null,
      addMatching: input.addMatching ? 1 : 0,
      removeStrays: input.removeStrays ? 1 : 0,
      mediuxYaml: input.mediuxYaml ?? null,
      schedule: input.schedule,
      createdAt: Date.now(),
    });
  return getRule(Number(info.lastInsertRowid))!;
}

export function updateRule(id: number, input: RuleInput): Rule | undefined {
  db.prepare(
    `UPDATE rules SET name = @name, enabled = @enabled, require_approval = @requireApproval,
       section_id = @sectionId, source_json = @sourceJson, collection_title = @collectionTitle,
       collection_rating_key = @collectionRatingKey, add_matching = @addMatching,
       remove_strays = @removeStrays, mediux_yaml = @mediuxYaml, schedule = @schedule
     WHERE id = @id`,
  ).run({
    id,
    name: input.name,
    enabled: input.enabled ? 1 : 0,
    requireApproval: input.requireApproval ? 1 : 0,
    sectionId: input.sectionId,
    sourceJson: JSON.stringify(input.source),
    collectionTitle: input.collectionTitle,
    collectionRatingKey: input.collectionRatingKey ?? null,
    addMatching: input.addMatching ? 1 : 0,
    removeStrays: input.removeStrays ? 1 : 0,
    mediuxYaml: input.mediuxYaml ?? null,
    schedule: input.schedule,
  });
  return getRule(id);
}

export function deleteRule(id: number): void {
  db.prepare("DELETE FROM rules WHERE id = ?").run(id);
  db.prepare("DELETE FROM rule_runs WHERE rule_id = ?").run(id);
}

export function setRuleCollectionKey(id: number, ratingKey: string): void {
  db.prepare("UPDATE rules SET collection_rating_key = ? WHERE id = ?").run(ratingKey, id);
}

export function recordRuleOutcome(id: number, result: string): void {
  db.prepare("UPDATE rules SET last_run_at = ?, last_result = ? WHERE id = ?").run(
    Date.now(),
    result,
    id,
  );
}

// ---------- Rule runs ----------

interface RuleRunRow {
  id: number;
  rule_id: number;
  rule_name: string;
  started_at: number;
  status: string;
  trigger: string;
  added_count: number;
  removed_count: number;
  error: string | null;
  log_json: string;
  pending_json: string | null;
}

function toRuleRun(row: RuleRunRow): RuleRun {
  return {
    id: row.id,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    startedAt: row.started_at,
    status: row.status as RunStatus,
    trigger: row.trigger as RuleRun["trigger"],
    addedCount: row.added_count,
    removedCount: row.removed_count,
    error: row.error ?? undefined,
    log: JSON.parse(row.log_json) as string[],
    pending: row.pending_json ? (JSON.parse(row.pending_json) as RuleRun["pending"]) : undefined,
  };
}

export function recordRun(run: Omit<RuleRun, "id">): RuleRun {
  const info = db
    .prepare(
      `INSERT INTO rule_runs (rule_id, rule_name, started_at, status, trigger, added_count,
        removed_count, error, log_json, pending_json)
       VALUES (@ruleId, @ruleName, @startedAt, @status, @trigger, @addedCount, @removedCount,
        @error, @logJson, @pendingJson)`,
    )
    .run({
      ruleId: run.ruleId,
      ruleName: run.ruleName,
      startedAt: run.startedAt,
      status: run.status,
      trigger: run.trigger,
      addedCount: run.addedCount,
      removedCount: run.removedCount,
      error: run.error ?? null,
      logJson: JSON.stringify(run.log),
      pendingJson: run.pending ? JSON.stringify(run.pending) : null,
    });
  return { ...run, id: Number(info.lastInsertRowid) };
}

export function listRuns(limit = 60): RuleRun[] {
  return (
    db.prepare("SELECT * FROM rule_runs ORDER BY started_at DESC LIMIT ?").all(limit) as RuleRunRow[]
  ).map(toRuleRun);
}

export function getRun(id: number): RuleRun | undefined {
  const row = db.prepare("SELECT * FROM rule_runs WHERE id = ?").get(id) as RuleRunRow | undefined;
  return row ? toRuleRun(row) : undefined;
}

export function resolveRun(id: number, status: RunStatus, addedCount = 0, removedCount = 0): void {
  db.prepare(
    "UPDATE rule_runs SET status = ?, pending_json = NULL, added_count = ?, removed_count = ? WHERE id = ?",
  ).run(status, addedCount, removedCount, id);
}

// ---------- TMDb movie → collection cache ----------

const TMDB_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function getCachedMovieCollection(
  tmdbId: string,
): { collectionId: number | null; collectionName: string | null } | undefined {
  const row = db
    .prepare("SELECT collection_id, collection_name, fetched_at FROM tmdb_movie_cache WHERE tmdb_id = ?")
    .get(tmdbId) as
    | { collection_id: number | null; collection_name: string | null; fetched_at: number }
    | undefined;
  if (!row || Date.now() - row.fetched_at > TMDB_CACHE_TTL_MS) return undefined;
  return { collectionId: row.collection_id, collectionName: row.collection_name };
}

export function cacheMovieCollection(
  tmdbId: string,
  collectionId: number | null,
  collectionName: string | null,
): void {
  db.prepare(
    `INSERT INTO tmdb_movie_cache (tmdb_id, collection_id, collection_name, fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tmdb_id) DO UPDATE SET
       collection_id = excluded.collection_id,
       collection_name = excluded.collection_name,
       fetched_at = excluded.fetched_at`,
  ).run(tmdbId, collectionId, collectionName, Date.now());
}

// ---------- Encrypted app settings (API keys etc.) ----------

export function getAppSetting(key: string): string | undefined {
  const row = db.prepare("SELECT value_enc FROM app_settings WHERE key = ?").get(key) as
    | { value_enc: string }
    | undefined;
  return row ? decrypt(row.value_enc) : undefined;
}

export function setAppSetting(key: string, value: string): void {
  if (!value) {
    db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
    return;
  }
  db.prepare(
    `INSERT INTO app_settings (key, value_enc) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value_enc = excluded.value_enc`,
  ).run(key, encrypt(value));
}
