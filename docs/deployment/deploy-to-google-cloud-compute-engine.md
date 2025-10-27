# Deploy InsForge to Google Cloud Compute Engine

This guide will walk you through deploying InsForge on Google Cloud Compute Engine using Docker Compose.

## 📋 Prerequisites

- Google Cloud Account with billing enabled
- Basic knowledge of SSH and command-line operations
- Domain name (optional, for custom domain setup)

## 🚀 Deployment Steps

### 1. Create and Configure Compute Engine Instance

#### 1.1 Create Google Cloud Project

1. **Log into Google Cloud Console** at [console.cloud.google.com](https://console.cloud.google.com)
2. **Click "Select a project"** in the top navigation bar
3. **Click "New Project"**
4. **Enter project name** (e.g., `insforge-deployment`)
5. **Click "Create"**
6. **Wait for project creation to complete**

#### 1.2 Enable Required APIs

1. In your project, navigate to **APIs & Services** → **Library**
2. Search for and enable these APIs:
   - **Compute Engine API**
   - **Cloud Storage API** (if using for backups)
   - **Cloud SQL Admin API** (if using Cloud SQL)

#### 1.3 Create Compute Engine Instance

1. Navigate to **Compute Engine** → **VM instances**
2. Click **"Create Instance"**
3. Configure your instance:
   - **Name**: `insforge-server` (or your preferred name)
   - **Region**: Choose a region close to your users
   - **Zone**: Select an availability zone (e.g., us-central1-a)
   - **Machine configuration**:
     - **Series**: N2 or E2
     - **Machine type**: `e2-medium` or larger (minimum 2 vCPU, 4 GB RAM)
       - For production: `e2-standard-2` (2 vCPU, 8 GB RAM) recommended
       - For testing: `e2-small` (2 vCPU, 2 GB RAM) minimum
   - **Boot disk**:
     - **Operating system**: Ubuntu LTS (Ubuntu 22.04 LTS or newer)
     - **Boot disk type**: Balanced persistent disk
     - **Size**: 30 GB (minimum 20 GB recommended)
   - **Firewall**:
     - Allow HTTP traffic: **Checked**
     - Allow HTTPS traffic: **Checked**

#### 1.4 Configure Firewall Rules

1. Navigate to **VPC network** → **Firewall**
2. Create or modify firewall rules to allow the following ports:

| Name | Direction | Targets | Protocols/ports | Source filters |
|------|-----------|---------|-----------------|----------------|
| insforge-ssh | Ingress | insforge-server | tcp:22 | Your IP address |
| insforge-http | Ingress | insforge-server | tcp:80 | 0.0.0.0/0 |
| insforge-https | Ingress | insforge-server | tcp:443 | 0.0.0.0/0 |
| insforge-backend | Ingress | insforge-server | tcp:7130 | 0.0.0.0/0 |
| insforge-frontend | Ingress | insforge-server | tcp:7131 | 0.0.0.0/0 |
| insforge-deno | Ingress | insforge-server | tcp:7133 | 0.0.0.0/0 |
| insforge-postgrest | Ingress | insforge-server | tcp:5430 | 0.0.0.0/0 |
| insforge-postgres | Ingress | insforge-server | tcp:5432 | 0.0.0.0/0 (only if needed externally) |

> ⚠️ **Security Note**: For production, restrict PostgreSQL (5432) to specific IP addresses or remove external access entirely. Consider using a reverse proxy (nginx) and exposing only ports 80/443.

### 2. Connect to Your Compute Engine Instance

1. In the Google Cloud Console, go to **Compute Engine** → **VM instances**
2. Find your instance and click the **SSH** button in the same row, or:

```bash
# Use gcloud CLI to SSH (if you have gcloud SDK installed locally)
gcloud compute ssh insforge-server --zone=your-zone
```

### 3. Install Dependencies

#### 3.1 Update System Packages

```bash
sudo apt update && sudo apt upgrade -y
```

#### 3.2 Install Docker

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

#### 3.3 Add Your User to Docker Group

After installing Docker, you need to add your user to the `docker` group to run Docker commands without `sudo`:

```bash
# Add your user to the docker group
sudo usermod -aG docker $USER

# Apply the group changes
newgrp docker
```

**Verify it works:**

```bash
# This should now work without sudo
docker ps
```

> 💡 **Note**: If `docker ps` doesn't work immediately, log out and log back in via SSH, then try again.

> ⚠️ **Security Note**: Adding a user to the `docker` group grants them root-equivalent privileges on the system. This is acceptable for single-user environments like your Compute Engine instance, but be cautious on shared systems.

#### 3.4 Install Git

```bash
sudo apt install git -y
```

### 4. Deploy InsForge

#### 4.1 Clone Repository

```bash
cd ~
git clone https://github.com/insforge/insforge.git
cd insforge
```

#### 4.2 Create Environment Configuration

Create your `.env` file with production settings:

```bash
nano .env
```

Add the following configuration (customize the values):

```env
# ============================================
# Server Configuration
# ============================================
PORT=7130

# ============================================
# Database Configuration
# ============================================
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your-secure-postgres-password
POSTGRES_DB=insforge

# ============================================
# Security & Authentication
# ============================================
# IMPORTANT: Generate a strong random secret for production
JWT_SECRET=your-secret-key-here-must-be-32-char-or-above
ENCRYPTION_KEY=your-32-char-encryption-key-here

# Admin Account (used for initial setup)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this-password

# ============================================
# API Configuration
# ============================================
# Replace with your Compute Engine external IP or domain
API_BASE_URL=http://your-external-ip:7130
VITE_API_BASE_URL=http://your-external-ip:7130

# ============================================
# OAuth Providers (Optional)
# ============================================
# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# GitHub OAuth
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# ============================================
# AWS Storage Configuration (Optional)
# ============================================
# For S3 file storage
AWS_S3_BUCKET=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# ============================================
# AI/LLM Configuration (Optional)
# ============================================
OPENROUTER_API_KEY=

# ============================================
# Multi-tenant Cloud Configuration (Optional)
# ============================================
DEPLOYMENT_ID=
PROJECT_ID=
APP_KEY=
ACCESS_API_KEY=

# ============================================
# Advanced Configuration
# ============================================
DENO_ENV=production
WORKER_TIMEOUT_MS=30000
```

**Generate Secure Secrets:**

```bash
# Generate JWT_SECRET (32+ characters)
openssl rand -base64 32

# Generate ENCRYPTION_KEY (must be exactly 32 characters)
openssl rand -base64 24
```

> 💡 **Important**: Save these secrets securely. You'll need them if you ever migrate or restore your instance.

#### 4.3 Start InsForge Services

```bash
# Pull Docker images and start services
docker compose up -d

# View logs to ensure everything started correctly
docker compose logs -f
```

Press `Ctrl+C` to exit log view.

#### 4.4 Verify Services

```bash
# Check running containers
docker compose ps

# You should see 5 running services:
# - insforge-postgres
# - insforge-postgrest
# - insforge
# - insforge-deno
# - insforge-vector
```

### 5. Access Your InsForge Instance

#### 5.1 Test Backend API

```bash
curl http://your-external-ip:7130/api/health
```

Expected response:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "service": "Insforge OSS Backend",
  "timestamp": "2025-10-17T..."
}
```

#### 5.2 Access Dashboard

Open your browser and navigate to:
```text
http://your-external-ip:7131
```

#### 5.3 ⚠️ Important: Custom Admin Credentials Configuration

> **🚧 Active Development Notice**: InsForge is currently in active development and testing. The credential management system is being developed. The following is a temporary workaround that will be replaced with a secure implementation in future releases.

**If you customize admin credentials** in your `.env` file (which is recommended), you must **also update the frontend login page** to match. This is a temporary requirement during our development phase.

**Step 1: Update `.env` file**

```env
# In your .env file
ADMIN_EMAIL=your-custom-admin@example.com
ADMIN_PASSWORD=your-secure-password-here

```

After updating your `.env` file, manually edit the login page:

```bash
nano ~/insforge/frontend/src/features/login/page/LoginPage.tsx
```

Find this section (around line 38-41):
```typescript
defaultValues: {
  email: 'admin@example.com',
  password: 'change-this-password',
},
```

Update the default values to match your `.env` file:
```typescript
defaultValues: {
  email: 'your-custom-admin@example.com',  // Update to match your ADMIN_EMAIL
  password: 'your-secure-password-here',   // Update to match your ADMIN_PASSWORD
},
```

### 6. Configure Domain (Optional but Recommended)

#### 6.1 Reserve a Static External IP

1. In Google Cloud Console, go to **VPC network** → **External IP addresses**
2. Click **Reserve Static Address**
3. **Name**: `insforge-ip`
4. **Type**: Regional or Global (Regional for VM instances)
5. **Region**: Same as your VM instance
6. **Click Reserve**

#### 6.2 Update DNS Records

Point your domain's DNS records to the reserved static IP:
```text
api.yourdomain.com    → your-static-external-ip
app.yourdomain.com    → your-static-external-ip
```

#### 6.3 Install Nginx Reverse Proxy

```bash
sudo apt install nginx -y
```

Create Nginx configuration:

```bash
sudo nano /etc/nginx/sites-available/insforge
```

Add the following configuration:

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

# Frontend Dashboard
server {
    listen 80;
    server_name app.yourdomain.com;

    location / {
        proxy_pass http://localhost:7131;
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

Enable the configuration:

```bash
sudo ln -s /etc/nginx/sites-available/insforge /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 6.4 Install SSL Certificate (Recommended)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Obtain SSL certificates
sudo certbot --nginx -d api.yourdomain.com -d app.yourdomain.com

# Follow the prompts to complete setup
```

Update your `.env` file with HTTPS URLs:

```bash
cd ~/insforge
nano .env
```

Change:
```env
API_BASE_URL=https://api.yourdomain.com
VITE_API_BASE_URL=https://api.yourdomain.com
```

Restart services:

```bash
docker compose down
docker compose up -d
```

## 🔧 Management & Maintenance

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f insforge
docker compose logs -f postgres
docker compose logs -f deno
```

### Stop Services

```bash
docker compose down
```

### Restart Services

```bash
docker compose restart
```

### Update InsForge

```bash
cd ~/insforge
git pull origin main
docker compose down
docker compose up -d --build
```

### Backup Database

```bash
# Create backup
docker exec insforge-postgres pg_dump -U postgres insforge > backup_$(date +%Y%m%d_%H%M%S).sql

# Store backup in Google Cloud Storage (optional)
# First, install Google Cloud CLI and authenticate
# Then:
gsutil cp backup_$(date +%Y%m%d_%H%M%S).sql gs://your-backup-bucket/
```

### Monitor Resources

```bash
# Check disk usage
df -h

# Check memory usage
free -h

# Check Docker stats
docker stats
```

## 🐛 Troubleshooting

### Services Won't Start

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

### Cannot Connect to Database

```bash
# Check if PostgreSQL is running
docker compose ps postgres

# Check PostgreSQL logs
docker compose logs postgres

# Verify credentials in .env file
cat .env | grep POSTGRES
```

### Port Already in Use

```bash
# Check what's using the port
sudo netstat -tulpn | grep :7130

# Kill the process or change port in docker-compose.yml
```

### Out of Memory

Consider upgrading to a larger instance type:
```text
- Current: e2-small (2 vCPU, 2 GB RAM)
- Upgrade to: e2-standard-2 (2 vCPU, 8 GB RAM)
```

### SSL Certificate Issues

```bash
# Renew certificates
sudo certbot renew

# Test renewal
sudo certbot renew --dry-run
```

## 📊 Performance Optimization

### For Production Workloads

1. **Upgrade Instance Type**: Use `e2-standard-2` or `e2-standard-4`
2. **Use Cloud SQL**: Migrate from containerized PostgreSQL to Google Cloud SQL for better reliability
3. **Enable Cloud Monitoring**: Monitor metrics and set up alerts
4. **Configure Backups**: Set up automated daily backups
5. **Use Cloud Storage**: Configure Google Cloud Storage for file uploads instead of local storage

### Database Optimization

```conf
# Increase PostgreSQL shared_buffers (edit postgresql.conf in docker-init/db/)
# Recommended: 25% of available RAM
shared_buffers = 1GB
effective_cache_size = 3GB
```

## 🔒 Security Best Practices

1. **Change Default Passwords**: Update admin and database passwords
2. **Enable Firewall**: Use Google Cloud Firewall rules effectively
3. **Regular Updates**: Keep system and Docker images updated
4. **SSL/TLS**: Always use HTTPS in production
5. **Backup Regularly**: Automate database backups
6. **Monitor Logs**: Set up log monitoring and alerts
7. **Limit SSH Access**: Restrict SSH to specific IP addresses
8. **Use Service Accounts**: Instead of API keys where possible

## 🆘 Support & Resources

- **Documentation**: [https://docs.insforge.dev](https://docs.insforge.dev)
- **GitHub Issues**: [https://github.com/insforge/insforge/issues](https://github.com/insforge/insforge/issues)
- **Discord Community**: [https://discord.com/invite/MPxwj5xVvW](https://discord.com/invite/MPxwj5xVvW)

## 📝 Cost Estimation

**Monthly Google Cloud Costs (approximate):**

| Component | Type | Monthly Cost |
|-----------|------|--------------|
| Compute Engine | e2-medium (2 vCPU, 4 GB RAM) | ~$29 |
| Persistent Disk (30 GB) | Standard | ~$3 |
| Network Egress | First 1GB free | Variable |
| **Total** | | **~$32/month** |

> 💡 **Cost Optimization**: Use sustained use discounts for 24/7 running instances to save up to 30%. Consider preemptible instances for development/testing environments.

---

**Congratulations! 🎉** Your InsForge instance is now running on Google Cloud Compute Engine. You can start building applications by connecting AI agents to your backend platform.

For other production deployment strategies, check out our [deployment guides](./README.md).
