/**
 * Worker Template for Serverless Functions
 *
 * This code runs inside a Web Worker environment created by Deno.
 * Each worker is created fresh for a single request, executes once, and terminates.
 */
/* eslint-env worker */
/* global self, Request, Deno */

// --- SECURITY BLACKOUT (Top-level) ---
// We polyfill Deno.env and process.env BEFORE any imports using Top-Level Await.
// This prevents libraries (like 'debug') from triggering 'NotCapable' errors
// when using a strict native whitelist (env: false).
const sterileEnv = {
  NODE_ENV: 'production',
};

try {
  // Shadow Deno.env with a pure JS implementation
  const mockDenoEnv = {
    get: (key) => sterileEnv[key] ?? undefined,
    set: () => {
      throw new Error('Deno.env.set is disabled');
    },
    delete: () => {
      throw new Error('Deno.env.delete is disabled');
    },
    toObject: () => ({ ...sterileEnv }),
    has: (key) => key in sterileEnv,
  };

  // Replace global Deno.env
  Object.defineProperty(globalThis, 'Deno', {
    value: Object.freeze({ env: mockDenoEnv }),
    configurable: false, // Lock down permanently (Audit Finding)
    writable: false,
  });

  // Shadow process.env (Node compatibility)
  if (!globalThis.process) globalThis.process = {};
  globalThis.process.env = { ...sterileEnv };
} catch (e) {
  // FATAL: Security setup failed. Terminate immediately to prevent leakage.
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
// EARLY MESSAGE BUFFERING (Race Fix)
// ----------------------------
// The runtime (server.ts -> executeInWorker) calls worker.postMessage()
// immediately after `new Worker()`. Web Workers do NOT queue messages that
// arrive before an `onmessage` handler is registered, so if we only attached
// the handler AFTER the top-level `await import(...)` below (cold import can
// take >200ms), the request message was silently dropped -> 504 timeout.
//
// Fix: register a synchronous handler BEFORE any top-level await. It buffers
// any early message(s). Once imports finish, we swap `self.onmessage` to the
// real handler and drain the buffer through it. Single-threaded execution
// guarantees no message can slip between the swap and the drain.
const __earlyMessages = [];
self.onmessage = (e) => {
  __earlyMessages.push(e);
};

// ----------------------------
// LATE IMPORTS (Pre-emptive Mocking)
// ----------------------------
// We use dynamic imports AFTER the environment is shadowed.
//
// If an import fails (e.g. npm registry unreachable under restricted egress),
// the worker can never produce a real handler. Answer the request with an
// explicit 500 (same {success,error,status} shape server.ts onmessage expects)
// instead of hanging to the runtime's 60s timeout.
//
// The request message may NOT have been delivered yet when the import rejects:
// literal dynamic imports are prefetched with the module graph, so a failed
// import rejects before the first event-loop turn. Closing the worker at that
// point would drop the undelivered request and reproduce the silent 504, so we
// only close() after a message has been answered (with a deadline as backstop).
let createClient, encodeBase64, decodeBase64;
let __importFailed = false;
try {
  ({ createClient } = await import('npm:@insforge/sdk'));
  ({ encodeBase64, decodeBase64 } =
    await import('https://deno.land/std@0.224.0/encoding/base64.ts'));
} catch (importError) {
  __importFailed = true;
  const failMsg = 'SDK import failed: ' + (importError?.message || importError);
  console.error(failMsg);
  const answerAndClose = () => {
    self.postMessage({ success: false, error: failMsg, status: 500 });
    self.close();
  };
  if (__earlyMessages.splice(0).length > 0) {
    answerAndClose();
  } else {
    self.onmessage = answerAndClose;
    setTimeout(() => self.close(), 10000);
  }
}

// the host must wait for this before sending the actual work payload.
self.postMessage({ ready: true });

// Handle the single message with code, request data, and secrets
const handleMessage = async (e) => {
  const { code, requestData, secrets = {} } = e.data;

  try {
    /**
     * MOCK DENO OBJECT:
     * Providing safe secrets access even under strict native lock-down (env: false).
     * This fake 'Deno' object is injected into the user function's scope, ensuring
     * they only see the secrets we explicitly allow, while the native Deno runtime
     * remains blindfolded at the C++ layer.
     */
    const mockDeno = {
      // Mock only the required Deno.env API for secret retrieval
      env: {
        get: (key) => secrets[key] ?? undefined,
        // (toObject removed for security to prevent secret enumeration)
      },
      // Explicitly block all subprocess APIs as a secondary defense tier
      run: () => {
        throw new Error('Deno.run is natively disabled');
      },
      spawn: () => {
        throw new Error('Deno.spawn is natively disabled');
      },
      Command: function () {
        throw new Error('Deno.Command is natively disabled');
      },
    };

    /**
     * FUNCTION WRAPPING:
     * Injecting mocks into the user function execution scope.
     * We pass mockDeno instead of the real Deno global.
     */
    const wrapper = new Function(
      'exports',
      'module',
      'createClient',
      'Deno',
      'encodeBase64',
      'decodeBase64',
      code
    );
    const exports = {};
    const module = { exports };

    // Execute the wrapper, passing mockDeno as the Deno global
    wrapper(exports, module, createClient, mockDeno, encodeBase64, decodeBase64);

    // Get the exported function
    const functionHandler = module.exports || exports.default || exports;

    if (typeof functionHandler !== 'function') {
      throw new Error(
        'No function exported. Expected: module.exports = async function(req) { ... }'
      );
    }

    // Create Request object from data
    // Preserve raw bytes (ArrayBuffer) for multipart/binary payloads.
    const request = new Request(requestData.url, {
      method: requestData.method,
      headers: requestData.headers,
      body: requestData.body,
    });

    // Execute the function
    const response = await functionHandler(request);

    // Serialize and send response
    // Preserve binary responses by using ArrayBuffer when possible.
    // We still use text() for JSON/text responses for backward compatibility.
    let body = null;
    const status = response.status;
    if (![204, 205, 304].includes(status)) {
      const contentType = response.headers.get('content-type') ?? '';
      const isLikelyText =
        contentType.includes('application/json') ||
        contentType.startsWith('text/') ||
        contentType.includes('application/xml') ||
        contentType.includes('application/x-www-form-urlencoded');

      if (isLikelyText) {
        body = await response.text();
      } else {
        body = await response.arrayBuffer();
      }
    }

    const responseData = {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers),
      body,
    };

    self.postMessage({ success: true, response: responseData });
  } catch (error) {
    if (error instanceof Response) {
      let body = null;
      if (![204, 205, 304].includes(error.status)) {
        body = await error.text();
      }
      const responseData = {
        status: error.status,
        statusText: error.statusText,
        headers: Object.fromEntries(error.headers),
        body: body,
      };
      self.postMessage({ success: true, response: responseData });
    } else {
      self.postMessage({
        success: false,
        error: error.message || 'Unknown error',
        status: error.status || 500,
      });
    }
  }
};

// Activate the real handler and drain any messages that arrived during import.
if (!__importFailed) {
  self.onmessage = handleMessage;
  for (const e of __earlyMessages.splice(0)) {
    await handleMessage(e);
  }
}
