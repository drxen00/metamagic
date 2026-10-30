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
    version: "0.34.0",
    title: "Separate episode-card sets",
    date: "2026-10-30",
    added: [
      "Shows can now track two MediUX sets: one for the show & season posters and one just for episode title cards. Open a show or season’s poster picker → MediUX YAML and you’ll see a box for each — great for when an uploader publishes them separately, or you like one set’s posters and another’s cards.",
      "The episode-cards box only ever uses the title cards from the set you paste, and it always wins for cards. Auto-sync re-applies both when new seasons arrive, so there’s no more juggling two YAMLs by hand.",
      "MediUX Auto-Sync now shows which set(s) each item is tracking (with links), and lets you drop a show’s posters or card set on its own.",
    ],
  },
  {
    version: "0.33.0",
    title: "Actor suggestions",
    date: "2026-10-24",
    added: [
      "Actor collections now suggest actors for you: scan your library and MetaMagic lists the actors who lead the most of your movies (e.g. “John Wayne — 3 lead roles: True Grit, Rio Bravo, The Searchers”) that you haven’t set up yet. Add them one at a time or all at once.",
      "Suggestions remember the last scan, flag actors who already have a collection (adding them keeps it synced), and let you set the minimum number of lead roles. Rescans are near-instant thanks to caching.",
    ],
  },
  {
    version: "0.32.0",
    title: "Actor collections",
    date: "2026-10-14",
    added: [
      "New automation: Actor collections. Search an actor (e.g. Ryan Gosling) and MetaMagic keeps a collection of the movies you own where they play a main character — cameos and bit parts are left out. Choose what counts (top-billed, top 3, top 5, or any role) and a minimum number of films.",
      "The actor search shows how many lead roles each person has in your library, so it’s obvious who’s worth a collection.",
      "New actor collections get the actor’s portrait as their poster, and new arrivals are added automatically.",
    ],
    fixed: [
      "Studio collections now work across multiple movie libraries (e.g. Movies + 4K Movies) — each library gets its own collection instead of the films being added to the wrong one.",
    ],
  },
  {
    version: "0.31.0",
    title: "Streaming logos are an overlay now",
    date: "2026-10-08",
    added: [
      "New “Streaming service” overlay badge: every title gets the real, full-color logo of the streaming service it’s on (Netflix, Disney+, Max, Prime Video, Hulu, Apple TV+…), detected automatically via TMDb — so one preset badges your whole library. Titles that aren’t on a subscription service are skipped.",
      "The live preview’s drag handle shows the actual logo, and the logo always fits its box; use the size slider to scale it.",
    ],
    fixed: [
      "Removed the streaming-logo dropdown from collections. Any collection that had a logo stamped on its poster gets its clean poster back automatically after this update.",
    ],
  },
  {
    version: "0.30.0",
    title: "Real streaming logos, on any collection",
    date: "2026-10-01",
    added: [
      "Stamp a real, full-color streaming-service logo (Netflix, Disney+, Max, Prime Video, Apple TV+, Hulu, and every other service TMDb knows) on any collection — generated, uploaded, or MediUX-synced. Open a collection and pick a service, or “Auto” to use the one most of its titles are on.",
      "Logos stick: MetaMagic re-stamps the logo automatically after a MediUX auto-sync replaces the poster, so an auto-synced collection keeps its badge.",
    ],
    fixed: [
      "Streaming logos are now the real, colored brand logos (from TMDb) instead of plain white icons.",
      "Collections no longer appear in the overlay live preview at all — they have no quality/resolution attributes, so overlays never applied to them.",
    ],
  },
  {
    version: "0.27.0",
    title: "Better generated posters",
    date: "2026-09-28",
    added: [
      "The poster generator now lets you choose the background: shuffle through member art, click a specific title to use, or prefer the collection’s own backdrop / a TMDb collection backdrop.",
      "New “Collage” style — a mosaic of member posters behind the gradient, the classic collection look.",
    ],
  },
  {
    version: "0.26.0",
    title: "Generate collection posters",
    date: "2026-09-27",
    added: [
      "New “Generate poster” button on any collection: MetaMagic builds a clean poster from the collection’s own artwork — a gradient with the title — that you can preview, tweak, and apply in one click.",
    ],
  },
  {
    version: "0.25.0",
    title: "Track any collection",
    date: "2026-09-25",
    added: [
      "MediUX Auto-Sync now lists collections that aren't tracked yet (ones created from a scan or rule, with no MediUX set applied) under a “not synced yet” section — paste a set to apply it and start syncing that collection.",
    ],
  },
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
