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

// ---------- API error envelope ----------

export interface ApiError {
  error: string;
}
