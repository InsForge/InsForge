# ============================================================
# Stage 1: package-prep — strip version from root package.json
# ============================================================
# Separate stage so that COPY --from uses content-based caching.
# Even if this stage rebuilds on version bump, the OUTPUT is
# identical (version removed), so downstream COPY --from hits cache.
# Pinned deno version — matches docker-compose deno runtime (denoland/deno:alpine-2.0.6)
ARG DENO_VERSION=2.0.6
FROM denoland/deno:alpine-${DENO_VERSION} AS deno-bin

FROM node:20-alpine AS package-prep

RUN apk add --no-cache jq

COPY package.json /tmp/package.json

RUN mkdir -p /out && \
    jq 'del(.version) | .workspaces = [.workspaces[] | select(. != "mcp")]' \
      /tmp/package.json > /out/package.json


# ============================================================
# Stage 2: deps — ALL dependencies (dev + prod) for building
# ============================================================
FROM node:20-alpine AS deps

WORKDIR /app

# Root package.json comes from package-prep (version stripped).
# COPY --from uses content-based cache: if output is identical,
# this layer and npm install below stay cached across releases.
COPY --from=package-prep /out/package.json ./package.json
COPY package-lock.json ./package-lock.json

COPY backend/package.json     ./backend/package.json
COPY frontend/package.json    ./frontend/package.json
COPY auth/package.json        ./auth/package.json
COPY shared-schemas/package.json ./shared-schemas/package.json
COPY ui/package.json          ./ui/package.json

# Strip prepare/build scripts from shared-schemas to prevent tsc
# from running during install (source files aren't copied yet).
# The actual build happens in the build stage with full source.
RUN apk add --no-cache jq && \
    jq 'del(.scripts.prepare, .scripts.build)' \
      shared-schemas/package.json > shared-schemas/package.json.tmp && \
    mv shared-schemas/package.json.tmp shared-schemas/package.json

RUN npm ci && npm cache clean --force


# ============================================================
# Stage 3: build — compile all packages
# ============================================================
FROM deps AS build

COPY . .

# Vite bakes these into static bundles at compile time
ARG VITE_API_BASE_URL
ARG VITE_PUBLIC_POSTHOG_KEY

# Build order: ui → backend → frontend → auth
RUN npm run build


# ============================================================
# Stage 4: prod-deps — production dependencies only
# ============================================================
FROM node:20-alpine AS prod-deps

WORKDIR /app

COPY --from=package-prep /out/package.json ./package.json
COPY package-lock.json ./package-lock.json

COPY backend/package.json     ./backend/package.json
COPY frontend/package.json    ./frontend/package.json
COPY auth/package.json        ./auth/package.json
COPY shared-schemas/package.json ./shared-schemas/package.json
COPY ui/package.json          ./ui/package.json

# Strip prepare/build scripts from shared-schemas to prevent tsc
# from running during install (tsc is a devDependency, not available here).
# The compiled output comes from the build stage instead.
RUN apk add --no-cache jq && \
    jq 'del(.scripts.prepare, .scripts.build)' \
      shared-schemas/package.json > shared-schemas/package.json.tmp && \
    mv shared-schemas/package.json.tmp shared-schemas/package.json

RUN npm ci --omit=dev && npm cache clean --force


# ============================================================
# Stage 5: runner — minimal production image
# ============================================================
FROM node:20-alpine AS runner

# tini: proper PID 1 for signal forwarding and zombie reaping
RUN apk add --no-cache tini

WORKDIR /app

# Production node_modules (hoisted by npm workspaces)
COPY --from=prod-deps /app/node_modules ./node_modules

# Compiled output: server.js + frontend/ + auth/ static files
COPY --from=build /app/dist ./dist

# Migration runtime: tsx resolves @/* aliases via tsconfig.json,
# node-pg-migrate reads .sql files from backend/src/
COPY --from=build /app/backend/src ./backend/src
COPY --from=build /app/backend/tsconfig.json ./backend/tsconfig.json
COPY --from=build /app/shared-schemas/src ./shared-schemas/src

# Package manifests for npm scripts
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/package.json ./package.json

# tsx is a devDependency but required at runtime for migrate:bootstrap
RUN npm install -g "tsx@^4.7.1" && npm cache clean --force

# Run as non-root using the built-in node user (uid 1000)
RUN mkdir -p /data /insforge-storage /insforge-logs && chown -R node:node /app /data /insforge-storage /insforge-logs
USER node

EXPOSE 7130 7131

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "cd backend && npm run migrate:up && cd .. && exec npm start"]


# ============================================================
# Stage: dev — development image (used by docker-compose)
# ============================================================
# Source code is mounted via volumes, only needs Node.js + Deno.
FROM node:20-alpine AS dev

COPY --from=deno-bin /bin/deno /usr/local/bin/deno

WORKDIR /app
