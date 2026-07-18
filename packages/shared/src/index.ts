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
  videoResolution?: string;
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
export type ArtworkSource = "plex" | "tmdb";

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
  /** TMDb id for movies, TVDb id for shows (MediUX keys shows by TVDb) */
  id: string;
  title?: string;
  ratingKey?: string;
  thumb?: string;
  hasPoster: boolean;
  hasBackground: boolean;
  /** Only present in apply results */
  applied?: boolean;
  error?: string;
}

// ---------- External artwork links ----------

export interface ArtworkLinks {
  /** ThePosterDB search for the (cleaned) title */
  tpdbUrl: string;
  /** Direct MediUX page for this exact item, when resolvable */
  mediuxUrl?: string;
}

// ---------- API error envelope ----------

export interface ApiError {
  error: string;
}
