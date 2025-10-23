# Deploy InsForge to Fly.io

This guide walks you through deploying InsForge on Fly.io. The recommended architecture is to use Fly's managed PostgreSQL and run each InsForge service (backend API, PostgREST, Deno runtime, optional frontend, optional Vector/log shipping) as an individual Fly app so that they can scale independently and leverage Fly's global networking.

## 📋 Prerequisites
- Fly.io account with billing enabled (managed Postgres requires a credit card)
- `flyctl` installed locally ([install docs](https://fly.io/docs/hands-on/install-flyctl/))
- Docker 24+ for local builds (or a CI/CD workflow that builds and pushes images)
- Access to the InsForge repository and production `.env` template
- Domain name (optional) for custom domains

## 🎯 Why Fly.io?
- **Global Anycast network**: Run services close to your users with low-latency routing.
- **Managed PostgreSQL**: Fly Postgres handles backups, monitoring, and automated failover.
- **Scales by service**: Independent Fly apps or Machines for API, PostgREST, Deno, and frontend.
- **Simple secrets management**: `flyctl secrets` keeps credentials encrypted at rest.
- **Built-in HTTPS**: Automatic certificates for `*.fly.dev` and custom domains.

## 🚀 Deployment Steps

### 1. Set Up Fly.io CLI

#### 1.1 Install `flyctl`

```bash
# macOS (Homebrew)
brew install flyctl
# Linux
curl -L https://fly.io/install.sh | sh
# Windows (PowerShell)
iwr https://fly.io/install.ps1 -useb | iex
```

#### 1.2 Authenticate and select organization

```bash
fly auth login
fly orgs list
# Create a new org if needed
fly orgs create insforge-org
```

Pick a primary region close to your users (e.g., `iad`, `lhr`, `syd`). All services should live in the same region for lowest latency to the database.

### 2. Clone InsForge Repository

```bash
git clone https://github.com/insforge/insforge.git
cd insforge
```

Keep the repo up to date:

```bash
git pull origin main
```

### 3. Provision Fly Postgres

Fly Postgres provides managed storage with automated backups.

```bash
fly pg create --name insforge-db --org insforge-org --region iad --vm-size shared-cpu-1x --initial-cluster-size 1
```

Useful commands:

```bash
# View credentials
fly pg credentials list insforge-db
# Attach database to an app (auto-creates DATABASE_URL secret)
fly pg attach insforge-db --app insforge-backend
```

Record the generated `DATABASE_URL`, user, password, and certificates. You will use the same connection string for backend, PostgREST, and the Deno runtime.

### 4. Create Fly Apps

Provision a Fly app for each InsForge service. Replace `insforge-org` and `iad` with your organization and region.

#### 4.1 Backend API (`insforge-backend`)

```bash
cd backend
fly launch --name insforge-backend --org insforge-org --region iad --no-deploy
```

Update `backend/fly.toml` so Fly builds from the monorepo root:

```toml
app = "insforge-backend"
primary_region = "iad"

[build]
  dockerfile = "../Dockerfile"
  context = ".."

[http_service]
  internal_port = 7130
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = "start"
```

Return to the repository root before continuing:

```bash
cd ..
```

#### 4.2 PostgREST (`insforge-postgrest`)

```bash
mkdir -p infra/fly/postgrest
cat <<'EOF2' > infra/fly/postgrest/fly.toml
app = "insforge-postgrest"
primary_region = "iad"

[http_service]
  internal_port = 3000
  force_https = true

[deploy]
  image = "postgrest/postgrest:v12.2.12"
EOF2
```

Set the required secrets:

```bash
fly secrets set \
  PGRST_DB_URI="postgres://<user>:<password>@<host>:5432/<db>" \
  PGRST_DB_SCHEMA=public \
  PGRST_DB_ANON_ROLE=anon \
  PGRST_JWT_SECRET="your-jwt-secret" \
  PGRST_OPENAPI_SERVER_PROXY_URI="https://insforge-backend.fly.dev" \
  PGRST_DB_CHANNEL_ENABLED=true \
  PGRST_DB_CHANNEL=pgrst \
  --app insforge-postgrest
```

If you prefer to manage configuration interactively, you can also run `fly launch --name insforge-postgrest --org insforge-org --region iad --no-deploy` inside `infra/fly/postgrest`.

#### 4.3 Deno Runtime (`insforge-deno`)

```bash
cd functions
fly launch --name insforge-deno --org insforge-org --region iad --no-deploy
```

Adjust `functions/fly.toml` so it uses the Deno-specific Dockerfile you will create in step 6:

```toml
app = "insforge-deno"
primary_region = "iad"

[build]
  dockerfile = "../Dockerfile.deno"
  context = ".."

[http_service]
  internal_port = 7133
  force_https = true
```

Return to the repository root:

```bash
cd ..
```

#### 4.4 Frontend (optional)

Decide whether to use a static build or a SSR deployment.

- **Static (recommended)**: Build the Vite app once and serve via Fly Machines or CDN.
  ```bash
  cd frontend
  fly launch --name insforge-frontend --org insforge-org --region iad --no-deploy
  ```
  Update `frontend/fly.toml` to run `npm run preview` on port 4173 or adapt it for static assets:
  ```toml
  app = "insforge-frontend"
  primary_region = "iad"

  [build]
    dockerfile = "../frontend.Dockerfile"
    context = ".."

  [http_service]
    internal_port = 4173
    force_https = true
  ```
  Example `frontend.Dockerfile` in the repository root:
  ```dockerfile
  FROM node:20-alpine AS build
  WORKDIR /app
  COPY frontend/package*.json ./
  RUN npm install
  COPY frontend/ ./
  RUN npm run build

  FROM node:20-alpine
  WORKDIR /app
  RUN npm install -g serve
  COPY --from=build /app/dist ./dist
  ENV PORT=4173
  EXPOSE 4173
  CMD ["serve", "-s", "dist", "-l", "4173"]
  ```
  Return to the repository root when finished:
  ```bash
  cd ..
  ```
- **Alternative**: Host the frontend on another provider (e.g., Render, Vercel, Netlify) and point it at your Fly backend.

#### 4.5 Vector / Observability (optional)

If you rely on the `vector` log shipping container, deploy another Fly app using the `timberio/vector:0.28.1-alpine` image and configure it to forward logs to your preferred destination. Attach any required credentials via `fly secrets`.

### 5. Configure Environment & Secrets

Create a production `.env.fly` for reference (do not commit it):

```env
# ============================================
# Server Configuration
# ============================================
PORT=7130
NODE_ENV=production
API_BASE_URL=https://insforge-backend.fly.dev
VITE_API_BASE_URL=https://insforge-backend.fly.dev

# ============================================
# Database Configuration (Fly Postgres)
# ============================================
DATABASE_URL=postgres://<user>:<password>@<host>:5432/<db>
POSTGRES_USER=<user>
POSTGRES_PASSWORD=<password>
POSTGRES_DB=<db>

# ============================================
# Security & Authentication
# ============================================
JWT_SECRET=your-32-char-secret
ENCRYPTION_KEY=your-32-char-secret
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this-password

# ============================================
# Service URLs
# ============================================
POSTGREST_BASE_URL=https://insforge-postgrest.fly.dev
DENO_RUNTIME_URL=https://insforge-deno.fly.dev
PGRST_OPENAPI_SERVER_PROXY_URI=https://insforge-backend.fly.dev

# ============================================
# Optional: Storage & Integrations
# ============================================
AWS_S3_BUCKET=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
OPENROUTER_API_KEY=
```

Set secrets for each app. Example for the backend:

```bash
fly secrets set \
  DATABASE_URL="postgres://<user>:<password>@<host>:5432/<db>" \
  JWT_SECRET="$(openssl rand -base64 32)" \
  ENCRYPTION_KEY="$(openssl rand -base64 24)" \
  ADMIN_EMAIL="admin@example.com" \
  ADMIN_PASSWORD="change-this-password" \
  POSTGREST_BASE_URL="https://insforge-postgrest.fly.dev" \
  DENO_RUNTIME_URL="https://insforge-deno.fly.dev" \
  AWS_S3_BUCKET="" \
  AWS_REGION="" \
  AWS_ACCESS_KEY_ID="" \
  AWS_SECRET_ACCESS_KEY="" \
  --app insforge-backend
```

Repeat for `insforge-deno` and `insforge-postgrest`, reusing the same secrets where appropriate. Values set via `fly pg attach` do not need to be reset manually.

### 6. Build and Deploy Services

#### 6.1 Backend API

```bash
cd backend
fly deploy
cd ..
```

#### 6.2 PostgREST

```bash
cd infra/fly/postgrest
fly deploy
cd ../../..
```

#### 6.3 Deno Runtime

Create `Dockerfile.deno` in the repository root:

```dockerfile
FROM denoland/deno:alpine-2.0.6
WORKDIR /app
COPY functions /app/functions
RUN deno cache functions/server.ts
ENV PORT=7133
EXPOSE 7133
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read=./functions/worker-template.js", "functions/server.ts"]
```

Deploy the runtime:

```bash
cd functions
fly deploy
cd ..
```

#### 6.4 Frontend (optional)

```bash
cd frontend
fly deploy
cd ..
```

### 7. Run Database Migrations & Seeds

Once the backend app is running, connect via SSH to run migrations:

```bash
fly ssh console --app insforge-backend
# Inside the machine
cd /app/backend
npm run migrate:up
npm run seed
exit
```

Alternatively, run migrations locally against the Fly Postgres connection string:

```bash
DATABASE_URL="postgres://<user>:<password>@<host>:5432/<db>" npm run migrate:up
```

### 8. Verify Services

```bash
fly status --app insforge-backend
fly logs --app insforge-backend
fly open --app insforge-backend
curl https://insforge-backend.fly.dev/api/health
```

Expect a JSON response similar to:

```json
{
  "status": "ok",
  "service": "Insforge OSS Backend",
  "timestamp": "2025-10-17T..."
}
```

### 9. Custom Domains & HTTPS (Optional)

1. Point your DNS A/AAAA records to Fly's Anycast IP:
   ```text
   api.yourdomain.com  → Fly IPv4
   app.yourdomain.com  → Fly IPv6 (optional)
   ```
2. Issue certificates:
   ```bash
   fly certs create api.yourdomain.com --app insforge-backend
   fly certs create app.yourdomain.com --app insforge-frontend
   ```
3. Update environment variables to use HTTPS URLs:
   ```bash
   fly secrets set API_BASE_URL=https://api.yourdomain.com --app insforge-backend
   fly secrets set VITE_API_BASE_URL=https://api.yourdomain.com --app insforge-frontend
   ```
4. Redeploy affected services.

### 10. ⚠️ Important: Custom Admin Credentials

During active development, the frontend login page still references the default admin credentials. If you change `ADMIN_EMAIL` or `ADMIN_PASSWORD`, update the frontend defaults as well:

```bash
nano frontend/src/features/login/page/LoginPage.tsx
```

Modify:

```typescript
defaultValues: {
  email: 'admin@example.com',
  password: 'change-this-password',
},
```

Replace with your custom credentials, then redeploy the frontend service. This requirement will be removed in a future release.

### 11. Optional: Single Entry Proxy

If you prefer a single external hostname, deploy a lightweight proxy (Caddy, Nginx, or Fly Replay) that routes:
- `/api` → `insforge-backend`
- `/rest` → `insforge-postgrest`
- `/functions` → `insforge-deno`
- `/` → `insforge-frontend`

Use Fly private networking (`<app>.internal`) for service-to-service communication.

## 🔧 Management & Maintenance
- **View logs**: `fly logs --app insforge-backend`
- **Restart services**: `fly scale count 0` then `fly scale count 1`, or redeploy with `fly deploy`
- **Scale vertically**: `fly scale vm shared-cpu-1x --app insforge-backend`
- **Scale horizontally**: `fly scale count 2 --app insforge-backend`
- **Update InsForge**: `git pull origin main` then redeploy each service
- **Database backups**: Fly Postgres keeps automatic nightly snapshots; trigger manual backup with `fly pg snapshot create insforge-db`
- **Monitor resources**: `fly m list --app insforge-backend` and Fly dashboard metrics

## 🐛 Troubleshooting
- **App fails to start**: `fly logs --app <app-name>` to inspect stack traces and missing env vars.
- **Database connection refused**: Ensure apps and DB are in the same region, and `DATABASE_URL` includes `?sslmode=disable` only if required.
- **PostgREST returning 500**: Verify `PGRST_DB_URI` and `PGRST_JWT_SECRET` match the backend values.
- **TLS/Custom domains pending**: DNS changes can take up to an hour; use `fly certs show <domain> --app <app>` to inspect status.
- **Cold starts**: `auto_stop_machines = "off"` keeps instances running but increases cost.
- **Exhausted volume**: Resize Fly Postgres volume with `fly pg set-volume-size insforge-db --size <GB>`.

## 📊 Performance Optimization
- **Choose larger machines**: Upgrade to `performance-1x` or `performance-2x` for CPU-intensive workloads.
- **Multi-region deployments**: Run secondary backend instances in additional regions (`fly deploy --ha`) and use Fly's global proxy.
- **Background jobs**: Use separate worker apps or Fly Machines for scheduled tasks.
- **PostgreSQL tuning**: Adjust parameters with `fly pg config update` (e.g., increase `shared_buffers` for larger instances).
- **Edge caching**: Enable CDN or Fly Replay to cache static responses closer to users.

## 🔒 Security Best Practices
1. **Rotate secrets regularly** using `fly secrets set`.
2. **Enforce HTTPS** by setting `force_https = true` and using TLS everywhere.
3. **Restrict SSH**: Use `fly ssh console` only when needed; disable inbound SSH by default.
4. **Principle of least privilege**: Limit API tokens, AWS keys, and Fly org members.
5. **Audit logs**: Monitor Fly's activity logs and InsForge application logs for anomalies.
6. **Keep dependencies current**: Rebuild images after upgrading npm packages or Docker base images.
7. **Enable rate limiting** in the backend to mitigate abuse.
8. **Backup verification**: Regularly test restoring Fly Postgres snapshots.

## 🆘 Support & Resources
- **Fly.io Docs**: [https://fly.io/docs](https://fly.io/docs)
- **InsForge Documentation**: [https://docs.insforge.dev](https://docs.insforge.dev)
- **GitHub Issues**: [https://github.com/insforge/insforge/issues](https://github.com/insforge/insforge/issues)
- **Discord Community**: [https://discord.com/invite/MPxwj5xVvW](https://discord.com/invite/MPxwj5xVvW)

## 📝 Cost Estimation

| Component | Plan | Monthly Cost* |
|-----------|------|---------------|
| Fly Postgres | `starter` (1x shared CPU, 1GB RAM, 10GB volume) | ~$30 |
| Backend API | `shared-cpu-1x` (512MB) | ~$5 |
| PostgREST | `shared-cpu-1x` (256MB) | ~$3 |
| Deno Runtime | `shared-cpu-1x` (512MB) | ~$5 |
| Frontend (static) | Fly static site | $0 |
| Vector / proxy (optional) | `shared-cpu-1x` (256MB) | ~$3 |

> 💡 **Note**: Prices vary by region and usage. Storage adds ~$0.15/GB-month. Use [Fly's pricing calculator](https://fly.io/docs/about/pricing/) for the most accurate estimate.

---

**Congratulations! 🎉** Your InsForge stack is now ready to serve traffic from Fly.io. For other deployment strategies, explore the rest of our [deployment guides](./README.md).
