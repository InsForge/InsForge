import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { join, dirname, fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";

/* eslint-disable no-console */
const port = parseInt(Deno.env.get("PORT") ?? "7133");

console.log(`Deno serverless runtime running on port ${port}`);

// Configuration
const WORKER_TIMEOUT_MS = parseInt(Deno.env.get("WORKER_TIMEOUT_MS") ?? "30000");
const VAULT_ENCRYPTION_KEY = Deno.env.get("VAULT_ENCRYPTION_KEY") || "";

// Decrypt a value that was encrypted with AES-256-CBC
function decrypt(encryptedText: string): string {
  if (!VAULT_ENCRYPTION_KEY) {
    console.warn("VAULT_ENCRYPTION_KEY not set, returning encrypted value");
    return encryptedText;
  }
  
  try {
    // The encrypted format is "iv:encrypted" where both are hex strings
    const parts = encryptedText.split(':');
    if (parts.length !== 2) {
      console.error("Invalid encrypted format");
      return encryptedText;
    }
    
    // For now, return a placeholder since Deno's crypto API is different from Node's
    // In production, you'd implement proper AES-256-CBC decryption here
    console.log("Decryption not yet implemented in Deno runtime");
    return encryptedText;
  } catch (error) {
    console.error("Decryption error:", error);
    return encryptedText;
  }
}

// Worker template code - loaded on first use
let workerTemplateCode: string | null = null;

async function getWorkerTemplateCode(): Promise<string> {
  if (!workerTemplateCode) {
    const currentDir = dirname(fromFileUrl(import.meta.url));
    workerTemplateCode = await Deno.readTextFile(join(currentDir, "worker-template.js"));
  }
  return workerTemplateCode;
}

// Database connection
const dbConfig = {
  user: Deno.env.get("POSTGRES_USER") || "postgres",
  password: Deno.env.get("POSTGRES_PASSWORD") || "postgres",
  database: Deno.env.get("POSTGRES_DB") || "insforge",
  hostname: Deno.env.get("POSTGRES_HOST") || "postgres",
  port: parseInt(Deno.env.get("POSTGRES_PORT") || "5432", 10),
};

// Get function code and secrets from database
async function getFunctionData(slug: string): Promise<{ code: string; secrets: Record<string, string> } | null> {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    
    // Get function code
    const functionResult = await client.queryObject<{ id: string; code: string }>`
      SELECT id, code FROM _edge_functions 
      WHERE slug = ${slug} AND status = 'active'
    `;
    
    if (functionResult.rows.length === 0) {
      return null;
    }
    
    const { id: functionId, code } = functionResult.rows[0];
    
    // Get associated secrets
    const secretsResult = await client.queryObject<{ name: string; value: string }>`
      SELECT v.name, v.value
      FROM _vault v
      JOIN _function_secrets fs ON v.id = fs.vault_id
      WHERE fs.function_id = ${functionId}
    `;
    
    // Decrypt secrets (they're stored encrypted)
    const secrets: Record<string, string> = {};
    for (const secret of secretsResult.rows) {
      // Decrypt the secret value
      secrets[secret.name] = decrypt(secret.value);
    }
    
    return { code, secrets };
  } catch (error) {
    console.error(`Error fetching function ${slug}:`, error);
    return null;
  } finally {
    await client.end();
  }
}

// Execute function in isolated worker
async function executeInWorker(code: string, secrets: Record<string, string>, request: Request): Promise<Response> {
  // Get worker template
  const template = await getWorkerTemplateCode();
  
  // Create blob for worker
  const workerBlob = new Blob([template], { type: "application/javascript" });
  const workerUrl = URL.createObjectURL(workerBlob);

  return new Promise(async (resolve) => {
    const worker = new Worker(workerUrl, { type: "module" });
    
    // Set timeout for worker execution
    const timeout = setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      resolve(new Response(
        JSON.stringify({ error: "Function timeout" }),
        { status: 504, headers: { "Content-Type": "application/json" } }
      ));
    }, WORKER_TIMEOUT_MS);

    // Handle worker response
    worker.onmessage = (e) => {
      clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(workerUrl);

      if (e.data.success) {
        const { response } = e.data;
        resolve(new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }));
      } else {
        resolve(new Response(
          JSON.stringify({ error: e.data.error }),
          { status: e.data.status || 500, headers: { "Content-Type": "application/json" } }
        ));
      }
    };

    // Handle worker errors
    worker.onerror = (error) => {
      clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      console.error("Worker error:", error);
      resolve(new Response(
        JSON.stringify({ error: "Worker execution error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      ));
    };

    // Prepare request data
    const body = request.body ? await request.text() : null;
    const requestData = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body,
    };

    // Send single message with code, secrets, and request data
    worker.postMessage({ code, secrets, requestData });
  });
}

Deno.serve({ port }, async (req: Request) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Health check
  if (pathname === "/health") {
    return new Response(
      JSON.stringify({ 
        status: "ok", 
        runtime: "deno",
        version: Deno.version.deno,
        typescript: Deno.version.typescript,
        v8: Deno.version.v8,
      }), 
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Function execution - match any slug pattern
  const slugMatch = pathname.match(/^\/([a-zA-Z0-9_-]+)\/?$/);
  if (slugMatch) {
    const slug = slugMatch[1];

    // Get function data from database
    const functionData = await getFunctionData(slug);

    if (!functionData) {
      return new Response(
        JSON.stringify({ error: "Function not found or not active" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Execute in worker
    try {
      return await executeInWorker(functionData.code, functionData.secrets, req);
    } catch (error) {
      console.error(`Failed to execute function ${slug}:`, error);
      return new Response(
        JSON.stringify({ error: "Function execution failed" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  // Runtime info
  if (pathname === "/info") {
    return new Response(
      JSON.stringify({
        runtime: "deno",
        version: Deno.version,
        env: Deno.env.get("DENO_ENV") || "production",
        database: {
          host: dbConfig.hostname,
          database: dbConfig.database,
        },
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // 404
  return new Response("Not Found", { status: 404 });
});