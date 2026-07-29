---
title: "将 InsForge 部署到 Google Cloud Compute Engine"
description: "使用 Docker Compose 在 Google Cloud Compute Engine 虚拟机上部署 InsForge，涵盖防火墙规则、SSH 访问、自定义域名和 HTTPS 设置。"
---

# 将 InsForge 部署到 Google Cloud Compute Engine

本指南将带你使用 Docker Compose 在 Google Cloud Compute Engine 上部署 InsForge。

<Note>
  本云端部署指南由社区维护，可能滞后于最新的 InsForge 版本。最权威、始终保持最新的配置位于 [InsForge 仓库](https://github.com/InsForge/InsForge) 中的 `deploy/docker-compose/` 目录。
</Note>

## 📋 前置条件

- 已启用计费的 Google Cloud 账户
- 具备 SSH 和命令行操作的基础知识
- 域名（可选，用于自定义域名设置）

## 🚀 部署步骤

### 1. 创建并配置 Compute Engine 实例

#### 1.1 创建 Google Cloud 项目

1. **登录 Google Cloud 控制台**，访问 [console.cloud.google.com](https://console.cloud.google.com)
2. **点击顶部导航栏中的“选择项目”**
3. **点击“新建项目”**
4. **输入项目名称**（例如 `insforge-deployment`）
5. **点击“创建”**
6. **等待项目创建完成**

#### 1.2 启用所需的 API

1. 在你的项目中，导航到 **APIs & Services** → **Library**
2. 搜索并启用以下 API：
   - **Compute Engine API**
   - **Cloud Storage API**（如果用于备份）
   - **Cloud SQL Admin API**（如果使用 Cloud SQL）

#### 1.3 创建 Compute Engine 实例

1. 导航到 **Compute Engine** → **VM instances**
2. 点击 **“Create Instance”**
3. 配置你的实例：
   - **名称**：`insforge-server`（或你偏好的名称）
   - **区域（Region）**：选择靠近你用户的区域
   - **可用区（Zone）**：选择一个可用区（例如 us-central1-a）
   - **机器配置**：
     - **系列**：N2 或 E2
     - **机器类型**：`e2-medium` 或更大配置（最低 2 vCPU、4 GB 内存）
       - 生产环境推荐：`e2-standard-2`（2 vCPU、8 GB 内存）
       - 测试环境最低要求：`e2-small`（2 vCPU、2 GB 内存）
   - **启动磁盘**：
     - **操作系统**：Ubuntu LTS（Ubuntu 22.04 LTS 或更新版本）
     - **启动磁盘类型**：均衡型永久性磁盘
     - **大小**：30 GB（最低推荐 20 GB）
   - **防火墙**：
     - 允许 HTTP 流量：**勾选**
     - 允许 HTTPS 流量：**勾选**

#### 1.4 配置防火墙规则

1. 导航到 **VPC network** → **Firewall**
2. 创建或修改防火墙规则，以允许以下端口：

| 名称 | 方向 | 目标 | 协议/端口 | 来源过滤器 |
|------|-----------|---------|-----------------|----------------|
| insforge-ssh | Ingress | insforge-server | tcp:22 | 你的 IP 地址 |
| insforge-http | Ingress | insforge-server | tcp:80 | 0.0.0.0/0 |
| insforge-https | Ingress | insforge-server | tcp:443 | 0.0.0.0/0 |
| insforge-app | Ingress | insforge-server | tcp:7130 | 0.0.0.0/0 |
| insforge-deno | Ingress | insforge-server | tcp:7133 | 0.0.0.0/0 |
| insforge-postgrest | Ingress | insforge-server | tcp:5430 | 0.0.0.0/0 |
| insforge-postgres | Ingress | insforge-server | tcp:5432 | 0.0.0.0/0（仅在外部需要访问时） |

> ⚠️ **安全提示**：在生产环境中，应将 PostgreSQL（5432）限制为特定 IP 地址访问，或完全移除外部访问权限。建议使用反向代理（nginx），仅对外暴露 80/443 端口。

### 2. 连接到你的 Compute Engine 实例

1. 在 Google Cloud 控制台中，进入 **Compute Engine** → **VM instances**
2. 找到你的实例，点击同一行中的 **SSH** 按钮，或者：

```bash
# Use gcloud CLI to SSH (if you have gcloud SDK installed locally)
gcloud compute ssh insforge-server --zone=your-zone
```

### 3. 安装依赖项

#### 3.1 更新系统软件包

```bash
sudo apt update && sudo apt upgrade -y
```

#### 3.2 安装 Docker

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

#### 3.3 将你的用户添加到 Docker 用户组

安装 Docker 后，你需要将用户添加到 `docker` 用户组，以便无需 `sudo` 即可运行 Docker 命令：

```bash
# Add your user to the docker group
sudo usermod -aG docker $USER

# Apply the group changes
newgrp docker
```

**验证是否生效：**

```bash
# This should now work without sudo
docker ps
```

> 💡 **提示**：如果 `docker ps` 没有立即生效，请通过 SSH 注销后重新登录，再试一次。

> ⚠️ **安全提示**：将用户添加到 `docker` 用户组会赋予其在系统上等同于 root 的权限。对于像你的 Compute Engine 实例这样的单用户环境来说这是可以接受的，但在共享系统上需谨慎操作。

#### 3.4 安装 Git

```bash
sudo apt install git -y
```

### 4. 部署 InsForge

#### 4.1 克隆仓库

```bash
cd ~
git clone https://github.com/insforge/insforge.git
cd insforge/deploy/docker-compose
```

#### 4.2 创建环境配置

创建包含生产环境设置的 `.env` 文件：

```bash
nano .env
```

仓库中提供了一个模板，位于 `deploy/docker-compose/.env.example`。复制该文件并编辑其中的值：

```bash
cp .env.example .env
nano .env
```

至少需要设置以下值：

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

你可能还需要设置的可选值：

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

完整的支持变量列表请参见 `deploy/docker-compose/.env.example`。

**生成安全密钥：**

```bash
# Generate JWT_SECRET (32+ characters)
openssl rand -base64 32

# Generate ENCRYPTION_KEY (32 characters)
openssl rand -base64 24
```

> 💡 **重要提示**：请妥善保存这些密钥。如果你以后需要迁移或恢复实例，将需要用到它们。

#### 4.3 启动 InsForge 服务

```bash
# Pull Docker images and start services
docker compose up -d

# View logs to ensure everything started correctly
docker compose logs -f
```

按 `Ctrl+C` 退出日志查看。

#### 4.4 验证服务

```bash
# Check running containers
docker compose ps

# You should see 4 running services:
# - postgres
# - postgrest
# - insforge
# - deno
```

### 5. 访问你的 InsForge 实例

#### 5.1 测试后端 API

```bash
curl http://your-external-ip:7130/api/health
```

预期响应：
```json
{
  "status": "ok",
  "version": "2.1.7",
  "service": "Insforge OSS Backend",
  "timestamp": "2025-10-17T..."
}
```

#### 5.2 访问仪表盘

打开浏览器并访问：
```text
http://your-external-ip:7130
```

### 6. 配置域名（可选，但推荐）

#### 6.1 保留一个静态外部 IP

1. 在 Google Cloud 控制台中，进入 **VPC network** → **External IP addresses**
2. 点击 **Reserve Static Address**
3. **名称**：`insforge-ip`
4. **类型**：Regional 或 Global（对于虚拟机实例请选择 Regional）
5. **区域**：与你的虚拟机实例相同
6. **点击 Reserve**

#### 6.2 更新 DNS 记录

将你域名的 DNS 记录指向保留的静态 IP：
```text
api.yourdomain.com    → your-static-external-ip
app.yourdomain.com    → your-static-external-ip
```

#### 6.3 安装 Nginx 反向代理

```bash
sudo apt install nginx -y
```

创建 Nginx 配置：

```bash
sudo nano /etc/nginx/sites-available/insforge
```

添加以下配置：

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

启用该配置：

```bash
sudo ln -s /etc/nginx/sites-available/insforge /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 6.4 安装 SSL 证书（推荐）

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Obtain SSL certificates
sudo certbot --nginx -d api.yourdomain.com -d app.yourdomain.com

# Follow the prompts to complete setup
```

使用 HTTPS 地址更新你的 `.env` 文件：

```bash
cd ~/insforge/deploy/docker-compose
nano .env
```

修改：
```env
API_BASE_URL=https://api.yourdomain.com
VITE_API_BASE_URL=https://api.yourdomain.com
```

重启服务：

```bash
docker compose down
docker compose up -d
```

## 🔧 管理与维护

### 查看日志

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f insforge
docker compose logs -f postgres
docker compose logs -f deno
```

### 停止服务

```bash
docker compose down
```

### 重启服务

```bash
docker compose restart
```

### 更新 InsForge

```bash
cd ~/insforge/deploy/docker-compose
git pull origin main
docker compose pull && docker compose up -d
```

### 备份数据库

```bash
# Create backup (run from deploy/docker-compose/)
docker compose exec postgres pg_dump -U postgres insforge > backup_$(date +%Y%m%d_%H%M%S).sql

# Store backup in Google Cloud Storage (optional)
# First, install Google Cloud CLI and authenticate
# Then:
gsutil cp backup_$(date +%Y%m%d_%H%M%S).sql gs://your-backup-bucket/
```

### 监控资源

```bash
# Check disk usage
df -h

# Check memory usage
free -h

# Check Docker stats
docker stats
```

## 🐛 故障排查

### 服务无法启动

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

### 无法连接到数据库

```bash
# Check if PostgreSQL is running
docker compose ps postgres

# Check PostgreSQL logs
docker compose logs postgres

# Verify credentials in .env file
cat .env | grep POSTGRES
```

### 端口已被占用

```bash
# Check what's using the port
sudo netstat -tulpn | grep :7130

# Kill the process or change port in docker-compose.yml
```

### 内存不足

考虑升级到更大的实例类型：
```text
- Current: e2-small (2 vCPU, 2 GB RAM)
- Upgrade to: e2-standard-2 (2 vCPU, 8 GB RAM)
```

### SSL 证书问题

```bash
# Renew certificates
sudo certbot renew

# Test renewal
sudo certbot renew --dry-run
```

## 📊 性能优化

### 面向生产环境的工作负载

1. **升级实例类型**：使用 `e2-standard-2` 或 `e2-standard-4`
2. **使用 Cloud SQL**：将容器化的 PostgreSQL 迁移到 Google Cloud SQL 以获得更好的可靠性
3. **启用 Cloud Monitoring**：监控指标并设置告警
4. **配置备份**：设置自动化的每日备份
5. **使用 Cloud Storage**：配置 Google Cloud Storage 用于文件上传，替代本地存储

### 数据库优化

```conf
# Increase PostgreSQL shared_buffers (edit postgresql.conf in deploy/docker-init/db/)
# Recommended: 25% of available RAM
shared_buffers = 1GB
effective_cache_size = 3GB
```

## 🔒 安全最佳实践

1. **修改默认密码**：更新管理员账户和数据库密码
2. **启用防火墙**：有效使用 Google Cloud 防火墙规则
3. **定期更新**：保持系统和 Docker 镜像为最新版本
4. **SSL/TLS**：生产环境中始终使用 HTTPS
5. **定期备份**：自动化数据库备份
6. **监控日志**：设置日志监控和告警
7. **限制 SSH 访问**：将 SSH 限制为特定 IP 地址
8. **使用服务账户**：尽可能使用服务账户而非 API 密钥

## 🆘 支持与资源

- **文档**：[https://docs.insforge.dev](https://docs.insforge.dev)
- **GitHub Issues**：[https://github.com/insforge/insforge/issues](https://github.com/insforge/insforge/issues)
- **Discord 社区**：[https://discord.com/invite/MPxwj5xVvW](https://discord.com/invite/MPxwj5xVvW)

## 📝 成本估算

**每月 Google Cloud 费用（大致估算）：**

| 组件 | 类型 | 月度费用 |
|-----------|------|--------------|
| Compute Engine | e2-medium (2 vCPU, 4 GB RAM) | ~$29 |
| Persistent Disk (30 GB) | Standard | ~$3 |
| Network Egress | 前 1GB 免费 | 视情况而定 |
| **总计** | | **~$32/月** |

> 💡 **成本优化**：对于 24/7 持续运行的实例，使用持续使用折扣（sustained use discounts）最多可节省 30%。开发/测试环境可考虑使用抢占式实例（preemptible instances）。

---

**恭喜！🎉** 你的 InsForge 实例现已在 Google Cloud Compute Engine 上运行。你可以开始通过将 AI 智能体连接到你的后端平台来构建应用程序。

有关其他生产环境部署策略，请查看我们的[部署指南](/deployment/deployment-security-guide)。
