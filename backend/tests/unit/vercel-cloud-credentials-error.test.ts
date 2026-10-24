import { describe, it, expect } from 'vitest';
import { buildCloudCredentialsError } from '@/providers/deployments/vercel.provider.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

function jsonResponse(status: number, statusText: string, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('buildCloudCredentialsError', () => {
  it('turns a 403 quota_exceeded refusal into a 403 AppError with the cloud message and upgrade link', async () => {
    const error = await buildCloudCredentialsError(
      jsonResponse(403, 'Forbidden', {
        code: 'quota_exceeded',
        quota: 'function_calls',
        upgrade_url: 'https://example.com/upgrade',
        message: 'Your organization has used its monthly function call quota.',
      })
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.DEPLOYMENT_QUOTA_EXCEEDED,
      message:
        'Your organization has used its monthly function call quota. Upgrade your plan to continue: https://example.com/upgrade',
      nextActions: 'Upgrade your plan to continue: https://example.com/upgrade',
    });
  });

  it('falls back to a quota-based message when the cloud sends no message or upgrade link', async () => {
    const error = await buildCloudCredentialsError(
      jsonResponse(403, 'Forbidden', { code: 'quota_exceeded', quota: 'vercel_build_minutes' })
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toBe(
      'Your organization has exceeded its vercel_build_minutes quota. Upgrade your plan to continue.'
    );
  });

  it('keeps other failures as plain errors that include the status and cloud message', async () => {
    const error = await buildCloudCredentialsError(
      jsonResponse(404, 'Not Found', { message: 'Project not found' })
    );

    expect(error).not.toBeInstanceOf(AppError);
    expect(error.message).toBe(
      'Failed to fetch Vercel credentials: 404 Not Found - Project not found'
    );
  });

  it('reads the reason from `error`, the field the cloud uses for non-quota failures', async () => {
    const error = await buildCloudCredentialsError(
      jsonResponse(429, 'Too Many Requests', {
        error: 'Too many requests',
        retry_after_seconds: 30,
      })
    );

    expect(error).not.toBeInstanceOf(AppError);
    expect(error.message).toBe(
      'Failed to fetch Vercel credentials: 429 Too Many Requests - Too many requests'
    );
  });

  it('does not treat a 403 without quota_exceeded as a quota error', async () => {
    const error = await buildCloudCredentialsError(
      jsonResponse(403, 'Forbidden', { message: 'Invalid signature' })
    );

    expect(error).not.toBeInstanceOf(AppError);
    expect(error.message).toBe(
      'Failed to fetch Vercel credentials: 403 Forbidden - Invalid signature'
    );
  });

  it('re-throws a timeout that aborts the body read instead of masking it', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const stalled = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(timeout);
        },
      }),
      { status: 500, statusText: 'Internal Server Error' }
    );

    await expect(buildCloudCredentialsError(stalled)).rejects.toBe(timeout);
  });

  it('handles a non-JSON body', async () => {
    const error = await buildCloudCredentialsError(
      new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' })
    );

    expect(error).not.toBeInstanceOf(AppError);
    expect(error.message).toBe('Failed to fetch Vercel credentials: 502 Bad Gateway');
  });
});
