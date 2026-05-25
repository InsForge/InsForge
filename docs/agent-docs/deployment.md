# InsForge Deployment - Agent Documentation

## Overview

Deploy frontend applications to InsForge with the `create-deployment` MCP tool. The tool uploads the source directory through InsForge's direct deployment flow, starts a Vercel-backed production build, and records the result in `deployments.runs`.

Use the source directory, not a pre-built artifact directory. The backend validates the manifest, streams each file to the provider, verifies file size and SHA-1 digest, then starts the deployment after all files are uploaded.

The REST API still supports the legacy source-zip flow for older clients. Do not use it from agents unless the direct MCP tool is unavailable.

## Deploy With MCP

Call `create-deployment` with:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `sourceDirectory` | Yes | Absolute path to the app source directory, for example `/Users/me/project/frontend`. |
| `projectSettings.buildCommand` | No | Build command, for example `npm run build`. Omit to use provider defaults. |
| `projectSettings.outputDirectory` | No | Static output directory, for example `dist` or `build`. |
| `projectSettings.installCommand` | No | Install command, for example `npm install` or `pnpm install`. |
| `projectSettings.devCommand` | No | Development command metadata for framework-aware builds. |
| `projectSettings.rootDirectory` | No | Root directory inside the uploaded source tree. |
| `envVars` | No | Array of `{ "key": "...", "value": "..." }` variables to create or update before build. |
| `meta` | No | String key-value metadata for provider deployment creation. |

Example:

```json
{
  "sourceDirectory": "/Users/me/project/frontend",
  "projectSettings": {
    "buildCommand": "npm run build",
    "outputDirectory": "dist"
  },
  "envVars": [
    {
      "key": "VITE_INSFORGE_BASE_URL",
      "value": "https://your-project.region.insforge.app"
    },
    {
      "key": "VITE_INSFORGE_ANON_KEY",
      "value": "your-anon-key"
    }
  ],
  "meta": {
    "source": "agent"
  }
}
```

Important:

- `sourceDirectory` must be an absolute path.
- Upload app source files, not only `dist`, unless the project is intentionally a plain static site.
- Include framework files needed by Vercel, such as `package.json`, lock file, framework config, and `vercel.json` when needed.
- Prefix browser-exposed variables correctly, for example `VITE_` for Vite and `NEXT_PUBLIC_` for Next.js.
- Do not put service-role keys, admin tokens, or private provider keys in browser-exposed variables.
- Tailwind projects should stay on Tailwind CSS 3.4 unless the app already supports v4.

## What The Tool Does

The current deployment path maps to these backend steps:

1. Register a direct upload manifest in `POST /api/deployments/direct`.
2. Upload each file with `PUT /api/deployments/:id/files/:fileId/content`.
3. Start the provider build with `POST /api/deployments/:id/start`.
4. Poll or sync status until the run reaches `READY`, `ERROR`, or `CANCELED`.

The direct file upload endpoint requires `Content-Type: application/octet-stream`. The backend rejects missing files, size mismatches, SHA mismatches, invalid relative paths, and attempts to start before every file has `uploaded_at`.

## Check Deployment Status

Use the Dashboard, MCP SQL tools, or the REST API. For SQL:

```sql
SELECT id, provider_deployment_id, status, url, metadata, created_at, updated_at
FROM deployments.runs
ORDER BY created_at DESC
LIMIT 5;
```

To inspect an interrupted direct upload:

```sql
SELECT file_path, size_bytes, uploaded_at
FROM deployments.files
WHERE deployment_id = '<deployment-id>'
ORDER BY file_path;
```

If a deployment has a provider ID but the status looks stale, sync it through the API:

```http
POST /api/deployments/<deployment-id>/sync
```

## Status Values

| Status | Description |
|--------|-------------|
| `WAITING` | Run exists and is waiting for source uploads. |
| `UPLOADING` | Source files are uploading or provider deployment creation is in progress. |
| `QUEUED` | Provider accepted the deployment and queued the build. |
| `BUILDING` | Provider is building the app. |
| `READY` | Deployment completed. The `url` column contains the live URL. |
| `ERROR` | Upload, build, provider, or webhook processing failed. |
| `CANCELED` | Deployment was canceled. |

## Get The Live URL

After status is `READY`, read the URL:

```sql
SELECT url
FROM deployments.runs
WHERE id = '<deployment-id>';
```

The Dashboard may show a friendlier domain when a custom `.insforge.site` slug or user-owned domain is configured.

## Environment Variables

You can pass `envVars` during deployment or manage them from the Dashboard. Deployment env vars are Vercel encrypted environment variables, not database rows.

Rules:

- Lists show keys and metadata only. Values are hidden unless a single variable is fetched for editing.
- Duplicate keys in one create-or-update request are rejected.
- Values are applied to `production`, `preview`, and `development` targets.
- Use public prefixes only for values that browser code may read.

## SPA Routing

For React, Vue, Svelte, or other single-page apps that need client-side routing, add `vercel.json` at the app root:

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

Do not add this rewrite to frameworks that already own routing, such as Next.js.

## Common Failures

| Symptom | Check |
|---------|-------|
| Deployment service is not configured | Self-hosted backend needs `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID`. |
| Upload fails with content type error | Direct file upload must use `application/octet-stream`. |
| Upload fails with size or SHA mismatch | Recompute the manifest from the exact bytes being uploaded. |
| Start fails before provider build | Query `deployments.files` and confirm every row has `uploaded_at`. |
| Build cannot find scripts | Confirm `package.json`, lock file, root directory, and build command. |
| SPA route returns 404 | Add the `vercel.json` rewrite for static SPA apps. |
| Provider rate limit | Retry the failed upload/start step with a fresh request. |

## Quick Reference

| Task | Preferred tool |
|------|----------------|
| Deploy app | `create-deployment` MCP tool |
| Check latest runs | Dashboard or `SELECT * FROM deployments.runs ORDER BY created_at DESC` |
| Inspect direct file upload state | `SELECT * FROM deployments.files WHERE deployment_id = '...'` |
| Manage env vars | Dashboard Deployments -> Environment Variables |
| Manage domains | Dashboard Deployments -> Domains |
