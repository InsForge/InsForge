---
title: "VPS 部署與安全指南"
description: "在通用 Linux VPS 上部署 InsForge，使用防火牆、SSH 與 TLS 最佳實務強化伺服器，並透過安全的更新與回復流程進行維護。"
---

# VPS 安裝部署與安全指南

本份完整指南涵蓋在通用 VPS（虛擬專用伺服器）上部署 InsForge 以供正式環境使用、以安全最佳實務強化你的伺服器，以及透過安全的更新與回復流程長期維護。

> **適用範圍**：本指南與雲端服務商無關，適用於任何 Linux VPS——建議使用 Ubuntu/Debian——不論提供商是 DigitalOcean、Hetzner、Linode、Vultr、OVH，或是裸機伺服器。如需特定雲端平台的指南（AWS EC2、GCP、Azure、Render），請參閱本節中的其他指南。

---

## 📋 目錄

- [先決條件](#prerequisites)
- [第一部分 — 部署](#part-1--deployment)
  - [伺服器需求](#1-server-requirements)
  - [初始伺服器設定](#2-initial-server-setup)
  - [安裝 Docker 與 Docker Compose](#3-install-docker--docker-compose)
  - [使用 Docker Compose 部署 InsForge](#4-deploy-insforge-with-docker-compose)
  - [環境變數設定](#5-environment-variable-configuration)
  - [反向代理設定](#6-reverse-proxy-setup)
  - [HTTPS / TLS 設定](#7-https--tls-setup)
- [第二部分 — 安全](#part-2--security)
  - [連接埠管理](#8-port-management)
  - [防火牆設定（UFW）](#9-firewall-setup-ufw)
  - [以非 root 使用者執行服務](#10-run-services-as-a-non-root-user)
  - [SSH 強化](#11-ssh-hardening)
  - [Docker 安全性](#12-docker-security)
  - [憑證與密鑰管理](#13-secrets-management)
- [第三部分 — 更新與維護](#part-3--updating--maintenance)
  - [更新前備份](#14-pre-update-backup)
  - [更新 InsForge](#15-updating-insforge)
  - [回復流程](#16-rollback-procedure)
  - [自動化備份](#17-automated-backups)
  - [監控與健康檢查](#18-monitoring--health-checks)
- [快速參考](#quick-reference)
- [疑難排解](#troubleshooting)

---

## 先決條件

開始之前，請確認你已具備以下條件：

- 一台執行 **Ubuntu 22.04 LTS** 或 **Ubuntu 24.04 LTS** 的 VPS（Debian 12 同樣適用）
- 伺服器的 **root 或 sudo 權限**
- 一個已註冊的**網域名稱**（建議用於正式環境）
- 對 Linux 命令列與 SSH 有基本了解

---

## 第一部分 — 部署

### 1. 伺服器需求

| Resource      | Minimum        | Recommended     |
|---------------|----------------|-----------------|
| **CPU**       | 2 vCPU         | 4 vCPU          |
| **RAM**       | 2 GB           | 4 GB+           |
| **Storage**   | 20 GB SSD      | 40 GB+ SSD      |
| **OS**        | Ubuntu 22.04+  | Ubuntu 24.04 LTS|
| **Network**   | Public IPv4    | Public IPv4 + IPv6 |

> 💡 **提示**：若正式環境有多位使用者，建議從 4 GB 記憶體開始。使用 `docker stats` 監控用量，並依需求進行垂直擴充。

InsForge 由以下 **4 項協同運作的服務**組成：

| Service       | Description                        | Internal Port |
|---------------|------------------------------------|---------------|
| **PostgreSQL**| Primary database                   | 5432          |
| **PostgREST** | Auto-generated REST API layer      | 3000 (mapped to 5430) |
| **InsForge**  | Node.js backend + dashboard        | 7130          |
| **Deno**      | Serverless functions runtime       | 7133          |

---

### 2. 初始伺服器設定

#### 2.1 連線至你的 VPS

```bash
ssh root@your-server-ip
```

#### 2.2 更新系統套件

```bash
apt update && apt upgrade -y
```

#### 2.3 建立部署使用者（非 root）

切勿以 root 身分執行正式環境服務。請建立一個專用的使用者：

```bash
# Create the deploy user and add to sudo group
adduser deploy
usermod -aG sudo deploy

# Switch to the deploy user
su - deploy
```

#### 2.4 設定時區

```bash
sudo timedatectl set-timezone UTC
```

#### 2.5 啟用自動安全性更新

```bash
sudo apt install unattended-upgrades -y
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

### 3. 安裝 Docker 與 Docker Compose

#### 3.1 安裝 Docker 引擎

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

#### 3.2 將部署使用者加入 Docker 群組

```bash
sudo usermod -aG docker deploy
newgrp docker
```

#### 3.3 驗證 Docker 安裝

```bash
docker --version
docker compose version
docker run hello-world
```

> ⚠️ **安全性注意事項**：將使用者加入 `docker` 群組會授予其在主機上等同於 root 的權限。對於專用的部署使用者而言這是可接受的，但不應套用於共用伺服器上的一般用途帳號。

---

### 4. 使用 Docker Compose 部署 InsForge

#### 4.1 下載正式環境的 Docker Compose 檔案

```bash
mkdir -p ~/insforge && cd ~/insforge

# Download the production-ready Docker Compose file and environment template
wget https://raw.githubusercontent.com/insforge/insforge/main/deploy/docker-compose/docker-compose.yml
wget https://raw.githubusercontent.com/insforge/insforge/main/deploy/docker-compose/.env.example

# Create your environment file
cp .env.example .env
```

#### 4.2 啟動 InsForge

```bash
docker compose up -d
```

#### 4.3 驗證所有服務皆正常運作

```bash
docker compose ps
```

你應該會看到 4 個容器處於 `running` 或 `healthy` 狀態：

```text
NAME            SERVICE     STATUS
insforge        insforge    running
postgres        postgres    healthy
postgrest       postgrest   healthy
deno            deno        running
```

#### 4.4 測試健康檢查端點

```bash
curl http://localhost:7130/api/health
```

預期回應：

```json
{
  "status": "ok",
  "version": "1.x.x",
  "service": "Insforge OSS Backend",
  "timestamp": "2026-..."
}
```

---

### 5. 環境變數設定

編輯你的 `.env` 檔案，為正式環境設定 InsForge：

```bash
nano ~/insforge/.env
```

#### 5.1 必要變數

在上線正式環境之前，以下變數**必須**從預設值修改：

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

直接從終端機產生安全的密鑰：

```bash
# JWT secret (32+ characters)
openssl rand -base64 32

# Encryption key (separate from JWT_SECRET)
openssl rand -base64 24

# Admin password
openssl rand -base64 18
```

> ⚠️ **重要**：`JWT_SECRET` 與 `ENCRYPTION_KEY` 應使用**不同**的值。若未設定 `ENCRYPTION_KEY`，InsForge 會退回使用 `JWT_SECRET`——但之後若再輪替 `JWT_SECRET`，將會永久性地損毀所有已儲存的密鑰（API 金鑰、OAuth 權杖等）。

#### 5.2 資料庫變數

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<strong-unique-password>
POSTGRES_DB=insforge
```

#### 5.3 連接埠變數

InsForge 使用的預設連接埠：

```env
POSTGRES_PORT=5432
POSTGREST_PORT=5430
APP_PORT=7130
AUTH_PORT=7131
DENO_PORT=7133
```

> 💡 若這些連接埠與你 VPS 上其他服務衝突，可以自行修改。

#### 5.4 部署功能所需的變數

以下變數僅在你打算使用 InsForge 的**部署功能**（透過控制台部署專案）時才需要設定。若你不需要部署功能，可以跳過本節。

> ⚠️ **注意**：這些變數（`AWS_S3_BUCKET`、`AWS_REGION`、`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`PROJECT_ID`、`MAX_FILE_SIZE`）來自根目錄下的 `.env.example` 設定。它們**並不**存在於 `deploy/docker-compose/.env.example` 中，而 `deploy/docker-compose/docker-compose.yml` 也**不會**將它們傳遞給 `insforge` 容器，因此在你的 `.env` 中設定它們，對此正式環境 compose 檔案不會有任何作用。若要使用它們，請將每一項加入你 `docker-compose.yml` 中 `insforge` 服務的 `environment` 區塊。

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

#### 5.5 選用變數

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

編輯完成後，重新啟動服務以套用變更：

```bash
cd ~/insforge
docker compose down
docker compose up -d
```

---

### 6. 反向代理設定

反向代理位於 InsForge 之前，負責 TLS 終止、HTTP/2，並提供不含連接埠號的簡潔網址。

#### 方案 A：Nginx（建議）

##### 6.1 安裝 Nginx

```bash
sudo apt install nginx -y
```

##### 6.2 建立站台設定

```bash
sudo nano /etc/nginx/sites-available/insforge
```

貼上以下設定——將 `insforge.yourdomain.com` 替換為你實際的網域：

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

##### 6.3 啟用該站台

```bash
sudo ln -s /etc/nginx/sites-available/insforge /etc/nginx/sites-enabled/

# Remove the default site (optional)
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

#### 方案 B：Caddy（自動 HTTPS）

Caddy 是更簡單的替代方案，能自動處理 TLS 憑證。

##### 安裝 Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy -y
```

##### 設定 Caddy

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

Caddy 會自動取得並續簽 Let's Encrypt 憑證——無需額外步驟。

---

### 7. HTTPS / TLS 設定

> 若你在第 6 步選擇了 **Caddy**，TLS 已自動處理完畢，請直接跳至[第二部分](#part-2--security)。

#### 7.1 安裝 Certbot（適用於 Nginx）

```bash
sudo apt install certbot python3-certbot-nginx -y
```

#### 7.2 取得 SSL 憑證

```bash
sudo certbot --nginx -d insforge.yourdomain.com
```

依照互動式提示操作。Certbot 將會：
1. 透過 HTTP 挑戰驗證網域擁有權
2. 從 Let's Encrypt 取得已簽署的憑證
3. 自動更新你的 Nginx 設定以提供 HTTPS 服務
4. 設定 HTTP → HTTPS 重新導向

#### 7.3 驗證自動續簽

Let's Encrypt 憑證每 90 天到期一次。Certbot 會安裝一個用於自動續簽的 systemd 計時器：

```bash
# Test renewal (dry run — no actual renewal)
sudo certbot renew --dry-run

# Check the timer is active
sudo systemctl status certbot.timer
```

#### 7.4 為 HTTPS 更新 InsForge 環境設定

取得憑證後，更新你的 `.env` 以使用 HTTPS 網址：

```bash
cd ~/insforge
nano .env
```

```env
API_BASE_URL=https://insforge.yourdomain.com
VITE_API_BASE_URL=https://insforge.yourdomain.com
```

重新啟動 InsForge 以套用變更：

```bash
docker compose down
docker compose up -d
```

---

## 第二部分 — 安全

### 8. 連接埠管理

#### 應對外開放的連接埠（透過反向代理）

| Port | Protocol | Purpose                     |
|------|----------|-----------------------------|
| 22   | TCP      | SSH (restrict source IP)    |
| 80   | TCP      | HTTP → HTTPS redirect       |
| 443  | TCP      | HTTPS (reverse proxy)       |

#### 應對外部關閉的連接埠

以下連接埠**僅**用於 Docker 內部服務間通訊，**絕不**應對外公開：

| Port  | Service     | Why Close It                                     |
|-------|-------------|--------------------------------------------------|
| 5432  | PostgreSQL  | Direct DB access — use `docker exec` instead     |
| 5430  | PostgREST   | Internal REST layer — proxied through InsForge   |
| 7130  | InsForge    | API + dashboard, accessed via reverse proxy on 443, not directly |
| 7131  | (unused)    | Published by compose (`AUTH_PORT`), but no process listens on it |
| 7133  | Deno        | Internal serverless runtime                      |

> ⚠️ **重要**：預設的 `docker-compose.yml` 會將連接埠繫結至 `0.0.0.0`（所有介面），**而非** `127.0.0.1`。這代表 Docker 會將服務直接對外公開，**完全繞過 UFW**（Docker 會直接操作 iptables）。你**必須**為 `docker-compose.yml` 中每個發布的連接埠加上 `127.0.0.1:` 前綴：
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
> 若少了這個前綴，網際網路上的任何人都能直接連上這些服務——包括使用預設憑證的 PostgreSQL。詳情請參閱[第 9.2 節](#92-docker-and-ufw-caveat)。

---

### 9. 防火牆設定（UFW）

UFW（Uncomplicated Firewall）是在 Ubuntu 上管理 iptables 最簡單的方式。

#### 9.1 安裝並設定 UFW

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

預期輸出：

```text
Status: active

To                         Action      From
--                         ------      ----
OpenSSH                    ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
```

> ⚠️ **重要**：務必在啟用 UFW **之前**先允許 SSH，否則你會把自己鎖在伺服器外面。

#### 9.2 Docker 與 UFW 的注意事項

Docker 會直接操作 iptables，這可能**繞過 UFW 規則**。要避免此情況：

**方案 1 — 將連接埠繫結至 localhost**（建議）：

在你的 `docker-compose.yml` 中，為連接埠加上 `127.0.0.1:` 前綴：

```yaml
ports:
  - "127.0.0.1:7130:7130"
  - "127.0.0.1:7131:7131"
```

**方案 2 — 停用 Docker 的 iptables 管理**：

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

> ⚠️ 停用 Docker 的 iptables 管理需要手動設定網路。對大多數情況而言，**建議採用方案 1**。

#### 9.3 將 SSH 限制至你的 IP（選用）

為求最高安全性，可將 SSH 存取限制至已知的 IP 位址：

```bash
# Remove the broad SSH rule
sudo ufw delete allow OpenSSH

# Allow SSH only from your IP
sudo ufw allow from YOUR_IP_ADDRESS to any port 22 proto tcp

# Verify
sudo ufw status
```

---

### 10. 以非 root 使用者執行服務

InsForge 的 Docker 映像檔已遵循非 root 的最佳實務：

- 正式環境的 Dockerfile 設定了 `USER node`（UID 1000），因此容器內的應用程式行程以非 root 使用者執行。
- 系統層級的 Docker 操作由 `deploy` 使用者（於[第 2.3 步](#23-create-a-deploy-user-non-root)建立）管理，該使用者透過 `docker` 群組取得對 Docker 通訊端的存取權限。

**驗證容器使用者：**

```bash
docker compose exec insforge whoami
# Expected output: node
```

**進一步強化：**

在 `docker-compose.yml` 中為每個服務加入 `security_opt`，以防止權限提升：

```yaml
# Add to each service in docker-compose.yml
security_opt:
  - no-new-privileges:true
```

---

### 11. SSH 強化

#### 11.1 使用 SSH 金鑰驗證

```bash
# On your LOCAL machine — generate a key pair if you don't have one
ssh-keygen -t ed25519 -C "deploy@insforge"

# Copy the public key to your server
ssh-copy-id -i ~/.ssh/id_ed25519.pub deploy@your-server-ip
```

#### 11.2 停用密碼驗證

在確認以金鑰為基礎的驗證運作正常後：

```bash
sudo nano /etc/ssh/sshd_config
```

設定以下內容：

```ini
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
```

重新啟動 SSH：

```bash
sudo systemctl restart sshd
```

#### 11.3 安裝 Fail2Ban

Fail2Ban 會自動封鎖出現惡意行為（例如 SSH 暴力破解）的 IP：

```bash
sudo apt install fail2ban -y

# Create a local config (survives updates)
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
sudo nano /etc/fail2ban/jail.local
```

新增或確認存在以下設定：

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

### 12. Docker 安全性

#### 12.1 保持 Docker 為最新版本

```bash
sudo apt update
sudo apt upgrade docker-ce docker-ce-cli containerd.io -y
```

#### 12.2 限制容器資源（選用）

避免單一容器耗盡所有資源：

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

#### 12.3 唯讀根檔案系統（進階）

若要進一步強化，可將容器檔案系統盡可能掛載為唯讀：

```yaml
read_only: true
tmpfs:
  - /tmp
```

> ⚠️ 這需要經過測試——部分服務需要可寫入的目錄來存放快取或暫存檔案。

#### 12.4 限制 CORS 來源

預設情況下，後端允許所有來源。它會將請求的 `Origin` 標頭原樣反映回應中，並且針對函式代理回應，會設定 `Access-Control-Allow-Origin: *`。這對本機開發相當方便，但對正式環境而言過於寬鬆。對於正式部署，請將允許的來源限制在你實際提供服務的網域（例如你的控制台與應用程式網域），如此其他網站便無法對你的 API 發出帶有憑證的跨來源請求。

---

### 13. 憑證與密鑰管理

#### 應做 ✅

- 將密鑰儲存在 `.env` 檔案中，並設定 `chmod 600 ~/insforge/.env`
- 為 `JWT_SECRET` 與 `ENCRYPTION_KEY` 使用不同的值
- 使用 `openssl rand -base64 32` 產生密鑰
- 將你的 `.env` 檔案備份至安全的離線位置

#### 不應做 ❌

- 將 `.env` 提交至版本控制系統
- 讓多個變數重複使用同一組密鑰
- 在正式環境中使用預設密碼（`change-this-password`、`postgres`）
- 透過未加密的管道分享密鑰

---

## 第三部分 — 更新與維護

### 14. 更新前備份

**更新前務必先備份。** 如此一來，若發生任何問題，你都有可回復的途徑。

#### 14.1 備份資料庫

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

#### 14.2 備份環境變數與資料卷

```bash
# Back up .env file
cp .env .env.backup_$(date +%Y%m%d)

# Back up Docker volumes (optional but recommended)
docker run --rm \
  -v insforge_postgres-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/volumes_postgres_$(date +%Y%m%d_%H%M%S).tar.gz /data
```

#### 14.3 記錄目前版本

```bash
# Note the current image versions before updating
docker compose images
```

---

### 15. 更新 InsForge

#### 15.1 拉取最新映像檔

```bash
cd ~/insforge

# Pull the latest versions
docker compose pull
```

#### 15.2 套用更新

```bash
# Stop current services, start with new images
docker compose down
docker compose up -d

# Watch logs for errors during startup
docker compose logs -f --tail=50
```

按下 `Ctrl+C` 可停止追蹤日誌。

#### 15.3 驗證更新

```bash
# Check all services are healthy
docker compose ps

# Test the health endpoint
curl http://localhost:7130/api/health

# Check the version in the response
```

#### 15.4 更新 Docker Compose 檔案（如有需要）

新版本有時會包含對 `docker-compose.yml` 的變更。若要套用這些變更：

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

### 16. 回復流程

若更新造成問題，請依照以下步驟進行回復：

#### 16.1 停止異常的服務

```bash
cd ~/insforge
docker compose down
```

#### 16.2 還原先前的 Docker Compose 檔案

```bash
# If you saved the old file
mv docker-compose.yml.old docker-compose.yml
```

#### 16.3 固定至指定的映像檔版本

編輯 `docker-compose.yml`，將 `latest` 標籤替換為先前的版本：

```yaml
# Example: pin to a known-good version (replace with your previous tag)
image: ghcr.io/insforge/insforge-oss:v1.5.0
```

> 注意：目前 `deploy/docker-compose` 固定使用 `v1.5.0`，而專案現已進展到 2.x 系列。請固定至你更新前所執行的版本。

#### 16.4 還原資料庫（如有需要）

僅當此次更新包含造成問題的資料庫遷移時，才需要還原資料庫：

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

#### 16.5 還原環境變數檔案（如有變更）

```bash
cp .env.backup_YYYYMMDD .env
docker compose down
docker compose up -d
```

---

### 17. 自動化備份

設定一個 cron 工作以進行每日自動備份：

#### 17.1 建立備份腳本

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

#### 17.2 使用 Cron 排程

```bash
crontab -e
```

新增以下這一行，讓每天凌晨 3:00 執行備份：

```cron
0 3 * * * /home/deploy/insforge/backup.sh >> /home/deploy/insforge/backups/cron.log 2>&1
```

#### 17.3 異地備份（建議）

為了災難復原，請將備份複製到外部位置：

```bash
# Example: sync backups to S3-compatible storage
aws s3 sync ~/insforge/backups s3://your-backup-bucket/insforge/

# Example: sync to a remote server
rsync -avz ~/insforge/backups/ user@backup-server:/backups/insforge/
```

---

### 18. 監控與健康檢查

#### 18.1 檢查服務狀態

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

#### 18.2 檢視日誌

```bash
# All services
docker compose logs -f --tail=100

# Specific service
docker compose logs -f insforge
docker compose logs -f postgres
docker compose logs -f deno
```

#### 18.3 健康檢查端點

從外部監控健康檢查端點。以下是一個簡單的 cron 檢查：

```bash
# Add to crontab for monitoring
*/5 * * * * curl -sf https://insforge.yourdomain.com/api/health > /dev/null || echo "InsForge is DOWN" | mail -s "InsForge Alert" you@example.com
```

或者使用像 [UptimeRobot](https://uptimerobot.com) 或 [Betterstack](https://betterstack.com) 這類免費的在線監控服務，來監控 `https://insforge.yourdomain.com/api/health`。

---

## 快速參考

### 常用指令

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

### 安全檢查清單

- [ ] 已建立部署使用者（非 root）
- [ ] 已啟用 SSH 金鑰驗證
- [ ] 已停用 SSH 密碼驗證
- [ ] 已停用 root 登入
- [ ] 已啟用 UFW 防火牆（僅開放 22、80、443 連接埠）
- [ ] Docker 連接埠已繫結至 `127.0.0.1`
- [ ] 已安裝並啟用 Fail2Ban
- [ ] `JWT_SECRET` 已從預設值修改（32 位元以上）
- [ ] 已設定 `ENCRYPTION_KEY`（與 `JWT_SECRET` 不同）
- [ ] `ROOT_ADMIN_PASSWORD` 已從預設值修改
- [ ] `POSTGRES_PASSWORD` 已從預設值修改
- [ ] `.env` 檔案權限已設定為 `600`
- [ ] 已透過 Certbot 或 Caddy 啟用 HTTPS
- [ ] 已設定每日自動備份
- [ ] 已啟用無人值守的安全性更新

---

## 疑難排解

### 啟用 UFW 後無法連線

若你被鎖在伺服器外，請使用你的 VPS 提供商的**網頁主控台**（頻外存取）執行：

```bash
sudo ufw allow OpenSSH
sudo ufw enable
```

### Docker 繞過 UFW

Docker 會直接操作 iptables。請依照[第 9.2 節](#92-docker-and-ufw-caveat)所述，在 `docker-compose.yml` 中將連接埠繫結至 `127.0.0.1`。

### 服務無法啟動

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

### SSL 憑證無法續簽

```bash
# Check Certbot timer
sudo systemctl status certbot.timer

# Manual renewal
sudo certbot renew

# Test renewal
sudo certbot renew --dry-run
```

### 連接埠衝突

```bash
# Find what's using a port
sudo ss -tlnp | grep :7130

# Change the port in .env
APP_PORT=7140
```

### 資料庫連線問題

```bash
# Check PostgreSQL is healthy
docker compose ps postgres

# View PostgreSQL logs
docker compose logs postgres

# Connect to the database directly
docker compose exec postgres psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-insforge}"
```

---

## 🆘 需要協助？

- **文件**：[https://docs.insforge.dev](https://docs.insforge.dev)
- **Discord 社群**：[https://discord.com/invite/MPxwj5xVvW](https://discord.com/invite/MPxwj5xVvW)
- **GitHub Issues**：[https://github.com/insforge/insforge/issues](https://github.com/insforge/insforge/issues)
