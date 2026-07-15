---
title: "將 InsForge 部署到 Google Cloud Compute Engine"
description: "使用 Docker Compose 將 InsForge 部署到 Google Cloud Compute Engine 執行個體，涵蓋防火牆規則、SSH 存取、自訂網域與 HTTPS 設定。"
---

# 將 InsForge 部署到 Google Cloud Compute Engine

本指南將引導您使用 Docker Compose 在 Google Cloud Compute Engine 上部署 InsForge。

<Note>
  這份雲端部署教學由社群維護，可能會落後於最新的 InsForge 版本。標準且永遠最新的設定位於 [InsForge repo](https://github.com/InsForge/InsForge) 中的 `deploy/docker-compose/` 目錄。
</Note>

## 📋 事前準備

- 已啟用計費功能的 Google Cloud 帳戶
- 具備 SSH 與命令列操作的基本知識
- 網域名稱（選用，用於自訂網域設定）

## 🚀 部署步驟

### 1. 建立並設定 Compute Engine 執行個體

#### 1.1 建立 Google Cloud 專案

1. 於 [console.cloud.google.com](https://console.cloud.google.com) **登入 Google Cloud Console**
2. 在頂部導覽列點擊**「選取專案」**
3. 點擊**「新增專案」**
4. **輸入專案名稱**（例如 `insforge-deployment`）
5. 點擊**「建立」**
6. **等待專案建立完成**

#### 1.2 啟用所需的 API

1. 於您的專案中，前往**「API 與服務」** → **「程式庫」**
2. 搜尋並啟用以下 API：
   - **Compute Engine API**
   - **Cloud Storage API**（若用於備份）
   - **Cloud SQL Admin API**（若使用 Cloud SQL）

#### 1.3 建立 Compute Engine 執行個體

1. 前往**「Compute Engine」** → **「VM 執行個體」**
2. 點擊**「建立執行個體」**
3. 設定您的執行個體：
   - **名稱**：`insforge-server`（或您偏好的名稱）
   - **區域**：選擇靠近使用者的區域
   - **地區**：選擇可用區（例如 us-central1-a）
   - **機器設定**：
     - **系列**：N2 或 E2
     - **機器類型**：`e2-medium` 或更高規格（最低 2 vCPU、4 GB RAM）
       - 正式環境建議：`e2-standard-2`（2 vCPU、8 GB RAM）
       - 測試環境最低：`e2-small`（2 vCPU、2 GB RAM）
   - **開機磁碟**：
     - **作業系統**：Ubuntu LTS（Ubuntu 22.04 LTS 或更新版本）
     - **開機磁碟類型**：平衡持續性磁碟
     - **大小**：30 GB（建議最低 20 GB）
   - **防火牆**：
     - 允許 HTTP 流量：**勾選**
     - 允許 HTTPS 流量：**勾選**

#### 1.4 設定防火牆規則

1. 前往**「VPC 網路」** → **「防火牆」**
2. 建立或修改防火牆規則，允許以下連接埠：

| 名稱 | 方向 | 目標 | 通訊協定/連接埠 | 來源篩選器 |
|------|-----------|---------|-----------------|----------------|
| insforge-ssh | 輸入 | insforge-server | tcp:22 | 您的 IP 位址 |
| insforge-http | 輸入 | insforge-server | tcp:80 | 0.0.0.0/0 |
| insforge-https | 輸入 | insforge-server | tcp:443 | 0.0.0.0/0 |
| insforge-app | 輸入 | insforge-server | tcp:7130 | 0.0.0.0/0 |
| insforge-deno | 輸入 | insforge-server | tcp:7133 | 0.0.0.0/0 |
| insforge-postgrest | 輸入 | insforge-server | tcp:5430 | 0.0.0.0/0 |
| insforge-postgres | 輸入 | insforge-server | tcp:5432 | 0.0.0.0/0（僅在需要對外開放時） |

> ⚠️ **安全性注意事項**：在正式環境中，請將 PostgreSQL（5432）限制為特定 IP 位址，或完全移除對外存取。建議使用反向代理（nginx），僅對外開放 80/443 連接埠。

### 2. 連線至您的 Compute Engine 執行個體

1. 在 Google Cloud Console 中，前往**「Compute Engine」** → **「VM 執行個體」**
2. 找到您的執行個體，點擊同一列的 **SSH** 按鈕，或者：

```bash
# Use gcloud CLI to SSH (if you have gcloud SDK installed locally)
gcloud compute ssh insforge-server --zone=your-zone
```

### 3. 安裝相依套件

#### 3.1 更新系統套件

```bash
sudo apt update && sudo apt upgrade -y
```

#### 3.2 安裝 Docker

```bash
# Add Docker's official GPG key
sudo apt-get update
sudo apt-get install ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt-get update
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

#### 3.3 將您的使用者加入 Docker 群組

安裝 Docker 後，您需要將您的使用者加入 `docker` 群組，才能在不使用 `sudo` 的情況下執行 Docker 指令：

```bash
# Add your user to the docker group
sudo usermod -aG docker $USER

# Apply the group changes
newgrp docker
```

**驗證是否成功：**

```bash
# This should now work without sudo
docker ps
```

> 💡 **注意**：若 `docker ps` 未能立即運作，請登出並重新透過 SSH 登入，然後再試一次。

> ⚠️ **安全性注意事項**：將使用者加入 `docker` 群組會授予其與 root 等同的系統權限。對於像您的 Compute Engine 執行個體這類單一使用者環境是可接受的，但在共用系統上請格外謹慎。

#### 3.4 安裝 Git

```bash
sudo apt install git -y
```

### 4. 部署 InsForge

#### 4.1 複製儲存庫

```bash
cd ~
git clone https://github.com/insforge/insforge.git
cd insforge/deploy/docker-compose
```

#### 4.2 建立環境設定

建立包含正式環境設定的 `.env` 檔案：

```bash
nano .env
```

儲存庫內附有範本檔案 `deploy/docker-compose/.env.example`。複製它並編輯其中的值：

```bash
cp .env.example .env
nano .env
```

至少須設定以下值：

```env
# Authentication (required)
# IMPORTANT: Generate a strong random secret for production (32+ characters)
JWT_SECRET=your-secret-key-here-must-be-32-char-or-above

# Admin account (used for initial setup)
ROOT_ADMIN_USERNAME=admin
ROOT_ADMIN_PASSWORD=change-this-password

# Database (required)
POSTGRES_PASSWORD=your-secure-postgres-password
```

您可能還想設定的選用值：

```env
# Encryption key for secrets and database encryption.
# Falls back to JWT_SECRET if left empty.
ENCRYPTION_KEY=

# AI/LLM (get a key from https://openrouter.ai/keys)
OPENROUTER_API_KEY=

# Site deployments and custom domains
VERCEL_TOKEN=
VERCEL_TEAM_ID=
VERCEL_PROJECT_ID=

# OAuth providers (Google, GitHub, etc.)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

完整支援的變數清單請參閱 `deploy/docker-compose/.env.example`。

**產生安全的密鑰：**

```bash
# Generate JWT_SECRET (32+ characters)
openssl rand -base64 32

# Generate ENCRYPTION_KEY (32 characters)
openssl rand -base64 24
```

> 💡 **重要**：請妥善保存這些密鑰。若您日後需要遷移或還原您的執行個體，將會需要用到它們。

#### 4.3 啟動 InsForge 服務

```bash
# Pull Docker images and start services
docker compose up -d

# View logs to ensure everything started correctly
docker compose logs -f
```

按 `Ctrl+C` 可離開日誌檢視畫面。

#### 4.4 驗證服務

```bash
# Check running containers
docker compose ps

# You should see 4 running services:
# - postgres
# - postgrest
# - insforge
# - deno
```

### 5. 存取您的 InsForge 執行個體

#### 5.1 測試後端 API

```bash
curl http://your-external-ip:7130/api/health
```

預期回應：
```json
{
  "status": "ok",
  "version": "2.1.7",
  "service": "Insforge OSS Backend",
  "timestamp": "2025-10-17T..."
}
```

#### 5.2 存取儀表板

開啟瀏覽器並前往：
```text
http://your-external-ip:7130
```

### 6. 設定網域（選用，但建議設定）

#### 6.1 保留靜態外部 IP

1. 在 Google Cloud Console 中，前往**「VPC 網路」** → **「外部 IP 位址」**
2. 點擊**「保留靜態位址」**
3. **名稱**：`insforge-ip`
4. **類型**：區域性或全域性（VM 執行個體請選擇區域性）
5. **區域**：與您的 VM 執行個體相同
6. **點擊保留**

#### 6.2 更新 DNS 記錄

將您的網域 DNS 記錄指向保留的靜態 IP：
```text
api.yourdomain.com    → your-static-external-ip
app.yourdomain.com    → your-static-external-ip
```

#### 6.3 安裝 Nginx 反向代理

```bash
sudo apt install nginx -y
```

建立 Nginx 設定檔：

```bash
sudo nano /etc/nginx/sites-available/insforge
```

新增以下設定：

```nginx
# Backend API
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:7130;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# Dashboard
server {
    listen 80;
    server_name app.yourdomain.com;

    location / {
        proxy_pass http://localhost:7130;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

啟用該設定：

```bash
sudo ln -s /etc/nginx/sites-available/insforge /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 6.4 安裝 SSL 憑證（建議）

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Obtain SSL certificates
sudo certbot --nginx -d api.yourdomain.com -d app.yourdomain.com

# Follow the prompts to complete setup
```

更新您的 `.env` 檔案，改用 HTTPS 網址：

```bash
cd ~/insforge/deploy/docker-compose
nano .env
```

修改：
```env
API_BASE_URL=https://api.yourdomain.com
VITE_API_BASE_URL=https://api.yourdomain.com
```

重新啟動服務：

```bash
docker compose down
docker compose up -d
```

## 🔧 管理與維護

### 檢視日誌

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f insforge
docker compose logs -f postgres
docker compose logs -f deno
```

### 停止服務

```bash
docker compose down
```

### 重新啟動服務

```bash
docker compose restart
```

### 更新 InsForge

```bash
cd ~/insforge/deploy/docker-compose
git pull origin main
docker compose pull && docker compose up -d
```

### 備份資料庫

```bash
# Create backup (run from deploy/docker-compose/)
docker compose exec postgres pg_dump -U postgres insforge > backup_$(date +%Y%m%d_%H%M%S).sql

# Store backup in Google Cloud Storage (optional)
# First, install Google Cloud CLI and authenticate
# Then:
gsutil cp backup_$(date +%Y%m%d_%H%M%S).sql gs://your-backup-bucket/
```

### 監控資源

```bash
# Check disk usage
df -h

# Check memory usage
free -h

# Check Docker stats
docker stats
```

## 🐛 疑難排解

### 服務無法啟動

```bash
# Check logs for errors
docker compose logs

# Check disk space
df -h

# Check memory
free -h

# Restart Docker daemon
sudo systemctl restart docker
docker compose up -d
```

### 無法連線至資料庫

```bash
# Check if PostgreSQL is running
docker compose ps postgres

# Check PostgreSQL logs
docker compose logs postgres

# Verify credentials in .env file
cat .env | grep POSTGRES
```

### 連接埠已被使用

```bash
# Check what's using the port
sudo netstat -tulpn | grep :7130

# Kill the process or change port in docker-compose.yml
```

### 記憶體不足

考慮升級至更大規格的執行個體類型：
```text
- Current: e2-small (2 vCPU, 2 GB RAM)
- Upgrade to: e2-standard-2 (2 vCPU, 8 GB RAM)
```

### SSL 憑證問題

```bash
# Renew certificates
sudo certbot renew

# Test renewal
sudo certbot renew --dry-run
```

## 📊 效能最佳化

### 針對正式環境工作負載

1. **升級執行個體類型**：使用 `e2-standard-2` 或 `e2-standard-4`
2. **使用 Cloud SQL**：從容器化的 PostgreSQL 遷移至 Google Cloud SQL，以獲得更佳的可靠性
3. **啟用 Cloud Monitoring**：監控指標並設定警示
4. **設定備份**：建立自動化的每日備份
5. **使用 Cloud Storage**：設定 Google Cloud Storage 以取代本機儲存來處理檔案上傳

### 資料庫最佳化

```conf
# Increase PostgreSQL shared_buffers (edit postgresql.conf in deploy/docker-init/db/)
# Recommended: 25% of available RAM
shared_buffers = 1GB
effective_cache_size = 3GB
```

## 🔒 安全性最佳實務

1. **變更預設密碼**：更新管理員與資料庫密碼
2. **啟用防火牆**：有效運用 Google Cloud 防火牆規則
3. **定期更新**：持續更新系統與 Docker 映像檔
4. **SSL/TLS**：正式環境務必使用 HTTPS
5. **定期備份**：自動化資料庫備份
6. **監控日誌**：設定日誌監控與警示
7. **限制 SSH 存取**：將 SSH 存取限制在特定 IP 位址
8. **使用服務帳戶**：盡可能以服務帳戶取代 API 金鑰

## 🆘 支援與資源

- **文件**：[https://docs.insforge.dev](https://docs.insforge.dev)
- **GitHub Issues**：[https://github.com/insforge/insforge/issues](https://github.com/insforge/insforge/issues)
- **Discord 社群**：[https://discord.com/invite/MPxwj5xVvW](https://discord.com/invite/MPxwj5xVvW)

## 📝 費用估算

**每月 Google Cloud 費用（約略）：**

| 項目 | 類型 | 每月費用 |
|-----------|------|--------------|
| Compute Engine | e2-medium（2 vCPU、4 GB RAM） | ~$29 |
| Persistent Disk（30 GB） | Standard | ~$3 |
| 網路流出流量 | 前 1GB 免費 | 變動 |
| **總計** | | **~$32/月** |

> 💡 **成本最佳化**：24/7 全天候執行的執行個體可使用永續使用折扣，最高可節省 30%。開發/測試環境建議考慮使用可搶占式執行個體。

---

**恭喜！🎉** 您的 InsForge 執行個體現已在 Google Cloud Compute Engine 上運行。您可以開始透過連接 AI 代理程式到您的後端平台來建構應用程式。

如需其他正式環境部署策略，請參閱我們的[部署指南](/deployment/deployment-security-guide)。
