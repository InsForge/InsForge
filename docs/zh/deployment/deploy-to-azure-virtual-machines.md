# 📖 将 InsForge 部署到 Azure 虚拟机（扩展指南）

本指南提供了在 Azure 虚拟机（VM）上使用 Docker Compose 部署、管理和保护 InsForge 的全面、逐步说明。

<Note>
  本云端演练由社区维护，可能落后于最新的 InsForge 版本。规范的、始终保持最新的配置位于 [InsForge 仓库](https://github.com/InsForge/InsForge)中的 `deploy/docker-compose/` 目录。
</Note>

## 前提条件

* 一个有效的 **Azure 账户**。
* 一个用于连接虚拟机的 **SSH 客户端**。
* 对 **Linux 命令行**的基本熟悉程度。

---

## 第 1 步：🖥️ 创建 Azure 虚拟机

1.  **登录 [Azure 门户](https://portal.azure.com/)**，然后导航到**虚拟机**。
2.  点击 **+ 创建** > **Azure 虚拟机**。
3.  **基本信息标签页：**
    * **资源组：** 创建一个新的（例如 `insforge-rg`）。
    * **虚拟机名称：** `insforge-vm`。
    * **镜像：** **Ubuntu Server 22.04 LTS** 或更新版本。
    * **大小：** `Standard_B2s`（2 个 vCPU，4 GiB 内存）是一个不错的起点。对于生产环境，考虑使用 `Standard_B4ms`（4 个 vCPU，16 GiB 内存）。
    * **身份验证类型：** **SSH 公钥**。
    * **SSH 公钥来源：** **生成新的密钥对**。将其命名为 `insforge-key`。
4.  **网络标签页：**
    * 在**网络安全组**部分，点击**新建**。
    * 添加以下**入站端口规则**以允许流量：
        * `22`（SSH）
        * `80`（Nginx 的 HTTP）
        * `443`（Nginx/SSL 的 HTTPS）
        * `7130`（InsForge API 和仪表盘）
5.  **审阅并创建：**
    * 点击**审阅 + 创建**，然后点击**创建**。
    * 出现提示时，**下载私钥并创建资源**。请妥善保存 `.pem` 文件。
    * 部署完成后，找到并复制你的虚拟机的**公网 IP 地址**。

---

## 第 2 步：⚙️ 连接并设置服务器

1.  **通过 SSH 连接：**
    打开终端，为你的密钥设置正确的权限，然后连接到虚拟机。

    ```bash
    chmod 400 /path/to/your/insforge-key.pem
    ssh -i /path/to/your/insforge-key.pem azureuser@<your-vm-public-ip>
    ```

2.  **更新系统软件包：**
    ```bash
    sudo apt update && sudo apt upgrade -y
    ```

3.  **安装 Docker：**
    请遵循 Docker 官网上最新的官方说明，在 Ubuntu 上安装 Docker Engine：
    **[https://docs.docker.com/engine/install/ubuntu/](https://docs.docker.com/engine/install/ubuntu/)**

4.  **将你的用户添加到 Docker 组：**
    此步骤允许你在不使用 `sudo` 的情况下运行 Docker 命令。

    ```bash
    # Add your user to the docker group
    sudo usermod -aG docker $USER

    # Apply the group changes
    newgrp docker
    ```
    验证它是否有效。此命令现在应该可以在不使用 `sudo` 的情况下运行：
    ```bash
    docker ps
    ```
    > 💡 **提示：** 如果 `docker ps` 不起作用，请退出你的 SSH 会话并重新登录，然后再试一次。
    >
    > ⚠️ **安全提示：** 将用户添加到 `docker` 组会授予其相当于 root 的权限。这在单用户虚拟机上是可以接受的，但在共享系统上要谨慎。

5.  **安装 Git：**
    ```bash
    sudo apt install git -y
    ```

---

## 第 3 步：🚀 部署 InsForge

1.  **克隆仓库：**
    导航到你的主目录并克隆 InsForge 项目。
    ```bash
    cd ~
    git clone https://github.com/InsForge/InsForge.git
    cd InsForge/deploy/docker-compose
    ```

2.  **创建环境配置：**
    从示例文件创建你的 `.env` 文件并打开以进行编辑。
    ```bash
    cp .env.example .env
    nano .env
    ```
    `.env.example` 列出了所有支持的变量并附有注释。对于基本部署，你只需要设置少数几项。设置以下值，并将 API URL 更新为你的虚拟机的公网 IP：

    ```ini
    # Required
    JWT_SECRET=your-secret-key-here-must-be-32-char-or-above
    ROOT_ADMIN_USERNAME=admin
    ROOT_ADMIN_PASSWORD=change-this-password
    POSTGRES_PASSWORD=change-this-password

    # API URLs (replace with your VM public IP or domain)
    API_BASE_URL=http://<your-vm-public-ip>:7130
    VITE_API_BASE_URL=http://<your-vm-public-ip>:7130

    # Optional
    # ENCRYPTION_KEY falls back to JWT_SECRET if left empty
    ENCRYPTION_KEY=
    # OPENROUTER_API_KEY=
    # VERCEL_TOKEN=
    # GOOGLE_CLIENT_ID=
    ```
    `.env.example` 的其余部分涵盖了可选功能（OpenRouter、Vercel 部署、OAuth 提供商）。除非你需要它们，否则将这些留空。
    > **生成一个安全的 JWT 密钥：** 在你的虚拟机上运行以下命令，并将结果粘贴到 `JWT_SECRET` 中：
    > ```bash
    > openssl rand -base64 32
    > ```

3.  **启动 InsForge 服务：**
    拉取 Docker 镜像并在后台启动所有服务。
    ```bash
    docker compose up -d
    ```

4.  **验证服务：**
    检查所有四个容器是否都在运行。
    ```bash
    docker compose ps
    ```
    你应该会看到 `postgres`、`postgrest`、`insforge` 和 `deno` 服务正在运行。

---

## 第 4 步：🔑 访问你的 InsForge 实例

1.  **测试后端 API：**
    使用 `curl` 检查健康检查端点。
    ```bash
    curl http://<your-vm-public-ip>:7130/api/health
    ```
    你应该会看到类似这样的响应：`{"status":"ok", ...}`

2.  **访问仪表盘：**
    打开浏览器并导航到：`http://<your-vm-public-ip>:7130`
    使用你在 `.env` 文件中设置的 `ROOT_ADMIN_USERNAME` 和 `ROOT_ADMIN_PASSWORD` 登录。

---

## 第 5 步：🌐 配置域名（可选但推荐）

1.  **更新 DNS 记录：**
    在你的域名提供商的 DNS 设置中，添加两条指向你的虚拟机公网 IP 地址的 **A 记录**：
    * `api.yourdomain.com` → `<your-vm-public-ip>`
    * `app.yourdomain.com` → `<your-vm-public-ip>`

2.  **安装并配置 Nginx 作为反向代理：**
    ```bash
    sudo apt install nginx -y
    sudo nano /etc/nginx/sites-available/insforge
    ```
    粘贴以下配置：
    ```nginx
    # Backend API
    server {
        listen 80;
        server_name api.yourdomain.com;
        location / {
            proxy_pass http://localhost:7130;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
    # Frontend Dashboard (served by the same port as the API)
    server {
        listen 80;
        server_name app.yourdomain.com;
        location / {
            proxy_pass http://localhost:7130;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
        }
    }
    ```
    启用该配置并重新加载 Nginx：
    ```bash
    sudo ln -s /etc/nginx/sites-available/insforge /etc/nginx/sites-enabled/
    sudo nginx -t
    sudo systemctl reload nginx
    ```

3.  **使用 Certbot 安装 SSL 证书：**
    ```bash
    # Install Certbot for Nginx
    sudo apt install certbot python3-certbot-nginx -y
    # Obtain SSL certificates and configure Nginx automatically
    sudo certbot --nginx -d api.yourdomain.com -d app.yourdomain.com
    ```
    按照提示操作。Certbot 会处理剩下的一切。

4.  **使用 HTTPS URL 更新 `.env`：**
    编辑你的 `.env` 文件并更新 URL。
    ```bash
    cd ~/InsForge
    nano .env
    ```
    将 URL 更改为 `https`：
    ```ini
    API_BASE_URL=https://api.yourdomain.com
    VITE_API_BASE_URL=https://api.yourdomain.com
    ```
    重启服务以使更改生效：
    ```bash
    docker compose down && docker compose up -d
    ```

---

## 🔧 管理与维护

* **查看日志：** `docker compose logs -f`（所有服务）或 `docker compose logs -f insforge`（指定服务）。
* **停止服务：** `docker compose down`
* **重启服务：** `docker compose restart`
* **更新 InsForge：** 从 `~/InsForge/deploy/docker-compose` 运行以下命令。镜像是预先构建好的，因此拉取最新标签即可，无需重新构建。
    ```bash
    cd ~/InsForge/deploy/docker-compose
    git -C ~/InsForge pull origin main
    docker compose pull && docker compose up -d
    ```
* **备份数据库：** 从 `~/InsForge/deploy/docker-compose` 运行。
    ```bash
    docker compose exec postgres pg_dump -U postgres insforge > backup_$(date +%Y%m%d_%H%M%S).sql
    ```

## 🐛 故障排除

* **服务无法启动：** 检查 `docker compose logs` 中的错误。确保你有足够的磁盘空间（`df -h`）和内存（`free -h`）。
* **端口已被占用：** 使用 `sudo netstat -tulpn | grep :7130` 检查哪个进程正在使用该端口。
* **内存不足：** 考虑将你的 Azure 虚拟机升级到内存更大的规格。

## 📊 成本估算

> **免责声明：** 价格是基于常见地区（例如美国东部）按需付费费率的估算值，可能会有所不同。请始终查看官方的 [Azure 定价计算器](https://azure.microsoft.com/en-us/pricing/calculator/)以获取最准确的信息。在 Azure 上，你需要为虚拟机的资源（CPU、内存、存储）付费，而这些资源由你在其上运行的所有 Docker 服务共享。

### 免费套餐（用于测试）
* **成本：** 前 12 个月约 **0 美元/月**。
* **资源：** Azure 提供一个免费套餐，包括每月 750 小时的 `B1s` 突发性能虚拟机。
* **限制：** 这台虚拟机的资源非常有限（1 个 vCPU，1 GiB 内存），运行可能会很慢。它仅适合基本测试和熟悉环境，不适合活跃开发或生产环境。

### 入门配置（用于开发和小型项目）
* **成本：** 约 **30 - 40 美元/月**
* **资源：** 此估算适用于运行所有 InsForge Docker 容器的 `Standard_B2s` 虚拟机（2 个 vCPU，4 GiB 内存）。
* **明细：** 成本主要包括虚拟机计算时长。它还包括操作系统磁盘存储和一个静态公网 IP 地址。这一台虚拟机运行你的数据库、后端、Deno 以及所有其他服务。

### 生产配置（用于可扩展性和可靠性）
对于生产环境，你可以在一个更大的一体化虚拟机和一个使用托管服务的更强健的配置之间进行选择。

* **选项 A：更大的一体化虚拟机**
    * **成本：** 约 **150 - 170 美元/月**
    * **资源：** 一台更强大的 `Standard_B4ms` 虚拟机（4 个 vCPU，16 GiB 内存），以处理更高的流量和所有服务。
    * **优点：** 易于管理，成本合并统一。
    * **缺点：** 数据库和应用程序共享资源，可能造成性能瓶颈。扩展需要升级整台虚拟机。

* **选项 B：托管服务（推荐用于生产环境）**
    * **成本：** 约 **120 美元以上/月**（变化很大）
    * **资源：**
        * **应用程序虚拟机：** 用于应用服务（InsForge、PostgREST、Deno）的 `Standard_B2s` 虚拟机。`（约 30 美元/月）`
        * **托管数据库：** 使用 **Azure Database for PostgreSQL** 以获得可靠性、自动备份和可扩展性。`（入门套餐约 40 美元以上/月）`
    * **优点：** 高度可靠且可扩展。数据库性能是隔离且有保障的。托管备份和安全性。
    * **缺点：** 配置更复杂，成本分布在多个服务上。

## 🔒 安全最佳实践

* **更改默认密码：** 始终更新管理员和数据库密码。
* **启用防火墙：** 使用 Azure **网络安全组（NSG）**限制对必要端口和 IP 地址的访问。
* **定期更新：** 定期运行 `sudo apt update && sudo apt upgrade -y` 并更新 InsForge。
* **定期备份：** 自动化数据库和配置的备份。
