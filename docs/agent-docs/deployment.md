# InsForge Deployment - Agent Documentation

## Overview

Deploy frontend applications to InsForge using the `create-deployment` MCP tool. The tool handles uploading source files, building, and deploying automatically.

## Deploy with MCP Tool

Use the `create-deployment` tool with these parameters:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `sourceDirectory` | Yes | Path to source directory (e.g., `./frontend`) |
| `projectSettings.buildCommand` | No | Build command (default: auto-detected) |
| `projectSettings.outputDirectory` | No | Build output directory (default: auto-detected) |
| `projectSettings.installCommand` | No | Install command (default: `npm install`) |
| `projectSettings.rootDirectory` | No | Root directory within source |
| `envVars` | No | Array of `{key, value}` objects |
| `meta` | No | Custom metadata key-value pairs |

### Example

```json
{
  "sourceDirectory": "./frontend",
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

## Quick Reference

| Task | Tool | Command |
|------|------|---------|
| Deploy app | `create-deployment` | Provide `sourceDir` and `envVars` |
| Check status | `run-raw-sql` | `SELECT status FROM system.deployments WHERE id = '...'` |
| List deployments | `run-raw-sql` | `SELECT * FROM system.deployments ORDER BY created_at DESC` |
