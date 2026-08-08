---
title: "將 InsForge 自架於 Dokploy"
description: "在 Dokploy 上以 Compose 應用部署 InsForge 後端，Postgres 映像從儲存庫建置，設定始終與所部署的版本一致。"
---

# 將 InsForge 自架於 Dokploy

本指南介紹如何在 [Dokploy](https://dokploy.com) 上自架 InsForge 平台。Dokploy 是執行於你自己伺服器上的開源 PaaS。

<Note>
  **這裡部署的是 InsForge 本身，而不是你用它建置的應用。** 若你只想讓自己的應用上線，請使用 [Sites](/core-concepts/sites/overview)。
</Note>

## 前置條件

- 一個 Dokploy 實例
- 一個解析到該伺服器的網域或子網域

## 1. 建立應用

**Create → Compose**，將本儲存庫設為 provider，然後設定：

| 欄位 | 值 |
| --- | --- |
| Compose Path | `deploy/dokploy/docker-compose.yml` |
| Compose Type | Docker Compose |

## 2. 環境變數

在 **Environment** 中設定以下變數。每個密鑰都用 `openssl rand -hex 32` 產生：

```env
JWT_SECRET=<32+ characters>
ENCRYPTION_KEY=<32+ characters, different from JWT_SECRET>
POSTGRES_PASSWORD=<strong password>
ROOT_ADMIN_USERNAME=admin
ROOT_ADMIN_PASSWORD=<strong password>
```

`ENCRYPTION_KEY` 未設定時會回退到 `JWT_SECRET`，而之後輪換 `JWT_SECRET` 會使所有已儲存的密鑰無法解密——現在就給它獨立的值。

Postgres 僅在初始化資料叢集時讀取 `POSTGRES_PASSWORD`。之後再改不會變更資料庫密碼。

其餘皆為選用；[`.env.example`](https://github.com/insforge/insforge/blob/main/.env.example) 列出所有支援的變數及其預設值。

## 3. 新增網域

此 stack 不向主機發布任何連接埠，因此只有設好路由才能存取。在 **Domains** 中新增你的網域：

| 欄位 | 值 |
| --- | --- |
| Service Name | `insforge` |
| Container Port | `7130` |

然後把對應網址加入環境變數：

```env
API_BASE_URL=https://insforge.example.com
VITE_API_BASE_URL=https://insforge.example.com
```

這兩個必須與瀏覽器實際存取的網址一致，否則控制台會請求錯誤的來源。

只有 `insforge` 需要網域。Postgres、PostgREST 與 Deno 執行環境都留在 Dokploy 的內部網路中。

## 4. 部署

按 **Deploy**。首次執行會建置兩個小映像（Postgres 與 Deno function host）、拉取其餘映像，然後自動執行後端遷移。

開啟你的網域，以 `ROOT_ADMIN_USERNAME` / `ROOT_ADMIN_PASSWORD` 登入。

## 更新

再按一次 **Deploy**，或啟用 Auto Deploy 讓推送時自動重新部署。每次部署都會以當前 commit 重新建置 Postgres 與 Deno 映像，因此其設定與 function host 始終跟著版本。

更新前先檢視 `.env.example` 的 diff——新版本新增的變數不會自動出現在你的 Dokploy 環境中。

## 儲存

物件儲存預設落在 Docker 卷上的容器檔案系統。Dokploy 只接受單一 compose 檔案，因此 MinIO 與 RustFS 的 overlay 無法使用；可行的兩種方案請見 [Self-Hosted Storage](./self-host-storage.mdx)。

## 為什麼 Postgres 是建置而非拉取

InsForge 的 Postgres 需要儲存庫中的三個檔案：`postgresql.conf`（它預先載入 `insforge_pg_utils` 擴充，受管表上的列級安全依賴此擴充）以及兩個 init 腳本。

Dokploy 每次部署都會重新 clone `code/`，因此指向儲存庫的 bind mount 會失效——[其文件](https://docs.dokploy.com/docs/core/troubleshooting/volumes-mounts)要求在 UI 中建立 File Mounts 並以 `../files/` 引用，這對每個安裝都是一次手動設定。改為在部署時建置映像、放入當前檔案，無需任何設定，且設定不會像預先建置的映像那樣落後於程式碼。
