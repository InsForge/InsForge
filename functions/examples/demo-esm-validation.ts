// Demo: ESM function that pulls in a third-party npm package and validates
// the request body with Zod. Uses `export default` and works with both
// Cloud (Deno Subhosting) and on-prem local Deno runtime.

import { z } from 'npm:zod';

const BodySchema = z.object({
  name: z.string().min(1).max(100).default('World'),
  age: z.number().int().min(0).max(150).optional(),
});

export default async function (request: Request): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const rawText = await request.text();
    let rawBody: unknown = {};
    if (rawText.trim() !== '') {
      try {
        rawBody = JSON.parse(rawText);
      } catch {
        return new Response(
          JSON.stringify({ error: 'Invalid JSON body' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    const body = BodySchema.parse(rawBody);

    let message = `Hello, ${body.name}!`;
    if (body.age !== undefined) {
      message += ` You are ${body.age} years old.`;
    }

    return new Response(
      JSON.stringify({
        message,
        validated: true,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new Response(
        JSON.stringify({
          error: 'Validation failed',
          issues: error.issues,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}
