---
title: "將 InsForge 部署到 AWS EC2"
description: "逐步說明如何使用 Docker Compose 將 InsForge 部署到 AWS EC2 執行個體，包含 SSH 設定、網域設定與 TLS 終止。"
---

# 將 InsForge 部署到 AWS EC2

本指南將引導您使用 Docker Compose 在 AWS EC2 執行個體上部署 InsForge。

<Note>
  這份雲端部署教學由社群維護，可能會落後於最新的 InsForge 版本。標準且永遠最新的設定位於 [InsForge repo](https://github.com/InsForge/InsForge) 中的 `deploy/docker-compose/` 目錄。
</Note>

## 📋 事前準備

- 具備 EC2 存取權限的 AWS 帳戶
- 具備 SSH 與命令列操作的基本知識
- 網域名稱（選用，用於自訂網域設定）

## 🚀 部署步驟

### 1. 建立並設定 EC2 執行個體

#### 1.1 啟動 EC2 執行個體

1. **登入 AWS Console**，並前往 EC2 儀表板
2. **點擊「Launch Instance」**
3. **設定執行個體：**
   - **名稱**：`insforge-server`（或您偏好的名稱）
   - **AMI**：Ubuntu Server 24.04 LTS (HVM)，SSD Volume Type
   - **執行個體類型**：`t3.medium` 或更高規格（最低 2 vCPU、4 GB RAM）
     - 正式環境建議：`t3.large`（2 vCPU、8 GB RAM）
     - 測試環境最低：`t3.small`（2 vCPU、2 GB RAM）
   - **金鑰對**：建立新的或選擇既有的金鑰對（下載並保存 `.pem` 檔案）
   - **儲存空間**：30 GB gp3（建議最低 20 GB）

#### 1.2 設定安全群組

建立或設定包含以下傳入規則的安全群組：

| 類型        | 通訊協定 | 連接埠範圍 | 來源    | 說明          |
|-------------|----------|------------|-----------|----------------------|
| SSH         | TCP      | 22         | My IP     | SSH 存取           |
| HTTP        | TCP      | 80         | 0.0.0.0/0 | HTTP 存取          |
| HTTPS       | TCP      | 443        | 0.0.0.0/0 | HTTPS 存取         |
| Custom TCP  | TCP      | 7130       | 0.0.0.0/0 | 儀表板 + API      |
| Custom TCP  | TCP      | 5432       | 0.0.0.0/0 | PostgreSQL（選用）|

> ⚠️ **安全性注意事項**：在正式環境中，請將 PostgreSQL（5432）限制為特定 IP 位址，或完全移除對外存取。建議使用反向代理（nginx），僅對外開放 80/443 連接埠。

#### 1.3 配置彈性 IP（建議）

1. 於 EC2 儀表板中前往**「Elastic IPs」**
2. 點擊**「Allocate Elastic IP address」**
3. 將彈性 IP 與您的執行個體建立關聯

這可確保您的執行個體即使在重新啟動後，仍保有相同的 IP 位址。

### 2. 連線至您的 EC2 執行個體

```bash
# Set correct permissions for your key file
chmod 400 your-key-pair.pem

# Connect via SSH
ssh -i your-key-pair.pem ubuntu@your-ec2-public-ip
```

### 3. 安裝相依套件

#### 3.1 更新系統套件

```bash
sudo apt update && sudo apt upgrade -y
```

#### 3.2 安裝 Docker

```text
Follow the instructions of the link below to install and verify docker on your new ubuntu ec2 instance:
https://docs.docker.com/engine/install/ubuntu/
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

> ⚠️ **安全性注意事項**：將使用者加入 `docker` 群組會授予其與 root 等同的系統權限。對於像您的 EC2 執行個體這類單一使用者環境是可接受的，但在共用系統上請格外謹慎。

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

複製範本檔案以建立您的 `.env` 檔案：

```bash
cp .env.example .env
nano .env
```

完整範本位於 `deploy/docker-compose/.env.example`。以下是您必須設定的變數：

```env
# Required
JWT_SECRET=your-secret-key-here-must-be-32-char-or-above
ROOT_ADMIN_USERNAME=admin
ROOT_ADMIN_PASSWORD=change-this-password
POSTGRES_PASSWORD=change-this-password

# Optional: falls back to JWT_SECRET if left blank
ENCRYPTION_KEY=

# Optional: enables AI features
OPENROUTER_API_KEY=

# Optional: enables site deployments
VERCEL_TOKEN=
VERCEL_TEAM_ID=
VERCEL_PROJECT_ID=

# Optional: OAuth providers
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

`.env.example` 範本已包含其餘變數及其預設值，因此只需編輯複製後的檔案即可。

**產生安全的密鑰：**

```bash
# Generate JWT_SECRET (32+ characters)
openssl rand -base64 32

# Generate ENCRYPTION_KEY (must be exactly 32 characters)
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
curl http://your-ec2-ip:7130/api/health
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
http://your-ec2-ip:7130
```

使用您在 `.env` 中設定的 `ROOT_ADMIN_USERNAME` 與 `ROOT_ADMIN_PASSWORD` 登入。

### 6. 設定網域（選用，但建議設定）

#### 6.1 更新 DNS 記錄

新增指向您 EC2 彈性 IP 的 DNS A 記錄：
```text
api.yourdomain.com    → your-ec2-ip
app.yourdomain.com    → your-ec2-ip
```

#### 6.2 安裝 Nginx 反向代理

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

# Dashboard (served by the backend on the same port as the API)
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

#### 6.3 安裝 SSL 憑證（建議）

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

InsForge 提供預先建置的映像檔，因此更新只需要拉取映像檔並重新啟動。請從 `~/insforge/deploy/docker-compose` 執行以下指令：

```bash
cd ~/insforge/deploy/docker-compose
git pull origin main
docker compose pull && docker compose up -d
```

### 備份資料庫

請從 `~/insforge/deploy/docker-compose` 執行以下指令：

```bash
# Create backup
docker compose exec postgres pg_dump -U postgres insforge > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore from backup
cat backup_file.sql | docker compose exec -T postgres psql -U postgres -d insforge
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
- Current: t3.medium (4 GB RAM)
- Upgrade to: t3.large (8 GB RAM)
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

1. **升級執行個體類型**：使用 `t3.large` 或 `t3.xlarge`
2. **啟用自動擴展**：設定應用程式負載平衡器並搭配自動擴展群組
3. **使用 RDS**：從容器化的 PostgreSQL 遷移至 AWS RDS，以獲得更佳的可靠性
4. **啟用 CloudWatch**：監控指標並設定警報
5. **設定備份**：建立自動化的每日備份
6. **使用 S3 儲存**：設定 S3 儲存貯體以取代本機儲存來處理檔案上傳

### 資料庫最佳化

```conf
# Increase PostgreSQL shared_buffers (edit postgresql.conf in deploy/docker-init/db/)
# Recommended: 25% of available RAM
shared_buffers = 1GB
effective_cache_size = 3GB
```

## 🔒 安全性最佳實務

1. **變更預設密碼**：更新管理員與資料庫密碼
2. **啟用防火牆**：有效運用 AWS 安全群組
3. **定期更新**：持續更新系統與 Docker 映像檔
4. **SSL/TLS**：正式環境務必使用 HTTPS
5. **定期備份**：自動化資料庫備份
6. **監控日誌**：設定日誌監控與警示
7. **限制 SSH 存取**：將 SSH 存取限制在特定 IP 位址
8. **使用 IAM 角色**：盡可能以 IAM 角色取代 AWS 存取金鑰

## 🆘 支援與資源

- **文件**：[https://docs.insforge.dev](https://docs.insforge.dev)
- **GitHub Issues**：[https://github.com/insforge/insforge/issues](https://github.com/insforge/insforge/issues)
- **Discord 社群**：[https://discord.com/invite/MPxwj5xVvW](https://discord.com/invite/MPxwj5xVvW)

## 📝 費用估算

**每月 AWS 費用（約略）：**

| 項目 | 類型 | 每月費用 |
|-----------|------|--------------|
| EC2 執行個體 | t3.medium | ~$30 |
| 儲存空間（30 GB） | EBS gp3 | ~$3 |
| 彈性 IP | （若 24/7 執行） | $0 |
| 資料傳輸 | 前 100GB 免費 | 變動 |
| **總計** | | **~$33/月** |

> 💡 **成本最佳化**：長期部署可使用 AWS Savings Plans 或 Reserved Instances，最高可節省 70%。

---

**恭喜！🎉** 您的 InsForge 執行個體現已在 AWS EC2 上運行。您可以開始透過連接 AI 代理程式到您的後端平台來建構應用程式。

如需其他正式環境部署策略，請參閱我們的[部署指南](/deployment/deployment-security-guide)。
