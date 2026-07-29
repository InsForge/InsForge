---
title: "VPS 部署与安全指南"
description: "在通用 Linux VPS 上部署 InsForge，使用防火墙、SSH 和 TLS 最佳实践对其进行加固，并通过安全的更新和回滚流程进行维护。"
---

# VPS 安装部署与安全指南

本综合指南涵盖了在通用 VPS（虚拟专用服务器）上部署 InsForge 用于生产环境、使用安全最佳实践加固你的实例，以及通过安全的更新和回滚流程对其进行长期维护。

> **适用范围**：本指南与云服务商无关。它适用于任何 Linux VPS——推荐使用 Ubuntu/Debian——无论提供商是 DigitalOcean、Hetzner、Linode、Vultr、OVH，还是裸机服务器。有关特定云平台的指南（AWS EC2、GCP、Azure、Render），请参阅本节中的其他指南。

---

## 📋 目录

- [前提条件](#prerequisites)
- [第一部分 — 部署](#part-1--deployment)
  - [服务器要求](#1-server-requirements)
  - [初始服务器设置](#2-initial-server-setup)
  - [安装 Docker 和 Docker Compose](#3-install-docker--docker-compose)
  - [使用 Docker Compose 部署 InsForge](#4-deploy-insforge-with-docker-compose)
  - [环境变量配置](#5-environment-variable-configuration)
  - [反向代理设置](#6-reverse-proxy-setup)
  - [HTTPS / TLS 设置](#7-https--tls-setup)
- [第二部分 — 安全](#part-2--security)
  - [端口管理](#8-port-management)
  - [防火墙设置（UFW）](#9-firewall-setup-ufw)
  - [以非 root 用户运行服务](#10-run-services-as-a-non-root-user)
  - [SSH 加固](#11-ssh-hardening)
  - [Docker 安全](#12-docker-security)
  - [密钥管理](#13-secrets-management)
- [第三部分 — 更新与维护](#part-3--updating--maintenance)
  - [更新前备份](#14-pre-update-backup)
  - [更新 InsForge](#15-updating-insforge)
  - [回滚流程](#16-rollback-procedure)
  - [自动化备份](#17-automated-backups)
  - [监控与健康检查](#18-monitoring--health-checks)
- [快速参考](#quick-reference)
- [故障排查](#troubleshooting)

---

## 前提条件

开始之前，请确保你已具备以下条件：

- 一台运行 **Ubuntu 22.04 LTS** 或 **Ubuntu 24.04 LTS** 的 VPS（Debian 12 同样适用）
- 服务器的 **root 或 sudo 权限**
- 一个已注册的**域名**（生产环境推荐）
- 对 Linux 命令行和 SSH 有基本了解

---

## 第一部分 — 部署

### 1. 服务器要求

| Resource      | Minimum        | Recommended     |
|---------------|----------------|-----------------|
| **CPU**       | 2 vCPU         | 4 vCPU          |
| **RAM**       | 2 GB           | 4 GB+           |
| **Storage**   | 20 GB SSD      | 40 GB+ SSD      |
| **OS**        | Ubuntu 22.04+  | Ubuntu 24.04 LTS|
| **Network**   | Public IPv4    | Public IPv4 + IPv6 |

> 💡 **提示**：对于有多用户的生产环境负载，建议从 4 GB 内存起步。使用 `docker stats` 监控使用情况，并根据需要进行垂直扩容。

InsForge 由以下 **4 个协同运行的服务**组成：

| Service       | Description                        | Internal Port |
|---------------|------------------------------------|---------------|
| **PostgreSQL**| Primary database                   | 5432          |
| **PostgREST** | Auto-generated REST API layer      | 3000 (mapped to 5430) |
| **InsForge**  | Node.js backend + dashboard        | 7130          |
| **Deno**      | Serverless functions runtime       | 7133          |

---

### 2. 初始服务器设置

#### 2.1 连接到你的 VPS

```bash
ssh root@your-server-ip
```

#### 2.2 更新系统软件包

```bash
apt update && apt upgrade -y
```

#### 2.3 创建部署用户（非 root）

切勿以 root 身份运行生产服务。创建一个专用用户：

```bash
# Create the deploy user and add to sudo group
adduser deploy
usermod -aG sudo deploy

# Switch to the deploy user
su - deploy
```

#### 2.4 设置时区

```bash
sudo timedatectl set-timezone UTC
```

#### 2.5 启用自动安全更新

```bash
sudo apt install unattended-upgrades -y
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

### 3. 安装 Docker 和 Docker Compose

#### 3.1 安装 Docker 引擎

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

#### 3.2 将部署用户添加到 Docker 组

```bash
sudo usermod -aG docker deploy
newgrp docker
```

#### 3.3 验证 Docker 安装

```bash
docker --version
docker compose version
docker run hello-world
```

> ⚠️ **安全提示**：将用户添加到 `docker` 组会授予其在主机上等同于 root 的权限。对于专用的部署用户这是可以接受的，但不应对共享服务器上的通用账户这样做。

---

### 4. 使用 Docker Compose 部署 InsForge

#### 4.1 下载生产环境的 Docker Compose 文件

```bash
mkdir -p ~/insforge && cd ~/insforge

# Download the production-ready Docker Compose file and environment template
wget https://raw.githubusercontent.com/insforge/insforge/main/deploy/docker-compose/docker-compose.yml
wget https://raw.githubusercontent.com/insforge/insforge/main/deploy/docker-compose/.env.example

# Create your environment file
cp .env.example .env
```

#### 4.2 启动 InsForge

```bash
docker compose up -d
```

#### 4.3 验证所有服务是否正在运行

```bash
docker compose ps
```

你应该会看到 4 个容器处于 `running` 或 `healthy` 状态：

```text
NAME            SERVICE     STATUS
insforge        insforge    running
postgres        postgres    healthy
postgrest       postgrest   healthy
deno            deno        running
```

#### 4.4 测试健康检查端点

```bash
curl http://localhost:7130/api/health
```

预期响应：

```json
{
  "status": "ok",
  "version": "1.x.x",
  "service": "Insforge OSS Backend",
  "timestamp": "2026-..."
}
```

---

### 5. 环境变量配置

编辑你的 `.env` 文件，为生产环境配置 InsForge：

```bash
nano ~/insforge/.env
```

#### 5.1 必需变量

在投入生产之前，以下变量**必须**从默认值修改：

```env
# ── Security (CRITICAL — generate unique values) ──────────────
JWT_SECRET=<output of: openssl rand -base64 32>
ENCRYPTION_KEY=<output of: openssl rand -base64 24>
ROOT_ADMIN_USERNAME=admin
ROOT_ADMIN_PASSWORD=<strong-unique-password>

# ── Public URL (must match your domain/IP) ────────────────────
API_BASE_URL=https://insforge.yourdomain.com
VITE_API_BASE_URL=https://insforge.yourdomain.com
```

直接从终端生成安全的密钥：

```bash
# JWT secret (32+ characters)
openssl rand -base64 32

# Encryption key (separate from JWT_SECRET)
openssl rand -base64 24

# Admin password
openssl rand -base64 18
```

> ⚠️ **重要**：`JWT_SECRET` 和 `ENCRYPTION_KEY` 应该使用**不同**的值。如果未设置 `ENCRYPTION_KEY`，InsForge 会回退使用 `JWT_SECRET`——但之后再轮换 `JWT_SECRET` 会永久性地损坏所有已存储的密钥（API 密钥、OAuth 令牌等）。

#### 5.2 数据库变量

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<strong-unique-password>
POSTGRES_DB=insforge
```

#### 5.3 端口变量

InsForge 使用的默认端口：

```env
POSTGRES_PORT=5432
POSTGREST_PORT=5430
APP_PORT=7130
AUTH_PORT=7131
DENO_PORT=7133
```

> 💡 如果这些端口与你 VPS 上的其他服务冲突，可以修改它们。

#### 5.4 部署功能所需变量

以下变量仅在你计划使用 InsForge 的**部署功能**（通过控制台部署项目）时才需要。如果你不需要部署功能，可以跳过本节。

> ⚠️ **注意**：这些变量（`AWS_S3_BUCKET`、`AWS_REGION`、`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`PROJECT_ID`、`MAX_FILE_SIZE`）来自根目录下的 `.env.example` 设置。它们**不**存在于 `deploy/docker-compose/.env.example` 中，并且 `deploy/docker-compose/docker-compose.yml` 也**不会**将它们传递给 `insforge` 容器，因此在你的 `.env` 中设置它们对该生产环境 compose 文件没有任何效果。要使用它们，请将每一个都添加到你 `docker-compose.yml` 中 `insforge` 服务的 `environment` 块内。

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

#### 5.5 可选变量

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

编辑完成后，重启服务以应用更改：

```bash
cd ~/insforge
docker compose down
docker compose up -d
```

---

### 6. 反向代理设置

反向代理位于 InsForge 前面，负责 TLS 终止、HTTP/2，并提供不带端口号的干净 URL。

#### 方案 A：Nginx（推荐）

##### 6.1 安装 Nginx

```bash
sudo apt install nginx -y
```

##### 6.2 创建站点配置

```bash
sudo nano /etc/nginx/sites-available/insforge
```

粘贴以下配置——将 `insforge.yourdomain.com` 替换为你的实际域名：

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

##### 6.3 启用该站点

```bash
sudo ln -s /etc/nginx/sites-available/insforge /etc/nginx/sites-enabled/

# Remove the default site (optional)
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

#### 方案 B：Caddy（自动 HTTPS）

Caddy 是一个更简单的替代方案，可以自动处理 TLS 证书。

##### 安装 Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy -y
```

##### 配置 Caddy

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

Caddy 会自动获取并续期 Let's Encrypt 证书——无需额外操作。

---

### 7. HTTPS / TLS 设置

> 如果你在第 6 步中选择了 **Caddy**，TLS 已经自动处理完毕。请直接跳转到[第二部分](#part-2--security)。

#### 7.1 安装 Certbot（用于 Nginx）

```bash
sudo apt install certbot python3-certbot-nginx -y
```

#### 7.2 获取 SSL 证书

```bash
sudo certbot --nginx -d insforge.yourdomain.com
```

按照交互式提示操作。Certbot 将会：
1. 通过 HTTP 质询验证域名所有权
2. 从 Let's Encrypt 获取签名证书
3. 自动更新你的 Nginx 配置以提供 HTTPS 服务
4. 设置 HTTP → HTTPS 重定向

#### 7.3 验证自动续期

Let's Encrypt 证书每 90 天过期一次。Certbot 会安装一个用于自动续期的 systemd 定时器：

```bash
# Test renewal (dry run — no actual renewal)
sudo certbot renew --dry-run

# Check the timer is active
sudo systemctl status certbot.timer
```

#### 7.4 为 HTTPS 更新 InsForge 环境变量

获取证书后，更新你的 `.env` 以使用 HTTPS 网址：

```bash
cd ~/insforge
nano .env
```

```env
API_BASE_URL=https://insforge.yourdomain.com
VITE_API_BASE_URL=https://insforge.yourdomain.com
```

重启 InsForge 以应用更改：

```bash
docker compose down
docker compose up -d
```

---

## 第二部分 — 安全

### 8. 端口管理

#### 应对外开放的端口（通过反向代理）

| Port | Protocol | Purpose                     |
|------|----------|-----------------------------|
| 22   | TCP      | SSH (restrict source IP)    |
| 80   | TCP      | HTTP → HTTPS redirect       |
| 443  | TCP      | HTTPS (reverse proxy)       |

#### 应对公众关闭的端口

以下端口**仅**用于 Docker 内部服务间通信，**绝不**应暴露给公网：

| Port  | Service     | Why Close It                                     |
|-------|-------------|--------------------------------------------------|
| 5432  | PostgreSQL  | Direct DB access — use `docker exec` instead     |
| 5430  | PostgREST   | Internal REST layer — proxied through InsForge   |
| 7130  | InsForge    | API + dashboard, accessed via reverse proxy on 443, not directly |
| 7131  | (unused)    | Published by compose (`AUTH_PORT`), but no process listens on it |
| 7133  | Deno        | Internal serverless runtime                      |

> ⚠️ **关键**：默认的 `docker-compose.yml` 将端口绑定到 `0.0.0.0`（所有接口），**而非** `127.0.0.1`。这意味着 Docker 会将服务直接暴露给互联网，**完全绕过 UFW**（Docker 直接操作 iptables）。你**必须**为 `docker-compose.yml` 中每一个发布的端口添加 `127.0.0.1:` 前缀：
>
> ```yaml
> ports:
>   - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"     # PostgreSQL
>   - "127.0.0.1:${POSTGREST_PORT:-5430}:3000"     # PostgREST
>   - "127.0.0.1:${APP_PORT:-7130}:7130"            # InsForge (API + dashboard)
>   - "127.0.0.1:${AUTH_PORT:-7131}:7131"           # AUTH_PORT (published by compose, unused)
>   - "127.0.0.1:${DENO_PORT:-7133}:7133"           # Deno
> ```
>
> 如果没有这个前缀，互联网上的任何人都可以直接访问这些服务——包括使用默认凭据的 PostgreSQL。详情请参见[第 9.2 节](#92-docker-and-ufw-caveat)。

---

### 9. 防火墙设置（UFW）

UFW（Uncomplicated Firewall）是在 Ubuntu 上管理 iptables 最简单的方式。

#### 9.1 安装和配置 UFW

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

预期输出：

```text
Status: active

To                         Action      From
--                         ------      ----
OpenSSH                    ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
```

> ⚠️ **关键**：务必在启用 UFW **之前**先允许 SSH，否则你会把自己锁在服务器外面。

#### 9.2 Docker 与 UFW 的注意事项

Docker 会直接操作 iptables，这可能**绕过 UFW 规则**。要防止这种情况：

**方案 1 — 将端口绑定到 localhost**（推荐）：

在你的 `docker-compose.yml` 中，为端口加上 `127.0.0.1:` 前缀：

```yaml
ports:
  - "127.0.0.1:7130:7130"
  - "127.0.0.1:7131:7131"
```

**方案 2 — 禁用 Docker 的 iptables 管理**：

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

> ⚠️ 禁用 Docker 的 iptables 管理需要手动配置网络。对于大多数场景，**推荐使用方案 1**。

#### 9.3 将 SSH 限制到你的 IP（可选）

为了最大程度的安全性，将 SSH 访问限制到已知的 IP 地址：

```bash
# Remove the broad SSH rule
sudo ufw delete allow OpenSSH

# Allow SSH only from your IP
sudo ufw allow from YOUR_IP_ADDRESS to any port 22 proto tcp

# Verify
sudo ufw status
```

---

### 10. 以非 root 用户运行服务

InsForge 的 Docker 镜像已经遵循了非 root 的最佳实践：

- 生产环境 Dockerfile 设置了 `USER node`（UID 1000），因此容器内的应用进程以非 root 用户运行。
- 系统级的 Docker 操作由 `deploy` 用户（在[第 2.3 步](#23-create-a-deploy-user-non-root)中创建）管理，该用户通过 `docker` 组获得对 Docker 套接字的访问权限。

**验证容器用户：**

```bash
docker compose exec insforge whoami
# Expected output: node
```

**额外加固：**

在 `docker-compose.yml` 中为每个服务添加 `security_opt`，以防止权限提升：

```yaml
# Add to each service in docker-compose.yml
security_opt:
  - no-new-privileges:true
```

---

### 11. SSH 加固

#### 11.1 使用 SSH 密钥认证

```bash
# On your LOCAL machine — generate a key pair if you don't have one
ssh-keygen -t ed25519 -C "deploy@insforge"

# Copy the public key to your server
ssh-copy-id -i ~/.ssh/id_ed25519.pub deploy@your-server-ip
```

#### 11.2 禁用密码认证

在确认基于密钥的认证可以正常工作后：

```bash
sudo nano /etc/ssh/sshd_config
```

设置以下内容：

```ini
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
```

重启 SSH：

```bash
sudo systemctl restart sshd
```

#### 11.3 安装 Fail2Ban

Fail2Ban 会自动封禁出现恶意行为（例如 SSH 暴力破解）的 IP：

```bash
sudo apt install fail2ban -y

# Create a local config (survives updates)
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
sudo nano /etc/fail2ban/jail.local
```

添加或确保存在以下设置：

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

### 12. Docker 安全

#### 12.1 保持 Docker 更新

```bash
sudo apt update
sudo apt upgrade docker-ce docker-ce-cli containerd.io -y
```

#### 12.2 限制容器资源（可选）

防止单个容器占用全部资源：

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

#### 12.3 只读根文件系统（进阶）

为了进一步加固，可以将容器文件系统尽可能挂载为只读：

```yaml
read_only: true
tmpfs:
  - /tmp
```

> ⚠️ 这需要经过测试——某些服务需要可写目录来存放缓存或临时文件。

#### 12.4 限制 CORS 来源

默认情况下，后端允许所有来源。它会将请求的 `Origin` 请求头原样反射回响应中，并且对于函数代理响应，会设置 `Access-Control-Allow-Origin: *`。这对本地开发很方便，但对生产环境来说过于宽松。对于生产部署，请将允许的来源限制为你实际提供服务的域名（例如你的控制台和应用域名），这样其他网站就无法向你的 API 发起带凭据的跨域请求。

---

### 13. 密钥管理

#### 应做 ✅

- 将密钥存储在 `.env` 文件中，并设置 `chmod 600 ~/insforge/.env`
- 为 `JWT_SECRET` 和 `ENCRYPTION_KEY` 使用不同的值
- 使用 `openssl rand -base64 32` 生成密钥
- 将你的 `.env` 文件备份到安全的离线位置

#### 不应做 ❌

- 将 `.env` 提交到版本控制系统
- 为多个变量重复使用同一个密钥
- 在生产环境中使用默认密码（`change-this-password`、`postgres`）
- 通过未加密的渠道分享密钥

---

## 第三部分 — 更新与维护

### 14. 更新前备份

**更新前务必先备份。** 这样如果出现任何问题，你都有恢复途径。

#### 14.1 备份数据库

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

#### 14.2 备份环境变量和卷

```bash
# Back up .env file
cp .env .env.backup_$(date +%Y%m%d)

# Back up Docker volumes (optional but recommended)
docker run --rm \
  -v insforge_postgres-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/volumes_postgres_$(date +%Y%m%d_%H%M%S).tar.gz /data
```

#### 14.3 记录当前版本

```bash
# Note the current image versions before updating
docker compose images
```

---

### 15. 更新 InsForge

#### 15.1 拉取最新镜像

```bash
cd ~/insforge

# Pull the latest versions
docker compose pull
```

#### 15.2 应用更新

```bash
# Stop current services, start with new images
docker compose down
docker compose up -d

# Watch logs for errors during startup
docker compose logs -f --tail=50
```

按 `Ctrl+C` 停止跟随日志。

#### 15.3 验证更新

```bash
# Check all services are healthy
docker compose ps

# Test the health endpoint
curl http://localhost:7130/api/health

# Check the version in the response
```

#### 15.4 更新 Docker Compose 文件（如有需要）

有时新版本会包含对 `docker-compose.yml` 的更改。要获取这些更改：

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

### 16. 回滚流程

如果更新导致了问题，请按照以下步骤进行回退：

#### 16.1 停止出问题的服务

```bash
cd ~/insforge
docker compose down
```

#### 16.2 恢复之前的 Docker Compose 文件

```bash
# If you saved the old file
mv docker-compose.yml.old docker-compose.yml
```

#### 16.3 固定到指定的镜像版本

编辑 `docker-compose.yml`，将 `latest` 标签替换为之前的版本：

```yaml
# Example: pin to a known-good version (replace with your previous tag)
image: ghcr.io/insforge/insforge-oss:v1.5.0
```

> 注意：目前 `deploy/docker-compose` 固定使用 `v1.5.0`，而项目目前已在 2.x 系列。请固定到你更新之前所运行的版本。

#### 16.4 恢复数据库（如有需要）

只有当此次更新包含导致问题的数据库迁移时，才需要恢复数据库：

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

#### 16.5 恢复环境变量文件（如有更改）

```bash
cp .env.backup_YYYYMMDD .env
docker compose down
docker compose up -d
```

---

### 17. 自动化备份

设置一个 cron 任务以进行每日自动备份：

#### 17.1 创建备份脚本

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

#### 17.2 使用 Cron 设置计划任务

```bash
crontab -e
```

添加以下这一行以每天凌晨 3:00 进行备份：

```cron
0 3 * * * /home/deploy/insforge/backup.sh >> /home/deploy/insforge/backups/cron.log 2>&1
```

#### 17.3 异地备份（推荐）

为了灾难恢复，将备份复制到外部位置：

```bash
# Example: sync backups to S3-compatible storage
aws s3 sync ~/insforge/backups s3://your-backup-bucket/insforge/

# Example: sync to a remote server
rsync -avz ~/insforge/backups/ user@backup-server:/backups/insforge/
```

---

### 18. 监控与健康检查

#### 18.1 检查服务状态

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

#### 18.2 查看日志

```bash
# All services
docker compose logs -f --tail=100

# Specific service
docker compose logs -f insforge
docker compose logs -f postgres
docker compose logs -f deno
```

#### 18.3 健康检查端点

从外部监控健康检查端点。一个简单的基于 cron 的检查：

```bash
# Add to crontab for monitoring
*/5 * * * * curl -sf https://insforge.yourdomain.com/api/health > /dev/null || echo "InsForge is DOWN" | mail -s "InsForge Alert" you@example.com
```

或者使用像 [UptimeRobot](https://uptimerobot.com) 或 [Betterstack](https://betterstack.com) 这样的免费在线状态监控服务来监控 `https://insforge.yourdomain.com/api/health`。

---

## 快速参考

### 常用命令

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

### 安全检查清单

- [ ] 已创建部署用户（非 root）
- [ ] 已启用 SSH 密钥认证
- [ ] 已禁用 SSH 密码认证
- [ ] 已禁用 root 登录
- [ ] 已启用 UFW 防火墙（仅开放 22、80、443 端口）
- [ ] Docker 端口已绑定到 `127.0.0.1`
- [ ] 已安装并启用 Fail2Ban
- [ ] `JWT_SECRET` 已从默认值修改（32 位以上）
- [ ] 已设置 `ENCRYPTION_KEY`（与 `JWT_SECRET` 不同）
- [ ] `ROOT_ADMIN_PASSWORD` 已从默认值修改
- [ ] `POSTGRES_PASSWORD` 已从默认值修改
- [ ] `.env` 文件权限已设置为 `600`
- [ ] 已通过 Certbot 或 Caddy 启用 HTTPS
- [ ] 已配置每日自动备份
- [ ] 已启用无人值守的安全更新

---

## 故障排查

### 启用 UFW 后无法连接

如果你被锁在服务器外，请使用你的 VPS 提供商的**网页控制台**（带外访问）来执行：

```bash
sudo ufw allow OpenSSH
sudo ufw enable
```

### Docker 绕过 UFW

Docker 会直接操作 iptables。请按照[第 9.2 节](#92-docker-and-ufw-caveat)中描述的方式，在 `docker-compose.yml` 中将端口绑定到 `127.0.0.1`。

### 服务无法启动

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

### SSL 证书无法续期

```bash
# Check Certbot timer
sudo systemctl status certbot.timer

# Manual renewal
sudo certbot renew

# Test renewal
sudo certbot renew --dry-run
```

### 端口冲突

```bash
# Find what's using a port
sudo ss -tlnp | grep :7130

# Change the port in .env
APP_PORT=7140
```

### 数据库连接问题

```bash
# Check PostgreSQL is healthy
docker compose ps postgres

# View PostgreSQL logs
docker compose logs postgres

# Connect to the database directly
docker compose exec postgres psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-insforge}"
```

---

## 🆘 需要帮助？

- **文档**：[https://docs.insforge.dev](https://docs.insforge.dev)
- **Discord 社区**：[https://discord.com/invite/MPxwj5xVvW](https://discord.com/invite/MPxwj5xVvW)
- **GitHub Issues**：[https://github.com/insforge/insforge/issues](https://github.com/insforge/insforge/issues)
