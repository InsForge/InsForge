---
title: "Deploy InsForge to Coolify"
description: "Run InsForge on a Coolify server by pasting one compose file. Coolify generates the secrets, assigns the domain, and terminates TLS for you."
---

# Deploy InsForge to Coolify

This guide walks through deploying InsForge on [Coolify](https://coolify.io), an open-source, self-hostable PaaS. The InsForge repo ships a compose file written for Coolify, `docker-compose.coolify.yml`. It uses Coolify's magic environment variables, so all secrets (database password, JWT secret, encryption key, admin password) are generated for you and the public URL is wired into the stack automatically. There is nothing to fill in by hand.

<Note>
  This guide is community-maintained and can lag the latest InsForge release. The canonical, always-current setup is the `deploy/docker-compose/` directory in the [InsForge repo](https://github.com/InsForge/InsForge).
</Note>

## Prerequisites

- A running Coolify v4 instance. If you don't have one, the [Coolify installation](https://coolify.io/docs/get-started/installation) is a one-line script on any Linux server.
- At least 2 vCPU and 4 GB RAM free for the InsForge stack, on top of what Coolify itself uses.
- Optional: a domain with an A record pointing at the server. Without one, Coolify assigns a working `sslip.io` URL based on the server IP.

## Deployment

### 1. Create the service

1. In Coolify, open a project and click **Add Resource**.
2. Choose **Docker Compose Empty**.
3. Paste the contents of [`docker-compose.coolify.yml`](https://github.com/InsForge/InsForge/blob/main/docker-compose.coolify.yml) into the editor and click **Save**.

Coolify parses the file into four services: `postgres`, `postgrest`, `insforge`, and `deno`.

### 2. Review the generated configuration

On the service's Configuration page, Coolify has already:

- Generated random values for `SERVICE_PASSWORD_POSTGRES`, `SERVICE_PASSWORD_64_JWTSECRET`, `SERVICE_PASSWORD_ENCRYPTIONKEY`, and `SERVICE_PASSWORD_ADMIN`. The same variable resolves to the same value in every service, so PostgREST and the Deno runtime share the backend's JWT secret.
- Assigned a URL to the `insforge` service and injected it as `API_BASE_URL` and `VITE_API_BASE_URL`.

The dashboard login is `admin` plus the generated `SERVICE_PASSWORD_ADMIN`; read its value from the Environment Variables tab.

Optional variables (`OPENROUTER_API_KEY`, OAuth client IDs and secrets, Stripe keys, S3 credentials for the Deno runtime) also appear in the Environment Variables tab. Leave them empty unless you use those features.

### 3. Set your domain (optional)

The `insforge` service gets a generated `sslip.io` domain by default. To use your own, open the `insforge` service settings inside the stack and change the **Domains** field, keeping the container port suffix:

```text
https://insforge.example.com:7130
```

The `:7130` tells Coolify's proxy which container port to route to; it is not part of the public URL. With a real domain and HTTPS, Coolify provisions the certificate via Let's Encrypt automatically. `API_BASE_URL` follows the domain, so change it before the first deploy if possible; if you change it later, redeploy.

The compose file has no `ports:` mappings on purpose. Coolify's proxy (Traefik) routes to the container network directly, and the database, PostgREST, and the Deno runtime stay internal.

### 4. Deploy

Click **Deploy**. Coolify pulls the images (about 2 GB on first deploy) and starts the stack. All four services report healthy when ready.

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

Then open `https://<your-domain>` in a browser and sign in with `admin` and the generated `SERVICE_PASSWORD_ADMIN`.

### 6. Connect your agent to InsForge MCP

Open the dashboard and follow the in-product flow to connect your MCP-compatible agent (Cursor, Claude Code, Windsurf, OpenCode, etc.) to the InsForge MCP server.

Verify the connection by sending this prompt to your agent:

```text
I'm using InsForge as my backend platform, call InsForge MCP's
fetch-docs tool to learn about InsForge instructions.
```

## Update InsForge

The compose file tracks the `latest` image tags. To update, click **Redeploy**; Coolify pulls the newer images and recreates the containers. Database, storage, and logs live in named volumes and survive redeploys.

## Troubleshooting

### The dashboard loads but sign-in or API calls fail

`API_BASE_URL` no longer matches the URL in your browser, usually after a domain change. Confirm the domain on the `insforge` service, then redeploy so the new value reaches the container.

### I can't find the admin password

Coolify generates it. Open the service's Environment Variables tab and reveal `SERVICE_PASSWORD_ADMIN`.

### A service stays unhealthy

Open the service's Logs tab in Coolify. The most common cause on small servers is memory pressure: the stack needs about 3 GB resident at idle.

## Resources

- **Coolify docs**: https://coolify.io/docs
- **InsForge docs**: https://docs.insforge.dev
- **InsForge Discord**: https://discord.com/invite/MPxwj5xVvW

---

For other deployment strategies, see the [deployment guides](/deployment/deployment-security-guide).
