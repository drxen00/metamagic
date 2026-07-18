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
