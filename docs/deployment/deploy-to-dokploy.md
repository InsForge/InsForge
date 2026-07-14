---
title: "Deploy InsForge to Dokploy"
description: "Run InsForge on a Dokploy server with the ready-made compose file: paste it, set a handful of environment variables, and attach a domain."
---

# Deploy InsForge to Dokploy

This guide walks through deploying InsForge on [Dokploy](https://dokploy.com), an open-source, self-hostable PaaS. The InsForge repo ships a compose file written for Dokploy, `docker-compose.dokploy.yml`. It uses prebuilt images and no `ports:` mappings, so Dokploy's proxy (Traefik) handles routing and TLS, and only the services you expose get a public URL.

<Note>
  This guide is community-maintained and can lag the latest InsForge release. The canonical, always-current setup is the `deploy/docker-compose/` directory in the [InsForge repo](https://github.com/InsForge/InsForge).
</Note>

## Prerequisites

- A running Dokploy instance. If you don't have one, the [Dokploy installation](https://docs.dokploy.com/docs/core/installation) is a one-line script on any Linux server.
- At least 2 vCPU and 4 GB RAM free for the InsForge stack, on top of what Dokploy itself uses.
- A domain with an A record pointing at the server, for the dashboard and API.

## Deployment

### 1. Create the compose service

1. In Dokploy, open a project and create a **Compose** service.
2. Point it at the InsForge repo (`https://github.com/InsForge/InsForge`, branch `main`, compose path `./docker-compose.dokploy.yml`), or choose the raw provider and paste the contents of [`docker-compose.dokploy.yml`](https://github.com/InsForge/InsForge/blob/main/docker-compose.dokploy.yml).

The file defines four services: `postgres`, `postgrest`, `insforge`, and `deno`.

### 2. Set environment variables

Open the **Environment** tab and set the required values:

```env
JWT_SECRET=<32+ char random string, e.g. `openssl rand -base64 32`>
ENCRYPTION_KEY=<24+ char random string, e.g. `openssl rand -base64 24`>
POSTGRES_PASSWORD=<strong password>
ROOT_ADMIN_USERNAME=admin
ROOT_ADMIN_PASSWORD=<change this>

API_BASE_URL=https://<your-domain>
VITE_API_BASE_URL=https://<your-domain>
```

`API_BASE_URL` and `VITE_API_BASE_URL` must match the domain you attach in the next step. If they still point at `localhost`, the dashboard loads but every API call fails.

Optional variables (`OPENROUTER_API_KEY`, OAuth client IDs and secrets, Stripe keys, S3 credentials for the Deno runtime) are listed in the compose file and can be added the same way.

### 3. Attach a domain

Open the **Domains** tab and click **Add Domain**:

- **Service**: `insforge`
- **Container port**: `7130`
- **HTTPS**: enabled (Let's Encrypt)

Dokploy injects the Traefik labels at deploy time; the compose file needs no `ports:` mappings, and the database, PostgREST, and the Deno runtime stay internal to the container network.

### 4. Deploy

Click **Deploy**. Dokploy pulls the images (about 2 GB on first deploy) and starts the stack. Wait until all four services are running.

### 5. Verify

```bash
curl https://<your-domain>/api/health
```

Expected:

```json
{
  "status": "ok",
  "version": "2.x.x",
  "service": "Insforge OSS Backend",
  "timestamp": "..."
}
```

Then open `https://<your-domain>` in a browser and sign in with the admin credentials you set in step 2.

### 6. Connect your agent to InsForge MCP

Open the dashboard and follow the in-product flow to connect your MCP-compatible agent (Cursor, Claude Code, Windsurf, OpenCode, etc.) to the InsForge MCP server.

Verify the connection by sending this prompt to your agent:

```text
I'm using InsForge as my backend platform, call InsForge MCP's
fetch-docs tool to learn about InsForge instructions.
```

## Update InsForge

The compose file tracks the `latest` image tags. Redeploy the service; Dokploy pulls the newer images and recreates the containers. Database, storage, and logs live in named volumes and survive redeploys.

## Troubleshooting

### The dashboard loads but sign-in or API calls fail

`API_BASE_URL` doesn't match the URL in your browser. Fix it in the Environment tab so it matches the attached domain exactly (scheme included), then redeploy.

### The domain returns 502

The `insforge` container isn't up yet or the domain entry points at the wrong service or port. Check the service logs in Dokploy, and confirm the domain maps to service `insforge`, port `7130`.

### A service stays unhealthy

Check its logs in Dokploy. The most common cause on small servers is memory pressure: the stack needs about 3 GB resident at idle.

## Resources

- **Dokploy docs**: https://docs.dokploy.com
- **InsForge docs**: https://docs.insforge.dev
- **InsForge Discord**: https://discord.com/invite/MPxwj5xVvW

---

For other deployment strategies, see the [deployment guides](/deployment/deployment-security-guide).
