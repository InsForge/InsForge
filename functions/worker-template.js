/**
 * Worker Template for Serverless Functions
 *
 * This code runs inside a Web Worker environment created by Deno.
 * Each worker is created fresh for a single request, executes once, and terminates.
 */
/* eslint-env worker */
/* global self, Request, Deno */

// Import SDK at worker level - this will be available to all functions
import { createClient } from 'npm:@insforge/sdk@1.1.2-edge.1';
// Import base64 utilities for encoding/decoding
import { encodeBase64, decodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';

// Handle the single message with code, request data, and secrets
self.onmessage = async (e) => {
  const { code, requestData, secrets = {} } = e.data;

  try {
    /**
     * MOCK DENO OBJECT EXPLANATION:
     *
     * Why we need a mock Deno object:
     * - Edge functions run in isolated Web Workers (sandboxed environments)
     * - Web Workers don't have access to the real Deno global object for security
     * - We need to provide Deno.env functionality so functions can access secrets
     *
     * How it works:
     * 1. The main server (server.ts) fetches all active secrets from the system.secrets table
     * 2. Only active (is_active=true) and non-expired secrets are included
     * 3. Secrets are decrypted and passed to this worker via the 'secrets' object
     * 4. We create a mock Deno object that provides Deno.env.get()
     * 5. When user code calls Deno.env.get('MY_SECRET'), it reads from our secrets object
     *
     * This allows edge functions to use familiar Deno.env syntax while maintaining security
     * Secrets are managed via the /api/secrets endpoint
     */
    const mockDeno = {
      // Mock the Deno.env API - only get() is needed for reading secrets
      env: {
        get: (key) => secrets[key] || undefined,
      },
    };

    /**
     * FUNCTION WRAPPING EXPLANATION:
     *
     * Here we create a wrapper function that will execute the user's code.
     * The user's function expects to have access to:
     * - module.exports (to export their function)
     * - createClient (the Insforge SDK)
     * - Deno (for Deno.env.get() etc.)
     * - encodeBase64, decodeBase64 (base64 encoding utilities)
     *
     * We inject our mockDeno as the 'Deno' parameter, so when the user's code
     * calls Deno.env.get('MY_SECRET'), it's actually calling mockDeno.env.get('MY_SECRET')
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

    // Execute the wrapper, passing mockDeno as the Deno global and utility functions
    // This makes Deno.env.get(), encodeBase64(), and decodeBase64() available inside the user's function
    wrapper(exports, module, createClient, mockDeno, encodeBase64, decodeBase64);

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
    // Properly handle responses with no body
    let body = null;

    // Only read body if response has content
    // Status codes 204, 205, and 304 should not have a body
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
    // Check if the error is actually a Response object (thrown by the function)
    if (error instanceof Response) {
      // Handle error responses the same way
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
      // For actual errors, include status if available
      self.postMessage({
        success: false,
        error: error.message || 'Unknown error',
        status: error.status || 500,
      });
    }
  }
};
