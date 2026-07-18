import { getConnection } from "./db.js";
import { PlexClient, PlexError } from "./plex.js";

let cached: { client: PlexClient; url: string; token: string } | null = null;

/** Returns a PlexClient for the stored connection, or null if not configured. */
export function plexClient(): PlexClient | null {
  const conn = getConnection();
  if (!conn) {
    cached = null;
    return null;
  }
  if (!cached || cached.url !== conn.url || cached.token !== conn.token) {
    cached = {
      client: new PlexClient(conn.url, conn.token, conn.machineIdentifier),
      url: conn.url,
      token: conn.token,
    };
  }
  return cached.client;
}

export function requirePlex(): PlexClient {
  const client = plexClient();
  if (!client) {
    throw new PlexError("Not connected to Plex. Add your server in Settings.", 428);
  }
  return client;
}
