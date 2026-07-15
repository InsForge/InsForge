---
title: "Deploy InsForge to AWS EC2"
description: "Step-by-step guide to deploy InsForge on an AWS EC2 instance using Docker Compose, including SSH setup, domain config, and TLS termination."
---

# Deploy InsForge to AWS EC2

This guide will walk you through deploying InsForge on an AWS EC2 instance using Docker Compose.

<Note>
  This cloud walkthrough is community-maintained and can lag the latest InsForge release. The canonical, always-current setup is the `deploy/docker-compose/` directory in the [InsForge repo](https://github.com/InsForge/InsForge).
</Note>

## 📋 Prerequisites

- AWS Account with EC2 access
- Basic knowledge of SSH and command-line operations
- Domain name (optional, for custom domain setup)

## 🚀 Deployment steps

### 1. Create and configure EC2 instance

#### 1.1 Launch EC2 instance

1. **Log into AWS Console** and navigate to EC2 Dashboard
2. **Click "Launch Instance"**
3. **Configure Instance:**
   - **Name**: `insforge-server` (or your preferred name)
   - **AMI**: Ubuntu Server 24.04 LTS (HVM), SSD Volume Type
   - **Instance Type**: `t3.medium` or larger (minimum 2 vCPU, 4 GB RAM)
     - For production: `t3.large` (2 vCPU, 8 GB RAM) recommended
     - For testing: `t3.small` (2 vCPU, 2 GB RAM) minimum
   - **Key Pair**: Create new or select existing key pair (download and save the `.pem` file)
   - **Storage**: 30 GB gp3 (minimum 20 GB recommended)

#### 1.2 Configure security group

Create or configure security group with the following inbound rules:

| Type        | Protocol | Port Range | Source    | Description          |
|-------------|----------|------------|-----------|----------------------|
| SSH         | TCP      | 22         | My IP     | SSH access           |
| HTTP        | TCP      | 80         | 0.0.0.0/0 | HTTP access          |
| HTTPS       | TCP      | 443        | 0.0.0.0/0 | HTTPS access         |
| Custom TCP  | TCP      | 7130       | 0.0.0.0/0 | Dashboard + API      |
| Custom TCP  | TCP      | 5432       | 0.0.0.0/0 | PostgreSQL (optional)|

> ⚠️ **Security Note**: For production, restrict PostgreSQL (5432) to specific IP addresses or remove external access entirely. Consider using a reverse proxy (nginx) and exposing only ports 80/443.

#### 1.3 Allocate Elastic IP (recommended)

1. Navigate to **Elastic IPs** in EC2 Dashboard
2. Click **Allocate Elastic IP address**
3. Associate the Elastic IP with your instance

This ensures your instance keeps the same IP address even after restarts.

### 2. Connect to your EC2 instance

```bash
# Set correct permissions for your key file
chmod 400 your-key-pair.pem

# Connect via SSH
ssh -i your-key-pair.pem ubuntu@your-ec2-public-ip
```

### 3. Install dependencies

#### 3.1 Update system packages

```bash
sudo apt update && sudo apt upgrade -y
```

#### 3.2 Install Docker

```text
Follow the instructions of the link below to install and verify docker on your new ubuntu ec2 instance:
https://docs.docker.com/engine/install/ubuntu/
```

#### 3.3 Add your user to Docker group

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

> ⚠️ **Security Note**: Adding a user to the `docker` group grants them root-equivalent privileges on the system. This is acceptable for single-user environments like your EC2 instance, but be cautious on shared systems.

#### 3.4 Install Git

```bash
sudo apt install git -y
```

### 4. Deploy InsForge

#### 4.1 Clone repository

```bash
cd ~
git clone https://github.com/insforge/insforge.git
cd insforge/deploy/docker-compose
```

#### 4.2 Create environment configuration

Copy the example template to create your `.env` file:

```bash
cp .env.example .env
nano .env
```

The full template lives at `deploy/docker-compose/.env.example`. These are the variables you must set:

```env
# Required
JWT_SECRET=your-secret-key-here-must-be-32-char-or-above
ROOT_ADMIN_USERNAME=admin
ROOT_ADMIN_PASSWORD=change-this-password
POSTGRES_PASSWORD=change-this-password

# Optional: falls back to JWT_SECRET if left blank
ENCRYPTION_KEY=

# Optional: enables AI features
OPENROUTER_API_KEY=

# Optional: enables site deployments
VERCEL_TOKEN=
VERCEL_TEAM_ID=
VERCEL_PROJECT_ID=

# Optional: OAuth providers
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

The `.env.example` template carries the remaining variables and their defaults, so editing the copied file is enough.

**Generate Secure Secrets:**

```bash
# Generate JWT_SECRET (32+ characters)
openssl rand -base64 32

# Generate ENCRYPTION_KEY (must be exactly 32 characters)
openssl rand -base64 24
```

> 💡 **Important**: Save these secrets securely. You'll need them if you ever migrate or restore your instance.

#### 4.3 Start InsForge services

```bash
# Pull Docker images and start services
docker compose up -d

# View logs to ensure everything started correctly
docker compose logs -f
```

Press `Ctrl+C` to exit log view.

#### 4.4 Verify services

```bash
# Check running containers
docker compose ps

# You should see 4 running services:
# - postgres
# - postgrest
# - insforge
# - deno
```

### 5. Access your InsForge instance

#### 5.1 Test backend API

```bash
curl http://your-ec2-ip:7130/api/health
```

Expected response:
```json
{
  "status": "ok",
  "version": "2.1.7",
  "service": "Insforge OSS Backend",
  "timestamp": "2025-10-17T..."
}
```

#### 5.2 Access dashboard

Open your browser and navigate to:
```text
http://your-ec2-ip:7130
```

Log in with the `ROOT_ADMIN_USERNAME` and `ROOT_ADMIN_PASSWORD` you set in `.env`.

### 6. Configure domain (optional but recommended)

#### 6.1 Update DNS records

Add DNS A records pointing to your EC2 Elastic IP:
```text
api.yourdomain.com    → your-ec2-ip
app.yourdomain.com    → your-ec2-ip
```

#### 6.2 Install Nginx reverse proxy

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

# Dashboard (served by the backend on the same port as the API)
server {
    listen 80;
    server_name app.yourdomain.com;

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
```

Enable the configuration:

```bash
sudo ln -s /etc/nginx/sites-available/insforge /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 6.3 Install SSL certificate (recommended)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Obtain SSL certificates
sudo certbot --nginx -d api.yourdomain.com -d app.yourdomain.com

# Follow the prompts to complete setup
```

Update your `.env` file with HTTPS URLs:

```bash
cd ~/insforge/deploy/docker-compose
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

## 🔧 Management & maintenance

### View logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f insforge
docker compose logs -f postgres
docker compose logs -f deno
```

### Stop services

```bash
docker compose down
```

### Restart services

```bash
docker compose restart
```

### Update InsForge

InsForge ships prebuilt images, so an update is a pull and restart. Run this from `~/insforge/deploy/docker-compose`:

```bash
cd ~/insforge/deploy/docker-compose
git pull origin main
docker compose pull && docker compose up -d
```

### Backup database

Run these from `~/insforge/deploy/docker-compose`:

```bash
# Create backup
docker compose exec postgres pg_dump -U postgres insforge > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore from backup
cat backup_file.sql | docker compose exec -T postgres psql -U postgres -d insforge
```

### Monitor resources

```bash
# Check disk usage
df -h

# Check memory usage
free -h

# Check Docker stats
docker stats
```

## 🐛 Troubleshooting

### Services won't start

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

### Cannot connect to database

```bash
# Check if PostgreSQL is running
docker compose ps postgres

# Check PostgreSQL logs
docker compose logs postgres

# Verify credentials in .env file
cat .env | grep POSTGRES
```

### Port already in use

```bash
# Check what's using the port
sudo netstat -tulpn | grep :7130

# Kill the process or change port in docker-compose.yml
```

### Out of memory

Consider upgrading to a larger instance type:
```text
- Current: t3.medium (4 GB RAM)
- Upgrade to: t3.large (8 GB RAM)
```

### SSL certificate issues

```bash
# Renew certificates
sudo certbot renew

# Test renewal
sudo certbot renew --dry-run
```

## 📊 Performance optimization

### For production workloads

1. **Upgrade Instance Type**: Use `t3.large` or `t3.xlarge`
2. **Enable Auto-scaling**: Set up Application Load Balancer with auto-scaling groups
3. **Use RDS**: Migrate from containerized PostgreSQL to AWS RDS for better reliability
4. **Enable CloudWatch**: Monitor metrics and set up alarms
5. **Configure Backups**: Set up automated daily backups
6. **Use S3 for Storage**: Configure S3 bucket for file uploads instead of local storage

### Database optimization

```conf
# Increase PostgreSQL shared_buffers (edit postgresql.conf in deploy/docker-init/db/)
# Recommended: 25% of available RAM
shared_buffers = 1GB
effective_cache_size = 3GB
```

## 🔒 Security best practices

1. **Change Default Passwords**: Update admin and database passwords
2. **Enable Firewall**: Use AWS Security Groups effectively
3. **Regular Updates**: Keep system and Docker images updated
4. **SSL/TLS**: Always use HTTPS in production
5. **Backup Regularly**: Automate database backups
6. **Monitor Logs**: Set up log monitoring and alerts
7. **Limit SSH Access**: Restrict SSH to specific IP addresses
8. **Use IAM Roles**: Instead of AWS access keys where possible

## 🆘 Support & resources

- **Documentation**: [https://docs.insforge.dev](https://docs.insforge.dev)
- **GitHub Issues**: [https://github.com/insforge/insforge/issues](https://github.com/insforge/insforge/issues)
- **Discord Community**: [https://discord.com/invite/MPxwj5xVvW](https://discord.com/invite/MPxwj5xVvW)

## 📝 Cost estimation

**Monthly AWS Costs (approximate):**

| Component | Type | Monthly Cost |
|-----------|------|--------------|
| EC2 Instance | t3.medium | ~$30 |
| Storage (30 GB) | EBS gp3 | ~$3 |
| Elastic IP | (if running 24/7) | $0 |
| Data Transfer | First 100GB free | Variable |
| **Total** | | **~$33/month** |

> 💡 **Cost Optimization**: Use AWS Savings Plans or Reserved Instances for long-term deployments to save up to 70%.

---

**Congratulations! 🎉** Your InsForge instance is now running on AWS EC2. You can start building applications by connecting AI agents to your backend platform.

For other production deployment strategies, check out our [deployment guides](/deployment/deployment-security-guide).
