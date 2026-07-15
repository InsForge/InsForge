# 📖 將 InsForge 部署到 Azure 虛擬機器（擴充指南）

本指南提供了在 Azure 虛擬機器（VM）上使用 Docker Compose 部署、管理和保護 InsForge 的完整、逐步說明。

<Note>
  本雲端演練由社群維護，可能落後於最新的 InsForge 版本。標準的、始終保持最新的設定位於 [InsForge 儲存庫](https://github.com/InsForge/InsForge)中的 `deploy/docker-compose/` 目錄。
</Note>

## 先決條件

* 一個有效的 **Azure 帳戶**。
* 一個用於連接虛擬機器的 **SSH 用戶端**。
* 對 **Linux 命令列**的基本熟悉程度。

---

## 步驟 1：🖥️ 建立 Azure 虛擬機器

1.  **登入 [Azure 入口網站](https://portal.azure.com/)**，然後導覽至**虛擬機器**。
2.  點選 **+ 建立** > **Azure 虛擬機器**。
3.  **基本資料索引標籤：**
    * **資源群組：** 建立一個新的（例如 `insforge-rg`）。
    * **虛擬機器名稱：** `insforge-vm`。
    * **映像：** **Ubuntu Server 22.04 LTS** 或更新版本。
    * **大小：** `Standard_B2s`（2 個 vCPU，4 GiB 記憶體）是一個不錯的起點。對於正式環境，考慮使用 `Standard_B4ms`（4 個 vCPU，16 GiB 記憶體）。
    * **驗證類型：** **SSH 公開金鑰**。
    * **SSH 公開金鑰來源：** **產生新的金鑰組**。將其命名為 `insforge-key`。
4.  **網路索引標籤：**
    * 在**網路安全性群組**區段，點選**建立新的**。
    * 新增以下**輸入連接埠規則**以允許流量：
        * `22`（SSH）
        * `80`（Nginx 的 HTTP）
        * `443`（Nginx/SSL 的 HTTPS）
        * `7130`（InsForge API 和儀表板）
5.  **檢閱並建立：**
    * 點選**檢閱 + 建立**，然後點選**建立**。
    * 出現提示時，**下載私密金鑰並建立資源**。請妥善保存 `.pem` 檔案。
    * 部署完成後，找到並複製你的虛擬機器的**公開 IP 位址**。

---

## 步驟 2：⚙️ 連接並設定伺服器

1.  **透過 SSH 連接：**
    開啟終端機，為你的金鑰設定正確的權限，然後連接到虛擬機器。

    ```bash
    chmod 400 /path/to/your/insforge-key.pem
    ssh -i /path/to/your/insforge-key.pem azureuser@<your-vm-public-ip>
    ```

2.  **更新系統套件：**
    ```bash
    sudo apt update && sudo apt upgrade -y
    ```

3.  **安裝 Docker：**
    請依照 Docker 官方網站上最新的官方說明，在 Ubuntu 上安裝 Docker Engine：
    **[https://docs.docker.com/engine/install/ubuntu/](https://docs.docker.com/engine/install/ubuntu/)**

4.  **將你的使用者新增到 Docker 群組：**
    此步驟允許你在不使用 `sudo` 的情況下執行 Docker 命令。

    ```bash
    # Add your user to the docker group
    sudo usermod -aG docker $USER

    # Apply the group changes
    newgrp docker
    ```
    驗證它是否有效。此命令現在應該可以在不使用 `sudo` 的情況下執行：
    ```bash
    docker ps
    ```
    > 💡 **提示：** 如果 `docker ps` 不起作用，請登出你的 SSH 工作階段並重新登入，然後再試一次。
    >
    > ⚠️ **安全性提示：** 將使用者新增到 `docker` 群組會授予其相當於 root 的權限。這在單一使用者虛擬機器上是可以接受的，但在共用系統上要謹慎。

5.  **安裝 Git：**
    ```bash
    sudo apt install git -y
    ```

---

## 步驟 3：🚀 部署 InsForge

1.  **複製儲存庫：**
    導覽至你的主目錄並複製 InsForge 專案。
    ```bash
    cd ~
    git clone https://github.com/InsForge/InsForge.git
    cd InsForge/deploy/docker-compose
    ```

2.  **建立環境設定：**
    從範例檔案建立你的 `.env` 檔案並開啟以進行編輯。
    ```bash
    cp .env.example .env
    nano .env
    ```
    `.env.example` 列出了所有支援的變數並附有註解。對於基本部署，你只需要設定少數幾項。設定以下值，並將 API URL 更新為你的虛擬機器的公開 IP：

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
    `.env.example` 的其餘部分涵蓋了可選功能（OpenRouter、Vercel 部署、OAuth 提供者）。除非你需要它們，否則將這些留空。
    > **產生一個安全的 JWT 密鑰：** 在你的虛擬機器上執行以下命令，並將結果貼到 `JWT_SECRET` 中：
    > ```bash
    > openssl rand -base64 32
    > ```

3.  **啟動 InsForge 服務：**
    拉取 Docker 映像並在背景啟動所有服務。
    ```bash
    docker compose up -d
    ```

4.  **驗證服務：**
    檢查所有四個容器是否都在執行。
    ```bash
    docker compose ps
    ```
    你應該會看到 `postgres`、`postgrest`、`insforge` 和 `deno` 服務正在執行。

---

## 步驟 4：🔑 存取你的 InsForge 執行個體

1.  **測試後端 API：**
    使用 `curl` 檢查健康檢查端點。
    ```bash
    curl http://<your-vm-public-ip>:7130/api/health
    ```
    你應該會看到類似這樣的回應：`{"status":"ok", ...}`

2.  **存取儀表板：**
    開啟瀏覽器並導覽至：`http://<your-vm-public-ip>:7130`
    使用你在 `.env` 檔案中設定的 `ROOT_ADMIN_USERNAME` 和 `ROOT_ADMIN_PASSWORD` 登入。

---

## 步驟 5：🌐 設定網域（可選但建議）

1.  **更新 DNS 記錄：**
    在你的網域提供者的 DNS 設定中，新增兩筆指向你的虛擬機器公開 IP 位址的 **A 記錄**：
    * `api.yourdomain.com` → `<your-vm-public-ip>`
    * `app.yourdomain.com` → `<your-vm-public-ip>`

2.  **安裝並設定 Nginx 作為反向代理：**
    ```bash
    sudo apt install nginx -y
    sudo nano /etc/nginx/sites-available/insforge
    ```
    貼上以下設定：
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
    啟用該設定並重新載入 Nginx：
    ```bash
    sudo ln -s /etc/nginx/sites-available/insforge /etc/nginx/sites-enabled/
    sudo nginx -t
    sudo systemctl reload nginx
    ```

3.  **使用 Certbot 安裝 SSL 憑證：**
    ```bash
    # Install Certbot for Nginx
    sudo apt install certbot python3-certbot-nginx -y
    # Obtain SSL certificates and configure Nginx automatically
    sudo certbot --nginx -d api.yourdomain.com -d app.yourdomain.com
    ```
    依照提示操作。Certbot 會處理剩下的一切。

4.  **使用 HTTPS URL 更新 `.env`：**
    編輯你的 `.env` 檔案並更新 URL。
    ```bash
    cd ~/InsForge
    nano .env
    ```
    將 URL 變更為 `https`：
    ```ini
    API_BASE_URL=https://api.yourdomain.com
    VITE_API_BASE_URL=https://api.yourdomain.com
    ```
    重新啟動服務以使變更生效：
    ```bash
    docker compose down && docker compose up -d
    ```

---

## 🔧 管理與維護

* **檢視記錄檔：** `docker compose logs -f`（所有服務）或 `docker compose logs -f insforge`（特定服務）。
* **停止服務：** `docker compose down`
* **重新啟動服務：** `docker compose restart`
* **更新 InsForge：** 從 `~/InsForge/deploy/docker-compose` 執行以下命令。映像是預先建置好的，因此拉取最新標籤即可，無需重新建置。
    ```bash
    cd ~/InsForge/deploy/docker-compose
    git -C ~/InsForge pull origin main
    docker compose pull && docker compose up -d
    ```
* **備份資料庫：** 從 `~/InsForge/deploy/docker-compose` 執行。
    ```bash
    docker compose exec postgres pg_dump -U postgres insforge > backup_$(date +%Y%m%d_%H%M%S).sql
    ```

## 🐛 疑難排解

* **服務無法啟動：** 檢查 `docker compose logs` 中的錯誤。確保你有足夠的磁碟空間（`df -h`）和記憶體（`free -h`）。
* **連接埠已被使用：** 使用 `sudo netstat -tulpn | grep :7130` 檢查哪個程序正在使用該連接埠。
* **記憶體不足：** 考慮將你的 Azure 虛擬機器升級到記憶體更大的規格。

## 📊 成本估算

> **免責聲明：** 價格是根據常見地區（例如美國東部）的隨用隨付費率所做的估算，可能會有所不同。請務必查看官方的 [Azure 定價計算機](https://azure.microsoft.com/en-us/pricing/calculator/)以取得最準確的資訊。在 Azure 上，你需要為虛擬機器的資源（CPU、記憶體、儲存體）付費，而這些資源由你在其上執行的所有 Docker 服務共用。

### 免費層（用於測試）
* **成本：** 前 12 個月約 **0 美元/月**。
* **資源：** Azure 提供一個免費層，包括每月 750 小時的 `B1s` 突發效能虛擬機器。
* **限制：** 這台虛擬機器的資源非常有限（1 個 vCPU，1 GiB 記憶體），執行可能會很慢。它僅適合基本測試和熟悉環境，不適合積極開發或正式環境。

### 入門設定（用於開發和小型專案）
* **成本：** 約 **30 - 40 美元/月**
* **資源：** 此估算適用於執行所有 InsForge Docker 容器的 `Standard_B2s` 虛擬機器（2 個 vCPU，4 GiB 記憶體）。
* **明細：** 成本主要包括虛擬機器計算時數。它還包括作業系統磁碟儲存體和一個靜態公開 IP 位址。這一台虛擬機器執行你的資料庫、後端、Deno 以及所有其他服務。

### 正式環境設定（用於可擴充性和可靠性）
對於正式環境，你可以在一個更大的一體化虛擬機器和一個使用受管服務的更強固的設定之間進行選擇。

* **選項 A：更大的一體化虛擬機器**
    * **成本：** 約 **150 - 170 美元/月**
    * **資源：** 一台更強大的 `Standard_B4ms` 虛擬機器（4 個 vCPU，16 GiB 記憶體），以處理更高的流量和所有服務。
    * **優點：** 易於管理，成本合併統一。
    * **缺點：** 資料庫和應用程式共用資源，可能造成效能瓶頸。擴充需要升級整台虛擬機器。

* **選項 B：受管服務（建議用於正式環境）**
    * **成本：** 約 **120 美元以上/月**（變化很大）
    * **資源：**
        * **應用程式虛擬機器：** 用於應用服務（InsForge、PostgREST、Deno）的 `Standard_B2s` 虛擬機器。`（約 30 美元/月）`
        * **受管資料庫：** 使用 **Azure Database for PostgreSQL** 以取得可靠性、自動備份和可擴充性。`（入門層約 40 美元以上/月）`
    * **優點：** 高度可靠且可擴充。資料庫效能是隔離且有保障的。受管備份和安全性。
    * **缺點：** 設定更複雜，成本分佈在多個服務上。

## 🔒 安全性最佳實務

* **變更預設密碼：** 始終更新管理員和資料庫密碼。
* **啟用防火牆：** 使用 Azure **網路安全性群組（NSG）**限制對必要連接埠和 IP 位址的存取。
* **定期更新：** 定期執行 `sudo apt update && sudo apt upgrade -y` 並更新 InsForge。
* **定期備份：** 自動化資料庫和設定的備份。
