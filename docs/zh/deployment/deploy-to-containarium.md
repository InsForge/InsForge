---
title: "将 InsForge 部署到 Containarium"
description: "在 Containarium LXC 主机上运行 InsForge，使用按租户容器、ZFS 快照和 MCP 驱动的配置，实现代理原生部署。"
---

# 将 InsForge 部署到 Containarium

本指南将逐步介绍如何在 [Containarium](https://github.com/footprintai/containarium) 主机上部署 InsForge。Containarium 是一个开源、可自托管的平台，为每个租户提供一个持久的 Linux 容器（LXC），具备一流的 SSH、MCP 和基于主机名的 TLS 原语——非常适合代理驱动的 InsForge 部署。

<Note>
  本指南由社区维护，可能落后于最新的 InsForge 版本。规范的、始终保持最新的配置位于 [InsForge 仓库](https://github.com/InsForge/InsForge)中的 `deploy/docker-compose/` 目录。
</Note>

## 何时选择 Containarium

如果你需要以下特性，Containarium 非常适合 InsForge 部署：

- **自托管的多租户基础设施**：在一台主机上运行多个相互隔离的 InsForge 项目，每个项目都在自己的 LXC 中，每个项目有一个 TLS 主机名——无需共享 `docker compose -p` 记账。
- **持久性与弹性**：基于 ZFS 的存储、每日快照并保留 30 天、在主机重启和 spot VM 终止后自动存活。
- **代理原生的控制平面**：Containarium 将其管理界面暴露为一个 MCP 服务器（`mcp-server`），并在每个容器内运行第二个 MCP（`agent-box`），因此构建你的应用的同一个代理也可以端到端地配置其后端。

## 前提条件

- 一台正在运行的 Containarium 主机。如果你还没有，[Containarium 快速入门指南](https://github.com/footprintai/containarium#quick-start)在全新的 Ubuntu 24.04 虚拟机上大约需要 5 分钟。
- 本地机器上的 `containarium` CLI，配置为可以连接到守护进程（`--server <host>:8080`），或者直接在主机上运行该 CLI。
- 一个管理员令牌（`containarium token generate --username admin --roles admin --secret-file /etc/containarium/jwt.secret`）。
- 一个你自己控制的域名，其 DNS A/CNAME 记录将所选子域名指向你的 Containarium sentinel 的公网 IP。

每个 InsForge box 的最低配置：**2 个 vCPU、4 GB 内存、30 GB 磁盘**。

## 部署

### 1. 配置一个预装 Docker 的 box

```bash
containarium create insforge \
  --stack docker \
  --memory 4GB \
  --cpu 2 \
  --disk 30GB \
  --ssh-key ~/.ssh/id_ed25519.pub
```

`--stack docker` 标志会在容器内安装 Docker CE 和 compose 插件。配置你的 SSH，使 `ssh insforge` 可用：

```bash
containarium ssh-config sync
# Then add one line to ~/.ssh/config:
#   Include ~/.containarium/ssh_config
ssh insforge
```

### 2. 在 box 内克隆 InsForge

```bash
ssh insforge <<'EOF'
  git clone https://github.com/InsForge/InsForge.git ~/insforge
  cd ~/insforge/deploy/docker-compose
  cp .env.example .env
EOF
```

### 3. 配置环境

在 box 内编辑 `~/insforge/deploy/docker-compose/.env`。至少需要设置：

```env
JWT_SECRET=<32+ char random string — `openssl rand -base64 32`>
ENCRYPTION_KEY=<24+ char random string — `openssl rand -base64 24`>
POSTGRES_PASSWORD=<strong password>
ROOT_ADMIN_USERNAME=admin
ROOT_ADMIN_PASSWORD=<change this>

API_BASE_URL=https://<your-subdomain>
VITE_API_BASE_URL=https://<your-subdomain>
```

完整列表（OpenRouter、OAuth 提供商、Stripe、Vercel）请参见 [`deploy/docker-compose/.env.example`](https://github.com/insforge/insforge/blob/main/deploy/docker-compose/.env.example)。

> **密钥处理：** 对于生产环境，优先使用 Containarium 的 tmpfs 密钥（`--delivery=file`；参见 [Containarium 的密钥操作文档](https://github.com/footprintai/Containarium/blob/main/docs/SECRETS-OPERATIONS.md)）。这些密钥以 0440 文件的形式交付到 tmpfs 上，永远不会出现在 `/proc/<pid>/environ` 中。通过使用 `env_file:` 的 compose 覆盖文件将它们接入 compose 堆栈。

### 4. 启动 InsForge 并启用自动启动

你可以手动启动一次：

```bash
ssh insforge 'cd ~/insforge/deploy/docker-compose && docker compose up -d'
```

……或者——推荐做法——将其接入 Containarium 的 compose 自动启动，使堆栈在主机重启后仍能存活：

```bash
containarium compose enable insforge --dir /home/insforge/insforge/deploy/docker-compose
```

这会在 box 内安装一个 systemd-user 单元，在每次容器启动时拉起堆栈，并在失败时带退避重试地重启服务。使用以下命令验证：

```bash
containarium compose status insforge
```

你应该会看到 `4/4 services up`：`postgres`、`postgrest`、`insforge`、`deno`。（compose 文件为 `postgres`、`postgrest` 和 `deno` 提供了健康检查；`insforge` 会在其他服务健康且自身已启动后报告 `Up`。）

### 5. 通过公共主机名对外暴露

InsForge 默认在 7130 端口提供仪表盘和 API 服务。

```bash
containarium expose-port insforge \
  --container-port 7130 \
  --domain <your-subdomain>
```

这会将 Containarium sentinel 上的 Caddy 配置为终止 `<your-subdomain>` 的 TLS 并转发到 InsForge 容器。证书会在首次请求时通过 ACME 自动配置——无需 certbot，无需 nginx 配置。

验证：

```bash
curl https://<your-subdomain>/api/health
```

预期结果：

```json
{
  "status": "ok",
  "version": "2.x.x",
  "service": "Insforge OSS Backend",
  "timestamp": "..."
}
```

### 6. 将你的代理连接到 InsForge MCP

在浏览器中打开 `https://<your-subdomain>`，按照产品内的流程将你的支持 MCP 的代理（Cursor、Claude Code、Windsurf、OpenCode 等）连接到 InsForge MCP 服务器。

通过向你的代理发送以下提示来验证连接：

```text
I'm using InsForge as my backend platform, call InsForge MCP's
fetch-docs tool to learn about InsForge instructions.
```

## 代理驱动的部署（可选）

由于 Containarium 将其管理界面暴露为一个 MCP 服务器（`mcp-server`），并在每个容器内运行第二个 MCP（`agent-box`），一个支持 MCP 的代理可以端到端地完成整个部署：

```text
agent: create me a container called 'insforge'
  → mcp__containarium__create_container(
      username="insforge", cpu="2", memory="4GB",
      disk="30GB", stack="docker")

agent: clone InsForge, fill in .env
  → ssh insforge agent-box
    → shell_exec("git clone https://github.com/InsForge/InsForge.git ~/insforge")
    → write_file("~/insforge/deploy/docker-compose/.env", "<contents>")

agent: enable autostart
  → mcp__containarium__compose_enable(
      username="insforge",
      dir="/home/insforge/insforge/deploy/docker-compose")

agent: expose on a public hostname
  → mcp__containarium__expose_port(
      username="insforge",
      container_port=7130,
      domain="<your-subdomain>")
```

有关平台 MCP 工具目录，请参见 Containarium 的 [`docs/MCP-INTEGRATION.md`](https://github.com/footprintai/Containarium/blob/main/docs/MCP-INTEGRATION.md)。

## 多租户：每台主机上运行多个 InsForge 项目

每个项目都有自己的 LXC 和自己的主机名；sentinel 按 SNI 路由。不会发生端口冲突（每个容器都有自己的网络命名空间），也不会共享 compose 项目名称。

```bash
containarium create insforge-acme  --stack docker --memory 4GB --cpu 2 ...
containarium create insforge-globex --stack docker --memory 4GB --cpu 2 ...

containarium expose-port insforge-acme   --container-port 7130 \
  --domain acme.<your-domain>
containarium expose-port insforge-globex --container-port 7130 \
  --domain globex.<your-domain>
```

每个项目都有各自隔离的 postgres / storage / deno 卷。

## 管理

### 查看日志

```bash
ssh insforge 'cd ~/insforge/deploy/docker-compose && docker compose logs -f'
```

或按服务查看：`docker compose logs -f insforge` / `postgres` / `deno`。

### 更新 InsForge

```bash
ssh insforge <<'EOF'
  cd ~/insforge/deploy/docker-compose
  git -C ~/insforge pull origin main
  docker compose pull
  docker compose up -d
EOF
```

如果已启用 compose 自动启动，则无需重新启用该单元——它跟踪的是目录，而不是特定的镜像标签。

### 备份数据库

```bash
ssh insforge 'cd ~/insforge/deploy/docker-compose && docker compose exec -T postgres \
  pg_dump -U postgres insforge' > backup_$(date +%Y%m%d_%H%M%S).sql
```

Containarium 还会通过 ZFS 每日为整个容器创建快照（默认保留 30 天），作为覆盖 postgres 数据卷的时间点恢复后备方案。

### 停止 / 重启

```bash
containarium compose disable insforge   # stop the compose stack and disable autostart
containarium sleep insforge             # stop the entire box
containarium wake insforge              # start the box; compose comes up via autostart
```

## 故障排除

### `containarium compose enable` 失败

验证 box 内的 Docker 是否正常工作：

```bash
ssh insforge 'docker ps'
```

如果你在创建时跳过了 `--stack docker`，请在 box 内手动安装它，或者带上该标志重新创建。

### 公共主机名无法解析

`containarium expose-port` 会配置 sentinel 上的 Caddy；你的子域名的 DNS A/CNAME 记录必须指向 sentinel 的公网 IP。检查方法：

```bash
dig +short <your-subdomain>
```

### 主机名可以解析但返回 502

检查从 box 内部是否可以访问 InsForge：

```bash
ssh insforge 'curl -s http://localhost:7130/api/health'
```

如果 box 内的检查正常，那么下一步要排查的就是 sentinel 与 box 之间的桥接——参见 Containarium 的 [`docs/TUNNEL-REVERSE-PROXY.md`](https://github.com/footprintai/Containarium/blob/main/docs/TUNNEL-REVERSE-PROXY.md)。

### `docker compose up` 之后内存不足

InsForge 的四个服务在空闲时大约需要 3 GB 常驻内存。如果你将 box 配置为 2 GB，请调整大小：

```bash
containarium resize insforge --memory 4GB
containarium sleep insforge && containarium wake insforge
```

## 限制

- **AUTH_PORT（7131）和 DENO_PORT（7133）** 不会通过上述步骤对外暴露。如果你的应用需要从 box 外部调用独立的认证端点或直接的 Deno 函数 URL，请添加带有独立子域名的额外 `expose-port` 调用。
- **`containarium compose enable` 需要 Containarium v0.18 或更高版本**（compose 自动启动功能）。在更早的版本上，请运行 `docker compose up -d` 并手动添加一个 `@reboot` cron 条目。
- **GPU 直通**：Containarium 支持它，但 InsForge 内置的边缘函数不使用 GPU。除非你的自定义 Deno 函数需要 GPU，否则请保持关闭。

## 安全说明

- 容器的用户在主机上是非特权的（LXC 非特权模式）；容器 root 不等于主机 root。
- sentinel 前端支持针对管理端点的源 IP 白名单——参见 Containarium 的[安全运维手册](https://github.com/footprintai/Containarium/blob/main/docs/security/OPERATOR-SECURITY-RUNBOOK.md)。
- 对于生产环境，请选择使用 Containarium 的 KMS 信封加密（Vault Transit 或 GCP KMS）来保护存储在 Containarium 密钥库中的任何 InsForge 密钥。
- 使用 `containarium token generate --scopes containers:read,containers:write ...` 为代理生成最小权限令牌，而不是分发管理员令牌。

## 资源

- **Containarium**：https://github.com/footprintai/containarium
- **Containarium 文档**：https://github.com/footprintai/Containarium/tree/main/docs
- **InsForge 文档**：https://docs.insforge.dev
- **InsForge Discord**：https://discord.com/invite/MPxwj5xVvW

---

有关其他部署策略，请参见[部署指南](/deployment/deployment-security-guide)。
