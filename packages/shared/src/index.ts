import { z } from "zod";

// ---------- Plex connection ----------

export const plexConnectionInputSchema = z.object({
  url: z
    .string()
    .url("Must be a valid URL, e.g. http://192.168.1.10:32400")
    .transform((u) => u.replace(/\/+$/, "")),
  token: z.string().min(1, "Token is required"),
});
export type PlexConnectionInput = z.infer<typeof plexConnectionInputSchema>;

export interface PlexServerInfo {
  name: string;
  machineIdentifier: string;
  version: string;
}

export interface ConnectionStatus {
  connected: boolean;
  url?: string;
  server?: PlexServerInfo;
}

// ---------- Library ----------

export type LibraryType = "movie" | "show" | "artist" | "photo";

export interface LibrarySection {
  id: string;
  title: string;
  type: LibraryType;
  count?: number;
}

export interface MediaItem {
  ratingKey: string;
  title: string;
  type: string;
  year?: number;
  thumb?: string;
  art?: string;
  summary?: string;
  rating?: number;
  audienceRating?: number;
  contentRating?: string;
  duration?: number;
  addedAt?: number;
  viewCount?: number;
  /** Season or episode number for children of a show/season */
  index?: number;
  parentRatingKey?: string;
  videoResolution?: string;
  audioCodec?: string;
  audioChannels?: number;
  /** Only populated by the per-item metadata call, not section listings */
  hdr?: "dv" | "hdr";
  genres?: string[];
  collections?: { tag: string; id?: string }[];
  labels?: string[];
  titleSort?: string;
  librarySectionId?: string;
  tmdbId?: string;
  tvdbId?: string;
}

export interface PagedResult<T> {
  items: T[];
  totalSize: number;
  offset: number;
}

export interface FilterOption {
  id: string;
  title: string;
}

export const libraryQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  search: z.string().optional(),
  sort: z.string().optional(),
  genre: z.string().optional(),
  year: z.coerce.number().int().optional(),
  unwatched: z.coerce.boolean().optional(),
});
export type LibraryQuery = z.infer<typeof libraryQuerySchema>;

// ---------- Collections ----------

export interface PlexCollection {
  ratingKey: string;
  title: string;
  summary?: string;
  thumb?: string;
  childCount: number;
  sectionId?: string;
  sectionTitle?: string;
}

export const createCollectionSchema = z.object({
  sectionId: z.string().min(1),
  title: z.string().min(1, "Collection name is required"),
  itemRatingKeys: z.array(z.string()).min(1, "Select at least one item"),
});
export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;

export const collectionItemsSchema = z.object({
  itemRatingKeys: z.array(z.string()).min(1),
});
export type CollectionItemsInput = z.infer<typeof collectionItemsSchema>;

// ---------- Dashboard ----------

export interface DashboardData {
  connected: boolean;
  server?: PlexServerInfo;
  sections: LibrarySection[];
  collectionCount: number;
}

// ---------- Auth ----------

export const credentialsSchema = z.object({
  username: z.string().min(1, "Username is required").max(64),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
export type CredentialsInput = z.infer<typeof credentialsSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export interface AuthStatus {
  setupRequired: boolean;
  authenticated: boolean;
  username?: string;
}

// ---------- Metadata editing ----------

export const editItemSchema = z.object({
  title: z.string().min(1).optional(),
  titleSort: z.string().optional(),
  summary: z.string().optional(),
  addLabels: z.array(z.string().min(1)).optional(),
  removeLabels: z.array(z.string().min(1)).optional(),
  addGenres: z.array(z.string().min(1)).optional(),
  removeGenres: z.array(z.string().min(1)).optional(),
});
export type EditItemInput = z.infer<typeof editItemSchema>;

// ---------- Artwork ----------

export type ArtworkKind = "poster" | "art";

export interface ArtworkOption {
  /** Value to POST back to apply this artwork (plex poster ratingKey or remote URL) */
  applyUrl: string;
  /** Browser-loadable preview URL */
  previewUrl: string;
  provider: string;
  selected?: boolean;
}

export const applyArtworkSchema = z.object({
  kind: z.enum(["poster", "art"]),
  url: z.string().min(1),
  /** Optional page URL recorded as the artwork's provenance */
  sourceUrl: z.string().url().optional(),
});
export type ApplyArtworkInput = z.infer<typeof applyArtworkSchema>;

// ---------- Collections editing ----------

export const editCollectionSchema = z.object({
  title: z.string().min(1).optional(),
  summary: z.string().optional(),
});
export type EditCollectionInput = z.infer<typeof editCollectionSchema>;

// ---------- Integrations ----------

export interface IntegrationsStatus {
  tmdbConfigured: boolean;
  mediuxTokenConfigured: boolean;
}

export const integrationsSchema = z.object({
  tmdbApiKey: z.string().optional(),
  mediuxToken: z.string().optional(),
});
export type IntegrationsInput = z.infer<typeof integrationsSchema>;

// ---------- MediUX import ----------

export const mediuxImportSchema = z.object({
  yaml: z.string().min(1, "Paste the YAML from a MediUX set page"),
  /**
   * When the YAML is applied from a collection's or show's poster picker, the
   * target it's scoped to. Lets MetaMagic remember the set for auto-sync so new
   * franchise movies / seasons get re-styled automatically.
   */
  scopeRatingKey: z.string().optional(),
  scopeType: z.enum(["collection", "show", "season", "movie"]).optional(),
});
export type MediuxImportInput = z.infer<typeof mediuxImportSchema>;

export interface MediuxMatch {
  /** TMDb id for movies, TVDb id for shows (MediUX keys shows by TVDb), or collection name */
  id: string;
  kind: "item" | "collection";
  title?: string;
  ratingKey?: string;
  thumb?: string;
  hasPoster: boolean;
  hasBackground: boolean;
  /** Season posters present in the set */
  seasonCount: number;
  /** Episode title cards present in the set */
  episodeCount: number;
  /** Only present in apply results */
  applied?: boolean;
  appliedSeasons?: number;
  appliedEpisodes?: number;
  error?: string;
}

// ---------- Artwork provenance ----------

export interface ArtworkSource {
  source: "tpdb" | "mediux" | "tmdb" | "plex" | "upload" | "url" | string;
  /** Human-readable origin, e.g. "ThePosterDB" or "MediUX set 7028" */
  label: string;
  /** Page to revisit the origin, when known */
  url?: string;
  appliedAt: number;
}

export interface ArtworkProvenance {
  poster?: ArtworkSource;
  art?: ArtworkSource;
}

// ---------- External artwork links ----------

export interface ArtworkLinks {
  /** ThePosterDB search for the (cleaned) title */
  tpdbUrl: string;
  /** Direct MediUX page for this exact item, when resolvable */
  mediuxUrl?: string;
}

// ---------- Background jobs ----------

export interface JobStatus<T = unknown> {
  id: string;
  kind: string;
  status: "running" | "done" | "error";
  /** Human-readable line for what's happening right now */
  current?: string;
  /** Results accumulated so far (full list once status is done) */
  results: T[];
  /** Rolling per-step transcript ("✓ Family Guy s03e12 card", …) */
  log: string[];
  error?: string;
}

// ---------- Missing from collection ----------

export interface MissingCollectionItem {
  tmdbId: string;
  title: string;
  year?: number;
  /** Absolute TMDb poster URL, when available */
  posterUrl?: string;
  /** Set when the movie is in the library (but not in the collection) — enables one-click add */
  ratingKey?: string;
  /** Not yet released (or unannounced date) per TMDb */
  unreleased?: boolean;
}

export interface TmdbCollectionOption {
  id: number;
  name: string;
  posterUrl?: string;
}

export const linkCollectionSchema = z.object({
  tmdbCollectionId: z.number().int().positive(),
  tmdbCollectionName: z.string().min(1),
});
export type LinkCollectionInput = z.infer<typeof linkCollectionSchema>;

export interface CollectionCompleteness {
  /** TMDb collection the Plex collection was matched to */
  tmdbCollectionId?: number;
  tmdbCollectionName?: string;
  tmdbCollectionUrl?: string;
  /** How the match was made: pinned by the user, inferred from the collection's
   *  movies, guessed from the title, or not matched at all */
  matchSource?: "manual" | "contents" | "title" | "none";
  /** Titles in the TMDb collection that aren't in this Plex collection */
  missing: MissingCollectionItem[];
  /** Of which: already in the library, just not added to the collection */
  inLibraryNotInCollection: MissingCollectionItem[];
}

export interface TpdbSetResult {
  title: string;
  status: "applied" | "no-match" | "failed";
  error?: string;
}

export const tpdbSetSchema = z.object({
  url: z.string().url().refine((u) => /theposterdb\.com\/set\/\d+/i.test(u), {
    message: "Paste a ThePosterDB set link (theposterdb.com/set/…)",
  }),
});
export type TpdbSetInput = z.infer<typeof tpdbSetSchema>;

// ---------- Rules & automations ----------

export const ruleSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("tmdb-collection"),
    tmdbCollectionId: z.number().int().positive(),
    tmdbCollectionName: z.string().min(1),
  }),
  z.object({
    kind: z.literal("tmdb-keyword"),
    keywordId: z.number().int().positive(),
    keywordName: z.string().min(1),
  }),
]);
export type RuleSource = z.infer<typeof ruleSourceSchema>;

export const ruleScheduleSchema = z.enum(["manual", "hourly", "daily", "weekly"]);
export type RuleSchedule = z.infer<typeof ruleScheduleSchema>;

export const ruleInputSchema = z.object({
  name: z.string().min(1, "Give the rule a name"),
  enabled: z.boolean().default(true),
  requireApproval: z.boolean().default(false),
  sectionId: z.string().min(1),
  source: ruleSourceSchema,
  collectionTitle: z.string().min(1, "Collection name is required"),
  collectionRatingKey: z.string().optional(),
  addMatching: z.boolean().default(true),
  removeStrays: z.boolean().default(false),
  mediuxYaml: z.string().optional(),
  schedule: ruleScheduleSchema.default("daily"),
});
export type RuleInput = z.infer<typeof ruleInputSchema>;

export interface Rule extends Omit<RuleInput, "enabled" | "requireApproval" | "addMatching" | "removeStrays" | "schedule"> {
  id: number;
  enabled: boolean;
  requireApproval: boolean;
  addMatching: boolean;
  removeStrays: boolean;
  schedule: RuleSchedule;
  lastRunAt?: number;
  lastResult?: string;
}

export interface RuleChange {
  ratingKey: string;
  title: string;
  year?: number;
  thumb?: string;
}

export interface RuleEvaluation {
  ruleId: number;
  ruleName: string;
  collectionTitle: string;
  /** In the library + matched by the source, not yet in the collection */
  toAdd: RuleChange[];
  /** In the collection but not matched by the source (only when removeStrays) */
  toRemove: RuleChange[];
  /** Matched by source but not in the library at all */
  missingFromLibrary: { tmdbId: string; title: string; year?: number; posterUrl?: string }[];
  applied: boolean;
}

export type RunStatus = "applied" | "pending" | "no-changes" | "error" | "dismissed";

export interface RuleRun {
  id: number;
  ruleId: number;
  ruleName: string;
  startedAt: number;
  status: RunStatus;
  trigger: "manual" | "schedule";
  addedCount: number;
  removedCount: number;
  error?: string;
  log: string[];
  /** Present while status is "pending" — the diff awaiting approval */
  pending?: { toAdd: RuleChange[]; toRemove: RuleChange[] };
}

export interface AutomationSettings {
  paused: boolean;
  discordConfigured: boolean;
}

// ---------- Predefined automations ----------

/** Auto-create Plex collections from TMDb franchises you own films from. */
export interface FranchiseAutoCreate {
  enabled: boolean;
  /** Only create when at least this many of the franchise's films are owned. */
  minMovies: number;
}

/** Auto-add newly-owned franchise films to the collections you already have. */
export interface AutoAddExisting {
  enabled: boolean;
  /** Collections (by ratingKey) to leave untouched. */
  excludeRatingKeys: string[];
}

/** One studio → collection mapping. */
export interface StudioCollection {
  /** TMDb production company id. */
  companyId: number;
  /** Studio name; also the collection title. */
  name: string;
  /** Only create/keep when at least this many of the studio's films are owned. */
  minMovies: number;
}

/** Auto-create/maintain collections of movies by studio (TMDb company). */
export interface StudioAutomation {
  enabled: boolean;
  studios: StudioCollection[];
}

export interface AutomationPresets {
  franchise: FranchiseAutoCreate;
  autoAdd: AutoAddExisting;
  studio: StudioAutomation;
  /** When the preset automations last ran (they're gated to once a day). */
  lastRunAt?: number;
}

export const studioAutomationSchema = z.object({
  enabled: z.boolean(),
  studios: z
    .array(
      z.object({
        companyId: z.number().int().positive(),
        name: z.string().min(1),
        minMovies: z.number().int().min(1).max(50),
      }),
    )
    .max(50),
});
export type StudioAutomationInput = z.infer<typeof studioAutomationSchema>;

export const franchiseAutoCreateSchema = z.object({
  enabled: z.boolean(),
  minMovies: z.number().int().min(1).max(20),
});
export type FranchiseAutoCreateInput = z.infer<typeof franchiseAutoCreateSchema>;

export const autoAddExistingSchema = z.object({
  enabled: z.boolean(),
  excludeRatingKeys: z.array(z.string()),
});
export type AutoAddExistingInput = z.infer<typeof autoAddExistingSchema>;

export const automationSettingsSchema = z.object({
  paused: z.boolean().optional(),
  discordWebhookUrl: z.string().optional(),
});
export type AutomationSettingsInput = z.infer<typeof automationSettingsSchema>;

// ---------- Discord notifications ----------

/** Which categories of change should ping Discord. */
export interface DiscordEvents {
  /** Scheduled/manual rule runs that changed something. */
  rules: boolean;
  /** MediUX auto-sync runs (and what triggered them). */
  mediuxSync: boolean;
  /** Manual MediUX set applies. */
  mediuxApply: boolean;
  /** Overlay apply / restore. */
  overlays: boolean;
  /** Collections created, updated, or deleted. */
  collections: boolean;
  /** Poster/background/metadata changes. */
  artwork: boolean;
  /** Radarr/Sonarr download requests. */
  downloads: boolean;
}

export interface DiscordSettings {
  configured: boolean;
  events: DiscordEvents;
}

export const discordEventsSchema = z.object({
  rules: z.boolean(),
  mediuxSync: z.boolean(),
  mediuxApply: z.boolean(),
  overlays: z.boolean(),
  collections: z.boolean(),
  artwork: z.boolean(),
  downloads: z.boolean(),
});

export const discordSettingsInputSchema = z.object({
  webhookUrl: z.string().optional(),
  events: discordEventsSchema.partial().optional(),
});
export type DiscordSettingsInput = z.infer<typeof discordSettingsInputSchema>;

// ---------- Radarr / Sonarr ----------

export interface ArrIntegration {
  configured: boolean;
  url?: string;
  rootFolder?: string;
  qualityProfileId?: number;
}

export interface ArrSettings {
  radarr: ArrIntegration;
  sonarr: ArrIntegration;
}

export interface ArrOptions {
  rootFolders: { path: string; freeSpace?: number }[];
  qualityProfiles: { id: number; name: string }[];
}

export const arrConfigInputSchema = z.object({
  kind: z.enum(["radarr", "sonarr"]),
  url: z.string().optional(),
  apiKey: z.string().optional(),
  rootFolder: z.string().optional(),
  qualityProfileId: z.number().int().positive().optional(),
});
export type ArrConfigInput = z.infer<typeof arrConfigInputSchema>;

export const arrTestSchema = z.object({
  kind: z.enum(["radarr", "sonarr"]),
  url: z.string().optional(),
  apiKey: z.string().optional(),
});

/** A download request: `id` is a TMDb id for radarr, a TVDb id for sonarr. */
export const arrRequestSchema = z.object({
  kind: z.enum(["radarr", "sonarr"]),
  id: z.string().min(1),
  title: z.string().optional(),
});
export type ArrRequestInput = z.infer<typeof arrRequestSchema>;

export interface KeywordOption {
  id: number;
  name: string;
}

// ---------- MediUX auto-sync ----------

/**
 * A collection or show whose MediUX set MetaMagic remembers, so it can re-apply
 * the artwork (and, for collections, keep membership complete) when new content
 * is detected. Created automatically when a MediUX set is applied from that
 * item's poster picker.
 */
export interface MediuxWatch {
  ratingKey: string;
  type: "collection" | "show";
  title: string;
  /** Plex poster path for a small preview thumbnail. */
  thumb?: string;
  /** TMDb collection id (collections) or TMDb id (shows), when resolved. */
  tmdbId?: string;
  /** The MediUX set page the YAML came from, when derivable. */
  setUrl?: string;
  /** Per-item override so users can keep sync on globally but skip a few. */
  enabled: boolean;
  lastSyncedAt?: number;
  lastResult?: string;
  /** When first tracked (stable — survives re-applies). */
  createdAt: number;
  updatedAt: number;
}

export const mediuxSortSchema = z.enum(["title", "first-tracked", "recently-synced"]);
export type MediuxSort = z.infer<typeof mediuxSortSchema>;

/**
 * How auto-sync decides when to act:
 * - `detect`: check often (~every 15 min) and act only when a collection/show
 *   actually changed (a new movie or season appeared).
 * - `hourly`/`daily`/`weekly`: re-apply on that fixed cadence regardless.
 */
export const mediuxSyncModeSchema = z.enum(["detect", "hourly", "daily", "weekly"]);
export type MediuxSyncMode = z.infer<typeof mediuxSyncModeSchema>;

export interface MediuxSyncState {
  /** The global auto-sync toggle. */
  enabled: boolean;
  mode: MediuxSyncMode;
  /** When the scheduler last looked (any mode). */
  lastCheckedAt?: number;
  watches: MediuxWatch[];
}

export const mediuxSyncSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  mode: mediuxSyncModeSchema.optional(),
});
export type MediuxSyncSettingsInput = z.infer<typeof mediuxSyncSettingsSchema>;

export const mediuxWatchUpdateSchema = z.object({ enabled: z.boolean() });
export type MediuxWatchUpdateInput = z.infer<typeof mediuxWatchUpdateSchema>;

// ---------- Activity feed ----------

export type ActivityKind =
  | "mediux-sync"
  | "mediux-apply"
  | "overlay-apply"
  | "overlay-restore"
  | "collection-created"
  | "collection-deleted"
  | "collection-updated"
  | "poster-set"
  | "art-set"
  | "metadata-edit"
  | "tpdb-set"
  | "download-request";

/** A lightweight record of something MetaMagic did, for the Activity timeline. */
export interface ActivityEvent {
  id: number;
  ts: number;
  kind: ActivityKind;
  title: string;
  detail?: string;
  status: "ok" | "error";
  /** What set it off, e.g. "detected a change", "daily schedule", "manual". */
  trigger?: string;
  /** A relevant link, e.g. the poster source that was applied. */
  url?: string;
}

// ---------- Overlays ----------

export const badgeTypeSchema = z.enum([
  "resolution",
  "hdr",
  "audio",
  "rating",
  "new",
  "text",
]);
export type BadgeType = z.infer<typeof badgeTypeSchema>;

export const badgePositionSchema = z.enum([
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "top-center",
  "bottom-center",
]);
export type BadgePosition = z.infer<typeof badgePositionSchema>;

export const badgeSchema = z.object({
  type: badgeTypeSchema,
  position: badgePositionSchema.default("bottom-right"),
  /** Relative badge scale, 1 = default */
  scale: z.number().min(0.5).max(2).default(1),
  /** Background colour (hex) — the accent bar behind the label */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#111827"),
  /** For type "text": the literal label. For "new": days threshold as text. */
  value: z.string().optional(),
  /**
   * Free placement as a fraction of the poster (0–1, top-left anchor). When both
   * are set they override `position` — this is what dragging a badge in the live
   * preview records. Leave undefined to keep the six-corner preset placement.
   */
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
});
export type Badge = z.infer<typeof badgeSchema>;

export const overlayPresetInputSchema = z.object({
  name: z.string().min(1, "Give the preset a name"),
  badges: z.array(badgeSchema).min(1, "Add at least one badge"),
});
export type OverlayPresetInput = z.infer<typeof overlayPresetInputSchema>;

export interface OverlayPreset extends OverlayPresetInput {
  id: number;
}

export const applyOverlaySchema = z.object({
  presetId: z.number().int().positive(),
  sectionId: z.string().min(1),
  /** Limit to specific items; omit to apply across the whole section */
  ratingKeys: z.array(z.string()).optional(),
});
export type ApplyOverlayInput = z.infer<typeof applyOverlaySchema>;

export interface OverlayStatus {
  /** Items whose original poster MetaMagic has stored (i.e. overlaid) */
  overlaidCount: number;
}

/** Where one badge lands on the preview poster, as fractions (0–1) of its size. */
export interface BadgeBox {
  /** Index into the preset's badges array. */
  index: number;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------- Collection discovery ----------

export interface DiscoveredCollection {
  tmdbCollectionId: number;
  name: string;
  posterUrl?: string;
  /** Library items already owned that belong to this collection */
  owned: { ratingKey: string; title: string; year?: number; thumb?: string }[];
  totalParts: number;
  sectionId: string;
  /**
   * Set when the owned films already live in a Plex collection (matched by
   * membership, not just name). The UI shows "already have this" instead of a
   * Create button so franchises you've collected aren't recommended again.
   */
  existing?: { ratingKey: string; title: string; ownedCount: number };
}

// ---------- API error envelope ----------

export interface ApiError {
  error: string;
}
