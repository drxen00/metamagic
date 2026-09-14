export interface ChangelogEntry {
  version: string;
  title: string;
  date: string;
  added?: string[];
  fixed?: string[];
}

/**
 * Newest first. Bump the top entry's `version` whenever you want the "What's
 * new" dialog to pop for everyone after they update. Keep entries short and
 * user-facing.
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.19.0",
    title: "MediUX boxsets",
    date: "2026-09-14",
    added: [
      "Import a whole MediUX boxset (a bundle of like sets, e.g. all DreamWorks): paste its YAML on the Collections page to re-poster every matching collection at once and keep them all in auto-sync.",
    ],
  },
  {
    version: "0.18.0",
    title: "Instant automations",
    date: "2026-09-14",
    added: [
      "Automations now react within ~a minute of new content landing in Plex, instead of waiting for a daily sweep.",
      "A “Run now” button on every preset automation (franchise, auto-add, studio) to trigger it on demand with a live transcript.",
    ],
  },
  {
    version: "0.17.0",
    title: "Studio collections",
    date: "2026-09-14",
    added: [
      "New automation: auto-create and maintain collections by studio (DreamWorks, A24, Pixar…). Search a studio, set a minimum, and MetaMagic keeps the collection stocked with what you own.",
    ],
  },
  {
    version: "0.16.0",
    title: "Discord + Radarr/Sonarr",
    date: "2026-09-13",
    added: [
      "New Discord section with granular, per-category notifications.",
      "Radarr & Sonarr integration: request missing collection movies for download, with a mandatory heads-up before any search.",
      "A “downloading” badge on missing movies that are in the Radarr queue.",
    ],
    fixed: [
      "MediUX Auto-Sync cards show a poster preview and color-coded collection/show tags.",
      "The tracked list can be collapsed and sorted (title / first tracked / recently synced).",
    ],
  },
  {
    version: "0.15.0",
    title: "Automations, reimagined",
    date: "2026-09-13",
    added: [
      "The Rules page is now Automations — a home for set-and-forget collection automation.",
      "Auto-create franchise collections: MetaMagic makes the collection once you own enough of a franchise.",
      "Auto-add new movies to the collections you already have (with a per-collection exclude list).",
      "A “What’s new” note (this one!) after each update.",
    ],
    fixed: [
      "Overlay drag is now smooth and shows the real badge where it’ll land.",
      "Custom rules are tucked under “Advanced” so the automatic options come first.",
    ],
  },
  {
    version: "0.14.0",
    title: "Activity that shows everything",
    date: "2026-09-13",
    added: [
      "Activity now logs every change — poster/art updates (with the source link), uploads, MediUX & ThePosterDB applies, metadata edits, and collection changes.",
      "MediUX Auto-Sync: choose “On detection” or a schedule, with a live status line and “Sync all now”.",
    ],
    fixed: [
      "Collection discovery can suggest a collection from a single owned film now.",
      "Poster changes made in MetaMagic show up everywhere, including overlay previews.",
    ],
  },
  {
    version: "0.13.0",
    title: "MediUX Auto-Sync",
    date: "2026-09-13",
    added: [
      "Apply a MediUX set to a collection or show and MetaMagic remembers it, keeping new movies and seasons styled automatically.",
      "Poster overlays you can drag into place in a live preview.",
    ],
  },
];

export const CURRENT_VERSION = CHANGELOG[0].version;
