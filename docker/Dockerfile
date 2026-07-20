# ---------- Build ----------
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps ./apps

# Next.js standalone build; /api rewrite targets 127.0.0.1:3801 inside the container
RUN pnpm --filter @metamagic/web build

# Self-contained API bundle (workspace deps + prod node_modules, incl. tsx runner)
RUN pnpm --filter @metamagic/api --prod deploy --legacy /out/api

# ---------- Runtime ----------
FROM node:22-bookworm-slim
# fonts-dejavu-core: sharp renders overlay badge text via SVG, which needs a
# real font installed — without it labels silently render blank.
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./web
COPY --from=build /app/apps/web/.next/static ./web/apps/web/.next/static
COPY --from=build /out/api ./api
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production \
    CONFIG_DIR=/config \
    PORT=3800 \
    HOSTNAME=0.0.0.0 \
    API_PORT=3801 \
    API_HOST=127.0.0.1

EXPOSE 3800
VOLUME /config

ENTRYPOINT ["/entrypoint.sh"]
