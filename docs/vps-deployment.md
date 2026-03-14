# VPS Deployment & Security Guide

This guide explains how to deploy InsForge on a VPS for production use.

---

## Server Requirements

Recommended VPS configuration:

* **CPU:** 2 cores
* **RAM:** 4 GB
* **OS:** Ubuntu 22.04 LTS
* **Storage:** 20+ GB SSD

---

## Install Docker

Update your system and install Docker:

```bash
sudo apt update
sudo apt install docker.io docker-compose-plugin -y
```

Enable and start Docker:

```bash
sudo systemctl enable docker
sudo systemctl start docker
```

Verify Docker installation:

```bash
docker --version
```

---

## Clone the Repository

Clone the InsForge repository to your VPS:

```bash
git clone https://github.com/YOUR_USERNAME/insforge.git
cd insforge
```

---

## Environment Setup

Copy the example environment file:

```bash
cp .env.example .env
```

Edit the environment variables if needed:

```bash
nano .env
```

Make sure to configure all required values before starting the application.

---

## Run with Docker

Start the application using Docker Compose:

```bash
docker compose up -d
```

To check running containers:

```bash
docker ps
```

---

## Reverse Proxy (Nginx)

Install Nginx:

```bash
sudo apt install nginx -y
```

Example Nginx configuration:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Restart Nginx:

```bash
sudo systemctl restart nginx
```

---

## Enable HTTPS with Certbot

Install Certbot and the Nginx plugin:

```bash
sudo apt install certbot python3-certbot-nginx -y
```

Obtain an SSL certificate:

```bash
sudo certbot --nginx -d your-domain.com
```

Test automatic renewal:

```bash
sudo certbot renew --dry-run
```

Certbot will automatically configure HTTPS and redirect HTTP traffic to HTTPS.

---

## Security

Open only required ports:

* **22** — SSH
* **80** — HTTP
* **443** — HTTPS

Enable firewall with UFW:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

Check firewall status:

```bash
sudo ufw status
```

---

## Running Services as Non-Root User

For better security, avoid running services as the root user.

Create a new user:

```bash
sudo adduser insforge
```

Give Docker permissions:

```bash
sudo usermod -aG docker insforge
```

Switch user:

```bash
su - insforge
```

---

## Updating InsForge

Pull the latest changes:

```bash
git pull origin main
```

Rebuild and restart containers:

```bash
docker compose down
docker compose up -d --build
```

---

## Backup Before Updating

Before updating, backup important files:

* `.env`
* Docker volumes
* Database files (if used)

Example backup:

```bash
tar -czvf insforge-backup.tar.gz .env
```

---

## Rollback (If Something Breaks)

If an update fails, revert to the previous commit:

```bash
git log
git checkout <previous_commit_id>
docker compose up -d --build
```

---

## Conclusion

You now have InsForge running on a VPS with Docker, Nginx reverse proxy, HTTPS via Certbot, and basic security practices.

For further configuration, refer to the project documentation.
