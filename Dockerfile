# Blue Pencil — one image serving the API and the built browser app.
#
# A single service rather than two. Splitting them would put the app and the
# API on different origins, which forces the session cookie to `SameSite=None`
# — restricted by Safari and Brave, and the resulting sign-outs only reproduce
# on someone else's machine. Same origin also means CORS never applies and
# there is one deployable rather than two that must be kept in step.

# ---------------------------------------------------------------- build ----
FROM node:22-alpine AS build

# OpenSSL is a Prisma engine dependency; alpine does not ship it.
RUN apk add --no-cache openssl

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# Manifests first, so a source-only change does not re-resolve the whole tree.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/analysis/package.json packages/analysis/
COPY packages/schema/package.json packages/schema/

RUN pnpm install --frozen-lockfile

COPY . .

# The Prisma client is generated code and is not in the repository.
RUN pnpm --filter @bp/api exec prisma generate

# Workspace packages first: both apps import their build output, not their
# source.
RUN pnpm build:packages

# Empty VITE_API_URL means the browser app calls its own origin, which is this
# same server. Baked in at build time, because Vite inlines it.
ENV VITE_API_URL=""
RUN pnpm --filter @bp/web build
RUN pnpm --filter @bp/api build

# -------------------------------------------------------------- runtime ----
FROM node:22-alpine AS runtime

RUN apk add --no-cache openssl

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

# The whole tree, deliberately.
#
# pnpm links workspace packages into node_modules by symlink, so pruning dev
# dependencies out of a workspace install reliably breaks those links. The
# image carries some build tooling it will not run; the alternative is a
# smaller image that occasionally fails to start, which is a bad trade for a
# few hundred megabytes. The Prisma CLI staying behind is a bonus — the release
# command needs it to migrate.
COPY --from=build /app /app

# Run as the unprivileged user the base image already provides.
USER node

EXPOSE 8080

# Fastify listens on 0.0.0.0 already, which it must to be reachable from
# outside the container.
CMD ["node", "apps/api/dist/server.js"]
