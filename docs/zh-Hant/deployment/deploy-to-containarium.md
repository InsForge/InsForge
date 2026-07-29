---
title: "將 InsForge 部署到 Containarium"
description: "在 Containarium LXC 伺服器上執行 InsForge，使用按租戶容器、ZFS 快照和 MCP 驅動的設定，實現代理原生部署。"
---

# 將 InsForge 部署到 Containarium

本指南將逐步介紹如何在 [Containarium](https://github.com/footprintai/containarium) 伺服器上部署 InsForge。Containarium 是一個開源、可自架的平台，為每個租戶提供一個持久的 Linux 容器（LXC），具備一流的 SSH、MCP 和基於主機名稱的 TLS 原語——非常適合代理驅動的 InsForge 部署。

<Note>
  本指南由社群維護，可能落後於最新的 InsForge 版本。標準的、始終保持最新的設定位於 [InsForge 儲存庫](https://github.com/InsForge/InsForge)中的 `deploy/docker-compose/` 目錄。
</Note>

## 何時選擇 Containarium

如果你需要以下特性，Containarium 非常適合 InsForge 部署：

- **自架的多租戶基礎設施**：在一台伺服器上執行多個相互隔離的 InsForge 專案，每個專案都在自己的 LXC 中，每個專案有一個 TLS 主機名稱——無需共用 `docker compose -p` 記帳。
- **持久性與韌性**：基於 ZFS 的儲存、每日快照並保留 30 天、在伺服器重新開機和 spot 虛擬機器終止後自動存活。
- **代理原生的控制平面**：Containarium 將其管理介面公開為一個 MCP 伺服器（`mcp-server`），並在每個容器內執行第二個 MCP（`agent-box`），因此建構你的應用程式的同一個代理也可以端到端地設定其後端。

## 先決條件

- 一台正在執行的 Containarium 伺服器。如果你還沒有，[Containarium 快速入門指南](https://github.com/footprintai/containarium#quick-start)在全新的 Ubuntu 24.04 虛擬機器上大約需要 5 分鐘。
- 本機上的 `containarium` CLI，設定為可以連接到守護行程（`--server <host>:8080`），或者直接在伺服器上執行該 CLI。
- 一個管理員權杖（`containarium token generate --username admin --roles admin --secret-file /etc/containarium/jwt.secret`）。
- 一個你自己控制的網域，其 DNS A/CNAME 記錄將所選子網域指向你的 Containarium sentinel 的公開 IP。

每個 InsForge box 的最低規格：**2 個 vCPU、4 GB 記憶體、30 GB 磁碟**。

## 部署

### 1. 佈建一個預先安裝 Docker 的 box

```bash
containarium create insforge \
  --stack docker \
  --memory 4GB \
  --cpu 2 \
  --disk 30GB \
  --ssh-key ~/.ssh/id_ed25519.pub
```

`--stack docker` 旗標會在容器內安裝 Docker CE 和 compose 外掛程式。設定你的 SSH，使 `ssh insforge` 可以運作：

```bash
containarium ssh-config sync
# Then add one line to ~/.ssh/config:
#   Include ~/.containarium/ssh_config
ssh insforge
```

### 2. 在 box 內複製 InsForge

```bash
ssh insforge <<'EOF'
  git clone https://github.com/InsForge/InsForge.git ~/insforge
  cd ~/insforge/deploy/docker-compose
  cp .env.example .env
EOF
```

### 3. 設定環境

在 box 內編輯 `~/insforge/deploy/docker-compose/.env`。至少需要設定：

```env
JWT_SECRET=<32+ char random string — `openssl rand -base64 32`>
ENCRYPTION_KEY=<24+ char random string — `openssl rand -base64 24`>
POSTGRES_PASSWORD=<strong password>
ROOT_ADMIN_USERNAME=admin
ROOT_ADMIN_PASSWORD=<change this>

API_BASE_URL=https://<your-subdomain>
VITE_API_BASE_URL=https://<your-subdomain>
```

完整清單（OpenRouter、OAuth 提供者、Stripe、Vercel）請參閱 [`deploy/docker-compose/.env.example`](https://github.com/insforge/insforge/blob/main/deploy/docker-compose/.env.example)。

> **密鑰處理：** 對於正式環境，優先使用 Containarium 的 tmpfs 密鑰（`--delivery=file`；參閱 [Containarium 的密鑰操作文件](https://github.com/footprintai/Containarium/blob/main/docs/SECRETS-OPERATIONS.md)）。這些密鑰以 0440 檔案的形式交付到 tmpfs 上，永遠不會出現在 `/proc/<pid>/environ` 中。透過使用 `env_file:` 的 compose 覆寫檔案將它們接入 compose 堆疊。

### 4. 啟動 InsForge 並啟用自動啟動

你可以手動啟動一次：

```bash
ssh insforge 'cd ~/insforge/deploy/docker-compose && docker compose up -d'
```

……或者——建議做法——將其接入 Containarium 的 compose 自動啟動，使堆疊在伺服器重新開機後仍能存活：

```bash
containarium compose enable insforge --dir /home/insforge/insforge/deploy/docker-compose
```

這會在 box 內安裝一個 systemd-user 單元，在每次容器啟動時拉起堆疊，並在失敗時帶退避重試地重新啟動服務。使用以下命令驗證：

```bash
containarium compose status insforge
```

你應該會看到 `4/4 services up`：`postgres`、`postgrest`、`insforge`、`deno`。（compose 檔案為 `postgres`、`postgrest` 和 `deno` 提供了健康檢查；`insforge` 會在其他服務健康且自身已啟動後回報 `Up`。）

### 5. 透過公開主機名稱對外公開

InsForge 預設在 7130 埠提供儀表板和 API 服務。

```bash
containarium expose-port insforge \
  --container-port 7130 \
  --domain <your-subdomain>
```

這會將 Containarium sentinel 上的 Caddy 設定為終止 `<your-subdomain>` 的 TLS 並轉發到 InsForge 容器。憑證會在第一次請求時透過 ACME 自動配置——無需 certbot，無需 nginx 設定。

驗證：

```bash
curl https://<your-subdomain>/api/health
```

預期結果：

```json
{
  "status": "ok",
  "version": "2.x.x",
  "service": "Insforge OSS Backend",
  "timestamp": "..."
}
```

### 6. 將你的代理連接到 InsForge MCP

在瀏覽器中開啟 `https://<your-subdomain>`，依照產品內的流程將你的支援 MCP 的代理（Cursor、Claude Code、Windsurf、OpenCode 等）連接到 InsForge MCP 伺服器。

透過向你的代理傳送以下提示來驗證連線：

```text
I'm using InsForge as my backend platform, call InsForge MCP's
fetch-docs tool to learn about InsForge instructions.
```

## 代理驅動的部署（可選）

由於 Containarium 將其管理介面公開為一個 MCP 伺服器（`mcp-server`），並在每個容器內執行第二個 MCP（`agent-box`），一個支援 MCP 的代理可以端到端地完成整個部署：

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

有關平台 MCP 工具目錄，請參閱 Containarium 的 [`docs/MCP-INTEGRATION.md`](https://github.com/footprintai/Containarium/blob/main/docs/MCP-INTEGRATION.md)。

## 多租戶：每台伺服器執行多個 InsForge 專案

每個專案都有自己的 LXC 和自己的主機名稱；sentinel 依 SNI 路由。不會發生連接埠衝突（每個容器都有自己的網路命名空間），也不會共用 compose 專案名稱。

```bash
containarium create insforge-acme  --stack docker --memory 4GB --cpu 2 ...
containarium create insforge-globex --stack docker --memory 4GB --cpu 2 ...

containarium expose-port insforge-acme   --container-port 7130 \
  --domain acme.<your-domain>
containarium expose-port insforge-globex --container-port 7130 \
  --domain globex.<your-domain>
```

每個專案都有各自隔離的 postgres / storage / deno 磁碟區。

## 管理

### 檢視記錄檔

```bash
ssh insforge 'cd ~/insforge/deploy/docker-compose && docker compose logs -f'
```

或依服務檢視：`docker compose logs -f insforge` / `postgres` / `deno`。

### 更新 InsForge

```bash
ssh insforge <<'EOF'
  cd ~/insforge/deploy/docker-compose
  git -C ~/insforge pull origin main
  docker compose pull
  docker compose up -d
EOF
```

如果已啟用 compose 自動啟動，則無需重新啟用該單元——它追蹤的是目錄，而不是特定的映像標籤。

### 備份資料庫

```bash
ssh insforge 'cd ~/insforge/deploy/docker-compose && docker compose exec -T postgres \
  pg_dump -U postgres insforge' > backup_$(date +%Y%m%d_%H%M%S).sql
```

Containarium 也會透過 ZFS 每日為整個容器建立快照（預設保留 30 天），作為涵蓋 postgres 資料磁碟區的時間點還原備援方案。

### 停止 / 重新啟動

```bash
containarium compose disable insforge   # stop the compose stack and disable autostart
containarium sleep insforge             # stop the entire box
containarium wake insforge              # start the box; compose comes up via autostart
```

## 疑難排解

### `containarium compose enable` 失敗

驗證 box 內的 Docker 是否正常運作：

```bash
ssh insforge 'docker ps'
```

如果你在建立時跳過了 `--stack docker`，請在 box 內手動安裝它，或者帶上該旗標重新建立。

### 公開主機名稱無法解析

`containarium expose-port` 會設定 sentinel 上的 Caddy；你的子網域的 DNS A/CNAME 記錄必須指向 sentinel 的公開 IP。檢查方法：

```bash
dig +short <your-subdomain>
```

### 主機名稱可以解析但傳回 502

檢查從 box 內部是否可以存取 InsForge：

```bash
ssh insforge 'curl -s http://localhost:7130/api/health'
```

如果 box 內的檢查正常，那麼下一步要排查的就是 sentinel 與 box 之間的橋接——參閱 Containarium 的 [`docs/TUNNEL-REVERSE-PROXY.md`](https://github.com/footprintai/Containarium/blob/main/docs/TUNNEL-REVERSE-PROXY.md)。

### `docker compose up` 之後記憶體不足

InsForge 的四個服務在閒置時大約需要 3 GB 常駐記憶體。如果你將 box 設定為 2 GB，請調整大小：

```bash
containarium resize insforge --memory 4GB
containarium sleep insforge && containarium wake insforge
```

## 限制

- **AUTH_PORT（7131）和 DENO_PORT（7133）** 不會透過上述步驟對外公開。如果你的應用程式需要從 box 外部呼叫獨立的驗證端點或直接的 Deno 函數 URL，請新增帶有獨立子網域的額外 `expose-port` 呼叫。
- **`containarium compose enable` 需要 Containarium v0.18 或更新版本**（compose 自動啟動功能）。在較舊的版本上，請執行 `docker compose up -d` 並手動新增一個 `@reboot` cron 項目。
- **GPU 直通**：Containarium 支援它，但 InsForge 內建的邊緣函數不使用 GPU。除非你的自訂 Deno 函數需要 GPU，否則請保持關閉。

## 安全性注意事項

- 容器的使用者在伺服器上是非特權的（LXC 非特權模式）；容器 root 不等於伺服器 root。
- sentinel 前端支援針對管理端點的來源 IP 允許清單——參閱 Containarium 的[安全性維運手冊](https://github.com/footprintai/Containarium/blob/main/docs/security/OPERATOR-SECURITY-RUNBOOK.md)。
- 對於正式環境，請選擇使用 Containarium 的 KMS 信封加密（Vault Transit 或 GCP KMS）來保護儲存在 Containarium 密鑰庫中的任何 InsForge 密鑰。
- 使用 `containarium token generate --scopes containers:read,containers:write ...` 為代理產生最小權限權杖，而不是分發管理員權杖。

## 資源

- **Containarium**：https://github.com/footprintai/containarium
- **Containarium 文件**：https://github.com/footprintai/Containarium/tree/main/docs
- **InsForge 文件**：https://docs.insforge.dev
- **InsForge Discord**：https://discord.com/invite/MPxwj5xVvW

---

有關其他部署策略，請參閱[部署指南](/deployment/deployment-security-guide)。
