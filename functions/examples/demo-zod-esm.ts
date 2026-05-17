import { z } from 'npm:zod';

/**
 * Demo: Deno-native ESM function with an npm import.
 *
 * Deploy this code as a function body to validate that the self-hosted runtime
 * supports top-level imports and `export default` handlers.
 */
export default async function (request: Request) {
  const BodySchema = z.object({
    name: z.string().trim().min(1).default('World'),
  });

  const body = BodySchema.parse(await request.json().catch(() => ({})));

  return new Response(JSON.stringify({ message: `Hello, ${body.name}!` }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
