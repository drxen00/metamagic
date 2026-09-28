# MetaMagic Roadmap

A running backlog of features we've considered or want to build. Nothing here is
committed to a timeline — it's the "what could come next" list. Roughly ordered
by value-to-effort within each section.

## Where MetaMagic already stands out vs. Kometa

These are done and are our differentiators — keep them sharp:

- Full GUI, **no YAML** (Kometa is config-file only)
- Live **drag-to-place overlay preview**
- Per-item granular editing **and** mass-select operations
- **MediUX auto-sync** (re-applies artwork sets when content changes)
- Sub-minute **change watcher** (automations feel instant)
- Built-in **Radarr/Sonarr** request UI with collection/season completeness detection
- Encrypted Plex token, backend-proxied images

## Previously considered (from earlier sessions)

- [ ] **Plex websocket watcher** — sub-second reaction via Plex's websocket instead
      of the 60s fingerprint poll. Tabled; the change-watcher already covers the
      "feels instant" goal, so this is a nice-to-have.
- [ ] **Character-based auto-collections** — build collections around a character
      (e.g. every Batman film) via TMDb keywords. Explicitly parked for now.
- [ ] **Dynamic collections** — user-defined smart/dynamic collection rules beyond
      franchise/studio (an early idea we didn't pursue).
- [x] ~~MediUX boxset import~~ — attempted and removed; boxsets aren't YAML-backed,
      so there's nothing to apply. Revisit only if MediUX exposes an API.

## Feature parity gaps vs. Kometa (tabled for future expansion)

### A. More collection builders / sources (biggest gap)
Today we have franchise, studio, and TMDb-keyword. Kometa also builds from many
list/chart sources. Highest-impact to add:

- [ ] **Chart collections** — IMDb Top 250, TMDb Trending/Popular, Letterboxd.
- [ ] **Streaming-service collections** — Netflix, Disney+, Max, Prime, Apple TV+, etc.
- [ ] **"Based on…"** — based on a book / true story / comic / video game.
- [ ] **Shared-universe collections** — MCU, DCEU, Wizarding World, MonsterVerse…
- [ ] Other list sources as demand appears: MDBList, Tautulli "most-watched",
      Trakt (note: Kometa itself dropped Trakt over API churn), anime lists
      (AniList / MAL / Simkl) if we want anime coverage.

### B. Pre-made "category" collection sets
One-click category collections, same engine as studio collections:

- [ ] **Genre**, **Decade/Year**, **Director**, **Actor**, **Writer**
- [ ] **Country / region**, **Resolution**, **Audio/Subtitle language**
- [ ] **Seasonal** (holidays) collections

### C. Award collections
- [ ] Oscars, BAFTA, Cannes, Emmy, Golden Globes, SAG, Sundance, Venice, Razzies…
      (self-contained and high wow-factor)

### C2. Branded artwork — poster generator + logo overlays
Make built-in collections/overlays look as good as Kometa's, but with our own
assets (no lifting Kometa's trademarked logo PNGs). Asset strategy:

- **Posters**: a generator that composites a source image (TMDb/MediUX/member
  art) + gradient + title text into a clean collection poster. Gives MetaMagic
  its own look and needs no third-party asset packs.
- **Logos** (streaming/studio/network): source from **Simple Icons** (brand
  SVGs under CC0) rather than copying Kometa's images — the artwork is genuinely
  free, crisp at any size, and recolorable.
- **Asset-agnostic**: the overlay/poster engine takes any logo/poster the user
  points at, so the *tool* isn't the thing redistributing trademarks; ship a
  tasteful CC0 default pack for out-of-the-box looks.

- [x] Poster generator (backdrop/member art + gradient + title) — v1
- [x] Poster source controls — shuffle, pick a member, prefer collection/TMDb backdrop
- [x] Collage posters (member posters behind the gradient)
- [x] Logo overlay badges — a CC0 Simple Icons pack (streaming brands)
- [x] Streaming-service logos on generated collection posters — pick a service or "auto" (detect the collection's dominant service via TMDb watch-providers)
- [ ] Watch-provider region setting in the UI (defaults to US)

### D. Auto-badge overlay layer
Our overlay tool is a custom drag-to-place builder. Kometa auto-applies a catalog
of badges library-wide. Add a rule-driven auto-badge layer on top of the existing
overlay renderer:

- [ ] Resolution / 4K, HDR / Dolby Vision, audio codec, video format
- [ ] Ratings badges (IMDb / Rotten Tomatoes / Metacritic — needs OMDb/MDBList)
- [ ] Streaming service, network, runtime, airing status
- [ ] Award ribbons, "mediastinger" (post-credits scene)

### E. Mass library operations
- [ ] A "Library Operations" panel: bulk update posters/backgrounds, ratings,
      genres, content-ratings, titles across a whole library from
      TMDb/IMDb/OMDb/MDBList (Kometa's `mass_metadata_update`).

### F. Playlists
- [ ] Ordered, cross-library playlists (e.g. MCU chronological watch order).

### G. Smaller gaps
- [ ] Multi-source **ratings** ingestion (OMDb / MDBList API keys).
- [ ] **Music library** support (artist/album/track metadata).
- [ ] Collection **sort / mode / pin-to-home** controls.
- [ ] Local **asset-folder** support (pull artwork from a mounted folder).
- [ ] More **notification targets** — Notifiarr, ntfy, Gotify, generic webhooks
      (currently Discord-only).

## Suggested next targets (best value-to-effort)

1. Chart / streaming-service collection builders (A) — reuses TMDb discovery.
2. Category collection sets (B) — genre / decade / director.
3. Award collections (C).
4. Auto-badge overlay layer (D) — the overlay renderer already exists.
