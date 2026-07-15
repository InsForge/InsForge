---
title: "Self-Host InsForge on Azure Virtual Machines"
description: "Self-host the InsForge platform on an Azure Virtual Machine using Docker Compose, covering SSH access, custom domains, HTTPS, and production hardening."
---

# 📖 Self-Hosting InsForge on Azure Virtual Machines (Extended Guide)

This guide provides comprehensive, step-by-step instructions for self-hosting, managing, and securing the InsForge platform on an Azure Virtual Machine (VM) using Docker Compose.

<Note>
  **This deploys InsForge itself, not the app you built.** If you just want to take your app live, use [Sites](/core-concepts/sites/overview) instead. This guide is for running the InsForge backend on your own infrastructure.
</Note>

<Note>
  This cloud walkthrough is community-maintained and can lag the latest InsForge release. The canonical, always-current setup is the `deploy/docker-compose/` directory in the [InsForge repo](https://github.com/InsForge/InsForge).
</Note>

## Prerequisites

* An active **Azure account**.
* An **SSH client** to connect to the virtual machine.
* Basic familiarity with the **Linux command line**.

---

## Step 1: 🖥️ Create an Azure virtual machine

1.  **Log in to the [Azure Portal](https://portal.azure.com/)** and navigate to **Virtual machines**.
2.  Click **+ Create** > **Azure virtual machine**.
3.  **Basics Tab:**
    * **Resource Group:** Create a new one (e.g., `insforge-rg`).
    * **Virtual machine name:** `insforge-vm`.
    * **Image:** **Ubuntu Server 22.04 LTS** or newer.
    * **Size:** `Standard_B2s` (2 vCPUs, 4 GiB memory) is a good start. For production, consider `Standard_B4ms` (4 vCPUs, 16 GiB memory).
    * **Authentication type:** **SSH public key**.
    * **SSH public key source:** **Generate new key pair**. Name it `insforge-key`.
4.  **Networking Tab:**
    * In the **Network security group** section, click **Create new**.
    * Add the following **inbound port rules** to allow traffic:
        * `22` (SSH)
        * `80` (HTTP for Nginx)
        * `443` (HTTPS for Nginx/SSL)
        * `7130` (InsForge API and dashboard)
5.  **Review and Create:**
    * Click **Review + create**, then **Create**.
    * When prompted, **Download private key and create resource**. Save the `.pem` file securely.
    * Once deployed, find and copy your VM's **Public IP address**.

---

## Step 2: ⚙️ Connect and set up the server

1.  **Connect via SSH:**
    Open your terminal, give your key the correct permissions, and connect to the VM.

    ```bash
    chmod 400 /path/to/your/insforge-key.pem
    ssh -i /path/to/your/insforge-key.pem azureuser@<your-vm-public-ip>
    ```

2.  **Update System Packages:**
    ```bash
    sudo apt update && sudo apt upgrade -y
    ```

3.  **Install Docker:**
    Follow the official, up-to-date instructions on the Docker website to install Docker Engine on Ubuntu:
    **[https://docs.docker.com/engine/install/ubuntu/](https://docs.docker.com/engine/install/ubuntu/)**

4.  **Add Your User to the Docker Group:**
    This step allows you to run Docker commands without `sudo`.

    ```bash
    # Add your user to the docker group
    sudo usermod -aG docker $USER

    # Apply the group changes
    newgrp docker
    ```
    Verify it works. This command should now run without `sudo`:
    ```bash
    docker ps
    ```
    > 💡 **Note:** If `docker ps` doesn't work, log out of your SSH session and log back in, then try again.
    >
    > ⚠️ **Security Note:** Adding a user to the `docker` group grants them root-equivalent privileges. This is acceptable for a single-user VM but be cautious on shared systems.

5.  **Install Git:**
    ```bash
    sudo apt install git -y
    ```

---

## Step 3: 🚀 Deploy InsForge

1.  **Clone the Repository:**
    Navigate to your home directory and clone the InsForge project.
    ```bash
    cd ~
    git clone https://github.com/InsForge/InsForge.git
    cd InsForge/deploy/docker-compose
    ```

2.  **Create Environment Configuration:**
    Create your `.env` file from the example and open it for editing.
    ```bash
    cp .env.example .env
    nano .env
    ```
    `.env.example` lists every supported variable with comments. For a basic deployment you only need to set a few. Set these values and update the API URLs to your VM's public IP:

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
    The rest of `.env.example` covers optional features (OpenRouter, Vercel deployments, OAuth providers). Leave those blank unless you need them.
    > **Generate a Secure JWT Secret:** Run this on your VM and paste the result into `JWT_SECRET`:
    > ```bash
    > openssl rand -base64 32
    > ```

3.  **Start InsForge Services:**
    Pull the Docker images and start all services in the background.
    ```bash
    docker compose up -d
    ```

4.  **Verify Services:**
    Check that all four containers are running.
    ```bash
    docker compose ps
    ```
    You should see the `postgres`, `postgrest`, `insforge`, and `deno` services running.

---

## Step 4: 🔑 Access your InsForge instance

1.  **Test Backend API:**
    Use `curl` to check the health endpoint.
    ```bash
    curl http://<your-vm-public-ip>:7130/api/health
    ```
    You should see a response like: `{"status":"ok", ...}`

2.  **Access Dashboard:**
    Open your browser and navigate to: `http://<your-vm-public-ip>:7130`
    Log in with the `ROOT_ADMIN_USERNAME` and `ROOT_ADMIN_PASSWORD` you set in your `.env` file.

---

## Step 5: 🌐 Configure domain (optional but recommended)

1.  **Update DNS Records:**
    In your domain provider's DNS settings, add two **A records** pointing to your VM's Public IP address:
    * `api.yourdomain.com` → `<your-vm-public-ip>`
    * `app.yourdomain.com` → `<your-vm-public-ip>`

2.  **Install and Configure Nginx as a Reverse Proxy:**
    ```bash
    sudo apt install nginx -y
    sudo nano /etc/nginx/sites-available/insforge
    ```
    Paste the following configuration:
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
    Enable the configuration and reload Nginx:
    ```bash
    sudo ln -s /etc/nginx/sites-available/insforge /etc/nginx/sites-enabled/
    sudo nginx -t
    sudo systemctl reload nginx
    ```

3.  **Install SSL Certificate with Certbot:**
    ```bash
    # Install Certbot for Nginx
    sudo apt install certbot python3-certbot-nginx -y
    # Obtain SSL certificates and configure Nginx automatically
    sudo certbot --nginx -d api.yourdomain.com -d app.yourdomain.com
    ```
    Follow the prompts. Certbot will handle the rest.

4.  **Update `.env` with HTTPS URLs:**
    Edit your `.env` file and update the URLs.
    ```bash
    cd ~/InsForge
    nano .env
    ```
    Change the URLs to `https`:
    ```ini
    API_BASE_URL=https://api.yourdomain.com
    VITE_API_BASE_URL=https://api.yourdomain.com
    ```
    Restart the services for the changes to take effect:
    ```bash
    docker compose down && docker compose up -d
    ```

---

## 🔧 Management & maintenance

* **View Logs:** `docker compose logs -f` (all services) or `docker compose logs -f insforge` (specific service).
* **Stop Services:** `docker compose down`
* **Restart Services:** `docker compose restart`
* **Update InsForge:** Run these from `~/InsForge/deploy/docker-compose`. The images are prebuilt, so pull the latest tags instead of rebuilding.
    ```bash
    cd ~/InsForge/deploy/docker-compose
    git -C ~/InsForge pull origin main
    docker compose pull && docker compose up -d
    ```
* **Backup Database:** Run from `~/InsForge/deploy/docker-compose`.
    ```bash
    docker compose exec postgres pg_dump -U postgres insforge > backup_$(date +%Y%m%d_%H%M%S).sql
    ```

## 🐛 Troubleshooting

* **Services Won't Start:** Check `docker compose logs` for errors. Ensure you have enough disk space (`df -h`) and memory (`free -h`).
* **Port Already in Use:** Check which process is using the port with `sudo netstat -tulpn | grep :7130`.
* **Out of Memory:** Consider upgrading your Azure VM to a size with more RAM.

## 📊 Cost estimation

> **Disclaimer:** Prices are estimates based on Pay-As-You-Go rates in a common region (e.g., East US) and can vary. Always check the official [Azure Pricing Calculator](https://azure.microsoft.com/en-us/pricing/calculator/) for the most accurate information. On Azure, you pay for the VM's resources (CPU, RAM, Storage), which are shared by all the Docker services you run on it.

### Free tier (for testing)
* **Cost:** **~$0/month** for the first 12 months.
* **Resources:** Azure provides a free tier that includes 750 hours/month of a `B1s` burstable VM.
* **Limitations:** This VM has very limited resources (1 vCPU, 1 GiB RAM) and may run slowly. It's suitable only for basic testing and familiarization, not for active development or production.

### Starter setup (for development & small projects)
* **Cost:** **~$30 - $40/month**
* **Resources:** This estimate is for a `Standard_B2s` VM (2 vCPU, 4 GiB RAM) running all the InsForge Docker containers.
* **Breakdown:** The cost primarily consists of the VM compute hours. It also includes the OS disk storage and a static public IP address. This single VM runs your database, backend, Deno, and all other services.

### Production setup (for scalability & reliability)
For production, you can choose between an all-in-one, larger VM or a more robust setup using managed services.

* **Option A: All-in-One Larger VM**
    * **Cost:** **~$150 - $170/month**
    * **Resources:** A more powerful `Standard_B4ms` VM (4 vCPU, 16 GiB RAM) to handle higher traffic and all services.
    * **Pros:** Simple to manage, consolidated cost.
    * **Cons:** Database and application share resources, which can create performance bottlenecks. Scaling requires upgrading the entire VM.

* **Option B: Managed Services (Recommended for Production)**
    * **Cost:** **~$120+/month** (highly variable)
    * **Resources:**
        * **Application VM:** A `Standard_B2s` VM for the app services (InsForge, PostgREST, Deno). `(~$30/month)`
        * **Managed Database:** Use **Azure Database for PostgreSQL** for reliability, automated backups, and scaling. `(~$40+/month for a starter tier)`
    * **Pros:** Highly reliable and scalable. Database performance is isolated and guaranteed. Managed backups and security.
    * **Cons:** More complex setup, costs are distributed across multiple services.

## 🔒 Security best practices

* **Change Default Passwords:** Always update admin and database passwords.
* **Enable Firewall:** Use Azure **Network Security Groups (NSGs)** to restrict access to necessary ports and IP addresses.
* **Regular Updates:** Periodically run `sudo apt update && sudo apt upgrade -y` and update InsForge.
* **Backup Regularly:** Automate database and configuration backups.
