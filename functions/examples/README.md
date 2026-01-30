# InsForge Edge Function Examples

This folder contains **example serverless (edge) functions** you can deploy to InsForge.

## Files

- `demo-hello-world.js`: public function (GET/POST) with CORS + secret example (`HELLO_PREFIX`)
- `demo-whoami.js`: authenticated function (GET) that returns the current user

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

