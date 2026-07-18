import type {
  FilterOption,
  LibraryQuery,
  LibrarySection,
  LibraryType,
  MediaItem,
  PagedResult,
  PlexCollection,
  PlexServerInfo,
} from "@metamagic/shared";

const PLEX_HEADERS = {
  Accept: "application/json",
  "X-Plex-Product": "MetaMagic",
  "X-Plex-Version": "0.1.0",
  "X-Plex-Client-Identifier": "metamagic-server",
  "X-Plex-Platform": "Node",
  "X-Plex-Device-Name": "MetaMagic",
};

export class PlexError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

interface PlexMetadata {
  ratingKey: string;
  key: string;
  title: string;
  titleSort?: string;
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
  childCount?: number;
  selected?: boolean;
  provider?: string;
  librarySectionID?: number | string;
  librarySectionTitle?: string;
  Genre?: { tag: string; id?: number }[];
  Collection?: { tag: string; id?: number }[];
  Label?: { tag: string }[];
  Guid?: { id: string }[];
  Media?: { videoResolution?: string }[];
}

interface PlexContainer {
  MediaContainer: {
    size?: number;
    totalSize?: number;
    friendlyName?: string;
    machineIdentifier?: string;
    version?: string;
    Metadata?: PlexMetadata[];
    Directory?: {
      key: string;
      title: string;
      type: string;
      fastKey?: string;
    }[];
  };
}

const SECTION_TYPE_IDS: Record<string, number> = { movie: 1, show: 2, artist: 8, photo: 13 };

/** Plex metadata type ids used by the /library/sections/{id}/all edit endpoint. */
export const EDIT_TYPE_IDS: Record<string, number> = {
  movie: 1,
  show: 2,
  season: 3,
  episode: 4,
  collection: 18,
};

export class PlexClient {
  constructor(
    private baseUrl: string,
    private token: string,
    private machineIdentifier?: string,
  ) {}

  private async request<T = PlexContainer>(
    pathname: string,
    params: Record<string, string | number | undefined> = {},
    init: { method?: string; body?: Buffer; contentType?: string } = {},
  ): Promise<T> {
    const url = new URL(pathname, this.baseUrl);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    url.searchParams.set("X-Plex-Token", this.token);

    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method ?? "GET",
        headers: init.body
          ? { ...PLEX_HEADERS, "Content-Type": init.contentType ?? "application/octet-stream" }
          : PLEX_HEADERS,
        body: init.body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new PlexError(
        `Could not reach Plex at ${this.baseUrl} — check the URL and that the server is running.`,
      );
    }
    if (res.status === 401) {
      throw new PlexError("Plex rejected the token (401 Unauthorized).", 401);
    }
    if (!res.ok) {
      throw new PlexError(`Plex returned ${res.status} for ${pathname}`, res.status);
    }
    const text = await res.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  async identity(): Promise<PlexServerInfo> {
    const data = await this.request("/");
    const mc = data.MediaContainer;
    if (!mc?.machineIdentifier) {
      throw new PlexError("That URL responded, but not like a Plex server.");
    }
    this.machineIdentifier = mc.machineIdentifier;
    return {
      name: mc.friendlyName ?? "Plex Server",
      machineIdentifier: mc.machineIdentifier,
      version: mc.version ?? "unknown",
    };
  }

  async sections(): Promise<LibrarySection[]> {
    const data = await this.request("/library/sections");
    return (data.MediaContainer.Directory ?? [])
      .filter((d) => d.type === "movie" || d.type === "show")
      .map((d) => ({ id: d.key, title: d.title, type: d.type as LibraryType }));
  }

  async sectionCount(sectionId: string): Promise<number> {
    const data = await this.request(`/library/sections/${sectionId}/all`, {
      "X-Plex-Container-Start": 0,
      "X-Plex-Container-Size": 0,
    });
    return data.MediaContainer.totalSize ?? 0;
  }

  async sectionItems(sectionId: string, q: LibraryQuery): Promise<PagedResult<MediaItem>> {
    const params: Record<string, string | number | undefined> = {
      "X-Plex-Container-Start": q.offset,
      "X-Plex-Container-Size": q.limit,
      sort: q.sort ?? "titleSort:asc",
      includeCollections: 1,
      includeGuids: 1,
    };
    if (q.search) params.title = q.search;
    if (q.genre) params.genre = q.genre;
    if (q.year) params.year = q.year;
    if (q.unwatched) params.unwatched = 1;

    const data = await this.request(`/library/sections/${sectionId}/all`, params);
    const mc = data.MediaContainer;
    return {
      items: (mc.Metadata ?? []).map(toMediaItem),
      totalSize: mc.totalSize ?? mc.size ?? 0,
      offset: q.offset,
    };
  }

  async genres(sectionId: string): Promise<FilterOption[]> {
    const data = await this.request(`/library/sections/${sectionId}/genre`);
    return (data.MediaContainer.Directory ?? []).map((d) => ({
      id: d.fastKey?.match(/genre=(\d+)/)?.[1] ?? d.key,
      title: d.title,
    }));
  }

  async item(ratingKey: string): Promise<MediaItem> {
    const data = await this.request(`/library/metadata/${ratingKey}`, {
      includeCollections: 1,
    });
    const meta = data.MediaContainer.Metadata?.[0];
    if (!meta) throw new PlexError(`Item ${ratingKey} not found`, 404);
    return toMediaItem(meta);
  }

  async collections(sectionId?: string): Promise<PlexCollection[]> {
    if (sectionId) {
      const data = await this.request(`/library/sections/${sectionId}/collections`);
      return (data.MediaContainer.Metadata ?? []).map(toCollection);
    }
    const all: PlexCollection[] = [];
    for (const section of await this.sections()) {
      const data = await this.request(`/library/sections/${section.id}/collections`);
      all.push(...(data.MediaContainer.Metadata ?? []).map(toCollection));
    }
    return all;
  }

  async collectionChildren(ratingKey: string): Promise<MediaItem[]> {
    const data = await this.request(`/library/collections/${ratingKey}/children`);
    return (data.MediaContainer.Metadata ?? []).map(toMediaItem);
  }

  private metadataUri(ratingKeys: string[]): string {
    if (!this.machineIdentifier) {
      throw new PlexError("Machine identifier unknown — reconnect to Plex in Settings.");
    }
    return `server://${this.machineIdentifier}/com.plexapp.plugins.library/library/metadata/${ratingKeys.join(",")}`;
  }

  async createCollection(
    sectionId: string,
    sectionType: LibraryType,
    title: string,
    ratingKeys: string[],
  ): Promise<PlexCollection> {
    const data = await this.request(
      "/library/collections",
      {
        type: SECTION_TYPE_IDS[sectionType] ?? 1,
        title,
        smart: 0,
        sectionId,
        uri: this.metadataUri(ratingKeys),
      },
      { method: "POST" },
    );
    const meta = data.MediaContainer.Metadata?.[0];
    if (!meta) throw new PlexError("Plex did not return the created collection.");
    return toCollection(meta);
  }

  async addToCollection(collectionRatingKey: string, ratingKeys: string[]): Promise<void> {
    await this.request(
      `/library/collections/${collectionRatingKey}/items`,
      { uri: this.metadataUri(ratingKeys) },
      { method: "PUT" },
    );
  }

  async removeFromCollection(collectionRatingKey: string, itemRatingKey: string): Promise<void> {
    await this.request(
      `/library/collections/${collectionRatingKey}/children/${itemRatingKey}`,
      {},
      { method: "DELETE" },
    );
  }

  async deleteCollection(ratingKey: string): Promise<void> {
    await this.request(`/library/collections/${ratingKey}`, {}, { method: "DELETE" });
  }

  /**
   * Edit metadata fields via the section-level PUT endpoint (the same API the
   * Plex web editor uses). Values set here are locked so agent refreshes
   * don't overwrite them.
   */
  async editMetadata(
    sectionId: string,
    typeId: number,
    ratingKey: string,
    params: Record<string, string | number>,
  ): Promise<void> {
    await this.request(
      `/library/sections/${sectionId}/all`,
      { type: typeId, id: ratingKey, ...params },
      { method: "PUT" },
    );
  }

  buildFieldParams(fields: {
    title?: string;
    titleSort?: string;
    summary?: string;
  }): Record<string, string | number> {
    const params: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        params[`${key}.value`] = value;
        params[`${key}.locked`] = 1;
      }
    }
    return params;
  }

  buildTagParams(
    tagType: "label" | "genre",
    current: string[],
    add: string[] = [],
    remove: string[] = [],
  ): Record<string, string | number> {
    const params: Record<string, string | number> = {};
    const removeSet = new Set(remove.map((t) => t.toLowerCase()));
    const next = [...current.filter((t) => !removeSet.has(t.toLowerCase())), ...add];
    next.forEach((tag, i) => {
      params[`${tagType}[${i}].tag.tag`] = tag;
    });
    if (remove.length > 0) {
      params[`${tagType}[].tag.tag-`] = remove.join(",");
    }
    params[`${tagType}.locked`] = 1;
    return params;
  }

  async listArtwork(ratingKey: string, kind: "poster" | "art"): Promise<PlexMetadata[]> {
    const data = await this.request(`/library/metadata/${ratingKey}/${kind}s`);
    return data.MediaContainer.Metadata ?? [];
  }

  /** Apply artwork: `url` is either a Plex artwork ratingKey or a remote http(s) URL. */
  async setArtwork(ratingKey: string, kind: "poster" | "art", url: string): Promise<void> {
    await this.request(`/library/metadata/${ratingKey}/${kind}`, { url }, { method: "PUT" });
  }

  async uploadArtwork(
    ratingKey: string,
    kind: "poster" | "art",
    image: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.request(`/library/metadata/${ratingKey}/${kind}s`, {}, {
      method: "POST",
      body: image,
      contentType,
    });
  }

  /** Lock the artwork field (thumb/art) so metadata refreshes keep the choice. */
  async lockArtwork(
    sectionId: string,
    typeId: number,
    ratingKey: string,
    kind: "poster" | "art",
  ): Promise<void> {
    const field = kind === "poster" ? "thumb" : "art";
    await this.editMetadata(sectionId, typeId, ratingKey, { [`${field}.locked`]: 1 });
  }

  imageUrl(imagePath: string, width: number, height: number): string {
    const url = new URL("/photo/:/transcode", this.baseUrl);
    url.searchParams.set("width", String(width));
    url.searchParams.set("height", String(height));
    url.searchParams.set("minSize", "1");
    url.searchParams.set("upscale", "1");
    url.searchParams.set("url", imagePath);
    url.searchParams.set("X-Plex-Token", this.token);
    return url.toString();
  }
}

function toMediaItem(m: PlexMetadata): MediaItem {
  const tmdbGuid = m.Guid?.find((g) => g.id.startsWith("tmdb://"));
  return {
    ratingKey: m.ratingKey,
    title: m.title,
    titleSort: m.titleSort,
    librarySectionId: m.librarySectionID !== undefined ? String(m.librarySectionID) : undefined,
    tmdbId: tmdbGuid?.id.replace("tmdb://", ""),
    type: m.type,
    year: m.year,
    thumb: m.thumb,
    art: m.art,
    summary: m.summary,
    rating: m.rating,
    audienceRating: m.audienceRating,
    contentRating: m.contentRating,
    duration: m.duration,
    addedAt: m.addedAt,
    viewCount: m.viewCount,
    videoResolution: m.Media?.[0]?.videoResolution,
    genres: m.Genre?.map((g) => g.tag),
    collections: m.Collection?.map((c) => ({
      tag: c.tag,
      id: c.id !== undefined ? String(c.id) : undefined,
    })),
    labels: m.Label?.map((l) => l.tag),
  };
}

function toCollection(m: PlexMetadata): PlexCollection {
  return {
    ratingKey: m.ratingKey,
    title: m.title,
    summary: m.summary,
    thumb: m.thumb,
    childCount: Number(m.childCount ?? 0),
    sectionId: m.librarySectionID !== undefined ? String(m.librarySectionID) : undefined,
    sectionTitle: m.librarySectionTitle,
  };
}
