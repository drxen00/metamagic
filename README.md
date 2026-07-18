# MetaMagic ✨

A Plex library manager with a first-class GUI — the power of [Kometa](https://kometa.wiki)-style library management with **granular per-item control** and **mass operations**, no YAML required.

- **Library browser** — poster grids for huge libraries with search, sort, genre/unwatched filters, and infinite scroll
- **Collections** — create, browse, and delete collections; add/remove single items from the detail drawer, or multi-select posters and bulk-add
- **Safe by design** — your Plex token is encrypted at rest (AES-256-GCM) and never sent to the browser; posters are proxied through the backend
- **Roadmap** — metadata editing with TMDb art picking, a visual rules engine with live match preview, poster overlays, Kometa config import

## Stack

pnpm monorepo: Next.js (App Router, Tailwind v4) web app in `apps/web`, Fastify API in `apps/api`, shared zod schemas in `packages/shared`. SQLite in `/config`.

## Development

```bash
pnpm install
pnpm dev
# web: http://localhost:3800  ·  api: http://localhost:3801
```

Connect your Plex server under **Settings** (server URL + [X-Plex-Token](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)).

## Docker

```bash
docker build -f docker/Dockerfile -t metamagic .
docker run -d --name metamagic -p 3800:3800 -v /path/to/appdata:/config -e PUID=99 -e PGID=100 metamagic
```

An Unraid Community Applications template lives at [docker/unraid-template.xml](docker/unraid-template.xml).

## Credits

The visual design system (color tokens and theme presets) is ported from [arr-dashboard](https://github.com/Kha-kis/arr-dashboard) by the arr-dashboard contributors, used under the MIT License.
