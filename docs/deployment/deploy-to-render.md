# Deploy InsForge to Render

This guide walks you through deploying InsForge on Render, a modern cloud platform with managed services and automatic scaling.

## 📋 Prerequisites

- Render account (free tier available at [render.com](https://render.com))
- GitHub account (for repository connection)
- Basic knowledge of environment variables
- Domain name (optional, for custom domain)

## 🎯 Why Render?

- **Managed PostgreSQL**: Fully managed database with automatic backups
- **Auto-deploy**: Automatic deployments from Git commits
- **Free SSL**: Automatic HTTPS certificates
- **Simple Scaling**: Easy horizontal and vertical scaling
- **Free Tier**: Suitable for testing and small projects

## 🚀 Deployment Steps

### 1. Fork InsForge Repository

1. Visit [https://github.com/insforge/insforge](https://github.com/insforge/insforge)
2. Click **Fork** to create your copy
3. This allows Render to connect to your repository

### 2. Set Up Render Account

1. Visit [https://render.com](https://render.com) and sign up
2. Connect GitHub account
3. Authorize Render to access repositories
4. Select your forked InsForge repository

### 3. Create PostgreSQL Database

#### 3.1 Create Database

1. From Render Dashboard: **New** → **PostgreSQL**
2. Configure:
   - **Name**: `insforge-db`
   - **Database**: `insforge`
   - **User**: `insforge_user`
   - **Region**: Select closest to users
   - **Version**: PostgreSQL 15+
   - **Plan**: 
     - Free: Testing (90 days)
     - Starter ($7/month): Small production
     - Standard ($20/month): Production

3. Click **Create Database**
4. Save connection details (internal & external URLs)

#### 3.2 Initialize Database

Connect and run initialization scripts:

```bash
# Download init scripts
curl -O https://raw.githubusercontent.com/insforge/insforge/main/deploy/docker-init/db/db-init.sql
curl -O https://raw.githubusercontent.com/insforge/insforge/main/deploy/docker-init/db/jwt.sql

# Connect to database
psql <your-external-database-url>

# Run initialization
\i db-init.sql
\i jwt.sql
\q
```

### 4. Deploy Backend Service

#### 4.1 Create Web Service

1. **New** → **Web Service**
2. Connect repository
3. Configure:
   - **Name**: `insforge-backend`
   - **Region**: Same as database
   - **Branch**: `main`
   - **Runtime**: `Docker`
   - **Dockerfile Path**: `Dockerfile`
   - **Instance Type**: Starter ($7/month) minimum

**Start Command:**
```bash
sh -c "cd backend && npm run migrate:up && cd .. && npm run start"
```

#### 4.2 Environment Variables

Add these critical variables:

```env
# Server
PORT=7130

# Database (use internal URL)
DATABASE_URL=${{insforge-db.DATABASE_URL}}
POSTGRES_HOST=<from-database>
POSTGRES_PORT=5432
POSTGRES_DB=insforge
POSTGRES_USER=insforge_user
POSTGRES_PASSWORD=<from-database>

# Security (Generate with openssl rand -base64 32)
JWT_SECRET=<strong-secret-32+chars>
ENCRYPTION_KEY=<strong-secret-24-chars>

# Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<strong-password>

# APIs (update after deployment)
API_BASE_URL=https://insforge-backend.onrender.com
VITE_API_BASE_URL=https://insforge-backend.onrender.com

# Services
POSTGREST_BASE_URL=http://insforge-postgrest:3000
DENO_RUNTIME_URL=http://insforge-deno:7133

# Storage
STORAGE_DIR=/var/data/storage
LOGS_DIR=/var/data/logs

# Optional: OAuth, S3, etc.
```

**Generate Secrets:**
```bash
openssl rand -base64 32  # JWT_SECRET
openssl rand -base64 24  # ENCRYPTION_KEY
```

### 5. Deploy PostgREST

1. **New** → **Web Service**
2. **Deploy from existing image**
3. Configure:
   - **Name**: `insforge-postgrest`
   - **Image**: `postgrest/postgrest:v12.2.12`
   - **Plan**: Starter ($7/month)

**Environment Variables:**
```env
PGRST_DB_URI=${{insforge-db.DATABASE_URL}}
PGRST_OPENAPI_SERVER_PROXY_URI=https://insforge-backend.onrender.com
PGRST_DB_SCHEMA=public
PGRST_DB_ANON_ROLE=anon
PGRST_JWT_SECRET=<same-as-backend>
PGRST_DB_CHANNEL_ENABLED=true
PGRST_DB_CHANNEL=pgrst
```

### 6. Deploy Deno Runtime

#### 6.1 Create Deno Dockerfile

Create `Dockerfile.deno` in repository root:

```dockerfile
FROM denoland/deno:alpine-2.0.6
WORKDIR /app
COPY functions /app/functions
RUN deno cache functions/server.ts
EXPOSE 7133
ENV PORT=7133
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read=./functions/worker-template.js", "functions/server.ts"]
```

#### 6.2 Create Service

1. **New** → **Web Service**
2. Configure:
   - **Name**: `insforge-deno`
   - **Runtime**: `Docker`
   - **Dockerfile Path**: `Dockerfile.deno`
   - **Plan**: Starter ($7/month)

**Environment Variables:**
```env
PORT=7133
DENO_ENV=production
POSTGRES_HOST=<from-database>
POSTGRES_PORT=5432
POSTGRES_DB=insforge
POSTGRES_USER=insforge_user
POSTGRES_PASSWORD=<from-database>
POSTGREST_BASE_URL=http://insforge-postgrest:3000
ENCRYPTION_KEY=<same-as-backend>
JWT_SECRET=<same-as-backend>
WORKER_TIMEOUT_MS=30000
```

### 7. Deploy Frontend

#### Option A: Static Site (Recommended - Free)

1. **New** → **Static Site**
2. Configure:
   - **Name**: `insforge-frontend`
   - **Root Directory**: `frontend`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`

**Environment:**
```env
VITE_API_BASE_URL=https://insforge-backend.onrender.com
```

#### Option B: Web Service

1. **New** → **Web Service**
2. Configure:
   - **Root Directory**: `frontend`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run preview -- --host 0.0.0.0 --port $PORT`

### 8. Update Service URLs

After all services deploy, update backend environment:

```env
API_BASE_URL=https://insforge-backend.onrender.com
POSTGREST_BASE_URL=https://insforge-postgrest.onrender.com
DENO_RUNTIME_URL=https://insforge-deno.onrender.com
```

Save to trigger redeploy.

### 9. Access Your Instance

**Service URLs:**
- Backend: `https://insforge-backend.onrender.com`
- Frontend: `https://insforge-frontend.onrender.com`
- PostgREST: `https://insforge-postgrest.onrender.com`
- Deno: `https://insforge-deno.onrender.com`

**Test Backend:**
```bash
curl https://insforge-backend.onrender.com/api/health
```

**Access Dashboard:**
```
https://insforge-frontend.onrender.com
```

### 10. Custom Domain (Optional)

1. In each service: **Settings** → **Custom Domains**
2. Add domains:
   - Backend: `api.yourdomain.com`
   - Frontend: `app.yourdomain.com`

3. Add CNAME records in DNS:
```
api.yourdomain.com → insforge-backend.onrender.com
app.yourdomain.com → insforge-frontend.onrender.com
```

4. Update environment variables with custom URLs
5. SSL certificates provisioned automatically

## 🔧 Management

### View Logs
1. Service dashboard → **Logs** tab
2. Real-time logs with search/filter

### Manual Deploy
Service dashboard → **Manual Deploy** → **Deploy latest commit**

### Auto-Deploy
Push to GitHub → Automatic deployment

### Update InsForge
```bash
git pull upstream main
git push origin main  # Triggers auto-deploy
```

### Restart Services
**Manual Deploy** → **Clear build cache & deploy**

### Scale Services
- **Vertical**: Settings → Instance Type
- **Horizontal**: Adjust instances slider (Standard+ plans)

### Backup Database
```bash
# Manual backup
pg_dump <external-url> > backup_$(date +%Y%m%d).sql

# Automatic backups on paid plans
```

## 🐛 Troubleshooting

### Build Failures
- Check build logs in failed deploy
- Clear build cache and retry
- Verify Dockerfile paths

### Service Won't Start
- Check logs for errors
- Verify PORT environment variable
- Test database connection
- Confirm all environment variables set

### Database Connection Errors
- Use internal URL for same-region services
- Verify credentials
- Check database status (Available)

### Free Tier Spin Down
- Services sleep after 15 min inactivity
- Expect 30s+ cold starts
- Upgrade to paid for always-on

### Environment Variable Issues
```javascript
// Add debugging
console.log('Env check:', {
  DATABASE_URL: !!process.env.DATABASE_URL,
  JWT_SECRET: !!process.env.JWT_SECRET
});
```

## 📊 Cost Estimation

**Starter Setup ($28/month):**
- PostgreSQL: $7
- Backend: $7
- PostgREST: $7
- Deno: $7
- Frontend: Free (static)

**Free Tier (Testing):**
- All services: Free
- Limitations: Spin down, 90-day DB limit

**Production ($69/month):**
- PostgreSQL Standard: $20
- Backend Standard: $25
- PostgREST Starter: $7
- Deno Starter: $7
- Redis: $10
- Frontend: Free

## 🔒 Security Best Practices

1. **Strong Secrets**: Use `openssl rand -base64 32`
2. **Environment Variables**: Never commit secrets
3. **Database**: Use managed PostgreSQL, enable backups
4. **HTTPS**: Automatic SSL everywhere
5. **Updates**: Keep dependencies current
6. **Access Control**: Implement proper authentication
7. **Monitoring**: Set up alerts for failures
8. **Rate Limiting**: Implement in application

## 📋 Blueprint Deployment (Advanced)

Create `render.yaml` for infrastructure-as-code:

```yaml
services:
  - type: pserv
    name: insforge-db
    plan: starter
    databaseName: insforge

  - type: web
    name: insforge-backend
    env: docker
    dockerfilePath: ./Dockerfile
    plan: starter
    healthCheckPath: /api/health
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: insforge-db
          property: connectionString

  - type: web
    name: insforge-postgrest
    env: docker
    image:
      url: postgrest/postgrest:v12.2.12

  - type: web
    name: insforge-frontend
    env: static
    buildCommand: cd frontend && npm install && npm run build
    staticPublishPath: ./frontend/dist
```

Deploy: **New** → **Blueprint** → Connect repository

## ✅ Post-Deployment Checklist

- [ ] All services running
- [ ] Database connections working
- [ ] Backend `/api/health` responds
- [ ] Frontend loads correctly
- [ ] Admin login works
- [ ] SSL certificates active
- [ ] Health checks passing
- [ ] Logs accessible
- [ ] Backups configured (paid)
- [ ] Monitoring set up
- [ ] Custom domains configured (if applicable)

## 🆘 Support

**Render Resources:**
- [Render Docs](https://render.com/docs)
- [Render Community](https://community.render.com)
- [Render Status](https://status.render.com)

**InsForge Resources:**
- [Documentation](https://docs.insforge.dev)
- [GitHub](https://github.com/insforge/insforge)
- [Discord](https://discord.com/invite/MPxwj5xVvW)
- Email: info@insforge.dev

## 🎉 Next Steps

**Congratulations!** Your InsForge instance is running on Render.

1. **Connect AI Agent**: Follow dashboard "Connect" guide
2. **Configure OAuth**: Set up Google/GitHub/Discord
3. **Add S3 Storage**: Configure AWS S3 for file uploads
4. **Set Up Monitoring**: Configure alerts and notifications
5. **Test Functions**: Deploy serverless functions via Deno
6. **Build Your App**: Start using InsForge with AI agents!

---

For other deployment options, see [deployment guides](./README.md).
