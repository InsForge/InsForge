# Deploy InsForge to Coolify

This guide walks you through deploying InsForge on Coolify, an open-source self-hosted alternative to Heroku/Netlify/Vercel.

## 📋 Prerequisites

- A server with SSH access (VPS, dedicated server, Raspberry Pi, or even old laptop)
- Minimum 2 CPU cores, 2 GB RAM, 30 GB storage (4 GB RAM recommended)
- Supported Linux OS: Ubuntu LTS, Debian, CentOS, Fedora, Arch, Alpine, or Raspberry Pi OS 64-bit
- Basic knowledge of SSH and command-line operations
- Domain name (optional, for custom domain setup)

## 🎯 Why Coolify?

- **Truly Open Source**: 100% free with no features locked behind paywalls
- **Self-Hosted Control**: Your infrastructure, your data, your rules
- **Docker Compose Native**: Deploy complex multi-service applications easily
- **Auto SSL**: Automatic Let's Encrypt certificates with Traefik proxy
- **Git Integration**: Deploy from GitHub, GitLab, Bitbucket, Gitea
- **No Vendor Lock-In**: All configurations saved on your server

## 🚀 Deployment Steps

### 1. Install Coolify

#### 1.1 Prepare Your Server

Ensure your server meets requirements:

```bash
# Check system resources
free -h  # Should show at least 2GB RAM
df -h    # Should show at least 30GB free space
nproc    # Should show at least 2 CPU cores
```

#### 1.2 Run Installation Script

```bash
# Quick installation (recommended)
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```

**What the installer does:**
- Installs Docker Engine (version 24+)
- Configures Docker settings
- Sets up Coolify services
- Creates necessary directories at `/data/coolify`
- Configures SSH keys for server management

The installation takes 5-10 minutes. After completion, you'll see:
```
Coolify is now installed and running on http://your-server-ip:8000
```

> ⚠️ **CRITICAL**: Immediately create your admin account after installation. The first person to access the registration page gets full server control.

#### 1.3 Access Coolify Dashboard

1. Open browser: `http://your-server-ip:8000`
2. You'll be redirected to registration page
3. Create your admin account:
   - Email: `admin@yourdomain.com`
   - Password: (create strong password)
   - Name: Your name

> 💡 **Note**: For detailed installation options, firewall configuration, and manual installation, see the [official Coolify installation guide](https://coolify.io/docs/installation).

### 2. Add Server to Coolify (Optional)

If deploying on the same server where Coolify is installed, skip this step.

For remote deployment:

1. **In Coolify dashboard**: **Servers** → **+ Add**
2. Configure:
   - **Name**: `insforge-production`
   - **IP Address**: Your target server IP
   - **SSH Port**: `22` (or custom)
   - **SSH User**: `root`
   - **SSH Key**: Use Coolify's generated key or add custom

3. Click **Validate & Save**

### 3. Create Project and Resource

#### 3.1 Create New Project

1. Click **+ New** → **Project**
2. **Name**: `InsForge Production`
3. **Select Server**: `localhost` or your added server
4. Click **Continue**

#### 3.2 Add Docker Compose Resource

1. Inside project: **+ New** → **Resource**
2. Select **Docker Compose**
3. Choose **Public Repository**

> 💡 **Important**: InsForge requires source code to be present. You must deploy from Git (pre-built images are not available).

#### 3.3 Configure Git Repository

1. **Repository URL**: `https://github.com/insforge/insforge`
   - Or use your fork: `https://github.com/your-username/insforge`

2. **Branch**: `main`

3. **Docker Compose Location**: `/` (default, docker-compose.yml is in root)

4. Click **Continue**

Coolify will clone the repository and detect services automatically.

### 4. Configure Environment Variables

In Coolify's **Environment Variables** section, set the following:

#### 4.1 Database Configuration

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your-secure-db-password
POSTGRES_DB=insforge
```

**Generate secure password:**
```bash
openssl rand -base64 24
```

#### 4.2 Security & Authentication

```env
# Generate strong secrets (32+ characters)
JWT_SECRET=your-jwt-secret-32-chars-minimum
ENCRYPTION_KEY=your-encryption-key-24-chars

# Admin account for initial setup
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=your-strong-admin-password
```

**Generate secure secrets:**
```bash
# JWT_SECRET (32+ characters)
openssl rand -base64 32

# ENCRYPTION_KEY (must be exactly 32 characters)
openssl rand -base64 24
```

> 💡 **Important**: Save these secrets securely. You'll need them for migrations or restores.

#### 4.3 API Configuration

```env
# Server configuration
PORT=7130

# API URLs (update after domain setup)
API_BASE_URL=http://your-server-ip:7130
VITE_API_BASE_URL=http://your-server-ip:7130

# Internal service URLs
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGREST_BASE_URL=http://postgrest:3000
DENO_RUNTIME_URL=http://deno:7133
```

If using custom domains, update URLs to:
```env
API_BASE_URL=https://api.yourdomain.com
VITE_API_BASE_URL=https://api.yourdomain.com
```

#### 4.4 Storage Configuration (Optional)

**Option A: Local Storage (Default)**
```env
STORAGE_DIR=/insforge-storage
```

**Option B: AWS S3 Storage**
```env
AWS_S3_BUCKET=your-bucket-name
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_CLOUDFRONT_URL=https://your-cloudfront-url
```

#### 4.5 OAuth Providers (Optional)

```env
# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# GitHub OAuth
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Discord OAuth
DISCORD_CLIENT_ID=your-discord-client-id
DISCORD_CLIENT_SECRET=your-discord-client-secret

# Microsoft OAuth
MICROSOFT_CLIENT_ID=your-microsoft-client-id
MICROSOFT_CLIENT_SECRET=your-microsoft-client-secret

# LinkedIn OAuth
LINKEDIN_CLIENT_ID=your-linkedin-client-id
LINKEDIN_CLIENT_SECRET=your-linkedin-client-secret
```

#### 4.6 AI/LLM Configuration (Optional)

```env
OPENROUTER_API_KEY=your-openrouter-api-key
```

#### 4.7 Advanced Configuration

```env
DENO_ENV=production
WORKER_TIMEOUT_MS=30000
LOGS_DIR=/insforge-logs
```

### 5. Configure Custom Domains (Optional but Recommended)

#### 5.1 Update DNS Records

In your domain provider's DNS settings, add A records:

```
Type  Name                      Value
A     app.yourdomain.com        your-server-ip
A     api.yourdomain.com        your-server-ip
A     rest.yourdomain.com       your-server-ip
A     functions.yourdomain.com  your-server-ip
```

Wait for DNS propagation (5-30 minutes).

#### 5.2 Configure Domains in Coolify

1. Navigate to your InsForge resource in Coolify
2. Click on each service to configure domains:

**For `insforge` service (Backend + Frontend):**
- Click service → **Domains** tab
- Add two domains:
  - Port 7131: `app.yourdomain.com` (Frontend)
  - Port 7130: `api.yourdomain.com` (Backend)

**For `postgrest` service:**
- Port 5430: `rest.yourdomain.com`

**For `deno` service:**
- Port 7133: `functions.yourdomain.com`

3. For each domain, enable **"Generate Let's Encrypt Certificate"**

Coolify will automatically:
- Configure Traefik reverse proxy
- Generate SSL certificates
- Set up HTTPS redirects
- Auto-renew certificates (60 days before expiration)

#### 5.3 Update Environment Variables

After domains are configured, update your environment variables:

```env
API_BASE_URL=https://api.yourdomain.com
VITE_API_BASE_URL=https://api.yourdomain.com
```

Click **Save** to trigger automatic redeployment.

### 6. Deploy InsForge

1. Review all configuration settings
2. Click **Deploy** (or **Save & Deploy**)
3. Monitor deployment in real-time via **Logs** tab

**Deployment process:**
- Clone Git repository
- Pull Docker images (postgres, postgrest, deno, vector)
- Create volumes for persistent data
- Start services in dependency order
- Run database migrations automatically
- Install npm dependencies
- Build and start frontend + backend

**Timeline**: First deployment takes 5-10 minutes depending on server speed and internet connection.

**Monitor progress:**
- Watch **Logs** tab for real-time output
- Check **Services** to see container status
- All services should show "running" when complete

### 7. Access Your InsForge Instance

#### 7.1 Test Backend API

```bash
# Without domain
curl http://your-server-ip:7130/api/health

# With domain
curl https://api.yourdomain.com/api/health
```

Expected response:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "service": "Insforge OSS Backend",
  "timestamp": "2025-10-29T..."
}
```

#### 7.2 Access Dashboard

**Without domain:**
```
http://your-server-ip:7131
```

**With domain:**
```
https://app.yourdomain.com
```

#### 7.3 ⚠️ Important: Custom Admin Credentials Configuration

> **🚧 Active Development Notice**: InsForge is currently in active development. The credential management system is being developed. The following is a temporary workaround that will be replaced with a secure implementation in future releases.

**If you customize admin credentials** in your environment variables (which is recommended), you must **also update the frontend login page** to match. This is a temporary requirement during our development phase.

**Step 1: Update Environment Variables** (already done in Step 4)

```env
ADMIN_EMAIL=your-custom-admin@example.com
ADMIN_PASSWORD=your-secure-password-here
```

**Step 2: Manually Edit Login Page**

Access your server via SSH and edit the login page:

```bash
# SSH into your Coolify server
ssh root@your-server-ip

# Navigate to the InsForge repository (adjust path if needed)
cd /data/coolify/sources/<resource-id>/insforge

# Edit the login page
nano frontend/src/features/login/page/LoginPage.tsx
```

Find this section (around line 38-41):
```typescript
defaultValues: {
  email: 'admin@example.com',
  password: 'change-this-password',
},
```

Update to match your environment variables:
```typescript
defaultValues: {
  email: 'your-custom-admin@example.com',  // Match ADMIN_EMAIL
  password: 'your-secure-password-here',   // Match ADMIN_PASSWORD
},
```

Save the file (`Ctrl+O`, `Enter`, `Ctrl+X`) and redeploy in Coolify.

### 8. Verify All Services

Check that all services are running:

```bash
# In Coolify dashboard: View each service status
# Or via SSH:
docker compose ps
```

You should see 5 running services:
- `insforge-postgres` (Database)
- `insforge-postgrest` (REST API)
- `insforge` (Backend + Frontend)
- `insforge-deno` (Serverless functions)
- `insforge-vector` (Log collection)

## 🔧 Management & Maintenance

### View Logs

**Via Coolify Dashboard:**
1. Navigate to your resource
2. Click **Logs** tab
3. Select service from dropdown
4. Real-time logs with search/filter

**Via Command Line:**
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f insforge
docker compose logs -f postgres
docker compose logs -f deno
```

### Stop Services

**Via Coolify:**
- Click service → **Stop**

**Via Command Line:**
```bash
docker compose down
```

### Restart Services

**Via Coolify:**
- Click **Redeploy** or individual service **Restart**

**Via Command Line:**
```bash
docker compose restart

# Restart specific service
docker compose restart insforge
```

### Update InsForge

**Via Coolify (Recommended):**
1. Navigate to your resource
2. Click **Redeploy**
3. Enable **Pull Latest Images**
4. Click **Deploy**

**Via Command Line:**
```bash
cd /data/coolify/sources/<resource-id>/insforge
git pull origin main
docker compose down
docker compose up -d --pull always
```

### Backup Database

**Via Coolify UI:**
1. Navigate to **postgres** service
2. Click **Backups** tab
3. Configure:
   - **Schedule**: Cron expression (e.g., `0 2 * * *` for daily at 2 AM)
   - **Retention**: Number of backups (e.g., 7)
   - **Storage**: S3-compatible or local
4. Add S3 credentials if using remote storage
5. Click **Backup Now** to test

**Via Command Line:**
```bash
# Create backup
docker exec insforge-postgres pg_dump -U postgres insforge > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore from backup
cat backup_file.sql | docker exec -i insforge-postgres psql -U postgres -d insforge
```

### Monitor Resources

**Via Coolify Dashboard:**
- Navigate to **Servers** to view CPU, memory, disk usage

**Via Command Line:**
```bash
# Check disk usage
df -h

# Check memory usage
free -h

# Check Docker stats
docker stats

# View Coolify-specific metrics
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

## 🐛 Troubleshooting

### Services Won't Start

**Check logs:**
```bash
docker compose logs
```

**Common issues:**
1. **Database not ready**: Wait for PostgreSQL health check to pass
2. **Port conflicts**: Ensure ports are available
3. **Memory issues**: Check `free -h`, consider upgrading server
4. **Disk space**: Check `df -h`, clean up if needed

**Solutions:**
```bash
# Restart Docker daemon
sudo systemctl restart docker

# Recreate services
docker compose down
docker compose up -d
```

### Cannot Access Dashboard

1. **Check services are running:**
```bash
docker compose ps
```

2. **Verify firewall rules:**
```bash
sudo ufw status
```

3. **Check Coolify proxy (Traefik):**
```bash
docker ps | grep traefik
docker logs coolify-proxy
```

4. **Test direct port access:**
```bash
curl http://localhost:7131
```

### Database Connection Errors

1. **Verify PostgreSQL is healthy:**
```bash
docker exec insforge-postgres pg_isready -U postgres
```

2. **Check environment variables:**
```bash
# In Coolify: View environment variables
# Via CLI:
docker compose config | grep POSTGRES
```

3. **Verify services are on same network:**
```bash
docker network inspect coolify
```

### SSL Certificate Issues

**Check certificate status:**
```bash
docker logs coolify-proxy | grep -i certificate
```

**Common fixes:**
1. Verify DNS propagation: `nslookup yourdomain.com`
2. Ensure ports 80/443 are open
3. Check no other service uses ports 80/443
4. Wait 5 minutes and retry certificate generation

**Manual certificate renewal:**
```bash
# Coolify handles this automatically, but to force:
docker exec coolify-proxy traefik refresh
```

### Out of Memory

**Symptoms:**
- Services crashing
- Slow performance
- Docker commands hanging

**Solutions:**
1. **Upgrade server RAM**: 4 GB minimum, 8 GB recommended
2. **Add swap space:**
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

3. **Reduce services**: Consider external database

### Port Already in Use

```bash
# Find what's using the port
sudo netstat -tulpn | grep :7130

# Kill the process
sudo kill -9 <PID>

# Or change port in environment variables
```

## 🔒 Security Best Practices

### 1. Change Default Passwords

Immediately after deployment:
- Update `ADMIN_PASSWORD` in environment variables
- Change PostgreSQL password
- Update frontend login defaults (as shown in Step 7.3)

### 2. Configure Firewall

**Allow only necessary ports:**
```bash
# HTTP/HTTPS (required for SSL and traffic)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Coolify dashboard
sudo ufw allow 8000/tcp

# SSH (be careful!)
sudo ufw allow 22/tcp

# Enable firewall
sudo ufw enable
```

**Block direct access to application ports:**
```bash
# These will be accessible only via Traefik proxy
sudo ufw deny 5432/tcp  # PostgreSQL
sudo ufw deny 5430/tcp  # PostgREST
sudo ufw deny 7130/tcp  # Backend
sudo ufw deny 7131/tcp  # Frontend
sudo ufw deny 7133/tcp  # Deno
```

### 3. Enable HTTPS Only

Always use custom domains with SSL certificates for production.

### 4. Regular Updates

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Update Coolify (via dashboard or):
curl -fsSL https://cdn.coollabs.io/coolify/upgrade.sh | sudo bash

# Update InsForge (via Coolify redeploy)
```

### 5. Automated Backups

Configure daily database backups with off-site storage (S3, Backblaze B2, etc.)

### 6. Monitor Logs

Set up alerts in Coolify for:
- Service failures
- High resource usage
- Disk space warnings

### 7. Limit SSH Access

```bash
# Restrict SSH to specific IP
sudo ufw allow from YOUR_IP to any port 22

# Or use SSH keys only (disable password auth)
sudo nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no
sudo systemctl restart sshd
```

## 📊 Performance Optimization

### For Production Workloads

1. **Upgrade Server Resources**
   - Minimum: 2 CPU, 4 GB RAM, 30 GB storage
   - Recommended: 4 CPU, 8 GB RAM, 50 GB storage

2. **Use External Database**
   - Migrate to managed PostgreSQL (AWS RDS, DigitalOcean, etc.)
   - Better reliability and automated backups

3. **Configure CDN**
   - Cloudflare, BunnyCDN, or AWS CloudFront
   - Faster frontend asset delivery

4. **Enable Redis Caching** (Coming Soon)
   - Add Redis service to docker-compose
   - Configure in environment variables

5. **Scale Horizontally**
   - Deploy multiple backend instances
   - Use load balancer (Traefik supports this)

### Database Optimization

Edit `docker-init/db/postgresql.conf`:

```conf
# Recommended: 25% of available RAM
shared_buffers = 1GB
effective_cache_size = 3GB

# For 8GB RAM server
max_connections = 100
work_mem = 16MB
maintenance_work_mem = 256MB
```

Restart PostgreSQL after changes:
```bash
docker compose restart postgres
```

## 📝 Cost Estimation

**Self-Hosted (Recommended):**

| Component | Type | Monthly Cost |
|-----------|------|--------------|
| Coolify Software | Self-hosted | **$0 (FREE)** |
| VPS Server | Hetzner CPX21 (3 vCPU, 4 GB RAM) | ~$5.50 |
| Bandwidth | 20 TB included | $0 |
| SSL Certificates | Let's Encrypt (auto) | $0 |
| **Total** | | **~$5.50/month** |

**Coolify Cloud (Managed):**

| Component | Type | Monthly Cost |
|-----------|------|--------------|
| Coolify Cloud | Base (2 servers) | $5 |
| VPS Server | Hetzner CPX21 (3 vCPU, 4 GB RAM) | ~$5.50 |
| **Total** | | **~$10.50/month** |

> 💡 **Cost Optimization**: Coolify is 100% free and open source when self-hosted. You only pay for your server (~$5/month on Hetzner). Coolify Cloud ($5/month) provides managed hosting of the Coolify control panel with email alerts and automatic updates.

## ✅ Post-Deployment Checklist

- [ ] All 5 services running (postgres, postgrest, insforge, deno, vector)
- [ ] Database connections working
- [ ] Backend `/api/health` responds with 200 OK
- [ ] Frontend loads correctly
- [ ] Admin login works with custom credentials
- [ ] SSL certificates active (if using domains)
- [ ] Health checks passing in Coolify
- [ ] Logs accessible and no errors
- [ ] Backups configured (daily recommended)
- [ ] Firewall rules properly set
- [ ] Environment variables secured (no defaults)
- [ ] Custom domains configured (if applicable)

## 🆘 Support & Resources

**InsForge Resources:**
- [Documentation](https://docs.insforge.dev)
- [GitHub Issues](https://github.com/insforge/insforge/issues)
- [Discord Community](https://discord.com/invite/MPxwj5xVvW)
- Email: info@insforge.dev

**Coolify Resources:**
- [Coolify Documentation](https://coolify.io/docs)
- [Coolify Discord](https://discord.com/invite/coolify)
- [Coolify GitHub](https://github.com/coollabsio/coolify)
- [Coolify Status](https://status.coolify.io)

## 🎉 Next Steps

**Congratulations!** Your InsForge instance is now running on Coolify.

1. **Connect AI Agent**: Follow dashboard "Connect" guide and set up MCP
2. **Configure OAuth**: Add Google/GitHub/Discord credentials for social login
3. **Set Up Storage**: Configure AWS S3 for file uploads (or use local storage)
4. **Deploy Functions**: Test serverless functions via Deno runtime
5. **Build Your App**: Start using InsForge with AI coding agents!
