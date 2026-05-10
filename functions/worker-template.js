/**
 * Worker Template for Serverless Functions
 *
 * This code runs inside a Web Worker environment created by Deno.
 * Each worker is created fresh for a single request, executes once, and terminates.
 *
 * Supports two function formats:
 * 1. Legacy (CommonJS): module.exports = async function(req) { ... }
 * 2. ESM (export default): export default async function(req) { ... }
 *
 * User code is loaded via dynamic import() with a base64 data URL, which means
 * static `import` statements in user code work. Tier-1 backend validation blocks
 * dynamic import() calls and other dangerous patterns; Tier-2 native Deno
 * permissions (read/write/run/ffi/sys = false) provide the real boundary.
 */
/* eslint-env worker */
/* global self, Request, Deno */

// --- SECURITY BLACKOUT (Top-level) ---
// Polyfill Deno.env and process.env BEFORE any imports using Top-Level Await.
// Libraries (like 'debug') call Object.keys(process.env) at import time, so the
// shadow has to be in place before the SDK loads.
const sterileEnv = {
  NODE_ENV: 'production',
};

// Mutable secrets container the env mock closes over.
// Populated per-request from postMessage data; never enumerable.
const userSecrets = {};

try {
  const mockDenoEnv = {
    get: (key) =>
      Object.prototype.hasOwnProperty.call(userSecrets, key) ? userSecrets[key] : sterileEnv[key],
    has: (key) =>
      Object.prototype.hasOwnProperty.call(userSecrets, key) ||
      Object.prototype.hasOwnProperty.call(sterileEnv, key),
    set: () => {
      throw new Error('Deno.env.set is disabled');
    },
    delete: () => {
      throw new Error('Deno.env.delete is disabled');
    },
    // toObject intentionally omitted to prevent secret enumeration
  };

  // Block subprocess and dangerous APIs as secondary defense
  const lockedDeno = Object.freeze({
    env: mockDenoEnv,
    run: () => {
      throw new Error('Deno.run is disabled');
    },
    spawn: () => {
      throw new Error('Deno.spawn is disabled');
    },
    Command: function () {
      throw new Error('Deno.Command is disabled');
    },
  });

  Object.defineProperty(globalThis, 'Deno', {
    value: lockedDeno,
    configurable: false,
    writable: false,
  });

  // Shadow process.env (Node compatibility) — read-through to userSecrets/sterileEnv
  if (!globalThis.process) globalThis.process = {};
  globalThis.process.env = new Proxy(
    {},
    {
      get: (_target, key) =>
        Object.prototype.hasOwnProperty.call(userSecrets, key) ? userSecrets[key] : sterileEnv[key],
      has: (_target, key) =>
        Object.prototype.hasOwnProperty.call(userSecrets, key) ||
        Object.prototype.hasOwnProperty.call(sterileEnv, key),
      ownKeys: () => Object.keys(sterileEnv), // Hide secrets from enumeration
      getOwnPropertyDescriptor: (_target, key) => {
        if (Object.prototype.hasOwnProperty.call(sterileEnv, key)) {
          return { enumerable: true, configurable: true, value: sterileEnv[key] };
        }
        return undefined;
      },
    }
  );
} catch (e) {
  console.error('Security shadow application failed:', e);
  self.postMessage({
    success: false,
    error: 'Security Initialization Error',
    status: 500,
  });
  self.close();
  throw new Error('Security initialization failed - halting worker');
}
// ----------------------------

// ----------------------------
// LATE IMPORTS (Pre-emptive Mocking)
// ----------------------------
// Worker loads SDK helpers via real imports (allowed by import: true permission).
// User code can also import npm/jsr/https packages directly via static imports.
const { createClient } = await import('npm:@insforge/sdk');
const { encodeBase64, decodeBase64 } =
  await import('https://deno.land/std@0.224.0/encoding/base64.ts');

// Inject SDK helpers as globals for user code (backward compat with existing demos)
globalThis.createClient = createClient;
globalThis.encodeBase64 = encodeBase64;
globalThis.decodeBase64 = decodeBase64;

/**
 * Convert legacy CommonJS to ESM so dynamic import() can load it.
 * Only applied when the code does not already use export default.
 *
 * Anchored to start-of-line (with optional leading whitespace) so that
 * mentions of `module.exports` inside JSDoc comments (` * ...`) or string
 * literals do not get rewritten — only the real assignment statement does.
 *
 * Handles:
 *   module.exports = async function(req) {...}
 *   module.exports = function(req) {...}
 *   module.exports = (req) => {...}
 */
function legacyToESM(code) {
  return code.replace(/^[ \t]*module\.exports\s*=\s*/m, 'export default ');
}

// Signal to the host that the worker is fully initialised. The host waits
// for this handshake before posting the user code message — without it, on
// cold imports the postMessage would race against the onmessage handler.
self.postMessage({ ready: true });

// Handle the single message with code, request data, and secrets
self.onmessage = async (e) => {
  const { code, requestData, secrets = {} } = e.data;

  try {
    // Inject secrets into the env mock closure
    Object.assign(userSecrets, secrets);

    // Legacy detection: anchor on `module.exports = ` at start of line. This
    // skips JSDoc-comment mentions (` * module.exports = ...`) and string
    // literals, which would otherwise cause false positives in either direction.
    const isLegacy = /^[ \t]*module\.exports\s*=/m.test(code);
    const finalCode = isLegacy ? legacyToESM(code) : code;

    // Encode as base64 data URL so dynamic import() can load it as a module.
    // application/typescript MIME tells Deno to strip TypeScript types.
    const codeBytes = new TextEncoder().encode(finalCode);
    const encoded = encodeBase64(codeBytes);
    const dataUrl = `data:application/typescript;base64,${encoded}`;

    // Dynamic import — user's static `import` statements work as expected.
    // Backend Tier-1 validation blocks user-side dynamic import() calls; this
    // worker-side import() is part of the trusted runtime.
    const userModule = await import(dataUrl);
    const handler = userModule.default;

    if (typeof handler !== 'function') {
      throw new Error(
        'No function exported. Use: export default async function(req) { ... } or module.exports = async function(req) { ... }'
      );
    }

    // Create Request object from serialized data
    const request = new Request(requestData.url, {
      method: requestData.method,
      headers: requestData.headers,
      body: requestData.body,
    });

    // Execute the user's handler
    const response = await handler(request);

    // Serialize response for postMessage
    let body = null;
    if (![204, 205, 304].includes(response.status)) {
      body = await response.text();
    }

    self.postMessage({
      success: true,
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers),
        body,
      },
    });
  } catch (error) {
    // Handle Response objects thrown as errors (early returns)
    if (error instanceof Response) {
      let body = null;
      if (![204, 205, 304].includes(error.status)) {
        body = await error.text();
      }
      self.postMessage({
        success: true,
        response: {
          status: error.status,
          statusText: error.statusText,
          headers: Object.fromEntries(error.headers),
          body,
        },
      });
    } else {
      self.postMessage({
        success: false,
        error: error.message || 'Unknown error',
        status: error.status || 500,
      });
    }
  }
};
