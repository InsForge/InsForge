# InsForge Edge Function Examples

This folder contains **example serverless (edge) functions** you can deploy to InsForge.

## Supported Formats

InsForge Functions support two formats:

### 1. ESM (Deno-native) — Recommended

```typescript
import { z } from 'npm:zod';

export default async function(req: Request): Promise<Response> {
  const body = await req.json();
  return new Response(JSON.stringify({ hello: body.name }));
}
```

### 2. Legacy (CommonJS)

```javascript
module.exports = async function(req) {
  const body = await req.json();
  return new Response(JSON.stringify({ hello: body.name }));
}
```

Both formats work with cloud (Deno Subhosting) and on-prem (local Deno runtime) deployments.

**Imports:**
- Static `import` statements from `npm:`, `jsr:`, and approved `https:` hosts work in both environments.
- Dynamic `import()` calls are blocked at validation time for security.

## Files

- `demo-hello-world.js`: public function (GET/POST) with CORS + secret example (`HELLO_PREFIX`)
- `demo-whoami.js`: authenticated function (GET) that returns the current user
- `demo-esm-validation.ts`: ESM function with Zod validation (demonstrates external imports)

## Deploy

Use the InsForge MCP tools:

- `create-function` with `slug` matching the function name you want (e.g. `demo-hello-world`)
- `update-function` to redeploy after edits

## Invoke from a client app (SDK)

```js
// GET
await insforge.functions.invoke('demo-hello-world', { method: 'GET' })

// POST
await insforge.functions.invoke('demo-hello-world', {
  body: { name: 'Gary' }
})

// Authenticated GET (SDK auto-includes user token if logged in)
await insforge.functions.invoke('demo-whoami', { method: 'GET' })
```
