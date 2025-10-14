# Deploy InsForge to Railway

This guide walks you through self‑hosting **InsForge** (open‑source Backend‑as‑a‑Service) on [Railway](https://railway.app) using its managed PostgreSQL and container deployment.

> ✅ Goal: One Railway project with a managed PostgreSQL database + one container service running the InsForge backend (serves API + dashboard) + optional (advanced) PostgREST & Deno function runtime.

---
## 1. Architecture Overview
| Component | Purpose | Railway Mapping |
|-----------|---------|-----------------|
| PostgreSQL | Primary data store & auth tables | Railway PostgreSQL Plugin |
| InsForge Backend | REST/Realtime API, Auth, Storage handling, serves built dashboard | Deployed from repo (Dockerfile or Nixpacks) |
| PostgREST (optional) | Direct database-to-REST auto schema API | Separate service (Docker) – optional |
| Deno Runtime (optional) | Serverless/edge-style function runner | Separate service (Docker) – optional |

For a minimal production setup you only need: **PostgreSQL + Backend**.

---
## 2. Prerequisites
- Railway account (free tier works for evaluation)
- GitHub fork or clone of the InsForge repository
- A secure generated `JWT_SECRET` (32+ chars) & `ADMIN_PASSWORD`
- (Optional) AWS credentials if you want S3 storage instead of local filesystem

---
## 3. Fork & Prepare Repository
1. Fork the InsForge repo to your GitHub account.
2. (Optional) Edit `Dockerfile` or keep as is. It already builds backend + frontend and runs DB migrations on start.
3. Generate secrets:
   - JWT secret (32–64+ chars): `openssl rand -hex 32`
   - Admin password: choose strong value

---
## 4. Create Railway Project & Database
1. Log in to Railway.
2. Click **New Project** → **Provision PostgreSQL**.
3. After creation, open the database → copy the connection details (host, port, database, user, password). Railway also exposes a full `DATABASE_URL`.
4. (Optional) Set a **Production Branch** in project settings if you’ll auto‑deploy from `main`.

---
## 5. Add the InsForge Service
### Option A: Use the Existing Dockerfile (Recommended)
1. In your Railway project → **New** → **GitHub Repo** → select your fork.
2. Railway auto-detects the Dockerfile at repo root.
3. Set the service name to `insforge`.
4. Set the **Internal Port** to `7130` (matches backend `PORT`).
5. Deploy.

### Option B: Nixpacks / Buildpack (Alternative)
If you remove / adjust the Dockerfile, Railway can build using Nixpacks:
- Root command builds entire monorepo (`npm install && npm run build && cd backend && npm start`).
- Ensure `PORT` env var = 7130.

> The bundled Dockerfile is tuned; prefer Option A.

---
## 6. Environment Variables
Set these in the `insforge` service (Railway → Service → Variables). Railway supports bulk paste of KEY=VALUE lines.

### 6.1 Core (Required)
```
PORT=7130
# Public/External URL of your deployed InsForge (no trailing slash)
API_BASE_URL=https://<your-domain-or-railway-host>
VITE_API_BASE_URL=${API_BASE_URL}
# Use Railway provided DATABASE_URL or compose manually
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<db>
JWT_SECRET=your-32+char-secret
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this-password
```

If `DATABASE_URL` is set you do NOT need separate `POSTGRES_*` variables. If you prefer granular vars:
```
POSTGRES_HOST=<host>
POSTGRES_PORT=<port>
POSTGRES_DB=<db>
POSTGRES_USER=<user>
POSTGRES_PASSWORD=<password>
```

### 6.2 Optional / Recommended
```
ENCRYPTION_KEY= # 32+ chars; if blank falls back to JWT_SECRET
ACCESS_API_KEY=ik_<custom-or-leave-empty-for-auto>
OPENROUTER_API_KEY= # For LLM features (optional)
WORKER_TIMEOUT_MS=30000
```

### 6.3 OAuth (Optional)
```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

### 6.4 Object Storage & Logs (Optional: AWS S3 + CloudWatch)
```
AWS_S3_BUCKET=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_CLOUDFRONT_URL=
AWS_CLOUDFRONT_KEY_PAIR_ID=
AWS_CLOUDFRONT_PRIVATE_KEY=
```
Without these, storage defaults to local filesystem inside the container (ephemeral on Railway). Use S3 for persistence.

### 6.5 Multi‑Tenant Cloud (Advanced / Only if using InsForge Cloud tooling)
```
DEPLOYMENT_ID=
PROJECT_ID=
APP_KEY=
```

---
## 7. Run Database Migrations
The Dockerfile’s start command runs: `cd backend && npm run migrate:up && npm start` automatically.

If you disable that or need manual run (e.g., first failed):
1. Open the service **Shell** in Railway.
2. Execute:
```
cd backend
npm run migrate:up
```
3. Check the logs for: `All migrations have been run`.

---
## 8. Accessing the Dashboard & API
- After deploy, Railway assigns a domain like: `https://insforge-production.up.railway.app`.
- API base: `https://<host>/api`
- Dashboard: `https://<host>/` (served by same service once frontend is built)
- First visit triggers admin bootstrap using `ADMIN_EMAIL` + `ADMIN_PASSWORD`.

> If you later change admin credentials in env vars they do NOT retroactively update the user; modify directly in DB if required.

---
## 9. (Optional) Add PostgREST Service
Only needed if you want a direct schema-exposed REST endpoint separate from InsForge’s managed API.
1. New service → **Deploy Image** → `postgrest/postgrest:v12.2.12`.
2. Set variables (use your DB + secret):
```
PGRST_DB_URI=${DATABASE_URL}
PGRST_DB_SCHEMA=public
PGRST_DB_ANON_ROLE=anon
PGRST_JWT_SECRET=${JWT_SECRET}
PGRST_OPENAPI_SERVER_PROXY_URI=${API_BASE_URL}
PGRST_DB_CHANNEL_ENABLED=true
PGRST_DB_CHANNEL=pgrst
```
3. Internal port: 3000 (exposed automatically). Note the public URL for direct calls.
4. In the backend service, set `POSTGREST_BASE_URL` to the internal/private URL if using private network (Railway currently routes via public URL unless on same project internal networking is enabled).

---
## 10. (Optional) Add Deno Functions Runtime
1. New service → GitHub (optional separate repo) or **Deploy Image** `denoland/deno:alpine-2.0.6`.
2. Provide a minimal `start.sh` (or override command) similar to compose:
```
#!/bin/sh
set -e
echo "Caching dependencies..."
deno cache functions/server.ts
echo "Starting Deno server..."
deno run --allow-net --allow-env --allow-read=./functions/worker-template.js functions/server.ts
```
3. Environment variables (subset):
```
PORT=7133
DENO_ENV=production
DATABASE_URL=<same as backend>
POSTGREST_BASE_URL=<postgrest-url-if-enabled>
ENCRYPTION_KEY=${ENCRYPTION_KEY}
JWT_SECRET=${JWT_SECRET}
```
4. Set internal port 7133. Update backend service env var `DENO_RUNTIME_URL=https://<deno-service-host>`.

If you are not using custom functions, you can skip this entirely.

---
## 11. Custom Domain (Optional)
1. Railway Project → Settings → Domains → Add Custom Domain.
2. Point your DNS `CNAME` to the Railway provided target.
3. Update `API_BASE_URL` + `VITE_API_BASE_URL` to use the custom domain and redeploy.

---
## 12. Logs & Monitoring
- Railway Logs tab for each service.
- If AWS logging configured, Vector (optional) can be added similarly to `postgrest` via its Docker image (`timberio/vector:0.28.1-alpine`) and custom command; otherwise skip.
- Health: Basic check is visiting `/api/health` on your host.

---
## 13. Backups & Persistence
- Use Railway’s built-in PostgreSQL backups (enable in DB settings).
- For file storage, prefer S3 (local container filesystem is not persistent across redeploys).

---
## 14. Security Hardening
- Always change `ADMIN_PASSWORD` & `JWT_SECRET` before first production exposure.
- Restrict CORS if you create a separate frontend host (set `API_BASE_URL` precisely).
- Rotate secrets periodically.
- Use least‑privilege IAM for S3 + CloudWatch.

---
## 15. Troubleshooting
| Issue | Symptom | Fix |
|-------|---------|-----|
| 502 / CrashLoop | Service restarts | Check logs: likely migration failure or missing `DATABASE_URL`. Ensure DB variables correct. |
| Admin not created | Login fails | Ensure first startup had `ADMIN_EMAIL` & `ADMIN_PASSWORD`; else insert user manually via DB or truncate auth tables and restart. |
| JWT errors | 401 responses | Verify `JWT_SECRET` consistent across backend, PostgREST, Deno. Min length 32 chars. |
| Storage not persistent | Uploaded files vanish | Configure S3 variables. Local FS is ephemeral. |
| CORS problems | Browser blocked requests | Ensure `API_BASE_URL` matches the actual origin. Rebuild (redeploy) after change. |
| OpenAPI docs show localhost | Spec has http://localhost:7130 | Set `API_BASE_URL` before build. Redeploy so frontend rebuilds. |
| PostgREST 404s after schema change | Endpoints missing | Send a NOTIFY reload if using channel, or restart service. |

---
## 16. One‑Click Template (Future Enhancement)
You can create a Railway Template JSON referencing this repo + required env variable descriptions to enable one‑click deploys (similar to Supabase). PRs welcome.

---
## 17. Summary
You now have a running InsForge instance on Railway. Start integrating via the REST API at:
```
GET ${API_BASE_URL}/api/health
```
Explore documentation via the generated OpenAPI endpoint or dashboard.

---
**Happy building with InsForge!**
