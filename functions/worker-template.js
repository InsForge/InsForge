/**
 * Worker Template for Serverless Functions
 *
 * This code runs inside a Web Worker environment created by Deno.
 * Each worker is created fresh for a single request, executes once, and terminates.
 */
/* eslint-env worker */
/* global self, Request, Deno */

// --- SECURITY SHADOWING ---
// We shadow the global Deno and provide a mock process.env at the very entry point.
// This prevents libraries from crashing when checking for env vars in a restricted sandbox.
const mockProcessEnv = {
  NODE_ENV: 'production',
  DEBUG: undefined,
};

if (typeof globalThis.process === 'undefined') {
  globalThis.process = { env: mockProcessEnv };
} else {
  globalThis.process.env = { ...globalThis.process.env, ...mockProcessEnv };
}
// ----------------------------

// Import SDK at worker level - this will be available to all functions
import { createClient } from 'npm:@insforge/sdk';
// Import base64 utilities for encoding/decoding
import { encodeBase64, decodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';

// Handle the single message with code, request data, and secrets
self.onmessage = async (e) => {
  const { code, requestData, secrets = {} } = e.data;

  try {
    /**
     * MOCK DENO OBJECT:
     * providing safe secrets access even under strict native lock-down.
     */
    const mockDeno = {
      ...globalThis.Deno,
      // Mock the Deno.env API - only get() is needed for reading secrets
      env: {
        get: (key) => secrets[key] || undefined,
        toObject: () => ({ ...secrets }),
      },
      // Ensure dangerous methods are explicitly blocked in the shadow
      run: () => { throw new Error('Deno.run is natively disabled'); },
      spawn: () => { throw new Error('Deno.spawn is natively disabled'); },
    };

    /**
     * FUNCTION WRAPPING:
     * Injecting mocks into the user function execution scope.
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
    wrapper(
      exports,
      module,
      createClient,
      mockDeno,
      encodeBase64,
      decodeBase64
    );

    // Get the exported function
    const functionHandler = module.exports || exports.default || exports;

    if (typeof functionHandler !== 'function') {
      throw new Error(
        'No function exported. Expected: module.exports = async function(req) { ... }'
      );
    }

    // Create Request object from data
    const request = new Request(requestData.url, {
      method: requestData.method,
      headers: requestData.headers,
      body: requestData.body,
    });

    // Execute the function
    const response = await functionHandler(request);

    // Serialize and send response
    let body = null;
    if (![204, 205, 304].includes(response.status)) {
      body = await response.text();
    }

    const responseData = {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers),
      body: body,
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
