---
title: "Self-Host InsForge on Dokploy"
description: "Self-host InsForge on Dokploy as a Compose application, with the Postgres image built from the repo so its config always matches the release."
---

# Self-Host InsForge on Dokploy

This guide walks through self-hosting the InsForge platform on [Dokploy](https://dokploy.com), an open-source PaaS you run on your own server.

<Note>
  **This deploys InsForge itself, not the app you built.** If you just want to take your app live, use [Sites](/core-concepts/sites/overview) instead.
</Note>

## Prerequisites

- A Dokploy instance
- A domain or subdomain pointed at that server

## 1. Create the application

**Create → Compose**, connect this repository as the provider, then set:

| Field | Value |
| --- | --- |
| Compose Path | `deploy/dokploy/docker-compose.yml` |
| Compose Type | Docker Compose |

## 2. Environment variables

Set these under **Environment**. Generate each secret with `openssl rand -hex 32`:

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

## 3. Add a domain

Nothing is published to the host, so the stack is only reachable once you route to it. Under **Domains**, add your domain with:

| Field | Value |
| --- | --- |
| Service Name | `insforge` |
| Container Port | `7130` |

Then add the matching URLs to the environment:

```env
API_BASE_URL=https://insforge.example.com
VITE_API_BASE_URL=https://insforge.example.com
```

These have to match the URL browsers use, or the dashboard will call the wrong origin.

Only `insforge` needs a domain. Postgres, PostgREST and the Deno runtime stay on Dokploy's internal network.

## 4. Deploy

Press **Deploy**. The first run builds two small images (Postgres and the Deno function host) and pulls the rest, then runs the backend's migrations automatically.

Open your domain and sign in with `ROOT_ADMIN_USERNAME` / `ROOT_ADMIN_PASSWORD`.

## Updating

Press **Deploy** again, or enable Auto Deploy to redeploy on push. Each deploy rebuilds the Postgres and Deno images from the current commit, so their configuration and function host track the release.

Review the diff for `.env.example` before updating — a release that adds a variable will not add it to your Dokploy environment.

## Storage

Object storage defaults to the container filesystem on a Docker volume. Dokploy takes a single compose file, so the MinIO and RustFS overlays do not apply; see [Self-Hosted Storage](./self-host-storage.mdx) for the two options that do.

## Why Postgres is built rather than pulled

InsForge's Postgres needs three files from this repository: `postgresql.conf`, which loads the `insforge_pg_utils` extension that row-level security on managed tables depends on, plus two init scripts.

Dokploy re-clones `code/` on every deploy, so a bind mount pointing into the repository goes stale — [its docs](https://docs.dokploy.com/docs/core/troubleshooting/volumes-mounts) require File Mounts created in the UI and referenced as `../files/`, which is manual setup for every install. Building the image at deploy time puts the current files in it instead, with nothing to configure, and the configuration cannot fall behind the code the way a prebuilt image can.
