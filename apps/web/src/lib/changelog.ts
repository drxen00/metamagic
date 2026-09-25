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
    version: "0.24.0",
    title: "Security updates",
    date: "2026-09-25",
    fixed: [
      "Updated dependencies to clear all known security advisories (Next.js, Fastify, sharp, and transitive packages).",
      "Hardened the internal image proxy against protocol-relative paths.",
    ],
  },
  {
    version: "0.23.0",
    title: "Overlay preview that always shows",
    date: "2026-09-25",
    fixed: [
      "The overlay live preview now always shows the badge you're adding — even on a title that doesn't have that attribute (like a resolution badge on a TV show) — using a sample value so you can position it. On apply, each badge still only lands on items that actually have that attribute.",
    ],
  },
  {
    version: "0.22.0",
    title: "Calmer notifications",
    date: "2026-09-25",
    added: [
      "The coffee/support button now uses your chosen accent color so it fits the theme.",
    ],
    fixed: [
      "MediUX auto-sync no longer re-reports every tracked show and collection when you add unrelated content — it now only touches (and only tells you about) the show or collection that actually changed.",
      "Auto-sync sweeps send a single, batched Discord message summarizing what changed, instead of one ping per tracked item.",
    ],
  },
  {
    version: "0.21.0",
    title: "Polish + a coffee",
    date: "2026-09-25",
    added: [
      "You can now support MetaMagic with a “Buy me a coffee” link — in the sidebar and on the Settings page. It’s always optional and always appreciated.",
    ],
    fixed: [
      "Fixed the app icon so it fills the frame properly in the Unraid docker tab and app store, instead of looking inset.",
    ],
  },
  {
    version: "0.20.0",
    title: "Know what you’re adding",
    date: "2026-09-14",
    added: [
      "The studio picker now shows each studio’s logo, country, how many of its films you already own, and its total on TMDb — and sorts by what you own most of, so it’s obvious which “A24” is the right one.",
      "“Collections you could create” now defaults to needing at least 2 owned films, so the scan leads with real franchises instead of one-offs.",
    ],
  },
  {
    version: "0.19.0",
    title: "Fill the gaps",
    date: "2026-09-14",
    added: [
      "Open any show to see which aired seasons you’re missing (vs TMDb) and request the whole series in Sonarr in one click.",
      "New opt-in automation: automatically request missing collection movies from Radarr as new parts get added — off by default, with a mandatory heads-up before it can be enabled.",
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
