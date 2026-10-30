---
title: "Self-Host InsForge on Hetzner Cloud"
description: "Step-by-step guide to self-host the InsForge platform on a Hetzner Cloud VPS using Docker Compose, including firewall setup, domain config, and TLS termination."
---

# Self-Host InsForge on Hetzner Cloud

This guide walks through self-hosting the InsForge platform on a [Hetzner Cloud](https://www.hetzner.com/cloud) server using Docker Compose.

<Note>
  **This deploys InsForge itself, not the app you built.** If you just want to take your app live, use [Sites](/core-concepts/sites/overview) instead. This guide is for running the InsForge backend on your own infrastructure.
</Note>

<Note>
  This cloud walkthrough is community-maintained and can lag the latest InsForge release. The canonical, always-current setup is the `deploy/docker-compose/` directory in the [InsForge repo](https://github.com/InsForge/InsForge).
</Note>

## 📋 Prerequisites

- A [Hetzner Cloud](https://console.hetzner.cloud/) account and project
- An SSH key added to your Hetzner account **before** you create the server ([Hetzner docs](https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server))
- Basic familiarity with SSH and the command line
- A domain name (optional, but recommended for HTTPS in production)

## 🚀 Deployment Steps

### 1. Create a Hetzner Cloud Server

1. Open the [Hetzner Console](https://console.hetzner.cloud/), select your project, and go to **Servers** → **Add Server**.
2. Configure the server:

| Setting | Recommendation |
| --- | --- |
| **Location** | Any region that fits your users. EU locations include Falkenstein (`FSN1`), Nuremberg (`NBG1`), and Helsinki (`HEL1`). |
| **Image** | **Ubuntu 24.04** |
| **Type** | **CX23** (2 vCPU, 4 GB RAM, 40 GB disk) for testing, or **CX33** (4 vCPU, 8 GB RAM, 80 GB disk) for production. These are Hetzner [Cost-Optimized](https://www.hetzner.com/cloud/cost-optimized/) plans on shared x86 CPUs. |
| **Networking** | Enable a **Primary IPv4** address. IPv6 is optional and free. |
| **SSH key** | Select the key you uploaded earlier. |
| **Name** | e.g. `insforge-server` |

3. Optional add-ons:
   - **Backups** — daily automatic disk snapshots with seven rotating slots ([Hetzner docs](https://docs.hetzner.com/cloud/servers/getting-started/enabling-backups))
   - **Firewall** — you can attach one now or create it in the next step

4. Click **Create & Buy now**.

> 💡 **Plan note:** Hetzner also offers ARM-based **CAX** servers. InsForge publishes multi-arch images, but this guide assumes **CX** (x86) unless you have verified every container image pulls on your plan.

> 💡 **Pricing note:** Server prices depend on location and plan. A Primary IPv4 address is billed separately ([€0.50/month excluding VAT](https://docs.hetzner.com/cloud/servers/primary-ips/overview)). See [Hetzner Cloud pricing](https://www.hetzner.com/cloud) for current rates.

### 2. Configure a Hetzner Cloud Firewall

Hetzner Cloud Firewalls are free and filter traffic before it reaches your server ([overview](https://docs.hetzner.com/cloud/firewalls/getting-started/creating-a-firewall)).

1. In the console, go to **Firewalls** → **Create Firewall**.
2. Add **inbound** rules:

| Protocol | Port | Sources | Purpose |
| --- | --- | --- | --- |
| TCP | 22 | Your IP address | SSH |
| TCP | 80 | Any IPv4 / Any IPv6 | HTTP (for HTTPS redirect) |
| TCP | 443 | Any IPv4 / Any IPv6 | HTTPS (reverse proxy) |
| TCP | 7130 | Any IPv4 / Any IPv6 | Optional — direct API/dashboard access before you set up a reverse proxy |

3. Attach the firewall to your server under **Apply to**.
4. Click **Create Firewall**.

> ⚠️ **Do not open** ports 5432, 5430, or 7133. In the self-host compose file, PostgreSQL, PostgREST, and Deno bind to `127.0.0.1` on the host and are not meant to be reached from the internet. For production, put Nginx or Caddy in front of InsForge on port 443 and stop exposing 7130 publicly — see [Configure Domain](#6-configure-domain-optional-but-recommended) below and the [deployment security guide](/deployment/deployment-security-guide).

### 3. Connect to Your Server

Hetzner servers use `root` as the default SSH user ([connecting docs](https://docs.hetzner.com/cloud/servers/getting-started/connecting-to-the-server)):

```bash
ssh root@<your-server-ipv4>
```

Copy the IPv4 address from the server overview in the Hetzner Console.

### 4. Install Dependencies

#### 4.1 Update System Packages

```bash
apt update && apt upgrade -y
```

#### 4.2 Install Docker

Follow Docker's official Ubuntu install guide:

```text
https://docs.docker.com/engine/install/ubuntu/
```

Install the Docker Engine and the **Compose plugin** (`docker-compose-plugin`).

Verify:

```bash
docker --version
docker compose version
```

#### 4.3 Install Git

Git is required for the update path after the initial install:

```bash
apt install git -y
```

> 💡 **Shortcut:** Hetzner offers a [Docker CE app](https://docs.hetzner.com/cloud/apps/list/docker-ce/) that preinstalls Docker and the Compose plugin on Ubuntu 24.04. You can select it instead of a plain Ubuntu image if you prefer; the rest of this guide is the same.

### 5. Deploy InsForge

#### 5.1 Fetch the Self-Host Files

```bash
curl -fsSL https://raw.githubusercontent.com/InsForge/InsForge/main/deploy/setup.sh | sh -s ~/insforge
```

This sparse-checkouts the files the stack reads and writes `JWT_SECRET`, `ENCRYPTION_KEY`, `ROOT_ADMIN_PASSWORD`, `POSTGRES_PASSWORD`, and the API keys into `~/insforge/.env` (mode `600`). Nothing is started yet.

> Rather not pipe a script into a shell? Read it first:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/InsForge/InsForge/main/deploy/setup.sh -o setup.sh
> less setup.sh
> sh setup.sh ~/insforge
> ```

#### 5.2 Configure Environment

```bash
cd ~/insforge
nano .env
```

The secrets are already generated — leave them as they are. Set the URL browsers will use:

```env
API_BASE_URL=http://<your-server-ipv4>:7130
VITE_API_BASE_URL=http://<your-server-ipv4>:7130
```

Optional integrations (all off by default):

```env
OPENROUTER_API_KEY=      # AI features
VERCEL_TOKEN=            # site deployments
GOOGLE_CLIENT_ID=        # OAuth providers
GOOGLE_CLIENT_SECRET=
```

See `.env.example` for every supported variable.

> 💡 Back up `.env` somewhere safe. You need those secrets to migrate or restore this instance.

#### 5.3 Start Services

```bash
docker compose up -d
docker compose logs -f
```

Press `Ctrl+C` to exit the log view.

#### 5.4 Verify Services

```bash
docker compose ps
```

You should see four services — `postgres`, `postgrest`, `insforge`, and `deno`. Postgres and Deno report `healthy` when their health checks pass; PostgREST has no health check in this compose file and shows `running`.

### 6. Access Your InsForge Instance

#### 6.1 Test the API

```bash
curl http://<your-server-ipv4>:7130/api/health
```

You should get JSON with `"status": "ok"` and `"service": "Insforge OSS Backend"`.

#### 6.2 Open the Dashboard

In your browser:

```text
http://<your-server-ipv4>:7130
```

Log in with `ROOT_ADMIN_USERNAME` and `ROOT_ADMIN_PASSWORD` from `.env`.

### 7. Configure Domain (Optional but Recommended)

#### 7.1 DNS

Point a DNS **A record** at your server's IPv4 address:

```text
insforge.yourdomain.com  →  <your-server-ipv4>
```

If you use a [Floating IP](https://docs.hetzner.com/cloud/floating-ips/overview) instead of the server's Primary IP, point DNS at the floating address so you can move it between servers later.

#### 7.2 Reverse Proxy and TLS

Install Nginx:

```bash
apt install nginx -y
```

Create a site config:

```bash
nano /etc/nginx/sites-available/insforge
```

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name insforge.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:7130;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable it:

```bash
ln -s /etc/nginx/sites-available/insforge /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

Obtain a certificate with Certbot:

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d insforge.yourdomain.com
```

Update `.env` with your HTTPS URL:

```env
API_BASE_URL=https://insforge.yourdomain.com
VITE_API_BASE_URL=https://insforge.yourdomain.com
```

Restart InsForge:

```bash
cd ~/insforge
docker compose down
docker compose up -d
```

Remove the firewall rule for port **7130** once HTTPS works, so traffic only enters on 443.

For Caddy, UFW, SSH hardening, and more detail, see the [deployment security guide](/deployment/deployment-security-guide).

## 🔧 Management & Maintenance

### View Logs

```bash
cd ~/insforge
docker compose logs -f
docker compose logs -f insforge
```

### Stop or Restart

```bash
docker compose down
docker compose restart
```

### Update InsForge

The stack reads Postgres configuration and Deno function sources from this checkout, so updates are more than an image pull:

```bash
cd ~/insforge
git pull origin main
sh deploy/setup.sh .
docker compose pull && docker compose up -d
```

### Backup Database

```bash
cd ~/insforge
docker compose exec postgres pg_dump -U postgres insforge > backup_$(date +%Y%m%d_%H%M%S).sql
```

Restore:

```bash
cat backup_file.sql | docker compose exec -T postgres psql -U postgres -d insforge
```

Hetzner **Backups** (if enabled) snapshot the whole disk. They complement — but do not replace — logical `pg_dump` backups.

### Monitor Resources

```bash
df -h
free -h
docker stats
```

## 🐛 Troubleshooting

### Services Will Not Start

```bash
docker compose logs
df -h
free -h
systemctl restart docker
docker compose up -d
```

### Cannot Reach the Dashboard

- Confirm the Hetzner Firewall allows the port you are using (7130 or 443).
- Check `API_BASE_URL` and `VITE_API_BASE_URL` match how you open the site in your browser.
- Run `curl http://localhost:7130/api/health` on the server. If that works but the public URL does not, the issue is firewall or DNS — not InsForge.

### Out of Memory

Resize to a larger plan in the Hetzner Console (**Rescale**), for example from **CX23** to **CX33**.

## 🔒 Security Best Practices

1. Restrict SSH (port 22) to your IP in the Hetzner Firewall.
2. Use HTTPS in production and stop exposing port 7130 publicly once a reverse proxy is in place.
3. Keep `.env` at mode `600` and back it up securely.
4. Run `apt upgrade` regularly and pull new InsForge images when you update.
5. See the [deployment security guide](/deployment/deployment-security-guide) for UFW, SSH hardening, and automated backups.

## 🆘 Support & Resources

- **InsForge docs**: [https://docs.insforge.dev](https://docs.insforge.dev)
- **Hetzner docs**: [https://docs.hetzner.com/cloud/](https://docs.hetzner.com/cloud/)
- **GitHub Issues**: [https://github.com/InsForge/InsForge/issues](https://github.com/InsForge/InsForge/issues)
- **Discord**: [https://discord.com/invite/MPxwj5xVvW](https://discord.com/invite/MPxwj5xVvW)

## 📝 Cost Notes

Hetzner bills each server hourly with a monthly price cap. Prices vary by **plan** and **location**. In addition to the server:

- **Primary IPv4** — [€0.50/month excluding VAT](https://docs.hetzner.com/cloud/servers/primary-ips/overview) per address
- **Backups** — optional add-on at checkout
- **Outgoing traffic** — EU Cost-Optimized plans include [20 TB/month](https://docs.hetzner.com/robot/general/traffic/); only outbound traffic counts toward the quota

Check [hetzner.com/cloud](https://www.hetzner.com/cloud) for current plan prices before you deploy.

---

**Congratulations!** Your InsForge instance is running on Hetzner Cloud. For hardening, backups, and rollback procedures, see the [deployment security guide](/deployment/deployment-security-guide).
