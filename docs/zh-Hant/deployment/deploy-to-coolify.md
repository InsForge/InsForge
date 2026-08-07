---
title: "將 InsForge 自架於 Coolify"
description: "在 Coolify 上以 Docker Compose 資源部署 InsForge 後端，Postgres 映像從儲存庫建置，設定始終與所部署的版本一致。"
---

# 將 InsForge 自架於 Coolify

本指南介紹如何在 [Coolify](https://coolify.io) 上自架 InsForge 平台。Coolify 是執行於你自己伺服器上的開源 PaaS。

<Note>
  **這裡部署的是 InsForge 本身，而不是你用它建置的應用。** 若你只想讓自己的應用上線，請使用 [Sites](/core-concepts/sites/overview)。
</Note>

## 前置條件

- 一個 Coolify 實例，以及掛在其下的伺服器
- 一個解析到該伺服器的網域或子網域

## 1. 建立資源

**New Resource → Docker Compose**，連接本儲存庫（公開儲存庫不需要 GitHub App），然後設定：

| 欄位 | 值 |
| --- | --- |
| Base Directory | `/` |
| Docker Compose Location | `/deploy/coolify/docker-compose.yml` |

Base Directory 保持儲存庫根目錄。compose 檔案以 `deploy/Dockerfile.postgres` 建置 Postgres，其建置內容即為根目錄。

## 2. 環境變數

在 **Environment Variables** 中設定以下變數。每個密鑰都用 `openssl rand -hex 32` 產生：

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

## 3. 指派網域

Coolify 不會對外開放沒有發布連接埠的 compose 服務。在資源的 **insforge** 服務下指派你的網域並將連接埠設為 `7130`，然後把對應網址加入環境變數：

```env
API_BASE_URL=https://insforge.example.com
VITE_API_BASE_URL=https://insforge.example.com
```

這兩個必須與瀏覽器實際存取的網址一致，否則控制台會請求錯誤的來源。

只有 `insforge` 需要網域。Postgres、PostgREST 與 Deno 執行環境都留在內部網路中。

## 4. 部署

按 **Deploy**。首次執行會建置兩個小映像（Postgres 與 Deno function host）、拉取其餘映像，然後自動執行後端遷移。

開啟你的網域，以 `ROOT_ADMIN_USERNAME` / `ROOT_ADMIN_PASSWORD` 登入。

## 更新

若已啟用自動部署，Coolify 會在推送時重新部署，也可手動按 **Redeploy**。每次部署都會以當前 commit 重新建置 Postgres 與 Deno 映像，因此其設定與 function host 始終跟著版本。

更新前先檢視 `.env.example` 的 diff——新版本新增的變數不會自動出現在你的 Coolify 環境中。

## 儲存

物件儲存預設落在 Docker 卷上的容器檔案系統。若要使用 S3、MinIO 或 RustFS，請參見 [Self-Hosted Storage](./self-host-storage.mdx)，並在 Coolify 的環境變數中設定 `S3_*`——compose 檔案會將其傳遞進去。

## 為什麼 Postgres 是建置而非拉取

InsForge 的 Postgres 需要儲存庫中的三個檔案：`postgresql.conf`（它預先載入 `insforge_pg_utils` 擴充，受管表上的列級安全依賴此擴充）以及兩個 init 腳本。

Coolify 會把檔案類型的 bind mount 建立成目錄（[coollabsio/coolify#3375](https://github.com/coollabsio/coolify/issues/3375)），因此掛載這條路不可行——Postgres 無法啟動。改為在部署時建置映像、放入當前檔案，這也意味著設定不會像預先建置的映像那樣落後於程式碼。
