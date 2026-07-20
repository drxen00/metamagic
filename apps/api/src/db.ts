import Database from "better-sqlite3";
import path from "node:path";
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
