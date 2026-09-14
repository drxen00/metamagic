import { getAppSetting, setAppSetting } from "./db.js";

export type ArrKind = "radarr" | "sonarr";

export class ArrError extends Error {
  status = 502;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export interface ArrConfig {
  url: string;
  apiKey: string;
  rootFolder?: string;
  qualityProfileId?: number;
}

function keys(kind: ArrKind) {
  return {
    url: `${kind}_url`,
    key: `${kind}_key`,
    root: `${kind}_root`,
    profile: `${kind}_profile`,
  };
}

export function getArrConfig(kind: ArrKind): ArrConfig | undefined {
  const k = keys(kind);
  const url = getAppSetting(k.url);
  const apiKey = getAppSetting(k.key);
  if (!url || !apiKey) return undefined;
  const profile = getAppSetting(k.profile);
  return {
    url: url.replace(/\/+$/, ""),
    apiKey,
    rootFolder: getAppSetting(k.root) || undefined,
    qualityProfileId: profile ? Number(profile) : undefined,
  };
}

/** Public, key-free view of an integration's config. */
export function getArrPublic(kind: ArrKind): {
  configured: boolean;
  url?: string;
  rootFolder?: string;
  qualityProfileId?: number;
} {
  const k = keys(kind);
  const url = getAppSetting(k.url) || undefined;
  const profile = getAppSetting(k.profile);
  return {
    configured: !!(getAppSetting(k.url) && getAppSetting(k.key)),
    url,
    rootFolder: getAppSetting(k.root) || undefined,
    qualityProfileId: profile ? Number(profile) : undefined,
  };
}

export function setArrConfig(
  kind: ArrKind,
  patch: { url?: string; apiKey?: string; rootFolder?: string; qualityProfileId?: number },
): void {
  const k = keys(kind);
  if (patch.url !== undefined) setAppSetting(k.url, patch.url.trim().replace(/\/+$/, ""));
  if (patch.apiKey !== undefined) setAppSetting(k.key, patch.apiKey.trim());
  if (patch.rootFolder !== undefined) setAppSetting(k.root, patch.rootFolder);
  if (patch.qualityProfileId !== undefined) setAppSetting(k.profile, String(patch.qualityProfileId));
}

/** Auto-request missing collection movies from Radarr — gated by an ack. */
export function getArrAutoRequest(): { enabled: boolean; acknowledged: boolean } {
  return {
    enabled: getAppSetting("arr_auto_request") === "true",
    acknowledged: getAppSetting("arr_auto_request_ack") === "true",
  };
}

export function setArrAutoRequest(patch: { enabled?: boolean; acknowledged?: boolean }): void {
  if (patch.acknowledged !== undefined) {
    setAppSetting("arr_auto_request_ack", patch.acknowledged ? "true" : "");
  }
  if (patch.enabled !== undefined) {
    // Can only enable once acknowledged.
    const ack = getAppSetting("arr_auto_request_ack") === "true";
    setAppSetting("arr_auto_request", patch.enabled && ack ? "true" : "");
  }
}

async function arrFetch<T>(
  cfg: ArrConfig,
  kind: ArrKind,
  path: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${cfg.url}/api/v3${path}`, {
      ...init,
      headers: { "X-Api-Key": cfg.apiKey, "Content-Type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ArrError(`Could not reach ${kind} at ${cfg.url}.`);
  }
  if (res.status === 401) throw new ArrError(`${kind} rejected the API key.`, 401);
  if (!res.ok) throw new ArrError(`${kind} returned ${res.status}.`, 502);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Verify a URL + key by hitting system/status. */
export async function arrTest(kind: ArrKind, cfg: ArrConfig): Promise<{ version: string }> {
  const status = await arrFetch<{ version?: string }>(cfg, kind, "/system/status");
  return { version: status.version ?? "unknown" };
}

export interface RootFolderOption {
  path: string;
  freeSpace?: number;
}
export interface QualityProfileOption {
  id: number;
  name: string;
}

export async function arrRootFolders(kind: ArrKind, cfg: ArrConfig): Promise<RootFolderOption[]> {
  const rows = await arrFetch<{ path: string; freeSpace?: number }[]>(cfg, kind, "/rootfolder");
  return rows.map((r) => ({ path: r.path, freeSpace: r.freeSpace }));
}

export async function arrQualityProfiles(
  kind: ArrKind,
  cfg: ArrConfig,
): Promise<QualityProfileOption[]> {
  const rows = await arrFetch<{ id: number; name: string }[]>(cfg, kind, "/qualityprofile");
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

function ensureAddReady(cfg: ArrConfig, kind: ArrKind): asserts cfg is Required<ArrConfig> {
  if (!cfg.rootFolder || !cfg.qualityProfileId) {
    throw new ArrError(
      `Pick a root folder and quality profile for ${kind} in Settings first.`,
      428,
    );
  }
}

/** Add a movie to Radarr (by TMDb id) and trigger a search. Idempotent-ish:
 *  if it already exists, just search it. */
export async function radarrRequest(cfg: ArrConfig, tmdbId: string): Promise<"added" | "searching"> {
  ensureAddReady(cfg, "radarr");
  const lookup = await arrFetch<Record<string, unknown>[]>(
    cfg,
    "radarr",
    `/movie/lookup?term=tmdb:${encodeURIComponent(tmdbId)}`,
  );
  const movie = lookup[0];
  if (!movie) throw new ArrError(`Radarr couldn't find TMDb id ${tmdbId}.`, 404);

  if (typeof movie.id === "number" && movie.id > 0) {
    // Already in Radarr — just search for it.
    await arrFetch(cfg, "radarr", "/command", {
      method: "POST",
      body: JSON.stringify({ name: "MoviesSearch", movieIds: [movie.id] }),
    });
    return "searching";
  }

  await arrFetch(cfg, "radarr", "/movie", {
    method: "POST",
    body: JSON.stringify({
      ...movie,
      qualityProfileId: cfg.qualityProfileId,
      rootFolderPath: cfg.rootFolder,
      monitored: true,
      minimumAvailability: "released",
      addOptions: { searchForMovie: true },
    }),
  });
  return "added";
}

/** Add a series to Sonarr (by TVDb id) and search for missing episodes. */
export async function sonarrRequest(cfg: ArrConfig, tvdbId: string): Promise<"added" | "searching"> {
  ensureAddReady(cfg, "sonarr");
  const lookup = await arrFetch<Record<string, unknown>[]>(
    cfg,
    "sonarr",
    `/series/lookup?term=tvdb:${encodeURIComponent(tvdbId)}`,
  );
  const series = lookup[0];
  if (!series) throw new ArrError(`Sonarr couldn't find TVDb id ${tvdbId}.`, 404);

  if (typeof series.id === "number" && series.id > 0) {
    await arrFetch(cfg, "sonarr", "/command", {
      method: "POST",
      body: JSON.stringify({ name: "SeriesSearch", seriesId: series.id }),
    });
    return "searching";
  }

  await arrFetch(cfg, "sonarr", "/series", {
    method: "POST",
    body: JSON.stringify({
      ...series,
      qualityProfileId: cfg.qualityProfileId,
      rootFolderPath: cfg.rootFolder,
      monitored: true,
      addOptions: { searchForMissingEpisodes: true },
    }),
  });
  return "added";
}

/** TMDb ids of movies currently in the Radarr download queue. */
export async function radarrQueueTmdbIds(cfg: ArrConfig): Promise<Set<string>> {
  const data = await arrFetch<{ records?: { movie?: { tmdbId?: number } }[] }>(
    cfg,
    "radarr",
    "/queue?pageSize=200&includeMovie=true",
  );
  const ids = new Set<string>();
  for (const r of data.records ?? []) {
    if (r.movie?.tmdbId) ids.add(String(r.movie.tmdbId));
  }
  return ids;
}
