import type { ArtworkOption } from "@metamagic/shared";
import { getAppSetting } from "./db.js";

const TMDB_API = "https://api.themoviedb.org/3";
const IMG_PREVIEW = "https://image.tmdb.org/t/p/w342";
const IMG_FULL = "https://image.tmdb.org/t/p/original";

export class TmdbError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

function apiKey(): string {
  const key = getAppSetting("tmdb_api_key");
  if (!key) {
    throw new TmdbError("No TMDb API key configured — add one in Settings → Integrations.", 428);
  }
  return key;
}

async function tmdbFetch<T>(path: string, key = apiKey()): Promise<T> {
  const url = new URL(`${TMDB_API}${path}`);
  url.searchParams.set("api_key", key);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 401) throw new TmdbError("TMDb rejected the API key.", 401);
  if (!res.ok) throw new TmdbError(`TMDb returned ${res.status}`, 502);
  return (await res.json()) as T;
}

export async function validateTmdbKey(key: string): Promise<boolean> {
  try {
    await tmdbFetch("/configuration", key);
    return true;
  } catch (err) {
    if (err instanceof TmdbError && err.status === 401) return false;
    throw err;
  }
}

interface TmdbImages {
  posters?: { file_path: string; iso_639_1: string | null; vote_average: number }[];
  backdrops?: { file_path: string; iso_639_1: string | null; vote_average: number }[];
}

export async function tmdbArtwork(
  tmdbId: string,
  mediaType: "movie" | "tv" | "collection",
  kind: "poster" | "art",
): Promise<ArtworkOption[]> {
  const data = await tmdbFetch<TmdbImages>(
    `/${mediaType}/${tmdbId}/images?include_image_language=en,null`,
  );
  const images = (kind === "poster" ? data.posters : data.backdrops) ?? [];
  return images
    .sort((a, b) => b.vote_average - a.vote_average)
    .slice(0, 40)
    .map((img) => ({
      applyUrl: `${IMG_FULL}${img.file_path}`,
      previewUrl: `${IMG_PREVIEW}${img.file_path}`,
      provider: img.iso_639_1 ? `tmdb · ${img.iso_639_1}` : "tmdb · textless",
    }));
}

/** Season posters (TMDb has no season backdrops). */
export async function tmdbSeasonArtwork(
  tmdbShowId: string,
  seasonNumber: number,
  kind: "poster" | "art",
): Promise<ArtworkOption[]> {
  if (kind === "art") return [];
  const data = await tmdbFetch<TmdbImages>(
    `/tv/${tmdbShowId}/season/${seasonNumber}/images?include_image_language=en,null`,
  );
  return (data.posters ?? [])
    .sort((a, b) => b.vote_average - a.vote_average)
    .slice(0, 40)
    .map((img) => ({
      applyUrl: `${IMG_FULL}${img.file_path}`,
      previewUrl: `${IMG_PREVIEW}${img.file_path}`,
      provider: img.iso_639_1 ? `tmdb · ${img.iso_639_1}` : "tmdb · textless",
    }));
}

interface TmdbCollectionSearch {
  results?: { id: number; name: string }[];
}

/** Find the TMDb collection id best matching a (cleaned) collection name. */
export async function searchTmdbCollection(query: string): Promise<number | undefined> {
  const data = await tmdbFetch<TmdbCollectionSearch>(
    `/search/collection?query=${encodeURIComponent(query)}`,
  );
  return data.results?.[0]?.id;
}

export function tmdbConfigured(): boolean {
  return !!getAppSetting("tmdb_api_key");
}

export interface ResolvedTitle {
  title: string;
  year?: number;
  posterUrl?: string;
}

interface TmdbTitleResponse {
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
}

interface TmdbFindResponse {
  movie_results?: TmdbTitleResponse[];
  tv_results?: TmdbTitleResponse[];
}

function toResolved(r: TmdbTitleResponse | undefined): ResolvedTitle | undefined {
  if (!r) return undefined;
  const title = r.title ?? r.name;
  if (!title) return undefined;
  const date = r.release_date ?? r.first_air_date;
  return {
    title,
    year: date ? Number(date.slice(0, 4)) || undefined : undefined,
    posterUrl: r.poster_path ? `${IMG_PREVIEW}${r.poster_path}` : undefined,
  };
}

/**
 * Best-effort title lookup for a bare id from a MediUX YAML (TMDb id for
 * movies, TVDb id for shows). Returns undefined when nothing matches or no
 * API key is configured.
 */
export async function resolveTitleById(id: string): Promise<ResolvedTitle | undefined> {
  if (!tmdbConfigured()) return undefined;
  // TVDb id (shows) via TMDb's find endpoint first — MediUX show sets use TVDb.
  try {
    const found = await tmdbFetch<TmdbFindResponse>(`/find/${id}?external_source=tvdb_id`);
    const hit = toResolved(found.tv_results?.[0]) ?? toResolved(found.movie_results?.[0]);
    if (hit) return hit;
  } catch {
    // fall through
  }
  for (const path of [`/movie/${id}`, `/tv/${id}`]) {
    try {
      const hit = toResolved(await tmdbFetch<TmdbTitleResponse>(path));
      if (hit) return hit;
    } catch {
      // try next
    }
  }
  return undefined;
}

interface TmdbCollectionDetail {
  name?: string;
  parts?: (TmdbTitleResponse & { id: number })[];
}

export interface TmdbCollectionParts {
  id: number;
  name: string;
  parts: (ResolvedTitle & { tmdbId: string })[];
}

/** All movies belonging to a TMDb collection. */
export async function getTmdbCollectionParts(
  collectionId: number,
): Promise<TmdbCollectionParts | undefined> {
  const data = await tmdbFetch<TmdbCollectionDetail>(`/collection/${collectionId}`);
  if (!data.name) return undefined;
  const parts = (data.parts ?? [])
    .map((p) => {
      const resolved = toResolved(p);
      return resolved ? { ...resolved, tmdbId: String(p.id) } : undefined;
    })
    .filter((p): p is ResolvedTitle & { tmdbId: string } => !!p)
    // Unreleased/undated entries are usually announced-only placeholders.
    .filter((p) => p.year !== undefined);
  return { id: collectionId, name: data.name, parts };
}
