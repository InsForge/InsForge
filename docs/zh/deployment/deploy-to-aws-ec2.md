---
title: "将 InsForge 部署到 AWS EC2"
description: "在 AWS EC2 实例上使用 Docker Compose 部署 InsForge 的分步指南，包括 SSH 设置、域名配置和 TLS 终止。"
---

# 将 InsForge 部署到 AWS EC2

本指南将带你使用 Docker Compose 在 AWS EC2 实例上部署 InsForge。

<Note>
  本云端部署指南由社区维护，可能滞后于最新的 InsForge 版本。最权威、始终保持最新的配置位于 [InsForge 仓库](https://github.com/InsForge/InsForge) 中的 `deploy/docker-compose/` 目录。
</Note>

## 📋 前置条件

- 具备 EC2 访问权限的 AWS 账户
- 具备 SSH 和命令行操作的基础知识
- 域名（可选，用于自定义域名设置）

## 🚀 部署步骤

### 1. 创建并配置 EC2 实例

#### 1.1 启动 EC2 实例

1. **登录 AWS 控制台**并导航到 EC2 仪表盘
2. **点击“Launch Instance”**
3. **配置实例：**
   - **名称**：`insforge-server`（或你偏好的名称）
   - **AMI**：Ubuntu Server 24.04 LTS (HVM)，SSD 卷类型
   - **实例类型**：`t3.medium` 或更大配置（最低 2 vCPU、4 GB 内存）
     - 生产环境推荐：`t3.large`（2 vCPU、8 GB 内存）
     - 测试环境最低要求：`t3.small`（2 vCPU、2 GB 内存）
   - **密钥对**：创建新密钥对或选择现有密钥对（下载并保存 `.pem` 文件）
   - **存储**：30 GB gp3（最低推荐 20 GB）

#### 1.2 配置安全组

创建或配置具有以下入站规则的安全组：

| 类型        | 协议 | 端口范围 | 来源    | 描述          |
|-------------|----------|------------|-----------|----------------------|
| SSH         | TCP      | 22         | My IP     | SSH 访问           |
| HTTP        | TCP      | 80         | 0.0.0.0/0 | HTTP 访问          |
| HTTPS       | TCP      | 443        | 0.0.0.0/0 | HTTPS 访问         |
| Custom TCP  | TCP      | 7130       | 0.0.0.0/0 | 仪表盘 + API      |
| Custom TCP  | TCP      | 5432       | 0.0.0.0/0 | PostgreSQL（可选）|

> ⚠️ **安全提示**：在生产环境中，应将 PostgreSQL（5432）限制为特定 IP 地址访问，或完全移除外部访问权限。建议使用反向代理（nginx），仅对外暴露 80/443 端口。

#### 1.3 分配弹性 IP（推荐）

1. 在 EC2 仪表盘中导航到 **Elastic IPs**
2. 点击 **Allocate Elastic IP address**
3. 将该弹性 IP 与你的实例关联

这样可以确保你的实例即使在重启后也能保持相同的 IP 地址。

### 2. 连接到你的 EC2 实例

```bash
# Set correct permissions for your key file
chmod 400 your-key-pair.pem

# Connect via SSH
ssh -i your-key-pair.pem ubuntu@your-ec2-public-ip
```

### 3. 安装依赖项

#### 3.1 更新系统软件包

```bash
sudo apt update && sudo apt upgrade -y
```

#### 3.2 安装 Docker

```text
Follow the instructions of the link below to install and verify docker on your new ubuntu ec2 instance:
https://docs.docker.com/engine/install/ubuntu/
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

> ⚠️ **安全提示**：将用户添加到 `docker` 用户组会赋予其在系统上等同于 root 的权限。对于像你的 EC2 实例这样的单用户环境来说这是可以接受的，但在共享系统上需谨慎操作。

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

复制示例模板以创建你的 `.env` 文件：

```bash
cp .env.example .env
nano .env
```

完整模板位于 `deploy/docker-compose/.env.example`。以下是你必须设置的变量：

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

`.env.example` 模板中包含了其余变量及其默认值，因此编辑复制出来的文件就足够了。

**生成安全密钥：**

```bash
# Generate JWT_SECRET (32+ characters)
openssl rand -base64 32

# Generate ENCRYPTION_KEY (must be exactly 32 characters)
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
curl http://your-ec2-ip:7130/api/health
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
http://your-ec2-ip:7130
```

使用你在 `.env` 中设置的 `ROOT_ADMIN_USERNAME` 和 `ROOT_ADMIN_PASSWORD` 登录。

### 6. 配置域名（可选，但推荐）

#### 6.1 更新 DNS 记录

添加指向你 EC2 弹性 IP 的 DNS A 记录：
```text
api.yourdomain.com    → your-ec2-ip
app.yourdomain.com    → your-ec2-ip
```

#### 6.2 安装 Nginx 反向代理

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

启用该配置：

```bash
sudo ln -s /etc/nginx/sites-available/insforge /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 6.3 安装 SSL 证书（推荐）

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

InsForge 发布的是预构建镜像，因此更新只需拉取镜像并重启。请在 `~/insforge/deploy/docker-compose` 下运行以下命令：

```bash
cd ~/insforge/deploy/docker-compose
git pull origin main
docker compose pull && docker compose up -d
```

### 备份数据库

请在 `~/insforge/deploy/docker-compose` 下运行以下命令：

```bash
# Create backup
docker compose exec postgres pg_dump -U postgres insforge > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore from backup
cat backup_file.sql | docker compose exec -T postgres psql -U postgres -d insforge
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
- Current: t3.medium (4 GB RAM)
- Upgrade to: t3.large (8 GB RAM)
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

1. **升级实例类型**：使用 `t3.large` 或 `t3.xlarge`
2. **启用自动扩缩容**：设置带自动扩缩容组的应用负载均衡器（Application Load Balancer）
3. **使用 RDS**：将容器化的 PostgreSQL 迁移到 AWS RDS 以获得更好的可靠性
4. **启用 CloudWatch**：监控指标并设置告警
5. **配置备份**：设置自动化的每日备份
6. **使用 S3 进行存储**：配置 S3 存储桶用于文件上传，替代本地存储

### 数据库优化

```conf
# Increase PostgreSQL shared_buffers (edit postgresql.conf in deploy/docker-init/db/)
# Recommended: 25% of available RAM
shared_buffers = 1GB
effective_cache_size = 3GB
```

## 🔒 安全最佳实践

1. **修改默认密码**：更新管理员账户和数据库密码
2. **启用防火墙**：有效使用 AWS 安全组
3. **定期更新**：保持系统和 Docker 镜像为最新版本
4. **SSL/TLS**：生产环境中始终使用 HTTPS
5. **定期备份**：自动化数据库备份
6. **监控日志**：设置日志监控和告警
7. **限制 SSH 访问**：将 SSH 限制为特定 IP 地址
8. **使用 IAM 角色**：尽可能使用 IAM 角色而非 AWS 访问密钥

## 🆘 支持与资源

- **文档**：[https://docs.insforge.dev](https://docs.insforge.dev)
- **GitHub Issues**：[https://github.com/insforge/insforge/issues](https://github.com/insforge/insforge/issues)
- **Discord 社区**：[https://discord.com/invite/MPxwj5xVvW](https://discord.com/invite/MPxwj5xVvW)

## 📝 成本估算

**每月 AWS 费用（大致估算）：**

| 组件 | 类型 | 月度费用 |
|-----------|------|--------------|
| EC2 Instance | t3.medium | ~$30 |
| Storage (30 GB) | EBS gp3 | ~$3 |
| Elastic IP | （若 24/7 运行） | $0 |
| Data Transfer | 前 100GB 免费 | 视情况而定 |
| **总计** | | **~$33/月** |

> 💡 **成本优化**：对于长期部署，使用 AWS Savings Plans 或预留实例（Reserved Instances）最多可节省 70%。

---

**恭喜！🎉** 你的 InsForge 实例现已在 AWS EC2 上运行。你可以开始通过将 AI 智能体连接到你的后端平台来构建应用程序。

有关其他生产环境部署策略，请查看我们的[部署指南](/deployment/deployment-security-guide)。
