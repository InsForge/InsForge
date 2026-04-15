# Deployment & Security Guide for VPS Installation

This comprehensive guide covers deploying InsForge on a generic VPS (Virtual Private Server) for production, hardening your instance with security best practices, and maintaining it over time with safe updates and rollback procedures.

> **Scope**: This guide is provider-agnostic. It works on any Linux VPS — Ubuntu/Debian recommended — from providers such as DigitalOcean, Hetzner, Linode, Vultr, OVH, or a bare-metal server. For cloud-specific guides (AWS EC2, GCP, Azure, Render), see the [deployment directory](./README.md).

---

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [Part 1 — Deployment](#part-1--deployment)
  - [Server Requirements](#1-server-requirements)
  - [Initial Server Setup](#2-initial-server-setup)
  - [Install Docker & Docker Compose](#3-install-docker--docker-compose)
  - [Deploy InsForge with Docker Compose](#4-deploy-insforge-with-docker-compose)
  - [Environment Variable Configuration](#5-environment-variable-configuration)
  - [Reverse Proxy Setup](#6-reverse-proxy-setup)
  - [HTTPS / TLS Setup](#7-https--tls-setup)
- [Part 2 — Security](#part-2--security)
  - [Port Management](#8-port-management)
  - [Firewall Setup (UFW)](#9-firewall-setup-ufw)
  - [Run Services as a Non-Root User](#10-run-services-as-a-non-root-user)
  - [SSH Hardening](#11-ssh-hardening)
  - [Docker Security](#12-docker-security)
  - [Secrets Management](#13-secrets-management)
- [Part 3 — Updating & Maintenance](#part-3--updating--maintenance)
  - [Pre-Update Backup](#14-pre-update-backup)
  - [Updating InsForge](#15-updating-insforge)
  - [Rollback Procedure](#16-rollback-procedure)
  - [Automated Backups](#17-automated-backups)
  - [Monitoring & Health Checks](#18-monitoring--health-checks)
- [Quick Reference](#quick-reference)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before starting, ensure you have:

- A VPS running **Ubuntu 22.04 LTS** or **Ubuntu 24.04 LTS** (Debian 12 also works)
- **Root or sudo access** to the server
- A registered **domain name** (recommended for production)
- Basic familiarity with the Linux command line and SSH

---

## Part 1 — Deployment

### 1. Server Requirements

| Resource      | Minimum        | Recommended     |
|---------------|----------------|-----------------|
| **CPU**       | 2 vCPU         | 4 vCPU          |
| **RAM**       | 2 GB           | 4 GB+           |
| **Storage**   | 20 GB SSD      | 40 GB+ SSD      |
| **OS**        | Ubuntu 22.04+  | Ubuntu 24.04 LTS|
| **Network**   | Public IPv4    | Public IPv4 + IPv6 |

> 💡 **Tip**: For production workloads with multiple users, start with 4 GB RAM. Monitor usage with `docker stats` and scale vertically as needed.

InsForge consists of **4 services** that run together:

| Service       | Description                        | Internal Port |
|---------------|------------------------------------|---------------|
| **PostgreSQL**| Primary database                   | 5432          |
| **PostgREST** | Auto-generated REST API layer      | 3000 (mapped to 5430) |
| **InsForge**  | Node.js backend + dashboard        | 7130, 7131    |
| **Deno**      | Serverless functions runtime       | 7133          |

---

### 2. Initial Server Setup

#### 2.1 Connect to Your VPS

```bash
ssh root@your-server-ip
```

#### 2.2 Update System Packages

```bash
apt update && apt upgrade -y
```

#### 2.3 Create a Deploy User (Non-Root)

Never run production services as root. Create a dedicated user:

```bash
# Create the deploy user and add to sudo group
adduser deploy
usermod -aG sudo deploy

# Switch to the deploy user
su - deploy
```

#### 2.4 Set the Timezone

```bash
sudo timedatectl set-timezone UTC
```

#### 2.5 Enable Automatic Security Updates

```bash
sudo apt install unattended-upgrades -y
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

### 3. Install Docker & Docker Compose

#### 3.1 Install Docker Engine

```bash
# Add Docker's official GPG key
sudo apt install ca-certificates curl gnupg -y
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add the Docker repository
echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y
```

#### 3.2 Add Deploy User to the Docker Group

```bash
sudo usermod -aG docker deploy
newgrp docker
```

#### 3.3 Verify Docker Installation

```bash
docker --version
docker compose version
docker run hello-world
```

> ⚠️ **Security Note**: Adding a user to the `docker` group grants root-equivalent privileges on the host. This is acceptable for a dedicated deploy user but should not be done for general-purpose accounts on shared servers.

---

### 4. Deploy InsForge with Docker Compose

#### 4.1 Download the Production Docker Compose File

```bash
mkdir -p ~/insforge && cd ~/insforge

# Download the production-ready Docker Compose file and environment template
wget https://raw.githubusercontent.com/insforge/insforge/main/deploy/docker-compose/docker-compose.yml
wget https://raw.githubusercontent.com/insforge/insforge/main/deploy/docker-compose/.env.example

# Create your environment file
cp .env.example .env
```

#### 4.2 Start InsForge

```bash
docker compose up -d
```

#### 4.3 Verify All Services Are Running

```bash
docker compose ps
```

You should see 4 containers in a `running` or `healthy` state:

```text
NAME            SERVICE     STATUS
insforge        insforge    running
postgres        postgres    healthy
postgrest       postgrest   healthy
deno            deno        running
```

#### 4.4 Test the Health Endpoint

```bash
curl http://localhost:7130/api/health
```

Expected response:

```json
{
  "status": "ok",
  "version": "1.x.x",
  "service": "Insforge OSS Backend",
  "timestamp": "2026-..."
}
```

---

### 5. Environment Variable Configuration

Edit your `.env` file to configure InsForge for production:

```bash
nano ~/insforge/.env
```

#### 5.1 Required Variables

These **must** be changed from defaults before going to production:

```env
# ── Security (CRITICAL — generate unique values) ──────────────
JWT_SECRET=<output of: openssl rand -base64 32>
ENCRYPTION_KEY=<output of: openssl rand -base64 24>
ADMIN_EMAIL=you@yourdomain.com
ADMIN_PASSWORD=<strong-unique-password>

# ── Public URL (must match your domain/IP) ────────────────────
API_BASE_URL=https://insforge.yourdomain.com
VITE_API_BASE_URL=https://insforge.yourdomain.com
```

Generate secure secrets right from the terminal:

```bash
# JWT secret (32+ characters)
openssl rand -base64 32

# Encryption key (separate from JWT_SECRET)
openssl rand -base64 24

# Admin password
openssl rand -base64 18
```

> ⚠️ **Important**: `JWT_SECRET` and `ENCRYPTION_KEY` should be **different** values. If `ENCRYPTION_KEY` is not set, InsForge falls back to `JWT_SECRET` — but rotating `JWT_SECRET` later will permanently corrupt all stored secrets (API keys, OAuth tokens, etc.).

#### 5.2 Database Variables

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<strong-unique-password>
POSTGRES_DB=insforge
```

#### 5.3 Port Variables

Default ports used by InsForge:

```env
POSTGRES_PORT=5432
POSTGREST_PORT=5430
APP_PORT=7130
AUTH_PORT=7131
DENO_PORT=7133
```

> 💡 You can change these if they conflict with other services on your VPS.

#### 5.4 Required for Deployments

These variables are only needed if you plan to use InsForge's **deployment features** (deploying projects via the dashboard). If you don't need deployments, skip this section.

```env
# ── Deployments ──────────────────────────────────────────────
# S3 bucket for legacy zip deployment uploads.
# Direct uploads use the backend proxy, but POST /api/deployments still requires S3.
AWS_S3_BUCKET=your-deployment-bucket
AWS_REGION=us-east-2
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# Project ID used by OpenRouter AI token renewal and Vercel deployments
PROJECT_ID=your-project-id
```

#### 5.5 Optional Variables

```env
# ── OAuth Providers ───────────────────────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
X_CLIENT_ID=
X_CLIENT_SECRET=
APPLE_CLIENT_ID=
APPLE_CLIENT_SECRET=

# ── AI / LLM ─────────────────────────────────────────────────
OPENROUTER_API_KEY=

# ── Storage (S3-compatible — leave empty for local storage) ──
# For general file storage only (not deployments). If omitted, local
# filesystem storage is used automatically.
AWS_S3_BUCKET=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# ── Deno Functions ────────────────────────────────────────────
WORKER_TIMEOUT_MS=60000
```

After editing, restart services to apply changes:

```bash
cd ~/insforge
docker compose down
docker compose up -d
```

---

### 6. Reverse Proxy Setup

A reverse proxy sits in front of InsForge, providing TLS termination, HTTP/2, and a clean URL without port numbers.

#### Option A: Nginx (Recommended)

##### 6.1 Install Nginx

```bash
sudo apt install nginx -y
```

##### 6.2 Create the Site Configuration

```bash
sudo nano /etc/nginx/sites-available/insforge
```

Paste the following configuration — replace `insforge.yourdomain.com` with your actual domain:

```nginx
# ── InsForge Backend + Dashboard ──────────────────────────────
server {
    listen 80;
    listen [::]:80;
    server_name insforge.yourdomain.com;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Max upload size (match MAX_FILE_SIZE in .env, default 50 MB)
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:7130;
        proxy_http_version 1.1;

        # WebSocket support (required for Realtime features)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts for long-running requests (e.g., AI completions)
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

##### 6.3 Enable the Site

```bash
sudo ln -s /etc/nginx/sites-available/insforge /etc/nginx/sites-enabled/

# Remove the default site (optional)
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

#### Option B: Caddy (Automatic HTTPS)

Caddy is a simpler alternative that handles TLS certificates automatically.

##### Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy -y
```

##### Configure Caddy

```bash
sudo nano /etc/caddy/Caddyfile
```

```caddyfile
insforge.yourdomain.com {
    reverse_proxy localhost:7130

    header {
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        X-XSS-Protection "1; mode=block"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    request_body {
        max_size 50MB
    }
}
```

```bash
sudo systemctl reload caddy
```

Caddy will automatically obtain and renew Let's Encrypt certificates — no extra steps needed.

---

### 7. HTTPS / TLS Setup

> If you chose **Caddy** in Step 6, TLS is already handled automatically. Skip to [Part 2](#part-2--security).

#### 7.1 Install Certbot (for Nginx)

```bash
sudo apt install certbot python3-certbot-nginx -y
```

#### 7.2 Obtain SSL Certificates

```bash
sudo certbot --nginx -d insforge.yourdomain.com
```

Follow the interactive prompts. Certbot will:
1. Verify domain ownership via HTTP challenge
2. Obtain a signed certificate from Let's Encrypt
3. Automatically update your Nginx configuration to serve HTTPS
4. Set up HTTP → HTTPS redirect

#### 7.3 Verify Auto-Renewal

Let's Encrypt certificates expire every 90 days. Certbot installs a systemd timer for automatic renewal:

```bash
# Test renewal (dry run — no actual renewal)
sudo certbot renew --dry-run

# Check the timer is active
sudo systemctl status certbot.timer
```

#### 7.4 Update InsForge Environment for HTTPS

After obtaining your certificate, update your `.env` to use HTTPS URLs:

```bash
cd ~/insforge
nano .env
```

```env
API_BASE_URL=https://insforge.yourdomain.com
VITE_API_BASE_URL=https://insforge.yourdomain.com
```

Restart InsForge to apply:

```bash
docker compose down
docker compose up -d
```

---

## Part 2 — Security

### 8. Port Management

#### Ports That Should Be Open (via Reverse Proxy)

| Port | Protocol | Purpose                     |
|------|----------|-----------------------------|
| 22   | TCP      | SSH (restrict source IP)    |
| 80   | TCP      | HTTP → HTTPS redirect       |
| 443  | TCP      | HTTPS (reverse proxy)       |

#### Ports That Should Be Closed to the Public

These ports are used **only** for internal Docker service-to-service communication. They should **never** be exposed to the internet:

| Port  | Service     | Why Close It                                     |
|-------|-------------|--------------------------------------------------|
| 5432  | PostgreSQL  | Direct DB access — use `docker exec` instead     |
| 5430  | PostgREST   | Internal REST layer — proxied through InsForge   |
| 7130  | InsForge    | Accessed via reverse proxy on 443, not directly  |
| 7131  | Auth        | Internal auth service                            |
| 7133  | Deno        | Internal serverless runtime                      |

> ⚠️ **Critical**: The default `docker-compose.yml` binds ports to `0.0.0.0` (all interfaces), **not** `127.0.0.1`. This means Docker will expose services directly to the internet, **bypassing UFW entirely** (Docker manipulates iptables directly). You **MUST** add the `127.0.0.1:` prefix to every published port in your `docker-compose.yml`:
>
> ```yaml
> ports:
>   - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"     # PostgreSQL
>   - "127.0.0.1:${POSTGREST_PORT:-5430}:3000"     # PostgREST
>   - "127.0.0.1:${APP_PORT:-7130}:7130"            # InsForge
>   - "127.0.0.1:${AUTH_PORT:-7131}:7131"           # Auth
>   - "127.0.0.1:${DENO_PORT:-7133}:7133"           # Deno
> ```
>
> Without this prefix, anyone on the internet can reach these services directly — including PostgreSQL with default credentials. See [Section 9.2](#92-docker-and-ufw-caveat) for details.

---

### 9. Firewall Setup (UFW)

UFW (Uncomplicated Firewall) is the simplest way to manage iptables on Ubuntu.

#### 9.1 Install and Configure UFW

```bash
# Install UFW (usually pre-installed on Ubuntu)
sudo apt install ufw -y

# Default policy: deny all incoming, allow all outgoing
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH (CRITICAL — do this BEFORE enabling UFW!)
sudo ufw allow OpenSSH

# Allow HTTP and HTTPS (for reverse proxy)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Enable the firewall
sudo ufw enable

# Verify rules
sudo ufw status verbose
```

Expected output:

```text
Status: active

To                         Action      From
--                         ------      ----
OpenSSH                    ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
```

> ⚠️ **Critical**: Always allow SSH **before** enabling UFW, or you will lock yourself out of the server.

#### 9.2 Docker and UFW Caveat

Docker manipulates iptables directly, which can **bypass UFW rules**. To prevent this:

**Option 1 — Bind ports to localhost** (recommended):

In your `docker-compose.yml`, prefix ports with `127.0.0.1:`:

```yaml
ports:
  - "127.0.0.1:7130:7130"
  - "127.0.0.1:7131:7131"
```

**Option 2 — Disable Docker's iptables management**:

```bash
sudo nano /etc/docker/daemon.json
```

```json
{
  "iptables": false
}
```

```bash
sudo systemctl restart docker
```

> ⚠️ Disabling Docker iptables requires manual network configuration. **Option 1 is preferred** for most setups.

#### 9.3 Restrict SSH to Your IP (Optional)

For maximum security, restrict SSH access to a known IP address:

```bash
# Remove the broad SSH rule
sudo ufw delete allow OpenSSH

# Allow SSH only from your IP
sudo ufw allow from YOUR_IP_ADDRESS to any port 22 proto tcp

# Verify
sudo ufw status
```

---

### 10. Run Services as a Non-Root User

InsForge's Docker image already follows non-root best practices:

- The production Dockerfile sets `USER node` (UID 1000), so the application process inside the container runs as a non-root user.
- System-level Docker operations are managed by the `deploy` user (created in [Step 2.3](#23-create-a-deploy-user-non-root)), which has access to the Docker socket via the `docker` group.

**Verify the container user:**

```bash
docker compose exec insforge whoami
# Expected output: node
```

**Additional hardening:**

Add `security_opt` to each service in your `docker-compose.yml` to prevent privilege escalation:

```yaml
# Add to each service in docker-compose.yml
security_opt:
  - no-new-privileges:true
```

---

### 11. SSH Hardening

#### 11.1 Use SSH Key Authentication

```bash
# On your LOCAL machine — generate a key pair if you don't have one
ssh-keygen -t ed25519 -C "deploy@insforge"

# Copy the public key to your server
ssh-copy-id -i ~/.ssh/id_ed25519.pub deploy@your-server-ip
```

#### 11.2 Disable Password Authentication

Once key-based auth is confirmed working:

```bash
sudo nano /etc/ssh/sshd_config
```

Set the following:

```ini
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
```

Restart SSH:

```bash
sudo systemctl restart sshd
```

#### 11.3 Install Fail2Ban

Fail2Ban automatically bans IPs that show malicious activity (e.g., brute-force SSH):

```bash
sudo apt install fail2ban -y

# Create a local config (survives updates)
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
sudo nano /etc/fail2ban/jail.local
```

Add or ensure these settings are present:

```ini
[sshd]
enabled = true
port = ssh
filter = sshd
maxretry = 5
bantime = 3600
findtime = 600
```

```bash
sudo systemctl enable fail2ban
sudo systemctl restart fail2ban

# Check banned IPs
sudo fail2ban-client status sshd
```

---

### 12. Docker Security

#### 12.1 Keep Docker Updated

```bash
sudo apt update
sudo apt upgrade docker-ce docker-ce-cli containerd.io -y
```

#### 12.2 Limit Container Resources (Optional)

Prevent a single container from consuming all resources:

```yaml
# Add to any service in docker-compose.yml
deploy:
  resources:
    limits:
      memory: 2G
      cpus: '1.0'
    reservations:
      memory: 512M
```

#### 12.3 Read-Only Root Filesystem (Advanced)

For extra hardening, mount the container filesystem as read-only where possible:

```yaml
read_only: true
tmpfs:
  - /tmp
```

> ⚠️ This requires testing — some services need writable directories for caches or temporary files.

---

### 13. Secrets Management

#### Do ✅

- Store secrets in the `.env` file with `chmod 600 ~/insforge/.env`
- Use separate values for `JWT_SECRET` and `ENCRYPTION_KEY`
- Generate secrets with `openssl rand -base64 32`
- Back up your `.env` file to a secure, offline location

#### Don't ❌

- Commit `.env` to version control
- Reuse the same secret for multiple variables
- Use default passwords (`change-this-password`, `postgres`) in production
- Share secrets over unencrypted channels

---

## Part 3 — Updating & Maintenance

### 14. Pre-Update Backup

**Always back up before updating.** This gives you a recovery path if anything goes wrong.

#### 14.1 Back Up the Database

```bash
cd ~/insforge
source .env

# Create a timestamped database backup
docker compose exec -T postgres pg_dump \
  -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-insforge}" \
  > backup_$(date +%Y%m%d_%H%M%S).sql

# Verify size is reasonable
ls -lh backup_*.sql
```

#### 14.2 Back Up Environment and Volumes

```bash
# Back up .env file
cp .env .env.backup_$(date +%Y%m%d)

# Back up Docker volumes (optional but recommended)
docker run --rm \
  -v insforge_postgres-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/volumes_postgres_$(date +%Y%m%d_%H%M%S).tar.gz /data
```

#### 14.3 Record Current Version

```bash
# Note the current image versions before updating
docker compose images
```

---

### 15. Updating InsForge

#### 15.1 Pull the Latest Images

```bash
cd ~/insforge

# Pull the latest versions
docker compose pull
```

#### 15.2 Apply the Update

```bash
# Stop current services, start with new images
docker compose down
docker compose up -d

# Watch logs for errors during startup
docker compose logs -f --tail=50
```

Press `Ctrl+C` to stop following logs.

#### 15.3 Verify the Update

```bash
# Check all services are healthy
docker compose ps

# Test the health endpoint
curl http://localhost:7130/api/health

# Check the version in the response
```

#### 15.4 Update the Docker Compose File (If Needed)

Occasionally, new releases may include changes to `docker-compose.yml`. To pick up these changes:

```bash
cd ~/insforge

# Download the updated compose file
wget -O docker-compose.yml.new \
  https://raw.githubusercontent.com/insforge/insforge/main/deploy/docker-compose/docker-compose.yml

# Compare with your current file
diff docker-compose.yml docker-compose.yml.new

# If changes look safe, apply them
mv docker-compose.yml docker-compose.yml.old
mv docker-compose.yml.new docker-compose.yml

# Restart with the new configuration
docker compose down
docker compose up -d
```

---

### 16. Rollback Procedure

If an update causes issues, follow these steps to revert:

#### 16.1 Stop the Broken Services

```bash
cd ~/insforge
docker compose down
```

#### 16.2 Restore the Previous Docker Compose File

```bash
# If you saved the old file
mv docker-compose.yml.old docker-compose.yml
```

#### 16.3 Pin to a Specific Image Version

Edit `docker-compose.yml` and replace `latest` tags with the previous version:

```yaml
# Example: pin to a known-good version
image: ghcr.io/insforge/insforge-oss:v1.4.0
```

#### 16.4 Restore the Database (If Needed)

Only restore the database if the update included a database migration that caused issues:

```bash
cd ~/insforge
source .env

# Start only PostgreSQL
docker compose up -d postgres

# Wait for it to be healthy
docker compose exec postgres pg_isready -U "${POSTGRES_USER:-postgres}"

# Restore from backup
cat backup_YYYYMMDD_HHMMSS.sql | \
  docker compose exec -T postgres psql \
  -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-insforge}"

# Start remaining services
docker compose up -d
```

#### 16.5 Restore Environment File (If Changed)

```bash
cp .env.backup_YYYYMMDD .env
docker compose down
docker compose up -d
```

---

### 17. Automated Backups

Set up a cron job for daily automated backups:

#### 17.1 Create a Backup Script

```bash
nano ~/insforge/backup.sh
```

```bash
#!/bin/bash
set -euo pipefail

# InsForge Automated Backup Script
# Load .env so POSTGRES_USER / POSTGRES_DB are available outside Docker Compose
set -a
source "$HOME/insforge/.env"
set +a

BACKUP_DIR="$HOME/insforge/backups"
RETENTION_DAYS=14
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

trap 'echo "[$(date)] ERROR: Backup failed at line $LINENO" >&2; exit 1' ERR

mkdir -p "$BACKUP_DIR"

# Dump the database
docker compose -f "$HOME/insforge/docker-compose.yml" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-insforge}" \
  > "$BACKUP_DIR/db_$TIMESTAMP.sql"

# Copy the environment file
cp "$HOME/insforge/.env" "$BACKUP_DIR/env_$TIMESTAMP.bak"

# Remove backups older than retention period
find "$BACKUP_DIR" -name "db_*.sql" -mtime +$RETENTION_DAYS -delete
find "$BACKUP_DIR" -name "env_*.bak" -mtime +$RETENTION_DAYS -delete

echo "[$(date)] Backup completed successfully: db_$TIMESTAMP.sql"
```

```bash
chmod +x ~/insforge/backup.sh
```

#### 17.2 Schedule with Cron

```bash
crontab -e
```

Add this line for daily backups at 3:00 AM:

```cron
0 3 * * * /home/deploy/insforge/backup.sh >> /home/deploy/insforge/backups/cron.log 2>&1
```

#### 17.3 Off-Site Backups (Recommended)

For disaster recovery, copy backups to an external location:

```bash
# Example: sync backups to S3-compatible storage
aws s3 sync ~/insforge/backups s3://your-backup-bucket/insforge/

# Example: sync to a remote server
rsync -avz ~/insforge/backups/ user@backup-server:/backups/insforge/
```

---

### 18. Monitoring & Health Checks

#### 18.1 Check Service Status

```bash
# Container status
docker compose ps

# Resource usage per container
docker stats --no-stream

# Disk usage
df -h

# Memory usage
free -h
```

#### 18.2 View Logs

```bash
# All services
docker compose logs -f --tail=100

# Specific service
docker compose logs -f insforge
docker compose logs -f postgres
docker compose logs -f deno
```

#### 18.3 Health Check Endpoint

Monitor the health endpoint externally. A simple cron-based check:

```bash
# Add to crontab for monitoring
*/5 * * * * curl -sf https://insforge.yourdomain.com/api/health > /dev/null || echo "InsForge is DOWN" | mail -s "InsForge Alert" you@example.com
```

Or use a free uptime monitoring service like [UptimeRobot](https://uptimerobot.com) or [Betterstack](https://betterstack.com) to monitor `https://insforge.yourdomain.com/api/health`.

---

## Quick Reference

### Essential Commands

```bash
# ── Lifecycle ─────────────────────────────────
docker compose up -d              # Start all services
docker compose down               # Stop all services
docker compose restart            # Restart all services
docker compose pull               # Pull latest images

# ── Diagnostics ───────────────────────────────
docker compose ps                 # Service status
docker compose logs -f            # Follow all logs
docker compose logs -f insforge   # Follow specific service
docker stats --no-stream          # Resource usage

# ── Database (source .env first for vars) ────
source ~/insforge/.env
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-insforge}" > backup.sql  # Backup
cat backup.sql | docker compose exec -T postgres psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-insforge}"  # Restore

# ── Updates ───────────────────────────────────
docker compose pull               # Pull new images
docker compose down && docker compose up -d   # Apply update
```

### Security Checklist

- [ ] Deploy user created (non-root)
- [ ] SSH key authentication enabled
- [ ] SSH password authentication disabled
- [ ] Root login disabled
- [ ] UFW firewall enabled (ports 22, 80, 443 only)
- [ ] Docker ports bound to `127.0.0.1`
- [ ] Fail2Ban installed and active
- [ ] `JWT_SECRET` changed from default (32+ chars)
- [ ] `ENCRYPTION_KEY` set (separate from `JWT_SECRET`)
- [ ] `ADMIN_PASSWORD` changed from default
- [ ] `POSTGRES_PASSWORD` changed from default
- [ ] `.env` file permissions set to `600`
- [ ] HTTPS enabled via Certbot or Caddy
- [ ] Automated daily backups configured
- [ ] Unattended security updates enabled

---

## Troubleshooting

### Cannot Connect After Enabling UFW

If you're locked out, use your VPS provider's **web console** (out-of-band access) to:

```bash
sudo ufw allow OpenSSH
sudo ufw enable
```

### Docker Bypasses UFW

Docker directly manipulates iptables. Bind ports to `127.0.0.1` in `docker-compose.yml` as described in [Section 9.2](#92-docker-and-ufw-caveat).

### Services Fail to Start

```bash
# Check logs for the failing service
docker compose logs postgres
docker compose logs insforge

# Verify disk space
df -h

# Verify memory
free -h

# Restart Docker daemon
sudo systemctl restart docker
docker compose up -d
```

### SSL Certificate Won't Renew

```bash
# Check Certbot timer
sudo systemctl status certbot.timer

# Manual renewal
sudo certbot renew

# Test renewal
sudo certbot renew --dry-run
```

### Port Conflicts

```bash
# Find what's using a port
sudo ss -tlnp | grep :7130

# Change the port in .env
APP_PORT=7140
```

### Database Connection Issues

```bash
# Check PostgreSQL is healthy
docker compose ps postgres

# View PostgreSQL logs
docker compose logs postgres

# Connect to the database directly
docker compose exec postgres psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-insforge}"
```

---

## 🆘 Need Help?

- **Documentation**: [https://docs.insforge.dev](https://docs.insforge.dev)
- **Discord Community**: [https://discord.com/invite/MPxwj5xVvW](https://discord.com/invite/MPxwj5xVvW)
- **GitHub Issues**: [https://github.com/insforge/insforge/issues](https://github.com/insforge/insforge/issues)
