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

export const automationSettingsSchema = z.object({
  paused: z.boolean().optional(),
  discordWebhookUrl: z.string().optional(),
});
export type AutomationSettingsInput = z.infer<typeof automationSettingsSchema>;

export interface KeywordOption {
  id: number;
  name: string;
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

// ---------- Collection discovery ----------

export interface DiscoveredCollection {
  tmdbCollectionId: number;
  name: string;
  posterUrl?: string;
  /** Library items already owned that belong to this collection */
  owned: { ratingKey: string; title: string; year?: number; thumb?: string }[];
  totalParts: number;
  sectionId: string;
}

// ---------- API error envelope ----------

export interface ApiError {
  error: string;
}
