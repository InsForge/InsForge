import { Client } from 'https://deno.land/x/postgres@v0.17.0/mod.ts';
import { join, dirname, fromFileUrl } from 'https://deno.land/std@0.224.0/path/mod.ts';

/* eslint-disable no-console */
const port = parseInt(Deno.env.get('PORT') ?? '7133');

console.log(`Deno serverless runtime running on port ${port}`);

// Configuration
const WORKER_TIMEOUT_MS = parseInt(Deno.env.get('WORKER_TIMEOUT_MS') ?? '30000');

// Worker template code - loaded on first use
let workerTemplateCode: string | null = null;

async function getWorkerTemplateCode(): Promise<string> {
  if (!workerTemplateCode) {
    const currentDir = dirname(fromFileUrl(import.meta.url));
    workerTemplateCode = await Deno.readTextFile(join(currentDir, 'worker-template.js'));
  }
  return workerTemplateCode;
}

// Decrypt function for Deno (compatible with Node.js encryption)
async function decryptSecret(ciphertext: string, key: string): Promise<string> {
  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext format');
    }

    // Get the encryption key by hashing the JWT secret
    const keyData = new TextEncoder().encode(key);
    const hashBuffer = await crypto.subtle.digest('SHA-256', keyData);
    const cryptoKey = await crypto.subtle.importKey('raw', hashBuffer, { name: 'AES-GCM' }, false, [
      'decrypt',
    ]);

    // Extract IV, auth tag, and encrypted data
    const iv = Uint8Array.from(parts[0].match(/.{2}/g)!.map((byte) => parseInt(byte, 16)));
    const authTag = Uint8Array.from(parts[1].match(/.{2}/g)!.map((byte) => parseInt(byte, 16)));
    const encrypted = Uint8Array.from(parts[2].match(/.{2}/g)!.map((byte) => parseInt(byte, 16)));

    // Combine encrypted data and auth tag (GCM expects them together)
    const cipherData = new Uint8Array(encrypted.length + authTag.length);
    cipherData.set(encrypted);
    cipherData.set(authTag, encrypted.length);

    // Decrypt
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      cipherData
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch (error) {
    console.error('Failed to decrypt secret:', error);
    throw error;
  }
}

// Database connection
const dbConfig = {
  user: Deno.env.get('POSTGRES_USER') || 'postgres',
  password: Deno.env.get('POSTGRES_PASSWORD') || 'postgres',
  database: Deno.env.get('POSTGRES_DB') || 'insforge',
  hostname: Deno.env.get('POSTGRES_HOST') || 'postgres',
  port: parseInt(Deno.env.get('POSTGRES_PORT') || '5432', 10),
};

// Get function code from database
async function getFunctionCode(slug: string): Promise<string | null> {
  const client = new Client(dbConfig);

  try {
    await client.connect();

    const result = await client.queryObject<{ code: string }>`
      SELECT code FROM _functions 
      WHERE slug = ${slug} AND status = 'active'
    `;

    if (!result.rows.length) {
      return null;
    }

    return result.rows[0].code;
  } catch (error) {
    console.error(`Error fetching function ${slug}:`, error);
    return null;
  } finally {
    await client.end();
  }
}

// Get all secrets from main secrets table and decrypt them
async function getFunctionSecrets(): Promise<Record<string, string>> {
  const client = new Client(dbConfig);

  try {
    await client.connect();

    // Get the encryption key from environment
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY') || Deno.env.get('JWT_SECRET');
    if (!encryptionKey) {
      console.error('No encryption key available for decrypting secrets');
      return {};
    }

    // Fetch all active secrets from _secrets table
    const result = await client.queryObject<{
      key: string;
      value_ciphertext: string;
    }>`
      SELECT key, value_ciphertext 
      FROM _secrets
      WHERE is_active = true 
        AND (expires_at IS NULL OR expires_at > NOW())
    `;

    const secrets: Record<string, string> = {};

    // Decrypt each secret
    for (const row of result.rows) {
      try {
        secrets[row.key] = await decryptSecret(row.value_ciphertext, encryptionKey);
      } catch (error) {
        console.error(`Failed to decrypt secret ${row.key}:`, error);
        // Skip this secret if decryption fails
      }
    }

    return secrets;
  } catch (error) {
    console.error('Error fetching secrets:', error);
    return {};
  } finally {
    await client.end();
  }
}

// Execute function in isolated worker
async function executeInWorker(code: string, request: Request): Promise<Response> {
  // Get worker template
  const template = await getWorkerTemplateCode();

  // Fetch all function secrets
  const secrets = await getFunctionSecrets();

  // Create blob for worker
  const workerBlob = new Blob([template], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(workerBlob);

  return new Promise(async (resolve) => {
    const worker = new Worker(workerUrl, { type: 'module' });

    // Set timeout for worker execution
    const timeout = setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      resolve(
        new Response(JSON.stringify({ error: 'Function timeout' }), {
          status: 504,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }, WORKER_TIMEOUT_MS);

    // Handle worker response
    worker.onmessage = (e) => {
      clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(workerUrl);

      if (e.data.success) {
        const { response } = e.data;
        // The worker now properly sends null for bodyless responses
        resolve(
          new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          })
        );
      } else {
        resolve(
          new Response(JSON.stringify({ error: e.data.error }), {
            status: e.data.status || 500,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
    };

    // Handle worker errors
    worker.onerror = (error) => {
      clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      console.error('Worker error:', error);
      resolve(
        new Response(JSON.stringify({ error: 'Worker execution error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    };

    // Prepare request data
    const body = request.body ? await request.text() : null;
    const requestData = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body,
    };

    // Send message with code, request data, and secrets
    worker.postMessage({ code, requestData, secrets });
  });
}

Deno.serve({ port }, async (req: Request) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Health check
  if (pathname === '/health') {
    return new Response(
      JSON.stringify({
        status: 'ok',
        runtime: 'deno',
        version: Deno.version.deno,
        typescript: Deno.version.typescript,
        v8: Deno.version.v8,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Function execution - match ONLY exact slug, no subpaths
  const slugMatch = pathname.match(/^\/([a-zA-Z0-9_-]+)$/);
  if (slugMatch) {
    const slug = slugMatch[1];
    const startTime = Date.now();

    // Get function code from database
    const code = await getFunctionCode(slug);

    if (!code) {
      return new Response(JSON.stringify({ error: 'Function not found or not active' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Execute in worker with original request
    try {
      const response = await executeInWorker(code, req);
      const duration = Date.now() - startTime;

      // Log completed invocations only
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'info',
          slug,
          method: req.method,
          status: response.status,
          duration: `${duration}ms`,
        })
      );

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'error',
          slug,
          error: error instanceof Error ? error.message : String(error),
          duration: `${duration}ms`,
        })
      );
      return new Response(JSON.stringify({ error: 'Function execution failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Runtime info
  if (pathname === '/info') {
    return new Response(
      JSON.stringify({
        runtime: 'deno',
        version: Deno.version,
        env: Deno.env.get('DENO_ENV') || 'production',
        database: {
          host: dbConfig.hostname,
          database: dbConfig.database,
        },
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // 404
  return new Response('Not Found', { status: 404 });
});
