---
title: "Self-Host InsForge on Coolify"
description: "Self-host InsForge on Coolify as a Docker Compose resource, with the Postgres image built from the repo so its config always matches the release."
---

# Self-Host InsForge on Coolify

This guide walks through self-hosting the InsForge platform on [Coolify](https://coolify.io), an open-source PaaS you run on your own server.

<Note>
  **This deploys InsForge itself, not the app you built.** If you just want to take your app live, use [Sites](/core-concepts/sites/overview) instead.
</Note>

## Prerequisites

- A Coolify instance and a server attached to it
- A domain or subdomain pointed at that server

## 1. Create the resource

**New Resource → Docker Compose**, connect this repository (a public repository needs no GitHub App), then set:

| Field | Value |
| --- | --- |
| Base Directory | `/` |
| Docker Compose Location | `/deploy/coolify/docker-compose.yml` |

Leave Base Directory at the repository root. The compose file builds Postgres from `deploy/Dockerfile.postgres`, whose build context is the root.

## 2. Environment variables

Set these under **Environment Variables**. Generate each secret with `openssl rand -hex 32`:

```env
JWT_SECRET=<32+ characters>
ENCRYPTION_KEY=<32+ characters, different from JWT_SECRET>
POSTGRES_PASSWORD=<strong password>
ROOT_ADMIN_USERNAME=admin
ROOT_ADMIN_PASSWORD=<strong password>
```

`ENCRYPTION_KEY` falls back to `JWT_SECRET` when unset, and rotating `JWT_SECRET` afterwards makes every stored secret impossible to decrypt — set it to its own value now.

Postgres reads `POSTGRES_PASSWORD` only when it initializes the cluster. Changing it later does not change the database password.

Everything else is optional; [`.env.example`](https://github.com/insforge/insforge/blob/main/.env.example) lists every supported variable with its default.

## 3. Assign a domain

Coolify does not expose a compose service that publishes no ports. Under the resource's **insforge** service, assign your domain and set the port to `7130`, then add the matching URLs to the environment:

```env
API_BASE_URL=https://insforge.example.com
VITE_API_BASE_URL=https://insforge.example.com
```

These have to match the URL browsers use, or the dashboard will call the wrong origin.

Only `insforge` needs a domain. Postgres, PostgREST and the Deno runtime stay on the internal network.

## 4. Deploy

Press **Deploy**. The first run builds two small images (Postgres and the Deno function host) and pulls the rest, then runs the backend's migrations automatically.

Open your domain and sign in with `ROOT_ADMIN_USERNAME` / `ROOT_ADMIN_PASSWORD`.

## Updating

Coolify redeploys on push if you enabled automatic deployment, or press **Redeploy**. Each deploy rebuilds the Postgres and Deno images from the current commit, so their configuration and function host track the release.

Review the diff for `.env.example` before updating — a release that adds a variable will not add it to your Coolify environment.

## Storage

Object storage defaults to the container filesystem on a Docker volume. For S3, MinIO or RustFS, see [Self-Hosted Storage](./self-host-storage.mdx) and set the `S3_*` variables in Coolify's environment; the compose file passes them through.

## Why Postgres is built rather than pulled

InsForge's Postgres needs three files from this repository: `postgresql.conf`, which loads the `insforge_pg_utils` extension that row-level security on managed tables depends on, plus two init scripts.

Coolify creates file bind mounts as directories ([coollabsio/coolify#3375](https://github.com/coollabsio/coolify/issues/3375)), so mounting them is not an option — Postgres will not start. Building the image at deploy time puts the current files in it instead, which also means the configuration cannot fall behind the code the way a prebuilt image can.
