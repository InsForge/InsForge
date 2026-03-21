---
description: Deploy application in self-hosted or local InsForge environments
---

This workflow bundles a source directory and pushes it directly to the local/self-hosted InsForge backend API (bypassing S3 dependencies).

## Prerequisites

1.  Configure Vercel Credentials (at minimum `Vercel Token`) in the Dashboard UI.
2.  Ensure Backend is running (`npm run dev` or docker).

## Steps

// turbo
1.  Run the direct deployment script from the workspace root:

    ```bash
    node backend/scripts/deploy-direct-agent.cjs <source_folder_path>
    ```

    *Example:* `node backend/scripts/deploy-direct-agent.cjs ./frontend`

2.  The script will bundle the folder, generate absolute headers with backend secrets mapping, and execute buffered uploads with standard completion returns printable on console loops.
