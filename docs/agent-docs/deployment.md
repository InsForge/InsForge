# InsForge Deployment - Agent Documentation

## Overview

Deploy frontend applications to InsForge using the `create-deployment` MCP tool. The tool handles uploading source files, building, and deploying automatically.

## Deploy with MCP Tool

Use the `create-deployment` tool with these parameters:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `sourceDirectory` | Yes | **Absolute path** to source directory (e.g., `/Users/me/project/frontend`). Relative paths do not work. |
| `projectSettings.buildCommand` | No | Build command (default: auto-detected) |
| `projectSettings.outputDirectory` | No | Build output directory (default: auto-detected) |
| `projectSettings.installCommand` | No | Install command (default: `npm install`) |
| `projectSettings.rootDirectory` | No | Root directory within source |
| `envVars` | No | Array of `{key, value}` objects |
| `meta` | No | Custom metadata key-value pairs |

### Example

```json
{
  "sourceDirectory": "/Users/me/project/frontend",
  "projectSettings": {
    "buildCommand": "npm run build",
    "outputDirectory": "dist"
  },
  "envVars": [
    { "key": "VITE_INSFORGE_BASE_URL", "value": "https://your-project.insforge.app" },
    { "key": "VITE_INSFORGE_ANON_KEY", "value": "your-anon-key" }
  ]
}
```

**Important**:
- `sourceDirectory` must be an **absolute path** (relative paths don't work on Windows)
- Pass the source directory, NOT pre-built static files
- Include all required environment variables (e.g., `VITE_*` for Vite apps)

## Check Deployment Status

After creating a deployment, query the status using `run-raw-sql`:

```sql
SELECT id, status, url, created_at
FROM system.deployments
ORDER BY created_at DESC
LIMIT 1;
```

### Status Values

| Status | Description |
|--------|-------------|
| `WAITING` | Waiting for source upload |
| `UPLOADING` | Uploading to build server |
| `QUEUED` | Queued for build |
| `BUILDING` | Building (typically ~1 min) |
| `READY` | Deployment complete, URL available |
| `ERROR` | Build or deployment failed |
| `CANCELED` | Deployment was cancelled |

### Get Deployment URL

Once status is `READY`, the `url` column contains the live deployment URL.

```sql
SELECT url FROM system.deployments WHERE id = '<deployment-id>';
```

## Deploy with Agent Script (Self-Hosted / Local)

In self-hosted or local environments without AWS S3 configured, you can trigger a direct deployment using the built-in deployment script. This bundles your source folder and sends a buffered upload directly to the InsForge backend API.

### Usage

Run the script using Node.js:

```bash
node backend/scripts/deploy-direct-agent.cjs <source_directory_path> [envVars_array_json]
```

**Example:**
```bash
node backend/scripts/deploy-direct-agent.cjs ./frontend
```

With custom environment variables:
```bash
node backend/scripts/deploy-direct-agent.cjs ./frontend '[{"key":"VITE_API","value":"http://api.local"}]'
```

> [!WARNING]
> **Do not pass sensitive secrets (like API keys or passwords) directly on the command line.** 
> Arguments passed via shell are visible in shell history files (e.g., `.bash_history`) and system process lists (e.g., `ps aux`). 
> For sensitive variables, consider fetching them inside your application code from a secure configuration service/backend or passing them via a configuration file lookup during builds instead.

---

## SPA Routing (React, Vue, etc.)

Add `vercel.json` to your project root:

```json
{
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

## Quick Reference

| Task | Tool | Command |
|------|------|---------|
| Deploy app (Cloud) | `create-deployment` | Provide `sourceDirectory` and `envVars` |
| Deploy app (Self-Hosted) | Script | `node backend/scripts/deploy-direct-agent.cjs <source_dir>` |
| Check status | `run-raw-sql` | `SELECT status FROM system.deployments WHERE id = '...'` |
| List deployments | `run-raw-sql` | `SELECT * FROM system.deployments ORDER BY created_at DESC` |
