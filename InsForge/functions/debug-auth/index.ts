import { createClient } from 'npm:@insforge/sdk';

export default async function (req: Request): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const debug: Record<string, unknown> = {};

  // 1. Check env vars
  debug.INSFORGE_BASE_URL = Deno.env.get('INSFORGE_BASE_URL') ?? '(not set)';
  debug.INSFORGE_INTERNAL_URL = Deno.env.get('INSFORGE_INTERNAL_URL') ?? '(not set)';
  debug.ANON_KEY = Deno.env.get('ANON_KEY') ? '(set, length=' + Deno.env.get('ANON_KEY')!.length + ')' : '(not set)';

  // 2. Extract token
  const authHeader = req.headers.get('Authorization') || '';
  const userToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;

  debug.hasToken = !!userToken;
  debug.tokenLength = userToken?.length ?? 0;
  debug.tokenPrefix = userToken?.substring(0, 20) + '...' ?? null;

  // 3. Try to decode the JWT payload (no verification, just base64 decode)
  if (userToken) {
    try {
      const parts = userToken.split('.');
      debug.jwtParts = parts.length;
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1]));
        debug.jwtPayload = {
          sub: payload.sub,
          email: payload.email,
          role: payload.role,
          iat: payload.iat,
          exp: payload.exp,
          iss: payload.iss,
          isExpired: payload.exp ? Date.now() / 1000 > payload.exp : 'no exp',
          expiresIn: payload.exp ? Math.round(payload.exp - Date.now() / 1000) + 's' : 'no exp',
        };
      }
    } catch (e) {
      debug.jwtDecodeError = (e as Error).message;
    }
  }

  // 4. Try raw fetch to /api/auth/sessions/current with the token
  const baseUrl = Deno.env.get('INSFORGE_BASE_URL');
  if (baseUrl && userToken) {
    try {
      const rawResp = await fetch(`${baseUrl}/api/auth/sessions/current`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
      });
      const rawBody = await rawResp.text();
      debug.rawFetch = {
        status: rawResp.status,
        statusText: rawResp.statusText,
        body: rawBody.substring(0, 500),
      };
    } catch (e) {
      debug.rawFetchError = (e as Error).message;
    }
  }

  // 5. Try SDK getCurrentUser with edgeFunctionToken
  if (baseUrl && userToken) {
    try {
      const client = createClient({
        baseUrl: baseUrl,
        edgeFunctionToken: userToken,
      });
      const { data, error } = await client.auth.getCurrentUser();
      debug.sdkResult = {
        user: data?.user ? { id: data.user.id, email: data.user.email } : null,
        error: error ? { message: error.message, statusCode: (error as any).statusCode, code: (error as any).error } : null,
      };
    } catch (e) {
      debug.sdkError = (e as Error).message;
    }
  }

  // 6. Also try with ANON_KEY + edgeFunctionToken
  const anonKey = Deno.env.get('ANON_KEY');
  if (baseUrl && userToken && anonKey) {
    try {
      const client2 = createClient({
        baseUrl: baseUrl,
        anonKey: anonKey,
        edgeFunctionToken: userToken,
      });
      const { data, error } = await client2.auth.getCurrentUser();
      debug.sdkWithAnonKeyResult = {
        user: data?.user ? { id: data.user.id, email: data.user.email } : null,
        error: error ? { message: error.message, statusCode: (error as any).statusCode, code: (error as any).error } : null,
      };
    } catch (e) {
      debug.sdkWithAnonKeyError = (e as Error).message;
    }
  }

  return new Response(JSON.stringify(debug, null, 2), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
