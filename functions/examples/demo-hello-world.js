/**
 * Demo: Public "hello world" function
 *
 * - Supports CORS (OPTIONS)
 * - GET: reads from query string (?name=...)
 * - POST: reads JSON body { name }
 * - Demonstrates reading secrets via Deno.env.get('KEY')
 *
 * Notes:
 * - `createClient` and `Deno` are injected by InsForge's worker template.
 * - Keep exports exactly: module.exports = async function(request) { ... }
 */

module.exports = async function (request) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);

  let body = null;
  if (request.method !== 'GET') {
    try {
      body = await request.json();
    } catch {
      body = null;
    }
  }

  const name =
    (typeof body?.name === 'string' && body.name.trim()) ||
    (url.searchParams.get('name') || '').trim() ||
    'World';

  // Example secret (configure in InsForge -> Functions -> Secrets):
  // - HELLO_PREFIX="Hello"
  const helloPrefix = Deno.env.get('HELLO_PREFIX') || 'Hello';

  return new Response(
    JSON.stringify(
      {
        message: `${helloPrefix}, ${name}!`,
        timestamp: new Date().toISOString(),
        method: request.method,
        path: url.pathname,
      },
      null,
      2
    ),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
};

