import type { ActorSuggestion, ActorSuggestions } from "@metamagic/shared";
import type { PlexClient } from "./plex.js";
import { getAppSetting, setAppSetting } from "./db.js";
import { getActorAutomation } from "./automations.js";
import { movieTopCast, tmdbConfigured, tmdbThumbUrl, TmdbError } from "./tmdb.js";
import type { ProgressReporter } from "./mediux.js";

/**
 * Actor-collection suggestions: walk the movie libraries, look up each film's
 * top-billed cast on TMDb (cached 30 days), and rank the actors who lead the
 * most films you own. The last scan is stored so the suggestions survive a page
 * reload; whether each actor is already in the automation is filled in live.
 */

const SETTING_KEY = "actor_suggestions";
/** Billing positions that count as a lead — matches the automation's default. */
const LEAD_BILLING = 3;
/** Fewer than this many lead roles isn't worth suggesting. */
const MIN_SUGGEST = 2;
const MAX_SUGGESTIONS = 150;
const CONCURRENCY = 6;

function normTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The stored suggestions, with `configured` reflecting the current automation. */
export function getActorSuggestions(): ActorSuggestions {
  let stored: ActorSuggestions = { suggestions: [] };
  const raw = getAppSetting(SETTING_KEY);
  if (raw) {
    try {
      stored = JSON.parse(raw) as ActorSuggestions;
    } catch {
      // corrupt — treat as never scanned
    }
  }
  const configured = new Set(getActorAutomation().actors.map((a) => a.personId));
  return {
    scannedAt: stored.scannedAt,
    suggestions: stored.suggestions.map((s) => ({ ...s, configured: configured.has(s.personId) })),
  };
}

export async function scanActorSuggestions(
  client: PlexClient,
  report?: ProgressReporter<ActorSuggestion>,
): Promise<ActorSuggestions> {
  if (!tmdbConfigured()) {
    throw new TmdbError("Add a TMDb API key in Settings → Integrations to scan for actors.", 428);
  }

  // Every owned movie once, even if it's in more than one library (e.g. a 4K copy).
  type Film = ActorSuggestion["films"][number];
  const movies = new Map<string, Film>();
  for (const section of (await client.sections()).filter((s) => s.type === "movie")) {
    report?.setCurrent(`Reading ${section.title}…`);
    let offset = 0;
    const limit = 200;
    for (;;) {
      const page = await client.sectionItems(section.id, { offset, limit, excludeCollections: true });
      for (const item of page.items) {
        if (item.type !== "movie" || !item.tmdbId || movies.has(item.tmdbId)) continue;
        movies.set(item.tmdbId, {
          ratingKey: item.ratingKey,
          title: item.title,
          year: item.year,
          thumb: item.thumb,
        });
      }
      offset += limit;
      if (offset >= page.totalSize || page.items.length === 0) break;
    }
  }
  report?.log(`• checking the cast of ${movies.size} movies`);

  const tally = new Map<number, { name: string; profilePath?: string; films: Film[] }>();
  const entries = [...movies];
  let failures = 0;
  let lastError: unknown;
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    const casts = await Promise.all(
      batch.map(([tmdbId]) =>
        movieTopCast(tmdbId).catch((err) => {
          failures++;
          lastError = err;
          return [];
        }),
      ),
    );
    batch.forEach(([, film], j) => {
      for (const c of casts[j]) {
        if (c.order >= LEAD_BILLING) continue;
        const entry = tally.get(c.personId) ?? { name: c.name, profilePath: c.profilePath, films: [] };
        entry.films.push(film);
        tally.set(c.personId, entry);
      }
    });
    report?.setCurrent(`Checked ${Math.min(i + CONCURRENCY, entries.length)} of ${entries.length} movies…`);
  }
  // Every lookup failed (bad key, TMDb down) — say so instead of "no suggestions".
  if (entries.length > 0 && failures === entries.length) {
    throw lastError instanceof Error ? lastError : new TmdbError("TMDb lookups failed.", 502);
  }

  // A same-named collection exists but isn't auto-synced — still worth suggesting.
  const existingTitle = new Map((await client.collections()).map((c) => [normTitle(c.title), c.title]));

  const suggestions: ActorSuggestion[] = [...tally]
    .filter(([, t]) => t.films.length >= MIN_SUGGEST)
    .map(([personId, t]) => ({
      personId,
      name: t.name,
      profilePath: t.profilePath,
      profileUrl: t.profilePath ? tmdbThumbUrl(t.profilePath) : undefined,
      leadCount: t.films.length,
      films: [...t.films].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)),
      existingCollection: existingTitle.get(normTitle(t.name)),
    }))
    .sort((a, b) => b.leadCount - a.leadCount || a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS);

  const result: ActorSuggestions = { scannedAt: Date.now(), suggestions };
  setAppSetting(SETTING_KEY, JSON.stringify(result));
  report?.log(
    `• found ${suggestions.length} actor(s) with ${MIN_SUGGEST}+ lead roles` +
      (failures ? ` (${failures} movie(s) couldn't be checked)` : ""),
  );
  return getActorSuggestions();
}
